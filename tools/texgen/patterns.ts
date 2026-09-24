/**
 * Reusable pixel-art building blocks. Every function is deterministic for a
 * given `Random`, and every result tiles seamlessly.
 */
import type { Random } from '../../src/core/random';
import { adjust, hex, mix, pick, ramp, shade, withAlpha } from './color';
import { Tile, type RGBA } from './image';
import { contrast, fbm, PeriodicNoise, PeriodicVoronoi } from './noise';

export const CLEAR: RGBA = [0, 0, 0, 0];

// ------------------------------------------------------------------ fills

export interface NoisyOptions {
  /** Lattice cells for the octaves, coarse → fine. */
  cells?: number[];
  contrast?: number;
  /** Fraction of pixels replaced by a random lighter/darker palette entry. */
  speckle?: number;
}

export function noisy(rng: Random, palette: readonly RGBA[], opts: NoisyOptions = {}): Tile {
  const cells = opts.cells ?? [4, 8, 16];
  const n = fbm(
    rng,
    cells.map((c, i) => ({ cells: c, weight: 1 / (i + 1) })),
  );
  const t = new Tile();
  const k = opts.contrast ?? 1.8;
  t.forEach((x, y) => t.set(x, y, pick(palette, contrast(n(x, y), k))));
  if (opts.speckle) speckle(t, rng, palette, opts.speckle);
  return t;
}

/** Replaces random pixels with a palette neighbour for grainy detail. */
export function speckle(t: Tile, rng: Random, palette: readonly RGBA[], amount: number): Tile {
  t.forEach((x, y) => {
    if (!rng.chance(amount)) return;
    const c = t.get(x, y);
    let i = palette.findIndex((p) => p[0] === c[0] && p[1] === c[1] && p[2] === c[2]);
    if (i < 0) i = Math.floor(palette.length / 2);
    i = Math.min(palette.length - 1, Math.max(0, i + (rng.chance(0.5) ? 1 : -1)));
    t.set(x, y, palette[i]!);
  });
  return t;
}

// ----------------------------------------------------------------- ground

export function stone(rng: Random, palette: readonly RGBA[]): Tile {
  const t = noisy(rng, palette, { cells: [2, 4, 8, 16], contrast: 2.2, speckle: 0.06 });
  // A few short dark fissures give the classic rocky look.
  for (let i = 0; i < 3; i++) {
    let x = rng.int(16);
    let y = rng.int(16);
    const len = 2 + rng.int(3);
    for (let s = 0; s < len; s++) {
      t.set(x, y, palette[0]!);
      x += rng.chance(0.6) ? 1 : 0;
      y += rng.chance(0.5) ? 1 : -1;
    }
  }
  return t;
}

export function dirt(rng: Random, palette: readonly RGBA[]): Tile {
  const t = noisy(rng, palette, { cells: [4, 8, 16], contrast: 1.7 });
  // Pebbles: small light spots with a dark shadow under them.
  for (let i = 0; i < 7; i++) {
    const x = rng.int(16);
    const y = rng.int(16);
    t.set(x, y, palette[palette.length - 1]!);
    t.set(x, y + 1, palette[0]!);
  }
  return t;
}

export function sand(rng: Random, palette: readonly RGBA[]): Tile {
  const t = noisy(rng, palette, { cells: [4, 16], contrast: 1.3, speckle: 0.12 });
  return t;
}

export function grassTop(rng: Random, palette: readonly RGBA[]): Tile {
  const t = noisy(rng, palette, { cells: [4, 8, 16], contrast: 1.6, speckle: 0.15 });
  // Bright blade tips.
  for (let i = 0; i < 14; i++) t.set(rng.int(16), rng.int(16), palette[palette.length - 1]!);
  return t;
}

/** Side of a grass-like block: `base` below, `top` hanging down with ragged edge. */
export function overhangSide(rng: Random, base: Tile, top: Tile, minDepth = 2, maxExtra = 3): Tile {
  const t = base.clone();
  for (let x = 0; x < 16; x++) {
    let depth = minDepth + rng.int(maxExtra);
    if (rng.chance(0.18)) depth += 2; // occasional long drip
    for (let y = 0; y < depth; y++) t.set(x, y, top.get(x, y + 5));
    // Soft shadow line under the overhang.
    const under = t.get(x, depth);
    t.set(x, depth, shade(under, 0.78));
  }
  // Highlight the very top edge.
  for (let x = 0; x < 16; x++) t.set(x, 0, adjust(t.get(x, 0), 0, 0, 0.05));
  return t;
}

