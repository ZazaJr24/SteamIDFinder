/**
 * World saves in IndexedDB.
 *
 * - `worlds`: one record of metadata per world (name, seed, player, …).
 * - `chunks`: the block data of every column the player changed, deflated.
 *
 * Block states are stored by numeric id together with a palette of state
 * names in the world metadata, so saves survive new blocks being added.
 * Light is not saved; it is recomputed on load.
 */
import { deflateSync, inflateSync } from 'fflate';
import { SECTION_VOLUME, SECTIONS_PER_COLUMN } from '../../config';
import type { GameMode } from '../../entity/player';
import type { BlockRegistry } from '../blocks/registry';
import type { ColumnData } from '../chunk';

export const SAVE_VERSION = 1;

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
}

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  mode: GameMode;
  created: number;
  lastPlayed: number;
  version: number;
  /**
   * Block state palettes (state names by numeric id) keyed by their hash.
   * Every saved chunk records the palette it was written with.
   */
  palettes: Record<string, string[]>;
  player: PlayerSave | null;
  /** Time of day in ticks. */
  time: number;
  /** Hotbar contents as state names. */
  hotbar?: (string | null)[];
  /** Free-form extra data for later milestones (inventory, stats, …). */
  extra?: Record<string, unknown>;
}

/** A saved column: deflated block data plus the hash of its palette. */
export interface ChunkRecord {
  p: string;
  d: Uint8Array;
}

export interface WorldStore {
  listWorlds(): Promise<WorldMeta[]>;
  saveMeta(meta: WorldMeta): Promise<void>;
  loadChunk(worldId: string, cx: number, cz: number): Promise<ChunkRecord | null>;
  saveChunks(
    worldId: string,
    chunks: { cx: number; cz: number; record: ChunkRecord }[],
  ): Promise<void>;
  deleteWorld(worldId: string): Promise<void>;
  /** False when saves only live in memory (IndexedDB unavailable). */
  readonly persistent: boolean;
}

const chunkKey = (worldId: string, cx: number, cz: number) => `${worldId}:${cx},${cz}`;

// ------------------------------------------------------------- encoding

/** Encodes the blocks of a column (light is dropped). */
export function encodeColumn(data: ColumnData): Uint8Array {
  let mask = 0;
  const parts: Uint16Array[] = [];
  data.blocks.forEach((b, i) => {
    if (b && b.some((v) => v !== 0)) {
      mask |= 1 << i;
      parts.push(b);
    }
  });
  const raw = new Uint8Array(2 + parts.length * SECTION_VOLUME * 2);
  const view = new DataView(raw.buffer);
  view.setUint16(0, mask, true);
  let o = 2;
  for (const p of parts) {
    for (let i = 0; i < SECTION_VOLUME; i++, o += 2) view.setUint16(o, p[i]!, true);
  }
  return deflateSync(raw, { level: 6 });
}

/** Decodes blocks, remapping old state ids through `remap` when given. */
export function decodeColumn(
  cx: number,
  cz: number,
  bytes: Uint8Array,
  remap: Uint16Array | null,
): ColumnData {
  const raw = inflateSync(bytes);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const mask = view.getUint16(0, true);
  const blocks: (Uint16Array | null)[] = [];
  let o = 2;
  for (let i = 0; i < SECTIONS_PER_COLUMN; i++) {
    if (!(mask & (1 << i))) {
      blocks.push(null);
      continue;
    }
    const b = new Uint16Array(SECTION_VOLUME);
    for (let k = 0; k < SECTION_VOLUME; k++, o += 2) {
      const v = view.getUint16(o, true);
      b[k] = remap ? (remap[v] ?? 0) : v;
    }
    blocks.push(b);
  }
  return { cx, cz, blocks, light: blocks.map(() => null) };
}

export function currentPalette(reg: BlockRegistry): string[] {
  const out: string[] = [];
  for (let s = 0; s < reg.stateCount; s++) out.push(reg.stateName(s));
  return out;
}

