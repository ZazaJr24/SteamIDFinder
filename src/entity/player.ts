/**
 * First-person player: movement physics (walking, sprinting, sneaking,
 * jumping, swimming, flying) at a fixed rate, with interpolation for
 * rendering.
 */
import * as THREE from 'three';
import { BLOCKS } from '../world/blocks/blocks';
import { Flag } from '../world/blocks/registry';
import { collides, moveBox, type Aabb, type BlockSource } from './physics';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const SNEAK_EYE_HEIGHT = 1.32;

const GRAVITY = 32;
const JUMP_VELOCITY = 9.1;
const TERMINAL_VELOCITY = 78;
const WALK_SPEED = 4.32;
const SPRINT_SPEED = 5.6;
const SNEAK_SPEED = 1.3;
const FLY_SPEED = 10.9;
const FLY_SPRINT_SPEED = 21.6;
const SWIM_SPEED = 2.2;
const STEP_HEIGHT = 0.6;
const CLIMB_SPEED = 2.4;

export type GameMode = 'survival' | 'creative' | 'peaceful';

export interface MoveInput {
  forward: number; // -1 … 1
  strafe: number; // -1 … 1 (right positive)
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface WorldQuery extends BlockSource {
  getBlock(x: number, y: number, z: number): number;
}

/** Is there ground right under the box (within a hair)? */
function collidesBelow(world: WorldQuery, box: Aabb): boolean {
  return collides(world, { ...box, minY: box.minY - 0.02, maxY: box.minY });
}

export class Player {
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  inWater = false;
  headInWater = false;
  onLadder = false;
  autoJump = false;
  flying = false;
  sneaking = false;
  sprinting = false;
  mode: GameMode = 'creative';
  /** Distance walked, for view bobbing and footsteps. */
  walkDistance = 0;
  prevWalkDistance = 0;
  /** Fall distance accumulated while airborne (for fall damage). */
  fallDistance = 0;
  private eyeHeight = EYE_HEIGHT;
  private prevEyeHeight = EYE_HEIGHT;
  /** Called when the player lands after falling `distance` blocks. */
  onLand: ((distance: number) => void) | null = null;

  get canFly(): boolean {
    return this.mode === 'creative';
  }

  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.fallDistance = 0;
  }