export function gravel(rng: Random, palette: readonly RGBA[]): Tile {
  const v = new PeriodicVoronoi(rng, 6, 16, 0.9);
  const colors = Array.from({ length: 36 }, () => rng.int(palette.length - 1) + 1);
  const t = new Tile();
  t.forEach((x, y) => {
    const c = v.sample(x, y);
    if (c.d2 - c.d1 < 0.7) {
      t.set(x, y, palette[0]!);
      return;
    }
    const base = colors[c.id]!;
    // Light from the top-left: pixels up-left of the pebble center get a highlight.
    const lit = x < c.cx && y < c.cy && c.d1 > 0.8 ? 1 : 0;
    t.set(x, y, palette[Math.min(palette.length - 1, base + lit)]!);
  });
  return t;
}

export function cobble(rng: Random, palette: readonly RGBA[], cells = 4): Tile {
  const v = new PeriodicVoronoi(rng, cells, 16, 0.85);
  const detail = fbm(rng, [
    { cells: 8, weight: 1 },
    { cells: 16, weight: 0.5 },
  ]);
  const tone = Array.from({ length: cells * cells }, () => rng.range(-0.18, 0.18));
  const t = new Tile();
  t.forEach((x, y) => {
    const c = v.sample(x, y);
    const edge = c.d2 - c.d1;
    if (edge < 1.1) {
      t.set(x, y, palette[0]!);
      return;
    }
    let value = 0.55 + tone[c.id]! + (detail(x, y) - 0.5) * 0.5;
    // Bevel: brighter toward the upper-left of each stone, darker bottom-right.
    const dx = x + 0.5 - c.cx;
    const dy = y + 0.5 - c.cy;
    value -= (dx + dy) * 0.045;
    if (edge < 1.9) value -= 0.18;
    t.set(x, y, pick(palette.slice(1), value));
  });
  return t;
}

export function bedrock(rng: Random): Tile {
  const palette = [hex('#1c1c1f'), hex('#2e2e33'), hex('#48484f'), hex('#6a6a72'), hex('#8e8e96')];
  return noisy(rng, palette, { cells: [4, 8, 16], contrast: 2.6, speckle: 0.1 });
}

// ----------------------------------------------------------------- bricks

export interface BrickOptions {
  rowHeight: number;
  brickWidth: number;
  mortar: RGBA;
  /** Horizontal offset of odd rows. */
  offset?: number;
  /** Per-brick tone variation. */
  variation?: number;
  bevel?: boolean;
}

export function bricks(rng: Random, palette: readonly RGBA[], o: BrickOptions): Tile {
  const detail = fbm(rng, [
    { cells: 8, weight: 1 },
    { cells: 16, weight: 0.6 },
  ]);
  const rows = 16 / o.rowHeight;
  const perRow = 16 / o.brickWidth;
  const tones = Array.from(
    { length: rows * perRow },
    () => rng.range(-1, 1) * (o.variation ?? 0.15),
  );
  const offset = o.offset ?? o.brickWidth / 2;
  const t = new Tile();
  t.forEach((x, y) => {
    const row = Math.floor(y / o.rowHeight);
    const ly = y % o.rowHeight;
    const sx = (x + (row % 2 ? offset : 0)) % 16;
    const col = Math.floor(sx / o.brickWidth);
    const lx = sx % o.brickWidth;
    if (ly === o.rowHeight - 1 || lx === o.brickWidth - 1) {
      t.set(x, y, o.mortar);
      return;
    }
    let v = 0.5 + tones[row * perRow + col]! + (detail(x, y) - 0.5) * 0.6;
    if (o.bevel !== false) {
      if (ly === 0 || lx === 0) v += 0.22;
      if (ly === o.rowHeight - 2 || lx === o.brickWidth - 2) v -= 0.22;
    }
    t.set(x, y, pick(palette, v));
  });
  return t;
}

