import './render/setup';
import * as THREE from 'three';
import { GameLoop, FixedStepper } from './core/loop';
import type { Input } from './core/input';
import { isMobileDevice, type Settings, type SettingsStore } from './core/settings';
import { TouchControls } from './ui/touch';
import { randomSeed, seedFromString } from './core/random';
import { PHYSICS_HZ, TICKS_PER_SECOND } from './config';
import type { Platform } from './platform/crazygames';
import { Player, type GameMode, type MoveInput } from './entity/player';
import { BLOCKS } from './world/blocks/blocks';
import { ChunkManager } from './world/chunk-manager';
import { TerrainGenerator } from './world/gen/terrain';
import { World } from './world/world';
import {
  newWorldId,
  openWorldStore,
  SAVE_VERSION,
  type WorldMeta,
  type WorldStore,
} from './world/storage/save';
import { WorldSaver } from './world/storage/world-saver';
import { TerrainMaterials, WorldRenderer } from './render/world-renderer';
import { SkyRenderer } from './render/sky';
import { HeldItem } from './render/hand';
import { AmbientEffects } from './gameplay/ambient';
import { loadBlockTextures, uploadMipmaps, type BlockTextures } from './render/textures';
import { SelectionBox } from './render/selection';
import { CrackOverlay, ParticleSystem } from './render/effects';
import { defaultWorkerCount, WorkerPool } from './workers/pool';
import type { GenRequest, GenResponse } from './workers/gen.worker';
import type { MeshRequest, MeshResponse } from './workers/mesh.worker';
import { Interaction } from './gameplay/interaction';
import { PowerSystem } from './gameplay/power';
import { Hud } from './ui/hud';
import { Hotbar } from './ui/hotbar';
import { creativeInventory } from './ui/creative';
import { IconRenderer, setIconRenderer } from './ui/icons';
import { setLanguage, t } from './ui/i18n';
import { mainMenu, pauseMenu, settingsScreen, type UIManager } from './ui/screens';
import { createWorldScreen, worldList, type NewWorld } from './ui/worlds';

export interface GameContext {
  canvas: HTMLCanvasElement;
  ui: UIManager;
  platform: Platform;
  settings: SettingsStore;
  input: Input;
}

type GameState = 'menu' | 'playing' | 'paused' | 'inventory';

const WATER_FOG = new THREE.Color(0x1d3f7a);
const AUTOSAVE_SECONDS = 30;
/** Until survival inventory and crafting exist, new worlds default to creative. */
const DEFAULT_MODE: GameMode = 'creative';

/** Everything that belongs to one open world. */
interface Session {
  meta: WorldMeta;
  saver: WorldSaver;
  world: World;
  generator: TerrainGenerator;
  chunks: ChunkManager;
  renderer: WorldRenderer;
  player: Player;
  physics: FixedStepper;
  interaction: Interaction;
  spawn: { x: number; y: number; z: number };
  /** The player is frozen until the ground under them has loaded. */
  spawned: boolean;
  /** The world has been written at least once (it shows in the world list). */
  persisted: boolean;
  autosave: number;
  /** Time of day in ticks (24000 per day). */
  time: number;
  power: PowerSystem;
  /** Delayed actions (button releases, pressure plates) in game seconds. */
  timers: { at: number; fn: () => void }[];
  clock: number;
  /** Pressure plates currently weighed down by the player. */
  plates: Map<string, number>;
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
  private readonly centerLabel: HTMLElement;
  private cracks: CrackOverlay | null = null;
  private particles: ParticleSystem | null = null;
  private materials: TerrainMaterials | null = null;
  private hand: HeldItem | null = null;
  private ambient: AmbientEffects | null = null;
  private readonly sky = new SkyRenderer();
  private readonly fogColor = new THREE.Color();
  private state: GameState = 'menu';
  /** Rebuilds the current screen, e.g. after a language change. */
  private currentScreen: (() => HTMLElement) | null = null;
  private textures: BlockTextures | null = null;
  private genPool: WorkerPool<GenRequest, GenResponse> | null = null;
  private meshPool: WorkerPool<MeshRequest, MeshResponse> | null = null;
  private store: WorldStore | null = null;
  private session: Session | null = null;
  private time = 0;
  private lastJumpPress = -1;

