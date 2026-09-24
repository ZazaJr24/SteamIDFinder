/**
 * Box models for shaped blocks: slabs, stairs, fences, gates, walls, panes,
 * doors, trapdoors, ladders, levers, buttons, pressure plates, chests, beds.
 *
 * Directional models are written for one direction (usually east) and
 * rotated with `rotateY`; `rotationForFacing` turns an east model to face
 * any horizontal direction.
 */
import { rotationForFacing } from './models';
import type {
  AabbSpec,
  Box,
  BlockRegistry,
  ConnectSpec,
  FaceName,
  NeighborFn,
  Props,
} from './registry';
import { Flag, Model } from './registry';

export const HORIZONTAL = ['north', 'south', 'east', 'west'] as const;
export type Horizontal = (typeof HORIZONTAL)[number];

export const DIR: Record<Horizontal, readonly [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

export function clockwise(d: Horizontal): Horizontal {
  return ({ north: 'east', east: 'south', south: 'west', west: 'north' } as const)[d];
}

export function counterClockwise(d: Horizontal): Horizontal {
  return ({ north: 'west', west: 'south', south: 'east', east: 'north' } as const)[d];
}

export function opposite(d: Horizontal): Horizontal {
  return ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[d];
}

type FaceTex = string | Partial<Record<FaceName | 'side' | 'all', string>>;

/**
 * A box with the given textures. Faces lying on the block boundary are culled
 * against opaque neighbours automatically.
 */
export function cuboid(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  tex: FaceTex,
  extra: Partial<Pick<Box, 'rotation' | 'rotateY'>> & {
    skip?: FaceName[];
    uv?: Partial<Record<FaceName, readonly [number, number, number, number]>>;
  } = {},
): Box {
  const pick = (f: FaceName): string => {
    if (typeof tex === 'string') return tex;
    const side = f !== 'up' && f !== 'down' ? tex.side : undefined;
    return tex[f] ?? side ?? tex.all ?? 'missing';
  };
  const bounds: Record<FaceName, boolean> = {
    west: from[0] <= 0,
    east: to[0] >= 16,
    down: from[1] <= 0,
    up: to[1] >= 16,
    north: from[2] <= 0,
    south: to[2] >= 16,
  };
  const faces: Box['faces'] = {};
  for (const f of ['east', 'west', 'up', 'down', 'south', 'north'] as const) {
    if (extra.skip?.includes(f)) continue;
    faces[f] = {
      tex: pick(f),
      ...(extra.uv?.[f] ? { uv: extra.uv[f] } : {}),
      ...(bounds[f] && !extra.rotation ? { cull: f } : {}),
    };
  }
  const box: Box = { from, to, faces };
  if (extra.rotation) box.rotation = extra.rotation;
  if (extra.rotateY) box.rotateY = extra.rotateY;
  return box;
}

function rotated(boxes: Box[], facing: string): Box[] {
  const r = rotationForFacing(facing);
  return r ? boxes.map((b) => ({ ...b, rotateY: r })) : boxes;
}

// ------------------------------------------------------------------ slabs

export function slabBoxes(tex: FaceTex) {
  return (p: Props): Box[] => {
    if (p.type === 'top') return [cuboid([0, 8, 0], [16, 16, 16], tex)];
    if (p.type === 'double') return [cuboid([0, 0, 0], [16, 16, 16], tex)];
    return [cuboid([0, 0, 0], [16, 8, 16], tex)];
  };
}

// ----------------------------------------------------------------- stairs

export const STAIR_SHAPES = [
  'straight',
  'inner_left',
  'inner_right',
  'outer_left',
  'outer_right',
] as const;

function isStairs(reg: BlockRegistry, state: number): boolean {
  return reg.blockOf(state).name.endsWith('_stairs');
}

export const stairsConnect: ConnectSpec = {
  variants: STAIR_SHAPES.length,
  variant(p: Props, n: NeighborFn, reg: BlockRegistry): number {
    const facing = p.facing as Horizontal;
    const half = p.half;
    const at = (d: Horizontal) => n(DIR[d][0], 0, DIR[d][2]);
    const same = (s: number) => isStairs(reg, s) && reg.propsOf(s).half === half;
    // A neighbour on `side` that is a stair with our facing and half blocks the corner.
    const canTake = (side: Horizontal) => {
      const s = at(side);
      return !(same(s) && reg.propsOf(s).facing === facing);
    };
    const behind = at(facing);
    if (same(behind)) {
      const d = reg.propsOf(behind).facing as Horizontal;
      if (d !== facing && d !== opposite(facing) && canTake(opposite(d))) {
        return d === counterClockwise(facing) ? 3 : 4;
      }
    }
    const front = at(opposite(facing));
    if (same(front)) {
      const d = reg.propsOf(front).facing as Horizontal;
      if (d !== facing && d !== opposite(facing) && canTake(d)) {
        return d === counterClockwise(facing) ? 1 : 2;
      }
    }
    return 0;
  },
};

/** Stairs modeled facing east (the high side is east), then rotated. */
export function stairsBoxes(tex: FaceTex) {
  return (p: Props, variant: number): Box[] => {
    const top = p.half === 'top';
    const slab = top ? cuboid([0, 8, 0], [16, 16, 16], tex) : cuboid([0, 0, 0], [16, 8, 16], tex);
    const y0 = top ? 0 : 8;
    const y1 = top ? 8 : 16;
    const step = (x0: number, z0: number, x1: number, z1: number) =>
      cuboid([x0, y0, z0], [x1, y1, z1], tex);
    const shape = STAIR_SHAPES[variant] ?? 'straight';
    const steps: Box[] = [];
    // "Left" of an east-facing stair is north (-z).
    if (shape === 'straight') steps.push(step(8, 0, 16, 16));
    else if (shape === 'outer_left') steps.push(step(8, 0, 16, 8));
    else if (shape === 'outer_right') steps.push(step(8, 8, 16, 16));
    else if (shape === 'inner_left') steps.push(step(8, 0, 16, 16), step(0, 0, 8, 8));
    else steps.push(step(8, 0, 16, 16), step(0, 8, 8, 16));
    return rotated([slab, ...steps], p.facing as string);
  };
}

// ---------------------------------------------------- fences, walls, panes

/** 4-bit mask of horizontal connections: north 1, east 2, south 4, west 8. */
function connectionMask(
  n: NeighborFn,
  connects: (state: number, dir: Horizontal) => boolean,
): number {
  let mask = 0;
  if (connects(n(0, 0, -1), 'north')) mask |= 1;
  if (connects(n(1, 0, 0), 'east')) mask |= 2;
  if (connects(n(0, 0, 1), 'south')) mask |= 4;
  if (connects(n(-1, 0, 0), 'west')) mask |= 8;
  return mask;
}

function solidCube(reg: BlockRegistry, s: number): boolean {
  return (reg.flags[s]! & Flag.Opaque) !== 0 && reg.model[s] === Model.Cube;
}

export function fenceConnect(): ConnectSpec {
  return {
    variants: 16,
    variant(_p, n, reg) {
      return connectionMask(n, (s) => {
        const name = reg.blockOf(s).name;
        return name.endsWith('_fence') || name.endsWith('_fence_gate') || solidCube(reg, s);
      });
    },
  };
}

export function wallConnect(): ConnectSpec {
  return {
    variants: 16,
    variant(_p, n, reg) {
      return connectionMask(n, (s) => {
        const name = reg.blockOf(s).name;
        return name.endsWith('_wall') || name.endsWith('_fence_gate') || solidCube(reg, s);
      });
    },
  };
}

export function paneConnect(): ConnectSpec {
  return {
    variants: 16,
    variant(_p, n, reg) {
      return connectionMask(n, (s) => {
        const name = reg.blockOf(s).name;
        return (
          name.endsWith('glass_pane') ||
          name.endsWith('glass') ||
          name.endsWith('_wall') ||
          solidCube(reg, s)
        );
      });
    },
  };
}

/** Arm boxes for each connected side, from a north-pointing template. */
function arms(mask: number, north: (dir: Horizontal) => Box[]): Box[] {
  const out: Box[] = [];
  const dirs: [number, Horizontal][] = [
    [1, 'north'],
    [2, 'east'],
    [4, 'south'],
    [8, 'west'],
  ];
  for (const [bit, dir] of dirs) if (mask & bit) out.push(...north(dir));
  return out;
}

/** Rotates a box given in "north arm" coordinates to another side (90° steps). */
function toSide(b: Box, dir: Horizontal): Box {
  // North template → east is 90° clockwise seen from above; our rotateY(90) maps east → south.
  const r = ({ north: 270, east: 0, south: 90, west: 180 } as const)[dir];
  // Templates are authored pointing north; re-author them pointing east first.
  const [x0, y0, z0] = b.from;
  const [x1, y1, z1] = b.to;
  const east: Box = { ...b, from: [16 - z1, y0, x0], to: [16 - z0, y1, x1] };
  return r ? { ...east, rotateY: r } : east;
}

export function fenceBoxes(tex: string) {
  return (_p: Props, mask: number): Box[] => [
    cuboid([6, 0, 6], [10, 16, 10], tex),
    ...arms(mask, (dir) => [
      toSide(cuboid([7, 6, 0], [9, 9, 6], tex), dir),
      toSide(cuboid([7, 12, 0], [9, 15, 6], tex), dir),
    ]),
  ];
}

export function fenceCollision(_p: Props, mask: number): AabbSpec[] {
  const out: AabbSpec[] = [[6, 0, 6, 10, 24, 10]];
  if (mask & 1) out.push([6, 0, 0, 10, 24, 6]);
  if (mask & 2) out.push([10, 0, 6, 16, 24, 10]);
  if (mask & 4) out.push([6, 0, 10, 10, 24, 16]);
  if (mask & 8) out.push([0, 0, 6, 6, 24, 10]);
  return out;
}

export function wallBoxes(tex: string) {
  return (_p: Props, mask: number): Box[] => [
    cuboid([4, 0, 4], [12, 16, 12], tex),
    ...arms(mask, (dir) => [toSide(cuboid([5, 0, 0], [11, 14, 4], tex), dir)]),
  ];
}

export function wallCollision(_p: Props, mask: number): AabbSpec[] {
  const out: AabbSpec[] = [[4, 0, 4, 12, 24, 12]];
  if (mask & 1) out.push([5, 0, 0, 11, 24, 4]);
  if (mask & 2) out.push([12, 0, 5, 16, 24, 11]);
  if (mask & 4) out.push([5, 0, 12, 11, 24, 16]);
  if (mask & 8) out.push([0, 0, 5, 4, 24, 11]);
  return out;
}

export function paneBoxes(tex: string, edge: string) {
  const faces = { side: tex, up: edge, down: edge };
  return (_p: Props, mask: number): Box[] => [
    cuboid([7, 0, 7], [9, 16, 9], faces),
    ...arms(mask, (dir) => [toSide(cuboid([7, 0, 0], [9, 16, 7], faces), dir)]),
  ];
}

export function paneCollision(_p: Props, mask: number): AabbSpec[] {
  const out: AabbSpec[] = [[7, 0, 7, 9, 16, 9]];
  if (mask & 1) out.push([7, 0, 0, 9, 16, 7]);
  if (mask & 2) out.push([9, 0, 7, 16, 16, 9]);
  if (mask & 4) out.push([7, 0, 9, 9, 16, 16]);
  if (mask & 8) out.push([0, 0, 7, 7, 16, 9]);
  return out;
}

// ------------------------------------------------------------ fence gates

/** Gate modeled facing east: it spans the z axis; opens by swinging toward +x. */
export function gateBoxes(tex: string) {
  return (p: Props): Box[] => {
    const boxes: Box[] = [cuboid([7, 5, 0], [9, 16, 2], tex), cuboid([7, 5, 14], [9, 16, 16], tex)];
    if (!p.open) {
      boxes.push(
        cuboid([7, 6, 2], [9, 9, 14], tex),
        cuboid([7, 12, 2], [9, 15, 14], tex),
        cuboid([7, 9, 6], [9, 12, 8], tex),
        cuboid([7, 9, 8], [9, 12, 10], tex),
      );
    } else {
      boxes.push(
        cuboid([9, 6, 0], [15, 9, 2], tex),
        cuboid([9, 12, 0], [15, 15, 2], tex),
        cuboid([13, 9, 0], [15, 12, 2], tex),
        cuboid([9, 6, 14], [15, 9, 16], tex),
        cuboid([9, 12, 14], [15, 15, 16], tex),
        cuboid([13, 9, 14], [15, 12, 16], tex),
      );
    }
    return rotated(boxes, p.facing as string);
  };
}

export function gateCollision(p: Props): AabbSpec[] {
  if (p.open) return [];
  const f = p.facing;
  return f === 'east' || f === 'west' ? [[6, 0, 0, 10, 24, 16]] : [[0, 0, 6, 16, 24, 10]];
}

// ------------------------------------------------------------------ doors

/**
 * Door modeled facing east: closed, the panel sits on the east edge of the
 * block; open, it swings around its hinge to lie along the north (left) or
 * south (right) edge.
 */
export function doorBoxes(topTex: string, bottomTex: string) {
  return (p: Props): Box[] => {
    const tex = p.half === 'upper' ? topTex : bottomTex;
    const faces = { all: tex };
    const edge: Partial<Record<FaceName, readonly [number, number, number, number]>> = {};
    let box: Box;
    if (!p.open) {
      box = cuboid([13, 0, 0], [16, 16, 16], faces, {
        uv: { ...edge, up: [13, 0, 16, 16], down: [13, 0, 16, 16] },
      });
    } else if (p.hinge === 'left') {
      box = cuboid([0, 0, 0], [16, 16, 3], faces, {
        uv: { up: [0, 0, 16, 3], down: [0, 0, 16, 3] },
      });
    } else {
      box = cuboid([0, 0, 13], [16, 16, 16], faces, {
        uv: { up: [0, 13, 16, 16], down: [0, 13, 16, 16] },
      });
    }
    return rotated([box], p.facing as string);
  };
}

// -------------------------------------------------------------- trapdoors

/**
 * Trapdoor ("Klappe") modeled facing east. Closed it lies flat at the bottom
 * or top of the block; open it stands against the west side (its hinge).
 */
export function trapdoorBoxes(tex: string) {
  return (p: Props): Box[] => {
    let box: Box;
    if (p.open) box = cuboid([0, 0, 0], [3, 16, 16], tex);
    else if (p.half === 'top') box = cuboid([0, 13, 0], [16, 16, 16], tex);
    else box = cuboid([0, 0, 0], [16, 3, 16], tex);
    return rotated([box], p.facing as string);
  };
}

// ----------------------------------------------------------------- ladder

/** Ladder modeled facing east (attached to the wall on its west side). */
export function ladderBoxes(tex: string) {
  return (p: Props): Box[] =>
    rotated(
      [cuboid([0, 0, 0], [1, 16, 16], tex, { skip: ['up', 'down', 'north', 'south'] })],
      p.facing as string,
    );
}

// ------------------------------------------------------ levers & buttons

/** Lever: `face` floor or wall; wall levers modeled facing east. */
export function leverBoxes(baseTex: string, handleTex: string) {
  return (p: Props): Box[] => {
    const on = p.powered === true;
    if (p.face === 'floor') {
      return rotated(
        [
          cuboid([4, 0, 5], [12, 3, 11], baseTex),
          cuboid([7, 1, 7], [9, 11, 9], handleTex, {
            rotation: { axis: 'z', angle: on ? -40 : 40, origin: [8, 1, 8] },
          }),
        ],
        p.facing as string,
      );
    }
    return rotated(
      [
        cuboid([0, 5, 4], [3, 11, 12], baseTex),
        cuboid([1, 7, 7], [11, 9, 9], handleTex, {
          rotation: { axis: 'z', angle: on ? -40 : 40, origin: [1, 8, 8] },
        }),
      ],
      p.facing as string,
    );
  };
}

export function buttonBoxes(tex: string) {
  return (p: Props): Box[] => {
    const depth = p.powered ? 1 : 2;
    if (p.face === 'floor')
      return rotated([cuboid([5, 0, 6], [11, depth, 10], tex)], p.facing as string);
    return rotated([cuboid([0, 6, 5], [depth, 10, 11], tex)], p.facing as string);
  };
}

export function plateBoxes(tex: string) {
  return (p: Props): Box[] => [cuboid([1, 0, 1], [15, p.powered ? 0.5 : 1, 15], tex)];
}

// ------------------------------------------------------------------ chest

/** Chest modeled facing east (the latch is on the east side). */
export function chestBoxes(top: string, side: string, front: string) {
  return (p: Props): Box[] =>
    rotated(
      [
        cuboid([1, 0, 1], [15, 14, 15], { up: top, down: top, east: front, side }),
        cuboid([15, 7, 7], [16, 11, 9], 'iron_block'),
      ],
      p.facing as string,
    );
}

// ------------------------------------------------------------------- beds

/** Bed modeled facing east: the head part is the east one. */
export function bedBoxes(color: string) {
  return (p: Props): Box[] => {
    const head = p.part === 'head';
    const top = `${color}_bed_top_${head ? 'head' : 'foot'}`;
    const side = `${color}_bed_side`;
    const frame = 'oak_planks';
    const boxes: Box[] = [
      cuboid(
        [0, 3, 0],
        [16, 9, 16],
        { up: top, down: frame, side },
        { skip: head ? ['west'] : ['east'] },
      ),
    ];
    // Legs at the outer corners of each half.
    const x0 = head ? 13 : 0;
    boxes.push(
      cuboid([x0, 0, 0], [x0 + 3, 3, 3], frame),
      cuboid([x0, 0, 13], [x0 + 3, 3, 16], frame),
    );
    return rotated(boxes, p.facing as string);
  };
}

export const BED_COLLISION: AabbSpec[] = [[0, 0, 0, 16, 9, 16]];
