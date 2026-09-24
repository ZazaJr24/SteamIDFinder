import { describe, expect, it } from 'vitest';
import { B } from '../../src/world/blocks/blocks';
import { Player } from '../../src/entity/player';
import { raycast } from '../../src/world/raycast';
import { Face } from '../../src/world/blocks/registry';

/** Floor at y = 0 everywhere, a wall at x = 3. */
const world = {
  getState: (x: number, y: number, _z: number) => (y === 0 || (x === 3 && y < 3) ? B.stone : B.air),
  getBlock: (x: number, y: number, z: number) => world.getState(x, y, z),
};

const idle = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

describe('player physics', () => {
  it('falls onto the ground and stands on it', () => {
    const p = new Player();
    p.mode = 'survival';
    p.teleport(0.5, 5, 0.5);
    for (let i = 0; i < 120; i++) p.step(1 / 60, idle, world);
    expect(p.position.y).toBeCloseTo(1, 5);
    expect(p.onGround).toBe(true);
  });

  it('cannot walk through a wall', () => {
    const p = new Player();
    p.mode = 'survival';
    p.teleport(0.5, 1, 0.5);
    p.yaw = -Math.PI / 2; // facing +x
    for (let i = 0; i < 240; i++) p.step(1 / 60, { ...idle, forward: 1 }, world);
    expect(p.position.x).toBeLessThanOrEqual(3 - 0.3 + 1e-6);
    expect(p.position.x).toBeGreaterThan(2.5);
  });

  it('jumps a bit over one block high', () => {
    const p = new Player();
    p.mode = 'survival';
    p.teleport(0.5, 1, 0.5);
    p.step(1 / 60, idle, world);
    let maxY = 0;
    p.step(1 / 60, { ...idle, jump: true }, world);
    for (let i = 0; i < 60; i++) {
      p.step(1 / 60, idle, world);
      maxY = Math.max(maxY, p.position.y);
    }
    expect(maxY - 1).toBeGreaterThan(1.1);
    expect(maxY - 1).toBeLessThan(1.5);
  });
});

describe('raycast', () => {
  it('hits the wall face facing the viewer', () => {
    const hit = raycast(world, 0.5, 1.5, 0.5, 1, 0, 0, 10);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([3, 1, 0]);
    expect(hit!.face).toBe(Face.West);
    expect(hit!.distance).toBeCloseTo(2.5, 5);
  });

  it('misses beyond reach', () => {
    expect(raycast(world, 0.5, 1.5, 0.5, 1, 0, 0, 2)).toBeNull();
  });
});
