/**
 * Loads the generated texture atlas into a WebGL2 texture array (one layer
 * per 16×16 tile), with hand-built mipmaps that keep cut-out textures (leaves,
 * plants) from fading away in the distance.
 */
import * as THREE from 'three';

export interface TextureManifest {
  tileSize: number;
  columns: number;
  atlas: string;
  count: number;
  textures: Record<string, { index: number; frames: number }>;
}

export interface MipLevel {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface BlockTextures {
  manifest: TextureManifest;
  array: THREE.DataArrayTexture;
  /** Per layer: number of animation frames (1 = static), as an R8 lookup texture. */
  animation: THREE.DataTexture;
  /** name → first layer */
  layers: Record<string, number>;
  /** Raw RGBA of every layer (for particles, item icons). */
  pixels: Uint8Array;
  mipmaps: MipLevel[];
}

const BASE = 'generated/';

export async function loadBlockTextures(): Promise<BlockTextures> {
  const manifest = (await (await fetch(`${BASE}textures.json`)).json()) as TextureManifest;
  const img = new Image();
  img.src = `${BASE}${manifest.atlas}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const atlas = ctx.getImageData(0, 0, img.width, img.height).data;
  return buildBlockTextures(manifest, atlas, img.width);
}

export function buildBlockTextures(
  manifest: TextureManifest,
  atlas: Uint8ClampedArray,
  atlasWidth: number,
): BlockTextures {
  const t = manifest.tileSize;
  const count = manifest.count;
  const pixels = new Uint8Array(t * t * 4 * count);
  for (let layer = 0; layer < count; layer++) {
    const ox = (layer % manifest.columns) * t;
    const oy = Math.floor(layer / manifest.columns) * t;
    for (let y = 0; y < t; y++) {
      const src = ((oy + y) * atlasWidth + ox) * 4;
      pixels.set(atlas.subarray(src, src + t * 4), (layer * t * t + y * t) * 4);
    }
  }

  const array = new THREE.DataArrayTexture(pixels, t, t, count);
  array.format = THREE.RGBAFormat;
  array.type = THREE.UnsignedByteType;
  array.colorSpace = THREE.NoColorSpace;
  array.wrapS = THREE.RepeatWrapping;
  array.wrapT = THREE.RepeatWrapping;
  array.magFilter = THREE.NearestFilter;
  array.minFilter = THREE.NearestMipmapLinearFilter;
  array.generateMipmaps = false;
  const mipmaps = buildMipmaps(pixels, t, count);
  // Setting `mipmaps` makes three allocate the full mip chain; it uploads only
  // level 0 for array textures, so uploadMipmaps() fills in the rest.
  array.mipmaps = mipmaps as unknown as THREE.DataArrayTexture['mipmaps'];
  array.unpackAlignment = 1;
  array.needsUpdate = true;

  const anim = new Uint8Array(count);
  const layers: Record<string, number> = {};
  for (const [name, info] of Object.entries(manifest.textures)) {
    layers[name] = info.index;
    anim[info.index] = info.frames;
  }
  for (let i = 0; i < count; i++) if (!anim[i]) anim[i] = 1;
  const animation = new THREE.DataTexture(anim, count, 1, THREE.RedFormat, THREE.UnsignedByteType);
  animation.needsUpdate = true;

  return { manifest, array, animation, layers, pixels, mipmaps };
}

/**
 * Uploads mip levels 1…n of the block texture array. three.js (r186) only
 * uploads level 0 of a DataArrayTexture, which leaves distant terrain black.
 */
export function uploadMipmaps(renderer: THREE.WebGLRenderer, textures: BlockTextures): void {
  renderer.initTexture(textures.array);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const handle = (renderer.properties.get(textures.array) as { __webglTexture?: WebGLTexture })
    .__webglTexture;
  if (!handle) return;
  renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const count = textures.manifest.count;
  for (let level = 1; level < textures.mipmaps.length; level++) {
    const m = textures.mipmaps[level]!;
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      level,
      0,
      0,
      0,
      m.width,
      m.height,
      count,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      m.data,
    );
  }
  renderer.state.unbindTexture();
}

/**
 * Mip chain for all layers. Colors average only opaque texels; alpha keeps
 * coverage for cut-out textures (0/255 alpha) and averages for translucent ones.
 */
function buildMipmaps(
  level0: Uint8Array,
  size: number,
  count: number,
): { data: Uint8Array; width: number; height: number }[] {
  const levels = [{ data: level0, width: size, height: size }];
  const cutout = new Uint8Array(count);
  for (let l = 0; l < count; l++) {
    let binary = true;
    for (let i = 0; i < size * size; i++) {
      const a = level0[(l * size * size + i) * 4 + 3]!;
      if (a !== 0 && a !== 255) {
        binary = false;
        break;
      }
    }
    cutout[l] = binary ? 1 : 0;
  }
  let prev = level0;
  let s = size;
  while (s > 1) {
    const n = s >> 1;
    const next = new Uint8Array(n * n * 4 * count);
    for (let l = 0; l < count; l++) {
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          let w = 0;
          for (let k = 0; k < 4; k++) {
            const sx = x * 2 + (k & 1);
            const sy = y * 2 + (k >> 1);
            const i = (l * s * s + sy * s + sx) * 4;
            const alpha = prev[i + 3]!;
            a += alpha;
            if (alpha > 0) {
              r += prev[i]! * alpha;
              g += prev[i + 1]! * alpha;
              b += prev[i + 2]! * alpha;
              w += alpha;
            }
          }
          const o = (l * n * n + y * n + x) * 4;
          next[o] = w ? r / w : 0;
          next[o + 1] = w ? g / w : 0;
          next[o + 2] = w ? b / w : 0;
          next[o + 3] = cutout[l] ? (a / 4 >= 90 ? 255 : 0) : a / 4;
        }
    }
    levels.push({ data: next, width: n, height: n });
    prev = next;
    s = n;
  }
  return levels;
}
