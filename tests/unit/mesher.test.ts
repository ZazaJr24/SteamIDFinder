import { describe, expect, it } from 'vitest';
import { B, BLOCKS } from '../../src/world/blocks/blocks';
import { FULL_SKY } from '../../src/world/chunk';
import { Mesher, padIndex, PAD } from '../../src/render/mesher/mesher';

BLOCKS.resolveTextures(() => 0);

function input() {
  const blocks = new Uint16Array(PAD * PAD * PAD);
  const light = new Uint8Array(PAD * PAD * PAD).fill(FULL_SKY);
  return { blocks, light };
}

const quads = (n: number | undefined) => (n ?? 0) / 4;

describe('mesher', () => {
  const mesher = new Mesher(BLOCKS);

  it('a lone cube has six faces', () => {
    const inp = input();
    inp.blocks[padIndex(5, 5, 5)] = B.stone;
    const mesh = mesher.mesh(inp, { fastLeaves: false });
    expect(quads(mesh.layers[0]?.tex.length)).toBe(6);
  });

  it('a flat uniformly lit floor merges into few quads', () => {
    const inp = input();
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) inp.blocks[padIndex(x, 0, z)] = B.stone;
    // Solid neighbours around so only the top is visible.
    for (let z = -1; z <= 16; z++)
      for (let x = -1; x <= 16; x++) {
        inp.blocks[padIndex(x, -1, z)] = B.stone;
        if (x < 0 || x > 15 || z < 0 || z > 15) inp.blocks[padIndex(x, 0, z)] = B.stone;
      }
    const mesh = mesher.mesh(inp, { fastLeaves: false });
    expect(quads(mesh.layers[0]?.tex.length)).toBe(1);
  });

  it('hidden faces between opaque cubes are culled', () => {
    const inp = input();
    inp.blocks[padIndex(5, 5, 5)] = B.stone;
    inp.blocks[padIndex(6, 5, 5)] = B.stone;
    const mesh = mesher.mesh(inp, { fastLeaves: false });
    // 10 unit faces; ambient occlusion keeps some from merging.
    const n = quads(mesh.layers[0]?.tex.length);
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('plants and torches go to the cutout layer, water to the transparent one', () => {
    const inp = input();
    inp.blocks[padIndex(1, 1, 1)] = B.tallGrass;
    inp.blocks[padIndex(3, 1, 1)] = B.torch;
    inp.blocks[padIndex(8, 1, 8)] = B.water;
    const mesh = mesher.mesh(inp, { fastLeaves: false });
    expect(mesh.layers[0]).toBeNull();
    expect(quads(mesh.layers[1]?.tex.length)).toBe(4 + 6);
    expect(quads(mesh.layers[2]?.tex.length)).toBe(6);
  });
});
