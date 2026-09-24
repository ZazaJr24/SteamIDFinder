/**
 * Sky dome with day/night colors, a pixel-art sun and moon, stars, and a
 * layer of blocky clouds drifting overhead.
 */
import * as THREE from 'three';
import { DAY_LENGTH_TICKS } from '../config';
import { Random } from '../core/random';

const skyVertex = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec3 vDir;
void main() {
  vDir = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  gl_Position.z = gl_Position.w; // always at the far plane
}
`;

const skyFragment = /* glsl */ `
precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunsetColor;
uniform float uSunset;
uniform float uNight;
uniform float uMoonPhase;
uniform float uUnderwater;
in vec3 vDir;
out vec4 fragColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Square celestial body: returns local coords in [-1, 1] if the ray hits it.
bool body(vec3 d, vec3 dir, float size, out vec2 uv) {
  float facing = dot(d, dir);
  if (facing <= 0.0) return false;
  vec3 up = abs(dir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(up, dir));
  vec3 v = cross(dir, u);
  vec2 p = vec2(dot(d, u), dot(d, v)) / facing / size;
  uv = p;
  return abs(p.x) < 1.0 && abs(p.y) < 1.0;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.45, h));
  // Below the horizon fade toward a darker horizon color.
  col = mix(col, uHorizon * 0.75, smoothstep(0.0, -0.3, h));

  // Sunrise / sunset glow around the sun near the horizon.
  float toSun = max(dot(d, uSunDir), 0.0);
  float glow = pow(toSun, 6.0) * uSunset * smoothstep(-0.25, 0.15, h) * (1.0 - smoothstep(0.1, 0.6, h));
  col = mix(col, uSunsetColor, clamp(glow, 0.0, 1.0));

  // Stars.
  if (uNight > 0.01 && h > -0.05) {
    vec3 cell = floor(d * 180.0);
    float s = hash(cell);
    if (s > 0.9965) {
      float twinkle = 0.7 + 0.3 * hash(cell + 7.0);
      col += vec3(twinkle) * uNight * smoothstep(-0.05, 0.2, h);
    }
  }

  vec2 uv;
  // Sun: bright square with a soft halo, pixelated.
  if (body(d, uSunDir, 0.085, uv)) {
    vec2 q = floor(uv * 4.0) / 4.0;
    float core = 1.0 - max(abs(q.x), abs(q.y)) * 0.35;
    col = mix(col, vec3(1.0, 0.97, 0.78) * core + vec3(0.1, 0.05, 0.0), 0.96);
  } else {
    col += vec3(1.0, 0.85, 0.55) * pow(toSun, 60.0) * 0.5 * (1.0 - uUnderwater);
  }
  // Moon: gray square with craters and a phase shadow.
  if (body(d, -uSunDir, 0.07, uv)) {
    vec2 q = floor((uv * 0.5 + 0.5) * 8.0);
    float crater = hash(vec3(q, 3.0)) > 0.78 ? 0.78 : 1.0;
    float lit = step(uMoonPhase * 2.0 - 1.0, (q.x / 8.0) * 2.0 - 1.0 + 0.001);
    float phaseLight = uMoonPhase < 0.5 ? lit : 1.0 - lit;
    if (uMoonPhase == 0.0) phaseLight = 1.0;
    vec3 moon = vec3(0.86, 0.88, 0.95) * crater * mix(0.18, 1.0, phaseLight);
    col = mix(col, moon, 0.95);
  }
  fragColor = vec4(col, 1.0);
}
`;

const cloudVertex = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uOffset;
uniform float uScale;
in vec3 position;
out vec2 vUv;
out float vDist;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vUv = (world.xz + uOffset) / uScale;
  vec4 view = viewMatrix * world;
  vDist = length(view.xz);
  gl_Position = projectionMatrix * view;
}
`;

