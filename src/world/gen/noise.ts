import {
  createNoise2D,
  createNoise3D,
  type NoiseFunction2D,
  type NoiseFunction3D,
} from 'simplex-noise';
import { Random } from '../../core/random';

/** Seeded 2D fractal noise, output roughly in [-1, 1]. */
export class Fbm2 {
  private readonly layers: NoiseFunction2D[];

  constructor(
    seed: number,
    private readonly scale: number,
    private readonly octaves = 4,
    private readonly persistence = 0.5,
    private readonly lacunarity = 2,
  ) {
    const rng = new Random(seed);
    this.layers = Array.from({ length: octaves }, () => createNoise2D(() => rng.next()));
  }

  sample(x: number, z: number): number {
    let amp = 1;
    let freq = 1 / this.scale;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < this.octaves; i++) {
      sum += this.layers[i]!(x * freq, z * freq) * amp;
      norm += amp;
      amp *= this.persistence;
      freq *= this.lacunarity;
    }
    return sum / norm;
  }
}

/** Seeded 3D fractal noise, output roughly in [-1, 1]. */
export class Fbm3 {
  private readonly layers: NoiseFunction3D[];

  constructor(
    seed: number,
    private readonly scaleXZ: number,
    private readonly scaleY: number,
    private readonly octaves = 2,
  ) {
    const rng = new Random(seed);
    this.layers = Array.from({ length: octaves }, () => createNoise3D(() => rng.next()));
  }

  sample(x: number, y: number, z: number): number {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    let fxz = 1 / this.scaleXZ;
    let fy = 1 / this.scaleY;
    for (let i = 0; i < this.octaves; i++) {
      sum += this.layers[i]!(x * fxz, y * fy, z * fxz) * amp;
      norm += amp;
      amp *= 0.5;
      fxz *= 2;
      fy *= 2;
    }
    return sum / norm;
  }
}

/** Piecewise-linear curve through (x, y) points sorted by x. */
export function spline(points: readonly (readonly [number, number])[], x: number): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return points[points.length - 1]![1];
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