  constructor(private readonly ctx: GameContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.scene.add(this.sky.group);
    this.camera = new THREE.PerspectiveCamera(ctx.settings.value.fov, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.selection.object);
    this.hud = new Hud(ctx.ui.hud);
    this.hotbar = new Hotbar(ctx.ui.hud);
    if (isMobileDevice()) {
      new TouchControls(this.hud.el, ctx.input, {
        pause: () => this.pause(),
        inventory: () => this.openInventory(),
      });
    }
    this.centerLabel = document.createElement('div');
    this.centerLabel.className = 'center-label';
    this.hud.el.append(this.centerLabel);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.loop = new GameLoop({ frame: (dt) => this.frame(dt) });

    ctx.input.onPointerLockChange((locked) => {
      if (!locked && this.state === 'playing') this.pause();
    });
    ctx.input.onKey((code) => this.onKey(code));
    ctx.settings.onChange((s) => this.applySettings(s));
    ctx.canvas.addEventListener('mousedown', () => {
      if (this.state === 'playing' && !ctx.input.isPointerLocked) ctx.input.requestPointerLock();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        void this.saveSession();
      }
    });
    window.addEventListener('pagehide', () => void this.saveSession());
  }

  /** Loads textures, opens the save store and starts the worker pools. */
  async init(onProgress: (fraction: number) => void): Promise<void> {
    this.textures = await loadBlockTextures();
    uploadMipmaps(this.renderer, this.textures);
    onProgress(0.4);
    const layers = this.textures.layers;
    BLOCKS.resolveTextures((name) => layers[name]);
    this.cracks = new CrackOverlay(this.textures);
    this.particles = new ParticleSystem(this.textures);
    this.particles.setViewportHeight(window.innerHeight);
    this.scene.add(this.cracks.object, this.particles.object);
    this.materials = new TerrainMaterials(this.textures);
    setIconRenderer(new IconRenderer(this.renderer, this.textures));
    this.hand = new HeldItem(this.materials);
    this.hand.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    this.ambient = new AmbientEffects(this.particles, {
      flame: layers['particle_flame'] ?? 0,
      glutFlame: layers['particle_glut_flame'] ?? 0,
      smoke: layers['particle_smoke'] ?? 0,
    });
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
    onProgress(0.7);
    this.store = await openWorldStore();
    onProgress(1);
  }

  start(): void {
    this.applySettings(this.ctx.settings.value);
    this.loop.start();
  }

  /** Opens the most recently played world, or prepares a new one. */
  async openLatestWorld(): Promise<void> {
    const worlds = (await this.store?.listWorlds()) ?? [];
    const latest = worlds[0];
    if (latest) this.openWorld(latest, true);
    else
      this.openWorld(
        this.newMeta({ name: t('world.default'), seed: '', mode: DEFAULT_MODE }),
        false,
      );
  }

  private newMeta(w: NewWorld): WorldMeta {
    const now = Date.now();
    return {
      id: newWorldId(),
      name: w.name,
      seed: w.seed ? seedFromString(w.seed) : randomSeed(),
      mode: w.mode,
      created: now,
      lastPlayed: now,
      version: SAVE_VERSION,
      palettes: {},
      player: null,
      time: 1000,
    };
  }

  /** Makes `meta` the active world (shown behind the menu and played in). */
  openWorld(meta: WorldMeta, persisted: boolean): void {
    this.closeWorld();
    if (!this.textures || !this.genPool || !this.meshPool || !this.store)
      throw new Error('game not initialized');
    const world = new World(meta.seed);
    const generator = new TerrainGenerator(meta.seed);
    const saver = new WorldSaver(this.store, meta);
    const chunks = new ChunkManager(world, this.genPool, saver);
    chunks.radius = this.ctx.settings.value.renderDistance;
    const renderer = new WorldRenderer(this.materials!, this.meshPool);
    renderer.options.fastLeaves = this.ctx.settings.value.graphics === 'low';
    this.scene.add(renderer.group);
    const player = new Player();
    player.mode = meta.mode;
    const spawn = generator.findSpawn();
    if (meta.player) {
      player.teleport(meta.player.x, meta.player.y, meta.player.z);
      player.yaw = meta.player.yaw;
      player.pitch = meta.player.pitch;
      player.flying = meta.player.flying;
    } else {
      player.teleport(spawn.x, spawn.y, spawn.z);
      player.yaw = Math.PI * 0.25;
    }
    this.hotbar.restore(meta.hotbar);
    const power = new PowerSystem(world);
    const timers: Session['timers'] = [];
    const interaction = new Interaction(
      world,
      player,
      this.hotbar,
      this.selection,
      this.cracks!,
      this.particles!,
      power,
      {
        schedule: (seconds, fn) => {
          const s = this.session;
          if (s) s.timers.push({ at: s.clock + seconds, fn });
        },
        sleep: (x, y, z) => this.sleep(x, y, z),
      },
      {
        onBreak: () => this.hand?.swingOnce(),
        onPlace: () => this.hand?.swingOnce(),
        onUse: () => this.hand?.swingOnce(),
      },
    );
    this.session = {
      meta,
      saver,
      world,
      generator,
      chunks,
      renderer,
      player,
      interaction,
      spawn,
      spawned: false,
      persisted,
      autosave: AUTOSAVE_SECONDS,
      time: meta.time,
      power,
      timers,
      clock: 0,
      plates: new Map(),
      physics: new FixedStepper(PHYSICS_HZ, (dt) => this.physicsStep(dt)),
    };
    this.applySettings(this.ctx.settings.value);
  }

  private closeWorld(): void {
    const s = this.session;
    if (!s) return;
    void this.saveSession();
    s.chunks.reset();
    s.interaction.cancel();
    this.scene.remove(s.renderer.group);
    s.renderer.dispose();
    this.session = null;
  }

  /** Writes the player, hotbar and all changed chunks. */
  saveSession(): Promise<void> {
    const s = this.session;
    if (!s || !s.persisted) return Promise.resolve();
    const p = s.player;
    if (s.spawned) {
      s.meta.player = {
        x: p.position.x,
        y: p.position.y,
        z: p.position.z,
        yaw: p.yaw,
        pitch: p.pitch,
        flying: p.flying,
      };
    }
    s.meta.hotbar = this.hotbar.serialize();
    s.meta.time = Math.floor(s.time);
    s.meta.lastPlayed = Date.now();
    s.autosave = AUTOSAVE_SECONDS;
    return s.saver.flush(s.world.columns.values());
  }

  // --------------------------------------------------------------- screens

  showMainMenu(): void {
    this.state = 'menu';
    this.ctx.platform.gameplayStop();
    this.ctx.input.enabled = false;
    this.ctx.input.exitPointerLock();
    this.setHudVisible(false);
    this.session?.interaction.cancel();
    this.showScreen(() =>
      mainMenu(
        {
          play: () => this.play(),
          worlds: () => void this.showWorlds(),
          settings: () =>
            this.showScreen(() => settingsScreen(this.ctx.settings, () => this.showMainMenu())),
        },
        this.session?.persisted ?? false,
      ),
    );
  }

  private async showWorlds(): Promise<void> {
    const store = this.store;
    if (!store) return;
    const worlds = await store.listWorlds();
    this.showScreen(() =>
      worldList(
        worlds,
        {
          play: (meta) => {
            if (this.session?.meta.id !== meta.id) this.openWorld(meta, true);
            this.play();
          },
          remove: (meta) => {
            void store.deleteWorld(meta.id).then(async () => {
              if (this.session?.meta.id === meta.id) {
                this.session.persisted = false;
                await this.openLatestWorld();
              }
              await this.showWorlds();
            });
          },
          create: () =>
            this.showScreen(() =>
              createWorldScreen(
                (w) => {
                  this.openWorld(this.newMeta(w), false);
                  this.play();
                },
                () => void this.showWorlds(),
              ),
            ),
          back: () => this.showMainMenu(),
        },
        store.persistent,
      ),
    );
  }

  private play(): void {
    const s = this.session;
    if (s && !s.persisted) {
      s.persisted = true;
      void this.saveSession();
    }
    this.state = 'playing';
    this.showScreen(null);
    this.ctx.input.enabled = true;
    this.ctx.input.requestPointerLock();
    this.setHudVisible(true);
    this.ctx.platform.gameplayStart();
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'inventory') return;
    this.state = 'paused';
    this.ctx.input.enabled = false;
    this.ctx.platform.gameplayStop();
    this.session?.interaction.cancel();
    void this.saveSession();
    this.showPauseMenu();
  }

  private showPauseMenu(): void {
    this.showScreen(() =>
      pauseMenu({
        resume: () => this.resume(),
        settings: () =>
          this.showScreen(() => settingsScreen(this.ctx.settings, () => this.showPauseMenu())),
        quit: () => {
          void this.saveSession();
          // A natural break: the only place a midgame ad may appear.
          void this.ctx.platform.requestAd('midgame');
          this.showMainMenu();
        },
      }),
    );
  }

  resume(): void {
    if (this.state !== 'paused' && this.state !== 'inventory') return;
    this.play();
  }

  private openInventory(): void {
    if (this.state !== 'playing' || !this.textures) return;
    this.state = 'inventory';
    this.ctx.input.enabled = false;
    this.session?.interaction.cancel();
    this.ctx.input.exitPointerLock();
    const textures = this.textures;
    this.showScreen(() => creativeInventory(textures, this.hotbar, () => this.resume()));
  }

  private setHudVisible(visible: boolean): void {
    this.hud.setVisible(visible);
    this.hotbar.setVisible(visible);
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
    const session = this.session;
    if (!session) return;
    session.chunks.radius = s.renderDistance;
    this.camera.far = Math.max(s.renderDistance * 16 + 64, 420);
    this.camera.updateProjectionMatrix();
    const fast = s.graphics === 'low';
    if (session.renderer.options.fastLeaves !== fast) {
      session.renderer.options = { fastLeaves: fast };
      for (const col of session.world.columns.values()) {
        for (let sy = 0; sy < 16; sy++)
          session.world.markDirty(col.cx * 16 + 8, sy * 16 + 8, col.cz * 16 + 8);
      }
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.particles?.setViewportHeight(h);
    this.hand?.setAspect(w / Math.max(1, h));
  }

  private onKey(code: string): void {
    const input = this.ctx.input;
    if (
      this.state === 'inventory' &&
      (input.bindings.inventory.includes(code) || code === 'Escape')
    ) {
      this.resume();
      return;
    }
    if (code === 'Escape' && this.state === 'paused' && this.currentScreen) {
      this.resume();
      return;
    }
    if (this.state !== 'playing') return;
    if (input.bindings.inventory.includes(code)) {
      this.openInventory();
      return;
    }
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

  // ------------------------------------------------------------- actions

  /** Beds set the spawn point and, at night, skip to the morning. */
  private sleep(x: number, y: number, z: number): void {
    const s = this.session;
    if (!s) return;
    s.meta.extra = { ...(s.meta.extra ?? {}), spawnPoint: { x: x + 0.5, y: y + 1, z: z + 0.5 } };
    const day = ((s.time % 24000) + 24000) % 24000;
    if (day < 12500 || day > 23500) {
      this.hud.toast(t('bed.onlyNight'));
      return;
    }
    this.hud.fadeOut();
    setTimeout(() => {
      if (this.session !== s) return;
      s.time += 24000 - day + 300;
      this.hud.toast(t('bed.goodMorning'));
      void this.saveSession();
    }, 1200);
  }

  /** Runs due timers and presses/releases pressure plates under the player. */
  private updateMechanics(s: Session, dt: number): void {
    s.clock += dt;
    if (s.timers.length) {
      const due = s.timers.filter((t) => t.at <= s.clock);
      s.timers = s.timers.filter((t) => t.at > s.clock);
      for (const t of due) t.fn();
    }
    if (!s.spawned) return;
    const box = s.player.box();
    const y = Math.floor(box.minY + 0.01);
    for (let x = Math.floor(box.minX); x <= Math.floor(box.maxX - 1e-6); x++) {
      for (let z = Math.floor(box.minZ); z <= Math.floor(box.maxZ - 1e-6); z++) {
        const state = s.world.getBlock(x, y, z);
        const block = BLOCKS.blockOf(state);
        if (!block.name.endsWith('_pressure_plate')) continue;
        s.plates.set(`${x},${y},${z}`, s.clock);
        if (!block.propsOf(state).powered) {
          const on = block.state({ powered: true });
          s.world.setBlock(x, y, z, on);
          s.power.sourceChanged(x, y, z, on);
        }
      }
    }
    for (const [key, last] of s.plates) {
      if (s.clock - last < 0.6) continue;
      s.plates.delete(key);
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      const state = s.world.getBlock(x, y, z);
      const block = BLOCKS.blockOf(state);
      if (!block.name.endsWith('_pressure_plate') || !block.propsOf(state).powered) continue;
      const off = block.state({ powered: false });
      s.world.setBlock(x, y, z, off);
      s.power.sourceChanged(x, y, z, off);
    }
  }

  // ---------------------------------------------------------------- frame

  private frame(dt: number): void {
    this.time += dt;
    const s = this.session;
    const renderer = this.renderer;
    renderer.clear();
    if (s) {
      if (this.state === 'playing') this.updatePlaying(s, dt);
      else if (this.state === 'menu') this.updateMenuCamera(s);
      else this.placeCamera(s, 1);
      // The day goes on unless the game is paused.
      if (this.state !== 'paused') {
        s.time += dt * TICKS_PER_SECOND;
        this.updateMechanics(s, dt);
      }
      const focus = s.player.position;
      s.chunks.update(focus.x, focus.z);
      s.renderer.update(s.world, this.camera.position);
      this.updateAtmosphere(s);
      this.particles?.update(dt, (x, y, z) => BLOCKS.isSolid(s.world.getBlock(x, y, z)));
      if (this.state !== 'menu') this.ambient?.update(dt, s.world, focus.x, focus.y, focus.z);
      if (this.state !== 'menu' && s.persisted) {
        s.autosave -= dt;
        if (s.autosave <= 0) void this.saveSession();
      }
      this.centerLabel.textContent =
        this.state === 'playing' && !s.spawned ? t('hud.loadingWorld') : '';
    }
    renderer.render(this.scene, this.camera);
    if (s && this.hand && this.state !== 'menu') {
      const p = s.player;
      const eye = this.camera.position;
      const light = s.world.getLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
      const speed = p.onGround ? Math.min(1, Math.hypot(p.velocity.x, p.velocity.z) / 4.3) : 0;
      this.hand.update(dt, this.hotbar.selectedState, light, p.walkDistance, speed);
      renderer.clearDepth();
      renderer.render(this.hand.scene, this.hand.camera);
    }
    this.hud.tick(dt, this.ctx.settings.value.showFps);
    this.hud.setDebug(s ? this.debugLines(s) : null);
    this.ctx.input.endFrame();
  }

  private updateMenuCamera(s: Session): void {
    const t = this.time * 0.04;
    const p = s.player.position;
    this.camera.position.set(p.x, p.y + 22, p.z);
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
    if (s.spawned) s.interaction.update(dt, this.camera.position, input);
  }

  private trySpawn(s: Session): void {
    const p = s.player.position;
    const bx = Math.floor(p.x);
    const bz = Math.floor(p.z);
    if (!s.world.hasNeighborhood(bx >> 4, bz >> 4)) return;
    if (!s.meta.player) {
      // First visit: stand on the highest solid block (trees may cover the terrain height).
      let y = 255;
      while (y > 0 && !BLOCKS.isSolid(s.world.getBlock(bx, y, bz))) y--;
      s.spawn.y = y + 1;
      s.player.teleport(p.x, y + 1, p.z);
    }
    s.spawned = true;
  }

  private physicsStep(dt: number): void {
    const s = this.session;
    if (!s) return;
    const input = this.ctx.input;
    const move: MoveInput = {
      forward: input.analog
        ? input.analog.forward
        : (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0),
      strafe: input.analog
        ? input.analog.strafe
        : (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0),
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
    const fov = settings.fov * (p.sprinting ? 1.12 : 1);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * 0.2;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Sky, fog, daylight and torch flicker for the current moment. */
  private updateAtmosphere(s: Session): void {
    const settings = this.ctx.settings.value;
    const underwater = this.state !== 'menu' && s.player.headInWater;
    const far = settings.renderDistance * 16;
    const sky = this.sky.update(s.time, this.camera, far, underwater, settings.graphics !== 'low');
    const u = this.materials!.uniforms;
    u.uTime.value = this.time;
    u.uDaylight.value = sky.daylight;
    u.uSkyLight.value.copy(sky.skyLight);
    // Gentle torch flicker.
    const flicker = 1 + Math.sin(this.time * 11.3) * 0.025 + Math.sin(this.time * 7.1 + 1.3) * 0.02;
    u.uBlockLight.value.setRGB(1.05 * flicker, 0.88 * flicker, 0.66 * flicker);
    if (underwater) {
      this.fogColor.copy(WATER_FOG).multiplyScalar(0.35 + 0.65 * sky.daylight);
      this.materials!.setFog(2, 24);
    } else {
      this.fogColor.copy(sky.horizon);
      this.materials!.setFog(far * 0.55, far * 0.95);
    }
    u.uFogColor.value.copy(this.fogColor);
  }

  private debugLines(s: Session): string[] {
    const p = s.player.position;
    const biome = s.generator.biomeAt(Math.floor(p.x), Math.floor(p.z));
    const t = s.interaction.target;
    return [
      `${this.hud.currentFps} FPS`,
      `XYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `Chunk ${Math.floor(p.x) >> 4}, ${Math.floor(p.z) >> 4}  Biome ${biome.name}`,
      `Columns ${s.world.columns.size}  Sections ${s.renderer.sectionCount}  Queue ${s.world.dirty.size}/${s.renderer.pendingCount}/${s.chunks.pendingCount}`,
      `Draw calls ${this.renderer.info.render.calls}  Triangles ${this.renderer.info.render.triangles}`,
      `World "${s.meta.name}"  Seed ${s.world.seed}  Mode ${s.player.mode}`,
      t ? `Target ${BLOCKS.stateName(t.state)} @ ${t.x} ${t.y} ${t.z}` : 'Target -',
      `Flying ${s.player.flying}  Water ${s.player.inWater}  Time ${Math.floor(s.time % 24000)}  Day ${Math.floor(s.time / 24000) + 1}`,
    ];
  }

  /** Loading progress of the area around the player (for the loading screen). */
  spawnProgress(): number {
    const s = this.session;
    if (!s) return 0;
    const cx = Math.floor(s.player.position.x) >> 4;
    const cz = Math.floor(s.player.position.z) >> 4;
    const loaded = s.chunks.progress(cx, cz, Math.min(4, s.chunks.radius));
    const meshed = Math.min(1, s.renderer.meshedCount / 150);
    return loaded * 0.6 + meshed * 0.4;
  }
}
