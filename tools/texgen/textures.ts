/**
 * Texture recipes. Each texture gets its own seeded RNG derived from its name,
 * so adding or reordering recipes never changes existing textures.
 */
import { Random, seedFromString } from '../../src/core/random';
import { adjust, hex, mix, ramp, shade, withAlpha } from './color';
import { Tile, type RGBA } from './image';
import { fbm, contrast } from './noise';
import * as P from './patterns';

export interface TextureContext {
  rng: Random;
  /** First frame of another texture (built on demand, cached). */
  get(name: string): Tile;
}

export type Recipe = (ctx: TextureContext) => Tile | Tile[];

export class TextureSet {
  private readonly recipes = new Map<string, Recipe>();
  private readonly cache = new Map<string, Tile[]>();

  define(name: string, recipe: Recipe): void {
    if (this.recipes.has(name)) throw new Error(`duplicate texture "${name}"`);
    this.recipes.set(name, recipe);
  }

  get names(): string[] {
    return [...this.recipes.keys()];
  }

  frames(name: string): Tile[] {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const recipe = this.recipes.get(name);
    if (!recipe) throw new Error(`unknown texture "${name}"`);
    const ctx: TextureContext = {
      rng: new Random(seedFromString(`tex:${name}`)),
      get: (other) => this.frames(other)[0]!,
    };
    const result = recipe(ctx);
    const frames = Array.isArray(result) ? result : [result];
    this.cache.set(name, frames);
    return frames;
  }
}

// ---------------------------------------------------------------- palettes

export const PAL = {
  stone: ramp('#7f7f82', 5, 0.3),
  cobble: [hex('#3a3a3d'), ...ramp('#7a7a7d', 5, 0.34)],
  mossy: ramp('#5d7a37', 5, 0.3),
  dirt: ramp('#7a5638', 5, 0.3),
  grass: ramp('#5d9e34', 5, 0.3, 18),
  sand: ramp('#dbcd98', 5, 0.14),
  redSand: ramp('#bd6a31', 5, 0.2),
  gravel: [hex('#4b4644'), ...ramp('#8a8380', 5, 0.35)],
  snow: ramp('#eef4fb', 4, 0.07),
  clay: ramp('#9ea5b3', 5, 0.15),
  sandstone: ramp('#d8c889', 5, 0.18),
  redSandstone: ramp('#b5602a', 5, 0.2),
  water: ramp('#2c6ad8', 5, 0.25, 10),
  lava: [
    hex('#7a1603'),
    hex('#b8300a'),
    hex('#e35d17'),
    hex('#f79428'),
    hex('#ffcf57'),
    hex('#fff1a0'),
  ],
  brick: ramp('#9c4a3a', 5, 0.25),
  stoneBrick: ramp('#7c7c80', 5, 0.3),
} as const;

interface WoodSpecies {
  planks: string;
  bark: string;
  rings: string;
  leaves: string;
  leafHoles?: number;
}

export const WOODS: Record<string, WoodSpecies> = {
  oak: { planks: '#a8834f', bark: '#665033', rings: '#b8925a', leaves: '#478a2c' },
  birch: { planks: '#cdb97f', bark: '#d8d4c9', rings: '#d6c48a', leaves: '#6a9c43' },
  spruce: {
    planks: '#765635',
    bark: '#3e2c1c',
    rings: '#8a673f',
    leaves: '#2e5c38',
    leafHoles: 0.1,
  },
  jungle: {
    planks: '#a8744e',
    bark: '#5a4419',
    rings: '#b8855a',
    leaves: '#3a9a22',
    leafHoles: 0.08,
  },
  acacia: { planks: '#b0602f', bark: '#6a6358', rings: '#bf6f3a', leaves: '#5d8c25' },
  dark_oak: {
    planks: '#4d321b',
    bark: '#3a2a17',
    rings: '#5c3d22',
    leaves: '#2f6a1f',
    leafHoles: 0.08,
  },
  cherry: { planks: '#e6b8b0', bark: '#3b2027', rings: '#e9c2b8', leaves: '#f2a7cb' },
};

