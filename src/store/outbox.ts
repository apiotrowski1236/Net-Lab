import { signal } from '@preact/signals';
import { config, online } from './profile';
import type { Report } from './report';
import { load, saveNow } from './storage';

/**
 * Reports waiting to reach the teacher. Survives reloads and offline periods;
 * retried whenever the browser comes back online.
 *
 * Requests are sent as text/plain with mode "no-cors" so they work with a
 * Google Apps Script web app (no CORS preflight). The receiver upserts by
 * report.key, so sending the same report twice is harmless.
 */

export interface OutboxItem {
  key: string;
  status: Report['status'];
  report: Report;
  queuedAt: number;
  tries: number;
  lastError?: string;
}

export interface SyncInfo {
  sentAt: number;
  status: Report['status'];
}

export const outbox = signal<OutboxItem[]>(load<OutboxItem[]>('outbox') ?? []);
export const synced = signal<Record<string, SyncInfo>>(load<Record<string, SyncInfo>>('synced') ?? {});

function persist() {
  saveNow('outbox', outbox.value);
  saveNow('synced', synced.value);
}

export function hasEndpoint(): boolean {
  return /^https?:\/\//.test(config.value.submitEndpoint.trim());
}

export function enqueue(report: Report): void {
  const existing = outbox.value.find((i) => i.key === report.key);
  // Never let an automatic in-progress copy replace a pending final submission.
  if (existing?.status === 'submitted' && report.status === 'in-progress') return;
  const item: OutboxItem = { key: report.key, status: report.status, report, queuedAt: Date.now(), tries: 0 };
  outbox.value = [...outbox.value.filter((i) => i.key !== report.key), item];
  persist();
  void flush();
}

let flushing = false;

export async function flush(): Promise<void> {
  if (flushing || !hasEndpoint() || !online.value) return;
  flushing = true;
  try {
    for (const item of [...outbox.value]) {
      try {
        await fetch(config.value.submitEndpoint.trim(), {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item.report),
        });
        outbox.value = outbox.value.filter((i) => i !== item);
        synced.value = { ...synced.value, [item.key]: { sentAt: Date.now(), status: item.status } };
      } catch (e) {
        item.tries += 1;
        item.lastError = String(e);
        outbox.value = [...outbox.value];
        break; // probably offline; try again later
      }
      persist();
    }
  } finally {
    flushing = false;
    persist();
  }
}

/** Last-chance send when the tab is closing. */
export function beacon(report: Report): void {
  if (!hasEndpoint()) return;
  try {
    const blob = new Blob([JSON.stringify(report)], { type: 'text/plain;charset=utf-8' });
    navigator.sendBeacon(config.value.submitEndpoint.trim(), blob);
  } catch {
    /* the outbox still has it */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush());
  setInterval(() => void flush(), 30_000);
}
