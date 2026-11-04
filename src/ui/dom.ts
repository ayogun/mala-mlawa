export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; href?: string; title?: string } = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props.class) e.className = props.class;
  if (props.text !== undefined) e.textContent = props.text;
  if (props.href && e instanceof HTMLAnchorElement) {
    e.href = props.href;
    e.target = '_blank';
    e.rel = 'noopener';
  }
  if (props.title) e.title = props.title;
  for (const c of children) if (c != null) e.append(c);
  return e;
}
