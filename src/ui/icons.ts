/**
 * Inventory icons. Cubes and shaped blocks (stairs, fences, beds …) are
 * rendered in 3D with the real block mesh; plants, torches, ladders and
 * doors use flat sprites like in the classic game.
 */
import * as THREE from 'three';
import { BLOCKS } from '../world/blocks/blocks';
import { Model } from '../world/blocks/registry';
import { FULL_SKY } from '../world/chunk';
import type { BlockTextures } from '../render/textures';
import { Mesher, PAD, padIndex } from '../render/mesher/mesher';
import { layerGeometry, TerrainMaterials } from '../render/world-renderer';

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

/** Renders block meshes into a small render target with the main renderer. */
export class IconRenderer {
  private readonly target = new THREE.WebGLRenderTarget(SIZE * 2, SIZE * 2);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 20);
  private readonly mesher = new Mesher(BLOCKS);
  private readonly materials: TerrainMaterials;
  private readonly blocks = new Uint16Array(PAD * PAD * PAD);
  private readonly light = new Uint8Array(PAD * PAD * PAD);
  private readonly pixels = new Uint8Array(SIZE * 2 * SIZE * 2 * 4);

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    textures: BlockTextures,
  ) {
    this.materials = new TerrainMaterials(textures);
    this.materials.setFog(1000, 2000);
    this.camera.position.set(4, 3.3, 4);
    this.camera.lookAt(0, 0, 0);
  }

  /** Data URL of a 3D rendering of `state` (and its partner block for beds). */
  render(state: number): string {
    this.blocks.fill(0);
    this.light.fill(FULL_SKY);
    const block = BLOCKS.blockOf(state);
    let extent = 1;
    if (block.name.endsWith('_bed')) {
      this.blocks[padIndex(0, 0, 0)] = block.state({ facing: 'east', part: 'foot' });
      this.blocks[padIndex(1, 0, 0)] = block.state({ facing: 'east', part: 'head' });
      extent = 2;
    } else {
      this.blocks[padIndex(0, 0, 0)] = state;
    }
    const mesh = this.mesher.mesh(
      { blocks: this.blocks, light: this.light },
      { fastLeaves: false },
    );
    const group = new THREE.Group();
    mesh.layers.forEach((g, layer) => {
      if (!g) return;
      const geo = layerGeometry(g);
      geo.translate(-extent / 2, -0.5, -0.5);
      const m = new THREE.Mesh(geo, this.materials.list[layer]!);
      m.renderOrder = layer;
      group.add(m);
    });
    // Zoom small blocks (buttons, plates, levers) so they fill the icon.
    let zoom = extent > 1 ? 0.68 : 1;
    if (extent === 1) {
      const sel = BLOCKS.selectionOf(state);
      const size = Math.max(sel[3]! - sel[0]!, sel[4]! - sel[1]!, sel[5]! - sel[2]!);
      zoom = Math.min(2.2, Math.max(1, 0.85 / Math.max(0.2, size)));
      const centerY = (sel[1]! + sel[4]!) / 2 - 0.5;
      group.position.set(
        -((sel[0]! + sel[3]!) / 2 - 0.5),
        -centerY,
        -((sel[2]! + sel[5]!) / 2 - 0.5),
      );
    }
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    this.scene.add(group);
    const r = this.renderer;
    const previous = r.getRenderTarget();
    const clearAlpha = r.getClearAlpha();
    const clearColor = r.getClearColor(new THREE.Color());
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    r.readRenderTargetPixels(this.target, 0, 0, SIZE * 2, SIZE * 2, this.pixels);
    r.setRenderTarget(previous);
    r.setClearColor(clearColor, clearAlpha);
    this.scene.remove(group);
    for (const child of group.children) (child as THREE.Mesh).geometry.dispose();

    // Flip vertically (GL rows start at the bottom) and downsample 2× for smooth edges.
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    const src = this.pixels;
    const w2 = SIZE * 2;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        let r0 = 0;
        let g0 = 0;
        let b0 = 0;
        let a0 = 0;
        for (let k = 0; k < 4; k++) {
          const sx = x * 2 + (k & 1);
          const sy = SIZE * 2 - 1 - (y * 2 + (k >> 1));
          const i = (sy * w2 + sx) * 4;
          const a = src[i + 3]!;
          r0 += src[i]! * a;
          g0 += src[i + 1]! * a;
          b0 += src[i + 2]! * a;
          a0 += a;
        }
        const o = (y * SIZE + x) * 4;
        img.data[o] = a0 ? r0 / a0 : 0;
        img.data[o + 1] = a0 ? g0 / a0 : 0;
        img.data[o + 2] = a0 ? b0 / a0 : 0;
        img.data[o + 3] = a0 / 4;
      }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
}

let icons: IconRenderer | null = null;

export function setIconRenderer(r: IconRenderer): void {
  icons = r;
  cache.clear();
}

function isSprite(state: number): boolean {
  const name = BLOCKS.blockOf(state).name;
  return (
    BLOCKS.model[state] === Model.Cross ||
    name.endsWith('torch') ||
    name === 'ladder' ||
    name === 'glass_pane' ||
    name.endsWith('_door') ||
    name === 'lever'
  );
}

function spriteIcon(textures: BlockTextures, state: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const name = BLOCKS.blockOf(state).name;
  const layer = (n: string) => textures.layers[n] ?? textures.layers['missing'] ?? 0;
  if (name.endsWith('_door')) {
    const base = name.replace(/_door$/, '');
    ctx.drawImage(tileCanvas(textures, layer(`${base}_door_top`)), 16, 0, 32, 32);
    ctx.drawImage(tileCanvas(textures, layer(`${base}_door_bottom`)), 16, 32, 32, 32);
  } else {
    const own = textures.layers[name];
    const face = BLOCKS.boxesOf(state)?.[0]?.faces.find((f) => f);
    const l =
      name === 'glass_pane' ? layer('glass') : (own ?? face?.layer ?? BLOCKS.faceLayer[state * 6]!);
    ctx.drawImage(tileCanvas(textures, l), 4, 4, SIZE - 8, SIZE - 8);
  }
  return canvas.toDataURL();
}

export function blockIcon(textures: BlockTextures, state: number): string {
  const cached = cache.get(state);
  if (cached) return cached;
  const url = !icons || isSprite(state) ? spriteIcon(textures, state) : icons.render(state);
  cache.set(state, url);
  return url;
}
