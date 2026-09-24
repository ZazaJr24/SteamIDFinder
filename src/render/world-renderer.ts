/**
 * Owns the terrain materials and one mesh per section and render layer.
 * Each frame it hands the nearest out-of-date sections to the mesh workers.
 */
import * as THREE from 'three';
import { SECTIONS_PER_COLUMN } from '../config';
import { Layer } from '../world/blocks/registry';
import { columnKey } from '../world/chunk';
import type { World } from '../world/world';
import type { WorkerPool } from '../workers/pool';
import type { MeshRequest, MeshResponse } from '../workers/mesh.worker';
import type { LayerGeometry, SectionMesh } from './mesher/geometry';
import { PAD, type MeshOptions } from './mesher/mesher';
import { terrainFragment, terrainVertex } from './shaders/terrain';
import type { BlockTextures } from './textures';

const PADDED = PAD * PAD * PAD;

interface SectionEntry {
  cx: number;
  sy: number;
  cz: number;
  meshes: (THREE.Mesh | null)[];
}

export interface TerrainUniforms {
  uTime: { value: number };
  uDaylight: { value: number };
  uSkyLight: { value: THREE.Color };
  uBlockLight: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uMinLight: { value: number };
}

function decodeKey(key: number): [number, number, number] {
  const sy = key % 32;
  const ck = (key - sy) / 32;
  const cz = (ck % 0x10000) - 0x8000;
  const cx = Math.floor(ck / 0x10000) - 0x8000;
  return [cx, sy, cz];
}

