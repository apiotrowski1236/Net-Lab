import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import { goalKey, type ChoiceQuestion, type QuestionDef, type StepDef, type TextQuestion } from '../labs/types';
import type { SimEvent } from '../sim/types';
import { pingFailText } from './describe';
import { Icon } from './icons';
import { renderMarkdown } from './markdown';
import { shuffledOptions } from '../labs/shuffle';
import { hoverDevice } from './NetworkCanvas';
import { overrideEnabled } from '../store/override';
import { OverrideDialog } from './Override';

// ---------------------------------------------------------------------------
// Markdown body with device chips
// ---------------------------------------------------------------------------

function Prose({ src, labels, onDevice }: { src: string; labels: Record<string, string>; onDevice: (id: string) => void }) {
  const html = useMemo(() => renderMarkdown(src, labels), [src, labels]);
  return (
    <div
      class="prose"
      dangerouslySetInnerHTML={{ __html: html }}
      onMouseOver={(e) => {
        const chip = (e.target as HTMLElement).closest?.('.chip') as HTMLElement | null;
        hoverDevice.value = chip?.dataset.device ?? null;
      }}
      onMouseLeave={() => (hoverDevice.value = null)}
      onClick={(e) => {
        const chip = (e.target as HTMLElement).closest?.('.chip') as HTMLElement | null;
        if (chip?.dataset.device) onDevice(chip.dataset.device);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function ChoiceCard({ session, step, q, labels, onDevice }: { session: LabSession; step: StepDef; q: ChoiceQuestion; labels: Record<string, string>; onDevice: (id: string) => void }) {
  const a = session.answer(step.id, q.id);
  const picked = new Set((a?.value ?? '').split(',').filter(Boolean));
  const options = useMemo(() => shuffledOptions(session.lab.id, step.id, q), [session.lab.id, step.id, q]);
  const done = !!a?.correct;
  const wrong = a?.correct === false;
  // Picking a different option clears the old verdict, so students can change
  // their answer at any time (even after it was marked correct).
  const pick = (id: string) => {
    const next = new Set(q.multi ? picked : []);
    if (q.multi && next.has(id)) next.delete(id);
    else next.add(id);
    session.setDraft(step.id, q, [...next].join(','));
  };
  const wrongPicks = q.options.filter((o) => picked.has(o.id) && !o.correct);
  const feedback = !wrong
    ? ''
    : wrongPicks.length
      ? wrongPicks
          .filter((o) => o.feedback)
          .map((o) => (q.multi && wrongPicks.length > 1 ? `"${o.text}": ${o.feedback}` : o.feedback))
          .join(' ')
      : 'Everything you picked is right, but something is missing. Pick every answer that applies.';
  // After a check, bring the verdict into view (it can land below the fold). Not when revisiting a step.
  const fb = useRef<HTMLDivElement>(null);
  const checks = useRef(a?.attempts);
  useEffect(() => {
    if (a?.attempts === checks.current) return;
    checks.current = a?.attempts;
    fb.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [a?.attempts]);
  return (
    <div class={`qcard ${done ? 'correct' : wrong ? 'wrong' : ''}`}>
      <div class="qprompt">
        <Prose src={q.prompt} labels={labels} onDevice={onDevice} />
        {q.multi && <div class="muted small">Choose all that apply.</div>}
      </div>
      <div class="options" role={q.multi ? 'group' : 'radiogroup'}>
        {options.map((o) => {
          const isPicked = picked.has(o.id);
          // After a wrong check, mark only the picks that are wrong.
          const nope = wrong && isPicked && !o.correct;
          return (
            <button
              key={o.id}
              class={`option ${isPicked ? 'picked' : ''} ${done && isPicked ? 'right' : ''} ${nope ? 'nope' : ''}`}
              role={q.multi ? 'checkbox' : 'radio'}
              aria-checked={isPicked}
              onClick={() => pick(o.id)}
            >
              <span class={`opt-mark ${q.multi ? 'square' : ''}`}>{isPicked ? <Icon name={nope ? 'x' : 'check'} size={14} /> : null}</span>
              <span>{o.text}</span>
            </button>
          );
        })}
      </div>
      {!done && (
        <div class="qactions">
          <button class="btn primary" disabled={picked.size === 0 || wrong} onClick={() => session.check(step.id, q)}>
            Check
          </button>
          {a?.value && a.correct === undefined && (a.attempts ?? 0) > 0 && <span class="muted small">Changed. Check again.</span>}
        </div>
      )}
      {wrong && <div class="qfeedback bad" ref={fb}>{feedback || 'Not quite. Look at the network again, then pick another answer.'}</div>}
      {done && (
        <div class="qfeedback good" ref={fb}>
          <strong>Correct!</strong> {q.explain}
          <div class="muted small change-note">You can still change your answer.</div>
        </div>
      )}
    </div>
  );
}

function TextCard({ session, step, q, labels, onDevice }: { session: LabSession; step: StepDef; q: TextQuestion; labels: Record<string, string>; onDevice: (id: string) => void }) {
  const a = session.answer(step.id, q.id);
  const [value, setValue] = useState(a?.value ?? '');
  useEffect(() => setValue(a?.value ?? ''), [step.id, q.id]);
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const auto = !!q.expect;
  const done = auto ? !!a?.correct : words > 0;
  const wrong = auto && a?.correct === false;
  return (
    <div class={`qcard ${auto && done ? 'correct' : wrong ? 'wrong' : ''}`}>
      <div class="qprompt">
        <Prose src={q.prompt} labels={labels} onDevice={onDevice} />
      </div>
      <textarea
        class={auto && done ? 'mono' : ''}
        rows={q.lines ?? (auto ? 1 : 4)}
        placeholder={q.placeholder ?? (auto ? 'Type your answer' : 'Write in complete sentences. Your work saves as you type.')}
        value={value}
        onInput={(e) => {
          const v = (e.target as HTMLTextAreaElement).value;
          setValue(v);
          session.setDraft(step.id, q, v);
        }}
        onKeyDown={(e) => {
          if (auto && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !done) session.check(step.id, q);
          }
        }}
        spellcheck={!auto}
      />
      {!auto && (
        <div class="qmeta">
          <span class={q.minWords && words < q.minWords ? (words ? 'warn' : 'muted') : 'ok'}>
            {words} word{words === 1 ? '' : 's'}
            {q.minWords ? (words && words < q.minWords ? ` · a bit short: your teacher is looking for ${q.minWords}+` : ` · aim for ${q.minWords}+`) : ''}
          </span>
          <span class="muted">Teacher-graded</span>
        </div>
      )}
      {auto && !done && (
        <div class="qactions">
          <button class="btn primary" disabled={!value.trim() || wrong} onClick={() => session.check(step.id, q)}>
            Check
          </button>
        </div>
      )}
      {wrong && <div class="qfeedback bad">{q.expectHint ?? 'Not quite. Change your answer and check again.'}</div>}
      {auto && done && (
        <div class="qfeedback good">
          <strong>Correct!</strong> {q.explain}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// What the step's buttons did
// ---------------------------------------------------------------------------

/** The result of the lesson button pressed last: the ping's answer or the page's result, so nobody has to catch it on the map. */
type Drop = Extract<SimEvent, { type: 'drop' }>;

/** The drop carried part of the web request `reqId` to or from one of `ips`. */
function webTraffic(e: Drop, reqId: number, ips: (string | undefined)[]): boolean {
  const app = e.pkt?.app;
  if (!app || (app.kind !== 'http-req' && app.kind !== 'http-res') || app.reqId !== reqId) return false;
  return ips.includes(app.kind === 'http-req' ? e.pkt!.src : e.pkt!.dst);
}

function dropText(sim: LabSession['sim'], e: Drop): string {
  const at = sim.devices[e.device]?.label ?? e.device;
  const what = e.pkt?.app.kind === 'http-res' ? 'reply' : 'request';
  const dst = e.pkt?.dst;
  switch (e.reason) {
    case 'no-route':
      return `${at} has no route to ${dst}, so it dropped the ${what}.`;
    case 'arp-timeout':
      return `${at} asked "Who has ${e.nextHop ?? dst}?" and nobody answered, so it dropped the ${what}.`;
    case 'ttl':
      return `The ${what} went around in a loop until its TTL ran out at ${at}.`;
    default:
      return `${at} dropped the ${what}.`;
  }
}

function ActionOutcome({ session, step }: { session: LabSession; step: StepDef }) {
  // Shows live network state: re-render whenever the network changes.
  void session.simRev.value;
  const run = session.lastRun.value;
  const list = useRef<HTMLUListElement>(null);
  // Bring a new result into view: the button may sit near the bottom of the panel.
  useEffect(() => list.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [run?.t, run?.action]);
  if (!run || run.step !== step.id) return null;
  const sim = session.sim;
  const lines: { tone: 'good' | 'bad' | 'wait'; text: string }[] = [];
  const sent: Extract<SimEvent, { type: 'ping-sent' }>[] = [];
  const drops: Drop[] = [];
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t >= run.t; i--) {
    const e = sim.events[i];
    if (e.type === 'ping-sent') sent.unshift(e);
    else if (e.type === 'drop') drops.unshift(e);
  }
  for (const p of sent) {
    const end = sim.events.find((e) => (e.type === 'ping-reply' || e.type === 'ping-fail') && e.seq === p.seq);
    if (!end) lines.push({ tone: 'wait', text: 'Waiting for a reply…' });
    else if (end.type === 'ping-reply') lines.push({ tone: 'good', text: `Reply from ${sim.deviceByIp(end.from)?.label ?? end.from}.` });
    else if (end.type === 'ping-fail') lines.push({ tone: 'bad', text: pingFailText(sim, end) });
  }
  for (const d of Object.values(sim.devices)) {
    const b = d.browser;
    if (!b || b.startedAt < run.t) continue;
    const who = `${d.label}'s browser:`;
    // A request or reply lost on the way: say where, or the browser just looks slow.
    const lost = drops.find((e) => e.device !== d.id && webTraffic(e, b.reqId, d.ifaces.map((i) => i.ip)));
    if (lost && (b.status === 'resolving' || b.status === 'loading')) lines.push({ tone: 'bad', text: `${who} still loading. ${dropText(sim, lost)}` });
    else if (b.status === 'resolving' || b.status === 'loading') lines.push({ tone: 'wait', text: `${who} loading…` });
    else if (b.status === 'loaded') lines.push({ tone: 'good', text: `${who} loaded "${b.title}".` });
    else lines.push({ tone: 'bad', text: `${who} ${b.error ?? 'no connection.'}` });
  }
  if (!lines.length) return null;
  const label = step.actions?.find((a) => a.id === run.action)?.label;
  return (
    <ul class="action-outcome" aria-live="polite" ref={list}>
      {label && <li class="outcome-head">{label}</li>}
      {lines.map((l, i) => (
        <li key={i} class={l.tone}>
          <Icon name={l.tone === 'good' ? 'check' : l.tone === 'bad' ? 'x' : 'ping'} size={14} />
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

function QuestionCard(props: { session: LabSession; step: StepDef; q: QuestionDef; labels: Record<string, string>; onDevice: (id: string) => void }) {
  return props.q.kind === 'choice' ? <ChoiceCard {...props} q={props.q} /> : <TextCard {...props} q={props.q} />;
}

// ---------------------------------------------------------------------------
// Step outline
// ---------------------------------------------------------------------------

function Outline({ session, onClose }: { session: LabSession; onClose: () => void }) {
  const p = session.progress;
  return (
    <div class="outline" role="dialog" aria-label="All steps">
      <ol>
        {session.lab.steps.map((s, i) => {
          const reachable = i <= p.maxStep;
          const overridden = session.overridden(i);
          const complete = session.missing(i).length === 0 && i < p.maxStep;
          return (
            <li key={s.id}>
              <button
                class={`outline-item ${i === p.step ? 'current' : ''}`}
                disabled={!reachable}
                onClick={() => {
                  session.goTo(i);
                  onClose();
                }}
              >
                <span class={`outline-dot ${complete ? 'done' : overridden ? 'override' : reachable ? 'open' : ''}`}>
                  {complete ? <Icon name="check" size={12} /> : overridden ? <Icon name="unlock" size={12} /> : i + 1}
                </span>
                <span>{s.title}</span>
                {overridden && <span class="pill warn tiny">teacher override</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lesson panel
// ---------------------------------------------------------------------------

export function LessonPanel({ session, onDevice }: { session: LabSession; onDevice: (id: string) => void }) {
  void session.rev.value; // re-render when the session changes
  const just = session.justCompleted.value;
  const p = session.progress;
  const step = session.step;
  const total = session.lab.steps.length;
  const [outline, setOutline] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of Object.values(session.sim.devices)) out[d.id] = d.label;
    return out;
  }, [session.sim]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [step.id]);

  const missing = session.missing();
  const overridden = session.overridden();
  const canContinue = session.stepComplete(p.step);
  // A teacher override opens the step's questions too.
  const goalsDone = !!overridden || (step.goals ?? []).every((g) => session.goalDone(step.id, g.id));
  // When the goals finish, move toward the question they unlocked: it can sit below the fold.
  // Keep the action's result in view on the way, since the question asks about it.
  const unlockedAt = useRef({ step: step.id, done: goalsDone });
  useEffect(() => {
    const was = unlockedAt.current;
    unlockedAt.current = { step: step.id, done: goalsDone };
    if (was.step !== step.id || was.done || !goalsDone) return;
    const i = step.questions?.findIndex((q) => q.afterGoals) ?? -1;
    const el = scroller.current;
    if (i < 0 || !el) return;
    const result = el.querySelector('.action-outcome');
    if (result) result.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else el.querySelectorAll('.qcard')[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [step.id, goalsDone]);
  // The "Finish …" button shows what's left: the first unfinished goal or question, which may be below the fold.
  const showWhatsLeft = () => {
    const el = scroller.current;
    if (!el) return;
    const g = (step.goals ?? []).findIndex((x) => !session.goalDone(step.id, x.id));
    const q = (step.questions ?? []).findIndex((x) => !session.questionDone(step.id, x));
    const target = g >= 0 ? el.querySelectorAll('.goal')[g] : q >= 0 ? el.querySelectorAll('.qcard')[q] : null;
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.remove('nudge');
    void (target as HTMLElement).offsetWidth;
    target.classList.add('nudge');
  };
  const reviewing = p.step < p.maxStep;
  const isLast = p.step === total - 1;
  const prev = p.step > 0 ? session.lab.steps[p.step - 1] : undefined;
  const replayingThis = session.replay.value?.stepIndex;

  return (
    <aside class="lesson">
      <div class="lesson-head">
        <button class="step-pill" onClick={() => setOutline(!outline)} aria-expanded={outline}>
          Step {p.step + 1} of {total} <Icon name="chevronDown" size={14} />
        </button>
        <div class="step-dots" aria-hidden="true">
          {session.lab.steps.map((s, i) => (
            <span key={s.id} class={`sdot ${i === p.step ? 'cur' : i < p.maxStep || (i === p.maxStep && session.stepComplete(i)) ? 'done' : i <= p.maxStep ? 'open' : ''}`} />
          ))}
        </div>
        <a class="btn ghost small guide-link" href={`#/guide/${session.lab.id}`} target="_blank" rel="noopener" title="Every step on one page, for notes or printing">
          <Icon name="book" size={14} /> Guide
        </a>
        {outline && <Outline session={session} onClose={() => setOutline(false)} />}
      </div>

      <div class="lesson-scroll" ref={scroller}>
        {session.replayWarning && <div class="callout warn small">{session.replayWarning}</div>}
        {reviewing && (
          <div class="callout info small review-banner">
            You're reviewing an earlier step. The network stays the way you left it.
            <div class="row gap-sm">
              {session.canReplay(p.step) && (
                <button class="btn tiny" onClick={() => session.startReplay(p.step)} disabled={replayingThis === p.step}>
                  <Icon name="replay" size={12} /> Watch this step again
                </button>
              )}
              <button class="btn tiny" onClick={() => session.goTo(p.maxStep)}>
                Back to step {p.maxStep + 1}
              </button>
            </div>
          </div>
        )}
        {overridden && (
          <div class="callout warn small">
            <Icon name="unlock" size={14} /> Your teacher unlocked this step with an override. Your report shows that. You can still finish the goals and questions.
          </div>
        )}
        {prev && !reviewing && step.kind !== 'submit' && (
          <div class="refresher">
            <span class="refresher-text">
              Builds on step {p.step}: <strong>{prev.title}</strong>
            </span>
            <span class="row gap-sm">
              <button class="btn tiny ghost" onClick={() => session.goTo(p.step - 1)}>
                <Icon name="chevronLeft" size={12} /> Reread
              </button>
              {session.canReplay(p.step - 1) && (
                <button class="btn tiny ghost" onClick={() => session.startReplay(p.step - 1)} disabled={replayingThis === p.step - 1}>
                  <Icon name="replay" size={12} /> Watch again
                </button>
              )}
            </span>
          </div>
        )}
        <h2 class="step-title">{step.title}</h2>
        <Prose src={step.body} labels={labels} onDevice={onDevice} />

        {step.actions && step.actions.length > 0 && (
          <div class="actions">
            {step.actions.map((a) => (
              <button key={a.id} class="btn action" onClick={() => session.runStepAction(a.id)}>
                <Icon name="play" size={14} /> {a.label}
              </button>
            ))}
          </div>
        )}
        {step.actions && step.actions.length > 0 && <ActionOutcome session={session} step={step} />}

        {step.goals && step.goals.length > 0 && (
          <div class="goals">
            <div class="goals-title">
              <Icon name="flag" size={14} /> Goals
            </div>
            <ul>
              {step.goals.map((g) => {
                const done = session.goalDone(step.id, g.id);
                const fresh = just.includes(goalKey(step.id, g.id));
                return (
                  <li key={g.id} class={`goal ${done ? 'done' : ''} ${fresh ? 'fresh' : ''}`}>
                    <span class="goal-box">{done && <Icon name="check" size={14} />}</span>
                    <span class="goal-text">
                      <Prose src={g.label} labels={labels} onDevice={onDevice} />
                      {!done && g.hint && (
                        <details class="hint">
                          <summary>
                            <Icon name="hint" size={13} /> Hint
                          </summary>
                          <Prose src={g.hint} labels={labels} onDevice={onDevice} />
                        </details>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {step.questions?.map((q) =>
          q.afterGoals && !goalsDone ? (
            <div key={`${step.id}/${q.id}`} class="qcard locked">
              <Icon name="lock" size={14} /> A question about what happens unlocks when you finish the goals above.
            </div>
          ) : (
            <QuestionCard key={`${step.id}/${q.id}`} session={session} step={step} q={q} labels={labels} onDevice={onDevice} />
          ),
        )}

        {step.kind === 'submit' && (
          <div class="callout info small">
            <Icon name="trophy" size={14} /> Your summary is on the right. Submit or download it from there.
          </div>
        )}

        {!canContinue && step.kind !== 'submit' && overrideEnabled() && (
          <div class="override-row">
            <button class="link-btn" onClick={() => setOverrideOpen(true)}>
              <Icon name="unlock" size={12} /> Teacher override
            </button>
          </div>
        )}
      </div>
      {overrideOpen && <OverrideDialog session={session} onClose={() => setOverrideOpen(false)} />}

      <div class="lesson-nav">
        <button class="btn ghost" disabled={p.step === 0} onClick={() => session.goTo(p.step - 1)}>
          <Icon name="chevronLeft" /> Back
        </button>
        {!isLast && (
          <button
            class={`btn primary big ${canContinue ? 'ready' : 'todo'}`}
            aria-disabled={!canContinue}
            onClick={() => (canContinue ? session.goTo(p.step + 1) : showWhatsLeft())}
            title={canContinue ? '' : `Still to do: ${missing.join(', ')}. Click to see what's left.`}
          >
            {canContinue ? 'Continue' : `Finish ${missing.join(' and ')}`} {canContinue && <Icon name="chevronRight" />}
          </button>
        )}
      </div>
    </aside>
  );
}
