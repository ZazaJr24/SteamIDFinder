import type { KeyValueStore } from '../platform/crazygames';

export type GraphicsQuality = 'low' | 'medium' | 'high';
export type Language = 'en' | 'de';

export interface Settings {
  /** Render distance in chunks. */
  renderDistance: number;
  fov: number;
  mouseSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  musicVolume: number;
  graphics: GraphicsQuality;
  language: Language;
  showFps: boolean;
  /** Lower render distance automatically when the frame rate drops. */
  autoQuality: boolean;
  viewBobbing: boolean;
}

export const RENDER_DISTANCE_MIN = 2;
export const RENDER_DISTANCE_MAX = 16;

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function detectLanguage(): Language {
  const lang = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase();
  return lang.startsWith('de') ? 'de' : 'en';
}

export function defaultSettings(mobile = isMobileDevice()): Settings {
  return {
    renderDistance: mobile ? 5 : 8,
    fov: 75,
    mouseSensitivity: 1,
    invertY: false,
    masterVolume: 0.8,
    musicVolume: 0.5,
    graphics: mobile ? 'low' : 'high',
    language: detectLanguage(),
    showFps: false,
    autoQuality: true,
    viewBobbing: true,
  };
}

const STORAGE_KEY = 'settings.v1';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Validates untrusted stored data field by field; bad fields fall back to defaults. */
export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  const s = { ...defaults };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const num = (k: keyof Settings, min: number, max: number) => {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) (s[k] as number) = clamp(v, min, max);
  };
  const bool = (k: keyof Settings) => {
    if (typeof r[k] === 'boolean') (s[k] as boolean) = r[k];
  };
  num('renderDistance', RENDER_DISTANCE_MIN, RENDER_DISTANCE_MAX);
  s.renderDistance = Math.round(s.renderDistance);
  num('fov', 50, 110);
  num('mouseSensitivity', 0.1, 4);
  num('masterVolume', 0, 1);
  num('musicVolume', 0, 1);
  bool('invertY');
  bool('showFps');
  bool('autoQuality');
  bool('viewBobbing');
  if (r.graphics === 'low' || r.graphics === 'medium' || r.graphics === 'high')
    s.graphics = r.graphics;
  if (r.language === 'en' || r.language === 'de') s.language = r.language;
  return s;
}

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(private readonly store: KeyValueStore) {
    const defaults = defaultSettings();
    let parsed: unknown;
    try {
      const text = store.getItem(STORAGE_KEY);
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    this.current = sanitizeSettings(parsed, defaults);
  }

  get value(): Readonly<Settings> {
    return this.current;
  }

  update(patch: Partial<Settings>): void {
    this.current = sanitizeSettings({ ...this.current, ...patch }, this.current);
    this.store.setItem(STORAGE_KEY, JSON.stringify(this.current));
    for (const fn of this.listeners) fn(this.current);
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
