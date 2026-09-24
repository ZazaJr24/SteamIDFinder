import * as THREE from 'three';
import { BLOCKS } from '../world/blocks/blocks';
import type { RayHit } from '../world/raycast';

/** Thin dark outline around the targeted block. */
export class SelectionBox {
  readonly object: THREE.LineSegments;

  constructor() {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    geo.translate(0.5, 0.5, 0.5);
    const mat = new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(geo, mat);
    this.object.visible = false;
    this.object.renderOrder = 10;
  }

  show(hit: RayHit | null): void {
    if (!hit) {
      this.object.visible = false;
      return;
    }
    const s = BLOCKS.selectionOf(hit.state, hit.variant);
    const grow = 0.003;
    this.object.position.set(hit.x + s[0]! - grow, hit.y + s[1]! - grow, hit.z + s[2]! - grow);
    this.object.scale.set(
      s[3]! - s[0]! + grow * 2,
      s[4]! - s[1]! + grow * 2,
      s[5]! - s[2]! + grow * 2,
    );
    this.object.visible = true;
  }
}
