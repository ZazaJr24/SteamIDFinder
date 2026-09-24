import { describe, expect, it } from 'vitest';
import { B, BLOCKS } from '../../src/world/blocks/blocks';
import { Column } from '../../src/world/chunk';
import {
  buildRemap,
  currentPalette,
  decodeColumn,
  encodeColumn,
  MemoryWorldStore,
  paletteHash,
  type WorldMeta,
} from '../../src/world/storage/save';
import { WorldSaver } from '../../src/world/storage/world-saver';

function sampleColumn(): Column {
  const col = new Column(3, -4);
  for (let x = 0; x < 16; x++) col.setBlock(x, 0, 5, B.bedrock);
  col.setBlock(1, 70, 2, B.torch);
  col.setBlock(15, 255, 15, B.glowstone);
  return col;
}

function meta(): WorldMeta {
  return {
    id: 'test',
    name: 'Test',
    seed: 1,
    mode: 'creative',
    created: 0,
    lastPlayed: 0,
    version: 1,
    palettes: {},
    player: null,
    time: 0,
  };
}

describe('save format', () => {
  it('round-trips column blocks', () => {
    const col = sampleColumn();
    const decoded = decodeColumn(3, -4, encodeColumn(col.toData()), null);
    const back = Column.fromData(decoded);
    expect(back.getBlock(1, 70, 2)).toBe(B.torch);
    expect(back.getBlock(15, 255, 15)).toBe(B.glowstone);
    expect(back.getBlock(7, 0, 5)).toBe(B.bedrock);
    expect(back.getBlock(7, 1, 5)).toBe(B.air);
    // Empty sections stay empty.
    expect(back.sections[8]).toBeNull();
  });

  it('remaps states when the palette changed', () => {
    const palette = currentPalette(BLOCKS);
    expect(buildRemap(BLOCKS, palette)).toBeNull();
    // Pretend an old version had torch and glowstone swapped and a removed block.
    const old = [...palette];
    old[B.torch] = BLOCKS.stateName(B.glowstone);
    old[B.glowstone] = BLOCKS.stateName(B.torch);
    old.push('removed_block');
    const remap = buildRemap(BLOCKS, old)!;
    expect(remap[B.torch]).toBe(B.glowstone);
    expect(remap[B.glowstone]).toBe(B.torch);
    expect(remap[old.length - 1]).toBe(0);
  });

  it('palette hashes differ for different palettes', () => {
    const p = currentPalette(BLOCKS);
    expect(paletteHash(p)).toBe(paletteHash([...p]));
    expect(paletteHash(p)).not.toBe(paletteHash(p.slice(1)));
  });
});

describe('WorldSaver', () => {
  it('keeps unloaded changes until flushed and reads them back', async () => {
    const store = new MemoryWorldStore();
    const saver = new WorldSaver(store, meta());
    const col = sampleColumn();
    col.unsaved = true;
    saver.unload(col);
    expect(col.unsaved).toBe(false);
    // Readable before the flush (from the pending buffer)…
    expect((await saver.load(3, -4))?.blocks[4]).toBeTruthy();
    await saver.flush([]);
    // …and after it, from the store, by a fresh saver.
    const again = new WorldSaver(store, (await store.listWorlds())[0]!);
    const data = await again.load(3, -4);
    expect(Column.fromData(data!).getBlock(1, 70, 2)).toBe(B.torch);
    expect(await again.load(0, 0)).toBeNull();
  });
});
