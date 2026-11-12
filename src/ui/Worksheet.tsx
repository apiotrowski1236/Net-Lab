import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LabDef, QuestionDef, StepDef, TextQuestion } from '../labs/types';
import { LabSession } from '../runtime/session';
import { profile } from '../store/profile';
import { getProgress, questionsAnswered } from '../store/progress';
import { Icon } from './icons';
import { useActiveTime, useTeacherSync } from './labTracking';
import { QuestionCard } from './Lesson';
import { inlineMarkdown, renderMarkdown } from './markdown';
import { SubmitBox } from './Submit';
import { TopBar } from './TopBar';

/** A worksheet has no network, so no device chips. */
const NO_DEVICES: Record<string, string> = {};
const noDevice = () => {};

const sectionId = (s: StepDef) => `sheet-${s.id}`;
const rowId = (s: StepDef, q: QuestionDef) => `sheet-q-${s.id}-${q.id}`;
const inputId = (s: StepDef, q: QuestionDef) => `sheet-in-${s.id}-${q.id}`;
const HAND_IN = 'sheet-hand-in';

const smooth = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** Scroll to a section or question. A question also gets the keyboard, so the student can type at once. */
function go(id: string, focus = false): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: smooth() });
  if (!focus) return;
  el.querySelector<HTMLElement>('.sheet-input, textarea, .option')?.focus({ preventScroll: true });
  el.classList.remove('nudge');
  void el.offsetWidth; // restart the animation on a second click
  el.classList.add('nudge');
}

/** Enter in a one-line answer moves to the next answer, the way a paper form reads. */
function nextOnEnter(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  const all = [...document.querySelectorAll<HTMLElement>('.worksheet .sheet-input')];
  all[all.indexOf(e.currentTarget as HTMLElement) + 1]?.focus();
}

/** One answer: a one-line box for a short answer, or a text box that grows as the student writes. */
function SheetAnswer({ session, step, q }: { session: LabSession; step: StepDef; q: TextQuestion }) {
  const a = session.answer(step.id, q.id);
  const [value, setValue] = useState(a?.value ?? '');
  useEffect(() => setValue(a?.value ?? ''), [step.id, q.id]);
  const onInput = (e: Event) => {
    const v = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
    setValue(v);
    session.setDraft(step.id, q, v);
  };
  const common = { id: inputId(step, q), value, onInput, 'aria-labelledby': `${rowId(step, q)}-num ${rowId(step, q)}-prompt` };
  if (q.short) {
    return <input {...common} type="text" class="sheet-input short" placeholder={q.placeholder ?? 'Your answer'} autocomplete="off" spellcheck={false} onKeyDown={nextOnEnter} />;
  }
  const rows = q.lines ?? 3;
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <>
      <textarea {...common} class="sheet-input long" rows={rows} style={`--rows: ${rows}`} placeholder={q.placeholder ?? 'Write in complete sentences.'} spellcheck />
      {q.minWords ? (
        <div class={`sheet-words ${words >= q.minWords ? 'ok' : ''}`}>
          {words} word{words === 1 ? '' : 's'} · aim for {q.minWords}+
        </div>
      ) : null}
    </>
  );
}

/** Which part of the sheet is at the top of the scroll area, for the sidebar to light up. */
function useActiveSection(scroller: { current: HTMLElement | null }, ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join(' ');
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const spy = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = el.getBoundingClientRect().top + 120;
        let at = ids[0];
        for (const id of ids) if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= line) at = id;
        // At the very bottom the last part may be too short to reach the line.
        if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) at = ids[ids.length - 1];
        setActive(at);
      });
    };
    spy();
    el.addEventListener('scroll', spy, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', spy);
    };
  }, [key]);
  return active;
}

/**
 * An answer sheet for a lab students do somewhere else (LabDef.worksheet).
 * There is no lesson panel or stage. The handout's questions run down one
 * column, grouped by its sections, with the hand-in box at the end. On a
 * laptop a sidebar lists the sections and what's answered; in a narrow
 * window that list becomes a bar across the top. Answers save as the
 * student types, and the report is the same one a guided lab makes.
 */
