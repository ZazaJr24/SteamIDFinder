/**
 * Looking at, breaking and placing blocks. Creative mode breaks instantly;
 * survival breaking takes time based on block hardness and shows cracks.
 */
import * as THREE from 'three';
import { MouseButton, type Input } from '../core/input';
import type { Player } from '../entity/player';
import { BLOCKS } from '../world/blocks/blocks';
import { Face, FACE_NORMALS, Flag, Model } from '../world/blocks/registry';
import { raycast, type RayHit } from '../world/raycast';
import type { World } from '../world/world';
import type { CrackOverlay, ParticleSystem } from '../render/effects';
import type { SelectionBox } from '../render/selection';
import type { Hotbar } from '../ui/hotbar';
import { placementState } from './placement';

export const REACH = 5;

export interface InteractionEvents {
  onBreak?(x: number, y: number, z: number, state: number): void;
  onPlace?(x: number, y: number, z: number, state: number): void;
}

export class Interaction {
  target: RayHit | null = null;
  private breakCooldown = 0;
  private placeCooldown = 0;
  private progress = 0;
  private progressKey = '';
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly world: World,
    private readonly player: Player,
    private readonly hotbar: Hotbar,
    private readonly selection: SelectionBox,
    private readonly cracks: CrackOverlay,
    private readonly particles: ParticleSystem,
    private readonly events: InteractionEvents = {},
  ) {}

  /** Seconds to break a block by hand in survival. */
  static breakTime(state: number): number {
    const hardness = BLOCKS.hardness[state]!;
    if (hardness < 0) return Infinity;
    return hardness * 1.5;
  }

  update(dt: number, eye: THREE.Vector3, input: Input): void {
    const p = this.player;
    const d = p.lookDirection(this.dir);
    this.target = raycast(this.world, eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH);
    this.selection.show(this.target);
    this.breakCooldown -= dt;
    this.placeCooldown -= dt;
    this.handleBreaking(dt, input);
    this.handlePlacing(input);
    if (input.wasMousePressed(MouseButton.Middle) && this.target) {
      this.hotbar.pick(BLOCKS.blockOf(this.target.state).defaultState);
    }
  }

  cancel(): void {
    this.progress = 0;
    this.progressKey = '';
    this.cracks.show(null, 0, 0, 0, null);
    this.selection.show(null);
  }

  private handleBreaking(dt: number, input: Input): void {
    const hit = this.target;
    const holding = input.isMouseDown(MouseButton.Left);
    if (!holding || !hit) {
      this.progress = 0;
      this.progressKey = '';
      this.cracks.show(null, 0, 0, 0, null);
      if (!holding) this.breakCooldown = 0;
      return;
    }
    if (this.breakCooldown > 0) return;
    const creative = this.player.mode === 'creative';
    const time = creative ? 0 : Interaction.breakTime(hit.state);
    if (!Number.isFinite(time)) return;
    const key = `${hit.x},${hit.y},${hit.z},${hit.state}`;
    if (key !== this.progressKey) {
      this.progressKey = key;
      this.progress = 0;
    }
    this.progress += time > 0 ? dt / time : 1;
    if (this.progress < 1) {
      const sel = BLOCKS.selection.subarray(hit.state * 6, hit.state * 6 + 6);
      this.cracks.show(sel, hit.x, hit.y, hit.z, this.progress);
      return;
    }
    this.breakAt(hit.x, hit.y, hit.z, hit.state);
    this.progress = 0;
    this.progressKey = '';
    this.cracks.show(null, 0, 0, 0, null);
    this.breakCooldown = creative ? 0.18 : 0.12;
  }

  private breakAt(x: number, y: number, z: number, state: number): void {
    const world = this.world;
    world.setBlock(x, y, z, 0);
    const layer = particleLayer(state);
    const light = world.getLight(x, y, z);
    const brightness = Math.max(0.25, Math.max(light >> 4, light & 15) / 15);
    this.particles.burst(x, y, z, layer, brightness);
    this.events.onBreak?.(x, y, z, state);
    this.breakSupported(x, y, z);
  }

  /** Blocks that cannot exist without the broken one go too (plants, torches). */
  private breakSupported(x: number, y: number, z: number): void {
    const world = this.world;
    const above = world.getBlock(x, y + 1, z);
    const aboveBlock = BLOCKS.blockOf(above);
    const needsFloor =
      BLOCKS.model[above] === Model.Cross ||
      aboveBlock.name === 'cactus' ||
      (aboveBlock.name.endsWith('torch') && aboveBlock.propsOf(above).facing === 'floor') ||
      (aboveBlock.name === 'lantern' && !aboveBlock.propsOf(above).hanging);
    if (above !== 0 && needsFloor) this.breakAt(x, y + 1, z, above);

    const below = world.getBlock(x, y - 1, z);
    const belowBlock = BLOCKS.blockOf(below);
    if (belowBlock.name === 'lantern' && belowBlock.propsOf(below).hanging)
      this.breakAt(x, y - 1, z, below);

    for (const face of [Face.East, Face.West, Face.South, Face.North]) {
      const n = FACE_NORMALS[face]!;
      const side = world.getBlock(x + n[0], y, z + n[2]);
      const b = BLOCKS.blockOf(side);
      if (!b.name.endsWith('torch')) continue;
      const facing = b.propsOf(side).facing;
      if (facing === ['east', 'west', 'up', 'down', 'south', 'north'][face])
        this.breakAt(x + n[0], y, z + n[2], side);
    }
  }

  private handlePlacing(input: Input): void {
    const hit = this.target;
    if (!input.isMouseDown(MouseButton.Right)) {
      this.placeCooldown = 0;
      return;
    }
    if (!hit || this.placeCooldown > 0) return;
    this.placeCooldown = 0.22;
    const item = this.hotbar.selectedState;
    if (item === null) return;
    const n = FACE_NORMALS[hit.face]!;
    let tx = hit.x;
    let ty = hit.y;
    let tz = hit.z;
    // Clicking a replaceable block (tall grass) places into it instead of next to it.
    if (!BLOCKS.isReplaceable(hit.state)) {
      tx += n[0];
      ty += n[1];
      tz += n[2];
    }
    if (ty < 0 || ty >= 256) return;
    const existing = this.world.getBlock(tx, ty, tz);
    if (!BLOCKS.isReplaceable(existing)) return;
    const state = placementState(
      item,
      hit.face,
      this.player.yaw,
      (x, y, z) => this.world.getBlock(x, y, z),
      tx,
      ty,
      tz,
    );
    if (state === null) return;
    if (BLOCKS.isSolid(state) && this.intersectsPlayer(tx, ty, tz, state)) return;
    this.world.setBlock(tx, ty, tz, state);
    this.events.onPlace?.(tx, ty, tz, state);
  }

  private intersectsPlayer(x: number, y: number, z: number, state: number): boolean {
    const box = this.player.box();
    const shapes = BLOCKS.collision[state];
    const parts = shapes ? shapes.length / 6 : 1;
    for (let i = 0; i < parts; i++) {
      const b = shapes ? shapes.subarray(i * 6, i * 6 + 6) : [0, 0, 0, 1, 1, 1];
      if (
        box.minX < x + b[3]! &&
        box.maxX > x + b[0]! &&
        box.minY < y + b[4]! &&
        box.maxY > y + b[1]! &&
        box.minZ < z + b[5]! &&
        box.maxZ > z + b[2]!
      ) {
        return true;
      }
    }
    return false;
  }
}

/** Texture layer used for a block's break particles. */
export function particleLayer(state: number): number {
  const boxes = BLOCKS.boxes[state];
  if (boxes && boxes[0]) {
    const f = boxes[0].faces.find((x) => x);
    if (f) return f.layer;
  }
  return BLOCKS.faceLayer[state * 6 + (BLOCKS.flags[state]! & Flag.Opaque ? 4 : 0)]!;
}
