/**
 * A small signal system ("Glutstein" circuits in their simplest form):
 * levers, buttons and pressure plates power the blocks next to them and the
 * block they are attached to, which in turn powers its neighbours. Powered
 * lamps light up; powered doors, trapdoors and gates open.
 */
import { BLOCKS } from '../world/blocks/blocks';
import { FACE_NORMALS } from '../world/blocks/registry';
import { DIR, opposite, type Horizontal } from '../world/blocks/shapes';
import type { World } from '../world/world';
import { isSupport } from './placement';

const NEIGHBORS = FACE_NORMALS;

export function isSource(state: number): boolean {
  const name = BLOCKS.blockOf(state).name;
  return name === 'lever' || name.endsWith('_button') || name.endsWith('_pressure_plate');
}

function isActiveSource(state: number): boolean {
  return isSource(state) && BLOCKS.propsOf(state).powered === true;
}

/** The block a source is attached to (it becomes strongly powered). */
export function attachedTo(
  state: number,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const b = BLOCKS.blockOf(state);
  const p = b.propsOf(state);
  if (b.name.endsWith('_pressure_plate') || p.face === 'floor') return [x, y - 1, z];
  const back = DIR[opposite(p.facing as Horizontal)];
  return [x + back[0], y, z + back[2]];
}

export function isConsumer(state: number): boolean {
  const name = BLOCKS.blockOf(state).name;
  return (
    name === 'glutstein_lamp' ||
    name.endsWith('_door') ||
    name.endsWith('_trapdoor') ||
    name.endsWith('_fence_gate')
  );
}

export class PowerSystem {
  constructor(private readonly world: World) {}

  /** Is the block at (x, y, z) receiving power from any direction? */
  isPowered(x: number, y: number, z: number): boolean {
    const w = this.world;
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const s = w.getBlock(nx, ny, nz);
      if (isActiveSource(s)) return true;
      // A solid block with an active source attached to it is strongly powered.
      if (isSupport(s) && this.stronglyPowered(nx, ny, nz)) return true;
    }
    return false;
  }

  private stronglyPowered(x: number, y: number, z: number): boolean {
    const w = this.world;
    for (const [dx, dy, dz] of NEIGHBORS) {
      const s = w.getBlock(x + dx, y + dy, z + dz);
      if (!isActiveSource(s)) continue;
      const [ax, ay, az] = attachedTo(s, x + dx, y + dy, z + dz);
      if (ax === x && ay === y && az === z) return true;
    }
    return false;
  }

  /** Re-evaluates every consumer that a source at (x, y, z) could reach. */
  sourceChanged(x: number, y: number, z: number, state: number): void {
    const [ax, ay, az] = attachedTo(state, x, y, z);
    const seen = new Set<string>();
    const check = (cx: number, cy: number, cz: number) => {
      for (const [dx, dy, dz] of [[0, 0, 0], ...NEIGHBORS] as const) {
        const px = cx + dx;
        const py = cy + dy;
        const pz = cz + dz;
        const key = `${px},${py},${pz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.updateConsumer(px, py, pz);
      }
    };
    check(x, y, z);
    check(ax, ay, az);
  }

  /** Called when a consumer is placed, so it starts in the right state. */
  updateConsumer(x: number, y: number, z: number): void {
    const w = this.world;
    const state = w.getBlock(x, y, z);
    if (!isConsumer(state)) return;
    const block = BLOCKS.blockOf(state);
    const props = block.propsOf(state);
    if (block.name === 'glutstein_lamp') {
      const powered = this.isPowered(x, y, z);
      if (powered !== props.lit) w.setBlock(x, y, z, block.state({ ...props, lit: powered }));
      return;
    }
    if (block.name.endsWith('_door')) {
      const lowerY = props.half === 'upper' ? y - 1 : y;
      const powered = this.isPowered(x, lowerY, z) || this.isPowered(x, lowerY + 1, z);
      const lastPowered = this.doorMemory.get(`${x},${lowerY},${z}`) ?? false;
      // Only react to changes of power so players can still open wooden doors by hand.
      if (powered === lastPowered) return;
      this.doorMemory.set(`${x},${lowerY},${z}`, powered);
      setDoorOpen(w, x, lowerY, z, powered);
      return;
    }
    const powered = this.isPowered(x, y, z);
    const key = `${x},${y},${z}`;
    const lastPowered = this.doorMemory.get(key) ?? false;
    if (powered === lastPowered) return;
    this.doorMemory.set(key, powered);
    if (props.open !== powered) w.setBlock(x, y, z, block.state({ ...props, open: powered }));
  }

  private readonly doorMemory = new Map<string, boolean>();
}

/** Opens or closes both halves of a door whose lower half is at (x, y, z). */
export function setDoorOpen(world: World, x: number, y: number, z: number, open: boolean): boolean {
  const lower = world.getBlock(x, y, z);
  const upper = world.getBlock(x, y + 1, z);
  const b = BLOCKS.blockOf(lower);
  if (!b.name.endsWith('_door') || BLOCKS.blockOf(upper) !== b) return false;
  const pl = b.propsOf(lower);
  if (pl.open === open) return false;
  world.setBlock(x, y, z, b.state({ ...pl, open }));
  world.setBlock(x, y + 1, z, b.state({ ...b.propsOf(upper), open }));
  return true;
}
