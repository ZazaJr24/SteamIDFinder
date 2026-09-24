/// <reference lib="webworker" />
import { BLOCKS } from '../world/blocks/blocks';
import type { ColumnData } from '../world/chunk';
import { TerrainGenerator } from '../world/gen/terrain';
import { LightEngine } from '../world/light/light';

export interface GenRequest {
  type: 'generate';
  seed: number;
  cx: number;
  cz: number;
}

export interface GenResponse {
  id: number;
  column: ColumnData;
}

let generator: TerrainGenerator | null = null;
const light = new LightEngine(BLOCKS);

self.onmessage = (e: MessageEvent<GenRequest & { id: number }>) => {
  const { id, seed, cx, cz } = e.data;
  try {
    if (!generator || generator.seed !== seed) generator = new TerrainGenerator(seed);
    const col = generator.generateColumn(cx, cz);
    light.lightColumn(col, cx * 16, cz * 16);
    const column = col.toData();
    const transfer: Transferable[] = [];
    for (const b of column.blocks) if (b) transfer.push(b.buffer);
    for (const l of column.light) if (l) transfer.push(l.buffer);
    (self as unknown as Worker).postMessage({ id, column } satisfies GenResponse, transfer);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String(error) });
  }
};
