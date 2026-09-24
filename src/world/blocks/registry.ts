import { transformPoint } from './models';

/**
 * Block registry.
 *
 * Every combination of a block and its properties (e.g. an oak door that is
 * open, facing north, upper half) is a *state* with a numeric id (Uint16).
 * Chunks store state ids; all per-state lookups are flat typed arrays so the
 * mesher and the light engine stay fast. State 0 is always air.
 *
 * The registry is built identically in the main thread and in workers.
 */

export const enum Face {
  East = 0, // +x
  West = 1, // -x
  Up = 2, // +y
  Down = 3, // -y
  South = 4, // +z
  North = 5, // -z
}

export const FACE_NAMES = ['east', 'west', 'up', 'down', 'south', 'north'] as const;
export type FaceName = (typeof FACE_NAMES)[number];
export const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4] as const;

export const enum Model {
  None = 0,
  Cube = 1,
  Cross = 2,
  Liquid = 3,
  /** Built from boxes (torches, slabs, doors, …). */
  Boxes = 4,
}

export const enum Layer {
  Opaque = 0,
  Cutout = 1,
  Transparent = 2,
}

export const enum Flag {
  Solid = 1 << 0,
  /** Full opaque cube: hides neighbour faces, casts ambient occlusion. */
  Opaque = 1 << 1,
  Replaceable = 1 << 2,
  Liquid = 1 << 3,
  /** Hides faces against the same block (glass, water). */
  CullSame = 1 << 4,
  Selectable = 1 << 5,
  /** Climbable (ladders, vines). */
  Climbable = 1 << 6,
  /** Receives light but lets none through (slabs, stairs): keeps roofs dark inside. */
  LightSink = 1 << 7,
}

export const enum Tint {
  None = 0,
  Grass = 1,
  Foliage = 2,
  Water = 3,
}

export const enum Wave {
  None = 0,
  Leaves = 1,
  Plant = 2,
}

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears' | 'sword';
export type SoundKind =
  'stone' | 'wood' | 'grass' | 'gravel' | 'sand' | 'glass' | 'wool' | 'metal' | 'snow' | 'liquid';

export type PropValue = string | number | boolean;
export type Props = Readonly<Record<string, PropValue>>;

export type TextureSpec =
  string | Partial<Record<'all' | 'top' | 'bottom' | 'side' | FaceName, string>>;

/** Axis-aligned box in 1/16 block units, for non-cube models. */
export interface Box {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  /** Faces to draw; `uv` is [u0, v0, u1, v1] in texture pixels (default: from box extent). */
  faces: Partial<
    Record<
      FaceName,
      { tex: string; uv?: readonly [number, number, number, number]; cull?: FaceName }
    >
  >;
  /** Optional tilt around a horizontal axis (used by wall torches). */
  rotation?: { axis: 'x' | 'z'; angle: number; origin: readonly [number, number, number] };
  /** Rotation around the vertical block center, applied after `rotation`. */
  rotateY?: 0 | 90 | 180 | 270;
}

export type AabbSpec = readonly [number, number, number, number, number, number];

/** State of the block at an offset from the one being evaluated. */
export type NeighborFn = (dx: number, dy: number, dz: number) => number;

/** Blocks whose shape depends on their neighbours (fences, panes, stair corners). */
export interface ConnectSpec {
  /** Number of shape variants. */
  variants: number;
  /** Picks the variant from the neighbouring blocks. */
  variant(p: Props, neighbor: NeighborFn, reg: BlockRegistry): number;
}

