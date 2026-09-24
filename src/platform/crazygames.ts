/**
 * Thin wrapper around the CrazyGames HTML5 SDK v3.
 *
 * The rest of the game talks only to `Platform`, never to `window.CrazyGames`
 * directly. When the SDK cannot load (local dev without network, tests,
 * another host) every call degrades to a harmless no-op, so the game always
 * runs.
 */

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const SDK_LOAD_TIMEOUT_MS = 4000;

type SdkEnvironment = 'local' | 'crazygames' | 'disabled';
type SdkAdType = 'midgame' | 'rewarded';

interface SdkAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: unknown) => void;
}

interface CrazySdk {
  init(): Promise<void>;
  environment: SdkEnvironment;
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(fn: (settings: { muteAudio?: boolean }) => void): void;
  };
  ad: {
    requestAd(type: SdkAdType, callbacks: SdkAdCallbacks): void;
    hasAdblock?(): Promise<boolean>;
  };
  data?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySdk };
  }
}

export type AdResult = 'finished' | 'error' | 'unavailable';

export interface PlatformListeners {
  /** An ad is on screen: pause the game and mute audio. */
  onAdStarted?: () => void;
  /** The ad is gone: resume. */
  onAdFinished?: () => void;
  /** The portal asked to mute or unmute all audio. */
  onMuteChanged?: (muted: boolean) => void;
}

export class Platform {
  private sdk: CrazySdk | null = null;
  private gameplayActive = false;
  private loadingActive = false;
  private adActive = false;
  private listeners: PlatformListeners = {};

  /** 'crazygames' inside the portal, 'local' on localhost with the SDK, 'none' without SDK. */
  get environment(): SdkEnvironment | 'none' {
    return this.sdk?.environment ?? 'none';
  }

  get isAdPlaying(): boolean {
    return this.adActive;
  }

  get portalMuted(): boolean {
    return this.sdk?.game.settings?.muteAudio ?? false;
  }

  setListeners(listeners: PlatformListeners): void {
    this.listeners = listeners;
  }

  async init(options: { loadSdk?: boolean } = {}): Promise<void> {
    if (options.loadSdk === false) return;
    try {
      await loadScript(SDK_URL, SDK_LOAD_TIMEOUT_MS);
      const sdk = window.CrazyGames?.SDK;
      if (!sdk) return;
      await withTimeout(sdk.init(), SDK_LOAD_TIMEOUT_MS);
      if (sdk.environment === 'disabled') return;
      this.sdk = sdk;
      sdk.game.addSettingsChangeListener?.((settings) => {
        if (settings.muteAudio !== undefined) this.listeners.onMuteChanged?.(settings.muteAudio);
      });
    } catch (error) {
      console.info('[platform] CrazyGames SDK unavailable, running standalone.', error);
      this.sdk = null;
    }
  }

  loadingStart(): void {
    if (this.loadingActive) return;
    this.loadingActive = true;
    this.call(() => this.sdk?.game.loadingStart());
  }

  loadingStop(): void {
    if (!this.loadingActive) return;
    this.loadingActive = false;
    this.call(() => this.sdk?.game.loadingStop());
  }

  /** The player is in control of the world. Idempotent. */
  gameplayStart(): void {
    if (this.gameplayActive) return;
    this.gameplayActive = true;
    this.call(() => this.sdk?.game.gameplayStart());
  }

  /** Menus, pause, death screen. Idempotent. */
  gameplayStop(): void {
    if (!this.gameplayActive) return;
    this.gameplayActive = false;
    this.call(() => this.sdk?.game.gameplayStop());
  }

  /** Celebrate a big moment (achievement, first night survived). */
  happytime(): void {
    this.call(() => this.sdk?.game.happytime());
  }

  /**
   * Shows an ad. Only call at natural breaks (death screen, back to menu) for
   * midgame ads, or after an explicit player choice for rewarded ads.
   */
  requestAd(type: SdkAdType): Promise<AdResult> {
    const sdk = this.sdk;
    if (!sdk || this.adActive) return Promise.resolve('unavailable');
    return new Promise<AdResult>((resolve) => {
      let started = false;
      const end = (result: AdResult) => {
        if (started) {
          this.adActive = false;
          this.listeners.onAdFinished?.();
        }
        resolve(result);
      };
      try {
        sdk.ad.requestAd(type, {
          adStarted: () => {
            started = true;
            this.adActive = true;
            this.listeners.onAdStarted?.();
          },
          adFinished: () => end('finished'),
          adError: () => end('error'),
        });
      } catch {
        end('error');
      }
    });
  }

  /** Key/value storage synced to the player's CrazyGames account when available. */
  get dataStore(): KeyValueStore | null {
    const data = this.sdk?.data;
    if (!data || this.sdk?.environment !== 'crazygames') return null;
    return {
      getItem: (key) => data.getItem(key),
      setItem: (key, value) => data.setItem(key, value),
      removeItem: (key) => data.removeItem(key),
    };
  }

  private call(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.warn('[platform] SDK call failed', error);
    }
  }
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function loadScript(src: string, timeoutMs: number): Promise<void> {
  if (typeof document === 'undefined') return Promise.reject(new Error('no document'));
  if (window.CrazyGames?.SDK) return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(script);
    }),
    timeoutMs,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
