import { signal } from '@preact/signals';

/**
 * Everything a student does is written to localStorage within a fraction of a
 * second, and flushed immediately when the tab is hidden or closed. There is
 * no server copy of in-progress work unless the teacher configures one, so
 * this file is what keeps work from being lost.
 */

const PREFIX = 'netlab:v1:';

export const saveState = signal<{ status: 'idle' | 'pending' | 'saved' | 'error'; at?: number; error?: string }>({
  status: 'idle',
});

export function storageAvailable(): boolean {
  try {
    const k = PREFIX + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function load<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // fall through to the backup copy
  }
  try {
    const bak = localStorage.getItem(PREFIX + key + ':bak');
    if (bak) return JSON.parse(bak) as T;
  } catch {
    /* nothing usable */
  }
  return undefined;
}

export function saveNow(key: string, value: unknown): boolean {
  try {
    const json = JSON.stringify(value);
    const prev = localStorage.getItem(PREFIX + key);
    // Keep the previous good copy so a half-written save can never wipe out work.
    if (prev) localStorage.setItem(PREFIX + key + ':bak', prev);
    localStorage.setItem(PREFIX + key, json);
    saveState.value = { status: 'saved', at: Date.now() };
    return true;
  } catch (e) {
    saveState.value = { status: 'error', at: Date.now(), error: String(e) };
    return false;
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
    localStorage.removeItem(PREFIX + key + ':bak');
  } catch {
    /* ignore */
  }
}

export function keys(prefix = ''): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX + prefix) && !k.endsWith(':bak')) out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* ignore */
  }
  return out;
}

// Debounced writes, flushed when the page hides or unloads.
const pending = new Map<string, () => unknown>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function saveSoon(key: string, get: () => unknown, delay = 300): void {
  pending.set(key, get);
  saveState.value = { ...saveState.value, status: 'pending' };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSaves, delay);
}

export function flushSaves(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  for (const [key, get] of pending) saveNow(key, get());
  pending.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSaves);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSaves();
  });
}
