import { unzlibSync, zlibSync } from 'fflate';

export type RGBA = readonly [number, number, number, number];

/** A small RGBA bitmap (usually 16×16). */
export class Tile {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly width = 16,
    readonly height = 16,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  static from(width: number, height: number, data: Uint8Array | Uint8ClampedArray): Tile {
    const t = new Tile(width, height);
    t.data.set(data);
    return t;
  }

  private index(x: number, y: number): number {
    const w = this.width;
    const h = this.height;
    // Wrap around, so every drawing helper tiles seamlessly.
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return (wy * w + wx) * 4;
  }

  get(x: number, y: number): RGBA {
    const i = this.index(x, y);
    const d = this.data;
    return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
  }

  set(x: number, y: number, c: RGBA): void {
    const i = this.index(x, y);
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  /** Alpha-composites `c` (with extra opacity `amount`) over the pixel. */
  blend(x: number, y: number, c: RGBA, amount = 1): void {
    const a = (c[3] / 255) * amount;
    if (a <= 0) return;
    const [r, g, b, da] = this.get(x, y);
    const outA = a + (da / 255) * (1 - a);
    if (outA <= 0) return;
    const mix = (s: number, d: number) => (s * a + d * (da / 255) * (1 - a)) / outA;
    this.set(x, y, [mix(c[0], r), mix(c[1], g), mix(c[2], b), outA * 255]);
  }

  fill(c: RGBA): this {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) this.set(x, y, c);
    return this;
  }

  forEach(fn: (x: number, y: number) => void): void {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) fn(x, y);
  }

  map(fn: (x: number, y: number, c: RGBA) => RGBA): this {
    this.forEach((x, y) => this.set(x, y, fn(x, y, this.get(x, y))));
    return this;
  }

  clone(): Tile {
    return Tile.from(this.width, this.height, this.data);
  }

  /** Draws `src` over this tile at an offset (alpha blended). */
  draw(src: Tile, ox = 0, oy = 0): this {
    src.forEach((x, y) => this.blend(x + ox, y + oy, src.get(x, y)));
    return this;
  }

  /** Copies without blending (for atlas assembly). */
  blit(src: Tile, ox: number, oy: number): void {
    for (let y = 0; y < src.height; y++) {
      const row = src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4);
      this.data.set(row, ((oy + y) * this.width + ox) * 4);
    }
  }

  flipX(): Tile {
    const t = new Tile(this.width, this.height);
    this.forEach((x, y) => t.set(this.width - 1 - x, y, this.get(x, y)));
    return t;
  }

  rotate90(): Tile {
    const t = new Tile(this.height, this.width);
    this.forEach((x, y) => t.set(this.height - 1 - y, x, this.get(x, y)));
    return t;
  }
}

// ---------------------------------------------------------------- PNG codec

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function encodePng(tile: Tile): Uint8Array {
  const { width, height } = tile;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(tile.data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Decodes 8-bit, non-interlaced PNGs (gray, RGB, palette, gray+alpha, RGBA). */
export function decodePng(bytes: Uint8Array): Tile {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos < bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const depth = data[8];
      colorType = data[9]!;
      if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth} (save as 8-bit)`);
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const compressed = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let o = 0;
  for (const d of idat) {
    compressed.set(d, o);
    o += d.length;
  }
  const raw = unzlibSync(compressed);
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= channels ? prev[i - channels]! : 0;
      let value = src[i]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = value & 0xff;
    }
  }
  const tile = new Tile(width, height);
  for (let i = 0; i < width * height; i++) {
    const p = pixels.subarray(i * channels, i * channels + channels);
    let rgba: [number, number, number, number];
    switch (colorType) {
      case 0:
        rgba = [p[0]!, p[0]!, p[0]!, 255];
        break;
      case 2:
        rgba = [p[0]!, p[1]!, p[2]!, 255];
        break;
      case 3: {
        const k = p[0]!;
        if (!palette) throw new Error('palette PNG without PLTE');
        rgba = [palette[k * 3]!, palette[k * 3 + 1]!, palette[k * 3 + 2]!, trns?.[k] ?? 255];
        break;
      }
      case 4:
        rgba = [p[0]!, p[0]!, p[0]!, p[1]!];
        break;
      default:
        rgba = [p[0]!, p[1]!, p[2]!, p[3]!];
    }
    tile.data.set(rgba, i * 4);
  }
  return tile;
}
