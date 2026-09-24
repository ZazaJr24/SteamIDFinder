/**
 * Turns one 16³ section (plus a one-block border of neighbour data) into
 * vertex buffers.
 *
 * Full cubes and liquids use greedy meshing: coplanar faces with the same
 * texture and uniform lighting merge into one quad (textures tile through
 * repeat-wrapping in the texture array). Faces with an ambient occlusion or
 * light gradient stay 1×1 so the smooth lighting is exact. Plants and box
 * models (torches, lanterns, cactus, …) are emitted per block.
 */
import { rotateFaceY, transformPoint } from '../../world/blocks/models';
import { Flag, Layer, Model, Wave, type BlockRegistry } from '../../world/blocks/registry';
import { GeometryBuilder, type SectionMesh } from './geometry';

export const PAD = 18;
const STRIDE_X = 1;
const STRIDE_Z = PAD;
const STRIDE_Y = PAD * PAD;

/** Index into the padded 18³ arrays; x, y, z range over -1 … 16. */
export function padIndex(x: number, y: number, z: number): number {
  return (y + 1) * STRIDE_Y + (z + 1) * STRIDE_Z + (x + 1);
}

export interface MeshInput {
  /** Block states, 18³, padded by one block on every side. */
  blocks: Uint16Array;
  /** Packed light (sky << 4 | block), 18³. */
  light: Uint8Array;
}

export interface MeshOptions {
  /** Hide faces between leaves (faster, less pretty). */
  fastLeaves: boolean;
}

interface FaceDef {
  /** Axis of the normal (0 = x, 1 = y, 2 = z). */
  d: number;
  positive: boolean;
  /** Mask axes: a1 runs "right", a2 runs "up" as seen from outside. */
  a1: number;
  a2: number;
  /** For BL, BR, TR, TL: whether the vertex sits at the max of a1 / a2. */
  corners: readonly (readonly [number, number])[];
  /** Directional shading (0–255). */
  shade: number;
}

