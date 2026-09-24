/** Procedural tree shapes. All randomness comes from the passed `Random`. */
import type { Random } from '../../core/random';
import { BLOCKS } from '../blocks/blocks';
import type { TreeKind } from './biomes';

/** Places a block if the target is free; logs may also replace leaves. */
export type Place = (x: number, y: number, z: number, state: number, isLog: boolean) => void;

const log = (wood: string, axis: 'x' | 'y' | 'z' = 'y') => BLOCKS.id(`${wood}_log`, { axis });
const leaves = (wood: string) => BLOCKS.id(`${wood}_leaves`);

function blob(
  place: Place,
  rng: Random,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  leaf: number,
  density = 0.9,
): void {
  const r = Math.ceil(Math.max(rx, ry));
  for (let dy = -r; dy <= r; dy++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rx * rx);
        if (d > 1) continue;
        if (d > 0.6 && !rng.chance(density)) continue;
        place(cx + dx, cy + dy, cz + dz, leaf, false);
      }
}

function trunk(place: Place, x: number, y: number, z: number, h: number, state: number): void {
  for (let i = 0; i < h; i++) place(x, y + i, z, state, true);
}

/** Classic small tree: square leaf layers that shrink toward the top. */
function simpleTree(
  place: Place,
  rng: Random,
  x: number,
  y: number,
  z: number,
  wood: string,
  h: number,
): void {
  const leaf = leaves(wood);
  const top = y + h - 1;
  for (let ly = top - 2; ly <= top + 1; ly++) {
    const r = ly <= top - 1 ? 2 : 1;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (ly === top + 1 || rng.chance(0.5))) continue;
        place(x + dx, ly, z + dz, leaf, false);
      }
  }
  trunk(place, x, y, z, h, log(wood));
}

function fancyOak(place: Place, rng: Random, x: number, y: number, z: number): void {
  const h = 7 + rng.int(4);
  const wood = log('oak');
  const leaf = leaves('oak');
  const branches = 2 + rng.int(3);
  for (let b = 0; b < branches; b++) {
    const by = y + Math.floor(h * (0.5 + rng.next() * 0.35));
    const angle = rng.next() * Math.PI * 2;
    const len = 2 + rng.int(2);
    let bx = x;
    let bz = z;
    for (let i = 1; i <= len; i++) {
      bx = x + Math.round(Math.cos(angle) * i);
      bz = z + Math.round(Math.sin(angle) * i);
      const axis = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) ? 'x' : 'z';
      place(bx, by + Math.floor(i / 2), bz, log('oak', axis), true);
    }
    blob(place, rng, bx, by + Math.floor(len / 2) + 1, bz, 2.4, 1.8, leaf, 0.8);
  }
  blob(place, rng, x, y + h, z, 2.8, 2, leaf, 0.8);
  trunk(place, x, y, z, h, wood);
}

function spruce(place: Place, rng: Random, x: number, y: number, z: number, pine: boolean): void {
  const h = pine ? 10 + rng.int(5) : 7 + rng.int(5);
  const wood = log('spruce');
  const leaf = leaves('spruce');
  const top = y + h;
  place(x, top, z, leaf, false);
  place(x, top + 1, z, leaf, false);
  const start = pine ? top - 4 : y + 2 + rng.int(2);
  let r = 0;
  for (let ly = top - 1; ly >= start; ly--) {
    r = pine
      ? ly > top - 3
        ? 1
        : 2
      : (top - ly) % 2 === 0
        ? Math.max(1, r - 1)
        : Math.min(3, r + 1);
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
        place(x + dx, ly, z + dz, leaf, false);
      }
  }
  trunk(place, x, y, z, h, wood);
}

function jungleTree(place: Place, rng: Random, x: number, y: number, z: number): void {
  const h = 9 + rng.int(7);
  const leaf = leaves('jungle');
  blob(place, rng, x, y + h, z, 3.4, 1.6, leaf, 0.85);
  blob(place, rng, x, y + h + 1, z, 2.2, 1.2, leaf, 0.9);
  // Side clusters along the trunk.
  for (let i = 0; i < 3; i++) {
    const cy = y + 3 + rng.int(Math.max(1, h - 5));
    const side = rng.int(4);
    const dx = side === 0 ? 1 : side === 1 ? -1 : 0;
    const dz = side === 2 ? 1 : side === 3 ? -1 : 0;
    blob(place, rng, x + dx * 2, cy, z + dz * 2, 1.6, 1, leaf, 0.8);
  }
  trunk(place, x, y, z, h, log('jungle'));
}