  box(out?: Aabb): Aabb {
    const hw = PLAYER_WIDTH / 2;
    const p = this.position;
    const b = out ?? { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    b.minX = p.x - hw;
    b.minY = p.y;
    b.minZ = p.z - hw;
    b.maxX = p.x + hw;
    b.maxY = p.y + PLAYER_HEIGHT;
    b.maxZ = p.z + hw;
    return b;
  }

  /** Interpolated eye position for rendering. */
  eye(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(this.prevPosition, this.position, alpha);
    out.y += this.prevEyeHeight + (this.eyeHeight - this.prevEyeHeight) * alpha;
    return out;
  }

  /** Unit vector the player looks along. */
  lookDirection(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  step(dt: number, input: MoveInput, world: WorldQuery): void {
    this.prevPosition.copy(this.position);
    this.prevEyeHeight = this.eyeHeight;
    this.prevWalkDistance = this.walkDistance;
    if (!this.canFly) this.flying = false;

    this.updateFluidState(world);
    this.sneaking = input.sneak && !this.flying;
    if (input.sprint && input.forward > 0 && !this.sneaking) this.sprinting = true;
    if (input.forward <= 0 || this.sneaking) this.sprinting = false;
    this.eyeHeight +=
      ((this.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT) - this.eyeHeight) * Math.min(1, dt * 12);

    // Desired horizontal velocity from input, relative to where the player looks.
    let fx = input.forward;
    let sx = input.strafe;
    const len = Math.hypot(fx, sx);
    if (len > 1) {
      fx /= len;
      sx /= len;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const dirX = -sin * fx + cos * sx;
    const dirZ = -cos * fx - sin * sx;

    let speed: number;
    if (this.flying) speed = this.sprinting ? FLY_SPRINT_SPEED : FLY_SPEED;
    else if (this.inWater) speed = SWIM_SPEED * (this.sprinting ? 1.5 : 1);
    else if (this.sneaking) speed = SNEAK_SPEED;
    else speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    const accel = this.flying ? 10 : this.onGround ? 20 : this.inWater ? 6 : 3.2;
    const k = 1 - Math.exp(-accel * dt);
    this.velocity.x += (dirX * speed - this.velocity.x) * k;
    this.velocity.z += (dirZ * speed - this.velocity.z) * k;

    if (this.flying) {
      const vy = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      this.velocity.y += (vy * speed * 0.75 - this.velocity.y) * (1 - Math.exp(-10 * dt));
    } else if (this.inWater) {
      this.velocity.y -= 9 * dt;
      if (input.jump) this.velocity.y += 22 * dt;
      this.velocity.y *= Math.exp(-3.5 * dt);
      this.velocity.y = Math.max(-4, Math.min(4, this.velocity.y));
      // Hop out of the water onto a ledge.
      if (input.jump && this.horizontalCollision(world))
        this.velocity.y = Math.max(this.velocity.y, 5);
    } else {
      if (input.jump && this.onGround) this.velocity.y = JUMP_VELOCITY;
      this.velocity.y = Math.max(-TERMINAL_VELOCITY, this.velocity.y - GRAVITY * dt);
    }

    let dx = this.velocity.x * dt;
    let dy = this.velocity.y * dt;
    let dz = this.velocity.z * dt;

    // Sneaking: never walk off an edge.
    if (this.sneaking && this.onGround) [dx, dz] = this.clampToEdge(world, dx, dz);

    // Ladders: climb while pushing into them or holding jump, hold on while sneaking.
    if (this.onLadder && !this.flying) {
      this.fallDistance = 0;
      if (input.jump || (input.forward > 0 && this.horizontalCollision(world)))
        this.velocity.y = CLIMB_SPEED;
      else if (this.sneaking) this.velocity.y = 0;
      else this.velocity.y = Math.max(this.velocity.y, -CLIMB_SPEED);
      dy = this.velocity.y * dt;
    }

    const box = this.box();
    const start = { ...box };
    let [mx, my, mz] = moveBox(world, box, dx, dy, dz);
    // Step up onto slabs and stairs (like walking up a small ledge).
    if (this.onGround && !this.flying && (mx !== dx || mz !== dz)) {
      const stepped = { ...start };
      const [, up] = moveBox(world, stepped, 0, STEP_HEIGHT, 0);
      const [sx, , sz] = moveBox(world, stepped, dx, 0, dz);
      const [, down] = moveBox(world, stepped, 0, -up, 0);
      if (Math.hypot(sx, sz) > Math.hypot(mx, mz) + 1e-4) {
        Object.assign(box, stepped);
        mx = sx;
        mz = sz;
        my = up + down;
      }
    }
    const wasOnGround = this.onGround;
    this.onGround =
      (dy < 0 && my > dy + 1e-9) ||
      (wasOnGround && my >= 0 && dy <= 0 && collidesBelow(world, box));
    if (mx !== dx) this.velocity.x = 0;
    if (mz !== dz) this.velocity.z = 0;
    if (my !== dy) this.velocity.y = 0;
    // Auto-jump: walking into a one-block step jumps onto it.
    if (
      this.autoJump &&
      this.onGround &&
      !this.flying &&
      !this.sneaking &&
      input.forward > 0 &&
      (mx !== dx || mz !== dz)
    ) {
      const probe = { ...box };
      const [, up] = moveBox(world, probe, 0, 1.2, 0);
      if (up > 1.1) {
        const [sx, , sz] = moveBox(world, probe, dx * 2, 0, dz * 2);
        if (Math.hypot(sx, sz) > Math.hypot(mx, mz) + 1e-3) this.velocity.y = JUMP_VELOCITY;
      }
    }
    this.position.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);

    if (this.onGround && this.flying) this.flying = false;
    if (this.onGround || this.inWater || this.flying) {
      if (!wasOnGround && this.onGround && this.fallDistance > 0) this.onLand?.(this.fallDistance);
      this.fallDistance = 0;
    } else if (my < 0) {
      this.fallDistance -= my;
    }
    if (this.onGround) this.walkDistance += Math.hypot(mx, mz);
  }

  toggleFly(): void {
    if (this.canFly) {
      this.flying = !this.flying;
      if (this.flying) this.velocity.y = 0;
    }
  }

  private updateFluidState(world: WorldQuery): void {
    const p = this.position;
    const feet = world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.3), Math.floor(p.z));
    const head = world.getBlock(Math.floor(p.x), Math.floor(p.y + this.eyeHeight), Math.floor(p.z));
    this.inWater = (BLOCKS.flags[feet]! & Flag.Liquid) !== 0;
    this.headInWater = (BLOCKS.flags[head]! & Flag.Liquid) !== 0;
    const body = world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z));
    const upper = world.getBlock(Math.floor(p.x), Math.floor(p.y + 1.1), Math.floor(p.z));
    this.onLadder = ((BLOCKS.flags[body]! | BLOCKS.flags[upper]!) & Flag.Climbable) !== 0;
  }

  private horizontalCollision(world: WorldQuery): boolean {
    const b = this.box();
    const probe = 0.1;
    const dx = Math.sign(this.velocity.x) * probe;
    const dz = Math.sign(this.velocity.z) * probe;
    b.minX += dx;
    b.maxX += dx;
    b.minZ += dz;
    b.maxZ += dz;
    return collides(world, b);
  }

  private clampToEdge(world: WorldQuery, dx: number, dz: number): [number, number] {
    const supported = (ox: number, oz: number) => {
      const b = this.box();
      b.minX += ox;
      b.maxX += ox;
      b.minZ += oz;
      b.maxZ += oz;
      b.minY -= 0.6;
      b.maxY = b.minY + 0.6;
      return collides(world, b);
    };
    const stepX = Math.sign(dx) * 0.05;
    while (dx !== 0 && !supported(dx, 0)) dx = Math.abs(dx) < 0.05 ? 0 : dx - stepX;
    const stepZ = Math.sign(dz) * 0.05;
    while (dz !== 0 && !supported(dx, dz)) dz = Math.abs(dz) < 0.05 ? 0 : dz - stepZ;
    return [dx, dz];
  }
}
