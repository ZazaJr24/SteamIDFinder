/**
 * All block definitions. Texture names refer to recipes in tools/texgen.
 * Registration order defines numeric ids; saves store names, so reordering is safe.
 */
import { rotationForFacing } from './models';
import { BlockRegistry, type Box, type Props } from './registry';

export const WOOD_TYPES = [
  'oak',
  'birch',
  'spruce',
  'jungle',
  'acacia',
  'dark_oak',
  'cherry',
] as const;
export type WoodType = (typeof WOOD_TYPES)[number];

export const ORE_TYPES = [
  'coal',
  'iron',
  'copper',
  'gold',
  'glutstein',
  'lapis',
  'diamond',
  'emerald',
] as const;

export const DYE_COLORS = [
  'white',
  'light_gray',
  'gray',
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'cyan',
  'light_blue',
  'blue',
  'purple',
  'magenta',
  'pink',
] as const;

export const FLOWER_TYPES = [
  'dandelion',
  'poppy',
  'cornflower',
  'allium',
  'orange_tulip',
  'pink_tulip',
  'daisy',
  'lavender',
] as const;

const HORIZONTAL = ['north', 'south', 'east', 'west'] as const;

function torchBoxes(tex: string) {
  const faces = (top: readonly [number, number, number, number]) => {
    const side = { tex, uv: [7, 6, 9, 16] as const };
    return {
      up: { tex, uv: top },
      down: { tex, uv: [7, 13, 9, 15] as const },
      north: side,
      south: side,
      east: side,
      west: side,
    };
  };
  return (p: Props): Box[] => {
    const facing = p.facing as string;
    if (facing === 'floor')
      return [{ from: [7, 0, 7], to: [9, 10, 9], faces: faces([7, 6, 9, 8]) }];
    // Modeled pointing east (attached to the wall on its west side), then rotated.
    return [
      {
        from: [-1, 3.5, 7],
        to: [1, 13.5, 9],
        rotation: { axis: 'z', angle: -22.5, origin: [0, 3.5, 8] },
        rotateY: rotationForFacing(facing),
        faces: faces([7, 6, 9, 8]),
      },
    ];
  };
}

function lanternBoxes(p: Props): Box[] {
  const tex = 'lantern';
  const up = p.hanging ? 1 : 0;
  const body = { tex, uv: [5, 8, 11, 15] as const };
  const cap = { tex, uv: [6, 6, 10, 8] as const };
  return [
    {
      from: [5, up, 5],
      to: [11, 7 + up, 11],
      faces: { north: body, south: body, east: body, west: body, up: body, down: body },
    },
    {
      from: [6, 7 + up, 6],
      to: [10, 9 + up, 10],
      faces: { north: cap, south: cap, east: cap, west: cap, up: cap },
    },
  ];
}