function jungleBush(place: Place, rng: Random, x: number, y: number, z: number): void {
  blob(place, rng, x, y + 1, z, 2.2, 1.4, leaves('jungle'), 0.75);
  place(x, y, z, log('jungle'), true);
}

function acacia(place: Place, rng: Random, x: number, y: number, z: number): void {
  const wood = log('acacia');
  const leaf = leaves('acacia');
  const straight = 3 + rng.int(2);
  trunk(place, x, y, z, straight, wood);
  const dir = rng.int(4);
  const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
  const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
  let cx = x;
  let cy = y + straight;
  let cz = z;
  const bend = 2 + rng.int(2);
  for (let i = 0; i < bend; i++) {
    cx += dx;
    cz += dz;
    place(cx, cy, cz, wood, true);
    cy++;
  }
  // Flat umbrella canopy.
  for (let dz2 = -3; dz2 <= 3; dz2++)
    for (let dx2 = -3; dx2 <= 3; dx2++) {
      if (Math.abs(dx2) === 3 && Math.abs(dz2) === 3) continue;
      place(cx + dx2, cy, cz + dz2, leaf, false);
      if (Math.abs(dx2) <= 1 && Math.abs(dz2) <= 1) place(cx + dx2, cy + 1, cz + dz2, leaf, false);
    }
}

function darkOak(place: Place, rng: Random, x: number, y: number, z: number): void {
  const h = 6 + rng.int(3);
  const wood = log('dark_oak');
  const leaf = leaves('dark_oak');
  blob(place, rng, x, y + h, z, 3.6, 1.8, leaf, 0.85);
  blob(place, rng, x + 1, y + h, z + 1, 3.2, 1.6, leaf, 0.85);
  for (const [ox, oz] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    trunk(place, x + ox, y, z + oz, h, wood);
  }
}

function cherry(place: Place, rng: Random, x: number, y: number, z: number): void {
  const h = 4 + rng.int(2);
  const leaf = leaves('cherry');
  trunk(place, x, y, z, h, log('cherry'));
  const arms = 1 + rng.int(2);
  for (let a = 0; a < arms; a++) {
    const dir = (rng.int(4) + a * 2) % 4;
    const dx = dir === 0 ? 1 : dir === 1 ? -1 : 0;
    const dz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
    let cx = x;
    let cy = y + h - 1;
    let cz = z;
    for (let i = 0; i < 3; i++) {
      cx += dx;
      cz += dz;
      cy += i > 0 ? 1 : 0;
      place(cx, cy, cz, log('cherry', dx !== 0 ? 'x' : 'z'), true);
    }
    blob(place, rng, cx, cy + 1, cz, 2.8, 1.6, leaf, 0.85);
  }
  blob(place, rng, x, y + h + 1, z, 2.6, 1.5, leaf, 0.85);
}

export function growTree(
  kind: TreeKind,
  place: Place,
  rng: Random,
  x: number,
  y: number,
  z: number,
): void {
  switch (kind) {
    case 'oak':
      return simpleTree(place, rng, x, y, z, 'oak', 4 + rng.int(3));
    case 'birch':
      return simpleTree(place, rng, x, y, z, 'birch', 5 + rng.int(3));
    case 'fancy_oak':
      return fancyOak(place, rng, x, y, z);
    case 'spruce':
      return spruce(place, rng, x, y, z, false);
    case 'pine':
      return spruce(place, rng, x, y, z, true);
    case 'jungle':
      return jungleTree(place, rng, x, y, z);
    case 'jungle_bush':
      return jungleBush(place, rng, x, y, z);
    case 'acacia':
      return acacia(place, rng, x, y, z);
    case 'dark_oak':
      return darkOak(place, rng, x, y, z);
    case 'cherry':
      return cherry(place, rng, x, y, z);
  }
}

/** Largest horizontal reach of any tree from its trunk (for neighbour lookups). */
export const MAX_TREE_RADIUS = 5;
