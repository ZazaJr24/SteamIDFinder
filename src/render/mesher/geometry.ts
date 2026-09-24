/** Vertex buffers produced by the mesher (one set per render layer). */

export interface LayerGeometry {
  /** xyz, section-local block units. */
  position: Float32Array;
  /** Texture coordinates in texels/16 (repeat-wrapped, so greedy quads tile). */
  uv: Float32Array;
  /** Texture array layer. */
  tex: Uint16Array;
  /** sky, block, ambient occlusion, face shade (0–255 each). */
  light: Uint8Array;
  /** Tint rgb + animation flag. */
  color: Uint8Array;
  index: Uint16Array | Uint32Array;
}

export interface SectionMesh {
  layers: (LayerGeometry | null)[];
}

/** Growable vertex/index buffers, reused between meshing jobs. */
export class GeometryBuilder {
  private pos = new Float32Array(4096 * 3);
  private uv = new Float32Array(4096 * 2);
  private tex = new Uint16Array(4096);
  private light = new Uint8Array(4096 * 4);
  private color = new Uint8Array(4096 * 4);
  private index = new Uint32Array(6144);
  vertexCount = 0;
  indexCount = 0;

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  private grow(): void {
    const cap = this.tex.length * 2;
    const up = <T extends Float32Array | Uint16Array | Uint8Array>(a: T, n: number): T => {
      const b = new (a.constructor as new (n: number) => T)(cap * n);
      b.set(a);
      return b;
    };
    this.pos = up(this.pos, 3);
    this.uv = up(this.uv, 2);
    this.tex = up(this.tex, 1);
    this.light = up(this.light, 4);
    this.color = up(this.color, 4);
  }

  vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    tex: number,
    sky: number,
    block: number,
    ao: number,
    shade: number,
    tint: number,
    anim: number,
  ): void {
    if (this.vertexCount >= this.tex.length) this.grow();
    const i = this.vertexCount++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.tex[i] = tex;
    this.light[i * 4] = sky;
    this.light[i * 4 + 1] = block;
    this.light[i * 4 + 2] = ao;
    this.light[i * 4 + 3] = shade;
    this.color[i * 4] = (tint >> 16) & 255;
    this.color[i * 4 + 1] = (tint >> 8) & 255;
    this.color[i * 4 + 2] = tint & 255;
    this.color[i * 4 + 3] = anim;
  }

  /** Two triangles over the last four vertices (a b c d, counter-clockwise). */
  quad(flip: boolean): void {
    if (this.indexCount + 6 > this.index.length) {
      const b = new Uint32Array(this.index.length * 2);
      b.set(this.index);
      this.index = b;
    }
    const a = this.vertexCount - 4;
    const idx = this.index;
    const i = this.indexCount;
    if (flip) {
      idx[i] = a + 1;
      idx[i + 1] = a + 2;
      idx[i + 2] = a + 3;
      idx[i + 3] = a + 1;
      idx[i + 4] = a + 3;
      idx[i + 5] = a;
    } else {
      idx[i] = a;
      idx[i + 1] = a + 1;
      idx[i + 2] = a + 2;
      idx[i + 3] = a;
      idx[i + 4] = a + 2;
      idx[i + 5] = a + 3;
    }
    this.indexCount += 6;
  }

  /** Copies the used range out (ready to transfer to another thread). */
  finish(): LayerGeometry | null {
    const n = this.vertexCount;
    if (n === 0) return null;
    const index =
      n <= 65535
        ? Uint16Array.from(this.index.subarray(0, this.indexCount))
        : this.index.slice(0, this.indexCount);
    return {
      position: this.pos.slice(0, n * 3),
      uv: this.uv.slice(0, n * 2),
      tex: this.tex.slice(0, n),
      light: this.light.slice(0, n * 4),
      color: this.color.slice(0, n * 4),
      index,
    };
  }
}

export function transferablesOf(mesh: SectionMesh): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const g of mesh.layers) {
    if (!g) continue;
    out.push(
      g.position.buffer as ArrayBuffer,
      g.uv.buffer as ArrayBuffer,
      g.tex.buffer as ArrayBuffer,
      g.light.buffer as ArrayBuffer,
      g.color.buffer as ArrayBuffer,
      g.index.buffer as ArrayBuffer,
    );
  }
  return out;
}
