/**
 * Deterministic world generator. `generateColumn` is a pure function of the
 * seed and the column position, so it runs in workers and gives identical
 * results everywhere. Features that cross column borders (trees) are derived
 * from world-space hashes, so neighbouring columns agree on them.
 */
import { SEA_LEVEL, WORLD_HEIGHT } from '../../config';
import { hash2, hash3, hashFloat, Random } from '../../core/random';
import { B, BLOCKS } from '../blocks/blocks';
import { Column } from '../chunk';
import { BIOMES, FLOWER_STATES, type Biome, type TreeKind } from './biomes';
import { Fbm2, Fbm3, lerp, smoothstep, spline } from './noise';
import { growTree, MAX_TREE_RADIUS } from './trees';

export interface Climate {
  continental: number;
  erosion: number;
  temperature: number;
  humidity: number;
  river: number;
  height: number;
}

interface OreVein {
  state: number;
  attempts: number;
  minY: number;
  maxY: number;
  size: number;
}

const ORE_VEINS: OreVein[] = [
  { state: BLOCKS.id('coal_ore'), attempts: 18, minY: 5, maxY: 132, size: 9 },
  { state: BLOCKS.id('iron_ore'), attempts: 12, minY: 5, maxY: 72, size: 7 },
  { state: BLOCKS.id('copper_ore'), attempts: 9, minY: 30, maxY: 96, size: 8 },
  { state: BLOCKS.id('gold_ore'), attempts: 4, minY: 5, maxY: 34, size: 6 },
  { state: BLOCKS.id('glutstein_ore'), attempts: 6, minY: 4, maxY: 18, size: 7 },
  { state: BLOCKS.id('lapis_ore'), attempts: 3, minY: 5, maxY: 32, size: 5 },
  { state: BLOCKS.id('diamond_ore'), attempts: 2, minY: 3, maxY: 16, size: 5 },
  { state: B.gravel, attempts: 6, minY: 5, maxY: 110, size: 20 },
  { state: B.dirt, attempts: 6, minY: 5, maxY: 110, size: 20 },
];
const EMERALD = BLOCKS.id('emerald_ore');
const LAVA_LEVEL = 10;
const CAVE_GRID = 4;

export class TerrainGenerator {
  private readonly continental: Fbm2;
  private readonly erosion: Fbm2;
  private readonly ridges: Fbm2;
  private readonly hills: Fbm2;
  private readonly detail: Fbm2;
  private readonly temperature: Fbm2;
  private readonly humidity: Fbm2;
  private readonly rivers: Fbm2;
  private readonly entrances: Fbm2;
  private readonly patches: Fbm2;
  private readonly caveA: Fbm3;
  private readonly caveB: Fbm3;
  private readonly cheese: Fbm3;

  constructor(readonly seed: number) {
    const s = (n: number) => hash2(seed, n, 0x5eed);
    this.continental = new Fbm2(s(1), 1100, 5);
    this.erosion = new Fbm2(s(2), 600, 4);
    this.ridges = new Fbm2(s(3), 260, 4);
    this.hills = new Fbm2(s(4), 140, 3);
    this.detail = new Fbm2(s(5), 36, 2);
    this.temperature = new Fbm2(s(6), 1300, 3);
    this.humidity = new Fbm2(s(7), 1100, 3);
    this.rivers = new Fbm2(s(8), 750, 3);
    this.entrances = new Fbm2(s(9), 70, 2);
    this.patches = new Fbm2(s(10), 24, 2);
    this.caveA = new Fbm3(s(11), 70, 42, 1);
    this.caveB = new Fbm3(s(12), 70, 42, 1);
    this.cheese = new Fbm3(s(13), 95, 50, 2);
  }

  // ------------------------------------------------------------- climate

