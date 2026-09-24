/**
 * Central game constants. The game name lives here only, so a rename before
 * launch is a one-line change.
 */
export const GAME_NAME = 'CubeCraft Legends';
export const GAME_VERSION = '0.1.0';

/** Edge length of a chunk section in blocks. */
export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = CHUNK_SIZE - 1;
/** Blocks per section (16³). */
export const SECTION_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
/** World height in blocks (y = 0 … WORLD_HEIGHT - 1). */
export const WORLD_HEIGHT = 256;
export const SECTIONS_PER_COLUMN = WORLD_HEIGHT / CHUNK_SIZE;
export const SEA_LEVEL = 62;

/** World simulation rate (crop growth, fluids, mobs). */
export const TICKS_PER_SECOND = 20;
/** Player physics rate. */
export const PHYSICS_HZ = 60;

/** Length of a full day/night cycle in ticks (20 minutes). */
export const DAY_LENGTH_TICKS = 24000;

export const MAX_LIGHT = 15;
