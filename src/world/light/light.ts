/**
 * Minecraft-style flood-fill lighting with two channels (sky and block,
 * 0–15 each), stored packed in one byte per block.
 *
 * The same engine lights a fresh column inside a worker (where everything
 * outside the column is "not loaded") and updates the live world on the main
 * thread (block edits, stitching newly loaded neighbours).
 */
import { MAX_LIGHT, WORLD_HEIGHT } from '../../config';
import type { BlockRegistry } from '../blocks/registry';
import { FULL_SKY, type Column } from '../chunk';

export interface LightWorld {
  /** Block state, or -1 where nothing is loaded (light does not pass). */
  getState(x: number, y: number, z: number): number;
  getLight(x: number, y: number, z: number): number;
  setLight(x: number, y: number, z: number, packed: number): void;
}

export const enum Channel {
  Sky = 0,
  Block = 1,
}

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
const DOWN = 3;

export function skyOf(packed: number): number {
  return packed >> 4;
}

export function blockLightOf(packed: number): number {
  return packed & 15;
}

function get(packed: number, ch: Channel): number {
  return ch === Channel.Sky ? packed >> 4 : packed & 15;
}

function put(packed: number, ch: Channel, level: number): number {
  return ch === Channel.Sky ? (packed & 0x0f) | (level << 4) : (packed & 0xf0) | level;
}

/** Growable FIFO of int quadruples (x, y, z, level). */
class Queue {
  private data = new Int32Array(4096 * 4);
  private head = 0;
  private tail = 0;

  push(x: number, y: number, z: number, v = 0): void {
    if (this.tail + 4 > this.data.length) {
      if (this.head > 0) {
        this.data.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      }
      if (this.tail + 4 > this.data.length) {
        const bigger = new Int32Array(this.data.length * 2);
        bigger.set(this.data.subarray(0, this.tail));
        this.data = bigger;
      }
    }
    const d = this.data;
    d[this.tail] = x;
    d[this.tail + 1] = y;
    d[this.tail + 2] = z;
    d[this.tail + 3] = v;
    this.tail += 4;
  }

  get empty(): boolean {
    return this.head >= this.tail;
  }

  /** Pops into `out` (x, y, z, v). */
  pop(out: Int32Array): void {
    const d = this.data;
    out[0] = d[this.head]!;
    out[1] = d[this.head + 1]!;
    out[2] = d[this.head + 2]!;
    out[3] = d[this.head + 3]!;
    this.head += 4;
    if (this.head === this.tail) this.head = this.tail = 0;
  }
}

export class LightEngine {
  private readonly spread = [new Queue(), new Queue()];
  private readonly removal = new Queue();
  private readonly tmp = new Int32Array(4);

  constructor(private readonly reg: BlockRegistry) {}

  /** Queues a position whose current light should flow outward. */
  seed(ch: Channel, x: number, y: number, z: number): void {
    this.spread[ch]!.push(x, y, z);
  }

  /** Runs both channels until stable. */
  run(world: LightWorld): void {
    this.propagate(world, Channel.Sky);
    this.propagate(world, Channel.Block);
  }

  private propagate(world: LightWorld, ch: Channel): void {
    const q = this.spread[ch]!;
    const p = this.tmp;
    const opacity = this.reg.opacity;
    while (!q.empty) {
      q.pop(p);
      const x = p[0]!;
      const y = p[1]!;
      const z = p[2]!;
      const level = get(world.getLight(x, y, z), ch);
      if (level <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const dir = DIRS[d]!;
        const nx = x + dir[0];
        const ny = y + dir[1];
        const nz = z + dir[2];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const state = world.getState(nx, ny, nz);
        if (state < 0) continue;
        const op = opacity[state]!;
        if (op >= MAX_LIGHT) continue;
        // Sunlight travels straight down without loss through clear blocks.
        const next =
          ch === Channel.Sky && d === DOWN && level === MAX_LIGHT && op === 0
            ? MAX_LIGHT
            : level - Math.max(1, op);
        if (next <= 0) continue;
        const packed = world.getLight(nx, ny, nz);
        if (get(packed, ch) >= next) continue;
        world.setLight(nx, ny, nz, put(packed, ch, next));
        q.push(nx, ny, nz);
      }
    }
  }

  /**
   * Removes light that depended on (x, y, z), whose old level was `level`.
   * Neighbours lit from elsewhere are queued to flow back in.
   */
  private remove(
    world: LightWorld,
    ch: Channel,
    x: number,
    y: number,
    z: number,
    level: number,
  ): void {
    const rq = this.removal;
    const sq = this.spread[ch]!;
    const p = this.tmp;
    const emission = this.reg.emission;
    rq.push(x, y, z, level);
    while (!rq.empty) {
      rq.pop(p);
      const px = p[0]!;
      const py = p[1]!;
      const pz = p[2]!;
      const v = p[3]!;
      for (let d = 0; d < 6; d++) {
        const dir = DIRS[d]!;
        const nx = px + dir[0];
        const ny = py + dir[1];
        const nz = pz + dir[2];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const state = world.getState(nx, ny, nz);
        if (state < 0) continue;
        const packed = world.getLight(nx, ny, nz);
        const l = get(packed, ch);
        if (l === 0) continue;
        const sunColumn = ch === Channel.Sky && d === DOWN && v === MAX_LIGHT && l === MAX_LIGHT;
        if (l < v || sunColumn) {
          world.setLight(nx, ny, nz, put(packed, ch, 0));
          rq.push(nx, ny, nz, l);
          // A light source that was dimmed by the removal shines again.
          const em = ch === Channel.Block ? emission[state]! : 0;
          if (em > 0) {
            world.setLight(nx, ny, nz, put(put(packed, ch, 0), ch, em));
            sq.push(nx, ny, nz);
          }
        } else {
          sq.push(nx, ny, nz);
        }
      }
    }
  }