interface OreKind {
  gem: string;
  clusters?: number;
  size?: number;
}

export const ORES: Record<string, OreKind> = {
  coal: { gem: '#2b2b2e', clusters: 5, size: 4 },
  iron: { gem: '#d9b096' },
  copper: { gem: '#d0733f', clusters: 5 },
  gold: { gem: '#f7d23c' },
  glutstein: { gem: '#e8352b', clusters: 5, size: 4 },
  lapis: { gem: '#2f58cc' },
  diamond: { gem: '#5de6df', clusters: 3, size: 5 },
  emerald: { gem: '#35d468', clusters: 2, size: 4 },
};

/** Flower name → drawing options. */
const FLOWERS: Record<string, P.FlowerOptions> = {
  dandelion: { petals: ramp('#f5d22e', 3, 0.3), center: hex('#e0a51a'), shape: 'round', headY: 8 },
  poppy: { petals: ramp('#d8281f', 3, 0.3), center: hex('#2a1a12'), shape: 'round' },
  cornflower: { petals: ramp('#4a6de0', 3, 0.3), center: hex('#1f2f80'), shape: 'cross' },
  allium: { petals: ramp('#b86ae0', 3, 0.3), center: hex('#e6b3ff'), shape: 'round', headY: 5 },
  orange_tulip: { petals: ramp('#ef7d2a', 3, 0.3), center: hex('#f7a55a'), shape: 'bell' },
  pink_tulip: { petals: ramp('#f0a0c8', 3, 0.25), center: hex('#ffd0e6'), shape: 'bell' },
  daisy: { petals: ramp('#f2f2ea', 3, 0.15), center: hex('#f2c230'), shape: 'cross' },
  lavender: { petals: ramp('#9a7ae0', 3, 0.3), center: hex('#c6b0ff'), shape: 'tall' },
};

// ----------------------------------------------------------------- recipes

