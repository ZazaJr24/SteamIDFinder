/** World selection and creation screens. */
import type { GameMode } from '../entity/player';
import type { WorldMeta } from '../world/storage/save';
import { button, h } from './dom';
import { getLanguage, t } from './i18n';

export interface WorldListActions {
  play(meta: WorldMeta): void;
  remove(meta: WorldMeta): void;
  create(): void;
  back(): void;
}

function modeName(mode: GameMode): string {
  return t(`mode.${mode}`);
}

export function worldList(
  worlds: WorldMeta[],
  actions: WorldListActions,
  persistent: boolean,
): HTMLElement {
  const list = h('div', { class: 'world-list' });
  if (worlds.length === 0) list.append(h('p', { class: 'world-empty', text: t('world.empty') }));
  const fmt = new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
  for (const w of worlds) {
    const del = button(
      t('world.delete'),
      () => {
        if (del.dataset.confirm) actions.remove(w);
        else {
          del.dataset.confirm = '1';
          del.textContent = t('world.deleteSure');
        }
      },
      'btn btn-small btn-danger',
    );
    list.append(
      h(
        'div',
        { class: 'world-row' },
        h(
          'div',
          { class: 'world-info' },
          h('div', { class: 'world-name', text: w.name }),
          h('div', {
            class: 'world-sub',
            text: `${modeName(w.mode)} · ${fmt.format(new Date(w.lastPlayed))}`,
          }),
        ),
        button(t('menu.play'), () => actions.play(w), 'btn btn-small btn-primary'),
        del,
      ),
    );
  }
  return h(
    'div',
    { class: 'screen worlds-screen dim' },
    h('h2', { text: t('menu.worlds') }),
    persistent ? null : h('p', { class: 'warning', text: t('world.notPersistent') }),
    list,
    h(
      'div',
      { class: 'row-buttons' },
      button(t('menu.newWorld'), actions.create, 'btn btn-primary'),
      button(t('menu.back'), actions.back),
    ),
  );
}

export interface NewWorld {
  name: string;
  seed: string;
  mode: GameMode;
}

export function createWorldScreen(
  onCreate: (w: NewWorld) => void,
  onBack: () => void,
): HTMLElement {
  const name = h('input', { attrs: { type: 'text', maxlength: '32', spellcheck: 'false' } });
  name.value = t('world.default');
  const seed = h('input', {
    attrs: { type: 'text', maxlength: '32', spellcheck: 'false', placeholder: t('world.seedHint') },
  });
  const modes: GameMode[] = ['survival', 'creative', 'peaceful'];
  let mode: GameMode = 'creative';
  const modeBtn = h('button', { class: 'btn', attrs: { type: 'button' } });
  const renderMode = () => {
    modeBtn.textContent = modeName(mode);
  };
  modeBtn.addEventListener('click', () => {
    mode = modes[(modes.indexOf(mode) + 1) % modes.length]!;
    renderMode();
  });
  renderMode();
  const submit = () =>
    onCreate({ name: name.value.trim() || t('world.default'), seed: seed.value.trim(), mode });
  for (const input of [name, seed]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
  return h(
    'div',
    { class: 'screen create-screen dim' },
    h('h2', { text: t('menu.newWorld') }),
    h(
      'div',
      { class: 'form' },
      h('label', { class: 'field' }, h('span', { text: t('world.name') }), name),
      h('label', { class: 'field' }, h('span', { text: t('world.seed') }), seed),
      h('div', { class: 'field' }, h('span', { text: t('world.mode') }), modeBtn),
    ),
    h(
      'div',
      { class: 'row-buttons' },
      button(t('world.create'), submit, 'btn btn-primary'),
      button(t('menu.back'), onBack),
    ),
  );
}
