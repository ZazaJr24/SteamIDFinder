/** Geometry helpers shared by the mesher, selection boxes and the registry. */

// Face indices (see `Face` in registry.ts; duplicated to avoid an import cycle).
const EAST = 0;
const WEST = 1;
const UP = 2;
const DOWN = 3;
const SOUTH = 4;
const NORTH = 5;

export interface BoxTransform {
  rotation?: { axis: 'x' | 'z'; angle: number; origin: readonly [number, number, number] };
  /** Rotation around the block's vertical center axis, applied last. */
  rotateY?: 0 | 90 | 180 | 270;
}

/**
 * Transforms a point (1/16 block units) by the box's tilt, then its Y
 * rotation. Writes the result into `out`.
 */
export function transformPoint(
  t: BoxTransform,
  x: number,
  y: number,
  z: number,
  out: number[],
): number[] {
  if (t.rotation) {
    const { axis, angle, origin } = t.rotation;
    const a = (angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const px = x - origin[0];
    const py = y - origin[1];
    const pz = z - origin[2];
    if (axis === 'z') {
      x = origin[0] + px * c - py * s;
      y = origin[1] + px * s + py * c;
    } else {
      y = origin[1] + py * c - pz * s;
      z = origin[2] + py * s + pz * c;
    }
  }
  switch (t.rotateY ?? 0) {
    case 90: // east → south (clockwise seen from above)
      [x, z] = [16 - z, x];
      break;
    case 180:
      [x, z] = [16 - x, 16 - z];
      break;
    case 270:
      [x, z] = [z, 16 - x];
      break;
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** Where a horizontal face ends up after a Y rotation. */
export function rotateFaceY(face: number, rotateY: number): number {
  if (face === UP || face === DOWN || !rotateY) return face;
  const ring = [EAST, SOUTH, WEST, NORTH];
  const i = ring.indexOf(face);
  return ring[(i + rotateY / 90) % 4]!;
}

/** Y rotation that turns an east-facing model toward `facing`. */
export function rotationForFacing(facing: string): 0 | 90 | 180 | 270 {
  switch (facing) {
    case 'south':
      return 90;
    case 'west':
      return 180;
    case 'north':
      return 270;
    default:
      return 0;
  }
}
