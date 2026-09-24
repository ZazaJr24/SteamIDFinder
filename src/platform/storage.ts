import type { KeyValueStore } from './crazygames';

/** In-memory store, used when nothing persistent is available. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/**
 * localStorage that never throws: private windows, blocked site data and
 * sandboxed iframes can all make the accessor fail.
 */
export class SafeLocalStore implements KeyValueStore {
  private readonly fallback = new MemoryStore();

  constructor(private readonly prefix: string) {}

  private get storage(): Storage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }

  getItem(key: string): string | null {
    try {
      return this.storage?.getItem(this.prefix + key) ?? this.fallback.getItem(key);
    } catch {
      return this.fallback.getItem(key);
    }
  }

  setItem(key: string, value: string): void {
    this.fallback.setItem(key, value);
    try {
      this.storage?.setItem(this.prefix + key, value);
    } catch {
      /* quota or access error: the in-memory copy still works this session */
    }
  }

  removeItem(key: string): void {
    this.fallback.removeItem(key);
    try {
      this.storage?.removeItem(this.prefix + key);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Reads from the platform store first (cloud-synced on CrazyGames), falls back
 * to the local one, and writes to both.
 */
export class LayeredStore implements KeyValueStore {
  constructor(
    private readonly primary: KeyValueStore | null,
    private readonly local: KeyValueStore,
  ) {}

  getItem(key: string): string | null {
    try {
      const value = this.primary?.getItem(key);
      if (value !== null && value !== undefined) return value;
    } catch {
      /* fall through */
    }
    return this.local.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.local.setItem(key, value);
    try {
      this.primary?.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  removeItem(key: string): void {
    this.local.removeItem(key);
    try {
      this.primary?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
