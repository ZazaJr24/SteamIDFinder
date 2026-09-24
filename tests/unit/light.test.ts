import { describe, expect, it } from 'vitest';
import { B } from '../../src/world/blocks/blocks';
import { Column } from '../../src/world/chunk';
import { World } from '../../src/world/world';

/** A flat stone world: 3×3 columns, stone up to y = 10. */
function flatWorld(): World {
  const world = new World(1);
  for (let cz = -1; cz <= 1; cz++)
    for (let cx = -1; cx <= 1; cx++) {
      const col = new Column(cx, cz);
      for (let y = 0; y <= 10; y++)
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) col.setBlock(x, y, z, B.stone);
      world.light.lightColumn(col, cx * 16, cz * 16);
      world.addColumn(col);
    }
  return world;
}

describe('lighting', () => {
  it('sunlight reaches the surface and not below stone', () => {
    const w = flatWorld();
    expect(w.getLight(5, 11, 5) >> 4).toBe(15);
    expect(w.getLight(5, 5, 5) >> 4).toBe(0);
  });

  it('a torch in a sealed cave lights with falloff and goes dark when removed', () => {
    const w = flatWorld();
    // Dig a 9-long tunnel at y = 5 (fully enclosed).
    for (let x = 0; x < 9; x++) w.setBlock(x, 5, 0, B.air);
    expect(w.getLight(4, 5, 0) >> 4).toBe(0);
    w.setBlock(0, 5, 0, B.torch);
    expect(w.getLight(0, 5, 0) & 15).toBe(14);
    expect(w.getLight(1, 5, 0) & 15).toBe(13);
    expect(w.getLight(8, 5, 0) & 15).toBe(6);
    w.setBlock(0, 5, 0, B.air);
    for (let x = 0; x < 9; x++) expect(w.getLight(x, 5, 0) & 15).toBe(0);
  });

  it('opening a hole lets sunlight in; closing it removes it', () => {
    const w = flatWorld();
    for (let y = 6; y <= 10; y++) w.setBlock(3, y, 3, B.air);
    w.setBlock(3, 5, 3, B.air);
    expect(w.getLight(3, 5, 3) >> 4).toBe(15);
    w.setBlock(3, 10, 3, B.stone);
    expect(w.getLight(3, 5, 3) >> 4).toBe(0);
  });

  it('light crosses column borders', () => {
    const w = flatWorld();
    for (let x = 10; x < 22; x++) w.setBlock(x, 5, 0, B.air);
    w.setBlock(15, 5, 0, B.torch);
    expect(w.getLight(16, 5, 0) & 15).toBe(13);
    expect(w.getLight(20, 5, 0) & 15).toBe(9);
  });
});