/** Short stable hash of a palette (FNV-1a over all names). */
export function paletteHash(palette: string[]): string {
  let h = 0x811c9dc5;
  for (const name of palette) {
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x7c, 0x01000193);
  }
  return (h >>> 0).toString(36) + palette.length.toString(36);
}

/** Maps saved state ids to current ones; null when nothing changed. */
export function buildRemap(reg: BlockRegistry, palette: string[]): Uint16Array | null {
  const current = currentPalette(reg);
  if (palette.length === current.length && palette.every((n, i) => n === current[i])) return null;
  const remap = new Uint16Array(palette.length);
  palette.forEach((name, i) => {
    const s = reg.stateFromName(name);
    remap[i] = s < 0 ? 0 : s;
  });
  return remap;
}

// ------------------------------------------------------------ IndexedDB

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IdbWorldStore implements WorldStore {
  readonly persistent = true;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = 'cubecraft-legends'): Promise<IdbWorldStore> {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds'))
        db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
    };
    return new IdbWorldStore(await request(req));
  }

  async listWorlds(): Promise<WorldMeta[]> {
    const tx = this.db.transaction('worlds', 'readonly');
    const all = await request(tx.objectStore('worlds').getAll() as IDBRequest<WorldMeta[]>);
    return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async saveMeta(meta: WorldMeta): Promise<void> {
    const tx = this.db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(meta);
    await done(tx);
  }

  async loadChunk(worldId: string, cx: number, cz: number): Promise<ChunkRecord | null> {
    const tx = this.db.transaction('chunks', 'readonly');
    const v = await request(
      tx.objectStore('chunks').get(chunkKey(worldId, cx, cz)) as IDBRequest<
        ChunkRecord | undefined
      >,
    );
    return v ?? null;
  }

  async saveChunks(
    worldId: string,
    chunks: { cx: number; cz: number; record: ChunkRecord }[],
  ): Promise<void> {
    if (chunks.length === 0) return;
    const tx = this.db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    for (const c of chunks) store.put(c.record, chunkKey(worldId, c.cx, c.cz));
    await done(tx);
  }

  async deleteWorld(worldId: string): Promise<void> {
    const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(worldId);
    tx.objectStore('chunks').delete(IDBKeyRange.bound(`${worldId}:`, `${worldId}:￿`));
    await done(tx);
  }
}

/** Fallback when IndexedDB is blocked (some private modes): saves last for the session. */
export class MemoryWorldStore implements WorldStore {
  readonly persistent = false;
  private readonly worlds = new Map<string, WorldMeta>();
  private readonly chunks = new Map<string, ChunkRecord>();

  async listWorlds(): Promise<WorldMeta[]> {
    return [...this.worlds.values()].sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async saveMeta(meta: WorldMeta): Promise<void> {
    this.worlds.set(meta.id, structuredClone(meta));
  }

  async loadChunk(worldId: string, cx: number, cz: number): Promise<ChunkRecord | null> {
    return this.chunks.get(chunkKey(worldId, cx, cz)) ?? null;
  }

  async saveChunks(
    worldId: string,
    chunks: { cx: number; cz: number; record: ChunkRecord }[],
  ): Promise<void> {
    for (const c of chunks) this.chunks.set(chunkKey(worldId, c.cx, c.cz), c.record);
  }

  async deleteWorld(worldId: string): Promise<void> {
    this.worlds.delete(worldId);
    for (const key of [...this.chunks.keys()])
      if (key.startsWith(`${worldId}:`)) this.chunks.delete(key);
  }
}

export async function openWorldStore(): Promise<WorldStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
    return await Promise.race([
      IdbWorldStore.open(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('IndexedDB timeout')), 3000),
      ),
    ]);
  } catch (error) {
    console.warn('[save] IndexedDB unavailable, worlds will not persist.', error);
    return new MemoryWorldStore();
  }
}

export function newWorldId(): string {
  return `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
