/** Voxel ray casting (Amanatides & Woo) with per-block selection boxes. */
import { BLOCKS } from './blocks/blocks';
import { Face, Flag } from './blocks/registry';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** Face of the block that was hit. */
  face: Face;
  state: number;
  distance: number;
  /** Exact hit point. */
  point: [number, number, number];
}

export interface StateSource {
  getBlock(x: number, y: number, z: number): number;
}

/** Ray vs box slab test; returns entry distance and face, or null. */
function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: ArrayLike<number>,
  bx: number,
  by: number,
  bz: number,
): [number, Face] | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  let face = Face.Up;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const lo = [bx + b[0]!, by + b[1]!, bz + b[2]!];
  const hi = [bx + b[3]!, by + b[4]!, bz + b[5]!];
  const negFaces = [Face.West, Face.Down, Face.North];
  const posFaces = [Face.East, Face.Up, Face.South];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-12) {
      if (o[a]! < lo[a]! || o[a]! > hi[a]!) return null;
      continue;
    }
    let t1 = (lo[a]! - o[a]!) / d[a]!;
    let t2 = (hi[a]! - o[a]!) / d[a]!;
    let f = negFaces[a]!;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      f = posFaces[a]!;
    }
    if (t1 > tmin) {
      tmin = t1;
      face = f;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return [Math.max(0, tmin), face];
}

export function raycast(
  world: StateSource,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
): RayHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let t = 0;
  while (t <= maxDistance) {
    if (y >= 0 && y < 256) {
      const state = world.getBlock(x, y, z);
      if (state !== 0 && BLOCKS.flags[state]! & Flag.Selectable) {
        const sel = BLOCKS.selection.subarray(state * 6, state * 6 + 6);
        const hit = rayBox(ox, oy, oz, dx, dy, dz, sel, x, y, z);
        if (hit && hit[0] <= maxDistance) {
          const d = hit[0];
          return {
            x,
            y,
            z,
            face: hit[1],
            state,
            distance: d,
            point: [ox + dx * d, oy + dy * d, oz + dz * d],
          };
        }
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}
