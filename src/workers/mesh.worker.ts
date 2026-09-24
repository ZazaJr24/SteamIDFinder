/// <reference lib="webworker" />
import { BLOCKS } from '../world/blocks/blocks';
import { transferablesOf, type SectionMesh } from '../render/mesher/geometry';
import { Mesher, type MeshOptions } from '../render/mesher/mesher';

export interface MeshInit {
  type: 'init';
  textureLayers: Record<string, number>;
}

export interface MeshRequest {
  type: 'mesh';
  blocks: Uint16Array;
  light: Uint8Array;
  options: MeshOptions;
}

export interface MeshResponse {
  id: number;
  mesh: SectionMesh;
}

const mesher = new Mesher(BLOCKS);

self.onmessage = (e: MessageEvent<(MeshInit | MeshRequest) & { id?: number }>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    BLOCKS.resolveTextures((name) => msg.textureLayers[name]);
    return;
  }
  try {
    const mesh = mesher.mesh({ blocks: msg.blocks, light: msg.light }, msg.options);
    (self as unknown as Worker).postMessage(
      { id: msg.id!, mesh } satisfies MeshResponse,
      transferablesOf(mesh),
    );
  } catch (error) {
    (self as unknown as Worker).postMessage({ id: msg.id, error: String(error) });
  }
};
