import { describe, expect, it } from 'vitest';
import { BLOCKS, B } from '../../src/world/blocks/blocks';
import { buildTextureSet } from '../../tools/texgen/textures';

describe('block registry', () => {
  it('air is state 0 and states round-trip through names', () => {
    expect(B.air).toBe(0);
    for (let s = 0; s < BLOCKS.stateCount; s++) {
      expect(BLOCKS.stateFromName(BLOCKS.stateName(s))).toBe(s);
    }
  });

  it('withProp changes exactly one property', () => {
    const torch = BLOCKS.id('torch', { facing: 'north' });
    const moved = BLOCKS.withProp(torch, 'facing', 'east');
    expect(BLOCKS.propsOf(moved).facing).toBe('east');
    expect(BLOCKS.blockOf(moved).name).toBe('torch');
  });

  it('unknown blocks in saves map to -1', () => {
    expect(BLOCKS.stateFromName('no_such_block')).toBe(-1);
    // Unknown property values fall back to defaults.
    expect(BLOCKS.stateFromName('oak_log[axis=w]')).toBe(BLOCKS.id('oak_log'));
  });

  it('every referenced texture has a recipe', () => {
    const recipes = new Set(buildTextureSet().names);
    const missing = [...BLOCKS.referencedTextures()].filter((n) => !recipes.has(n));
    expect(missing).toEqual([]);
  });

  it('flags are sensible', () => {
    expect(BLOCKS.isOpaque(B.stone)).toBe(true);
    expect(BLOCKS.isOpaque(BLOCKS.id('glass'))).toBe(false);
    expect(BLOCKS.isSolid(B.tallGrass)).toBe(false);
    expect(BLOCKS.isReplaceable(B.tallGrass)).toBe(true);
    expect(BLOCKS.isLiquid(B.water)).toBe(true);
    expect(BLOCKS.emission[B.torch]).toBe(14);
  });
});
