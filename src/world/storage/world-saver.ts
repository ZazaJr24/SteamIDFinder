/**
 * Connects one open world to the save store: supplies saved columns to the
 * chunk manager, keeps unloaded changes until they are written, and flushes
 * everything on autosave.
 */
import { BLOCKS } from '../blocks/blocks';
import type { Column, ColumnData } from '../chunk';
import type { ChunkSource } from '../chunk-manager';
import {
  buildRemap,
  currentPalette,
  decodeColumn,
  encodeColumn,
  paletteHash,
  type ChunkRecord,
  type WorldMeta,
  type WorldStore,
} from './save';

export class WorldSaver implements ChunkSource {
  /** Encoded columns that were unloaded but are not written yet. */
  private readonly pending = new Map<string, { cx: number; cz: number; record: ChunkRecord }>();
  private readonly remaps = new Map<string, Uint16Array | null>();
  private readonly paletteId: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    readonly store: WorldStore,
    readonly meta: WorldMeta,
  ) {
    const palette = currentPalette(BLOCKS);
    this.paletteId = paletteHash(palette);
    meta.palettes[this.paletteId] = palette;
    this.remaps.set(this.paletteId, null);
  }

  async load(cx: number, cz: number): Promise<ColumnData | null> {
    const key = `${cx},${cz}`;
    const record =
      this.pending.get(key)?.record ?? (await this.store.loadChunk(this.meta.id, cx, cz));
    if (!record) return null;
    return decodeColumn(cx, cz, record.d, this.remapFor(record.p));
  }

  unload(col: Column): void {
    if (!col.unsaved) return;
    this.pending.set(`${col.cx},${col.cz}`, { cx: col.cx, cz: col.cz, record: this.encode(col) });
    col.unsaved = false;
  }

  /** Writes every unsaved column (loaded or pending) plus the metadata. */
  flush(loaded: Iterable<Column>): Promise<void> {
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const col of loaded) {
      if (!col.unsaved) continue;
      batch.push({ cx: col.cx, cz: col.cz, record: this.encode(col) });
      col.unsaved = false;
    }
    const meta = structuredClone(this.meta);
    // Serialize writes so an older flush can never overwrite a newer one.
    this.writing = this.writing
      .then(async () => {
        await this.store.saveChunks(meta.id, batch);
        await this.store.saveMeta(meta);
      })
      .catch((error: unknown) => {
        console.error('[save] failed', error);
        // Keep the data so the next flush retries.
        for (const c of batch)
          if (!this.pending.has(`${c.cx},${c.cz}`)) this.pending.set(`${c.cx},${c.cz}`, c);
      });
    return this.writing;
  }

  private encode(col: Column): ChunkRecord {
    return { p: this.paletteId, d: encodeColumn(col.toData()) };
  }

  private remapFor(id: string): Uint16Array | null {
    if (this.remaps.has(id)) return this.remaps.get(id)!;
    const palette = this.meta.palettes[id];
    const remap = palette ? buildRemap(BLOCKS, palette) : null;
    this.remaps.set(id, remap);
    return remap;
  }
}