export interface BlockSpec {
  textures?: TextureSpec | ((p: Props) => TextureSpec);
  model?: 'none' | 'cube' | 'cross' | 'liquid' | 'boxes';
  /** Box geometry for `model: 'boxes'`, per state (and connection variant). */
  boxes?: (p: Props, variant: number) => Box[];
  connect?: ConnectSpec;
  layer?: 'opaque' | 'cutout' | 'transparent';
  solid?: boolean;
  /** Full opaque cube. Defaults to true for opaque-layer cubes. */
  opaque?: boolean;
  lightEmission?: number | ((p: Props) => number);
  /** How much light is lost passing through (0 = clear, 15 = blocks). */
  lightOpacity?: number;
  /** Seconds to break by hand; -1 = unbreakable. */
  hardness?: number;
  tool?: ToolKind;
  toolLevel?: number;
  sound?: SoundKind;
  replaceable?: boolean;
  liquid?: boolean;
  cullSame?: boolean;
  selectable?: boolean;
  climbable?: boolean;
  /** Blocks light like an opaque block but is lit itself (partial blocks). */
  lightSink?: boolean;
  tint?: 'grass' | 'foliage' | 'water';
  wave?: 'leaves' | 'plant';
  properties?: Readonly<Record<string, readonly PropValue[]>>;
  defaults?: Props;
  /** Collision boxes as [x0, y0, z0, x1, y1, z1] in 1/16 units (default: the model boxes). */
  collision?: (p: Props, variant: number) => AabbSpec[];
  /** Item dropped when broken. `null` drops nothing; default drops itself. */
  drops?: string | null;
  /** Creative inventory tab. */
  category?: 'building' | 'nature' | 'decoration' | 'utility' | 'hidden';
}

export class Block {
  readonly propNames: string[];
  readonly propValues: (readonly PropValue[])[];
  readonly stateCount: number;
  firstState = 0;

  constructor(
    readonly id: number,
    readonly name: string,
    readonly spec: BlockSpec,
  ) {
    const props = spec.properties ?? {};
    this.propNames = Object.keys(props);
    this.propValues = this.propNames.map((n) => props[n]!);
    this.stateCount = this.propValues.reduce((n, v) => n * v.length, 1);
  }

  /** State id for the given properties; missing ones use defaults. */
  state(props: Props = {}): number {
    let index = 0;
    let stride = 1;
    for (let i = 0; i < this.propNames.length; i++) {
      const name = this.propNames[i]!;
      const values = this.propValues[i]!;
      const wanted = props[name] ?? this.spec.defaults?.[name] ?? values[0];
      const vi = values.indexOf(wanted!);
      if (vi < 0) throw new Error(`${this.name}: invalid ${name}=${String(wanted)}`);
      index += vi * stride;
      stride *= values.length;
    }
    return this.firstState + index;
  }

  get defaultState(): number {
    return this.state();
  }

  propsOf(stateId: number): Props {
    let index = stateId - this.firstState;
    const out: Record<string, PropValue> = {};
    for (let i = 0; i < this.propNames.length; i++) {
      const values = this.propValues[i]!;
      out[this.propNames[i]!] = values[index % values.length]!;
      index = Math.floor(index / values.length);
    }
    return out;
  }
}

/** Resolved face textures of a box, as texture layers. */
export interface ResolvedBox extends Omit<Box, 'faces'> {
  faces: ({ layer: number; uv: readonly [number, number, number, number]; cull: number } | null)[];
}

function resolveSpec(spec: TextureSpec): Record<FaceName, string> {
  if (typeof spec === 'string') {
    return { east: spec, west: spec, up: spec, down: spec, south: spec, north: spec };
  }
  const all = spec.all ?? spec.side ?? spec.top ?? 'missing';
  const side = spec.side ?? all;
  return {
    east: spec.east ?? side,
    west: spec.west ?? side,
    south: spec.south ?? side,
    north: spec.north ?? side,
    up: spec.up ?? spec.top ?? all,
    down: spec.down ?? spec.bottom ?? spec.top ?? all,
  };
}

export class BlockRegistry {
  readonly blocks: Block[] = [];
  private readonly byName = new Map<string, Block>();
  private finalized = false;

  // Per-state lookup tables (filled by finalize()).
  stateCount = 0;
  stateBlock = new Uint16Array(0);
  flags = new Uint16Array(0);
  model = new Uint8Array(0);
  layer = new Uint8Array(0);
  emission = new Uint8Array(0);
  opacity = new Uint8Array(0);
  tint = new Uint8Array(0);
  wave = new Uint8Array(0);
  hardness = new Float32Array(0);
  /** Texture names per state and face (state * 6 + face). */
  faceTextureNames: string[] = [];
  /** Texture layers per state and face, after resolveTextures(). */
  faceLayer = new Uint16Array(0);
  /** Boxes per state and variant for Model.Boxes, after resolveTextures(). */
  boxVariants: (ResolvedBox[][] | null)[] = [];
  /** Collision boxes per state and variant in block units; `null` = full cube (if solid). */
  collisionVariants: (Float32Array[] | null)[] = [];
  /** Outline boxes per state and variant, in block units (x0, y0, z0, x1, y1, z1). */
  selectionVariants: Float32Array[] = [];
  /** Number of connection variants per state (1 for ordinary blocks). */
  variantCount = new Uint8Array(0);

