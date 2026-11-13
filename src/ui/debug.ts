import { signal } from '@preact/signals';

/**
 * Debug mode, for whoever is editing a lab. It unlocks every step, so you can
 * jump straight to the one you're working on, and adds a Skip step button.
 *
 * Only the dev server (`npm run dev`) has it. `debugAvailable` is false in a
 * built site, so students can't turn it on.
 */
const KEY = 'netlab:debug';

export const debugAvailable = import.meta.env.DEV;

function saved(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const debug = signal(debugAvailable && saved());

export function toggleDebug(): void {
  debug.value = !debug.value;
  try {
    if (debug.value) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows may refuse storage. Debug mode then lasts until the page reloads.
  }
}