const FACES: readonly FaceDef[] = [
  // East +x
  {
    d: 0,
    positive: true,
    a1: 2,
    a2: 1,
    corners: [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    shade: 153,
  },
  // West -x
  {
    d: 0,
    positive: false,
    a1: 2,
    a2: 1,
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    shade: 153,
  },
  // Up +y
  {
    d: 1,
    positive: true,
    a1: 0,
    a2: 2,
    corners: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    shade: 255,
  },
  // Down -y
  {
    d: 1,
    positive: false,
    a1: 0,
    a2: 2,
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    shade: 128,
  },
  // South +z
  {
    d: 2,
    positive: true,
    a1: 0,
    a2: 1,
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    shade: 204,
  },
  // North -z
  {
    d: 2,
    positive: false,
    a1: 0,
    a2: 1,
    corners: [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    shade: 204,
  },
];

const AXIS_STRIDE = [STRIDE_X, STRIDE_Y, STRIDE_Z];

// Mask key layout (Int32).
const KEY_VALID = 1 << 30;
const KEY_UNIQUE = 1 << 29; // non-uniform lighting: never merge
const KEY_LOWERED = 1 << 28; // liquid surface sits 2/16 below the block top
const LIQUID_DROP = 2 / 16;

const WHITE = 0xffffff;

export class Mesher {
  private readonly builders = [new GeometryBuilder(), new GeometryBuilder(), new GeometryBuilder()];
  private readonly mask = new Int32Array(256);
  private readonly maskSky = new Int32Array(256);
  private readonly maskBlock = new Int32Array(256);
  private readonly maskAo = new Int32Array(256);
  private readonly corner = new Int32Array(12); // ao, sky, block × 4 corners
  private readonly tmp: number[] = [0, 0, 0];

  constructor(private readonly reg: BlockRegistry) {}

  mesh(input: MeshInput, options: MeshOptions): SectionMesh {
    for (const b of this.builders) b.reset();
    this.greedy(input, options);
    this.special(input);
    return { layers: this.builders.map((b) => b.finish()) };
  }

  // ------------------------------------------------------------ helpers

  private faceVisible(state: number, neighbor: number, options: MeshOptions): boolean {
    const flags = this.reg.flags;
    const nf = flags[neighbor]!;
    if (nf & Flag.Opaque) return false;
    const sb = this.reg.stateBlock;
    if (flags[state]! & Flag.CullSame && sb[state] === sb[neighbor]) return false;
    if (
      options.fastLeaves &&
      this.reg.wave[state] === Wave.Leaves &&
      this.reg.wave[neighbor] === Wave.Leaves
    )
      return false;
    return true;
  }

  /**
   * Ambient occlusion and smooth light for the four corners of the face of the
   * block at padded index `p` facing `f`. Results go to this.corner.
   */
  private computeCorners(input: MeshInput, p: number, f: FaceDef): void {
    const { blocks, light } = input;
    const flags = this.reg.flags;
    const sn = f.positive ? AXIS_STRIDE[f.d]! : -AXIS_STRIDE[f.d]!;
    const q = p + sn;
    const sa = AXIS_STRIDE[f.a1]!;
    const sb = AXIS_STRIDE[f.a2]!;
    const lq = light[q]!;
    for (let c = 0; c < 4; c++) {
      const du = c & 1 ? sa : -sa;
      const dv = c & 2 ? sb : -sb;
      const i1 = q + du;
      const i2 = q + dv;
      const i3 = q + du + dv;
      const o1 = (flags[blocks[i1]!]! & Flag.Opaque) !== 0;
      const o2 = (flags[blocks[i2]!]! & Flag.Opaque) !== 0;
      const o3 = (flags[blocks[i3]!]! & Flag.Opaque) !== 0;
      const ao = o1 && o2 ? 0 : 3 - ((o1 ? 1 : 0) + (o2 ? 1 : 0) + (o3 ? 1 : 0));
      let sky = lq >> 4;
      let blk = lq & 15;
      let n = 1;
      if (!o1) {
        sky += light[i1]! >> 4;
        blk += light[i1]! & 15;
        n++;
      }
      if (!o2) {
        sky += light[i2]! >> 4;
        blk += light[i2]! & 15;
        n++;
      }
      if (!o3 && !(o1 && o2)) {
        sky += light[i3]! >> 4;
        blk += light[i3]! & 15;
        n++;
      }
      this.corner[c] = ao;
      this.corner[4 + c] = Math.round((sky * 17) / n);
      this.corner[8 + c] = Math.round((blk * 17) / n);
    }
  }

  // ------------------------------------------------------------- greedy

  private greedy(input: MeshInput, options: MeshOptions): void {
    const { blocks } = input;
    const reg = this.reg;
    const model = reg.model;
    const mask = this.mask;
    const mSky = this.maskSky;
    const mBlk = this.maskBlock;
    const mAo = this.maskAo;
    const pos = [0, 0, 0];

    for (let fi = 0; fi < 6; fi++) {
      const f = FACES[fi]!;
      const sn = f.positive ? AXIS_STRIDE[f.d]! : -AXIS_STRIDE[f.d]!;
      for (let s = 0; s < 16; s++) {
        // Build the mask for this slice.
        let any = false;
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16; i++) {
            const m = j * 16 + i;
            pos[f.d] = s;
            pos[f.a1] = i;
            pos[f.a2] = j;
            const p = padIndex(pos[0]!, pos[1]!, pos[2]!);
            const state = blocks[p]!;
            const mdl = model[state]!;
            if (mdl !== Model.Cube && mdl !== Model.Liquid) {
              mask[m] = 0;
              continue;
            }
            const nb = blocks[p + sn]!;
            if (!this.faceVisible(state, nb, options)) {
              mask[m] = 0;
              continue;
            }
            let key = KEY_VALID | reg.faceLayer[state * 6 + fi]! | (reg.layer[state]! << 12);
            if (mdl === Model.Liquid) {
              const above = blocks[p + STRIDE_Y]!;
              if (reg.stateBlock[above] !== reg.stateBlock[state]) key |= KEY_LOWERED;
              key |= 3 << 14;
            } else if (reg.wave[state] === Wave.Leaves) key |= 1 << 14;
            this.computeCorners(input, p, f);
            const c = this.corner;
            const ao = c[0]! | (c[1]! << 2) | (c[2]! << 4) | (c[3]! << 6);
            const sky = c[4]! | (c[5]! << 8) | (c[6]! << 16) | (c[7]! << 24);
            const blk = c[8]! | (c[9]! << 8) | (c[10]! << 16) | (c[11]! << 24);
            const uniform =
              c[0] === c[1] &&
              c[1] === c[2] &&
              c[2] === c[3] &&
              c[4] === c[5] &&
              c[5] === c[6] &&
              c[6] === c[7] &&
              c[8] === c[9] &&
              c[9] === c[10] &&
              c[10] === c[11];
            if (!uniform) key |= KEY_UNIQUE;
            mask[m] = key | (ao << 16);
            mSky[m] = sky;
            mBlk[m] = blk;
            mAo[m] = ao;
            any = true;
          }
        }
        if (!any) continue;

        // Merge rectangles.
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16;) {
            const m = j * 16 + i;
            const key = mask[m]!;
            if (key === 0) {
              i++;
              continue;
            }
            const sky = mSky[m]!;
            const blk = mBlk[m]!;
            let w = 1;
            let h = 1;
            if (!(key & KEY_UNIQUE)) {
              while (
                i + w < 16 &&
                mask[m + w] === key &&
                mSky[m + w] === sky &&
                mBlk[m + w] === blk
              )
                w++;
              outer: while (j + h < 16) {
                const row = (j + h) * 16 + i;
                for (let t = 0; t < w; t++) {
                  if (mask[row + t] !== key || mSky[row + t] !== sky || mBlk[row + t] !== blk)
                    break outer;
                }
                h++;
              }
            }
            this.emitQuad(f, s, i, j, w, h, key, sky, blk, mAo[m]!);
            for (let dj = 0; dj < h; dj++) mask.fill(0, (j + dj) * 16 + i, (j + dj) * 16 + i + w);
            i += w;
          }
        }
      }
    }
  }

  private emitQuad(
    f: FaceDef,
    s: number,
    i: number,
    j: number,
    w: number,
    h: number,
    key: number,
    sky: number,
    blk: number,
    ao: number,
  ): void {
    const layer = (key >> 12) & 3;
    const tex = key & 0xfff;
    const anim = (key >> 14) & 3;
    const lowered = (key & KEY_LOWERED) !== 0;
    const b = this.builders[layer]!;
    const plane = s + (f.positive ? 1 : 0) - (lowered && f.d === 1 && f.positive ? LIQUID_DROP : 0);
    const p = this.tmp;
    const bright = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const [c1, c2] = f.corners[k]!;
      const ci = c1 | (c2 << 1);
      p[f.d] = plane;
      p[f.a1] = i + c1 * w;
      p[f.a2] = j + c2 * h;
      if (lowered && f.d !== 1 && c2 === 1) p[1]! -= LIQUID_DROP;
      const u = k === 1 || k === 2 ? w : 0;
      const v = k >= 2 ? h : 0;
      const a = (ao >> (ci * 2)) & 3;
      const sk = (sky >>> (ci * 8)) & 255;
      const bl = (blk >>> (ci * 8)) & 255;
      bright[k] = a * 64 + Math.max(sk, bl);
      b.vertex(
        p[0]!,
        p[1]!,
        p[2]!,
        u,
        -v,
        tex,
        sk,
        bl,
        a * 85,
        f.shade,
        WHITE,
        anim === 3 && f.d === 1 ? 3 : anim,
      );
    }
    // Pick the diagonal that keeps a single dark corner from bleeding across the quad.
    b.quad(bright[0]! + bright[2]! < bright[1]! + bright[3]!);
  }

  // --------------------------------------------------- plants and boxes

  private special(input: MeshInput): void {
    const { blocks, light } = input;
    const reg = this.reg;
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const p = padIndex(x, y, z);
          const state = blocks[p]!;
          const mdl = reg.model[state]!;
          if (mdl === Model.Cross) this.cross(x, y, z, state, light[p]!);
          else if (mdl === Model.Boxes) this.boxes(input, x, y, z, p, state);
        }
      }
    }
  }

  private cross(x: number, y: number, z: number, state: number, packed: number): void {
    const reg = this.reg;
    const b = this.builders[Layer.Cutout]!;
    const tex = reg.faceLayer[state * 6]!;
    const sky = (packed >> 4) * 17;
    const blk = (packed & 15) * 17;
    const wave = reg.wave[state] === Wave.Plant ? 2 : 0;
    // Small deterministic jitter so fields of grass don't look like a grid.
    const hsh = Math.imul((x * 73856093) ^ (y * 19349663) ^ (z * 83492791), 0x27d4eb2d) >>> 0;
    const ox = ((hsh & 15) / 15 - 0.5) * 0.3;
    const oz = (((hsh >> 4) & 15) / 15 - 0.5) * 0.3;
    const lo = 0.1464;
    const hi = 0.8536;
    const planes = [
      [lo, lo, hi, hi],
      [lo, hi, hi, lo],
    ] as const;
    for (const [x0, z0, x1, z1] of planes) {
      for (const back of [false, true]) {
        const ax = x + ox + (back ? x1 : x0);
        const az = z + oz + (back ? z1 : z0);
        const bx = x + ox + (back ? x0 : x1);
        const bz = z + oz + (back ? z0 : z1);
        b.vertex(ax, y, az, 0, 0, tex, sky, blk, 255, 230, WHITE, 0);
        b.vertex(bx, y, bz, 1, 0, tex, sky, blk, 255, 230, WHITE, 0);
        b.vertex(bx, y + 1, bz, 1, -1, tex, sky, blk, 255, 230, WHITE, wave);
        b.vertex(ax, y + 1, az, 0, -1, tex, sky, blk, 255, 230, WHITE, wave);
        b.quad(false);
      }
    }
  }

  private boxes(input: MeshInput, x: number, y: number, z: number, p: number, state: number): void {
    const reg = this.reg;
    const variant =
      reg.variantCount[state]! > 1
        ? reg.variantOf(
            state,
            (dx, dy, dz) => input.blocks[p + dx * STRIDE_X + dy * STRIDE_Y + dz * STRIDE_Z]!,
          )
        : 0;
    const boxes = reg.boxesOf(state, variant);
    if (!boxes) return;
    const b = this.builders[reg.layer[state]!]!;
    const own = input.light[p]!;
    const pt = this.tmp;
    const verts: number[][] = [[], [], [], []];
    for (const box of boxes) {
      const [x0, y0, z0] = box.from;
      const [x1, y1, z1] = box.to;
      for (let fi = 0; fi < 6; fi++) {
        const face = box.faces[fi];
        if (!face) continue;
        if (face.cull >= 0) {
          const dir = rotateFaceY(face.cull, box.rotateY ?? 0);
          const f = FACES[dir]!;
          const n = p + (f.positive ? AXIS_STRIDE[f.d]! : -AXIS_STRIDE[f.d]!);
          if (reg.flags[input.blocks[n]!]! & Flag.Opaque) continue;
        }
        const f = FACES[fi]!;
        const [u0, v0, u1, v1] = face.uv;
        const lo = [x0, y0, z0];
        const hi = [x1, y1, z1];
        for (let k = 0; k < 4; k++) {
          const [c1, c2] = f.corners[k]!;
          const q = [0, 0, 0];
          q[f.d] = f.positive ? hi[f.d]! : lo[f.d]!;
          q[f.a1] = c1 ? hi[f.a1]! : lo[f.a1]!;
          q[f.a2] = c2 ? hi[f.a2]! : lo[f.a2]!;
          transformPoint(box, q[0]!, q[1]!, q[2]!, pt);
          verts[k] = [pt[0]! / 16, pt[1]! / 16, pt[2]! / 16];
        }
        // Face normal after rotation, for directional shading.
        const [a, bb, c] = [verts[0]!, verts[1]!, verts[3]!];
        const e1 = [bb[0]! - a[0]!, bb[1]! - a[1]!, bb[2]! - a[2]!];
        const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
        const ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
        const nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
        const len = Math.hypot(nx, ny, nz) || 1;
        const shade = Math.round(
          255 *
            ((nx / len) ** 2 * 0.6 + (nz / len) ** 2 * 0.8 + (ny / len) ** 2 * (ny > 0 ? 1 : 0.5)),
        );
        const tex = face.layer;
        // Light from the block the face looks at (or the block itself, whichever is brighter).
        let packed = own;
        if (!box.rotation) {
          const dir = FACES[rotateFaceY(fi, box.rotateY ?? 0)]!;
          const n = input.light[p + (dir.positive ? AXIS_STRIDE[dir.d]! : -AXIS_STRIDE[dir.d]!)]!;
          packed = (Math.max(own >> 4, n >> 4) << 4) | Math.max(own & 15, n & 15);
        }
        const sky = (packed >> 4) * 17;
        const blk = (packed & 15) * 17;
        // Texture space: u to the right, v downward in texels.
        const uvs = [
          [u0, v1],
          [u1, v1],
          [u1, v0],
          [u0, v0],
        ];
        for (let k = 0; k < 4; k++) {
          const v = verts[k]!;
          const [u, vv] = uvs[k]!;
          b.vertex(
            x + v[0]!,
            y + v[1]!,
            z + v[2]!,
            u / 16,
            -(1 - vv / 16),
            tex,
            sky,
            blk,
            255,
            shade,
            WHITE,
            0,
          );
        }
        b.quad(false);
      }
    }
  }
}
