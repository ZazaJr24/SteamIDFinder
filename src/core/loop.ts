/**
 * Runs a callback at a fixed rate from a variable-rate frame clock
 * ("fix your timestep"). `alpha` tells the renderer how far the current frame
 * lies between the last and the next step, for interpolation.
 */
export class FixedStepper {
  readonly stepSeconds: number;
  private accumulator = 0;
  /** Upper bound of steps per advance, so a long stall cannot freeze the game. */
  private readonly maxSteps: number;

  constructor(
    hz: number,
    private readonly step: (dt: number) => void,
    maxSteps = 8,
  ) {
    this.stepSeconds = 1 / hz;
    this.maxSteps = maxSteps;
  }

  /** Advances by `dt` seconds; returns how many steps ran. */
  advance(dt: number): number {
    this.accumulator += dt;
    let steps = 0;
    // The epsilon absorbs float drift (0.12 - 0.05 - 0.05 + 0.03 < 0.05).
    while (this.accumulator + 1e-9 >= this.stepSeconds && steps < this.maxSteps) {
      this.step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps++;
    }
    if (steps === this.maxSteps) this.accumulator = Math.min(this.accumulator, this.stepSeconds);
    return steps;
  }

  get alpha(): number {
    return Math.max(0, this.accumulator / this.stepSeconds);
  }

  reset(): void {
    this.accumulator = 0;
  }
}

export interface LoopCallbacks {
  /** Called once per animation frame with the elapsed time in seconds. */
  frame(dt: number, now: number): void;
}

/** requestAnimationFrame driver with dt clamping. */
export class GameLoop {
  private running = false;
  private last = 0;
  private handle = 0;

  constructor(private readonly callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      // Clamp: a background tab or debugger pause must not produce a giant step.
      const dt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.callbacks.frame(dt, now);
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  get isRunning(): boolean {
    return this.running;
  }
}