export function buildTextureSet(): TextureSet {
  const set = new TextureSet();
  const def = set.define.bind(set);

  def('missing', () => P.missing());

  // Ground
  def('stone', ({ rng }) => P.stone(rng, PAL.stone));
  def('cobblestone', ({ rng }) => P.cobble(rng, PAL.cobble));
  def('mossy_cobblestone', ({ rng, get }) => {
    const t = get('cobblestone').clone();
    const n = fbm(rng, [
      { cells: 4, weight: 1 },
      { cells: 8, weight: 0.6 },
    ]);
    t.forEach((x, y) => {
      const v = n(x, y);
      if (v > 0.6) t.set(x, y, PAL.mossy[Math.min(4, Math.floor((v - 0.6) * 16))]!);
    });
    return t;
  });
  def('stone_bricks', ({ rng }) =>
    P.bricks(rng, PAL.stoneBrick, {
      rowHeight: 8,
      brickWidth: 16,
      offset: 8,
      mortar: hex('#4a4a4e'),
    }),
  );
  def('bricks', ({ rng }) =>
    P.bricks(rng, PAL.brick, {
      rowHeight: 4,
      brickWidth: 8,
      mortar: hex('#b8aea0'),
      variation: 0.2,
    }),
  );
  def('smooth_stone', ({ rng }) => {
    const t = P.noisy(rng, ramp('#9a9a9e', 4, 0.12), { cells: [4, 8], contrast: 1.2 });
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, hex('#b4b4b8'));
      t.set(0, i, hex('#b4b4b8'));
      t.set(i, 15, hex('#6c6c70'));
      t.set(15, i, hex('#6c6c70'));
    }
    return t;
  });
  def('bedrock', ({ rng }) => P.bedrock(rng));
  def('dirt', ({ rng }) => P.dirt(rng, PAL.dirt));
  def('coarse_dirt', ({ rng, get }) => {
    const t = get('dirt').clone();
    return P.speckle(t, rng, [...PAL.gravel.slice(1, 4), ...PAL.dirt], 0.3);
  });
  def('grass_top', ({ rng }) => P.grassTop(rng, PAL.grass));
  def('grass_side', ({ rng, get }) => P.overhangSide(rng, get('dirt'), get('grass_top')));
  def('snow', ({ rng }) =>
    P.noisy(rng, PAL.snow, { cells: [4, 16], contrast: 1.2, speckle: 0.05 }),
  );
  def('grass_side_snowy', ({ rng, get }) => P.overhangSide(rng, get('dirt'), get('snow'), 3, 3));
  def('sand', ({ rng }) => P.sand(rng, PAL.sand));
  def('red_sand', ({ rng }) => P.sand(rng, PAL.redSand));
  def('gravel', ({ rng }) => P.gravel(rng, PAL.gravel));
  def('clay', ({ rng }) =>
    P.noisy(rng, PAL.clay, { cells: [2, 4, 16], contrast: 1.3, speckle: 0.04 }),
  );
  def('ice', ({ rng }) => P.ice(rng));
  def('packed_ice', ({ rng }) =>
    P.noisy(rng, ramp('#8db4ec', 5, 0.22), { cells: [2, 4, 8], contrast: 1.6 }),
  );

  for (const [name, pal] of [
    ['sandstone', PAL.sandstone],
    ['red_sandstone', PAL.redSandstone],
  ] as const) {
    def(`${name}_top`, ({ rng }) =>
      P.noisy(rng, pal, { cells: [4, 16], contrast: 1.1, speckle: 0.08 }),
    );
    def(`${name}_bottom`, ({ rng }) =>
      P.noisy(rng, pal, { cells: [4, 8, 16], contrast: 1.5, speckle: 0.1 }),
    );
    def(`${name}_side`, ({ rng }) => {
      const n = fbm(rng, [
        { cells: 16, cellsY: 2, weight: 1 },
        { cells: 16, weight: 0.4 },
      ]);
      const t = new Tile();
      t.forEach((x, y) => {
        let v = 0.35 + n(x, y) * 0.35;
        if (y < 3) v = 0.8 - y * 0.08; // smooth top band
        if (y === 3 || y === 11) v = 0.08; // layer lines
        if (y === 12) v += 0.15;
        t.set(x, y, pal[Math.min(pal.length - 1, Math.floor(v * pal.length))]!);
      });
      return t;
    });
  }

  // Liquids (animated)
  def('water', ({ rng }) => P.flowing(rng, PAL.water, 16, { cells: 4, contrast: 1.5, alpha: 175 }));
  def('lava', ({ rng }) => P.flowing(rng, PAL.lava, 16, { cells: 4, contrast: 2.2 }));

  // Wood
  for (const [name, w] of Object.entries(WOODS)) {
    const barkPal = ramp(w.bark, 5, 0.3);
    const plankPal = [shade(hex(w.planks), 0.6), ...ramp(w.planks, 5, 0.26)];
    def(`${name}_planks`, ({ rng }) => P.planks(rng, plankPal));
    if (name === 'birch') {
      def(`${name}_log`, ({ rng }) => birchBark(rng, barkPal));
    } else {
      def(`${name}_log`, ({ rng }) => P.barkSide(rng, barkPal));
    }
    def(`${name}_log_top`, ({ rng }) => P.logTop(rng, ramp(w.rings, 4, 0.2), barkPal));
    def(`${name}_leaves`, ({ rng }) =>
      P.leaves(rng, ramp(w.leaves, 5, 0.3, 16), w.leafHoles ?? 0.16),
    );
  }

  // Ores and mineral blocks
  for (const [name, o] of Object.entries(ORES)) {
    const gem = [shade(hex(o.gem), 0.45), ...ramp(o.gem, 4, 0.3), adjust(hex(o.gem), 0, -0.2, 0.3)];
    def(`${name}_ore`, ({ rng, get }) =>
      P.ore(rng, get('stone'), gem, o.clusters ?? 4, o.size ?? 4),
    );
    def(`${name}_block`, ({ rng }) => P.metalBlock(rng, ramp(o.gem, 6, 0.45)));
  }

  // Glass
  def('glass', ({ rng }) =>
    P.glass(rng, withAlpha(hex('#dcecf2'), 230), withAlpha(hex('#ffffff'), 200)),
  );

  // Plants
  def('tall_grass', ({ rng }) => P.tallGrass(rng, ramp('#5d9e34', 5, 0.35)));
  def('fern', ({ rng }) => fern(rng, ramp('#4f8a30', 5, 0.3)));
  def('dead_bush', ({ rng }) => deadBush(rng));
  for (const [name, o] of Object.entries(FLOWERS)) def(name, ({ rng }) => P.flower(rng, o));
  def('red_mushroom', () => P.mushroom(ramp('#c8281e', 4, 0.3), hex('#f4efe6')));
  def('brown_mushroom', () => P.mushroom(ramp('#9a7050', 4, 0.25), null));
  def('sugar_cane', ({ rng }) => sugarCane(rng));
  def('cactus_side', ({ rng }) => cactusSide(rng));
  def('cactus_top', ({ rng }) => {
    const t = P.noisy(rng, ramp('#5a9a3a', 4, 0.25), { cells: [8], contrast: 1 });
    for (let i = 1; i < 15; i++) {
      t.set(i, 1, hex('#2f5f22'));
      t.set(1, i, hex('#2f5f22'));
      t.set(i, 14, hex('#2f5f22'));
      t.set(14, i, hex('#2f5f22'));
    }
    t.set(7, 7, hex('#a8d060'));
    t.set(8, 8, hex('#a8d060'));
    return t;
  });
  def('cactus_bottom', ({ get }) =>
    get('cactus_top')
      .clone()
      .map((_x, _y, c) => shade(c, 0.85)),
  );

  // Light sources
  def('torch', ({ rng }) => torch(rng, ramp('#7a5634', 3, 0.3), false));
  def('glutstein_torch', ({ rng }) => torch(rng, ramp('#7a5634', 3, 0.3), true));
  def('lantern', ({ rng }) => lantern(rng));
  def('glowstone', ({ rng }) => {
    const pal = [hex('#8a5a22'), hex('#c98a34'), hex('#f2c35a'), hex('#ffe08a'), hex('#fff6c8')];
    return P.cobble(rng, pal, 5);
  });

  // Utility blocks
  def('crafting_table_top', ({ rng, get }) => craftingTop(rng, get('oak_planks')));
  def('crafting_table_side', ({ rng, get }) => craftingSide(rng, get('oak_planks'), false));
  def('crafting_table_front', ({ rng, get }) => craftingSide(rng, get('oak_planks'), true));
  def('bookshelf', ({ rng, get }) => bookshelf(rng, get('oak_planks')));

  // Particles.
  def('particle_flame', () => flameSprite(['#fff8d6', '#ffd23c', '#f28a1c', '#b8420c']));
  def('particle_glut_flame', () => flameSprite(['#ffd0c8', '#ff4a2c', '#c81e12', '#6a0e08']));
  def('particle_smoke', ({ rng }) => smokeSprite(rng));

  // Block breaking cracks: 10 stages, each adding to the previous one.
  const cracks = crackStages(new Random(seedFromString('tex:cracks')), 10);
  cracks.forEach((tile, i) => def(`destroy_stage_${i}`, () => tile));

  // Wool in 16 colors
  for (const [name, color] of Object.entries(DYE_COLORS))
    def(`${name}_wool`, ({ rng }) => wool(rng, color));

  return set;
}