  climate(x: number, z: number): Climate {
    const c = Math.max(-1, Math.min(1, this.continental.sample(x, z) * 1.6 + 0.08));
    const e = this.erosion.sample(x, z) * 1.5;
    const t = this.temperature.sample(x, z) * 1.6;
    const h = this.humidity.sample(x, z) * 1.6;
    const riverRaw = Math.abs(this.rivers.sample(x, z));

    let height = spline(
      [
        [-1, 26],
        [-0.5, 34],
        [-0.32, 46],
        [-0.2, 55],
        [-0.12, 60],
        [-0.06, 63],
        [0.02, 66],
        [0.25, 71],
        [0.5, 80],
        [1, 94],
      ],
      c,
    );
    // Mountains rise where land is inland and erosion is low.
    const mountain = smoothstep(-0.02, 0.45, c) * smoothstep(0.35, -0.45, e);
    const ridge = 1 - Math.abs(this.ridges.sample(x, z));
    height += Math.pow(ridge, 2.3) * 110 * mountain;
    // Rolling hills everywhere on land, flatter where erosion is high.
    const hilliness = smoothstep(-0.25, 0.15, c) * (0.35 + 0.65 * smoothstep(0.6, -0.3, e));
    height += this.hills.sample(x, z) * 14 * hilliness;
    height += this.detail.sample(x, z) * 2.2;

    // Rivers cut valleys down to just below sea level.
    const riverWidth = 0.028;
    let river = 0;
    if (riverRaw < riverWidth * 2 && c > -0.14) {
      river = 1 - riverRaw / (riverWidth * 2);
      const cut = smoothstep(0, 1, river * 1.4) * (1 - smoothstep(110, 150, height));
      height = lerp(height, SEA_LEVEL - 3 - river * 2, cut);
    }

    return {
      continental: c,
      erosion: e,
      temperature: t,
      humidity: h,
      river,
      height: Math.max(4, Math.min(WORLD_HEIGHT - 16, Math.floor(height))),
    };
  }

  heightAt(x: number, z: number): number {
    return this.climate(x, z).height;
  }

  biomeFor(cl: Climate): Biome {
    const { height, temperature: t, humidity: h, continental: c } = cl;
    // Height cools the air: peaks are snowy anywhere.
    const tempAtHeight = t - Math.max(0, height - 100) / 55;
    if (height < SEA_LEVEL - 1) return t < -0.45 ? BIOMES.frozenOcean : BIOMES.ocean;
    if (height <= SEA_LEVEL + 2 && c < 0.02 && cl.river < 0.3)
      return t < -0.45 ? BIOMES.snowyPlains : BIOMES.beach;
    if (height > 118)
      return tempAtHeight < -0.2 || height > 150 ? BIOMES.snowyPeaks : BIOMES.mountains;
    if (height > 88 && t > -0.2 && t < 0.35 && h > 0.15) return BIOMES.cherryGrove;
    if (tempAtHeight < -0.45) return h > 0 ? BIOMES.snowyTaiga : BIOMES.snowyPlains;
    if (t < -0.1) return h > -0.15 ? BIOMES.taiga : BIOMES.plains;
    if (t < 0.4) {
      if (h < -0.35) return BIOMES.plains;
      if (h < 0.05) return BIOMES.forest;
      if (h < 0.3) return BIOMES.birchForest;
      return height <= SEA_LEVEL + 4 ? BIOMES.swamp : BIOMES.darkForest;
    }
    if (h < -0.25) return height > 80 ? BIOMES.badlands : BIOMES.desert;
    if (h < 0.15) return BIOMES.savanna;
    return BIOMES.jungle;
  }

  biomeAt(x: number, z: number): Biome {
    return this.biomeFor(this.climate(x, z));
  }

