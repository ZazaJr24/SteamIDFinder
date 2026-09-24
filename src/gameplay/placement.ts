/** Chooses the block state to place from the clicked face and view direction. */
import { BLOCKS } from '../world/blocks/blocks';
import { Face, FACE_NAMES, Flag } from '../world/blocks/registry';

type GetBlock = (x: number, y: number, z: number) => number;

/** The horizontal direction the player is looking toward. */
export function lookFacing(yaw: number): 'north' | 'south' | 'east' | 'west' {
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI / 4 || a >= (Math.PI * 7) / 4) return 'north';
  if (a < (Math.PI * 3) / 4) return 'west';
  if (a < (Math.PI * 5) / 4) return 'south';
  return 'east';
}

const SOIL = new Set(['grass_block', 'dirt', 'coarse_dirt']);

function supports(state: number): boolean {
  return (BLOCKS.flags[state]! & Flag.Solid) !== 0 && BLOCKS.model[state] === 1;
}

export function placementState(
  item: number,
  face: Face,
  yaw: number,
  get: GetBlock,
  x: number,
  y: number,
  z: number,
): number | null {
  const block = BLOCKS.blockOf(item);
  const name = block.name;
  const below = get(x, y - 1, z);
  const belowName = BLOCKS.blockOf(below).name;

  if (name.endsWith('_log')) {
    const axis =
      face === Face.East || face === Face.West
        ? 'x'
        : face === Face.North || face === Face.South
          ? 'z'
          : 'y';
    return block.state({ axis });
  }
  if (name === 'torch' || name === 'glutstein_torch') {
    if (face === Face.Down) return null;
    if (face === Face.Up) return supports(below) ? block.state({ facing: 'floor' }) : null;
    const facing = FACE_NAMES[face]!;
    return block.state({ facing });
  }
  if (name === 'lantern') {
    if (face === Face.Down)
      return supports(get(x, y + 1, z)) ? block.state({ hanging: true }) : null;
    return supports(below) ? block.state({ hanging: false }) : null;
  }
  if (BLOCKS.model[item] === 2 /* cross */) {
    if (name === 'sugar_cane')
      return belowName === 'sugar_cane' || SOIL.has(belowName) || belowName === 'sand'
        ? item
        : null;
    if (name === 'dead_bush')
      return belowName.includes('sand') || SOIL.has(belowName) ? item : null;
    if (name.endsWith('mushroom')) return supports(below) ? item : null;
    return SOIL.has(belowName) ? item : null;
  }
  if (name === 'cactus')
    return belowName === 'sand' || belowName === 'red_sand' || belowName === 'cactus' ? item : null;
  void yaw;
  return item;
}
