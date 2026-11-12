import { signal } from '@preact/signals';
import type { Sim } from '../sim/sim';
import type { SimEvent } from '../sim/types';
import { demoModel, isStatic } from '../demos/registry';
import type { DemoInput, DemoSpec } from '../demos/types';
import { buildNetwork } from '../labs/network';
import {
  answerKey,
  goalKey,
  isLesson,
  isWorksheet,
  TAB_TOOLS,
  toolKey,
  type AnyEvent,
  type LabDef,
  type QuestionDef,
  type StepDef,
  type ToolSpec,
  type UiEvent,
  textCorrect,
  wrongMatch,
} from '../labs/types';
import { questionDone, stepFinished, touch, type Answer, type LabProgress } from '../store/progress';
import { applyAction, type SimAction } from './actions';
import { hasReplay, Replay, stepWindow } from './replay';

const MAX_ACTIONS = 2000;
/** Clicks in a row on an unfinished step's Continue button that open the override. */
export const SKIP_CLICKS = 7;
/** A longer pause between clicks starts the count over. */
const SKIP_CLICK_GAP_MS = 1500;

/**
 * Runs one lab for one student: owns the simulator, records every network
 * action for replay, checks goals, and stores answers.
 */
export class LabSession {
  sim!: Sim;
  /** Bumped whenever the lesson panel should re-render. */
  readonly rev = signal(0);
  /** Bumped (at most once per animation frame by the player) when the network changes. */
  readonly simRev = signal(0);
  /** Goal keys completed in the last few seconds (for a little celebration). */
  readonly justCompleted = signal<string[]>([]);
  /** A replay of an earlier moment, shown on the map instead of the live network. */
  readonly replay = signal<Replay | null>(null);
  /** Loop replays until the student stops them. */
  readonly repeat = signal(false);
  /** The lesson button pressed last, and when (sim time), so the lesson can show what it did. */
  readonly lastRun = signal<{ step: string; action: string; t: number } | null>(null);
  /** The display filter applied in the Capture tab (packet-capture). What the student sees, not the network: never saved or replayed. */
  readonly captureFilter = signal('');
  replayWarning = '';

  private unsub?: () => void;
  /** True while a step setup runs: its half-finished network shouldn't complete goals. */
  private holdGoals = false;
  private simDirty = false;
  private blockedClicks = 0;
  private lastBlockedClick = 0;

  constructor(
    readonly lab: LabDef,
    readonly progress: LabProgress,
  ) {
    if (progress.labVersion !== lab.version) {
      // The lab changed since this student started. Keep their answers and
      // goals, but rebuild the network from step setups only.
      progress.actions = progress.actions.filter((x) => x.a.type === 'setup');
      progress.labVersion = lab.version;
      this.replayWarning = isWorksheet(lab)
        ? 'This answer sheet was updated. Your answers are safe.'
        : isLesson(lab)
        ? 'This lesson was updated, so its activities start fresh. Your answers and goals are safe.'
        : 'This lab was updated, so the network was reset. Your answers are safe.';
      if (progress.demos) progress.demos = {};
    }
    this.rebuild();
    progress.step = Math.min(progress.step, lab.steps.length - 1);
    progress.maxStep = Math.min(Math.max(progress.maxStep, progress.step), lab.steps.length - 1);
    touch(progress, { kind: 'resume', id: this.step.id });
    this.enterStep(progress.step);
  }

  get step(): StepDef {
    return this.lab.steps[this.progress.step];
  }

  get since(): number {
    return this.progress.stepStart[this.step.id] ?? 0;
  }

  /** Recreate the network and replay the student's actions. */
  rebuild(): void {
    this.unsub?.();
    try {
      this.sim = this.rebuildFrom(this.progress.actions);
    } catch (e) {
      console.warn('Replay failed; rebuilding from step setups only.', e);
      this.progress.actions = this.progress.actions.filter((x) => x.a.type === 'setup');
      this.sim = this.rebuildFrom(this.progress.actions);
      this.replayWarning = 'The network had to be reset. Your answers and completed goals are safe.';
    }
    this.unsub = this.sim.on((ev) => this.onSimEvent(ev));
  }

  private rebuildFrom(actions: LabProgress['actions']): Sim {
    const sim = buildNetwork(this.lab);
    for (const entry of actions) {
      sim.advanceTo(entry.t);
      applyAction(this.lab, sim, entry.a);
    }
    sim.runUntilIdle();
    return sim;
  }

