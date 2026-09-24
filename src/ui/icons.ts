/** Renders inventory icons for blocks from the texture array pixels. */
import { BLOCKS } from '../world/blocks/blocks';
import { Face, Model } from '../world/blocks/registry';
import type { BlockTextures } from '../render/textures';

const SIZE = 64;
const cache = new Map<number, string>();

function tileCanvas(textures: BlockTextures, layer: number): HTMLCanvasElement {
  const t = textures.manifest.tileSize;
  const c = document.createElement('canvas');
  c.width = t;
  c.height = t;
  const img = new ImageData(t, t);
  img.data.set(textures.pixels.subarray(layer * t * t * 4, (layer + 1) * t * t * 4));
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** Texture used for flat (sprite) icons. */
function spriteLayer(textures: BlockTextures, state: number): number {
  const name = BLOCKS.blockOf(state).name;
  const own = textures.layers[name];
  if (own !== undefined) return own;
  const boxes = BLOCKS.boxes[state];
  const face = boxes?.[0]?.faces.find((f) => f);
  return face ? face.layer : BLOCKS.faceLayer[state * 6]!;
}

export function blockIcon(textures: BlockTextures, state: number): string {
  const cached = cache.get(state);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const model = BLOCKS.model[state];
  const t = textures.manifest.tileSize;
  if (model === Model.Cube || model === Model.Liquid || BLOCKS.blockOf(state).name === 'cactus') {
    const faceLayer = (f: Face) => BLOCKS.faceLayer[state * 6 + f]!;
    const cactus = model === Model.Boxes;
    const top = cactus ? textures.layers['cactus_top']! : faceLayer(Face.Up);
    const left = cactus ? textures.layers['cactus_side']! : faceLayer(Face.South);
    const right = cactus ? textures.layers['cactus_side']! : faceLayer(Face.East);
    const s = SIZE / 64;
    const draw = (
      layer: number,
      m: [number, number, number, number, number, number],
      shade: number,
    ) => {
      ctx.save();
      ctx.setTransform(m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s, m[5] * s);
      ctx.drawImage(tileCanvas(textures, layer), 0, 0);
      if (shade > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(0, 0, t, t);
      }
      ctx.restore();
    };
    const k = 30 / t;
    draw(top, [k, -15 / t, k, 15 / t, 2, 17], 0);
    draw(left, [k, 15 / t, 0, k, 2, 17], 0.22);
    draw(right, [k, -15 / t, 0, k, 32, 32], 0.4);
  } else {
    ctx.drawImage(tileCanvas(textures, spriteLayer(textures, state)), 4, 4, SIZE - 8, SIZE - 8);
  }
  const url = canvas.toDataURL();
  cache.set(state, url);
  return url;
}
