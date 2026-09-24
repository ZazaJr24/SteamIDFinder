/**
 * Keeps the columns around the player loaded: requests generation (or saved
 * data) nearest-first and unloads columns that fell out of range.
 */
import { columnKey, Column, type ColumnData } from './chunk';
import type { World } from './world';
import type { WorkerPool } from '../workers/pool';
import type { GenRequest, GenResponse } from '../workers/gen.worker';

export interface ChunkSource {
  /** Saved column data, or null to generate it. */
  load(cx: number, cz: number): Promise<ColumnData | null>;
  /** Called before a modified column is dropped from memory. */
  unload(col: Column): void;
}

export class ChunkManager {
  private readonly pending = new Set<number>();
  private generation = 0;
  radius = 8;

  constructor(
    private readonly world: World,
    private readonly pool: WorkerPool<GenRequest, GenResponse>,
    private readonly source: ChunkSource | null = null,
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Columns within the radius that are loaded, as a fraction (for loading screens). */
  progress(cx: number, cz: number, radius: number): number {
    let total = 0;
    let loaded = 0;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        total++;
        if (this.world.columns.has(columnKey(cx + dx, cz + dz))) loaded++;
      }
    return total ? loaded / total : 1;
  }

  update(px: number, pz: number): void {
    const pcx = Math.floor(px / 16);
    const pcz = Math.floor(pz / 16);
    // One extra ring so the outermost visible columns have neighbours to mesh against.
    const load = this.radius + 1;
    const maxInFlight = this.pool.size * 3;

    if (this.pending.size < maxInFlight) {
      const wanted: [number, number, number][] = [];
      for (let dz = -load; dz <= load; dz++)
        for (let dx = -load; dx <= load; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > (load + 0.5) * (load + 0.5)) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          const key = columnKey(cx, cz);
          if (this.world.columns.has(key) || this.pending.has(key)) continue;
          wanted.push([d2, cx, cz]);
        }
      wanted.sort((a, b) => a[0] - b[0]);
      for (const [, cx, cz] of wanted) {
        if (this.pending.size >= maxInFlight) break;
        this.request(cx, cz);
      }
    }

    // Unload with some hysteresis so walking back and forth doesn't thrash.
    const keep = load + 2;
    for (const col of [...this.world.columns.values()]) {
      const dx = col.cx - pcx;
      const dz = col.cz - pcz;
      if (dx * dx + dz * dz > keep * keep) {
        if (col.unsaved) this.source?.unload(col);
        this.world.removeColumn(col.cx, col.cz);
      }
    }
  }

  private request(cx: number, cz: number): void {
    const key = columnKey(cx, cz);
    this.pending.add(key);
    const gen = this.generation;
    const finish = (data: ColumnData | null) => {
      this.pending.delete(key);
      if (gen !== this.generation || !data) return;
      if (this.world.columns.has(key)) return;
      this.world.addColumn(Column.fromData(data));
    };
    const generate = () =>
      this.pool
        .request({ type: 'generate', seed: this.world.seed, cx, cz })
        .then((res) => finish(res.column))
        .catch((error: unknown) => {
          console.error(error);
          this.pending.delete(key);
        });
    if (!this.source) {
      void generate();
      return;
    }
    this.source
      .load(cx, cz)
      .then((saved) => {
        if (saved) {
          const col = Column.fromData(saved);
          col.modified = true;
          this.pending.delete(key);
          if (gen !== this.generation || this.world.columns.has(key)) return;
          // Saves hold no light; compute it like the generator worker does.
          this.world.light.lightColumn(col, cx * 16, cz * 16);
          this.world.addColumn(col);
        } else void generate();
      })
      .catch(() => void generate());
  }

  /** Forget in-flight requests (world switched). */
  reset(): void {
    this.generation++;
    this.pending.clear();
  }
}
