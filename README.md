# CubeCraft Legends

A voxel sandbox game for the browser (build, explore, survive), made for
[CrazyGames](https://www.crazygames.com). Written in TypeScript with three.js and WebGL2.

> "CubeCraft Legends" is a working title. The name lives in `src/config.ts`.

## Getting started

```bash
npm install
npm run dev        # dev server with hot reload
```

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | Generate textures and start the dev server                |
| `npm run build`      | Type-check and build the production bundle into `dist/`   |
| `npm run check:size` | Check `dist/` against the CrazyGames size and file limits |
| `npm test`           | Unit tests (Vitest)                                       |
| `npm run test:e2e`   | Build, then run the browser smoke test (Playwright)       |
| `npm run lint`       | ESLint                                                    |
| `npm run textures`   | Regenerate the procedural texture atlas                   |

Add `?nosdk` to the URL to skip loading the CrazyGames SDK during local development.

## Project layout

```
src/core        loop, input, settings, events, seeded random
src/platform    CrazyGames SDK wrapper and storage
src/world       blocks, chunks, generation, lighting, saves
src/render      renderer, meshing, shaders, textures
src/entity      player, mobs, physics
src/gameplay    items, inventory, crafting, survival
src/ui          HUD, menus, translations
tools/texgen    procedural pixel-art texture generator
data/           recipes, loot tables, translations
```

The full roadmap is in [docs/PLAN.md](docs/PLAN.md).

## Legal

All textures, sounds and models are original or CC0. The game uses no assets,
names or trademarks from Minecraft or Mojang.
