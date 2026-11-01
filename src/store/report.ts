import { answerKey, defaultPoints, goalKey, type LabDef } from '../labs/types';
import type { Profile } from './profile';
import type { LabProgress } from './progress';

/**
 * The document a student hands in. One row per student per lab in the
 * teacher's spreadsheet; also printable as a page.
 */
export interface Report {
  app: 'netlab';
  schema: 1;
  /** studentId:labId — the receiver upserts on this. */
  key: string;
  status: 'in-progress' | 'submitted';
  student: { id: string; name: string; period: string };
  lab: { id: string; title: string; version: number; steps: number };
  startedAt: string;
  updatedAt: string;
  submittedAt?: string;
  activeMinutes: number;
  /** 1-based furthest step reached. */
  stepReached: number;
  goals: { step: string; id: string; label: string; done: boolean; at?: string; points: number; overridden?: boolean }[];
  questions: {
    step: string;
    id: string;
    prompt: string;
    kind: 'choice' | 'text';
    answer: string;
    autoGraded: boolean;
    correct?: boolean;
    attempts?: number;
    points: number;
    /** The question's step was unlocked with a teacher override. */
    overridden?: boolean;
  }[];
  /** Steps unlocked with the teacher override password. Goals in them still show as not done. */
  overrides: { step: string; number: number; title: string; at: string; note?: string }[];
  /** Wrong override passwords typed during this lab. */
  overrideFailures: number;
  score: { auto: number; autoMax: number; teacherMax: number };
  timeline: { at: string; kind: string; id: string }[];
}

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : undefined);

// Device names for each lab, so "[[alice]]" in lesson text reads "Alice" in the report.
const labelCache = new WeakMap<LabDef, Record<string, string>>();
function deviceLabels(lab: LabDef): Record<string, string> {
  let labels = labelCache.get(lab);
  if (!labels) {
    labels = {};
    for (const d of Object.values(lab.build().devices)) labels[d.id] = d.label;
    labelCache.set(lab, labels);
  }
  return labels;
}

/** Lesson markdown to plain text: device chips become names, emphasis and code marks go. */
function plain(text: string, labels: Record<string, string>): string {
  return text.replace(/\[\[([\w-]+)\]\]/g, (_, id: string) => labels[id] ?? id).replace(/\*\*|`/g, '');
}

export function buildReport(lab: LabDef, p: LabProgress, who: Profile, status: Report['status']): Report {
  const labels = deviceLabels(lab);
  const goals: Report['goals'] = [];
  const questions: Report['questions'] = [];
  let auto = 0;
  let autoMax = 0;
  let teacherMax = 0;

  const overrides: Report['overrides'] = [];
  lab.steps.forEach((step, i) => {
    const o = p.overrides?.[step.id];
    if (o) overrides.push({ step: step.id, number: i + 1, title: step.title, at: iso(o.at)!, note: o.note });
  });

  for (const step of lab.steps) {
    const overridden = p.overrides?.[step.id] ? true : undefined;
    for (const g of step.goals ?? []) {
      const at = p.goals[goalKey(step.id, g.id)];
      const pts = g.points ?? 1;
      autoMax += pts;
      if (at) auto += pts;
      goals.push({ step: step.id, id: g.id, label: plain(g.label, labels), done: !!at, at: iso(at), points: pts, overridden });
    }
    for (const q of step.questions ?? []) {
      const a = p.answers[answerKey(step.id, q.id)];
      const pts = defaultPoints(q);
      const autoGraded = q.kind === 'choice' || !!(q.kind === 'text' && q.expect);
      let answer = a?.value ?? '';
      if (q.kind === 'choice' && a?.value) {
        const ids = a.value.split(',');
        answer = q.options
          .filter((o) => ids.includes(o.id))
          .map((o) => o.text)
          .join(' | ');
      }
      if (autoGraded) {
        autoMax += pts;
        if (a?.correct) auto += pts;
      } else teacherMax += pts;
      questions.push({
        step: step.id,
        id: q.id,
        prompt: plain(q.prompt, labels),
        kind: q.kind,
        answer,
        autoGraded,
        correct: autoGraded ? !!a?.correct : undefined,
        attempts: a?.attempts,
        points: pts,
        overridden,
      });
    }
  }

  return {
    app: 'netlab',
    schema: 1,
    key: `${who.id}:${lab.id}`,
    status,
    student: { id: who.id, name: who.name, period: who.period },
    lab: { id: lab.id, title: lab.title, version: lab.version, steps: lab.steps.length },
    startedAt: iso(p.startedAt)!,
    updatedAt: iso(p.updatedAt)!,
    submittedAt: iso(p.submittedAt),
    activeMinutes: Math.round(p.activeMs / 60000),
    stepReached: p.maxStep + 1,
    goals,
    questions,
    score: { auto, autoMax, teacherMax },
    overrides,
    overrideFailures: p.overrideFailures ?? 0,
    timeline: p.log.map((l) => ({ at: iso(l.at)!, kind: l.kind, id: l.id })),
  };
}
