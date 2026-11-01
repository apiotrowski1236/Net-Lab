import { signal } from '@preact/signals';

/**
 * Dark or light colors. Dark is the default. The choice lives in localStorage and
 * shows up as data-theme on <html>; styles.css keys every color off that attribute.
 *
 * index.html runs a copy of the startup logic inline, before any CSS loads, so the
 * first paint already has the right theme. Keep the key and default in sync with it.
 */
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'netlab:v1:theme';
const DEFAULT_THEME: Theme = 'dark';

const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light';

function readSaved(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

function initial(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const attr = document.documentElement.getAttribute('data-theme');
  return isTheme(attr) ? attr : (readSaved() ?? DEFAULT_THEME);
}

export const theme = signal<Theme>(initial());

function apply(t: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t);
}

export function setTheme(t: Theme): void {
  theme.value = t;
  apply(t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage blocked: the theme still applies for this visit */
  }
}

export function toggleTheme(): void {
  setTheme(theme.value === 'dark' ? 'light' : 'dark');
}

if (typeof window !== 'undefined') {
  apply(theme.value);
  // Another tab changed the theme: follow it.
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY && isTheme(e.newValue)) {
      theme.value = e.newValue;
      apply(e.newValue);
    }
  });
}
