import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../src/core/loop';

describe('FixedStepper', () => {
  it('runs whole steps and keeps the remainder', () => {
    let steps = 0;
    const s = new FixedStepper(20, () => steps++);
    expect(s.advance(0.12)).toBe(2);
    expect(steps).toBe(2);
    expect(s.alpha).toBeCloseTo(0.4, 5);
    s.advance(0.03);
    expect(steps).toBe(3);
  });

  it('caps steps after a long stall', () => {
    let steps = 0;
    const s = new FixedStepper(60, () => steps++, 5);
    s.advance(10);
    expect(steps).toBe(5);
    expect(s.alpha).toBeLessThanOrEqual(1);
  });
});
