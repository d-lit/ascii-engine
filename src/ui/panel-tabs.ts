const STORAGE_KEY = 'ascii-engine.panel-tab';

export interface PanelTabs<K extends string> {
  /** Page element of a tab; sections are appended to it. */
  page(key: K): HTMLElement;
  select(key: K): void;
}

/**
 * Tab bar at the top of the panel and one page per tab; only the selected
 * page is shown. The choice is remembered per browser.
 */
export function createPanelTabs<K extends string>(panel: HTMLElement, keys: readonly K[]): PanelTabs<K> {
  const bar = document.createElement('nav');
  bar.className = 'panel-tabs';
  bar.setAttribute('role', 'tablist');
  const buttons = new Map<K, HTMLButtonElement>();
  const pages = new Map<K, HTMLElement>();

  const select = (key: K): void => {
    for (const [k, b] of buttons) {
      b.classList.toggle('on', k === key);
      b.setAttribute('aria-selected', String(k === key));
    }
    for (const [k, p] of pages) p.hidden = k !== key;
    panel.scrollTop = 0;
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // Storage may be blocked; the tab just won't persist.
    }
  };

  for (const key of keys) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = key;
    b.addEventListener('click', () => select(key));
    buttons.set(key, b);
    bar.append(b);
    const p = document.createElement('div');
    p.className = 'panel-page';
    p.setAttribute('role', 'tabpanel');
    pages.set(key, p);
  }
  panel.append(bar, ...pages.values());

  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const first = keys.find((k) => k === stored) ?? keys[0];
  if (first !== undefined) select(first);

  return {
    page(key: K): HTMLElement {
      const p = pages.get(key);
      if (p === undefined) throw new Error(`panel tab ${key} not found`);
      return p;
    },
    select,
  };
}