  /** A surface spot where the player can spawn: dry land near the origin. */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 4000; r += 16) {
      const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 32));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        const cl = this.climate(x, z);
        const biome = this.biomeFor(cl);
        if (
          cl.height > SEA_LEVEL + 1 &&
          cl.height < 100 &&
          biome !== BIOMES.ocean &&
          !biome.snowy
        ) {
          return { x: x + 0.5, y: cl.height + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 100, z: 0.5 };
  }

  // ---------------------------------------------------------- generation

  generateColumn(cx: number, cz: number): Column {
    const col = new Column(cx, cz);
    const x0 = cx * 16;
    const z0 = cz * 16;

    // Climate on an 18×18 grid (one block of margin) for slopes.
    const climates: Climate[] = [];
    for (let z = -1; z <= 16; z++)
      for (let x = -1; x <= 16; x++) climates.push(this.climate(x0 + x, z0 + z));
    const cl = (x: number, z: number) => climates[(z + 1) * 18 + (x + 1)]!;

    const heights = new Int16Array(256);
    const biomes: Biome[] = new Array<Biome>(256);
    let maxHeight = SEA_LEVEL;
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const c = cl(x, z);
        heights[z * 16 + x] = c.height;
        biomes[z * 16 + x] = this.biomeFor(c);
        maxHeight = Math.max(maxHeight, c.height);
      }

    // 1. Base terrain and surface layers.
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const h = heights[z * 16 + x]!;
        const biome = biomes[z * 16 + x]!;
        const slope = Math.max(
          Math.abs(h - cl(x - 1, z).height),
          Math.abs(h - cl(x + 1, z).height),
          Math.abs(h - cl(x, z - 1).height),
          Math.abs(h - cl(x, z + 1).height),
        );
        const wx = x0 + x;
        const wz = z0 + z;
        const r = hashFloat(hash2(this.seed, wx, wz));
        let surface = biome.surface;
        let filler = biome.filler;
        let depth = biome.fillerDepth + (r < 0.3 ? 1 : 0);
        const underwater = h < SEA_LEVEL;
        if (underwater) {
          const clayPatch = this.patches.sample(wx, wz) > 0.45;
          surface = clayPatch ? B.clay : h < SEA_LEVEL - 12 || biome.snowy ? B.gravel : B.sand;
          filler = surface === B.clay ? B.dirt : surface;
          if (cl(x, z).river > 0.3 && surface === B.sand) surface = r < 0.5 ? B.gravel : B.sand;
        } else if (slope >= 4 && biome !== BIOMES.desert && biome !== BIOMES.badlands) {
          surface = slope >= 6 || r < 0.6 ? B.stone : B.gravel;
          filler = B.stone;
          if (biome.snowy && slope < 7) surface = B.snow;
        } else if (biome === BIOMES.mountains && h > 108 && r < 0.3) {
          surface = B.stone;
        }
        if (biome === BIOMES.beach || biome === BIOMES.desert) depth += 1;

        const bedrockTop = 1 + (hash3(this.seed, wx, 0, wz) % 4);
        for (let y = 0; y <= h; y++) {
          let state: number;
          if (y < bedrockTop) state = B.bedrock;
          else if (y === h) state = surface;
          else if (y > h - depth) {
            state = filler;
            if (filler === B.sand && y < h - 2) state = B.sandstone;
          } else state = B.stone;
          col.setBlock(x, y, z, state);
        }
        // Badlands: banded red sandstone cliffs.
        if (biome === BIOMES.badlands && h > 70) {
          for (let y = h - 1; y > h - 12; y--) {
            if ((y + (r > 0.5 ? 1 : 0)) % 5 === 0) col.setBlock(x, y, z, B.redSandstone);
          }
        }
      }
    }

    // 2. Caves (noise evaluated on a coarse grid, trilinearly interpolated).
    this.carveCaves(col, x0, z0, heights, maxHeight);

    // 3. Water, ice and lava.
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const h = heights[z * 16 + x]!;
        const biome = biomes[z * 16 + x]!;
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          if (col.getBlock(x, y, z) !== B.air) continue;
          col.setBlock(x, y, z, y === SEA_LEVEL && biome.snowy ? B.ice : B.water);
        }
        for (let y = 1; y <= LAVA_LEVEL; y++)
          if (col.getBlock(x, y, z) === B.air) col.setBlock(x, y, z, B.lava);
      }
    }

    // 4. Ores.
    this.placeOres(col, cx, cz, biomes);

    // 5. Trees (including ones rooted in neighbouring columns) and plants.
    this.placeTrees(col, x0, z0);
    this.placePlants(col, x0, z0, heights, biomes);
    return col;
  }

  private carveCaves(
    col: Column,
    x0: number,
    z0: number,
    heights: Int16Array,
    maxHeight: number,
  ): void {
    const g = CAVE_GRID;
    const ny = Math.ceil((maxHeight + 2) / g) + 1;
    const n = 16 / g + 1;
    const tunnel = new Float32Array(n * n * ny);
    const cavern = new Float32Array(n * n * ny);
    for (let iy = 0; iy < ny; iy++)
      for (let iz = 0; iz < n; iz++)
        for (let ix = 0; ix < n; ix++) {
          const wx = x0 + ix * g;
          const wy = iy * g;
          const wz = z0 + iz * g;
          const a = this.caveA.sample(wx, wy, wz);
          const b = this.caveB.sample(wx, wy, wz);
          // Tunnels widen with depth.
          const width = 0.011 + Math.max(0, 60 - wy) * 0.00012;
          const i = (iy * n + iz) * n + ix;
          tunnel[i] = a * a + b * b - width;
          const depthBias = smoothstep(52, 20, wy);
          cavern[i] =
            0.62 - this.cheese.sample(wx, wy, wz) - depthBias * 0.1 + (1 - depthBias) * 0.5;
        }
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const h = heights[z * 16 + x]!;
        const entrance = this.entrances.sample(x0 + x, z0 + z) > 0.52;
        // Keep a solid roof under water and away from the surface (except at entrances).
        const top = h < SEA_LEVEL + 2 ? h - 8 : entrance ? h : h - 6;
        for (let y = 4; y <= top; y++) {
          if (
            trilinear(tunnel, n, ny, g, x, y, z) < 0 ||
            trilinear(cavern, n, ny, g, x, y, z) < 0
          ) {
            const state = col.getBlock(x, y, z);
            if (state === B.bedrock || state === B.water) continue;
            col.setBlock(x, y, z, B.air);
          }
        }
      }
    }
  }

  private placeOres(col: Column, cx: number, cz: number, biomes: Biome[]): void {
    const rng = new Random(hash2(this.seed ^ 0x0e5, cx, cz));
    for (const vein of ORE_VEINS) {
      for (let a = 0; a < vein.attempts; a++) {
        let x = rng.int(16);
        let y = vein.minY + rng.int(vein.maxY - vein.minY);
        let z = rng.int(16);
        const size = Math.max(1, Math.round(vein.size * (0.5 + rng.next())));
        for (let i = 0; i < size; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && col.getBlock(x, y, z) === B.stone) {
            col.setBlock(x, y, z, vein.state);
          }
          const d = rng.int(6);
          if (d === 0) x++;
          else if (d === 1) x--;
          else if (d === 2) y++;
          else if (d === 3) y--;
          else if (d === 4) z++;
          else z--;
        }
      }
    }
    // Emeralds: single blocks, mountains only.
    if (biomes.some((b) => b === BIOMES.mountains || b === BIOMES.snowyPeaks)) {
      for (let a = 0; a < 4; a++) {
        const x = rng.int(16);
        const y = 30 + rng.int(90);
        const z = rng.int(16);
        if (col.getBlock(x, y, z) === B.stone) col.setBlock(x, y, z, EMERALD);
      }
    }
  }

  private placeTrees(col: Column, x0: number, z0: number): void {
    const place = (wx: number, y: number, wz: number, state: number, isLog: boolean) => {
      const lx = wx - x0;
      const lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 0 || y >= WORLD_HEIGHT) return;
      const current = col.getBlock(lx, y, lz);
      if (current === B.air || (BLOCKS.isReplaceable(current) && !BLOCKS.isLiquid(current))) {
        col.setBlock(lx, y, lz, state);
      } else if (isLog && BLOCKS.blockOf(current).name.endsWith('_leaves')) {
        col.setBlock(lx, y, lz, state);
      }
    };
    const cell = 4;
    const r = MAX_TREE_RADIUS;
    const c0x = Math.floor((x0 - r) / cell);
    const c1x = Math.floor((x0 + 15 + r) / cell);
    const c0z = Math.floor((z0 - r) / cell);
    const c1z = Math.floor((z0 + 15 + r) / cell);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const h = hash2(this.seed ^ 0x7ee5, cx, cz);
        const tx = cx * cell + (h & 3);
        const tz = cz * cell + ((h >>> 2) & 3);
        const cl = this.climate(tx, tz);
        const biome = this.biomeFor(cl);
        if (
          biome.treeDensity <= 0 ||
          hashFloat(hash2(this.seed ^ 0x7ee6, cx, cz)) >= biome.treeDensity
        )
          continue;
        if (cl.height <= SEA_LEVEL || cl.river > 0.2) continue;
        if (this.entrances.sample(tx, tz) > 0.52) continue;
        // Skip steep ground (the surface would be stone there).
        const slope = Math.max(
          Math.abs(cl.height - this.heightAt(tx + 1, tz)),
          Math.abs(cl.height - this.heightAt(tx - 1, tz)),
          Math.abs(cl.height - this.heightAt(tx, tz + 1)),
          Math.abs(cl.height - this.heightAt(tx, tz - 1)),
        );
        if (slope >= 4) continue;
        const rng = new Random(hash2(this.seed ^ 0x7ee7, tx, tz));
        const kind = pickWeighted(biome.trees, rng);
        growTree(kind, place, rng, tx, cl.height + 1, tz);
        // Trees stand on dirt.
        const lx = tx - x0;
        const lz = tz - z0;
        if (
          lx >= 0 &&
          lx < 16 &&
          lz >= 0 &&
          lz < 16 &&
          col.getBlock(lx, cl.height, lz) === B.grass
        ) {
          col.setBlock(lx, cl.height, lz, B.dirt);
        }
      }
    }
  }

  private placePlants(
    col: Column,
    x0: number,
    z0: number,
    heights: Int16Array,
    biomes: Biome[],
  ): void {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const h = heights[z * 16 + x]!;
        const biome = biomes[z * 16 + x]!;
        if (h + 1 >= WORLD_HEIGHT || col.getBlock(x, h + 1, z) !== B.air) continue;
        const ground = col.getBlock(x, h, z);
        const wx = x0 + x;
        const wz = z0 + z;
        const r = hashFloat(hash2(this.seed ^ 0x9a55, wx, wz));
        const r2 = hashFloat(hash2(this.seed ^ 0x9a56, wx, wz));
        if (ground === B.grass || ground === B.snowyGrass) {
          if (
            ground === B.grass &&
            biome.flowers > 0 &&
            this.patches.sample(wx, wz) > 0.3 &&
            r < biome.flowers * 3
          ) {
            const types = biome.flowerTypes;
            const kind =
              types[
                Math.floor(
                  hashFloat(hash2(this.seed, Math.floor(wx / 8), Math.floor(wz / 8))) *
                    types.length,
                )
              ]!;
            col.setBlock(x, h + 1, z, FLOWER_STATES.get(kind)!);
          } else if (r < biome.grass) {
            col.setBlock(x, h + 1, z, r2 < (biome.ferns ?? 0) ? B.fern : B.tallGrass);
          }
          // Sugar cane along shores.
          if (h === SEA_LEVEL && r2 > 0.93 && this.nextToWater(col, x, h, z))
            this.column(col, x, h + 1, z, B.sugarCane, 1 + (Math.floor(r * 10) % 3));
        } else if (ground === B.sand || ground === B.redSand) {
          if (biome.cactus && r < biome.cactus)
            this.column(col, x, h + 1, z, B.cactus, 1 + Math.floor(r2 * 3));
          else if (biome.deadBush && r < (biome.cactus ?? 0) + biome.deadBush)
            col.setBlock(x, h + 1, z, B.deadBush);
          else if (h === SEA_LEVEL && r2 > 0.9 && this.nextToWater(col, x, h, z))
            this.column(col, x, h + 1, z, B.sugarCane, 1 + (Math.floor(r * 10) % 3));
        }
      }
    }
  }

  private nextToWater(col: Column, x: number, y: number, z: number): boolean {
    return (
      (x > 0 && col.getBlock(x - 1, y, z) === B.water) ||
      (x < 15 && col.getBlock(x + 1, y, z) === B.water) ||
      (z > 0 && col.getBlock(x, y, z - 1) === B.water) ||
      (z < 15 && col.getBlock(x, y, z + 1) === B.water)
    );
  }

  private column(
    col: Column,
    x: number,
    y: number,
    z: number,
    state: number,
    height: number,
  ): void {
    for (let i = 0; i < height && y + i < WORLD_HEIGHT; i++) {
      if (col.getBlock(x, y + i, z) !== B.air) return;
      col.setBlock(x, y + i, z, state);
    }
  }
}

