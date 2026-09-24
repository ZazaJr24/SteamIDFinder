/** Right-click actions on blocks: open doors and trapdoors, flip levers, sleep … */
import { BLOCKS } from '../world/blocks/blocks';
import { opposite, type Horizontal } from '../world/blocks/shapes';
import type { World } from '../world/world';
import { lookFacing } from './placement';
import { setDoorOpen, type PowerSystem } from './power';

export interface UseContext {
  world: World;
  power: PowerSystem;
  yaw: number;
  /** Schedules `fn` after `seconds` of game time. */
  schedule(seconds: number, fn: () => void): void;
  /** The player tries to sleep in the bed at (x, y, z). */
  sleep(x: number, y: number, z: number): void;
  /** Opens a block's own screen (chest, crafting table). */
  openScreen?(kind: string, x: number, y: number, z: number): boolean;
}

/** Performs the block's action. Returns true if the click was used up. */
export function useBlock(ctx: UseContext, x: number, y: number, z: number, state: number): boolean {
  const { world } = ctx;
  const block = BLOCKS.blockOf(state);
  const name = block.name;
  const props = block.propsOf(state);

  if (name.endsWith('_door')) {
    if (name === 'iron_door') return true; // needs power
    const lowerY = props.half === 'upper' ? y - 1 : y;
    setDoorOpen(world, x, lowerY, z, !props.open);
    return true;
  }
  if (name.endsWith('_trapdoor')) {
    if (name === 'iron_trapdoor') return true;
    world.setBlock(x, y, z, block.state({ ...props, open: !props.open }));
    return true;
  }
  if (name.endsWith('_fence_gate')) {
    const open = !props.open;
    // Gates swing away from the player.
    let facing = props.facing as Horizontal;
    if (open) {
      const look = lookFacing(ctx.yaw);
      if (look === opposite(facing)) facing = look;
    }
    world.setBlock(x, y, z, block.state({ ...props, open, facing }));
    return true;
  }
  if (name === 'lever') {
    const next = block.state({ ...props, powered: !props.powered });
    world.setBlock(x, y, z, next);
    ctx.power.sourceChanged(x, y, z, next);
    return true;
  }
  if (name.endsWith('_button')) {
    if (props.powered) return true;
    const pressed = block.state({ ...props, powered: true });
    world.setBlock(x, y, z, pressed);
    ctx.power.sourceChanged(x, y, z, pressed);
    ctx.schedule(name === 'stone_button' ? 1 : 1.5, () => {
      if (world.getBlock(x, y, z) !== pressed) return;
      const released = block.state({ ...props, powered: false });
      world.setBlock(x, y, z, released);
      ctx.power.sourceChanged(x, y, z, released);
    });
    return true;
  }
  if (name.endsWith('_bed')) {
    ctx.sleep(x, y, z);
    return true;
  }
  if (name === 'chest' || name === 'crafting_table')
    return ctx.openScreen?.(name, x, y, z) ?? false;
  return false;
}
