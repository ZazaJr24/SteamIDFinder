import './render/setup';
import * as THREE from 'three';
import { GameLoop, FixedStepper } from './core/loop';
import { MouseButton, type Input } from './core/input';
import type { Settings, SettingsStore } from './core/settings';
import { randomSeed } from './core/random';
import { PHYSICS_HZ } from './config';
import type { Platform } from './platform/crazygames';
import { Player, type MoveInput } from './entity/player';
import { BLOCKS } from './world/blocks/blocks';
import { Face, FACE_NORMALS } from './world/blocks/registry';
import { ChunkManager } from './world/chunk-manager';
import { TerrainGenerator } from './world/gen/terrain';
import { raycast, type RayHit } from './world/raycast';
import { World } from './world/world';
import { WorldRenderer } from './render/world-renderer';
import { loadBlockTextures, uploadMipmaps, type BlockTextures } from './render/textures';
import { SelectionBox } from './render/selection';
import { defaultWorkerCount, WorkerPool } from './workers/pool';
import type { GenRequest, GenResponse } from './workers/gen.worker';
import type { MeshRequest, MeshResponse } from './workers/mesh.worker';
import { Hud } from './ui/hud';
import { setLanguage } from './ui/i18n';
import { mainMenu, pauseMenu, settingsScreen, type UIManager } from './ui/screens';
import { placementState } from './gameplay/placement';
import { Hotbar } from './ui/hotbar';

export interface GameContext {
  canvas: HTMLCanvasElement;
  ui: UIManager;
  platform: Platform;
  settings: SettingsStore;
  input: Input;
}

type GameState = 'menu' | 'playing' | 'paused';

const SKY_COLOR = new THREE.Color(0x9cc4ff);
const REACH = 5;

/** Everything that belongs to one loaded world. */
interface Session {
  world: World;
  generator: TerrainGenerator;
  chunks: ChunkManager;
  renderer: WorldRenderer;
  player: Player;
  physics: FixedStepper;
  spawn: { x: number; y: number; z: number };
  /** The player is frozen until the ground under the spawn has loaded. */
  spawned: boolean;
}

