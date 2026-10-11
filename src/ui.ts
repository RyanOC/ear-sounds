const refreshers: (() => void)[] = [];

/** Register a function that re-reads state into the DOM. */
export function onRefresh(fn: () => void) {
  refreshers.push(fn);
}

export function refreshAll() {
  for (const fn of refreshers) fn();
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

export function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls }, text);
  b.addEventListener('click', onClick);
  return b;
}

const COLLAPSE_KEY = 'ear-sounds:collapsed';

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

const collapsed = loadCollapsed();

/** Add a collapse arrow to a card's header. Collapsed cards show only their header. Remembered per browser. */
export function collapsible(card: HTMLElement, id: string): HTMLElement {
  const header = card.querySelector(':scope > header')!;
  const title = header.querySelector('h2')?.textContent ?? 'card';
  const toggle = button('', () => {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // not remembered; still works for this visit
    }
    sync();
  }, 'collapse');
  const sync = () => {
    const isCollapsed = collapsed.has(id);
    card.classList.toggle('collapsed', isCollapsed);
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
    toggle.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} ${title}`);
  };
  // Chevron drawn as SVG (points up when open; CSS flips it down when collapsed).
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
    '<path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  header.prepend(toggle);
  sync();
  return card;
}

export function showIf<T extends HTMLElement>(node: T, pred: () => boolean): T {
  onRefresh(() => {
    node.hidden = !pred();
  });
  return node;
}

export function liveText(fn: () => string, tag: 'p' | 'pre' = 'p', cls = 'info'): HTMLElement {
  const e = el(tag, { class: cls });
  onRefresh(() => {
    e.textContent = fn();
  });
  return e;
}

export interface NumDef {
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Logarithmic slider (for frequencies and rates). */
  log?: boolean;
  /** Show −/+ buttons that nudge by this amount. */
  fine?: number;
}

/** Slider + typed number box (+ optional fine buttons), kept in sync. */
export function numControl(def: NumDef, get: () => number, set: (v: number) => void): HTMLElement {
  const { min, max, step } = def;
  const decimals = step >= 1 ? 0 : Math.ceil(-Math.log10(step) - 1e-9);
  const quant = (v: number) =>
    Math.min(max, Math.max(min, Number((Math.round(v / step) * step).toFixed(decimals))));
  const toPos = (v: number) => (def.log ? (1000 * Math.log(v / min)) / Math.log(max / min) : v);
  const fromPos = (x: number) => (def.log ? min * Math.pow(max / min, x / 1000) : x);

  const range = el('input', {
    type: 'range',
    min: String(def.log ? 0 : min),
    max: String(def.log ? 1000 : max),
    step: def.log ? 'any' : String(step),
    'aria-label': def.label,
  });
  const num = el('input', {
    type: 'number',
    min: String(min),
    max: String(max),
    step: String(step),
    inputmode: 'decimal',
    'aria-label': `${def.label} value`,
  });

  const sync = () => {
    const v = get();
    range.value = String(toPos(v));
    if (document.activeElement !== num) num.value = v.toFixed(decimals);
  };
  const commit = (v: number) => {
    set(quant(v));
    sync();
    num.value = get().toFixed(decimals);
  };

  range.addEventListener('input', () => {
    set(quant(fromPos(Number(range.value))));
    num.value = get().toFixed(decimals);
  });
  num.addEventListener('change', () => {
    const v = Number(num.value);
    if (num.value !== '' && Number.isFinite(v)) commit(v);
    else sync();
  });

  const row = el('div', { class: 'ctl-row' }, range);
  if (def.fine) {
    const f = def.fine;
    row.append(
      button('−', () => commit(get() - f), 'fine'),
      num,
      button('+', () => commit(get() + f), 'fine'),
    );
  } else {
    row.append(num);
  }
  row.append(el('span', { class: 'unit' }, def.unit ?? ''));

  onRefresh(sync);
  sync();
  return el('div', { class: 'ctl' }, el('label', {}, def.label), row);
}

/** Segmented buttons for picking one option. */
export function choiceControl(
  label: string,
  options: [string, string][],
  get: () => string,
  set: (v: string) => void,
): HTMLElement {
  const btns = options.map(([value, text]) => [value, button(text, () => set(value))] as const);
  const sync = () => btns.forEach(([value, b]) => b.classList.toggle('on', get() === value));
  onRefresh(sync);
  sync();
  return el('div', { class: 'ctl' }, el('label', {}, label), el('div', { class: 'seg' }, ...btns.map((b) => b[1])));
}
