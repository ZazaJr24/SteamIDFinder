import { describe, expect, it } from 'vitest';
import { B, BLOCKS } from '../../src/world/blocks/blocks';
import { Column } from '../../src/world/chunk';
import { World } from '../../src/world/world';
import { PowerSystem, setDoorOpen } from '../../src/gameplay/power';
import { planPlacement } from '../../src/gameplay/placement';
import { useBlock, type UseContext } from '../../src/gameplay/use';
import { Face } from '../../src/world/blocks/registry';
import { Player } from '../../src/entity/player';
import type { RayHit } from '../../src/world/raycast';

function flatWorld(): World {
  const world = new World(1);
  for (let cz = -1; cz <= 1; cz++)
    for (let cx = -1; cx <= 1; cx++) {
      const col = new Column(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) col.setBlock(x, 0, z, B.stone);
      world.light.lightColumn(col, cx * 16, cz * 16);
      world.addColumn(col);
    }
  return world;
}

const hit = (x: number, y: number, z: number, face: Face, state: number, py = y + 0.5): RayHit => ({
  x,
  y,
  z,
  face,
  state,
  variant: 0,
  distance: 1,
  point: [x + 0.5, py, z + 0.5],
});

function ctx(world: World, power: PowerSystem): UseContext {
  return { world, power, yaw: 0, schedule: () => undefined, sleep: () => undefined };
}

describe('connected shapes', () => {
  it('fences connect to neighbours and solid blocks', () => {
    const fence = BLOCKS.id('oak_fence');
    const at = new Map<string, number>([
      ['1,0,0', fence],
      ['0,0,-1', B.stone],
    ]);
    const n = (dx: number, dy: number, dz: number) => at.get(`${dx},${dy},${dz}`) ?? 0;
    // north (stone) = 1, east (fence) = 2
    expect(BLOCKS.variantOf(fence, n)).toBe(1 | 2);
  });

  it('stairs form an outer corner', () => {
    const east = BLOCKS.id('oak_stairs', { facing: 'east', half: 'bottom' });
    const north = BLOCKS.id('oak_stairs', { facing: 'north', half: 'bottom' });
    // The block behind (east) is a north-facing stair: outer corner to the left (north).
    const n = (dx: number, dy: number, dz: number) =>
      dx === 1 && dy === 0 && dz === 0 ? north : 0;
    expect(BLOCKS.variantOf(east, n)).toBe(3);
  });
});

describe('placement', () => {
  it('places a two-block door and a bed', () => {
    const w = flatWorld();
    const get = (x: number, y: number, z: number) => w.getBlock(x, y, z);
    const door = planPlacement(
      BLOCKS.id('oak_door'),
      hit(2, 0, 2, Face.Up, B.stone),
      2,
      1,
      2,
      0,
      get,
    )!;
    expect(door).toHaveLength(2);
    expect(BLOCKS.propsOf(door[1]!.state).half).toBe('upper');
    const bed = planPlacement(
      BLOCKS.id('red_bed'),
      hit(5, 0, 5, Face.Up, B.stone),
      5,
      1,
      5,
      0,
      get,
    )!;
    expect(bed.map((p) => BLOCKS.propsOf(p.state).part)).toEqual(['foot', 'head']);
    // yaw 0 looks north: the head is one block further north.
    expect(bed[1]!.z).toBe(4);
  });

  it('puts trapdoors in the upper half when clicking high on a wall', () => {
    const w = flatWorld();
    const get = (x: number, y: number, z: number) => w.getBlock(x, y, z);
    const td = BLOCKS.id('oak_trapdoor');
    const low = planPlacement(td, hit(3, 1, 3, Face.East, B.stone, 1.2), 4, 1, 3, 0, get)!;
    const high = planPlacement(td, hit(3, 1, 3, Face.East, B.stone, 1.8), 4, 1, 3, 0, get)!;
    expect(BLOCKS.propsOf(low[0]!.state).half).toBe('bottom');
    expect(BLOCKS.propsOf(high[0]!.state).half).toBe('top');
    expect(BLOCKS.propsOf(high[0]!.state).facing).toBe('east');
  });

  it('refuses torches on the underside of blocks', () => {
    const w = flatWorld();
    const get = (x: number, y: number, z: number) => w.getBlock(x, y, z);
    expect(planPlacement(B.torch, hit(1, 5, 1, Face.Down, B.stone), 1, 4, 1, 0, get)).toBeNull();
  });
});

describe('using blocks and power', () => {
  it('opens and closes both door halves by hand', () => {
    const w = flatWorld();
    const power = new PowerSystem(w);
    const d = BLOCKS.get('oak_door');
    w.setBlock(1, 1, 1, d.state({ half: 'lower' }));
    w.setBlock(1, 2, 1, d.state({ half: 'upper' }));
    useBlock(ctx(w, power), 1, 2, 1, w.getBlock(1, 2, 1));
    expect(BLOCKS.propsOf(w.getBlock(1, 1, 1)).open).toBe(true);
    expect(BLOCKS.propsOf(w.getBlock(1, 2, 1)).open).toBe(true);
    expect(setDoorOpen(w, 1, 1, 1, false)).toBe(true);
    expect(BLOCKS.propsOf(w.getBlock(1, 2, 1)).open).toBe(false);
  });

  it('a lever lights an adjacent lamp and a lamp next to its wall', () => {
    const w = flatWorld();
    const power = new PowerSystem(w);
    const lamp = BLOCKS.id('glutstein_lamp');
    w.setBlock(5, 1, 5, B.stone); // the wall
    w.setBlock(4, 1, 5, lamp); // next to the wall
    w.setBlock(6, 2, 5, lamp); // above the lever
    const lever = BLOCKS.id('lever', { face: 'wall', facing: 'east' });
    w.setBlock(6, 1, 5, lever); // attached to the wall on its west side
    useBlock(ctx(w, power), 6, 1, 5, lever);
    expect(BLOCKS.propsOf(w.getBlock(4, 1, 5)).lit).toBe(true);
    expect(BLOCKS.propsOf(w.getBlock(6, 2, 5)).lit).toBe(true);
    expect(w.getLight(4, 2, 5) & 15).toBe(14);
    useBlock(ctx(w, power), 6, 1, 5, w.getBlock(6, 1, 5));
    expect(BLOCKS.propsOf(w.getBlock(4, 1, 5)).lit).toBe(false);
  });
});

describe('movement on shapes', () => {
  it('walks up a slab without jumping', () => {
    const w = flatWorld();
    for (let x = 3; x < 12; x++) w.setBlock(x, 1, 0, BLOCKS.id('stone_slab', { type: 'bottom' }));
    const p = new Player();
    p.mode = 'survival';
    p.teleport(0.5, 1, 0.5);
    p.yaw = -Math.PI / 2; // +x
    for (let i = 0; i < 90; i++)
      p.step(1 / 60, { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false }, w);
    expect(p.position.x).toBeGreaterThan(3.5);
    expect(p.position.y).toBeCloseTo(1.5, 3);
  });

  it('climbs a ladder', () => {
    const w = flatWorld();
    for (let y = 1; y < 6; y++) {
      w.setBlock(3, y, 0, B.stone);
      w.setBlock(2, y, 0, BLOCKS.id('ladder', { facing: 'west' }));
    }
    const p = new Player();
    p.mode = 'survival';
    p.teleport(2.5, 1, 0.5);
    p.yaw = -Math.PI / 2;
    for (let i = 0; i < 120; i++)
      p.step(1 / 60, { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false }, w);
    expect(p.position.y).toBeGreaterThan(3);
  });
});
