/** Axis-aligned box collision against the voxel world. */
import { BLOCKS } from '../world/blocks/blocks';
import { Flag } from '../world/blocks/registry';

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface BlockSource {
  /** Block state or -1 when unloaded (treated as solid). */
  getState(x: number, y: number, z: number): number;
}

const EPS = 1e-7;

/** Calls `fn` with every solid box (world units) that overlaps `area`. */
export function forEachCollider(world: BlockSource, area: Aabb, fn: (b: Aabb) => void): void {
  const x0 = Math.floor(area.minX);
  const y0 = Math.floor(area.minY);
  const z0 = Math.floor(area.minZ);
  const x1 = Math.floor(area.maxX - EPS);
  const y1 = Math.floor(area.maxY - EPS);
  const z1 = Math.floor(area.maxZ - EPS);
  const box: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  for (let y = y0 - 1; y <= y1; y++) {
    if (y < 0 || y >= 256) continue;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const state = world.getState(x, y, z);
        if (state < 0) {
          // Unloaded: a wall, so nobody falls out of the world while it loads.
          box.minX = x;
          box.minY = y;
          box.minZ = z;
          box.maxX = x + 1;
          box.maxY = y + 1;
          box.maxZ = z + 1;
          fn(box);
          continue;
        }
        if (!(BLOCKS.flags[state]! & Flag.Solid)) continue;
        const variant =
          BLOCKS.variantCount[state]! > 1
            ? BLOCKS.variantOf(state, (dx, dy, dz) =>
                Math.max(0, world.getState(x + dx, y + dy, z + dz)),
              )
            : 0;
        const shapes = BLOCKS.collisionOf(state, variant);
        if (!shapes) {
          box.minX = x;
          box.minY = y;
          box.minZ = z;
          box.maxX = x + 1;
          box.maxY = y + 1;
          box.maxZ = z + 1;
          fn(box);
          continue;
        }
        for (let i = 0; i < shapes.length; i += 6) {
          box.minX = x + shapes[i]!;
          box.minY = y + shapes[i + 1]!;
          box.minZ = z + shapes[i + 2]!;
          box.maxX = x + shapes[i + 3]!;
          box.maxY = y + shapes[i + 4]!;
          box.maxZ = z + shapes[i + 5]!;
          fn(box);
        }
      }
    }
  }
}

export function intersects(a: Aabb, b: Aabb): boolean {
  return (
    a.minX < b.maxX - EPS &&
    a.maxX > b.minX + EPS &&
    a.minY < b.maxY - EPS &&
    a.maxY > b.minY + EPS &&
    a.minZ < b.maxZ - EPS &&
    a.maxZ > b.minZ + EPS
  );
}

/**
 * Moves `box` by (dx, dy, dz) one axis at a time (y first), stopping at solid
 * blocks. Mutates `box`; returns the movement actually applied.
 */
export function moveBox(
  world: BlockSource,
  box: Aabb,
  dx: number,
  dy: number,
  dz: number,
): [number, number, number] {
  const area: Aabb = {
    minX: Math.min(box.minX, box.minX + dx),
    minY: Math.min(box.minY, box.minY + dy),
    minZ: Math.min(box.minZ, box.minZ + dz),
    maxX: Math.max(box.maxX, box.maxX + dx),
    maxY: Math.max(box.maxY, box.maxY + dy),
    maxZ: Math.max(box.maxZ, box.maxZ + dz),
  };
  const colliders: Aabb[] = [];
  forEachCollider(world, area, (b) => colliders.push({ ...b }));

  for (const c of colliders) {
    if (
      box.maxX > c.minX + EPS &&
      box.minX < c.maxX - EPS &&
      box.maxZ > c.minZ + EPS &&
      box.minZ < c.maxZ - EPS
    ) {
      if (dy > 0 && box.maxY <= c.minY + EPS) dy = Math.min(dy, c.minY - box.maxY);
      else if (dy < 0 && box.minY >= c.maxY - EPS) dy = Math.max(dy, c.maxY - box.minY);
    }
  }
  box.minY += dy;
  box.maxY += dy;

  for (const c of colliders) {
    if (
      box.maxY > c.minY + EPS &&
      box.minY < c.maxY - EPS &&
      box.maxZ > c.minZ + EPS &&
      box.minZ < c.maxZ - EPS
    ) {
      if (dx > 0 && box.maxX <= c.minX + EPS) dx = Math.min(dx, c.minX - box.maxX);
      else if (dx < 0 && box.minX >= c.maxX - EPS) dx = Math.max(dx, c.maxX - box.minX);
    }
  }
  box.minX += dx;
  box.maxX += dx;

  for (const c of colliders) {
    if (
      box.maxY > c.minY + EPS &&
      box.minY < c.maxY - EPS &&
      box.maxX > c.minX + EPS &&
      box.minX < c.maxX - EPS
    ) {
      if (dz > 0 && box.maxZ <= c.minZ + EPS) dz = Math.min(dz, c.minZ - box.maxZ);
      else if (dz < 0 && box.minZ >= c.maxZ - EPS) dz = Math.max(dz, c.maxZ - box.minZ);
    }
  }
  box.minZ += dz;
  box.maxZ += dz;
  return [dx, dy, dz];
}

/** Is any solid block overlapping `box`? */
export function collides(world: BlockSource, box: Aabb): boolean {
  let hit = false;
  forEachCollider(world, box, (b) => {
    if (!hit && intersects(box, b)) hit = true;
  });
  return hit;
}