  register(name: string, spec: BlockSpec = {}): Block {
    if (this.finalized) throw new Error('registry already finalized');
    if (this.byName.has(name)) throw new Error(`duplicate block "${name}"`);
    const block = new Block(this.blocks.length, name, spec);
    this.blocks.push(block);
    this.byName.set(name, block);
    return block;
  }

  get(name: string): Block {
    const b = this.byName.get(name);
    if (!b) throw new Error(`unknown block "${name}"`);
    return b;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Default state id of a block by name. */
  id(name: string, props?: Props): number {
    return this.get(name).state(props);
  }

  blockOf(state: number): Block {
    return this.blocks[this.stateBlock[state]!]!;
  }

  propsOf(state: number): Props {
    return this.blockOf(state).propsOf(state);
  }

  /** The same block with one property changed. */
  withProp(state: number, name: string, value: PropValue): number {
    const block = this.blockOf(state);
    return block.state({ ...block.propsOf(state), [name]: value });
  }

  /** Stable name of a state, e.g. `oak_door[facing=north,open=true]`. Used by saves. */
  stateName(state: number): string {
    const block = this.blockOf(state);
    if (block.propNames.length === 0) return block.name;
    const props = block.propsOf(state);
    return `${block.name}[${block.propNames.map((n) => `${n}=${String(props[n])}`).join(',')}]`;
  }

  /** Inverse of stateName(); returns -1 if the block no longer exists. */
  stateFromName(text: string): number {
    const m = /^([^[]+)(?:\[(.*)\])?$/.exec(text);
    if (!m) return -1;
    const block = this.byName.get(m[1]!);
    if (!block) return -1;
    const props: Record<string, PropValue> = {};
    for (const pair of m[2] ? m[2].split(',') : []) {
      const [k, v] = pair.split('=') as [string, string];
      const values = block.propValues[block.propNames.indexOf(k)];
      if (!values) continue;
      const match = values.find((x) => String(x) === v);
      if (match !== undefined) props[k] = match;
    }
    try {
      return block.state(props);
    } catch {
      return block.defaultState;
    }
  }

  isSolid(state: number): boolean {
    return (this.flags[state]! & Flag.Solid) !== 0;
  }

  isOpaque(state: number): boolean {
    return (this.flags[state]! & Flag.Opaque) !== 0;
  }

  isReplaceable(state: number): boolean {
    return (this.flags[state]! & Flag.Replaceable) !== 0;
  }

  isLiquid(state: number): boolean {
    return (this.flags[state]! & Flag.Liquid) !== 0;
  }

  isSelectable(state: number): boolean {
    return (this.flags[state]! & Flag.Selectable) !== 0;
  }

  /** Connection variant of a state given its neighbours (0 for ordinary blocks). */
  variantOf(state: number, neighbor: NeighborFn): number {
    if (this.variantCount[state]! <= 1) return 0;
    const block = this.blockOf(state);
    return block.spec.connect!.variant(block.propsOf(state), neighbor, this);
  }

  boxesOf(state: number, variant = 0): ResolvedBox[] | null {
    return this.boxVariants[state]?.[variant] ?? null;
  }

  /** Collision boxes in block units, or null for a full cube. */
  collisionOf(state: number, variant = 0): Float32Array | null {
    return this.collisionVariants[state]?.[variant] ?? null;
  }

  selectionOf(state: number, variant = 0): Float32Array {
    return this.selectionVariants[state]!.subarray(variant * 6, variant * 6 + 6);
  }

  finalize(): this {
    if (this.finalized) return this;
    let next = 0;
    for (const b of this.blocks) {
      b.firstState = next;
      next += b.stateCount;
    }
    if (next > 65535) throw new Error(`too many block states (${next})`);
    const n = (this.stateCount = next);
    this.stateBlock = new Uint16Array(n);
    this.flags = new Uint16Array(n);
    this.model = new Uint8Array(n);
    this.layer = new Uint8Array(n);
    this.emission = new Uint8Array(n);
    this.opacity = new Uint8Array(n);
    this.tint = new Uint8Array(n);
    this.wave = new Uint8Array(n);
    this.hardness = new Float32Array(n);
    this.faceTextureNames = new Array<string>(n * 6).fill('missing');
    this.faceLayer = new Uint16Array(n * 6);
    this.boxVariants = new Array<ResolvedBox[][] | null>(n).fill(null);
    this.collisionVariants = new Array<Float32Array[] | null>(n).fill(null);
    this.selectionVariants = new Array<Float32Array>(n);
    this.variantCount = new Uint8Array(n);

    for (const b of this.blocks) {
      const s = b.spec;
      const model = s.model ?? 'cube';
      const layerName = s.layer ?? 'opaque';
      for (let i = 0; i < b.stateCount; i++) {
        const state = b.firstState + i;
        const props = b.propsOf(state);
        this.stateBlock[state] = b.id;
        const modelId =
          model === 'none'
            ? Model.None
            : model === 'cross'
              ? Model.Cross
              : model === 'liquid'
                ? Model.Liquid
                : model === 'boxes'
                  ? Model.Boxes
                  : Model.Cube;
        this.model[state] = modelId;
        this.layer[state] =
          layerName === 'cutout'
            ? Layer.Cutout
            : layerName === 'transparent'
              ? Layer.Transparent
              : Layer.Opaque;
        const solid = s.solid ?? (modelId === Model.Cube || modelId === Model.Boxes);
        const opaque = s.opaque ?? (modelId === Model.Cube && layerName === 'opaque');
        let f = 0;
        if (solid) f |= Flag.Solid;
        if (opaque) f |= Flag.Opaque;
        if (s.replaceable) f |= Flag.Replaceable;
        if (s.liquid) f |= Flag.Liquid;
        if (s.cullSame) f |= Flag.CullSame;
        if (s.selectable ?? (modelId !== Model.None && !s.liquid)) f |= Flag.Selectable;
        if (s.climbable) f |= Flag.Climbable;
        if (s.lightSink) f |= Flag.LightSink;
        this.flags[state] = f;
        const emission =
          typeof s.lightEmission === 'function' ? s.lightEmission(props) : (s.lightEmission ?? 0);
        this.emission[state] = emission;
        this.opacity[state] = s.lightOpacity ?? (opaque || s.lightSink ? 15 : 0);
        this.tint[state] =
          s.tint === 'grass'
            ? Tint.Grass
            : s.tint === 'foliage'
              ? Tint.Foliage
              : s.tint === 'water'
                ? Tint.Water
                : Tint.None;
        this.wave[state] =
          s.wave === 'leaves' ? Wave.Leaves : s.wave === 'plant' ? Wave.Plant : Wave.None;
        this.hardness[state] = s.hardness ?? 1;
        const variants = s.connect?.variants ?? 1;
        this.variantCount[state] = variants;
        const selections = new Float32Array(variants * 6);
        const collisions: Float32Array[] = [];
        for (let v = 0; v < variants; v++) {
          const boxes = s.boxes?.(props, v) ?? [];
          const aabbs: AabbSpec[] = s.collision?.(props, v) ?? boxes.map((bx) => rotatedAabb(bx));
          const flat = new Float32Array(aabbs.length * 6);
          aabbs.forEach((a, k) => {
            for (let j = 0; j < 6; j++) flat[k * 6 + j] = a[j]! / 16;
          });
          collisions.push(flat);
          const sel = selections.subarray(v * 6, v * 6 + 6);
          if (modelId === Model.Boxes && boxes.length > 0) {
            sel.set([1, 1, 1, 0, 0, 0]);
            const p: number[] = [0, 0, 0];
            for (const bx of boxes) {
              for (let corner = 0; corner < 8; corner++) {
                transformPoint(
                  bx,
                  corner & 1 ? bx.to[0] : bx.from[0],
                  corner & 2 ? bx.to[1] : bx.from[1],
                  corner & 4 ? bx.to[2] : bx.from[2],
                  p,
                );
                for (let j = 0; j < 3; j++) {
                  sel[j] = Math.max(0, Math.min(sel[j]!, p[j]! / 16));
                  sel[j + 3] = Math.min(1, Math.max(sel[j + 3]!, p[j]! / 16));
                }
              }
            }
          } else if (modelId === Model.Cross) {
            sel.set([0.15, 0, 0.15, 0.85, 0.8, 0.85]);
          } else {
            sel.set([0, 0, 0, 1, 1, 1]);
          }
        }
        if (modelId === Model.Boxes || s.collision) this.collisionVariants[state] = collisions;
        this.selectionVariants[state] = selections;
        if (s.textures) {
          const spec = typeof s.textures === 'function' ? s.textures(props) : s.textures;
          const faces = resolveSpec(spec);
          for (let face = 0; face < 6; face++)
            this.faceTextureNames[state * 6 + face] = faces[FACE_NAMES[face]!];
        }
      }
    }
    this.finalized = true;
    return this;
  }

  /** All texture names referenced by any block (for validation). */
  referencedTextures(): Set<string> {
    const names = new Set(this.faceTextureNames);
    for (const b of this.blocks) {
      if (!b.spec.boxes) continue;
      for (let i = 0; i < b.stateCount; i++) {
        for (let v = 0; v < (b.spec.connect?.variants ?? 1); v++) {
          for (const box of b.spec.boxes(b.propsOf(b.firstState + i), v)) {
            for (const f of Object.values(box.faces)) if (f) names.add(f.tex);
          }
        }
      }
    }
    return names;
  }

  /** Maps texture names to atlas layers. Unknown names use the `missing` texture. */
  resolveTextures(layerOf: (name: string) => number | undefined): void {
    const missing = layerOf('missing') ?? 0;
    const lookup = (name: string) => layerOf(name) ?? missing;
    for (let i = 0; i < this.faceTextureNames.length; i++) {
      this.faceLayer[i] = lookup(this.faceTextureNames[i]!);
    }
    for (const b of this.blocks) {
      if (!b.spec.boxes) continue;
      for (let i = 0; i < b.stateCount; i++) {
        const state = b.firstState + i;
        const props = b.propsOf(state);
        const variants: ResolvedBox[][] = [];
        for (let v = 0; v < (b.spec.connect?.variants ?? 1); v++) {
          variants.push(
            b.spec.boxes(props, v).map((box) => ({
              ...box,
              faces: FACE_NAMES.map((fn) => {
                const f = box.faces[fn];
                if (!f) return null;
                return {
                  layer: lookup(f.tex),
                  uv: f.uv ?? defaultUv(box, fn),
                  cull: f.cull ? FACE_NAMES.indexOf(f.cull) : -1,
                };
              }),
            })),
          );
        }
        this.boxVariants[state] = variants;
      }
    }
  }
}

/** Axis-aligned bounds of a box after its Y rotation (tilts are ignored). */
function rotatedAabb(bx: Box): AabbSpec {
  const a: number[] = [0, 0, 0];
  const b: number[] = [0, 0, 0];
  const t = { rotateY: bx.rotateY ?? 0 } as const;
  transformPoint(t, bx.from[0], bx.from[1], bx.from[2], a);
  transformPoint(t, bx.to[0], bx.to[1], bx.to[2], b);
  return [
    Math.min(a[0]!, b[0]!),
    Math.min(a[1]!, b[1]!),
    Math.min(a[2]!, b[2]!),
    Math.max(a[0]!, b[0]!),
    Math.max(a[1]!, b[1]!),
    Math.max(a[2]!, b[2]!),
  ];
}

/** Texture region matching the box extent on that face (like Minecraft's auto-UV). */
function defaultUv(box: Box, face: FaceName): [number, number, number, number] {
  const [x0, y0, z0] = box.from;
  const [x1, y1, z1] = box.to;
  switch (face) {
    case 'up':
    case 'down':
      return [x0, z0, x1, z1];
    case 'north':
    case 'south':
      return [x0, 16 - y1, x1, 16 - y0];
    default:
      return [z0, 16 - y1, z1, 16 - y0];
  }
}