/** Trilinear lookup in a grid of `n`×`ny`×`n` samples spaced `g` blocks apart. */
function trilinear(
  field: Float32Array,
  n: number,
  ny: number,
  g: number,
  x: number,
  y: number,
  z: number,
): number {
  const fx = x / g;
  const fy = y / g;
  const fz = z / g;
  const ix = Math.min(n - 2, Math.floor(fx));
  const iy = Math.min(ny - 2, Math.floor(fy));
  const iz = Math.min(n - 2, Math.floor(fz));
  const tx = fx - ix;
  const ty = fy - iy;
  const tz = fz - iz;
  const i000 = (iy * n + iz) * n + ix;
  const i010 = i000 + n * n; // +y
  const i001 = i000 + n; // +z
  const i011 = i010 + n;
  const c00 = field[i000]! + (field[i000 + 1]! - field[i000]!) * tx;
  const c10 = field[i010]! + (field[i010 + 1]! - field[i010]!) * tx;
  const c01 = field[i001]! + (field[i001 + 1]! - field[i001]!) * tx;
  const c11 = field[i011]! + (field[i011 + 1]! - field[i011]!) * tx;
  const a = c00 + (c10 - c00) * ty;
  const b = c01 + (c11 - c01) * ty;
  return a + (b - a) * tz;
}

function pickWeighted(items: readonly (readonly [TreeKind, number])[], rng: Random): TreeKind {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [kind, w] of items) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return items[0]![0];
}
