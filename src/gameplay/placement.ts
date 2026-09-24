/**
 * Decides what gets placed where: orientation from the clicked face and the
 * view direction, slab halves, two-block doors and beds, support checks.
 */
import { BLOCKS } from '../world/blocks/blocks';
import { Face, FACE_NAMES, FACE_NORMALS, Flag, Model } from '../world/blocks/registry';
import { counterClockwise, DIR, opposite, type Horizontal } from '../world/blocks/shapes';
import type { RayHit } from '../world/raycast';

type GetBlock = (x: number, y: number, z: number) => number;

export interface Placement {
  x: number;
  y: number;
  z: number;
  state: number;
}

/** The horizontal direction the player is looking toward. */
export function lookFacing(yaw: number): Horizontal {
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI / 4 || a >= (Math.PI * 7) / 4) return 'north';
  if (a < (Math.PI * 3) / 4) return 'west';
  if (a < (Math.PI * 5) / 4) return 'south';
  return 'east';
}

const SOIL = new Set(['grass_block', 'dirt', 'coarse_dirt']);

/** A full solid block something can hang on or stand on. */
export function isSupport(state: number): boolean {
  return (BLOCKS.flags[state]! & Flag.Solid) !== 0 && BLOCKS.model[state] === Model.Cube;
}

/** Can the top of this block carry a plate, torch, door …? */
function topSupport(state: number): boolean {
  if (isSupport(state)) return true;
  const b = BLOCKS.blockOf(state);
  const p = b.propsOf(state);
  return (
    (b.name.endsWith('_slab') && p.type !== 'bottom') ||
    (b.name.endsWith('_stairs') && p.half === 'top')
  );
}

const HORIZONTAL_FACE: Partial<Record<Face, Horizontal>> = {
  [Face.East]: 'east',
  [Face.West]: 'west',
  [Face.South]: 'south',
  [Face.North]: 'north',
};

/**
 * Slab merging: clicking the matching half of a slab of the same kind turns
 * it into a double slab in place. Returns the placement or null.
 */
export function slabMerge(item: number, hit: RayHit): Placement | null {
  const block = BLOCKS.blockOf(item);
  if (!block.name.endsWith('_slab') || BLOCKS.blockOf(hit.state) !== block) return null;
  const type = BLOCKS.propsOf(hit.state).type;
  if ((type === 'bottom' && hit.face === Face.Up) || (type === 'top' && hit.face === Face.Down)) {
    return { x: hit.x, y: hit.y, z: hit.z, state: block.state({ type: 'double' }) };
  }
  return null;
}

export function planPlacement(
  item: number,
  hit: RayHit,
  x: number,
  y: number,
  z: number,
  yaw: number,
  get: GetBlock,
): Placement[] | null {
  const block = BLOCKS.blockOf(item);
  const name = block.name;
  const face = hit.face;
  const below = get(x, y - 1, z);
  const belowName = BLOCKS.blockOf(below).name;
  const look = lookFacing(yaw);
  // Height of the click point inside the clicked block (for slab/stair halves).
  const hitY = hit.point[1] - Math.floor(hit.point[1] - (face === Face.Up ? 1e-6 : 0));
  const upperHalf = face === Face.Down || (face !== Face.Up && hitY > 0.5);
  const one = (state: number | null): Placement[] | null =>
    state === null ? null : [{ x, y, z, state }];
  const clickedSupports = isSupport(hit.state);

  if (name.endsWith('_log')) {
    const axis =
      face === Face.East || face === Face.West
        ? 'x'
        : face === Face.North || face === Face.South
          ? 'z'
          : 'y';
    return one(block.state({ axis }));
  }
  if (name.endsWith('_slab')) return one(block.state({ type: upperHalf ? 'top' : 'bottom' }));
  if (name.endsWith('_stairs'))
    return one(block.state({ facing: look, half: upperHalf ? 'top' : 'bottom' }));
  if (name.endsWith('_fence_gate')) return one(block.state({ facing: look }));
  if (name === 'chest') return one(block.state({ facing: opposite(look) }));

  if (name === 'torch' || name === 'glutstein_torch') {
    if (face === Face.Down) return null;
    if (face === Face.Up) return topSupport(below) ? one(block.state({ facing: 'floor' })) : null;
    return clickedSupports ? one(block.state({ facing: FACE_NAMES[face]! })) : null;
  }
  if (name === 'lantern') {
    if (face === Face.Down)
      return isSupport(get(x, y + 1, z)) ? one(block.state({ hanging: true })) : null;
    return topSupport(below) ? one(block.state({ hanging: false })) : null;
  }
  if (name === 'ladder') {
    const f = HORIZONTAL_FACE[face];
    return f && clickedSupports ? one(block.state({ facing: f })) : null;
  }
  if (name === 'lever' || name.endsWith('_button')) {
    if (face === Face.Down) return null;
    if (face === Face.Up)
      return topSupport(below) ? one(block.state({ face: 'floor', facing: look })) : null;
    return clickedSupports
      ? one(block.state({ face: 'wall', facing: HORIZONTAL_FACE[face]! }))
      : null;
  }
  if (name.endsWith('_pressure_plate')) return topSupport(below) ? one(item) : null;
  if (name.endsWith('_trapdoor')) {
    const f = HORIZONTAL_FACE[face];
    if (f) return one(block.state({ facing: f, half: hitY > 0.5 ? 'top' : 'bottom' }));
    return one(
      block.state({ facing: opposite(look), half: face === Face.Down ? 'top' : 'bottom' }),
    );
  }
  if (name.endsWith('_door')) {
    if (!topSupport(below) || !BLOCKS.isReplaceable(get(x, y + 1, z)) || y + 1 >= 256) return null;
    // Double doors: next to a door with the same facing, hinge on the other side.
    const left = DIR[counterClockwise(look)];
    const neighbour = get(x + left[0], y, z + left[2]);
    const nb = BLOCKS.blockOf(neighbour);
    const hinge =
      nb.name.endsWith('_door') &&
      nb.propsOf(neighbour).facing === look &&
      nb.propsOf(neighbour).hinge === 'left'
        ? 'right'
        : 'left';
    return [
      { x, y, z, state: block.state({ facing: look, half: 'lower', hinge }) },
      { x, y: y + 1, z, state: block.state({ facing: look, half: 'upper', hinge }) },
    ];
  }
  if (name.endsWith('_bed')) {
    const d = DIR[look];
    const hx = x + d[0];
    const hz = z + d[2];
    if (
      !topSupport(below) ||
      !topSupport(get(hx, y - 1, hz)) ||
      !BLOCKS.isReplaceable(get(hx, y, hz))
    )
      return null;
    return [
      { x, y, z, state: block.state({ facing: look, part: 'foot' }) },
      { x: hx, y, z: hz, state: block.state({ facing: look, part: 'head' }) },
    ];
  }
  if (BLOCKS.model[item] === Model.Cross) {
    if (name === 'sugar_cane')
      return belowName === 'sugar_cane' || SOIL.has(belowName) || belowName === 'sand'
        ? one(item)
        : null;
    if (name === 'dead_bush')
      return belowName.includes('sand') || SOIL.has(belowName) ? one(item) : null;
    if (name.endsWith('mushroom')) return isSupport(below) ? one(item) : null;
    return SOIL.has(belowName) ? one(item) : null;
  }
  if (name === 'cactus')
    return belowName === 'sand' || belowName === 'red_sand' || belowName === 'cactus'
      ? one(item)
      : null;
  void FACE_NORMALS;
  return one(item);
}