const cloudFragment = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFade;
in vec2 vUv;
in float vDist;
out vec4 fragColor;
void main() {
  float c = texture(uMap, vUv).r;
  if (c < 0.5) discard;
  float edge = smoothstep(uFade, uFade * 0.55, vDist);
  if (edge <= 0.0) discard;
  fragColor = vec4(mix(uFogColor, uColor, edge), 0.82 * edge);
}
`;

/** Precomputed colors and light for a moment of the day. */
export interface SkyState {
  /** 0 … 1 multiplier for sky light. */
  daylight: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  skyLight: THREE.Color;
  sunDir: THREE.Vector3;
  sunset: number;
  night: number;
}

const DAY_ZENITH = new THREE.Color(0x4f86f7);
const DAY_HORIZON = new THREE.Color(0xa9ccff);
const NIGHT_ZENITH = new THREE.Color(0x02040b);
const NIGHT_HORIZON = new THREE.Color(0x0a1224);
const SUNSET_HORIZON = new THREE.Color(0xf7a25c);
const SUNSET_GLOW = new THREE.Color(0xff8a3c);
const MOON_LIGHT = new THREE.Color(0.62, 0.7, 1);
const SUN_LIGHT = new THREE.Color(1, 1, 1);
const SUNSET_LIGHT = new THREE.Color(1, 0.82, 0.62);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Sky colors for a time of day. Time 0 is sunrise, 6000 noon, 12000
 * sunset and 18000 midnight (like the classic day cycle).
 */
export function skyAt(ticks: number, out?: SkyState): SkyState {
  const s = out ?? {
    daylight: 1,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    skyLight: new THREE.Color(),
    sunDir: new THREE.Vector3(),
    sunset: 0,
    night: 0,
  };
  const t = (((ticks % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS) / DAY_LENGTH_TICKS;
  const angle = t * Math.PI * 2;
  s.sunDir.set(Math.cos(angle), Math.sin(angle), 0.22).normalize();
  const elev = s.sunDir.y;
  const light = smoothstep(-0.28, 0.22, elev);
  const colors = smoothstep(-0.35, 0.18, elev);
  s.daylight = 0.14 + 0.86 * light;
  // Stars only once the sun is below the horizon.
  s.night = 1 - smoothstep(-0.35, -0.04, elev);
  // Sunset strength peaks with the sun at the horizon.
  s.sunset = Math.max(0, 1 - Math.abs(elev) / 0.3);
  s.zenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, colors);
  s.horizon
    .copy(NIGHT_HORIZON)
    .lerp(DAY_HORIZON, colors)
    .lerp(SUNSET_HORIZON, s.sunset * 0.6);
  // Moonlight is cool, sunset light warm.
  s.skyLight
    .copy(MOON_LIGHT)
    .lerp(SUN_LIGHT, light)
    .lerp(SUNSET_LIGHT, s.sunset * 0.35);
  return s;
}

export class SkyRenderer {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly clouds: THREE.Mesh;
  private readonly skyMaterial: THREE.RawShaderMaterial;
  private readonly cloudMaterial: THREE.RawShaderMaterial;
  readonly state = skyAt(1000);

  constructor() {
    this.skyMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunsetColor: { value: SUNSET_GLOW.clone() },
        uSunset: { value: 0 },
        uNight: { value: 0 },
        uMoonPhase: { value: 0 },
        uUnderwater: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), this.skyMaterial);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;

    this.cloudMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      uniforms: {
        uMap: { value: cloudTexture() },
        uOffset: { value: new THREE.Vector2() },
        uScale: { value: 12 * 128 },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uFogColor: { value: new THREE.Color() },
        uFade: { value: 300 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(plane, this.cloudMaterial);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 50;
    this.group.add(this.dome, this.clouds);
  }

  /** Updates colors for the given time of day and follows the camera. */
  update(
    ticks: number,
    camera: THREE.Camera,
    viewDistance: number,
    underwater: boolean,
    clouds: boolean,
  ): SkyState {
    const s = skyAt(ticks, this.state);
    const u = this.skyMaterial.uniforms;
    (u.uZenith!.value as THREE.Color).copy(s.zenith);
    (u.uHorizon!.value as THREE.Color).copy(s.horizon);
    (u.uSunDir!.value as THREE.Vector3).copy(s.sunDir);
    u.uSunset!.value = s.sunset;
    u.uNight!.value = s.night;
    u.uMoonPhase!.value = (Math.floor(ticks / DAY_LENGTH_TICKS) % 8) / 8;
    u.uUnderwater!.value = underwater ? 1 : 0;
    this.dome.position.copy(camera.position);

    const cu = this.cloudMaterial.uniforms;
    const fade = Math.max(160, viewDistance * 1.6);
    const size = fade * 2.2;
    this.clouds.visible = clouds;
    this.clouds.position.set(camera.position.x, 192, camera.position.z);
    this.clouds.scale.set(size, 1, size);
    (cu.uOffset!.value as THREE.Vector2).set(ticks * 0.03, 0);
    cu.uFade!.value = fade;
    const bright = 0.35 + (0.65 * (s.daylight - 0.14)) / 0.86;
    (cu.uColor!.value as THREE.Color)
      .setRGB(bright, bright, bright * 1.02)
      .lerp(SUNSET_LIGHT, s.sunset * 0.3);
    (cu.uFogColor!.value as THREE.Color).copy(s.horizon);
    return s;
  }
}

/** Blocky cloud map: thresholded noise, one texel per 12×12 blocks. */
function cloudTexture(): THREE.DataTexture {
  const size = 128;
  const rng = new Random(0xc10d);
  const grid = 16;
  const lattice = Array.from({ length: grid * grid }, () => rng.next());
  const at = (i: number, j: number) =>
    lattice[(((j % grid) + grid) % grid) * grid + (((i % grid) + grid) % grid)]!;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * grid;
      const v = (y / size) * grid;
      const i = Math.floor(u);
      const j = Math.floor(v);
      const fx = u - i;
      const fy = v - j;
      const n =
        at(i, j) * (1 - fx) * (1 - fy) +
        at(i + 1, j) * fx * (1 - fy) +
        at(i, j + 1) * (1 - fx) * fy +
        at(i + 1, j + 1) * fx * fy;
      const detail = rng.next() * 0.12;
      const value = n + detail > 0.62 ? 255 : 0;
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