  /** Updates light after the block at (x, y, z) changed to `newState`. */
  onBlockChanged(world: LightWorld, x: number, y: number, z: number, newState: number): void {
    const emission = this.reg.emission[newState]!;
    const clear = this.reg.opacity[newState]! < MAX_LIGHT;
    for (const ch of [Channel.Sky, Channel.Block]) {
      const packed = world.getLight(x, y, z);
      const old = get(packed, ch);
      if (old > 0) {
        world.setLight(x, y, z, put(packed, ch, 0));
        this.remove(world, ch, x, y, z, old);
      }
      if (ch === Channel.Block && emission > 0) {
        world.setLight(x, y, z, put(world.getLight(x, y, z), ch, emission));
        this.spread[ch]!.push(x, y, z);
      }
      if (clear) {
        for (const dir of DIRS) {
          const ny = y + dir[1];
          if (ny >= WORLD_HEIGHT) {
            // Open sky above: seed the block itself with full sunlight.
            if (ch === Channel.Sky) {
              world.setLight(x, y, z, put(world.getLight(x, y, z), ch, MAX_LIGHT));
              this.spread[ch]!.push(x, y, z);
            }
            continue;
          }
          if (ny < 0) continue;
          this.spread[ch]!.push(x + dir[0], ny, z + dir[2]);
        }
      }
      this.propagate(world, ch);
    }
  }

  /**
   * Initial light for a freshly generated column, treating everything outside
   * it as unloaded. `ox`/`oz` are the column's world-space origin.
   */
  lightColumn(col: Column, ox: number, oz: number): void {
    const opacity = this.reg.opacity;
    const emission = this.reg.emission;
    const top = col.topY();
    // 1. Straight-down sunlight.
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let level = MAX_LIGHT;
        for (let y = top; y >= 0; y--) {
          const state = col.getBlock(x, y, z);
          const op = opacity[state]!;
          if (op >= MAX_LIGHT) level = 0;
          else if (op > 0) level = Math.max(0, level - op);
          const em = emission[state]!;
          col.setLight(x, y, z, (level << 4) | em);
        }
      }
    }
    const world: LightWorld = {
      getState: (x, y, z) => {
        const lx = x - ox;
        const lz = z - oz;
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return -1;
        return col.getBlock(lx, y, lz);
      },
      getLight: (x, y, z) => col.getLight(x - ox, y, z - oz),
      setLight: (x, y, z, v) => col.setLight(x - ox, y, z - oz, v),
    };
    // 2. Seeds: sunlit blocks next to darker ones spread sideways; light sources spread.
    const skyQ = this.spread[Channel.Sky]!;
    const blockQ = this.spread[Channel.Block]!;
    for (let y = 0; y <= Math.min(top + 1, WORLD_HEIGHT - 1); y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const packed = col.getLight(x, y, z);
          const sky = packed >> 4;
          if ((packed & 15) > 0) blockQ.push(ox + x, y, oz + z);
          if (sky <= 1) continue;
          if (
            (x > 0 && col.getLight(x - 1, y, z) >> 4 < sky - 1) ||
            (x < 15 && col.getLight(x + 1, y, z) >> 4 < sky - 1) ||
            (z > 0 && col.getLight(x, y, z - 1) >> 4 < sky - 1) ||
            (z < 15 && col.getLight(x, y, z + 1) >> 4 < sky - 1) ||
            (y > 0 && col.getLight(x, y - 1, z) >> 4 < sky - 1)
          ) {
            skyQ.push(ox + x, y, oz + z);
          }
        }
      }
    }
    this.run(world);
  }

  /**
   * Lets light flow across the border between two loaded columns. Call after
   * a column is added, once per loaded horizontal neighbour.
   */
  stitch(world: LightWorld, a: Column, b: Column): void {
    const dx = b.cx - a.cx;
    const dz = b.cz - a.cz;
    const maxY = Math.min(WORLD_HEIGHT - 1, Math.max(a.topY(), b.topY()) + MAX_LIGHT + 1);
    const ax = a.cx * 16;
    const az = a.cz * 16;
    for (let y = 0; y <= maxY; y++) {
      for (let i = 0; i < 16; i++) {
        let x1: number, z1: number, x2: number, z2: number;
        if (dx !== 0) {
          x1 = ax + (dx > 0 ? 15 : 0);
          x2 = x1 + dx;
          z1 = z2 = az + i;
        } else {
          z1 = az + (dz > 0 ? 15 : 0);
          z2 = z1 + dz;
          x1 = x2 = ax + i;
        }
        for (const ch of [Channel.Sky, Channel.Block]) {
          if (get(world.getLight(x1, y, z1), ch) > 1) this.spread[ch]!.push(x1, y, z1);
          if (get(world.getLight(x2, y, z2), ch) > 1) this.spread[ch]!.push(x2, y, z2);
        }
      }
    }
    this.run(world);
  }
}

export { FULL_SKY };
