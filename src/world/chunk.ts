import { CHUNK_SIZE, SECTION_VOLUME, SECTIONS_PER_COLUMN, WORLD_HEIGHT } from '../config';

/** Packed light byte: high nibble = sky light, low nibble = block light. */
export const FULL_SKY = 0xf0;

/** Index of a block inside a 16³ section. */
export function sectionIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

/** One 16×16×16 cube of blocks plus its light. */
export class Section {
  readonly blocks: Uint16Array;
  readonly light: Uint8Array;

  constructor(blocks?: Uint16Array, light?: Uint8Array) {
    this.blocks = blocks ?? new Uint16Array(SECTION_VOLUME);
    this.light = light ?? new Uint8Array(SECTION_VOLUME).fill(FULL_SKY);
  }

  isEmpty(): boolean {
    const b = this.blocks;
    for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
    return true;
  }
}

/** Plain data sent between workers and the main thread. */
export interface ColumnData {
  cx: number;
  cz: number;
  /** Per section: block states or null for an all-air section. */
  blocks: (Uint16Array | null)[];
  /** Per section: packed light or null (meaning full sky light, no block light). */
  light: (Uint8Array | null)[];
}

/**
 * A 16×256×16 column of sections. A `null` section is all air with full sky
 * light; it is allocated the first time anything non-default is written.
 */
export class Column {
  readonly sections: (Section | null)[] = new Array<Section | null>(SECTIONS_PER_COLUMN).fill(null);
  /** Changed by the player since load (needs saving). */
  modified = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {}

  static fromData(data: ColumnData): Column {
    const col = new Column(data.cx, data.cz);
    for (let i = 0; i < SECTIONS_PER_COLUMN; i++) {
      const blocks = data.blocks[i];
      const light = data.light[i];
      if (blocks || light) col.sections[i] = new Section(blocks ?? undefined, light ?? undefined);
    }
    return col;
  }

  toData(): ColumnData {
    return {
      cx: this.cx,
      cz: this.cz,
      blocks: this.sections.map((s) => (s ? s.blocks : null)),
      light: this.sections.map((s) => (s ? s.light : null)),
    };
  }

  private ensure(sy: number): Section {
    let s = this.sections[sy];
    if (!s) {
      s = new Section();
      this.sections[sy] = s;
    }
    return s;
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const s = this.sections[y >> 4];
    return s ? s.blocks[sectionIndex(x, y & 15, z)]! : 0;
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const s = this.sections[y >> 4];
    if (!s && state === 0) return;
    (s ?? this.ensure(y >> 4)).blocks[sectionIndex(x, y & 15, z)] = state;
  }

  getLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return FULL_SKY;
    if (y < 0) return 0;
    const s = this.sections[y >> 4];
    return s ? s.light[sectionIndex(x, y & 15, z)]! : FULL_SKY;
  }

  setLight(x: number, y: number, z: number, packed: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const s = this.sections[y >> 4];
    if (!s && packed === FULL_SKY) return;
    (s ?? this.ensure(y >> 4)).light[sectionIndex(x, y & 15, z)] = packed;
  }

  /** Highest y containing a non-air block, or -1. */
  topY(): number {
    for (let sy = SECTIONS_PER_COLUMN - 1; sy >= 0; sy--) {
      const s = this.sections[sy];
      if (!s) continue;
      for (let i = SECTION_VOLUME - 1; i >= 0; i--)
        if (s.blocks[i] !== 0) return sy * CHUNK_SIZE + (i >> 8);
    }
    return -1;
  }
}

/** Numeric key for a column position (fits in a double exactly). */
export function columnKey(cx: number, cz: number): number {
  return (cx + 0x8000) * 0x10000 + (cz + 0x8000);
}

export function sectionKey(cx: number, sy: number, cz: number): number {
  return columnKey(cx, cz) * 32 + sy;
}
