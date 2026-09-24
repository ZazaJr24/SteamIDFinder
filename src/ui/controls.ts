/** Controls screen: rebind keys, touch sensitivity, auto-jump. */
import { DEFAULT_BINDINGS, type Action } from '../core/input';
import type { Settings, SettingsStore } from '../core/settings';
import { button, h } from './dom';
import { t, type TranslationKey } from './i18n';

const ACTIONS: Action[] = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sneak',
  'sprint',
  'inventory',
  'drop',
  'toggleFly',
  'debug',
];

const NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift R',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl R',
  AltLeft: 'Alt',
  AltRight: 'Alt R',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: '⌫',
  CapsLock: 'Caps',
};

/** Human-readable key name ("KeyW" → "W"). */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return NAMES[code] ?? code;
}

function boundKey(settings: Settings, action: Action): string {
  return settings.keys[action] ?? DEFAULT_BINDINGS[action][0]!;
}

export function controlsScreen(store: SettingsStore, onBack: () => void): HTMLElement {
  const list = h('div', { class: 'settings-grid controls-grid' });
  let stopCapture: (() => void) | null = null;

  const render = () => {
    list.replaceChildren();
    for (const action of ACTIONS) {
      const key = boundKey(store.value, action);
      const conflict = ACTIONS.some((a) => a !== action && boundKey(store.value, a) === key);
      const btn = h('button', {
        class: `btn btn-small key-btn${conflict ? ' conflict' : ''}`,
        text: keyName(key),
        attrs: { type: 'button' },
      });
      btn.addEventListener('click', () => capture(action, btn));
      list.append(
        h(
          'div',
          { class: 'setting' },
          h('span', { text: t(`controls.action.${action}` as TranslationKey) }),
          btn,
        ),
      );
    }
    const touch = h('input', { attrs: { type: 'range', min: '0.3', max: '3', step: '0.05' } });
    touch.value = String(store.value.touchSensitivity);
    const touchValue = h('span', {
      class: 'setting-value',
      text: `${Math.round(store.value.touchSensitivity * 100)}%`,
    });
    touch.addEventListener('input', () => {
      touchValue.textContent = `${Math.round(Number(touch.value) * 100)}%`;
      store.update({ touchSensitivity: Number(touch.value) });
    });
    list.append(
      h(
        'label',
        { class: 'setting' },
        h('span', { text: t('controls.touchSensitivity') }),
        touch,
        touchValue,
      ),
    );
    const auto = h('button', {
      class: 'btn btn-small',
      text: store.value.autoJump ? t('settings.on') : t('settings.off'),
      attrs: { type: 'button' },
    });
    auto.addEventListener('click', () => {
      store.update({ autoJump: !store.value.autoJump });
      render();
    });
    list.append(h('div', { class: 'setting' }, h('span', { text: t('controls.autoJump') }), auto));
  };

  const capture = (action: Action, btn: HTMLButtonElement) => {
    stopCapture?.();
    btn.textContent = t('controls.press');
    btn.classList.add('listening');
    const onKey = (e: KeyboardEvent) => {
      // Capture phase on window: the game never sees this key press.
      e.preventDefault();
      e.stopImmediatePropagation();
      stop();
      if (e.code !== 'Escape') store.update({ keys: { ...store.value.keys, [action]: e.code } });
      render();
    };
    const stop = () => {
      window.removeEventListener('keydown', onKey, true);
      stopCapture = null;
    };
    stopCapture = stop;
    window.addEventListener('keydown', onKey, true);
  };

  render();
  return h(
    'div',
    { class: 'screen settings-screen dim' },
    h('h2', { text: t('controls.title') }),
    h('p', { class: 'hint', text: t('controls.hint') }),
    list,
    h(
      'div',
      { class: 'row-buttons' },
      button(t('controls.reset'), () => {
        store.update({ keys: {} });
        render();
      }),
      button(
        t('menu.back'),
        () => {
          stopCapture?.();
          onBack();
        },
        'btn btn-primary',
      ),
    ),
  );
}
