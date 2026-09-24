import { describe, expect, it } from 'vitest';
import { hash2, hash3, hashFloat, Random, seedFromString } from '../../src/core/random';

describe('random', () => {
  it('Random is deterministic per seed', () => {
    const a = new Random(1234);
    const b = new Random(1234);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Random(1235).next()).not.toBe(seqA[0]);
  });

  it('Random.next stays in [0, 1) and int stays in range', () => {
    const r = new Random(99);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });

  it('hashes are stable and spread out', () => {
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 3, 2));
    expect(hash3(7, -1, 5, 9)).not.toBe(hash3(7, 1, 5, 9));
    let sum = 0;
    for (let x = 0; x < 1000; x++) sum += hashFloat(hash2(42, x, -x));
    expect(sum / 1000).toBeGreaterThan(0.45);
    expect(sum / 1000).toBeLessThan(0.55);
  });

  it('seedFromString keeps numeric seeds and hashes text', () => {
    expect(seedFromString('12345')).toBe(12345);
    expect(seedFromString('-1')).toBe(4294967295);
    expect(seedFromString('hello')).toBe(seedFromString(' hello '));
    expect(seedFromString('hello')).not.toBe(seedFromString('world'));
  });
});
