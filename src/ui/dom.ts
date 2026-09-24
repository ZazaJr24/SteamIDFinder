/** Tiny DOM builder, so screens stay readable without a UI framework. */

type Child = Node | string | number | null | undefined | false;
type Props = {
  class?: string;
  id?: string;
  text?: string;
  title?: string;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.style) Object.assign(el.style, props.style);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) {
    for (const [type, fn] of Object.entries(props.on)) {
      el.addEventListener(type, fn as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  return h('button', {
    class: className,
    text: label,
    attrs: { type: 'button' },
    on: { click: onClick },
  });
}
