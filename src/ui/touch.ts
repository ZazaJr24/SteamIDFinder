/**
 * On-screen controls for phones and tablets: a joystick on the left, drag to
 * look on the right, tap to place/use, hold to break, and buttons for jump,
 * sneak, inventory and pause.
 */
import { MouseButton, type Input } from '../core/input';
import { h } from './dom';

export interface TouchActions {
  pause(): void;
  inventory(): void;
}

const STICK_RADIUS = 56;
const TAP_TIME = 250;
const HOLD_TIME = 350;
const TAP_SLOP = 12;

export class TouchControls {
  readonly el: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private stickId: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private lookStart = 0;
  private lookMoved = 0;
  private holdTimer = 0;
  private breaking = false;
  private sneaking = false;
  /** Pixels of look movement per pixel of drag. */
  lookSpeed = 2.2;

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
    actions: TouchActions,
  ) {
    this.knob = h('div', { class: 'touch-knob' });
    this.stick = h('div', { class: 'touch-stick' }, this.knob);
    const jump = h('div', { class: 'touch-btn touch-jump', text: '▲' });
    const sneak = h('div', { class: 'touch-btn touch-sneak', text: '▼' });
    const inv = h('div', { class: 'touch-btn touch-inv', text: 'E' });
    const pause = h('div', { class: 'touch-btn touch-pause', text: 'II' });
    this.el = h('div', { class: 'touch-layer' }, this.stick, jump, sneak, inv, pause);
    parent.append(this.el);

    jump.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      jump.classList.add('active');
      input.setVirtualKey('Space', true);
    });
    const release = () => {
      jump.classList.remove('active');
      input.setVirtualKey('Space', false);
    };
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const)
      jump.addEventListener(type, release);
    sneak.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.sneaking = !this.sneaking;
      sneak.classList.toggle('active', this.sneaking);
      input.setVirtualKey('ShiftLeft', this.sneaking);
    });
    inv.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      actions.inventory();
    });
    pause.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      actions.pause();
    });

    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
  }

  private readonly onDown = (e: PointerEvent) => {
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    if (e.clientX < window.innerWidth * 0.4 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.stick.style.display = 'block';
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = '';
      this.input.analog = { forward: 0, strafe: 0 };
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.lookStart = performance.now();
      this.lookMoved = 0;
      window.clearTimeout(this.holdTimer);
      // Holding still breaks the block under the crosshair.
      this.holdTimer = window.setTimeout(() => {
        if (this.lookId === null || this.lookMoved >= TAP_SLOP) return;
        this.breaking = true;
        this.input.setVirtualButton(MouseButton.Left, true);
      }, HOLD_TIME);
    }
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickX;
      let dy = e.clientY - this.stickY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const forward = -dy / STICK_RADIUS;
      this.input.analog = { forward, strafe: dx / STICK_RADIUS };
      this.input.setVirtualKey('ControlLeft', forward > 0.92);
    } else if (e.pointerId === this.lookId) {
      const dx = e.clientX - this.lookX;
      const dy = e.clientY - this.lookY;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.lookMoved += Math.abs(dx) + Math.abs(dy);
      this.input.addLook(dx * this.lookSpeed, dy * this.lookSpeed);
    }
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stick.style.display = 'none';
      this.input.analog = null;
      this.input.setVirtualKey('ControlLeft', false);
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
      window.clearTimeout(this.holdTimer);
      if (this.breaking) {
        this.breaking = false;
        this.input.setVirtualButton(MouseButton.Left, false);
      } else if (performance.now() - this.lookStart < TAP_TIME && this.lookMoved < TAP_SLOP) {
        // A quick tap places a block or uses the one under the crosshair.
        this.input.setVirtualButton(MouseButton.Right, true);
        window.setTimeout(() => this.input.setVirtualButton(MouseButton.Right, false), 90);
      }
    }
  };
}
