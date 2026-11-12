import { answerKey, goalKey, type LabDef, type QuestionDef, type StepDef } from '../labs/types';
import type { SimAction } from '../runtime/actions';
import type { RestoreRecord } from './backup';
import { load, saveSoon } from './storage';

export interface Answer {
  value: string;
  updatedAt: number;
  attempts: number;
  /** Checks that only failed on format (TextQuestion `wrong` with `format`). The report leaves them out of the tries. */
  formatSlips?: number;
  /** The tries it took to be right the first time. Checking again after that, to test another answer, doesn't add tries. */
  rightAfter?: number;
  correct?: boolean;
}

/** Answered, and right if it's auto-checked. */
export function questionDone(q: QuestionDef, a: Answer | undefined): boolean {
  if (!a) return false;
  if (q.kind === 'choice' || q.expect) return !!a.correct;
  return a.value.trim().length > 0;
}

export interface LogEntry {
  at: number;
  kind: 'start' | 'step' | 'goal' | 'answer' | 'submit' | 'reset' | 'resume' | 'override' | 'restore';
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
  /** Steps the student skipped with the override: stepId -> when, and why. */
  overrides?: Record<string, { at: number; note?: string }>;
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

/** Every goal and question in the step is done. */
export function stepFinished(step: StepDef, p: LabProgress): boolean {
  return (step.goals ?? []).every((g) => p.goals[goalKey(step.id, g.id)]) && (step.questions ?? []).every((q) => questionDone(q, p.answers[answerKey(step.id, q.id)]));
}

/** How many of the lab's questions are done, not counting optional extra challenge steps. For a worksheet's progress. */
export function questionsAnswered(lab: LabDef, p: LabProgress | undefined): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const step of lab.steps) {
    if (step.extra) continue;
    for (const q of step.questions ?? []) {
      total++;
      if (p && questionDone(q, p.answers[answerKey(step.id, q.id)])) done++;
    }
  }
  return { done, total };
}