  /** Put the network back to how each step set it up, dropping the student's own changes. */
  resetNetwork(): void {
    this.stopReplay();
    this.progress.actions = this.progress.actions.filter((x) => x.a.type === 'setup');
    this.rebuild();
    // Steps' "since" times refer to the old timeline; start the current step fresh.
    this.progress.stepStart[this.step.id] = this.sim.t;
    touch(this.progress, { kind: 'reset', id: this.step.id });
    this.bump();
    this.simRev.value++;
  }

  dispatch(a: SimAction): void {
    // Doing something on the network always brings the live network back.
    if (this.replay.peek()) this.stopReplay();
    if (this.progress.actions.length < MAX_ACTIONS) this.progress.actions.push({ t: this.sim.t, a });
    this.holdGoals = a.type === 'setup';
    try {
      applyAction(this.lab, this.sim, a);
    } finally {
      this.holdGoals = false;
    }
    touch(this.progress);
    this.checkGoals();
    this.simRev.value++;
  }

  runStepAction(actionId: string): void {
    this.lastRun.value = { step: this.step.id, action: actionId, t: this.sim.t };
    this.dispatch({ type: 'step-action', step: this.step.id, action: actionId });
  }

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------

  /** The network to draw and inspect: the replay while one is running, otherwise the live network. */
  get view(): Sim {
    return this.replay.value?.sim ?? this.sim;
  }

  /** Whether step `index` has anything to replay (the student did something on the network in it). */
  canReplay(index = this.progress.step): boolean {
    return hasReplay(this.lab, this.progress, index, this.sim.t + 1);
  }

  /** Replay what happened on the network during step `index`. Returns false if there's nothing to show. */
  startReplay(index = this.progress.step): boolean {
    const w = stepWindow(this.lab, this.progress, index, this.sim.t + 1);
    if (!w || !this.canReplay(index)) return false;
    this.replay.value = new Replay(this.lab, this.progress.actions, w, index);
    this.simRev.value++;
    return true;
  }

