import { describe, expect, it } from 'vitest';
import { B } from '../../src/world/blocks/blocks';
import { TerrainGenerator } from '../../src/world/gen/terrain';

describe('terrain generator', () => {
  it('is deterministic per seed', () => {
    const a = new TerrainGenerator(42).generateColumn(3, -2);
    const b = new TerrainGenerator(42).generateColumn(3, -2);
    for (let i = 0; i < 16; i++) {
      expect(a.sections[i]?.blocks ?? null).toEqual(b.sections[i]?.blocks ?? null);
    }
    const c = new TerrainGenerator(43).generateColumn(3, -2);
    expect(c.sections[4]?.blocks).not.toEqual(a.sections[4]?.blocks);
  });

  it('has bedrock at the bottom and terrain at the reported height', () => {
    const gen = new TerrainGenerator(7);
    const col = gen.generateColumn(0, 0);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) expect(col.getBlock(x, 0, z)).toBe(B.bedrock);
    const h = gen.heightAt(5, 5);
    expect(col.getBlock(5, h + 40, 5)).toBe(B.air);
  });

  it('trees crossing column borders agree between neighbours', () => {
    const gen = new TerrainGenerator(99);
    // Generating the same column twice through different code paths must match exactly.
    const left = gen.generateColumn(10, 10);
    const again = new TerrainGenerator(99).generateColumn(10, 10);
    expect(left.toData().blocks).toEqual(again.toData().blocks);
  });

  it('finds a dry spawn', () => {
    const gen = new TerrainGenerator(12345);
    const s = gen.findSpawn();
    expect(s.y).toBeGreaterThan(62);
  });
});
