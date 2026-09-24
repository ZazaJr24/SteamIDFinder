/** Block breaking cracks and block particles. */
import * as THREE from 'three';
import type { BlockTextures } from './textures';

const crackVertex = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const crackFragment = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTextures;
uniform float uLayer;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec4 t = texture(uTextures, vec3(vUv.x, 1.0 - vUv.y, uLayer));
  if (t.a < 0.05) discard;
  fragColor = t;
}
`;

/** Cracks drawn over the block being broken. */
export class CrackOverlay {
  readonly object: THREE.Mesh;
  private readonly material: THREE.RawShaderMaterial;
  private readonly stages: number[];

  constructor(textures: BlockTextures) {
    this.stages = Array.from({ length: 10 }, (_, i) => textures.layers[`destroy_stage_${i}`] ?? 0);
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: crackVertex,
      fragmentShader: crackFragment,
      uniforms: { uTextures: { value: textures.array }, uLayer: { value: 0 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0.5, 0.5, 0.5);
    this.object = new THREE.Mesh(geo, this.material);
    this.object.visible = false;
    this.object.renderOrder = 5;
  }

  /** `progress` in [0, 1); null hides the overlay. */
  show(
    box: ArrayLike<number> | null,
    x: number,
    y: number,
    z: number,
    progress: number | null,
  ): void {
    if (!box || progress === null || progress <= 0) {
      this.object.visible = false;
      return;
    }
    const stage = Math.min(9, Math.floor(progress * 10));
    this.material.uniforms.uLayer!.value = this.stages[stage];
    const g = 0.004;
    this.object.position.set(x + box[0]! - g, y + box[1]! - g, z + box[2]! - g);
    this.object.scale.set(
      box[3]! - box[0]! + 2 * g,
      box[4]! - box[1]! + 2 * g,
      box[5]! - box[2]! + 2 * g,
    );
    this.object.visible = true;
  }
}

const particleVertex = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uScale;
in vec3 position;
in vec4 info; // layer, u offset, v offset, size
in vec2 extra; // light, uv scale
out float vLayer;
out vec2 vOffset;
out float vLight;
out float vUvScale;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = info.w * uScale / max(0.1, -view.z);
  vLayer = info.x;
  vOffset = info.yz;
  vLight = extra.x;
  vUvScale = extra.y;
}
`;

const particleFragment = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTextures;
in float vLayer;
in vec2 vOffset;
in float vLight;
in float vUvScale;
out vec4 fragColor;
void main() {
  vec2 uv = vOffset + gl_PointCoord * vUvScale;
  vec4 t = texture(uTextures, vec3(uv, vLayer));
  if (t.a < 0.5) discard;
  fragColor = vec4(t.rgb * vLight, 1.0);
}
`;

const MAX_PARTICLES = 1024;

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  layer: number;
  /** World size (roughly blocks). */
  size: number;
  life: number;
  brightness: number;
  /** Downward acceleration (negative = rises). */
  gravity: number;
  /** Portion of the texture shown: 0.25 = a random quarter, 1 = all of it. */
  uvScale?: number;
  /** Stops at solid blocks. */
  collide?: boolean;
}

/** Small textured squares: block fragments, flames, smoke. */
export class ParticleSystem {
  readonly object: THREE.Points;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly info = new Float32Array(MAX_PARTICLES * 4);
  private readonly extra = new Float32Array(MAX_PARTICLES * 2);
  private readonly velocity = new Float32Array(MAX_PARTICLES * 3);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly collide = new Uint8Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.RawShaderMaterial;
  private next = 0;

  constructor(textures: BlockTextures) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('info', new THREE.BufferAttribute(this.info, 4));
    this.geometry.setAttribute('extra', new THREE.BufferAttribute(this.extra, 2));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: { uTextures: { value: textures.array }, uScale: { value: 300 } },
    });
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  setViewportHeight(px: number): void {
    // World size → pixels: viewport height / (2·tan(fov/2)) ≈ 0.65·height at 75°.
    this.material.uniforms.uScale!.value = px * 0.65;
  }

  spawn(p: ParticleSpec): void {
    const k = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    const uvScale = p.uvScale ?? 1;
    const cells = Math.round(1 / uvScale);
    this.positions[k * 3] = p.x;
    this.positions[k * 3 + 1] = p.y;
    this.positions[k * 3 + 2] = p.z;
    this.velocity[k * 3] = p.vx;
    this.velocity[k * 3 + 1] = p.vy;
    this.velocity[k * 3 + 2] = p.vz;
    this.info[k * 4] = p.layer;
    this.info[k * 4 + 1] = Math.floor(Math.random() * cells) * uvScale;
    this.info[k * 4 + 2] = Math.floor(Math.random() * cells) * uvScale;
    this.info[k * 4 + 3] = p.size;
    this.extra[k * 2] = p.brightness;
    this.extra[k * 2 + 1] = uvScale;
    this.gravity[k] = p.gravity;
    this.collide[k] = p.collide ? 1 : 0;
    this.life[k] = p.life;
  }

  /** Bursts fragments from a broken block using its texture layer. */
  burst(x: number, y: number, z: number, layer: number, brightness: number, count = 28): void {
    for (let i = 0; i < count; i++) {
      const px = x + 0.15 + Math.random() * 0.7;
      const py = y + 0.15 + Math.random() * 0.7;
      const pz = z + 0.15 + Math.random() * 0.7;
      this.spawn({
        x: px,
        y: py,
        z: pz,
        vx: (px - x - 0.5) * 3 + (Math.random() - 0.5),
        vy: 1.5 + Math.random() * 2.5,
        vz: (pz - z - 0.5) * 3 + (Math.random() - 0.5),
        layer,
        size: 0.08 + Math.random() * 0.06,
        life: 0.5 + Math.random() * 0.6,
        brightness,
        gravity: 18,
        uvScale: 0.25,
        collide: true,
      });
    }
  }

  update(dt: number, isSolid: (x: number, y: number, z: number) => boolean): void {
    let alive = false;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (this.life[k]! <= 0) continue;
      this.life[k]! -= dt;
      if (this.life[k]! <= 0) {
        this.info[k * 4 + 3] = 0;
        continue;
      }
      alive = true;
      const i = k * 3;
      this.velocity[i + 1]! -= this.gravity[k]! * dt;
      const nx = this.positions[i]! + this.velocity[i]! * dt;
      const ny = this.positions[i + 1]! + this.velocity[i + 1]! * dt;
      const nz = this.positions[i + 2]! + this.velocity[i + 2]! * dt;
      if (this.collide[k] && isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        this.velocity[i]! *= 0.3;
        this.velocity[i + 1] = 0;
        this.velocity[i + 2]! *= 0.3;
      } else {
        this.positions[i] = nx;
        this.positions[i + 1] = ny;
        this.positions[i + 2] = nz;
      }
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.info!.needsUpdate = true;
    this.geometry.attributes.extra!.needsUpdate = true;
    this.object.visible = alive;
  }
}