/** Top-level game object: owns the renderer, the loop and the screen flow. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly loop: GameLoop;
  private readonly hud: Hud;
  private readonly hotbar: Hotbar;
  private readonly selection = new SelectionBox();
  private state: GameState = 'menu';
  /** Rebuilds the current screen, e.g. after a language change. */
  private currentScreen: (() => HTMLElement) | null = null;
  private textures: BlockTextures | null = null;
  private genPool: WorkerPool<GenRequest, GenResponse> | null = null;
  private meshPool: WorkerPool<MeshRequest, MeshResponse> | null = null;
  private session: Session | null = null;
  private time = 0;
  private target: RayHit | null = null;
  private breakCooldown = 0;
  private placeCooldown = 0;
  private lastJumpPress = -1;
  private readonly tmpDir = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = SKY_COLOR.clone();
    this.camera = new THREE.PerspectiveCamera(ctx.settings.value.fov, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.selection.object);
    this.hud = new Hud(ctx.ui.hud);
    this.hotbar = new Hotbar(ctx.ui.hud);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.loop = new GameLoop({ frame: (dt) => this.frame(dt) });

    ctx.input.onPointerLockChange((locked) => {
      if (!locked && this.state === 'playing') this.pause();
    });
    ctx.input.onKey((code) => this.onKey(code));
    ctx.settings.onChange((s) => this.applySettings(s));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  /** Loads textures and starts the worker pools. */
  async init(onProgress: (fraction: number) => void): Promise<void> {
    this.textures = await loadBlockTextures();
    uploadMipmaps(this.renderer, this.textures);
    onProgress(0.5);
    const layers = this.textures.layers;
    BLOCKS.resolveTextures((name) => layers[name]);
    const workers = defaultWorkerCount();
    this.genPool = new WorkerPool<GenRequest, GenResponse>(
      () => new Worker(new URL('./workers/gen.worker.ts', import.meta.url), { type: 'module' }),
      Math.max(1, Math.ceil(workers / 2)),
    );
    this.meshPool = new WorkerPool<MeshRequest, MeshResponse>(
      () => new Worker(new URL('./workers/mesh.worker.ts', import.meta.url), { type: 'module' }),
      workers,
    );
    this.meshPool.broadcast({ type: 'init', textureLayers: layers });
    this.hotbar.setTextures(this.textures);
    onProgress(1);
  }

  start(): void {
    this.applySettings(this.ctx.settings.value);
    this.loop.start();
  }

  /** Creates (or replaces) the world shown behind the menu and played in. */
  startWorld(seed = randomSeed()): void {
    this.endWorld();
    if (!this.textures || !this.genPool || !this.meshPool) throw new Error('game not initialized');
    const world = new World(seed);
    const generator = new TerrainGenerator(seed);
    const chunks = new ChunkManager(world, this.genPool);
    chunks.radius = this.ctx.settings.value.renderDistance;
    const renderer = new WorldRenderer(this.textures, this.meshPool);
    renderer.options.fastLeaves = this.ctx.settings.value.graphics === 'low';
    this.scene.add(renderer.group);
    const player = new Player();
    const spawn = generator.findSpawn();
    player.teleport(spawn.x, spawn.y, spawn.z);
    player.yaw = Math.PI * 0.25;
    this.session = {
      world,
      generator,
      chunks,
      renderer,
      player,
      spawn,
      spawned: false,
      physics: new FixedStepper(PHYSICS_HZ, (dt) => this.physicsStep(dt)),
    };
    this.applySettings(this.ctx.settings.value);
  }

  private endWorld(): void {
    const s = this.session;
    if (!s) return;
    s.chunks.reset();
    this.scene.remove(s.renderer.group);
    s.renderer.dispose();
    this.session = null;
  }

  showMainMenu(): void {
    this.state = 'menu';
    this.ctx.platform.gameplayStop();
    this.ctx.input.enabled = false;
    this.ctx.input.exitPointerLock();
    this.hud.setVisible(false);
    this.hotbar.setVisible(false);
    if (!this.session) this.startWorld();
    this.showScreen(() =>
      mainMenu(
        {
          play: () => this.play(),
          settings: () =>
            this.showScreen(() => settingsScreen(this.ctx.settings, () => this.showMainMenu())),
        },
        false,
      ),
    );
  }

  private play(): void {
    this.state = 'playing';
    this.showScreen(null);
    this.ctx.input.enabled = true;
    this.ctx.input.requestPointerLock();
    this.hud.setVisible(true);
    this.hotbar.setVisible(true);
    this.ctx.platform.gameplayStart();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ctx.input.enabled = false;
    this.ctx.platform.gameplayStop();
    this.showPauseMenu();
  }

  private showPauseMenu(): void {
    this.showScreen(() =>
      pauseMenu({
        resume: () => this.resume(),
        settings: () =>
          this.showScreen(() => settingsScreen(this.ctx.settings, () => this.showPauseMenu())),
        quit: () => this.showMainMenu(),
      }),
    );
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.play();
  }

  private showScreen(factory: (() => HTMLElement) | null): void {
    this.currentScreen = factory;
    this.ctx.ui.show(factory ? factory() : null);
  }

  private applySettings(s: Settings): void {
    const languageChanged = document.documentElement.lang !== s.language;
    setLanguage(s.language);
    if (languageChanged && this.currentScreen) this.ctx.ui.show(this.currentScreen());
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    if (this.session) {
      this.session.chunks.radius = s.renderDistance;
      const far = s.renderDistance * 16;
      this.session.renderer.setFog(far * 0.55, far * 0.95);
      this.camera.far = far + 64;
      this.camera.updateProjectionMatrix();
      const fast = s.graphics === 'low';
      if (this.session.renderer.options.fastLeaves !== fast) {
        this.session.renderer.options = { fastLeaves: fast };
        for (const col of this.session.world.columns.values()) {
          for (let sy = 0; sy < 16; sy++)
            this.session.world.markDirty(col.cx * 16 + 8, sy * 16 + 8, col.cz * 16 + 8);
        }
      }
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private onKey(code: string): void {
    if (code === 'Escape' && this.state === 'paused' && this.currentScreen) {
      this.resume();
      return;
    }
    if (this.state !== 'playing') return;
    const input = this.ctx.input;
    if (input.bindings.debug.includes(code)) this.hud.debugVisible = !this.hud.debugVisible;
    if (input.bindings.toggleFly.includes(code)) this.session?.player.toggleFly();
    if (input.bindings.jump.includes(code) && this.session) {
      // Double-tap jump toggles flying in creative mode.
      if (this.time - this.lastJumpPress < 0.3) {
        this.session.player.toggleFly();
        this.lastJumpPress = -1;
      } else this.lastJumpPress = this.time;
    }
    const digit = /^Digit([1-9])$/.exec(code);
    if (digit) this.hotbar.select(Number(digit[1]) - 1);
  }

  // ---------------------------------------------------------------- frame

  private frame(dt: number): void {
    this.time += dt;
    const s = this.session;
    if (s) {
      if (this.state === 'playing') this.updatePlaying(s, dt);
      else if (this.state === 'menu') this.updateMenuCamera(s);
      else this.placeCamera(s, 1);
      const focus = this.state === 'menu' ? s.spawn : s.player.position;
      s.chunks.update(focus.x, focus.z);
      s.renderer.update(s.world, this.camera.position);
      s.renderer.uniforms.uTime.value = this.time;
      this.updateFogColor(s);
    }
    this.renderer.render(this.scene, this.camera);
    this.hud.tick(dt, this.ctx.settings.value.showFps);
    this.hud.setDebug(s ? this.debugLines(s) : null);
    this.ctx.input.endFrame();
  }

  private updateMenuCamera(s: Session): void {
    const t = this.time * 0.04;
    this.camera.position.set(s.spawn.x, s.spawn.y + 22, s.spawn.z);
    this.camera.rotation.set(-0.28, t, 0);
    this.selection.object.visible = false;
  }

  private updatePlaying(s: Session, dt: number): void {
    const input = this.ctx.input;
    const settings = this.ctx.settings.value;
    const { dx, dy } = input.consumeMouseDelta();
    const sens = 0.0022 * settings.mouseSensitivity;
    const p = s.player;
    p.yaw -= dx * sens;
    p.pitch -= dy * sens * (settings.invertY ? -1 : 1);
    p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch));

    const wheel = input.consumeWheel();
    if (wheel !== 0) this.hotbar.scroll(wheel);

    if (!s.spawned) this.trySpawn(s);
    if (s.spawned) s.physics.advance(dt);
    this.placeCamera(s, s.physics.alpha);
    this.updateTarget(s);
    this.handleInteraction(s, dt);
  }

  private trySpawn(s: Session): void {
    const { x, z } = s.spawn;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (!s.world.hasNeighborhood(bx >> 4, bz >> 4)) return;
    // Stand on the highest solid block (trees may cover the terrain height).
    let y = 255;
    while (y > 0 && !BLOCKS.isSolid(s.world.getBlock(bx, y, bz))) y--;
    s.spawn.y = y + 1;
    s.player.teleport(x, y + 1, z);
    s.spawned = true;
  }

  private physicsStep(dt: number): void {
    const s = this.session;
    if (!s) return;
    const input = this.ctx.input;
    const move: MoveInput = {
      forward: (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0),
      strafe: (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0),
      jump: input.isDown('jump'),
      sneak: input.isDown('sneak'),
      sprint: input.isDown('sprint'),
    };
    s.player.step(dt, move, s.world);
  }

  private placeCamera(s: Session, alpha: number): void {
    const p = s.player;
    p.eye(alpha, this.camera.position);
    const settings = this.ctx.settings.value;
    let roll = 0;
    if (settings.viewBobbing && p.onGround && !p.flying) {
      const walk = p.prevWalkDistance + (p.walkDistance - p.prevWalkDistance) * alpha;
      const speed = Math.min(1, Math.hypot(p.velocity.x, p.velocity.z) / 4.3);
      this.camera.position.y += Math.abs(Math.sin(walk * Math.PI * 0.6)) * 0.06 * speed;
      roll = Math.sin(walk * Math.PI * 0.6) * 0.006 * speed;
    }
    this.camera.rotation.set(p.pitch, p.yaw, roll);
    const fovBoost = p.sprinting ? 1.12 : 1;
    const fov = settings.fov * fovBoost;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * 0.2;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateTarget(s: Session): void {
    const eye = this.camera.position;
    const dir = s.player.lookDirection(this.tmpDir);
    this.target = raycast(s.world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, REACH);
    this.selection.show(this.target);
  }

  private handleInteraction(s: Session, dt: number): void {
    const input = this.ctx.input;
    this.breakCooldown -= dt;
    this.placeCooldown -= dt;
    const hit = this.target;
    if (!input.isMouseDown(MouseButton.Left)) this.breakCooldown = 0;
    if (!input.isMouseDown(MouseButton.Right)) this.placeCooldown = 0;

    if (hit && input.isMouseDown(MouseButton.Left) && this.breakCooldown <= 0) {
      if (BLOCKS.hardness[hit.state]! >= 0) {
        s.world.setBlock(hit.x, hit.y, hit.z, 0);
        this.breakBlockExtras(s, hit.x, hit.y, hit.z, hit.state);
      }
      this.breakCooldown = 0.2;
    }

    if (input.wasMousePressed(MouseButton.Middle) && hit) {
      this.hotbar.pick(BLOCKS.blockOf(hit.state).defaultState);
    }

    if (hit && input.isMouseDown(MouseButton.Right) && this.placeCooldown <= 0) {
      this.placeCooldown = 0.22;
      const item = this.hotbar.selectedState;
      if (item === null) return;
      const n = FACE_NORMALS[hit.face]!;
      let tx = hit.x;
      let ty = hit.y;
      let tz = hit.z;
      // Clicking a replaceable block (grass) places into it instead of next to it.
      if (!BLOCKS.isReplaceable(hit.state)) {
        tx += n[0];
        ty += n[1];
        tz += n[2];
      }
      if (ty < 0 || ty >= 256) return;
      const existing = s.world.getBlock(tx, ty, tz);
      if (!BLOCKS.isReplaceable(existing)) return;
      const state = placementState(
        item,
        hit.face,
        s.player.yaw,
        (x, y, z) => s.world.getBlock(x, y, z),
        tx,
        ty,
        tz,
      );
      if (state === null) return;
      if (BLOCKS.isSolid(state) && this.intersectsPlayer(s, tx, ty, tz, state)) return;
      s.world.setBlock(tx, ty, tz, state);
    }
  }

  /** Two-block plants and attached blocks break with their support. */
  private breakBlockExtras(s: Session, x: number, y: number, z: number, _old: number): void {
    const above = s.world.getBlock(x, y + 1, z);
    const name = BLOCKS.blockOf(above).name;
    if (
      BLOCKS.model[above] === 2 /* cross */ ||
      name === 'torch' ||
      name === 'glutstein_torch' ||
      name === 'sugar_cane' ||
      name === 'cactus'
    ) {
      if (name.endsWith('torch') && BLOCKS.propsOf(above).facing !== 'floor') return;
      s.world.setBlock(x, y + 1, z, 0);
      this.breakBlockExtras(s, x, y + 1, z, above);
    }
    // Wall torches attached to the broken block.
    for (const face of [Face.East, Face.West, Face.South, Face.North]) {
      const n = FACE_NORMALS[face]!;
      const side = s.world.getBlock(x + n[0], y, z + n[2]);
      const b = BLOCKS.blockOf(side);
      if (!b.name.endsWith('torch')) continue;
      const facing = b.propsOf(side).facing;
      const expected = ['east', 'west', 'up', 'down', 'south', 'north'][face];
      if (facing === expected) s.world.setBlock(x + n[0], y, z + n[2], 0);
    }
  }

  private intersectsPlayer(s: Session, x: number, y: number, z: number, state: number): boolean {
    const box = s.player.box();
    const shapes = BLOCKS.collision[state];
    const parts = shapes ? shapes.length / 6 : 1;
    for (let i = 0; i < parts; i++) {
      const b = shapes ? shapes.subarray(i * 6, i * 6 + 6) : [0, 0, 0, 1, 1, 1];
      if (
        box.minX < x + b[3]! &&
        box.maxX > x + b[0]! &&
        box.minY < y + b[4]! &&
        box.maxY > y + b[1]! &&
        box.minZ < z + b[5]! &&
        box.maxZ > z + b[2]!
      ) {
        return true;
      }
    }
    return false;
  }

  private updateFogColor(s: Session): void {
    const underwater = this.state === 'playing' && s.player.headInWater;
    const fog = underwater ? new THREE.Color(0x1d3f7a) : SKY_COLOR;
    s.renderer.uniforms.uFogColor.value.copy(fog);
    (this.scene.background as THREE.Color).copy(fog);
    if (underwater) s.renderer.setFog(2, 24);
    else {
      const far = this.ctx.settings.value.renderDistance * 16;
      s.renderer.setFog(far * 0.55, far * 0.95);
    }
  }

  private debugLines(s: Session): string[] {
    const p = s.player.position;
    const biome = s.generator.biomeAt(Math.floor(p.x), Math.floor(p.z));
    const t = this.target;
    return [
      `${this.hud.currentFps} FPS`,
      `XYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `Chunk ${Math.floor(p.x) >> 4}, ${Math.floor(p.z) >> 4}  Biome ${biome.name}`,
      `Columns ${s.world.columns.size}  Sections ${s.renderer.sectionCount}  Queue ${s.world.dirty.size}/${s.renderer.pendingCount}/${s.chunks.pendingCount}`,
      `Draw calls ${this.renderer.info.render.calls}  Triangles ${this.renderer.info.render.triangles}`,
      `Seed ${s.world.seed}`,
      t ? `Target ${BLOCKS.stateName(t.state)} @ ${t.x} ${t.y} ${t.z}` : 'Target -',
      `Flying ${s.player.flying}  Water ${s.player.inWater}`,
    ];
  }

  /** Loading progress of the area around the spawn (for the loading screen). */
  spawnProgress(): number {
    const s = this.session;
    if (!s) return 0;
    const cx = Math.floor(s.spawn.x) >> 4;
    const cz = Math.floor(s.spawn.z) >> 4;
    const loaded = s.chunks.progress(cx, cz, Math.min(4, s.chunks.radius));
    const meshed = Math.min(1, s.renderer.meshedCount / 150);
    return loaded * 0.6 + meshed * 0.4;
  }
}
