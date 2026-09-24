import { Random } from '../../src/core/random';

/**
 * Value noise that repeats every `size` pixels, so textures tile seamlessly.
 * `cells` lattice cells span one period.
 */
export class PeriodicNoise {
  private readonly values: Float32Array;

  constructor(
    rng: Random,
    private readonly cells: number,
    private readonly size = 16,
    private readonly cellsY = cells,
  ) {
    this.values = new Float32Array(cells * cellsY);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rng.next();
  }

  private at(i: number, j: number): number {
    const x = ((i % this.cells) + this.cells) % this.cells;
    const y = ((j % this.cellsY) + this.cellsY) % this.cellsY;
    return this.values[y * this.cells + x]!;
  }

  /** Sample at pixel coordinates, returns [0, 1]. */
  sample(px: number, py: number): number {
    const u = ((px + 0.5) * this.cells) / this.size;
    const v = ((py + 0.5) * this.cellsY) / this.size;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fx = smooth(u - i);
    const fy = smooth(v - j);
    const a = this.at(i, j);
    const b = this.at(i + 1, j);
    const c = this.at(i, j + 1);
    const d = this.at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export interface Octave {
  cells: number;
  weight: number;
  cellsY?: number;
}

/** Fractal sum of periodic noises, normalized to [0, 1]. */
export function fbm(rng: Random, octaves: Octave[], size = 16): (x: number, y: number) => number {
  const layers = octaves.map((o) => ({
    n: new PeriodicNoise(rng, o.cells, size, o.cellsY ?? o.cells),
    w: o.weight,
  }));
  const total = octaves.reduce((s, o) => s + o.weight, 0);
  return (x, y) => layers.reduce((s, l) => s + l.n.sample(x, y) * l.w, 0) / total;
}

/** Stretches a [0,1] value around 0.5 so noise uses the whole palette. */
export function contrast(v: number, amount: number): number {
  return Math.min(1, Math.max(0, (v - 0.5) * amount + 0.5));
}

export interface VoronoiCell {
  /** Distance to the nearest feature point. */
  d1: number;
  /** Distance to the second nearest point (d2 - d1 ≈ 0 on cell borders). */
  d2: number;
  /** Stable id of the nearest cell. */
  id: number;
  /** Nearest feature point position (unwrapped). */
  cx: number;
  cy: number;
}

/** Periodic Voronoi (cellular) noise over a `cells`×`cells` jittered grid. */
export class PeriodicVoronoi {
  private readonly points: Float32Array;

  constructor(
    rng: Random,
    private readonly cells: number,
    private readonly size = 16,
    jitter = 0.8,
  ) {
    this.points = new Float32Array(cells * cells * 2);
    for (let i = 0; i < cells * cells; i++) {
      this.points[i * 2] = 0.5 + (rng.next() - 0.5) * jitter;
      this.points[i * 2 + 1] = 0.5 + (rng.next() - 0.5) * jitter;
    }
  }

  sample(px: number, py: number): VoronoiCell {
    const cs = this.size / this.cells;
    const u = (px + 0.5) / cs;
    const v = (py + 0.5) / cs;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    let d1 = Infinity;
    let d2 = Infinity;
    let id = 0;
    let cx = 0;
    let cy = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = i0 + di;
        const j = j0 + dj;
        const wi = ((i % this.cells) + this.cells) % this.cells;
        const wj = ((j % this.cells) + this.cells) % this.cells;
        const k = wj * this.cells + wi;
        const fx = i + this.points[k * 2]!;
        const fy = j + this.points[k * 2 + 1]!;
        const d = Math.hypot(fx - u, fy - v) * cs;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = k;
          cx = fx * cs;
          cy = fy * cs;
        } else if (d < d2) d2 = d;
      }
    }
    return { d1, d2, id, cx, cy };
  }
}
