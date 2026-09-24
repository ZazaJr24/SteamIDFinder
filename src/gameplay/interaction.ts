/**
 * Looking at, using, breaking and placing blocks. Creative mode breaks
 * instantly; survival breaking takes time based on block hardness and shows
 * cracks.
 */
import * as THREE from 'three';
import { MouseButton, type Input } from '../core/input';
import type { Player } from '../entity/player';
import { BLOCKS } from '../world/blocks/blocks';
import { Face, FACE_NORMALS, Flag, Model } from '../world/blocks/registry';
import { DIR, opposite, type Horizontal } from '../world/blocks/shapes';
import { raycast, type RayHit } from '../world/raycast';
import type { World } from '../world/world';
import type { CrackOverlay, ParticleSystem } from '../render/effects';
import type { SelectionBox } from '../render/selection';
import type { Hotbar } from '../ui/hotbar';
import { planPlacement, slabMerge, type Placement } from './placement';
import { attachedTo, isConsumer, isSource, type PowerSystem } from './power';
import { useBlock, type UseContext } from './use';

export const REACH = 5;

export interface InteractionEvents {
  onBreak?(x: number, y: number, z: number, state: number): void;
  onPlace?(x: number, y: number, z: number, state: number): void;
  onUse?(x: number, y: number, z: number, state: number): void;
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
    private readonly power: PowerSystem,
    private readonly useContext: Omit<UseContext, 'world' | 'power' | 'yaw'>,
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
    this.handleRightClick(input);
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
      this.cracks.show(
        BLOCKS.selectionOf(hit.state, hit.variant),
        hit.x,
        hit.y,
        hit.z,
        this.progress,
      );
      return;
    }
    this.breakAt(hit.x, hit.y, hit.z, hit.state);
    this.progress = 0;
    this.progressKey = '';
    this.cracks.show(null, 0, 0, 0, null);
    this.breakCooldown = creative ? 0.18 : 0.12;
  }

  /** Removes a block with effects, then everything that depended on it. */
  breakAt(x: number, y: number, z: number, state: number, effects = true): void {
    const world = this.world;
    world.setBlock(x, y, z, 0);
    if (effects) {
      const light = world.getLight(x, y, z);
      const brightness = Math.max(0.25, Math.max(light >> 4, light & 15) / 15);
      this.particles.burst(x, y, z, particleLayer(state), brightness);
      this.events.onBreak?.(x, y, z, state);
    }
    if (isSource(state) && BLOCKS.propsOf(state).powered) this.power.sourceChanged(x, y, z, state);
    this.breakPartner(x, y, z, state);
    this.breakSupported(x, y, z);
  }

  /** The other half of doors and beds. */
  private breakPartner(x: number, y: number, z: number, state: number): void {
    const b = BLOCKS.blockOf(state);
    const p = b.propsOf(state);
    if (b.name.endsWith('_door')) {
      const oy = p.half === 'lower' ? y + 1 : y - 1;
      const other = this.world.getBlock(x, oy, z);
      if (BLOCKS.blockOf(other) === b) this.breakAt(x, oy, z, other, false);
    } else if (b.name.endsWith('_bed')) {
      const d = DIR[p.facing as Horizontal];
      const s = p.part === 'foot' ? 1 : -1;
      const ox = x + d[0] * s;
      const oz = z + d[2] * s;
      const other = this.world.getBlock(ox, y, oz);
      if (BLOCKS.blockOf(other) === b) this.breakAt(ox, y, oz, other, false);
    }
  }

  /** Blocks that cannot exist without the broken one go too (plants, torches, doors …). */
  private breakSupported(x: number, y: number, z: number): void {
    const world = this.world;
    const above = world.getBlock(x, y + 1, z);
    if (above !== 0 && needsFloor(above)) this.breakAt(x, y + 1, z, above);

    const below = world.getBlock(x, y - 1, z);
    const belowBlock = BLOCKS.blockOf(below);
    if (belowBlock.name === 'lantern' && belowBlock.propsOf(below).hanging)
      this.breakAt(x, y - 1, z, below);

    for (const face of [Face.East, Face.West, Face.South, Face.North]) {
      const n = FACE_NORMALS[face]!;
      const sx = x + n[0];
      const sz = z + n[2];
      const side = world.getBlock(sx, y, sz);
      if (side === 0 || !hangsOnWall(side)) continue;
      const [ax, , az] = wallOf(side, sx, y, sz);
      if (ax === x && az === z) this.breakAt(sx, y, sz, side);
    }
  }

  private handleRightClick(input: Input): void {
    const hit = this.target;
    if (!input.isMouseDown(MouseButton.Right)) {
      this.placeCooldown = 0;
      return;
    }
    if (!hit || this.placeCooldown > 0) return;
    this.placeCooldown = 0.22;
    // Using a block (doors, levers, beds) takes priority unless the player sneaks.
    if (!this.player.sneaking) {
      const ctx: UseContext = {
        ...this.useContext,
        world: this.world,
        power: this.power,
        yaw: this.player.yaw,
      };
      if (useBlock(ctx, hit.x, hit.y, hit.z, hit.state)) {
        this.placeCooldown = 0.3;
        this.events.onUse?.(hit.x, hit.y, hit.z, hit.state);
        return;
      }
    }
    const item = this.hotbar.selectedState;
    if (item === null) return;
    const merged = slabMerge(item, hit);
    if (merged) {
      if (!this.intersectsPlayer(merged)) this.apply([merged]);
      return;
    }
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
    if (!BLOCKS.isReplaceable(existing)) {
      // A half slab sitting in the target cell merges into a double slab.
      const again = slabMerge(item, { ...hit, x: tx, y: ty, z: tz, state: existing });
      if (again && !this.intersectsPlayer(again)) this.apply([again]);
      return;
    }
    const plan = planPlacement(item, hit, tx, ty, tz, this.player.yaw, (x, y, z) =>
      this.world.getBlock(x, y, z),
    );
    if (!plan) return;
    for (const p of plan) {
      if (p.y < 0 || p.y >= 256 || !BLOCKS.isReplaceable(this.world.getBlock(p.x, p.y, p.z)))
        return;
      if (this.intersectsPlayer(p)) return;
    }
    this.apply(plan);
  }

  private apply(plan: Placement[]): void {
    for (const p of plan) this.world.setBlock(p.x, p.y, p.z, p.state);
    for (const p of plan) {
      if (isConsumer(p.state)) this.power.updateConsumer(p.x, p.y, p.z);
      this.events.onPlace?.(p.x, p.y, p.z, p.state);
    }
  }

  private intersectsPlayer(p: Placement): boolean {
    if (!BLOCKS.isSolid(p.state)) return false;
    const box = this.player.box();
    const variant = BLOCKS.variantOf(p.state, (dx, dy, dz) =>
      this.world.getBlock(p.x + dx, p.y + dy, p.z + dz),
    );
    const shapes = BLOCKS.collisionOf(p.state, variant);
    const parts = shapes ? shapes.length / 6 : 1;
    for (let i = 0; i < parts; i++) {
      const b = shapes ? shapes.subarray(i * 6, i * 6 + 6) : [0, 0, 0, 1, 1, 1];
      if (
        box.minX < p.x + b[3]! &&
        box.maxX > p.x + b[0]! &&
        box.minY < p.y + b[4]! &&
        box.maxY > p.y + b[1]! &&
        box.minZ < p.z + b[5]! &&
        box.maxZ > p.z + b[2]!
      ) {
        return true;
      }
    }
    return false;
  }
}