// ------------------------------------------------------------------- wood

export function planks(rng: Random, palette: readonly RGBA[]): Tile {
  const grain = fbm(rng, [
    { cells: 2, cellsY: 16, weight: 1 },
    { cells: 4, cellsY: 16, weight: 0.5 },
  ]);
  const t = new Tile();
  const seams = [rng.int(16), rng.int(16), rng.int(16), rng.int(16)];
  t.forEach((x, y) => {
    const board = Math.floor(y / 4);
    const ly = y % 4;
    if (ly === 3) {
      t.set(x, y, palette[0]!);
      return;
    }
    if (x === seams[board]) {
      t.set(x, y, palette[1]!);
      return;
    }
    let v = 0.35 + grain(x, y + board * 3) * 0.55;
    if (ly === 0) v += 0.12;
    t.set(x, y, pick(palette.slice(1), v));
  });
  // Nail holes / knots.
  for (let i = 0; i < 2; i++) t.set(rng.int(16), rng.int(4) * 4 + 1, palette[1]!);
  return t;
}

export function barkSide(rng: Random, palette: readonly RGBA[]): Tile {
  const n = fbm(rng, [
    { cells: 8, cellsY: 2, weight: 1 },
    { cells: 16, cellsY: 4, weight: 0.5 },
  ]);
  const t = new Tile();
  t.forEach((x, y) => {
    const v = contrast(n(x, y), 1.6);
    t.set(x, y, pick(palette, v));
  });
  // Vertical grooves.
  for (let i = 0; i < 4; i++) {
    const x = rng.int(16);
    const y0 = rng.int(16);
    const len = 3 + rng.int(6);
    for (let s = 0; s < len; s++) t.set(x, y0 + s, palette[1]!);
  }
  return t;
}

export function logTop(rng: Random, wood: readonly RGBA[], bark: readonly RGBA[]): Tile {
  const wobble = new PeriodicNoise(rng, 4);
  const t = new Tile();
  t.forEach((x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const r = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.hypot(dx, dy) * 0.45;
    if (r > 6.9) {
      t.set(x, y, pick(bark, 0.3 + wobble.sample(x, y) * 0.6));
      return;
    }
    const ring = Math.floor(r + wobble.sample(x, y) * 0.8);
    const base = ring % 2 === 0 ? 0.65 : 0.4;
    t.set(x, y, pick(wood, base + (wobble.sample(y, x) - 0.5) * 0.2));
  });
  return t;
}

export function leaves(rng: Random, palette: readonly RGBA[], holes = 0.16): Tile {
  const n = fbm(rng, [
    { cells: 4, weight: 1 },
    { cells: 8, weight: 0.8 },
    { cells: 16, weight: 0.5 },
  ]);
  const t = new Tile();
  t.forEach((x, y) => {
    if (rng.chance(holes)) {
      t.set(x, y, CLEAR);
      return;
    }
    t.set(x, y, pick(palette, contrast(n(x, y), 2)));
  });
  // Leaf clusters: a highlight with a shadow underneath.
  for (let i = 0; i < 10; i++) {
    const x = rng.int(16);
    const y = rng.int(16);
    t.set(x, y, palette[palette.length - 1]!);
    if (t.get(x, y + 1)[3] > 0) t.set(x, y + 1, palette[0]!);
  }
  return t;
}

// -------------------------------------------------------------- minerals

