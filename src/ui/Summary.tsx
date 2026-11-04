import { useMemo } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import { hasEndpoint } from '../store/outbox';
import { profile } from '../store/profile';
import { buildReport } from '../store/report';
import { Icon } from './icons';
import { gradeText, handInWhere, SubmitBox } from './Submit';

const CONFETTI = ['var(--brand)', 'var(--good)', 'var(--warn)', 'var(--info)', 'var(--bad)'];

function Confetti() {
  // Fixed positions so it looks the same every time (and on every re-render).
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 7) * 0.12,
        color: CONFETTI[i % CONFETTI.length],
        spin: (i * 53) % 360,
      })),
    [],
  );
  return (
    <div class="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span key={i} style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, background: p.color, transform: `rotate(${p.spin}deg)` }} />
      ))}
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <svg class="ring" viewBox="0 0 100 100" role="img" aria-label={`${pct} percent complete`}>
      <circle cx={50} cy={50} r={r} class="ring-track" />
      <circle cx={50} cy={50} r={r} class="ring-fill" stroke-dasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 50 50)" />
      <text x={50} y={50} class="ring-num">
        {pct}%
      </text>
      <text x={50} y={67} class="ring-label">
        complete
      </text>
    </svg>
  );
}

/** The submit step: a summary of the whole lab, with Submit and Download. */
export function Summary({ session }: { session: LabSession }) {
  void session.rev.value;
  const lab = session.lab;
  const p = session.progress;
  const report = buildReport(lab, p, profile.value, p.submittedAt ? 'submitted' : 'in-progress');

  const all = lab.steps.map((s, i) => ({ s, i, missing: session.missing(i), overridden: session.overridden(i) })).filter((x) => x.s.kind !== 'submit');
  // Extra-credit steps are listed, but never count as unfinished or toward the percent.
  const steps = all.filter((x) => !x.s.extra);
  const extraSteps = all.filter((x) => x.s.extra);
  const unfinished = steps.filter((x) => x.missing.length > 0);
  const allDone = unfinished.length === 0;

  const goals = report.goals.filter((g) => !g.extra);
  const questions = report.questions.filter((q) => !q.extra);
  const goalsDone = goals.filter((g) => g.done).length;
  const auto = questions.filter((q) => q.autoGraded);
  const written = questions.filter((q) => !q.autoGraded);
  const writtenDone = written.filter((q) => q.answer.trim()).length;
  const totalItems = goals.length + questions.length;
  const doneItems = goalsDone + auto.filter((q) => q.correct).length + writtenDone;
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 100;

  const endpoint = hasEndpoint();
  const title = p.submittedAt ? (endpoint ? 'Submitted. Nice work!' : "Nice work! Don't forget to hand in your report.") : allDone ? 'Lab complete!' : 'Almost there';
  const message = allDone
    ? `You finished every step of ${lab.title}${/[.?!]$/.test(lab.title) ? '' : '.'} ${p.submittedAt && !endpoint ? `Take the report file you downloaded and ${handInWhere()}.` : endpoint ? 'Submit it to your teacher below.' : `Download your report below, then ${handInWhere()}.`}`
    : `${unfinished.length} step${unfinished.length > 1 ? 's' : ''} still ${unfinished.length > 1 ? 'have' : 'has'} unfinished work. Go back and finish, or ${endpoint ? 'submit' : 'download'} what you have.`;

  let qn = 0;
  return (
    <div class="summary">
      <header class={`summary-hero ${allDone ? 'complete' : ''}`}>
        {allDone && <Confetti />}
        <Ring pct={pct} />
        <div class="summary-hero-text">
          <div class="eyebrow">
            <Icon name="trophy" size={14} /> {lab.title}
          </div>
          <h1>{title}</h1>
          <p>{message}</p>
        </div>
      </header>

      <div class="summary-stats">
        <div class="sstat">
          <div class="sstat-num">
            {goalsDone}
            <span>/{goals.length}</span>
          </div>
          <div class="sstat-label">goals reached</div>
        </div>
        <div class="sstat">
          <div class="sstat-num">
            {report.score.auto}
            <span>/{report.score.autoMax}</span>
          </div>
          <div class="sstat-label">auto-checked points</div>
        </div>
        <div class="sstat">
          <div class="sstat-num">
            {writtenDone}
            <span>/{written.length}</span>
          </div>
          <div class="sstat-label">written answers for your teacher</div>
        </div>
        <div class="sstat">
          <div class="sstat-num">{report.activeMinutes}</div>
          <div class="sstat-label">minutes of work</div>
        </div>
      </div>

      <section class="summary-card hand-in">
        <h3>
          <Icon name="send" /> Hand it in
        </h3>
        <SubmitBox session={session} />
      </section>

      {extraSteps.length > 0 && (
        <section class="summary-card">
          <h3>
            <Icon name="trophy" /> Extra credit
          </h3>
          <p class="muted small">
            {extraSteps.length} optional step{extraSteps.length > 1 ? 's' : ''} after this one. Hand in your work first, then try {extraSteps.length > 1 ? 'them' : 'it'}. When you finish, hand in again so your teacher sees your extra credit.
          </p>
          <div class="row gap-sm wrap extra-row">
            {report.score.extraMax ? (
              <span class="pill">
                {report.score.extra} / {report.score.extraMax} extra credit points
              </span>
            ) : null}
            <button class="btn small" onClick={() => session.goTo(extraSteps[0].i)}>
              Go to extra credit <Icon name="chevronRight" size={14} />
            </button>
          </div>
        </section>
      )}

      {lab.objectives.length > 0 && (
        <section class="summary-card">
          <h3>
            <Icon name="flag" /> What you practiced
          </h3>
          <ul class="summary-skills">
            {lab.objectives.map((o) => (
              <li key={o}>
                <Icon name="check" size={14} /> {o}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="summary-card">
        <h3>
          <Icon name="list" /> Step by step
        </h3>
        <ol class="summary-steps">
          {all.map(({ s, i, missing, overridden }) => {
            const done = missing.length === 0;
            return (
              <li key={s.id} class={done ? 'done' : overridden ? 'override' : s.extra ? 'optional' : 'todo'}>
                <span class="sstep-dot">{done ? <Icon name="check" size={12} /> : overridden ? <Icon name="unlock" size={12} /> : i + 1}</span>
                <span class="sstep-title">{s.title}</span>
                {overridden && <span class="pill warn tiny">teacher override</span>}
                {!done && <span class="sstep-missing">{s.extra ? 'optional' : `${missing.join(', ')} left`}</span>}
                {!done && i <= p.maxStep && (
                  <button class="btn tiny" onClick={() => session.goTo(i)}>
                    Go there
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {report.questions.length > 0 && (
        <section class="summary-card">
          <h3>
            <Icon name="hint" /> Your answers
          </h3>
          <p class="muted small">Want to change one? Choose Change, fix it, then come back here and submit again.</p>
          {all.map(({ s, i }) => {
            const qs = report.questions.filter((q) => q.step === s.id);
            if (!qs.length) return null;
            return (
              <div key={s.id} class="summary-answers">
                <div class="summary-answers-head">
                  <span>
                    Step {i + 1}. {s.title}
                  </span>
                  {i <= p.maxStep && (
                    <button class="btn tiny ghost" onClick={() => session.goTo(i)}>
                      Change
                    </button>
                  )}
                </div>
                {qs.map((q) => {
                  qn++;
                  const tone = !q.autoGraded ? (q.answer.trim() ? 'tg' : 'no') : q.correct ? 'ok' : 'no';
                  return (
                    <div key={q.id} class={`sanswer ${tone}`}>
                      <div class="sanswer-q">
                        <b>Q{qn}.</b> {q.prompt}
                      </div>
                      <div class="sanswer-a">{q.answer.trim() ? q.answer : <i class="muted">No answer yet</i>}</div>
                      <div class="sanswer-m">{gradeText(q)}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
