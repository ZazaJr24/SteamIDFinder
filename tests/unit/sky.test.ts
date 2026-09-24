import { describe, expect, it } from 'vitest';
import { skyAt } from '../../src/render/sky';

describe('day cycle', () => {
  it('is bright at noon and dark at midnight', () => {
    const noon = skyAt(6000);
    const midnight = skyAt(18000);
    expect(noon.daylight).toBeGreaterThan(0.95);
    expect(noon.sunDir.y).toBeGreaterThan(0.9);
    expect(midnight.daylight).toBeLessThan(0.2);
    expect(midnight.night).toBeGreaterThan(0.9);
  });

  it('glows at sunset, without stars yet', () => {
    const sunset = skyAt(12000);
    expect(sunset.sunset).toBeGreaterThan(0.9);
    expect(sunset.night).toBeLessThan(0.2);
    expect(sunset.daylight).toBeGreaterThan(0.4);
  });

  it('wraps around days', () => {
    expect(skyAt(6000 + 24000 * 3).daylight).toBeCloseTo(skyAt(6000).daylight, 6);
  });
});