export const DYE_COLORS: Record<string, string> = {
  white: '#e9ecec',
  light_gray: '#9d9d97',
  gray: '#474f52',
  black: '#1d1d21',
  brown: '#835432',
  red: '#b02e26',
  orange: '#f07613',
  yellow: '#fed83d',
  lime: '#80c71f',
  green: '#5e7c16',
  cyan: '#169c9c',
  light_blue: '#3ab3da',
  blue: '#3c44aa',
  purple: '#8932b8',
  magenta: '#c74ebd',
  pink: '#f38baa',
};

// ------------------------------------------------------- one-off drawings

/** Tear-drop flame, brightest at the bottom center. */
function flameSprite(colors: string[]): Tile {
  const t = new Tile().fill(P.CLEAR);
  const pal = colors.map((c) => hex(c));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 5.5;
      const dy = (y - 10) / 5.5;
      // Narrower toward the top.
      const width = dy < 0 ? 1 + dy * 0.75 : 1;
      const r = Math.hypot(dx / Math.max(0.15, width), dy);
      if (r > 1) continue;
      t.set(x, y, pal[Math.min(3, Math.floor(r * 4))]!);
    }
  return t;
}

/** Soft gray puff. */
function smokeSprite(rng: Random): Tile {
  const t = new Tile().fill(P.CLEAR);
  const pal = ramp('#8a8a8a', 4, 0.3);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5) / 7;
      if (r > 1 || (r > 0.8 && rng.chance(0.5))) continue;
      t.set(x, y, pal[Math.min(3, Math.floor((1 - r) * 3 + rng.next()))]!);
    }
  return t;
}