export function ore(rng: Random, base: Tile, gem: readonly RGBA[], clusters = 4, size = 4): Tile {
  const t = base.clone();
  const taken = new Set<number>();
  for (let c = 0; c < clusters; c++) {
    // Blob: pixels within an irregular radius around a random center.
    const cx = rng.int(16);
    const cy = rng.int(16);
    const r = 0.9 + (size - 3) * 0.35 + rng.next() * 0.6;
    const blob: [number, number][] = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.hypot(dx * 1.1, dy) > r + (rng.next() - 0.5) * 0.8) continue;
        const x = (cx + dx + 16) % 16;
        const y = (cy + dy + 16) % 16;
        if (taken.has(y * 16 + x)) continue;
        blob.push([dx, dy]);
      }
    const inBlob = (dx: number, dy: number) => blob.some(([bx, by]) => bx === dx && by === dy);
    // Shadow pixels below/right of the blob, then the gem shaded top-left → bottom-right.
    for (const [dx, dy] of blob) {
      if (!inBlob(dx + 1, dy + 1)) t.set(cx + dx + 1, cy + dy + 1, gem[0]!);
    }
    for (const [dx, dy] of blob) {
      const light = -(dx + dy) * 0.2 + (rng.next() - 0.5) * 0.3;
      const i = Math.min(gem.length - 2, Math.max(1, Math.round((gem.length - 1) / 2 + light * 2)));
      t.set(cx + dx, cy + dy, gem[i]!);
      taken.add(((cy + dy + 16) % 16) * 16 + ((cx + dx + 16) % 16));
    }
    const top = blob.reduce((a, b) => (b[0] + b[1] < a[0] + a[1] ? b : a), blob[0] ?? [0, 0]);
    t.set(cx + top[0], cy + top[1], gem[gem.length - 1]!);
  }
  return t;
}

/** Solid metal/gem storage block: bevelled plate with a sheen. */
export function metalBlock(rng: Random, palette: readonly RGBA[]): Tile {
  const n = fbm(rng, [
    { cells: 4, weight: 1 },
    { cells: 16, weight: 0.3 },
  ]);
  const t = new Tile();
  t.forEach((x, y) => {
    let v = 0.45 + (n(x, y) - 0.5) * 0.3 + (15 - x - y) * 0.012;
    if (x === 0 || y === 0) v = 0.95;
    if (x === 15 || y === 15) v = 0.05;
    if (x === 1 || y === 1) v += 0.15;
    if ((x + y) % 11 === 0 && x > 2 && y > 2 && x < 13 && y < 13) v += 0.2;
    t.set(x, y, pick(palette, v));
  });
  return t;
}

// ------------------------------------------------------------ transparent

export function glass(rng: Random, frame: RGBA, glint: RGBA): Tile {
  const t = new Tile().fill(CLEAR);
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, frame);
    t.set(0, i, frame);
    t.set(i, 15, shade(frame, 0.8));
    t.set(15, i, shade(frame, 0.8));
  }
  // Diagonal glints.
  const s = 3 + rng.int(3);
  for (let i = 0; i < 4; i++) t.set(s + i, 10 - i, glint);
  for (let i = 0; i < 2; i++) t.set(s + 5 + i, 9 - i, glint);
  return t;
}

export function ice(rng: Random): Tile {
  const palette = ramp('#8fb8f0', 5, 0.25).map((c) => withAlpha(c, 200));
  const t = noisy(rng, palette, { cells: [2, 4, 8], contrast: 1.4 });
  // Bright crack lines.
  for (let i = 0; i < 3; i++) {
    let x = rng.int(16);
    let y = rng.int(16);
    for (let s = 0; s < 6; s++) {
      t.set(x, y, withAlpha(hex('#e8f4ff'), 230));
      x += 1;
      y += rng.chance(0.5) ? 1 : 0;
    }
  }
  return t;
}

// -------------------------------------------------------------- animated

/**
 * Seamless looping animation: two noise fields scroll in different directions
 * by exactly one period over `frames` frames.
 */
export function flowing(
  rng: Random,
  palette: readonly RGBA[],
  frames: number,
  opts: { cells?: number; contrast?: number; alpha?: number } = {},
): Tile[] {
  const a = new PeriodicNoise(rng, opts.cells ?? 4);
  const b = new PeriodicNoise(rng, (opts.cells ?? 4) * 2);
  const out: Tile[] = [];
  for (let f = 0; f < frames; f++) {
    const shift = (f / frames) * 16;
    const t = new Tile();
    t.forEach((x, y) => {
      const v = (a.sample(x + shift, y) * 0.6 + b.sample(x, y - shift) * 0.4) as number;
      const c = pick(palette, contrast(v, opts.contrast ?? 1.8));
      t.set(x, y, opts.alpha === undefined ? c : withAlpha(c, opts.alpha));
    });
    out.push(t);
  }
  return out;
}

// ----------------------------------------------------------------- plants

