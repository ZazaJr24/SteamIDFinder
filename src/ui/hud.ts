import { h } from './dom';

/** In-game overlay: crosshair, FPS counter and the F3 debug panel. */
export class Hud {
  readonly el: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly debug: HTMLElement;
  private frames = 0;
  private elapsed = 0;
  private lastFps = 0;
  debugVisible = false;

  constructor(parent: HTMLElement) {
    this.crosshair = h('div', { class: 'crosshair' });
    this.fps = h('div', { class: 'fps' });
    this.debug = h('pre', { class: 'debug' });
    this.el = h('div', { class: 'hud-layer' }, this.crosshair, this.fps, this.debug);
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

  setDebug(lines: string[] | null): void {
    this.debug.style.display = lines && this.debugVisible ? 'block' : 'none';
    if (lines && this.debugVisible) this.debug.textContent = lines.join('\n');
  }
}