export class WorldRenderer {
  readonly group = new THREE.Group();
  readonly uniforms: TerrainUniforms;
  private readonly materials: THREE.RawShaderMaterial[];
  private readonly sections = new Map<number, SectionEntry>();
  private readonly inFlight = new Set<number>();
  /**
   * Columns whose sections have all been meshed once. Until then a column's
   * meshes stay hidden, so nobody sees into caves through a surface section
   * that is still being built.
   */
  private readonly revealed = new Set<number>();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), 14);
  options: MeshOptions = { fastLeaves: false };
  /** Sections meshed since creation (for stats and loading screens). */
  meshedCount = 0;

  constructor(
    textures: BlockTextures,
    private readonly pool: WorkerPool<MeshRequest, MeshResponse>,
  ) {
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;
    this.uniforms = {
      uTime: { value: 0 },
      uDaylight: { value: 1 },
      uSkyLight: { value: new THREE.Color(1, 1, 1) },
      uBlockLight: { value: new THREE.Color(1.05, 0.88, 0.66) },
      uFogColor: { value: new THREE.Color(0x9cc4ff) },
      uFogNear: { value: 80 },
      uFogFar: { value: 120 },
      uMinLight: { value: 0.035 },
    };
    const make = (layer: Layer) => {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: terrainVertex,
        fragmentShader: terrainFragment,
        uniforms: {
          ...this.uniforms,
          uTextures: { value: textures.array },
          uAnim: { value: textures.animation },
          uAlphaTest: {
            value: layer === Layer.Cutout ? 0.5 : layer === Layer.Transparent ? 0.01 : 0,
          },
        },
        transparent: layer === Layer.Transparent,
        depthWrite: layer !== Layer.Transparent,
        side: THREE.FrontSide,
      });
      m.name = ['terrain-opaque', 'terrain-cutout', 'terrain-transparent'][layer]!;
      return m;
    };
    this.materials = [make(Layer.Opaque), make(Layer.Cutout), make(Layer.Transparent)];
  }

  get sectionCount(): number {
    return this.sections.size;
  }

  get pendingCount(): number {
    return this.inFlight.size;
  }

  setFog(near: number, far: number): void {
    this.uniforms.uFogNear.value = near;
    this.uniforms.uFogFar.value = far;
  }

  /** Dispatches mesh jobs for the nearest dirty sections. */
  update(world: World, camera: THREE.Vector3): void {
    // Drop meshes of unloaded columns.
    for (const [key, entry] of this.sections) {
      if (!world.columns.has(columnKey(entry.cx, entry.cz))) this.remove(key);
    }
    for (const ck of this.revealed) if (!world.columns.has(ck)) this.revealed.delete(ck);

    const pcx = Math.floor(camera.x / 16);
    const pcy = Math.floor(camera.y / 16);
    const pcz = Math.floor(camera.z / 16);
    const busy = new Set<number>();
    const candidates: [number, number][] = [];
    for (const key of world.dirty) {
      const [cx, sy, cz] = decodeKey(key);
      const ck = columnKey(cx, cz);
      if (sy < 0 || sy >= SECTIONS_PER_COLUMN || !world.columns.has(ck)) {
        world.dirty.delete(key);
        continue;
      }
      busy.add(ck);
      if (this.inFlight.has(key) || !world.hasNeighborhood(cx, cz)) continue;
      const dx = cx - pcx;
      const dy = (sy - pcy) * 0.6;
      const dz = cz - pcz;
      candidates.push([dx * dx + dy * dy + dz * dz, key]);
    }
    for (const key of this.inFlight) {
      const [cx, , cz] = decodeKey(key);
      busy.add(columnKey(cx, cz));
    }
    this.revealFinished(world, busy);

    const maxJobs = this.pool.size * 2;
    if (candidates.length === 0 || this.inFlight.size >= maxJobs) return;
    candidates.sort((a, b) => a[0] - b[0]);
    for (const [, key] of candidates) {
      if (this.inFlight.size >= maxJobs) break;
      const [cx, sy, cz] = decodeKey(key);
      world.dirty.delete(key);
      const blocks = new Uint16Array(PADDED);
      const light = new Uint8Array(PADDED);
      if (!world.fillMeshInput(cx, sy, cz, blocks, light)) {
        this.remove(key);
        continue;
      }
      this.inFlight.add(key);
      this.pool
        .request({ type: 'mesh', blocks, light, options: this.options }, [
          blocks.buffer,
          light.buffer,
        ])
        .then((res) => {
          this.inFlight.delete(key);
          if (!world.columns.has(columnKey(cx, cz))) return;
          this.apply(key, cx, sy, cz, res.mesh);
        })
        .catch((error: unknown) => {
          this.inFlight.delete(key);
          console.error(error);
        });
    }
  }

  /** Shows columns that have no section waiting for a mesh any more. */
  private revealFinished(world: World, busy: Set<number>): void {
    for (const col of world.columns.values()) {
      const ck = columnKey(col.cx, col.cz);
      if (this.revealed.has(ck) || busy.has(ck) || !world.hasNeighborhood(col.cx, col.cz)) continue;
      this.revealed.add(ck);
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
        const entry = this.sections.get(ck * 32 + sy);
        if (entry) for (const m of entry.meshes) if (m) m.visible = true;
      }
    }
  }

  private apply(key: number, cx: number, sy: number, cz: number, mesh: SectionMesh): void {
    let entry = this.sections.get(key);
    if (!entry) {
      entry = { cx, sy, cz, meshes: [null, null, null] };
      this.sections.set(key, entry);
    }
    this.meshedCount++;
    for (let layer = 0; layer < 3; layer++) {
      const old = entry.meshes[layer];
      if (old) {
        old.geometry.dispose();
        this.group.remove(old);
        entry.meshes[layer] = null;
      }
      const g = mesh.layers[layer];
      if (!g) continue;
      const m = new THREE.Mesh(this.geometry(g), this.materials[layer]!);
      m.position.set(cx * 16, sy * 16, cz * 16);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.updateMatrixWorld();
      m.renderOrder = layer;
      m.visible = this.revealed.has(columnKey(cx, cz));
      entry.meshes[layer] = m;
      this.group.add(m);
    }
    if (entry.meshes.every((m) => m === null)) this.sections.delete(key);
  }

  private geometry(g: LayerGeometry): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
    geo.setAttribute('tex', new THREE.BufferAttribute(g.tex, 1));
    geo.setAttribute('light', new THREE.BufferAttribute(g.light, 4, true));
    geo.setAttribute('color', new THREE.BufferAttribute(g.color, 4, true));
    geo.setIndex(new THREE.BufferAttribute(g.index, 1));
    geo.boundingSphere = this.sphere.clone();
    return geo;
  }

  private remove(key: number): void {
    const entry = this.sections.get(key);
    if (!entry) return;
    for (const m of entry.meshes) {
      if (!m) continue;
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.sections.delete(key);
  }

  dispose(): void {
    for (const key of [...this.sections.keys()]) this.remove(key);
    for (const m of this.materials) m.dispose();
  }
}
