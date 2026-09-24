/** Keyboard + mouse input with edge detection and pointer lock handling. */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sneak'
  | 'sprint'
  | 'inventory'
  | 'drop'
  | 'pause'
  | 'debug'
  | 'toggleFly';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sneak: ['ShiftLeft', 'ShiftRight'],
  sprint: ['ControlLeft', 'KeyR'],
  inventory: ['KeyE'],
  drop: ['KeyQ'],
  pause: ['Escape'],
  debug: ['F3'],
  toggleFly: ['KeyF'],
};

/** Keys whose browser default (scrolling, focus change) must never fire in-game. */
const BLOCKED_DEFAULT_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'F3',
  'ControlLeft',
]);

export const enum MouseButton {
  Left = 0,
  Middle = 1,
  Right = 2,
}

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly mouseDown = new Set<number>();
  private readonly mousePressed = new Set<number>();
  private readonly mouseReleased = new Set<number>();
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  private locked = false;
  private readonly lockListeners = new Set<(locked: boolean) => void>();
  private readonly keyListeners = new Set<(code: string, e: KeyboardEvent) => void>();
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  private readonly virtualKeys = new Set<string>();
  private readonly virtualButtons = new Set<number>();
  private readonly virtualPressed = new Set<number>();
  /** Analog movement from a touch joystick (overrides WASD while set). */
  analog: { forward: number; strafe: number } | null = null;
  /** When false, game input is ignored (menus open). Keys are still tracked for UI. */
  enabled = true;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    element.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.element.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.element.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  /** Is the action held right now? */
  isDown(action: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[action].some((code) => this.down.has(code) || this.virtualKeys.has(code));
  }

  /** Was the action pressed since the last `endFrame()`? */
  wasPressed(action: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[action].some((code) => this.pressed.has(code));
  }

  isKeyDown(code: string): boolean {
    return this.down.has(code);
  }

  wasKeyPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  isMouseDown(button: MouseButton): boolean {
    return this.enabled && (this.mouseDown.has(button) || this.virtualButtons.has(button));
  }

  wasMousePressed(button: MouseButton): boolean {
    return this.enabled && (this.mousePressed.has(button) || this.virtualPressed.has(button));
  }

  wasMouseReleased(button: MouseButton): boolean {
    return this.mouseReleased.has(button);
  }

  /** Mouse movement since the last frame, in pixels. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  /** Wheel steps since the last frame (positive = down). */
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Clears the per-frame edge state. Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mousePressed.clear();
    this.virtualPressed.clear();
    this.mouseReleased.clear();
  }

  /** Presses or releases a key from on-screen controls. */
  setVirtualKey(code: string, down: boolean): void {
    if (down && !this.virtualKeys.has(code)) {
      this.virtualKeys.add(code);
      this.pressed.add(code);
      for (const fn of this.keyListeners) fn(code, new KeyboardEvent('keydown', { code }));
    } else if (!down) this.virtualKeys.delete(code);
  }

  setVirtualButton(button: MouseButton, down: boolean): void {
    if (down && !this.virtualButtons.has(button)) this.virtualPressed.add(button);
    if (down) this.virtualButtons.add(button);
    else this.virtualButtons.delete(button);
  }

  /** Adds look movement (touch drag) in pixels. */
  addLook(dx: number, dy: number): void {
    this.dx += dx;
    this.dy += dy;
  }

  /** Applies custom primary keys; secondary defaults (arrow keys) stay. */
  applyBindings(keys: Partial<Record<Action, string>>): void {
    for (const action of Object.keys(DEFAULT_BINDINGS) as Action[]) {
      const defaults = DEFAULT_BINDINGS[action];
      const primary = keys[action] ?? defaults[0]!;
      this.bindings[action] = [primary, ...defaults.slice(1).filter((c) => c !== primary)];
    }
  }

  get isPointerLocked(): boolean {
    return this.locked;
  }

  requestPointerLock(): void {
    if (this.locked) return;
    try {
      const result = this.element.requestPointerLock() as unknown;
      // Newer browsers return a promise that rejects on failure (e.g. too soon after ESC).
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      /* pointer lock unavailable (some mobile browsers) */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onPointerLockChange(fn: (locked: boolean) => void): () => void {
    this.lockListeners.add(fn);
    return () => this.lockListeners.delete(fn);
  }

  /** Raw key listener, used by the UI for shortcuts (E, Esc, digits). */
  onKey(fn: (code: string, e: KeyboardEvent) => void): () => void {
    this.keyListeners.add(fn);
    return () => this.keyListeners.delete(fn);
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    if (typing) return;
    if (BLOCKED_DEFAULT_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      this.pressed.add(e.code);
      for (const fn of this.keyListeners) fn(e.code, e);
    }
    this.down.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private readonly onBlur = () => {
    this.down.clear();
    this.mouseDown.clear();
  };

  private readonly onMouseDown = (e: MouseEvent) => {
    this.mouseDown.add(e.button);
    this.mousePressed.add(e.button);
  };

  private readonly onMouseUp = (e: MouseEvent) => {
    this.mouseDown.delete(e.button);
    this.mouseReleased.add(e.button);
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    // Some browsers report a huge jump right after locking; ignore outliers.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  private readonly onLockChange = () => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) this.mouseDown.clear();
    for (const fn of this.lockListeners) fn(this.locked);
  };
}
