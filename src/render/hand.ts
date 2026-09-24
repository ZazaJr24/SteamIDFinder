/**
 * The block held in the player's hand, drawn in its own scene on top of the
 * world. The geometry comes from the regular mesher, so every block model
 * (cubes, torches, plants, …) looks the same in the hand as in the world.
 */
import * as THREE from 'three';
import { BLOCKS } from '../world/blocks/blocks';
import { Model } from '../world/blocks/registry';
import { Mesher, PAD, padIndex } from './mesher/mesher';
import { layerGeometry, type TerrainMaterials } from './world-renderer';

const PADDED = PAD * PAD * PAD;

export class HeldItem {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private readonly mesher = new Mesher(BLOCKS);
  private readonly pivot = new THREE.Group();
  private readonly blocks = new Uint16Array(PADDED);
  private readonly light = new Uint8Array(PADDED);
  private current = -1;
  private currentLight = -1;
  private swing = 0;
  /** Smoothly follows item changes: dips the hand when switching. */
  private equip = 1;

  constructor(private readonly materials: TerrainMaterials) {
    this.scene.add(this.pivot);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Starts the swing animation (breaking, placing). */
  swingOnce(): void {
    if (this.swing <= 0) this.swing = 1;
  }

  update(dt: number, state: number | null, packedLight: number, walk: number, speed: number): void {
    const target = state ?? 0;
    if (target !== this.current) {
      this.equip = 0;
      this.current = target;
      this.rebuild(target, packedLight);
    } else if (packedLight !== this.currentLight) {
      this.rebuild(target, packedLight);
    }
    this.equip = Math.min(1, this.equip + dt * 5);
    this.swing = Math.max(0, this.swing - dt * 3.6);

    const s = this.swing > 0 ? Math.sin((1 - this.swing) * Math.PI) : 0;
    const bobX = Math.sin(walk * Math.PI * 0.6) * 0.025 * speed;
    const bobY = Math.abs(Math.cos(walk * Math.PI * 0.6)) * 0.03 * speed;
    const model = BLOCKS.model[target];
    const flat = model !== Model.Cube && model !== Model.Liquid;
    this.pivot.position.set(
      0.62 + bobX - s * 0.2,
      -0.62 + bobY - (1 - this.equip) * 0.5 + s * 0.12,
      -1.05 - s * 0.25,
    );
    this.pivot.rotation.set(
      -s * 0.9 + (flat ? 0.1 : 0),
      flat ? -0.6 : Math.PI / 4 - s * 0.4,
      flat ? 0.15 : 0,
    );
    const scale = flat ? 0.75 : 0.42;
    this.pivot.scale.setScalar(scale);
  }

  private rebuild(state: number, packedLight: number): void {
    this.currentLight = packedLight;
    for (const child of [...this.pivot.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.pivot.remove(child);
    }
    if (state === 0) return;
    this.blocks.fill(0);
    this.light.fill(packedLight);
    this.blocks[padIndex(0, 0, 0)] = state;
    const mesh = this.mesher.mesh(
      { blocks: this.blocks, light: this.light },
      { fastLeaves: false },
    );
    mesh.layers.forEach((g, layer) => {
      if (!g) return;
      const geo = layerGeometry(g);
      geo.translate(-0.5, -0.5, -0.5);
      const m = new THREE.Mesh(geo, this.materials.list[layer]!);
      m.frustumCulled = false;
      m.renderOrder = layer;
      this.pivot.add(m);
    });
  }
}