/** Does this block need the block below it? */
function needsFloor(state: number): boolean {
  const b = BLOCKS.blockOf(state);
  const p = b.propsOf(state);
  const n = b.name;
  if (BLOCKS.model[state] === Model.Cross || n === 'cactus') return true;
  if (n.endsWith('torch')) return p.facing === 'floor';
  if (n === 'lantern') return !p.hanging;
  if (n === 'lever' || n.endsWith('_button')) return p.face === 'floor';
  if (n.endsWith('_pressure_plate') || n.endsWith('_bed')) return true;
  if (n.endsWith('_door')) return p.half === 'lower';
  return false;
}

/** Blocks attached to a wall on one side. */
function hangsOnWall(state: number): boolean {
  const b = BLOCKS.blockOf(state);
  const p = b.propsOf(state);
  const n = b.name;
  if (n.endsWith('torch')) return p.facing !== 'floor';
  if (n === 'lever' || n.endsWith('_button')) return p.face === 'wall';
  return n === 'ladder';
}

/** Position of the wall block something hangs on. */
function wallOf(state: number, x: number, y: number, z: number): [number, number, number] {
  const b = BLOCKS.blockOf(state);
  if (b.name === 'lever' || b.name.endsWith('_button')) return attachedTo(state, x, y, z);
  const back = DIR[opposite(b.propsOf(state).facing as Horizontal)];
  return [x + back[0], y, z + back[2]];
}

/** Texture layer used for a block's break particles. */
export function particleLayer(state: number): number {
  const boxes = BLOCKS.boxesOf(state);
  if (boxes && boxes[0]) {
    const f = boxes[0].faces.find((x) => x);
    if (f) return f.layer;
  }
  return BLOCKS.faceLayer[state * 6 + (BLOCKS.flags[state]! & Flag.Opaque ? 4 : 0)]!;
}
