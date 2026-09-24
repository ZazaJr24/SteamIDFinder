/**
 * Texture generator entry point (`npm run textures`).
 * Placeholder until the procedural generator lands in M1.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'public/generated';
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/textures.json`, JSON.stringify({ tileSize: 16, textures: [] }, null, 2));
console.log('[texgen] wrote empty manifest');