  stopReplay(): void {
    if (!this.replay.peek()) return;
    this.replay.value = null;
    this.simRev.value++;
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  goTo(index: number): void {
    if (index < 0 || index >= this.lab.steps.length) return;
    if (index > this.progress.maxStep + 1) return;
    if (index === this.progress.maxStep + 1 && !this.stepComplete(this.progress.maxStep)) return;
    this.enterStep(index);
  }

  private enterStep(index: number): void {
    const p = this.progress;
    const firstVisit = index > p.maxStep || p.stepStart[this.lab.steps[index].id] === undefined;
    p.step = index;
    p.maxStep = Math.max(p.maxStep, index);
    const step = this.step;
    // Each step starts with no display filter, so an old one can't hide the new step's packets.
    this.captureFilter.value = '';
    if (p.stepStart[step.id] === undefined) p.stepStart[step.id] = this.sim.t;
    if (step.setup && !p.actions.some((x) => x.a.type === 'setup' && x.a.step === step.id)) {
      this.dispatch({ type: 'setup', step: step.id });
    }
    touch(p, firstVisit ? { kind: 'step', id: step.id } : undefined);
    this.checkGoals({ type: 'ui:enter-step', step: step.id });
    this.bump();
  }

  /**
   * The tools the step on screen offers. Nothing carries over: a step lists
   * every tool it needs, including ones an earlier step introduced, so a tool
   * is only in reach while it's the point. Tabs (TAB_TOOLS, the Logs tab) are
   * the exception: they only show evidence, so once a step opens one it stays.
   */
  get tools(): ToolSpec[] {
    const own = this.lab.steps[this.progress.step].tools ?? [];
    const keys = new Set(own.map(toolKey));
    const tabs = this.introduced().filter((t) => (TAB_TOOLS as readonly string[]).includes(t.kind) && !keys.has(toolKey(t)));
    return [...own, ...tabs];
  }

  /**
   * Every tool the lesson has handed out up to the furthest step reached (the
   * latest listing of a tool wins). For showing a setting read-only once the
   * lesson has introduced it, after the step that let the student change it.
   */
  introduced(): ToolSpec[] {
    const byKey = new Map<string, ToolSpec>();
    for (let i = 0; i <= this.progress.maxStep; i++) {
      for (const t of this.lab.steps[i].tools ?? []) byKey.set(toolKey(t), t);
    }
    return [...byKey.values()];
  }

  // ---------------------------------------------------------------------------
  // Goals
  // ---------------------------------------------------------------------------

  goalDone(stepId: string, goalId: string): boolean {
    return !!this.progress.goals[goalKey(stepId, goalId)];
  }

  ui(ev: UiEvent): void {
    this.checkGoals(ev);
  }

  private onSimEvent(ev: SimEvent): void {
    this.simDirty = true;
    if (!this.holdGoals) this.checkGoals(ev);
  }

  /** Called by the player once per animation frame. */
  consumeSimDirty(): boolean {
    const d = this.simDirty;
    this.simDirty = false;
    return d;
  }

  private checkGoals(ev?: AnyEvent): void {
    const step = this.step;
    if (!step.goals?.length) return;
    let changed = false;
    for (const g of step.goals) {
      const key = goalKey(step.id, g.id);
      if (this.progress.goals[key]) continue;
      let ok = false;
      try {
        ok = g.check({ sim: this.sim, ev, since: this.since });
      } catch (e) {
        console.warn(`Goal ${key} check threw`, e);
      }
      if (ok) {
        this.progress.goals[key] = Date.now();
        touch(this.progress, { kind: 'goal', id: key });
        this.justCompleted.value = [...this.justCompleted.value, key];
        setTimeout(() => (this.justCompleted.value = this.justCompleted.value.filter((k) => k !== key)), 2500);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  // ---------------------------------------------------------------------------
  // Demos (lessons with no network; see src/demos)
  // ---------------------------------------------------------------------------

  /** The demo `id` in step `stepId` (the step on screen by default). */
  demoSpec(id: string, stepId = this.step.id): DemoSpec | undefined {
    return this.lab.steps.find((s) => s.id === stepId)?.demos?.find((d) => d.id === id);
  }

  /** A demo's saved state, or its starting state if the student hasn't touched it. */
  demoState<S = unknown>(spec: DemoSpec, stepId = this.step.id): S {
    const saved = this.progress.demos?.[`${stepId}/${spec.id}`];
    return (saved ?? this.demoStart(spec)) as S;
  }

  /** How a demo starts: from scratch, or from the student's work in an earlier step. */
  private demoStart(spec: DemoSpec): unknown {
    const model = demoModel(spec);
    if (!model.start) return model.init(spec);
    return model.start(spec, (step, demo) => {
      const earlier = this.demoSpec(demo, step);
      return earlier && this.demoState(earlier, step);
    });
  }

  /**
   * The student did something to demo `id` on the step on screen. Saves the
   * new state and checks the step's goals against the demo's facts.
   */
  demo(id: string, input: DemoInput): void {
    const spec = this.demoSpec(id);
    if (!spec) return;
    const model = demoModel(spec);
    const before = this.demoState(spec);
    const after = model.apply(spec, before, input);
    if (after === before) return;
    this.saveDemo(spec, after);
  }

  /** Put demo `id` back the way the step starts it. Goals already reached stay reached. */
  resetDemo(id: string): void {
    const spec = this.demoSpec(id);
    if (!spec || isStatic(spec) || !this.progress.demos?.[`${this.step.id}/${id}`]) return;
    this.saveDemo(spec, this.demoStart(spec));
  }

  private saveDemo(spec: DemoSpec, state: unknown): void {
    const step = this.step;
    (this.progress.demos ??= {})[`${step.id}/${spec.id}`] = state;
    touch(this.progress);
    this.checkGoals({ type: 'ui:demo', step: step.id, demo: spec.id, facts: demoModel(spec).facts(spec, state) });
    this.bump();
  }

  // ---------------------------------------------------------------------------
  // Questions
  // ---------------------------------------------------------------------------

  answer(stepId: string, qId: string): Answer | undefined {
    return this.progress.answers[answerKey(stepId, qId)];
  }

  /** Another answer's current text, for a question's `verify`. */
  readonly answerText = (stepId: string, qId: string): string => this.answer(stepId, qId)?.value.trim() ?? '';

  /** Save a draft without grading (typing in a text box). */
  setDraft(stepId: string, q: QuestionDef, value: string): void {
    const key = answerKey(stepId, q.id);
    const prev = this.progress.answers[key];
    const next: Answer = { ...prev, attempts: prev?.attempts ?? 0, value, updatedAt: Date.now() };
    // Editing an auto-checked answer clears its old verdict.
    if (q.kind === 'text' && q.expect && prev?.value !== value) next.correct = undefined;
    if (q.kind === 'choice' && prev?.value !== value) next.correct = undefined;
    this.progress.answers[key] = next;
    touch(this.progress);
    this.bump();
  }

  /** Grade a choice or auto-checked text answer. Returns whether it was right. */
  check(stepId: string, q: QuestionDef): boolean {
    const key = answerKey(stepId, q.id);
    const a = this.progress.answers[key] ?? { value: '', attempts: 0, updatedAt: Date.now() };
    let correct = false;
    if (q.kind === 'choice') {
      const picked = new Set(a.value.split(',').filter(Boolean));
      const right = new Set(q.options.filter((o) => o.correct).map((o) => o.id));
      correct = picked.size === right.size && [...picked].every((id) => right.has(id));
    } else if (q.expect) {
      correct = textCorrect(q, a.value, this.answerText);
    } else {
      correct = a.value.trim().length > 0;
    }
    const next: Answer = { ...a, attempts: a.attempts + 1, correct, updatedAt: Date.now() };
    if (!correct && q.kind === 'text' && q.expect && wrongMatch(q, a.value)?.format) next.formatSlips = (a.formatSlips ?? 0) + 1;
    if (correct && next.rightAfter === undefined) next.rightAfter = next.attempts - (next.formatSlips ?? 0);
    this.progress.answers[key] = next;
    if (q.kind === 'text') this.regradeSiblings(stepId, q.id);
    touch(this.progress, { kind: 'answer', id: `${key}:${correct ? 'right' : 'wrong'}` });
    this.bump();
    return correct;
  }

  /**
   * A checked text answer whose `verify` reads other answers can turn right or
   * wrong when one of them is checked. Re-grade the step's other checked
   * answers, so no box keeps a Correct! that its neighbors now contradict, and
   * the report counts tries against the box that was really off. A re-grade
   * isn't a try.
   */
  private regradeSiblings(stepId: string, qId: string): void {
    const step = this.lab.steps.find((s) => s.id === stepId);
    for (const other of step?.questions ?? []) {
      if (other.id === qId || other.kind !== 'text' || !other.expect || !other.verify) continue;
      const key = answerKey(stepId, other.id);
      const a = this.progress.answers[key];
      if (!a || a.correct === undefined) continue;
      const now = textCorrect(other, a.value, this.answerText);
      if (now === a.correct) continue;
      const next: Answer = { ...a, correct: now };
      if (now) next.rightAfter ??= a.attempts - (a.formatSlips ?? 0);
      else delete next.rightAfter;
      this.progress.answers[key] = next;
    }
  }

  questionDone(stepId: string, q: QuestionDef): boolean {
    return questionDone(q, this.answer(stepId, q.id));
  }

  // ---------------------------------------------------------------------------
  // Completion
  // ---------------------------------------------------------------------------

  missing(index = this.progress.step): string[] {
    const step = this.lab.steps[index];
    const out: string[] = [];
    const goalsLeft = (step.goals ?? []).filter((g) => !this.goalDone(step.id, g.id)).length;
    if (goalsLeft) out.push(`${goalsLeft} goal${goalsLeft > 1 ? 's' : ''}`);
    const qsLeft = (step.questions ?? []).filter((q) => !this.questionDone(step.id, q)).length;
    if (qsLeft) out.push(`${qsLeft} question${qsLeft > 1 ? 's' : ''}`);
    return out;
  }

  /** Done, or skipped with an override. Either one opens the next step. */
  stepComplete(index: number): boolean {
    return this.missing(index).length === 0 || this.overridden(index);
  }

  // ---------------------------------------------------------------------------
  // Override: skip a step without finishing it
  // ---------------------------------------------------------------------------

  /** Skipped with an override and still unfinished. Finishing the step later clears this. */
  overridden(index = this.progress.step): boolean {
    const step = this.lab.steps[index];
    return !!this.progress.overrides?.[step.id] && !stepFinished(step, this.progress);
  }

  /** Counts a click on Continue while the step is unfinished. True when the clicks in a row reach SKIP_CLICKS. */
  blockedClick(now = Date.now()): boolean {
    this.blockedClicks = now - this.lastBlockedClick <= SKIP_CLICK_GAP_MS ? this.blockedClicks + 1 : 1;
    this.lastBlockedClick = now;
    if (this.blockedClicks < SKIP_CLICKS) return false;
    this.blockedClicks = 0;
    return true;
  }

  /** Skip the current step. It earns no credit for unfinished work, and the report shows it with the student's reason. */
  skipStep(note: string, now = Date.now()): void {
    const p = this.progress;
    const step = this.step;
    p.overrides = { ...p.overrides, [step.id]: { at: now, note: note.trim() || undefined } };
    touch(p, { kind: 'override', id: step.id });
    this.goTo(p.step + 1);
  }

  markSubmitted(): void {
    this.progress.submittedAt = Date.now();
    this.progress.submitCount = (this.progress.submitCount ?? 0) + 1;
    touch(this.progress, { kind: 'submit', id: this.lab.id });
    this.bump();
  }

  bump(): void {
    this.rev.value++;
  }

  dispose(): void {
    this.unsub?.();
  }
}
