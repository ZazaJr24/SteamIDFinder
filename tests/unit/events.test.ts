import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/events';

describe('EventBus', () => {
  it('delivers, unsubscribes and supports once', () => {
    const bus = new EventBus<{ hit: number }>();
    const got: number[] = [];
    const off = bus.on('hit', (n) => got.push(n));
    bus.once('hit', (n) => got.push(n * 10));
    bus.emit('hit', 1);
    bus.emit('hit', 2);
    off();
    bus.emit('hit', 3);
    expect(got).toEqual([1, 10, 2]);
  });
});