/** Cumulative crack patterns: branching dark lines growing from the center. */
function crackStages(rng: Random, stages: number): Tile[] {
  const out: Tile[] = [];
  const t = new Tile().fill(P.CLEAR);
  const dark = withAlpha(hex('#000000'), 200);
  const mid = withAlpha(hex('#1a1a1a'), 130);
  const tips: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    tips.push([7.5, 7.5, Math.cos(a), Math.sin(a)]);
  }
  for (let s = 0; s < stages; s++) {
    const steps = 2 + Math.floor(s / 2);
    for (const tip of tips) {
      for (let k = 0; k < steps; k++) {
        tip[0] += tip[2] + rng.range(-0.5, 0.5);
        tip[1] += tip[3] + rng.range(-0.5, 0.5);
        const x = Math.round(tip[0]);
        const y = Math.round(tip[1]);
        if (x < 0 || x > 15 || y < 0 || y > 15) continue;
        t.set(x, y, dark);
        if (rng.chance(0.4)) t.set(x + 1, y, mid);
      }
    }
    // Occasionally a new branch splits off.
    if (s % 2 === 1 && tips.length < 12) {
      const from = tips[rng.int(tips.length)]!;
      const a = Math.atan2(from[3], from[2]) + rng.range(0.6, 1.2) * (rng.chance(0.5) ? 1 : -1);
      tips.push([from[0], from[1], Math.cos(a), Math.sin(a)]);
    }
    out.push(t.clone());
  }
  return out;
}

function birchBark(rng: Random, _pal: readonly RGBA[]): Tile {
  const white = ramp('#dedbd2', 4, 0.12);
  const t = P.noisy(rng, white, { cells: [2, 8], contrast: 1.2 });
  // Characteristic dark horizontal marks.
  for (let i = 0; i < 7; i++) {
    const y = rng.int(16);
    const x0 = rng.int(16);
    const len = 2 + rng.int(4);
    for (let s = 0; s < len; s++)
      t.set(x0 + s, y, s === 0 || s === len - 1 ? hex('#5a5550') : hex('#2d2a28'));
  }
  return t;
}