export function tallGrass(rng: Random, palette: readonly RGBA[], blades = 9, maxHeight = 13): Tile {
  const t = new Tile().fill(CLEAR);
  for (let i = 0; i < blades; i++) {
    let x = 1 + rng.int(14);
    const h = 5 + rng.int(maxHeight - 5);
    const lean = rng.chance(0.5) ? 1 : -1;
    for (let s = 0; s < h; s++) {
      const y = 15 - s;
      const v = s / h;
      t.set(x, y, pick(palette, 0.2 + v * 0.8));
      if (s > h * 0.5 && rng.chance(0.3)) x += lean;
      x = Math.max(0, Math.min(15, x));
    }
  }
  return t;
}

export interface FlowerOptions {
  petals: readonly RGBA[];
  center: RGBA;
  stem?: RGBA;
  /** Height of the flower head's center row. */
  headY?: number;
  shape?: 'round' | 'cross' | 'tall' | 'bell';
}

export function flower(rng: Random, o: FlowerOptions): Tile {
  const t = new Tile().fill(CLEAR);
  const stem = o.stem ?? hex('#3f8f2a');
  const headY = o.headY ?? 6;
  const cx = 7 + rng.int(2);
  for (let y = headY + 1; y < 16; y++) t.set(cx, y, stem);
  // Leaves on the stem.
  t.set(cx - 1, 12, stem);
  t.set(cx - 2, 11, shade(stem, 1.15));
  t.set(cx + 1, 10, stem);
  t.set(cx + 2, 9, shade(stem, 1.15));
  const [dark, mid, light] = [
    o.petals[0]!,
    o.petals[1] ?? o.petals[0]!,
    o.petals[2] ?? o.petals[0]!,
  ];
  const put = (dx: number, dy: number, c: RGBA) => t.set(cx + dx, headY + dy, c);
  switch (o.shape ?? 'round') {
    case 'cross':
      for (const [dx, dy] of [
        [0, -2],
        [0, -1],
        [-2, 0],
        [-1, 0],
        [1, 0],
        [2, 0],
        [0, 1],
        [0, 2],
      ] as const)
        put(dx, dy, Math.abs(dx) + Math.abs(dy) === 2 ? dark : mid);
      put(-1, -1, light);
      break;
    case 'tall':
      for (let dy = -4; dy <= 1; dy++) {
        put(0, dy, dy % 2 ? mid : light);
        if (dy > -4 && dy < 1) {
          put(-1, dy, dark);
          put(1, dy, mid);
        }
      }
      break;
    case 'bell':
      for (const [dx, dy] of [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-2, 0],
        [-1, 0],
        [0, 0],
        [1, 0],
        [2, 0],
        [-2, 1],
        [2, 1],
      ] as const)
        put(dx, dy, dy === -1 ? light : dy === 1 ? dark : mid);
      break;
    default:
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d > 3 || (Math.abs(dx) === 2 && Math.abs(dy) === 2)) continue;
          put(dx, dy, d >= 3 ? dark : dx + dy < 0 ? light : mid);
        }
  }
  put(0, 0, o.center);
  return t;
}

export function mushroom(cap: readonly RGBA[], spots: RGBA | null): Tile {
  const t = new Tile().fill(CLEAR);
  const stem = hex('#e8dcc4');
  for (let y = 10; y < 16; y++) {
    t.set(7, y, stem);
    t.set(8, y, shade(stem, 0.85));
  }
  for (let y = 6; y < 10; y++)
    for (let x = 4; x < 12; x++) {
      const edge = y === 6 && (x === 4 || x === 11);
      if (edge) continue;
      t.set(x, y, pick(cap, y === 6 ? 0.9 : y === 9 ? 0.1 : 0.5 + (x < 8 ? 0.2 : -0.1)));
    }
  if (spots) {
    t.set(5, 7, spots);
    t.set(9, 7, spots);
    t.set(7, 8, spots);
  }
  return t;
}

/** Bright magenta/black checker for missing textures. */
export function missing(): Tile {
  const t = new Tile();
  t.forEach((x, y) => t.set(x, y, x < 8 !== y < 8 ? hex('#f800f8') : hex('#000000')));
  return t;
}

export { mix };
