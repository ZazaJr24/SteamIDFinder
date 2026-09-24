/**
 * `npm run textures`: renders every recipe into a texture atlas.
 *
 * Output (public/generated/, served next to index.html):
 *   blocks.png     atlas, 16×16 tiles, animation frames in consecutive tiles
 *   textures.json  manifest: name → { index, frames }
 * Plus .texgen/contact-sheet.html to review every texture at a glance.
 *
 * A PNG in assets/overrides/<name>.png replaces the generated texture. For
 * animated textures the PNG is a vertical strip of frames.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng, Tile } from './image';
import { buildTextureSet } from './textures';

const OUT_DIR = 'public/generated';
const SHEET_DIR = '.texgen';
const OVERRIDES = 'assets/overrides';
const TILE = 16;
const COLUMNS = 32;

export interface TextureManifest {
  tileSize: number;
  columns: number;
  atlas: string;
  count: number;
  textures: Record<string, { index: number; frames: number }>;
}

function loadOverride(name: string): Tile[] | null {
  const path = join(OVERRIDES, `${name}.png`);
  if (!existsSync(path)) return null;
  const img = decodePng(readFileSync(path));
  if (img.width !== TILE || img.height % TILE !== 0) {
    throw new Error(`${path}: must be ${TILE} px wide and a multiple of ${TILE} px tall`);
  }
  const frames: Tile[] = [];
  for (let f = 0; f < img.height / TILE; f++) {
    frames.push(
      Tile.from(TILE, TILE, img.data.subarray(f * TILE * TILE * 4, (f + 1) * TILE * TILE * 4)),
    );
  }
  return frames;
}

function main(): void {
  const started = performance.now();
  const set = buildTextureSet();
  const entries: { name: string; frames: Tile[]; override: boolean }[] = [];
  for (const name of set.names) {
    const override = loadOverride(name);
    entries.push({ name, frames: override ?? set.frames(name), override: !!override });
  }

  const count = entries.reduce((n, e) => n + e.frames.length, 0);
  const rows = Math.ceil(count / COLUMNS);
  const atlas = new Tile(COLUMNS * TILE, rows * TILE);
  const manifest: TextureManifest = {
    tileSize: TILE,
    columns: COLUMNS,
    atlas: 'blocks.png',
    count,
    textures: {},
  };
  let index = 0;
  for (const e of entries) {
    manifest.textures[e.name] = { index, frames: e.frames.length };
    for (const frame of e.frames) {
      atlas.blit(frame, (index % COLUMNS) * TILE, Math.floor(index / COLUMNS) * TILE);
      index++;
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'blocks.png'), encodePng(atlas));
  writeFileSync(join(OUT_DIR, 'textures.json'), JSON.stringify(manifest));

  mkdirSync(SHEET_DIR, { recursive: true });
  writeFileSync(join(SHEET_DIR, 'contact-sheet.html'), contactSheet(entries, manifest));

  const overrides = entries.filter((e) => e.override).length;
  console.log(
    `[texgen] ${entries.length} textures, ${count} tiles (${overrides} overrides) in ${Math.round(
      performance.now() - started,
    )} ms`,
  );
}

function contactSheet(entries: { name: string; override: boolean }[], m: TextureManifest): string {
  const cells = entries
    .map((e) => {
      const { index, frames } = m.textures[e.name]!;
      const x = (index % m.columns) * m.tileSize;
      const y = Math.floor(index / m.columns) * m.tileSize;
      return `<figure><div class="tex" style="background-position:-${x * 4}px -${y * 4}px"></div><figcaption>${e.name}${
        frames > 1 ? ` <b>×${frames}</b>` : ''
      }${e.override ? ' <i>override</i>' : ''}</figcaption></figure>`;
    })
    .join('\n');
  const w = m.columns * m.tileSize * 4;
  return `<!doctype html><meta charset="utf-8"><title>Texture contact sheet</title>
<style>
body{font:13px system-ui,sans-serif;background:#1e2127;color:#ddd;margin:16px}
h1{font-size:18px}.grid{display:flex;flex-wrap:wrap;gap:10px}
figure{margin:0;width:84px;text-align:center}
.tex{width:64px;height:64px;margin:0 auto;image-rendering:pixelated;
background:url(../public/generated/blocks.png) no-repeat,repeating-conic-gradient(#555 0 25%,#444 0 50%) 0 0/16px 16px;
background-size:${w}px auto,16px 16px}
figcaption{word-break:break-all;margin-top:4px}b{color:#9cf}i{color:#fc6}
</style>
<h1>${entries.length} textures · ${m.count} tiles</h1><div class="grid">${cells}</div>`;
}

main();
