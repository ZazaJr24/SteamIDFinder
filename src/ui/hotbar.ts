import { BLOCKS } from '../world/blocks/blocks';
import type { BlockTextures } from '../render/textures';
import { h } from './dom';
import { blockIcon } from './icons';

const DEFAULT_ITEMS = [
  'grass_block',
  'dirt',
  'stone',
  'cobblestone',
  'oak_planks',
  'oak_log',
  'glass',
  'torch',
  'lantern',
];

/** The 9-slot quick bar at the bottom of the screen. */
export class Hotbar {
  readonly el: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly label: HTMLElement;
  private readonly items: (number | null)[];
  private selected = 0;
  private textures: BlockTextures | null = null;
  private labelTimer = 0;

  constructor(parent: HTMLElement) {
    this.items = DEFAULT_ITEMS.map((n) => BLOCKS.id(n));
    const bar = h('div', { class: 'hotbar' });
    for (let i = 0; i < 9; i++) {
      const slot = h('div', { class: 'slot' });
      slot.addEventListener('pointerdown', () => this.select(i));
      this.slots.push(slot);
      bar.append(slot);
    }
    this.label = h('div', { class: 'hotbar-label' });
    this.el = h('div', { class: 'hotbar-wrap' }, this.label, bar);
    parent.append(this.el);
    this.setVisible(false);
  }

  setTextures(textures: BlockTextures): void {
    this.textures = textures;
    this.render();
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? 'flex' : 'none';
  }

  get selectedState(): number | null {
    return this.items[this.selected] ?? null;
  }

  get selectedIndex(): number {
    return this.selected;
  }

  select(i: number): void {
    this.selected = ((i % 9) + 9) % 9;
    this.render();
    this.flashLabel();
  }

  scroll(steps: number): void {
    this.select(this.selected + steps);
  }

  /** Puts a block into the selected slot (or selects it if already present). */
  pick(state: number): void {
    const existing = this.items.indexOf(state);
    if (existing >= 0) this.select(existing);
    else {
      this.items[this.selected] = state;
      this.render();
      this.flashLabel();
    }
  }

  set(index: number, state: number | null): void {
    this.items[index] = state;
    this.render();
  }

  private flashLabel(): void {
    const state = this.selectedState;
    this.label.textContent = state === null ? '' : prettyName(BLOCKS.blockOf(state).name);
    this.label.classList.remove('fade');
    void this.label.offsetWidth;
    this.label.classList.add('fade');
    window.clearTimeout(this.labelTimer);
  }

  private render(): void {
    this.slots.forEach((slot, i) => {
      slot.classList.toggle('selected', i === this.selected);
      const state = this.items[i];
      slot.replaceChildren();
      if (state !== null && state !== undefined && this.textures) {
        slot.append(
          h('img', {
            attrs: { src: blockIcon(this.textures, state), alt: '', draggable: 'false' },
          }),
        );
      }
    });
  }
}

export function prettyName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
