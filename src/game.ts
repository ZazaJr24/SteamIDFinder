import * as THREE from 'three';
import { GameLoop } from './core/loop';
import type { Input } from './core/input';
import type { Settings, SettingsStore } from './core/settings';
import type { Platform } from './platform/crazygames';
import { setLanguage } from './ui/i18n';
import { mainMenu, pauseMenu, settingsScreen, type UIManager } from './ui/screens';

export interface GameContext {
  canvas: HTMLCanvasElement;
  ui: UIManager;
  platform: Platform;
  settings: SettingsStore;
  input: Input;
}

type GameState = 'menu' | 'playing' | 'paused';

/** Top-level game object: owns the renderer, the loop and the screen flow. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly loop: GameLoop;
  private state: GameState = 'menu';
  /** Rebuilds the current screen, e.g. after a language change. */
  private currentScreen: (() => HTMLElement) | null = null;
  private time = 0;

  constructor(private readonly ctx: GameContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x87b8ff);
    this.camera = new THREE.PerspectiveCamera(ctx.settings.value.fov, 1, 0.05, 1000);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.loop = new GameLoop({ frame: (dt) => this.frame(dt) });

    ctx.input.onPointerLockChange((locked) => {
      if (!locked && this.state === 'playing') this.pause();
    });
    ctx.input.onKey((code) => {
      if (code === 'Escape' && this.state === 'paused' && this.currentScreen) this.resume();
    });
    ctx.settings.onChange((s) => this.applySettings(s));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  start(): void {
    this.applySettings(this.ctx.settings.value);
    this.loop.start();
  }

  showMainMenu(): void {
    this.state = 'menu';
    this.ctx.platform.gameplayStop();
    this.ctx.input.enabled = false;
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
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private frame(dt: number): void {
    this.time += dt;
    // Placeholder scene until the world renderer lands (M1): a slow sky pan.
    this.camera.rotation.set(0, this.time * 0.05, 0);
    this.renderer.render(this.scene, this.camera);
    this.ctx.input.endFrame();
  }
}
