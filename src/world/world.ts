/**
 * The live world on the main thread: loaded columns, block access, light
 * updates, and bookkeeping of which section meshes are out of date.
 */
import { WORLD_HEIGHT } from '../config';
import { B, BLOCKS } from './blocks/blocks';
import { Column, columnKey, FULL_SKY, sectionIndex, sectionKey } from './chunk';
import { LightEngine, type LightWorld } from './light/light';
import { padIndex } from '../render/mesher/mesher';

export class World implements LightWorld {
  readonly columns = new Map<number, Column>();
  readonly light = new LightEngine(BLOCKS);
  /** Section keys whose meshes need rebuilding. */
  readonly dirty = new Set<number>();
  private lastKey = -1;
  private lastCol: Column | undefined;

  constructor(readonly seed: number) {}

  getColumn(cx: number, cz: number): Column | undefined {
    const key = columnKey(cx, cz);
    if (key === this.lastKey) return this.lastCol;
    const col = this.columns.get(key);
    this.lastKey = key;
    this.lastCol = col;
    return col;
  }

  isLoaded(x: number, z: number): boolean {
    return this.getColumn(x >> 4, z >> 4) !== undefined;
  }

  /** Block state or -1 if the column is not loaded. */
  getState(x: number, y: number, z: number): number {
    const col = this.getColumn(x >> 4, z >> 4);
    if (!col) return -1;
    return col.getBlock(x & 15, y, z & 15);
  }

  /** Block state; unloaded positions read as air. */
  getBlock(x: number, y: number, z: number): number {
    const col = this.getColumn(x >> 4, z >> 4);
    return col ? col.getBlock(x & 15, y, z & 15) : B.air;
  }

  getLight(x: number, y: number, z: number): number {
    const col = this.getColumn(x >> 4, z >> 4);
    return col ? col.getLight(x & 15, y, z & 15) : FULL_SKY;
  }

  setLight(x: number, y: number, z: number, packed: number): void {
    const col = this.getColumn(x >> 4, z >> 4);
    if (!col) return;
    col.setLight(x & 15, y, z & 15, packed);
    this.markDirty(x, y, z);
  }

  /**
   * Changes a block and updates light and meshes. Returns false when the
   * position is not loaded.
   */
  setBlock(x: number, y: number, z: number, state: number, byPlayer = true): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const col = this.getColumn(x >> 4, z >> 4);
    if (!col) return false;
    const old = col.getBlock(x & 15, y, z & 15);
    if (old === state) return true;
    col.setBlock(x & 15, y, z & 15, state);
    if (byPlayer) {
      col.modified = true;
      col.unsaved = true;
    }
    this.markDirty(x, y, z);
    const reg = BLOCKS;
    if (reg.opacity[old] !== reg.opacity[state] || reg.emission[old] !== reg.emission[state]) {
      this.light.onBlockChanged(this, x, y, z, state);
    }
    return true;
  }

  /** Marks the section containing a block, plus neighbours touching it. */
  markDirty(x: number, y: number, z: number): void {
    const cx = x >> 4;
    const cz = z >> 4;
    const sy = y >> 4;
    const lx = x & 15;
    const ly = y & 15;
    const lz = z & 15;
    const x0 = lx === 0 ? -1 : 0;
    const x1 = lx === 15 ? 1 : 0;
    const y0 = ly === 0 && sy > 0 ? -1 : 0;
    const y1 = ly === 15 && sy < 15 ? 1 : 0;
    const z0 = lz === 0 ? -1 : 0;
    const z1 = lz === 15 ? 1 : 0;
    for (let dy = y0; dy <= y1; dy++)
      for (let dz = z0; dz <= z1; dz++)
        for (let dx = x0; dx <= x1; dx++) this.dirty.add(sectionKey(cx + dx, sy + dy, cz + dz));
  }

  addColumn(col: Column): void {
    this.columns.set(columnKey(col.cx, col.cz), col);
    this.lastKey = -1;
    // Let light flow across the borders to already loaded neighbours.
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = this.getColumn(col.cx + dx, col.cz + dz);
      if (n) this.light.stitch(this, col, n);
    }
    // This column and the neighbours' border sections need (re)meshing.
    for (let sy = 0; sy < 16; sy++) {
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) this.dirty.add(sectionKey(col.cx + dx, sy, col.cz + dz));
    }
  }

  removeColumn(cx: number, cz: number): Column | undefined {
    const key = columnKey(cx, cz);
    const col = this.columns.get(key);
    this.columns.delete(key);
    this.lastKey = -1;
    return col;
  }

  /** True when a column and all 8 neighbours are loaded (meshes can be built). */
  hasNeighborhood(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        if (!this.columns.has(columnKey(cx + dx, cz + dz))) return false;
    return true;
  }

  /**
   * Copies a section and a one-block border into padded 18³ arrays for the
   * mesher. Returns false if the section is empty (nothing to draw).
   */
  fillMeshInput(
    cx: number,
    sy: number,
    cz: number,
    blocks: Uint16Array,
    light: Uint8Array,
  ): boolean {
    const center = this.getColumn(cx, cz);
    if (!center || !center.sections[sy]) return false;
    const cols: (Column | undefined)[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) cols.push(this.getColumn(cx + dx, cz + dz));
    for (let y = -1; y <= 16; y++) {
      const wy = sy * 16 + y;
      for (let z = -1; z <= 16; z++) {
        const cz3 = z < 0 ? 0 : z > 15 ? 2 : 1;
        const lz = z & 15;
        for (let x = -1; x <= 16; x++) {
          const i = padIndex(x, y, z);
          if (wy < 0) {
            blocks[i] = B.bedrock;
            light[i] = 0;
            continue;
          }
          if (wy >= WORLD_HEIGHT) {
            blocks[i] = B.air;
            light[i] = FULL_SKY;
            continue;
          }
          const col = cols[cz3 * 3 + (x < 0 ? 0 : x > 15 ? 2 : 1)];
          const section = col?.sections[wy >> 4];
          if (!section) {
            blocks[i] = B.air;
            light[i] = FULL_SKY;
            continue;
          }
          const si = sectionIndex(x & 15, wy & 15, lz);
          blocks[i] = section.blocks[si]!;
          light[i] = section.light[si]!;
        }
      }
    }
    return true;
  }
}
