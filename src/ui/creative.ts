/** Creative inventory: every block, by tab, with search. */
import { BLOCKS } from '../world/blocks/blocks';
import type { BlockSpec } from '../world/blocks/registry';
import type { BlockTextures } from '../render/textures';
import { h } from './dom';
import type { Hotbar } from './hotbar';
import { prettyName } from './hotbar';
import { blockIcon } from './icons';
import { t, type TranslationKey } from './i18n';

type Tab = 'all' | NonNullable<BlockSpec['category']>;
const TABS: Tab[] = ['all', 'building', 'nature', 'decoration', 'utility'];

let lastTab: Tab = 'all';

export function creativeInventory(
  textures: BlockTextures,
  hotbar: Hotbar,
  onClose: () => void,
): HTMLElement {
  const grid = h('div', { class: 'inv-grid' });
  const search = h('input', {
    class: 'inv-search',
    attrs: { type: 'search', placeholder: t('inventory.search'), spellcheck: 'false' },
  });
  const tabs = h('div', { class: 'inv-tabs' });
  const hotbarRow = h('div', { class: 'inv-hotbar' });
  let hovered: number | null = null;

  const items = BLOCKS.blocks
    .filter((b) => b.spec.category !== 'hidden')
    .map((b) => ({
      state: b.defaultState,
      name: prettyName(b.name),
      cat: (b.spec.category ?? 'building') as Tab,
    }));

  const renderHotbar = () => {
    hotbarRow.replaceChildren(
      ...Array.from({ length: 9 }, (_, i) => {
        const state = hotbar.stateAt(i);
        const slot = h(
          'div',
          { class: `slot${i === hotbar.selectedIndex ? ' selected' : ''}` },
          state !== null
            ? h('img', { attrs: { src: blockIcon(textures, state), alt: '', draggable: 'false' } })
            : null,
        );
        slot.addEventListener('click', () => {
          hotbar.select(i);
          renderHotbar();
        });
        slot.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          hotbar.set(i, null);
          renderHotbar();
        });
        return slot;
      }),
    );
  };

  const renderGrid = () => {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren(
      ...items
        .filter(
          (it) =>
            (lastTab === 'all' || it.cat === lastTab) && (!q || it.name.toLowerCase().includes(q)),
        )
        .map((it) => {
          const cell = h(
            'button',
            { class: 'inv-item', title: it.name, attrs: { type: 'button' } },
            h('img', {
              attrs: { src: blockIcon(textures, it.state), alt: it.name, draggable: 'false' },
            }),
          );
          cell.addEventListener('click', () => {
            hotbar.set(hotbar.selectedIndex, it.state);
            renderHotbar();
          });
          cell.addEventListener('pointerenter', () => (hovered = it.state));
          cell.addEventListener('pointerleave', () => (hovered = null));
          return cell;
        }),
    );
  };

  const renderTabs = () => {
    tabs.replaceChildren(
      ...TABS.map((tab) => {
        const b = h('button', {
          class: `btn btn-small inv-tab${tab === lastTab ? ' active' : ''}`,
          text: t(`inventory.tab.${tab}` as TranslationKey),
          attrs: { type: 'button' },
        });
        b.addEventListener('click', () => {
          lastTab = tab;
          renderTabs();
          renderGrid();
        });
        return b;
      }),
    );
  };

  search.addEventListener('input', renderGrid);
  // Number keys put the hovered block into that hotbar slot (like the classic game).
  const onKey = (e: KeyboardEvent) => {
    if (document.activeElement === search) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m && hovered !== null) {
      hotbar.set(Number(m[1]) - 1, hovered);
      renderHotbar();
    }
  };
  window.addEventListener('keydown', onKey);

  renderTabs();
  renderGrid();
  renderHotbar();

  const panel = h(
    'div',
    { class: 'inv-panel' },
    h('div', { class: 'inv-head' }, h('h2', { text: t('inventory.title') }), search),
    tabs,
    grid,
    h('div', { class: 'inv-hint', text: t('inventory.hint') }),
    hotbarRow,
  );
  const screen = h('div', { class: 'screen inventory-screen dim' }, panel);
  screen.addEventListener('pointerdown', (e) => {
    if (e.target === screen) onClose();
  });
  // Clean up the key listener when the screen is removed.
  const observer = new MutationObserver(() => {
    if (!screen.isConnected) {
      window.removeEventListener('keydown', onKey);
      observer.disconnect();
    }
  });
  queueMicrotask(() => observer.observe(document.body, { childList: true, subtree: true }));
  return screen;
}
