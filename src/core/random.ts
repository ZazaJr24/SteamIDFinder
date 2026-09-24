/** Deterministic, seedable random helpers. Identical results on every device. */

/** 32-bit integer hash (lowbias32 by Chris Wellons). */
export function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Hash of a seed and 2D integer coordinates, as uint32. */
export function hash2(seed: number, x: number, z: number): number {
  return hash32(seed ^ hash32(x ^ hash32(z ^ 0x85ebca6b)));
}

/** Hash of a seed and 3D integer coordinates, as uint32. */
export function hash3(seed: number, x: number, y: number, z: number): number {
  return hash32(seed ^ hash32(x ^ hash32(y ^ hash32(z ^ 0x27d4eb2f))));
}

/** Hash → float in [0, 1). */
export function hashFloat(h: number): number {
  return h / 4294967296;
}

/** Turns any string (e.g. a user-entered seed) into a 32-bit seed. */
export function seedFromString(text: string): number {
  const trimmed = text.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(BigInt.asIntN(32, BigInt(trimmed))) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hash32(h);
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

/** Small fast PRNG (mulberry32). */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
}