export function WorksheetPlayer({ lab }: { lab: LabDef }) {
  const who = profile.value;
  const session = useMemo(() => new LabSession(lab, getProgress(who.id, lab.id, lab.version)), [lab, who.id]);
  void session.rev.value;
  useEffect(() => () => session.dispose(), [session]);
  useActiveTime(session);
  useTeacherSync(session);
  const scroller = useRef<HTMLElement>(null);

  const sheet = lab.worksheet!;
  const sections = lab.steps.filter((s) => s.kind !== 'submit' && !s.extra);
  const handIn = lab.steps.find((s) => s.kind === 'submit')?.title ?? 'Hand it in';
  const { done, total } = questionsAnswered(lab, session.progress);
  const allDone = total > 0 && done === total;
  const blank = sections.flatMap((s) => (s.questions ?? []).filter((q) => !session.questionDone(s.id, q)).map((q) => ({ s, q })));
  const countIn = (s: StepDef) => (s.questions ?? []).filter((q) => session.questionDone(s.id, q)).length;
  const active = useActiveSection(scroller, [...sections.map(sectionId), HAND_IN]);

  const rangeLink = (cls: string) =>
    sheet.link && (
      <a class={`btn ${cls}`} href={sheet.link.url} target="_blank" rel="noopener">
        <Icon name="external" size={16} /> Open {sheet.link.label}
      </a>
    );

  return (
    <div class="sheet-page">
      <TopBar session={session} />
      <main class="worksheet" ref={scroller}>
        <div class="sheet-layout">
          <aside class="sheet-side" aria-label="Sections">
            <div class="sheet-side-label">Sections</div>
            <ol class="sheet-toc">
              {sections.map((s) => {
                const n = countIn(s);
                const of = s.questions?.length ?? 0;
                const here = active === sectionId(s);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      class={`sheet-toc-item ${n === of ? 'done' : ''} ${here ? 'active' : ''}`}
                      aria-current={here ? 'location' : undefined}
                      onClick={() => go(sectionId(s))}
                    >
                      <span class="sheet-toc-mark" aria-hidden="true">
                        {n === of && <Icon name="check" size={12} />}
                      </span>
                      <span class="sheet-toc-title">{s.title}</span>
                      <span class="sheet-toc-count">
                        {n}/{of}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div class={`sheet-side-total ${allDone ? 'done' : ''}`} aria-live="polite">
              {done} of {total} answered
            </div>
            <div class="sheet-side-actions">
              <button type="button" class={`btn ${allDone ? 'primary' : ''}`} onClick={() => go(HAND_IN)}>
                <Icon name="send" size={16} /> {handIn}
              </button>
              {rangeLink('')}
            </div>
          </aside>

          <div class="sheet-main">
            <header class="sheet-head">
              <div class="eyebrow">
                <Icon name="list" size={14} /> Answer sheet
              </div>
              <h1>{lab.title}</h1>
              <p>
                Do this lab on {sheet.where} with your handout. Type each answer here as you go. The question numbers match the handout, and your answers save as
                you type.
              </p>
              {rangeLink('small sheet-head-link')}
            </header>
            {session.replayWarning && <div class="callout warn small sheet-warning">{session.replayWarning}</div>}

            <nav class="sheet-nav" aria-label="Sections">
              <div class="sheet-nav-items">
                {sections.map((s) => {
                  const n = countIn(s);
                  const of = s.questions?.length ?? 0;
                  return (
                    <button key={s.id} type="button" class={`sheet-nav-item ${n === of ? 'done' : ''}`} title={s.title} onClick={() => go(sectionId(s))}>
                      {n === of && <Icon name="check" size={13} />}
                      <span class="sheet-nav-title">{s.title}</span>
                      <span class="sheet-nav-count">
                        {n}/{of}
                      </span>
                    </button>
                  );
                })}
                <button type="button" class="sheet-nav-item hand-in" onClick={() => go(HAND_IN)}>
                  <Icon name="send" size={13} /> {handIn}
                </button>
              </div>
              <span class={`sheet-nav-total ${allDone ? 'done' : ''}`}>
                {done} of {total} answered
              </span>
            </nav>

            {sections.map((s) => {
              const n = countIn(s);
              const of = s.questions?.length ?? 0;
              return (
                <section key={s.id} id={sectionId(s)} class="sheet-section" aria-labelledby={`${sectionId(s)}-title`}>
                  <div class="sheet-section-head">
                    <h2 id={`${sectionId(s)}-title`}>{s.title}</h2>
                    <span class={`sheet-section-count ${n === of ? 'done' : ''}`}>
                      {n === of && <Icon name="check" size={14} />}
                      {n} of {of} answered
                    </span>
                  </div>
                  {s.body.trim() && <div class="prose sheet-note" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body, NO_DEVICES) }} />}
                  <ol class="sheet-qs">
                    {(s.questions ?? []).map((q) => (
                      <li key={q.id} id={rowId(s, q)} class={`sheet-q ${session.questionDone(s.id, q) ? 'done' : ''} ${q.kind === 'choice' ? 'choice' : ''}`}>
                        {q.kind === 'text' ? (
                          <>
                            <span class="sheet-qnum" id={`${rowId(s, q)}-num`}>
                              {q.label ?? q.id}
                            </span>
                            <label class="sheet-qprompt" id={`${rowId(s, q)}-prompt`} for={inputId(s, q)} dangerouslySetInnerHTML={{ __html: inlineMarkdown(q.prompt) }} />
                            <div class="sheet-answer">
                              <SheetAnswer session={session} step={s} q={q} />
                            </div>
                          </>
                        ) : (
                          <QuestionCard session={session} step={s} q={q} labels={NO_DEVICES} onDevice={noDevice} />
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}

            <section id={HAND_IN} class="sheet-section sheet-hand-in" aria-labelledby={`${HAND_IN}-title`}>
              <div class="sheet-section-head">
                <h2 id={`${HAND_IN}-title`}>
                  <Icon name="send" size={18} /> {handIn}
                </h2>
              </div>
              {blank.length > 0 ? (
                <div class="callout warn small sheet-blank">
                  <span>
                    <strong>Still blank:</strong> {blank.length === 1 ? '1 question' : `${blank.length} questions`}. Click one to go to it.
                  </span>
                  <span class="sheet-blank-list">
                    {blank.map(({ s, q }) => (
                      <button key={`${s.id}/${q.id}`} type="button" class="btn tiny" onClick={() => go(rowId(s, q), true)}>
                        {q.label ?? q.id}
                      </button>
                    ))}
                  </span>
                </div>
              ) : (
                <div class="callout good small sheet-all-in">
                  <Icon name="check" size={14} /> Every question has an answer.
                </div>
              )}
              <SubmitBox session={session} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