function fern(rng: Random, pal: readonly RGBA[]): Tile {
  const t = new Tile().fill(P.CLEAR);
  for (let f = 0; f < 3; f++) {
    const x0 = 3 + f * 4 + rng.int(2);
    const h = 9 + rng.int(5);
    for (let s = 0; s < h; s++) {
      const y = 15 - s;
      const x = x0 + (s > h / 2 ? f - 1 : 0);
      t.set(x, y, pal[2]!);
      if (s % 2 === 1 && s < h - 1) {
        t.set(x - 1, y, pal[3]!);
        t.set(x + 1, y, pal[1]!);
      }
    }
  }
  return t;
}

function deadBush(rng: Random): Tile {
  const t = new Tile().fill(P.CLEAR);
  const c = ramp('#8a5f2e', 3, 0.3);
  const branch = (x: number, y: number, dx: number, len: number) => {
    for (let i = 0; i < len; i++) {
      t.set(x, y, c[1 + (i % 2)]!);
      y--;
      if (rng.chance(0.5)) x += dx;
    }
  };
  branch(7, 15, 0, 5);
  branch(7, 11, -1, 5);
  branch(8, 11, 1, 5);
  branch(7, 9, -1, 3);
  branch(8, 8, 1, 4);
  return t;
}

function sugarCane(rng: Random): Tile {
  const t = new Tile().fill(P.CLEAR);
  const pal = ramp('#8fc25a', 4, 0.3);
  for (const x0 of [3, 8, 12]) {
    for (let y = 0; y < 16; y++) {
      const joint = (y + x0) % 5 === 0;
      t.set(x0, y, joint ? pal[0]! : pal[2]!);
      t.set(x0 + 1, y, joint ? pal[0]! : pal[1]!);
    }
    const ly = rng.int(12);
    t.set(x0 - 1, ly, pal[3]!);
    t.set(x0 - 2, ly - 1, pal[3]!);
  }
  return t;
}

function cactusSide(rng: Random): Tile {
  const pal = ramp('#4f8f32', 5, 0.3);
  const t = new Tile();
  t.forEach((x, y) => {
    const ridge = x % 4;
    const v = ridge === 0 ? 0.1 : ridge === 1 ? 0.8 : 0.5 + (rng.next() - 0.5) * 0.2;
    t.set(x, y, pal[Math.min(4, Math.floor(v * 5))]!);
  });
  for (let i = 0; i < 10; i++) t.set(1 + 4 * rng.int(4), rng.int(16), hex('#e8e0a0'));
  return t;
}

function torch(_rng: Random, wood: readonly RGBA[], glutstein: boolean): Tile {
  const t = new Tile().fill(P.CLEAR);
  // The model samples the 2×10 stick at x = 7..8, y = 6..15; the flame sits on top.
  for (let y = 8; y < 16; y++) {
    t.set(7, y, wood[1]!);
    t.set(8, y, wood[0]!);
  }
  const flame = glutstein
    ? [hex('#6a0e08'), hex('#c81e12'), hex('#ff4a2c'), hex('#ffb0a0')]
    : [hex('#b8420c'), hex('#f28a1c'), hex('#ffd23c'), hex('#fff8d6')];
  t.set(7, 7, flame[1]!);
  t.set(8, 7, flame[0]!);
  t.set(7, 6, flame[3]!);
  t.set(8, 6, flame[2]!);
  if (!glutstein) {
    t.set(7, 5, flame[2]!);
    t.set(8, 5, flame[1]!);
  }
  return t;
}

function lantern(rng: Random): Tile {
  const t = new Tile().fill(P.CLEAR);
  const metal = ramp('#4a4c55', 4, 0.3);
  const glow = [hex('#ffb040'), hex('#ffd66a'), hex('#fff0b0')];
  // Body 6×7 at x 5..10, y 8..14; cap at y 7; handle above.
  for (let y = 8; y <= 14; y++)
    for (let x = 5; x <= 10; x++) {
      const border = x === 5 || x === 10 || y === 8 || y === 14;
      t.set(
        x,
        y,
        border ? metal[1 + ((x + y) % 2)]! : glow[Math.min(2, Math.floor(rng.next() * 3))]!,
      );
    }
  for (let x = 6; x <= 9; x++) t.set(x, 7, metal[2]!);
  t.set(7, 6, metal[3]!);
  t.set(8, 6, metal[3]!);
  t.set(7, 5, metal[1]!);
  t.set(8, 5, metal[1]!);
  return t;
}

