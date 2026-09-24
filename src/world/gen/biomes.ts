import { B, BLOCKS } from '../blocks/blocks';

export type TreeKind =
  | 'oak'
  | 'fancy_oak'
  | 'birch'
  | 'spruce'
  | 'pine'
  | 'jungle'
  | 'jungle_bush'
  | 'acacia'
  | 'dark_oak'
  | 'cherry';

export interface Biome {
  id: number;
  name: string;
  /** Top block on land. */
  surface: number;
  /** Blocks right below the surface. */
  filler: number;
  fillerDepth: number;
  /** Trees per 4×4 cell (0–1). */
  treeDensity: number;
  trees: readonly (readonly [TreeKind, number])[];
  grass: number;
  /** Chance that a grass spot is a fern instead. */
  ferns?: number;
  flowers: number;
  flowerTypes: readonly string[];
  cactus?: number;
  deadBush?: number;
  /** Freezes water and puts snow on grass. */
  snowy?: boolean;
  /** Grass and foliage tint (RGB, used by the renderer). */
  grassColor: number;
  foliageColor: number;
}

let nextId = 0;
function biome(b: Omit<Biome, 'id'>): Biome {
  return { id: nextId++, ...b };
}

const GRASS = B.grass;
const DIRT = B.dirt;

export const BIOMES = {
  ocean: biome({
    name: 'ocean',
    surface: B.sand,
    filler: B.sand,
    fillerDepth: 3,
    treeDensity: 0,
    trees: [],
    grass: 0,
    flowers: 0,
    flowerTypes: [],
    grassColor: 0x8eb971,
    foliageColor: 0x71a74d,
  }),
  frozenOcean: biome({
    name: 'frozen_ocean',
    surface: B.gravel,
    filler: B.gravel,
    fillerDepth: 3,
    treeDensity: 0,
    trees: [],
    grass: 0,
    flowers: 0,
    flowerTypes: [],
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
  beach: biome({
    name: 'beach',
    surface: B.sand,
    filler: B.sand,
    fillerDepth: 4,
    treeDensity: 0,
    trees: [],
    grass: 0,
    flowers: 0,
    flowerTypes: [],
    grassColor: 0x91bd59,
    foliageColor: 0x77ab2f,
  }),
  plains: biome({
    name: 'plains',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.015,
    trees: [
      ['oak', 8],
      ['fancy_oak', 1],
    ],
    grass: 0.32,
    flowers: 0.08,
    flowerTypes: ['dandelion', 'poppy', 'daisy', 'cornflower', 'orange_tulip', 'pink_tulip'],
    grassColor: 0x91bd59,
    foliageColor: 0x77ab2f,
  }),
  forest: biome({
    name: 'forest',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.55,
    trees: [
      ['oak', 6],
      ['fancy_oak', 1],
      ['birch', 2],
    ],
    grass: 0.18,
    flowers: 0.04,
    flowerTypes: ['dandelion', 'poppy', 'allium'],
    grassColor: 0x79c05a,
    foliageColor: 0x59ae30,
  }),
  birchForest: biome({
    name: 'birch_forest',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.5,
    trees: [['birch', 1]],
    grass: 0.2,
    flowers: 0.06,
    flowerTypes: ['daisy', 'allium', 'lavender'],
    grassColor: 0x88bb67,
    foliageColor: 0x6ba941,
  }),
  darkForest: biome({
    name: 'dark_forest',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.85,
    trees: [
      ['dark_oak', 6],
      ['oak', 1],
    ],
    grass: 0.1,
    flowers: 0.01,
    flowerTypes: ['poppy'],
    grassColor: 0x507a32,
    foliageColor: 0x59ae30,
  }),
  taiga: biome({
    name: 'taiga',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.5,
    trees: [
      ['spruce', 3],
      ['pine', 1],
    ],
    grass: 0.2,
    ferns: 0.6,
    flowers: 0.01,
    flowerTypes: ['cornflower'],
    grassColor: 0x86b783,
    foliageColor: 0x68a464,
  }),
  snowyTaiga: biome({
    name: 'snowy_taiga',
    surface: B.snowyGrass,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.4,
    trees: [
      ['spruce', 2],
      ['pine', 1],
    ],
    grass: 0.05,
    ferns: 1,
    flowers: 0,
    flowerTypes: [],
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
  snowyPlains: biome({
    name: 'snowy_plains',
    surface: B.snowyGrass,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.01,
    trees: [['spruce', 1]],
    grass: 0.02,
    flowers: 0,
    flowerTypes: [],
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
  desert: biome({
    name: 'desert',
    surface: B.sand,
    filler: B.sand,
    fillerDepth: 4,
    treeDensity: 0,
    trees: [],
    grass: 0,
    flowers: 0,
    flowerTypes: [],
    cactus: 0.006,
    deadBush: 0.012,
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
  }),
  savanna: biome({
    name: 'savanna',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.05,
    trees: [
      ['acacia', 4],
      ['oak', 1],
    ],
    grass: 0.45,
    flowers: 0.01,
    flowerTypes: ['dandelion', 'orange_tulip'],
    grassColor: 0xbfb755,
    foliageColor: 0xaea42a,
  }),
  badlands: biome({
    name: 'badlands',
    surface: B.redSand,
    filler: B.redSandstone,
    fillerDepth: 6,
    treeDensity: 0,
    trees: [],
    grass: 0,
    flowers: 0,
    flowerTypes: [],
    cactus: 0.003,
    deadBush: 0.02,
    grassColor: 0x90814d,
    foliageColor: 0x9e814d,
  }),
  jungle: biome({
    name: 'jungle',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.9,
    trees: [
      ['jungle', 4],
      ['jungle_bush', 5],
      ['fancy_oak', 1],
    ],
    grass: 0.5,
    ferns: 0.4,
    flowers: 0.02,
    flowerTypes: ['poppy', 'orange_tulip'],
    grassColor: 0x59c93c,
    foliageColor: 0x30bb0b,
  }),
  swamp: biome({
    name: 'swamp',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.12,
    trees: [['oak', 1]],
    grass: 0.25,
    flowers: 0.02,
    flowerTypes: ['allium'],
    grassColor: 0x6a7039,
    foliageColor: 0x6a7039,
  }),
  cherryGrove: biome({
    name: 'cherry_grove',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 3,
    treeDensity: 0.22,
    trees: [['cherry', 1]],
    grass: 0.3,
    flowers: 0.12,
    flowerTypes: ['pink_tulip', 'allium', 'daisy'],
    grassColor: 0xb6db61,
    foliageColor: 0xb6db61,
  }),
  mountains: biome({
    name: 'mountains',
    surface: GRASS,
    filler: DIRT,
    fillerDepth: 2,
    treeDensity: 0.04,
    trees: [['spruce', 1]],
    grass: 0.1,
    flowers: 0.01,
    flowerTypes: ['cornflower', 'allium'],
    grassColor: 0x8ab689,
    foliageColor: 0x6da36b,
  }),
  snowyPeaks: biome({
    name: 'snowy_peaks',
    surface: B.snow,
    filler: B.snow,
    fillerDepth: 2,
    treeDensity: 0,
    trees: [],
    grass: 0,
    flowers: 0,
    flowerTypes: [],
    snowy: true,
    grassColor: 0x80b497,
    foliageColor: 0x60a17b,
  }),
} as const;

export const BIOME_LIST: readonly Biome[] = Object.values(BIOMES).sort((a, b) => a.id - b.id);

/** Flower name → block state, resolved once. */
export const FLOWER_STATES = new Map<string, number>(
  BIOME_LIST.flatMap((b) => b.flowerTypes).map((name) => [name, BLOCKS.id(name)] as const),
);
