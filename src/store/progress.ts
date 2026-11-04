import type { SimAction } from '../runtime/actions';
import type { RestoreRecord } from './backup';
import { load, saveSoon } from './storage';

export interface Answer {
  value: string;
  updatedAt: number;
  attempts: number;
  correct?: boolean;
}

export interface LogEntry {
  at: number;
  kind: 'start' | 'step' | 'goal' | 'answer' | 'submit' | 'reset' | 'resume' | 'override' | 'override-failed' | 'restore';
  id: string;
}

export interface LabProgress {
  labId: string;
  labVersion: number;
  studentId: string;
  startedAt: number;
  updatedAt: number;
  /** Time the tab was visible and the student was interacting. */
  activeMs: number;
  step: number;
  maxStep: number;
  /** Simulated time each step was first entered (goals only count events after it). */
  stepStart: Record<string, number>;
  /** goalKey -> wall-clock time completed */
  goals: Record<string, number>;
  answers: Record<string, Answer>;
  actions: { t: number; a: SimAction }[];
  /** Each demo's state in a lesson with no network, by "stepId/demoId" (see src/demos). */
  demos?: Record<string, unknown>;
  log: LogEntry[];
  submittedAt?: number;
  submitCount?: number;
  /** Steps a teacher unlocked with the override password: stepId -> when, and why. */
  overrides?: Record<string, { at: number; note?: string }>;
  /** Wrong override passwords typed in this lab. Shown on the report. */
  overrideFailures?: number;
  /** Too many wrong passwords in a row locks the override until this time. */
  overrideLockedUntil?: number;
  /** Short id for this attempt at this lab. Survives a restore from a report file (see store/backup.ts). */
  workId?: string;
  /** Each time this work was restored from a report file. */
  restores?: RestoreRecord[];
}

const MAX_LOG = 400;

const cache = new Map<string, LabProgress>();

export const progressKey = (studentId: string, labId: string) => `lab:${studentId}:${labId}`;

export function getProgress(studentId: string, labId: string, labVersion: number): LabProgress {
  const key = progressKey(studentId, labId);
  let p = cache.get(key) ?? load<LabProgress>(key);
  if (!p) {
    const now = Date.now();
    p = {
      labId,
      labVersion,
      studentId,
      startedAt: now,
      updatedAt: now,
      activeMs: 0,
      step: 0,
      maxStep: 0,
      stepStart: {},
      goals: {},
      answers: {},
      actions: [],
      log: [{ at: now, kind: 'start', id: labId }],
    };
  }
  cache.set(key, p);
  return p;
}

/** Peek without creating. */
export function peekProgress(studentId: string, labId: string): LabProgress | undefined {
  const key = progressKey(studentId, labId);
  return cache.get(key) ?? load<LabProgress>(key);
}

export function touch(p: LabProgress, entry?: Omit<LogEntry, 'at'>): void {
  p.updatedAt = Date.now();
  if (entry) {
    p.log.push({ at: p.updatedAt, ...entry });
    if (p.log.length > MAX_LOG) p.log.splice(0, p.log.length - MAX_LOG);
  }
  const key = progressKey(p.studentId, p.labId);
  cache.set(key, p);
  saveSoon(key, () => cache.get(key));
}

export function replaceProgress(p: LabProgress): void {
  const key = progressKey(p.studentId, p.labId);
  cache.set(key, p);
  saveSoon(key, () => cache.get(key), 0);
}
