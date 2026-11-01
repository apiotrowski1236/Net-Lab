import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import { goalKey, type ChoiceQuestion, type QuestionDef, type StepDef, type TextQuestion } from '../labs/types';
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
  const feedback = wrong
    ? q.options
        .filter((o) => picked.has(o.id) && o.feedback && !o.correct)
        .map((o) => o.feedback)
        .join(' ')
    : '';
  return (
    <div class={`qcard ${done ? 'correct' : wrong ? 'wrong' : ''}`}>
      <div class="qprompt">
        <Prose src={q.prompt} labels={labels} onDevice={onDevice} />
        {q.multi && <div class="muted small">Choose all that apply.</div>}
      </div>
      <div class="options" role={q.multi ? 'group' : 'radiogroup'}>
        {options.map((o) => {
          const isPicked = picked.has(o.id);
          return (
            <button
              key={o.id}
              class={`option ${isPicked ? 'picked' : ''} ${done && isPicked ? 'right' : ''} ${wrong && isPicked ? 'nope' : ''}`}
              role={q.multi ? 'checkbox' : 'radio'}
              aria-checked={isPicked}
              onClick={() => pick(o.id)}
            >
              <span class={`opt-mark ${q.multi ? 'square' : ''}`}>{isPicked ? <Icon name="check" size={14} /> : null}</span>
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
      {wrong && <div class="qfeedback bad">{feedback || 'Not quite. Look at the network again, then pick another answer.'}</div>}
      {done && (
        <div class="qfeedback good">
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
          <span class={q.minWords && words < q.minWords ? 'muted' : 'ok'}>
            {words} word{words === 1 ? '' : 's'}
            {q.minWords ? ` · aim for ${q.minWords}+` : ''}
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

        {step.questions?.map((q) => <QuestionCard key={`${step.id}/${q.id}`} session={session} step={step} q={q} labels={labels} onDevice={onDevice} />)}

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
            class={`btn primary big ${canContinue ? 'ready' : ''}`}
            disabled={!canContinue}
            onClick={() => session.goTo(p.step + 1)}
            title={canContinue ? '' : `Still to do: ${missing.join(', ')}`}
          >
            {canContinue ? 'Continue' : `Finish ${missing.join(' and ')}`} {canContinue && <Icon name="chevronRight" />}
          </button>
        )}
      </div>
    </aside>
  );
}
