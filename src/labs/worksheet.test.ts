import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../runtime/session';
import { questionsAnswered, type LabProgress } from '../store/progress';
import { buildReport } from '../store/report';
import { reportHtml } from '../ui/Submit';
import { LABS } from '.';
import { curriculumOfLab } from '../curricula';
import { isWorksheet, type LabDef } from './types';

/**
 * Answer sheets (LabDef.worksheet): one page of the handout's questions for a
 * lab done somewhere else. The walkthrough test plays their sample answers
 * like any lab's answer key. These check what makes them answer sheets.
 */

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
  });
});

const fresh = (lab: LabDef): LabProgress => {
  const now = Date.now();
  return { labId: lab.id, labVersion: lab.version, studentId: 'ws-test', startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] };
};
const who = { id: 'ws-test', name: 'Robin Sheet', period: 'Period 3', createdAt: 0 };

const SHEETS = LABS.filter(isWorksheet);

it('has at least one answer sheet', () => {
  expect(SHEETS.length).toBeGreaterThan(0);
});

describe.each(SHEETS.map((l) => [l.id, l] as const))('answer sheet %s', (_id, lab) => {
  it('is only questions: no network, demos, goals, tools, buttons, or setups', () => {
    expect(lab.build).toBeUndefined();
    for (const s of lab.steps) {
      expect([s.goals, s.tools, s.actions, s.demos, s.setup, s.focus, s.open].every((x) => x === undefined), s.id).toBe(true);
      expect(s.extra, s.id).toBeUndefined();
    }
    expect(lab.steps.at(-1)?.kind).toBe('submit');
    expect(lab.steps.slice(0, -1).every((s) => (s.questions ?? []).length > 0)).toBe(true);
  });

  it("numbers every question like the handout, with no number used twice", () => {
    const labels = lab.steps.flatMap((s) => (s.questions ?? []).map((q) => q.label));
    expect(labels.every((l) => !!l?.trim())).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('belongs to a course, so it shows on a home page', () => {
    expect(curriculumOfLab(lab.id).labs).toContain(lab.id);
  });

  it('counts answers for the progress bar and the home page card', () => {
    const s = new LabSession(lab, fresh(lab));
    const total = lab.steps.reduce((n, st) => n + (st.questions?.length ?? 0), 0);
    expect(questionsAnswered(lab, s.progress)).toEqual({ done: 0, total });
    // Students answer in any order: a question in the last section counts without finishing the first.
    const last = lab.steps.filter((st) => st.questions?.length).at(-1)!;
    s.setDraft(last.id, last.questions![0], 'An answer.');
    expect(questionsAnswered(lab, s.progress)).toEqual({ done: 1, total });
    s.setDraft(last.id, last.questions![0], '   ');
    expect(questionsAnswered(lab, s.progress).done).toBe(0);
    expect(questionsAnswered(lab, undefined)).toEqual({ done: 0, total });
  });

  it("hands in the usual report, with the handout's numbers and section names", () => {
    const s = new LabSession(lab, fresh(lab));
    const first = lab.steps[0];
    const q = first.questions![0];
    s.setDraft(first.id, q, 'My <b>answer</b>');
    s.markSubmitted();
    const r = buildReport(lab, s.progress, who, 'submitted');
    expect(r.questions[0]).toMatchObject({ label: q.label, answer: 'My <b>answer</b>', autoGraded: false });
    const html = reportHtml(lab, r);
    expect(html).toContain(`<b>${q.label}.</b>`);
    expect(html).toContain(`<h2>${first.title}</h2>`);
    expect(html).toContain('My &lt;b&gt;answer&lt;/b&gt;');
    expect(html).toContain(`1 / ${r.questions.length}</b>written answers for your teacher`);
    expect(html).toContain('Robin Sheet');
    // No steps to reach, goals, or Q1-style numbers on an answer sheet.
    expect(html).not.toMatch(/steps reached|<b>\d+ \/ \d+<\/b>goals|<b>Q\d+\.<\/b>|Step \d+\./);
  });
});
