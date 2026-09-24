import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings, SettingsStore } from '../../src/core/settings';
import { LayeredStore, MemoryStore } from '../../src/platform/storage';

describe('settings', () => {
  const defaults = defaultSettings(false);

  it('rejects bad values field by field', () => {
    const s = sanitizeSettings(
      { renderDistance: 99, fov: 'x', graphics: 'ultra', language: 'de', invertY: true },
      defaults,
    );
    expect(s.renderDistance).toBe(16);
    expect(s.fov).toBe(defaults.fov);
    expect(s.graphics).toBe(defaults.graphics);
    expect(s.language).toBe('de');
    expect(s.invertY).toBe(true);
  });

  it('survives garbage in storage and persists updates', () => {
    const mem = new MemoryStore();
    mem.setItem('settings.v1', '{not json');
    const store = new SettingsStore(mem);
    expect(store.value.fov).toBe(defaultSettings().fov);
    store.update({ fov: 90 });
    expect(new SettingsStore(mem).value.fov).toBe(90);
  });

  it('LayeredStore prefers the platform store and writes both', () => {
    const cloud = new MemoryStore();
    const local = new MemoryStore();
    const layered = new LayeredStore(cloud, local);
    local.setItem('a', 'local');
    expect(layered.getItem('a')).toBe('local');
    cloud.setItem('a', 'cloud');
    expect(layered.getItem('a')).toBe('cloud');
    layered.setItem('b', '1');
    expect(cloud.getItem('b')).toBe('1');
    expect(local.getItem('b')).toBe('1');
  });
});
