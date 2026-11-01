import { signal } from '@preact/signals';
import { load, saveNow } from './storage';

export interface Profile {
  /** Random id for this browser, so two students with the same name don't collide. */
  id: string;
  name: string;
  period: string;
  createdAt: number;
}

export interface AppConfig {
  courseTitle: string;
  teacherName: string;
  periods: string[];
  /** Where submissions go. Empty = students download/print their report instead. */
  submitEndpoint: string;
  /** Send an in-progress copy to the teacher this often (minutes). 0 = only on submit. */
  autoSyncMinutes: number;
  /** Salted SHA-256 of the teacher override password (see store/override.ts). Empty = no override. */
  teacherPasswordHash: string;
}

const DEFAULT_CONFIG: AppConfig = {
  courseTitle: 'AP Cybersecurity',
  teacherName: '',
  periods: [],
  submitEndpoint: '',
  autoSyncMinutes: 2,
  teacherPasswordHash: '',
};

function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function initialProfile(): Profile {
  const saved = load<Profile>('profile');
  if (saved?.id) return saved;
  const fresh: Profile = { id: newId(), name: '', period: '', createdAt: Date.now() };
  saveNow('profile', fresh);
  return fresh;
}

export const profile = signal<Profile>(initialProfile());

export function updateProfile(patch: Partial<Profile>): void {
  profile.value = { ...profile.value, ...patch };
  saveNow('profile', profile.value);
}

export const config = signal<AppConfig>({ ...DEFAULT_CONFIG, ...(load<Partial<AppConfig>>('config') ?? {}) });

export async function loadConfig(): Promise<void> {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as Partial<AppConfig>;
    config.value = { ...DEFAULT_CONFIG, ...data };
    saveNow('config', config.value);
  } catch {
    // Offline: keep the last config we saw.
  }
}

export const online = signal<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
}
