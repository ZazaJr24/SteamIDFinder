import { h } from './dom';

/** In-game overlay: crosshair, FPS counter and the F3 debug panel. */
export class Hud {
  readonly el: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly fade: HTMLElement;
  private toastTimer = 0;
  private frames = 0;
  private elapsed = 0;
  private lastFps = 0;
  debugVisible = false;

  constructor(parent: HTMLElement) {
    this.crosshair = h('div', { class: 'crosshair' });
    this.fps = h('div', { class: 'fps' });
    this.debug = h('pre', { class: 'debug' });
    this.toastEl = h('div', { class: 'toast' });
    this.fade = h('div', { class: 'sleep-fade' });
    this.el = h(
      'div',
      { class: 'hud-layer' },
      this.fade,
      this.crosshair,
      this.fps,
      this.debug,
      this.toastEl,
    );
    parent.append(this.el);
    this.setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? 'block' : 'none';
  }

  get currentFps(): number {
    return this.lastFps;
  }

  /** Call once per frame. */
  tick(dt: number, showFps: boolean): void {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.lastFps = Math.round(this.frames / this.elapsed);
      this.frames = 0;
      this.elapsed = 0;
      this.fps.textContent = `${this.lastFps} FPS`;
    }
    this.fps.style.display = showFps && !this.debugVisible ? 'block' : 'none';
  }

  /** Short message above the hotbar. */
  toast(text: string, seconds = 3): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(
      () => this.toastEl.classList.remove('visible'),
      seconds * 1000,
    );
  }

  /** Fades the screen to black and back (sleeping). */
  fadeOut(): void {
    this.fade.classList.remove('active');
    void this.fade.offsetWidth;
    this.fade.classList.add('active');
  }

  setDebug(lines: string[] | null): void {
    this.debug.style.display = lines && this.debugVisible ? 'block' : 'none';
    if (lines && this.debugVisible) this.debug.textContent = lines.join('\n');
  }
}