export function createBlockRegistry(): BlockRegistry {
  const r = new BlockRegistry();

  r.register('air', {
    model: 'none',
    solid: false,
    replaceable: true,
    selectable: false,
    lightOpacity: 0,
    category: 'hidden',
  });

  // --- stone family
  r.register('stone', {
    textures: 'stone',
    hardness: 1.5,
    tool: 'pickaxe',
    sound: 'stone',
    drops: 'cobblestone',
  });
  r.register('cobblestone', {
    textures: 'cobblestone',
    hardness: 2,
    tool: 'pickaxe',
    sound: 'stone',
  });
  r.register('mossy_cobblestone', {
    textures: 'mossy_cobblestone',
    hardness: 2,
    tool: 'pickaxe',
    sound: 'stone',
  });
  r.register('stone_bricks', {
    textures: 'stone_bricks',
    hardness: 1.5,
    tool: 'pickaxe',
    sound: 'stone',
  });
  r.register('smooth_stone', {
    textures: 'smooth_stone',
    hardness: 2,
    tool: 'pickaxe',
    sound: 'stone',
  });
  r.register('bricks', { textures: 'bricks', hardness: 2, tool: 'pickaxe', sound: 'stone' });
  r.register('bedrock', { textures: 'bedrock', hardness: -1, sound: 'stone', category: 'hidden' });

  // --- soil
  r.register('dirt', {
    textures: 'dirt',
    hardness: 0.5,
    tool: 'shovel',
    sound: 'gravel',
    category: 'nature',
  });
  r.register('coarse_dirt', {
    textures: 'coarse_dirt',
    hardness: 0.5,
    tool: 'shovel',
    sound: 'gravel',
    category: 'nature',
  });
  r.register('grass_block', {
    properties: { snowy: [false, true] },
    textures: (p) =>
      p.snowy
        ? { top: 'snow', bottom: 'dirt', side: 'grass_side_snowy' }
        : { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
    hardness: 0.6,
    tool: 'shovel',
    sound: 'grass',
    drops: 'dirt',
    category: 'nature',
  });
  r.register('snow_block', {
    textures: 'snow',
    hardness: 0.2,
    tool: 'shovel',
    sound: 'snow',
    category: 'nature',
  });
  r.register('sand', {
    textures: 'sand',
    hardness: 0.5,
    tool: 'shovel',
    sound: 'sand',
    category: 'nature',
  });
  r.register('red_sand', {
    textures: 'red_sand',
    hardness: 0.5,
    tool: 'shovel',
    sound: 'sand',
    category: 'nature',
  });
  r.register('gravel', {
    textures: 'gravel',
    hardness: 0.6,
    tool: 'shovel',
    sound: 'gravel',
    category: 'nature',
  });
  r.register('clay', {
    textures: 'clay',
    hardness: 0.6,
    tool: 'shovel',
    sound: 'gravel',
    category: 'nature',
  });
  r.register('sandstone', {
    textures: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' },
    hardness: 0.8,
    tool: 'pickaxe',
    sound: 'stone',
  });
  r.register('red_sandstone', {
    textures: {
      top: 'red_sandstone_top',
      bottom: 'red_sandstone_bottom',
      side: 'red_sandstone_side',
    },
    hardness: 0.8,
    tool: 'pickaxe',
    sound: 'stone',
  });
  r.register('ice', {
    textures: 'ice',
    layer: 'transparent',
    cullSame: true,
    lightOpacity: 2,
    hardness: 0.5,
    tool: 'pickaxe',
    sound: 'glass',
    drops: null,
    category: 'nature',
  });
  r.register('packed_ice', {
    textures: 'packed_ice',
    hardness: 0.5,
    tool: 'pickaxe',
    sound: 'glass',
    category: 'nature',
  });

  // --- liquids
  r.register('water', {
    textures: 'water',
    model: 'liquid',
    layer: 'transparent',
    liquid: true,
    solid: false,
    replaceable: true,
    cullSame: true,
    lightOpacity: 2,
    hardness: -1,
    sound: 'liquid',
    drops: null,
    category: 'hidden',
  });
  r.register('lava', {
    textures: 'lava',
    model: 'liquid',
    liquid: true,
    solid: false,
    replaceable: true,
    cullSame: true,
    lightEmission: 15,
    lightOpacity: 15,
    hardness: -1,
    sound: 'liquid',
    drops: null,
    category: 'hidden',
  });

  // --- wood
  for (const wood of WOOD_TYPES) {
    r.register(`${wood}_log`, {
      properties: { axis: ['y', 'x', 'z'] },
      textures: (p) => {
        const side = `${wood}_log`;
        const top = `${wood}_log_top`;
        if (p.axis === 'x')
          return { east: top, west: top, up: side, down: side, north: side, south: side };
        if (p.axis === 'z')
          return { north: top, south: top, up: side, down: side, east: side, west: side };
        return { top, bottom: top, side };
      },
      hardness: 2,
      tool: 'axe',
      sound: 'wood',
      category: 'nature',
    });
    r.register(`${wood}_planks`, {
      textures: `${wood}_planks`,
      hardness: 2,
      tool: 'axe',
      sound: 'wood',
    });
    r.register(`${wood}_leaves`, {
      textures: `${wood}_leaves`,
      layer: 'cutout',
      opaque: false,
      lightOpacity: 1,
      hardness: 0.2,
      tool: 'shears',
      sound: 'grass',
      wave: 'leaves',
      drops: null,
      category: 'nature',
    });
  }

  // --- ores and mineral blocks
  for (const ore of ORE_TYPES) {
    const level =
      ore === 'coal' || ore === 'copper' ? 1 : ore === 'iron' || ore === 'lapis' ? 2 : 3;
    r.register(`${ore}_ore`, {
      textures: `${ore}_ore`,
      hardness: 3,
      tool: 'pickaxe',
      toolLevel: level,
      sound: 'stone',
      category: 'nature',
    });
    r.register(`${ore}_block`, {
      textures: `${ore}_block`,
      hardness: 5,
      tool: 'pickaxe',
      toolLevel: level,
      sound: 'metal',
    });
  }

  r.register('glass', {
    textures: 'glass',
    layer: 'cutout',
    opaque: false,
    cullSame: true,
    lightOpacity: 0,
    hardness: 0.3,
    sound: 'glass',
    drops: null,
  });

  // --- plants
  const plant = (name: string, extra: Partial<Parameters<BlockRegistry['register']>[1]> = {}) =>
    r.register(name, {
      textures: name,
      model: 'cross',
      layer: 'cutout',
      solid: false,
      lightOpacity: 0,
      hardness: 0,
      sound: 'grass',
      wave: 'plant',
      category: 'nature',
      ...extra,
    });
  plant('tall_grass', { replaceable: true, drops: null });
  plant('fern', { replaceable: true, drops: null });
  plant('dead_bush', { replaceable: true, wave: undefined });
  for (const f of FLOWER_TYPES) plant(f);
  plant('red_mushroom', { wave: undefined });
  plant('brown_mushroom', { wave: undefined, lightEmission: 1 });
  plant('sugar_cane', { wave: undefined });
  r.register('cactus', {
    model: 'boxes',
    layer: 'cutout',
    boxes: () => [
      {
        from: [1, 0, 1],
        to: [15, 16, 15],
        faces: {
          up: { tex: 'cactus_top', uv: [1, 1, 15, 15] },
          down: { tex: 'cactus_bottom', uv: [1, 1, 15, 15], cull: 'down' },
          north: { tex: 'cactus_side' },
          south: { tex: 'cactus_side' },
          east: { tex: 'cactus_side' },
          west: { tex: 'cactus_side' },
        },
      },
    ],
    hardness: 0.4,
    sound: 'wool',
    category: 'nature',
  });

  // --- light sources
  r.register('torch', {
    model: 'boxes',
    layer: 'cutout',
    properties: { facing: ['floor', ...HORIZONTAL] },
    boxes: torchBoxes('torch'),
    solid: false,
    lightEmission: 14,
    hardness: 0,
    sound: 'wood',
    category: 'decoration',
  });
  r.register('glutstein_torch', {
    model: 'boxes',
    layer: 'cutout',
    properties: { facing: ['floor', ...HORIZONTAL] },
    boxes: torchBoxes('glutstein_torch'),
    solid: false,
    lightEmission: 7,
    hardness: 0,
    sound: 'wood',
    category: 'decoration',
  });
  r.register('lantern', {
    model: 'boxes',
    layer: 'cutout',
    properties: { hanging: [false, true] },
    boxes: lanternBoxes,
    lightEmission: 15,
    hardness: 1,
    tool: 'pickaxe',
    sound: 'metal',
    category: 'decoration',
  });
  r.register('glowstone', {
    textures: 'glowstone',
    lightEmission: 15,
    hardness: 0.3,
    sound: 'glass',
    category: 'decoration',
  });

  // --- utility
  r.register('crafting_table', {
    textures: {
      top: 'crafting_table_top',
      bottom: 'oak_planks',
      north: 'crafting_table_front',
      south: 'crafting_table_side',
      east: 'crafting_table_side',
      west: 'crafting_table_front',
    },
    hardness: 2.5,
    tool: 'axe',
    sound: 'wood',
    category: 'utility',
  });
  r.register('bookshelf', {
    textures: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' },
    hardness: 1.5,
    tool: 'axe',
    sound: 'wood',
    category: 'decoration',
  });

  // --- colors
  for (const color of DYE_COLORS) {
    r.register(`${color}_wool`, {
      textures: `${color}_wool`,
      hardness: 0.8,
      tool: 'shears',
      sound: 'wool',
    });
  }

  return r.finalize();
}

/** The one registry used by the game (and by each worker, built identically). */
export const BLOCKS = createBlockRegistry();

/** Frequently used default states, resolved once. */
export const B = {
  air: 0,
  stone: BLOCKS.id('stone'),
  cobblestone: BLOCKS.id('cobblestone'),
  mossyCobblestone: BLOCKS.id('mossy_cobblestone'),
  bedrock: BLOCKS.id('bedrock'),
  dirt: BLOCKS.id('dirt'),
  coarseDirt: BLOCKS.id('coarse_dirt'),
  grass: BLOCKS.id('grass_block'),
  snowyGrass: BLOCKS.id('grass_block', { snowy: true }),
  snow: BLOCKS.id('snow_block'),
  sand: BLOCKS.id('sand'),
  redSand: BLOCKS.id('red_sand'),
  gravel: BLOCKS.id('gravel'),
  clay: BLOCKS.id('clay'),
  sandstone: BLOCKS.id('sandstone'),
  redSandstone: BLOCKS.id('red_sandstone'),
  ice: BLOCKS.id('ice'),
  packedIce: BLOCKS.id('packed_ice'),
  water: BLOCKS.id('water'),
  lava: BLOCKS.id('lava'),
  tallGrass: BLOCKS.id('tall_grass'),
  fern: BLOCKS.id('fern'),
  deadBush: BLOCKS.id('dead_bush'),
  cactus: BLOCKS.id('cactus'),
  sugarCane: BLOCKS.id('sugar_cane'),
  torch: BLOCKS.id('torch'),
  glowstone: BLOCKS.id('glowstone'),
} as const;
