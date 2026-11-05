import { signal } from '@preact/signals';
import { load, saveNow } from './storage';

export interface Profile {
  /** Random id for this browser, so two students with the same name don't collide. */
  id: string;
  name: string;
  period: string;
  createdAt: number;
  /** The student's course ("class"), a Curriculum id from src/curricula.ts. Empty until they sign in. */
  curriculum?: string;
}

export interface AppConfig {
  teacherName: string;
  /** Class periods to pick from when signing in. Empty: one section, so no period is asked for. */
  periods: string[];
  /** Where submissions go. Empty = students download their report and hand it in themselves. */
  submitEndpoint: string;
  /** Where students hand in the downloaded report when there's no endpoint, e.g. "PowerSchool". Empty = "the way your teacher asked". */
  handInTo: string;
  /** Send an in-progress copy to the teacher this often (minutes). 0 = only on submit. */
  autoSyncMinutes: number;
}

const DEFAULT_CONFIG: AppConfig = {
  teacherName: '',
  periods: [],
  submitEndpoint: '',
  handInTo: '',
  autoSyncMinutes: 2,
};

function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Students who signed in before NetLab had more than one course are all AP
 * Cybersecurity students: give them that course instead of asking again.
 * Keep 'cyber' in sync with LEGACY_CURRICULUM in src/curricula.ts.
 */
export function migrateProfile(saved: Profile): Profile {
  if (!saved.curriculum && saved.name?.trim()) return { ...saved, curriculum: 'cyber' };
  return saved;
}

function initialProfile(): Profile {
  const saved = load<Profile>('profile');
  if (saved?.id) {
    const p = migrateProfile(saved);
    if (p !== saved) saveNow('profile', p);
    return p;
  }
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
