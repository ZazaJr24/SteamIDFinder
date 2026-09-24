import { GAME_NAME, GAME_VERSION } from '../config';
import {
  RENDER_DISTANCE_MAX,
  RENDER_DISTANCE_MIN,
  type Settings,
  type SettingsStore,
} from '../core/settings';
import { button, h } from './dom';
import { t, type TranslationKey } from './i18n';

export class UIManager {
  readonly overlay: HTMLElement;
  readonly hud: HTMLElement;

  constructor(readonly root: HTMLElement) {
    this.hud = h('div', { class: 'hud', id: 'hud' });
    this.overlay = h('div', { class: 'overlay', id: 'overlay' });
    root.append(this.hud, this.overlay);
  }

  /** Replaces the current screen. `null` hides the overlay (in-game). */
  show(screen: HTMLElement | null): void {
    this.overlay.replaceChildren();
    if (screen) this.overlay.append(screen);
    this.overlay.classList.toggle('visible', screen !== null);
  }

  get hasScreen(): boolean {
    return this.overlay.childElementCount > 0;
  }
}

function logo(): HTMLElement {
  return h(
    'div',
    { class: 'logo' },
    h('div', { class: 'logo-title', text: GAME_NAME }),
    h('div', { class: 'logo-tagline', text: t('menu.tagline') }),
  );
}

export class LoadingScreen {
  readonly el: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;

  constructor(labelText = t('menu.loading')) {
    this.bar = h('div', { class: 'progress-fill' });
    this.label = h('div', { class: 'loading-label', text: labelText });
    this.el = h(
      'div',
      { class: 'screen loading-screen' },
      logo(),
      h('div', { class: 'progress' }, this.bar),
      this.label,
    );
  }

  setProgress(fraction: number, label?: string): void {
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    if (label !== undefined) this.label.textContent = label;
  }
}

export interface MainMenuActions {
  play(): void;
  worlds?(): void;
  settings(): void;
}

export function mainMenu(actions: MainMenuActions, hasSave: boolean): HTMLElement {
  return h(
    'div',
    { class: 'screen main-menu' },
    logo(),
    h(
      'div',
      { class: 'menu-buttons' },
      button(
        hasSave ? t('menu.continue') : t('menu.play'),
        actions.play,
        'btn btn-primary btn-big',
      ),
      actions.worlds ? button(t('menu.worlds'), actions.worlds) : null,
      button(t('menu.settings'), actions.settings),
    ),
    h('div', { class: 'version', text: `v${GAME_VERSION}` }),
  );
}

export interface PauseActions {
  resume(): void;
  settings(): void;
  quit(): void;
}

export function pauseMenu(actions: PauseActions): HTMLElement {
  return h(
    'div',
    { class: 'screen pause-menu dim' },
    h('h2', { text: t('pause.title') }),
    h(
      'div',
      { class: 'menu-buttons' },
      button(t('pause.resume'), actions.resume, 'btn btn-primary'),
      button(t('menu.settings'), actions.settings),
      button(t('pause.mainMenu'), actions.quit),
    ),
  );
}

export function errorScreen(message: string): HTMLElement {
  return h(
    'div',
    { class: 'screen error-screen' },
    logo(),
    h('p', { class: 'error', text: message }),
  );
}

/** Settings panel; every change is applied and saved immediately. */
export function settingsScreen(store: SettingsStore, onBack: () => void): HTMLElement {
  const body = h('div', { class: 'settings-grid' });

  const slider = (
    key: keyof Settings,
    label: TranslationKey,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ) => {
    const value = h('span', { class: 'setting-value' });
    const input = h('input', {
      attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
    });
    input.value = String(store.value[key]);
    value.textContent = format(Number(input.value));
    input.addEventListener('input', () => {
      value.textContent = format(Number(input.value));
      store.update({ [key]: Number(input.value) } as Partial<Settings>);
    });
    body.append(h('label', { class: 'setting' }, h('span', { text: t(label) }), input, value));
  };

  const toggle = (key: keyof Settings, label: TranslationKey) => {
    const btn = h('button', { class: 'btn btn-small', attrs: { type: 'button' } });
    const render = () => {
      btn.textContent = store.value[key] ? t('settings.on') : t('settings.off');
    };
    btn.addEventListener('click', () => {
      store.update({ [key]: !store.value[key] } as Partial<Settings>);
      render();
    });
    render();
    body.append(h('div', { class: 'setting' }, h('span', { text: t(label) }), btn));
  };

  const cycle = <T extends string>(
    key: keyof Settings,
    label: TranslationKey,
    options: readonly T[],
    name: (v: T) => string,
    onChanged?: () => void,
  ) => {
    const btn = h('button', { class: 'btn btn-small', attrs: { type: 'button' } });
    const render = () => {
      btn.textContent = name(store.value[key] as T);
    };
    btn.addEventListener('click', () => {
      const i = options.indexOf(store.value[key] as T);
      store.update({ [key]: options[(i + 1) % options.length] } as Partial<Settings>);
      render();
      onChanged?.();
    });
    render();
    body.append(h('div', { class: 'setting' }, h('span', { text: t(label) }), btn));
  };

  slider(
    'renderDistance',
    'settings.renderDistance',
    RENDER_DISTANCE_MIN,
    RENDER_DISTANCE_MAX,
    1,
    (v) => t('settings.chunks', { n: v }),
  );
  slider('fov', 'settings.fov', 50, 110, 1, (v) => `${v}°`);
  slider(
    'mouseSensitivity',
    'settings.sensitivity',
    0.1,
    4,
    0.05,
    (v) => `${Math.round(v * 100)}%`,
  );
  slider('masterVolume', 'settings.volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
  slider('musicVolume', 'settings.music', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
  cycle('graphics', 'settings.graphics', ['low', 'medium', 'high'] as const, (v) =>
    t(`settings.graphics.${v}`),
  );
  cycle('language', 'settings.language', ['en', 'de'] as const, (v) =>
    v === 'de' ? 'Deutsch' : 'English',
  );
  toggle('invertY', 'settings.invertY');
  toggle('viewBobbing', 'settings.viewBobbing');
  toggle('autoQuality', 'settings.autoQuality');
  toggle('showFps', 'settings.showFps');

  return h(
    'div',
    { class: 'screen settings-screen dim' },
    h('h2', { text: t('settings.title') }),
    body,
    button(t('menu.back'), onBack, 'btn btn-primary'),
  );
}