function wool(rng: Random, color: string): Tile {
  const pal = ramp(color, 5, 0.18);
  const n = fbm(rng, [
    { cells: 4, weight: 1 },
    { cells: 16, weight: 0.6 },
  ]);
  const t = new Tile();
  t.forEach((x, y) => {
    // Woven fibre pattern: alternating diagonal ridges.
    const weave = ((x + y) % 4 < 2 ? 0.08 : -0.08) + ((x - y + 16) % 8 === 0 ? -0.12 : 0);
    t.set(x, y, pal[Math.min(4, Math.max(0, Math.floor((contrast(n(x, y), 1.3) + weave) * 5)))]!);
  });
  return t;
}

function craftingTop(rng: Random, planks: Tile): Tile {
  const t = planks.clone();
  const frame = hex('#5a3e22');
  const tools = [hex('#9a9a9e'), hex('#c8c8cc'), hex('#6b4a2a')];
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, frame);
    t.set(0, i, frame);
    t.set(i, 15, frame);
    t.set(15, i, frame);
  }
  // 3×3 grid lines.
  for (let i = 2; i < 14; i++) {
    t.set(i, 5, shade(frame, 1.2));
    t.set(i, 10, shade(frame, 1.2));
    t.set(5, i, shade(frame, 1.2));
    t.set(10, i, shade(frame, 1.2));
  }
  t.set(2 + rng.int(2), 2, tools[1]!);
  t.set(12, 12, tools[0]!);
  return t;
}

function craftingSide(_rng: Random, planks: Tile, front: boolean): Tile {
  const t = planks.clone();
  const dark = hex('#4a321c');
  for (let x = 0; x < 16; x++) {
    t.set(x, 0, hex('#6b4a2a'));
    t.set(x, 1, hex('#5a3e22'));
  }
  // Tools hanging on the side: a saw on the front, a hammer on the sides.
  if (front) {
    for (let x = 3; x < 12; x++) t.set(x, 5, hex('#c8c8cc'));
    for (let x = 3; x < 12; x += 2) t.set(x, 6, hex('#9a9a9e'));
    t.set(12, 5, hex('#6b4a2a'));
    t.set(13, 5, hex('#6b4a2a'));
  } else {
    for (let y = 4; y < 12; y++) t.set(8, y, hex('#6b4a2a'));
    for (let x = 6; x < 11; x++) t.set(x, 4, hex('#9a9a9e'));
  }
  for (let x = 0; x < 16; x++) t.set(x, 15, dark);
  return t;
}

function bookshelf(rng: Random, planks: Tile): Tile {
  const t = planks.clone();
  const colors = Object.values(DYE_COLORS).map((c) => ramp(c, 3, 0.25));
  for (const shelfY of [1, 9]) {
    for (let x = 1; x < 15;) {
      const w = 1 + rng.int(2);
      const h = 5 + rng.int(2);
      const pal = colors[rng.int(colors.length)]!;
      for (let dx = 0; dx < w && x + dx < 15; dx++)
        for (let dy = 0; dy < 6; dy++) {
          const y = shelfY + dy;
          t.set(x + dx, y, dy < 6 - h ? hex('#2e1f12') : dx === 0 ? pal[1]! : pal[0]!);
        }
      x += w;
    }
  }
  for (let x = 0; x < 16; x++) {
    t.set(x, 0, hex('#6b4a2a'));
    t.set(x, 7, hex('#5a3e22'));
    t.set(x, 8, hex('#6b4a2a'));
    t.set(x, 15, hex('#5a3e22'));
  }
  return t;
}

export { mix };
