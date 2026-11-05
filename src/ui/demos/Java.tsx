import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { traceOf, type JavaLast, type JavaState } from '../../demos/java';
import { FADE, firstTimeAt, planStep, type PlanBox, type PlanGlow, type PlanRow, type StepPlan } from '../../demos/javaPlan';
import type { JavaFile, JavaSpec } from '../../demos/types';
import type { Shown, TraceStep } from '../../java';
import { Icon } from '../icons';
import type { CodeEditor } from './codeEditor';
import type { DemoViewProps } from './parts';

/** How long to wait after the last key before saving. */
const SAVE_MS = 300;

interface EditorProps {
  file: JavaFile;
  readOnly: boolean;
  /** The line about to run, in the step-through. */
  runLine?: number;
  /** The line after it. */
  nextLine?: number;
  errorLines: number[];
  /** Set to scroll to a line and put the cursor there. */
  jump?: { line: number; n: number };
  onChange: (text: string) => void;
}

/** CodeMirror, once it has loaded. A plain text box does the job until then, or if it can't load. */
function Editor({ file, readOnly, runLine, nextLine, errorLines, jump, onChange }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<CodeEditor | null>(null);
  const [ready, setReady] = useState(false);
  // The text the session knows about. Anything else coming in is from outside: Start over, say.
  const known = useRef(file.text);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    let gone = false;
    void import('./codeEditor')
      .then((m) => {
        if (gone || !host.current) return;
        ed.current = m.createEditor(host.current, (text) => {
          known.current = text;
          change.current(text);
        });
        setReady(true);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      ed.current?.destroy();
      ed.current = null;
    };
  }, []);

  // Layout effects, so the step-through finds this step's marks in place when it starts its animation.
  useLayoutEffect(() => {
    const e = ed.current;
    if (!e) return;
    if (e.file() !== file.name) {
      known.current = file.text;
      e.open(file.name, file.text, readOnly);
    } else if (file.text !== known.current) {
      known.current = file.text;
      e.setText(file.text);
    }
  }, [ready, file.name, file.text]);

  useLayoutEffect(() => {
    if (ed.current?.file() === file.name) ed.current.open(file.name, known.current, readOnly);
  }, [ready, readOnly]);

  useLayoutEffect(() => {
    ed.current?.marks({ run: runLine, next: nextLine, errors: errorLines });
    if (runLine) ed.current?.reveal(runLine);
  }, [ready, file.name, runLine, nextLine, errorLines.join()]);

  useEffect(() => {
    if (jump) ed.current?.reveal(jump.line, true);
  }, [jump]);

  return (
    <div class="java-editor" ref={host}>
      {!ready && (
        <textarea
          class="java-plain"
          value={file.text}
          readOnly={readOnly}
          spellcheck={false}
          aria-label="Java code"
          onInput={(e) => {
            const text = (e.target as HTMLTextAreaElement).value;
            known.current = text;
            onChange(text);
          }}
        />
      )}
    </div>
  );
}

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/** What the last Run did: output, compile errors, or the exception that stopped it. */
function Console({ last, stale, onLine }: { last?: JavaLast; stale: boolean; onLine: (file: string, line: number) => void }) {
  if (!last) {
    return (
      <p class="java-empty">
        Press <b>Run</b> to run your code. What it prints shows up here.
      </p>
    );
  }
  const place = (file: string, line: number) => (
    <button class="java-place" onClick={() => onLine(file, line)}>
      {file}, line {line}
    </button>
  );
  return (
    <div class="java-result" role="status">
      {stale && <p class="java-stale">You changed the code since this ran.</p>}
      {last.kind === 'errors' && (
        <>
          <p class="java-head bad">{plural(last.errors!.length, 'error')}. Java could not compile this, so nothing ran.</p>
          {last.errors!.map((e, i) => {
            const [message, code, caret, ...notes] = e.text.split('\n');
            const indent = code.length - code.trimStart().length;
            return (
              <div class="java-error" key={i}>
                {place(e.file, e.line)}
                {e.help && <p class="java-help">{e.help}</p>}
                {/* The message wraps. The code can't, or its ^ would stop pointing at the right spot. */}
                <pre class="java-msg">{message}</pre>
                <pre>{`${code.slice(indent)}\n${caret.slice(indent)}`}</pre>
                {notes.length > 0 && <pre class="java-msg">{notes.join('\n')}</pre>}
              </div>
            );
          })}
        </>
      )}
      {last.kind !== 'errors' && last.output && <pre class="java-output">{last.output}</pre>}
      {last.kind === 'ok' && !last.output && <p class="java-empty">It ran, and printed nothing.</p>}
      {last.kind === 'no-main' && <p class="java-head bad">Nothing to run. Java starts at a method written public static void main(String[] args), and no class has one.</p>}
      {last.kind === 'limit' && (
        <p class="java-head bad">
          {last.limit === 'output' ? 'This printed too much, so it was stopped.' : 'This ran too long, so it was stopped. Check for a loop that never ends.'}
        </p>
      )}
      {last.exception && (
        <div class="java-error">
          {last.exception.file && last.exception.line !== undefined && place(last.exception.file, last.exception.line)}
          <p class="java-help">{last.exception.help}</p>
          <pre class="java-msg">{last.exception.text}</pre>
        </div>
      )}
    </div>
  );
}

function Value({ v, names }: { v: Shown; names: Map<number, string> }) {
  if (v.t === 'null') return <code class="mem-null">null</code>;
  if (v.t === 'value') return <code>{v.text}</code>;
  return (
    <span class="mem-ref" data-to={v.id}>
      {names.get(v.id) ?? `#${v.id}`}
    </span>
  );
}

const CALM = '(prefers-reduced-motion: reduce)';

/** True while the system asks for less motion. */
function useCalm() {
  const [calm, setCalm] = useState(() => matchMedia(CALM).matches);
  useEffect(() => {
    const m = matchMedia(CALM);
    const change = () => setCalm(m.matches);
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, []);
  return calm;
}

/** A pointer arrow, and when in the loop it shows. */
interface Arrow {
  d: string;
  at?: number;
  leave?: number;
}

const num = (s?: string | null) => (s === undefined || s === null ? undefined : Number(s));

/** Opacity over one turn of the loop. A thing that comes in goes back out, so the loop can start again. */
function fadeKeys(total: number, at?: number, leave?: number): Keyframe[] {
  const points: [number, number][] =
    at === undefined
      ? [[0, 1], [leave!, 1], [leave! + FADE, 0], [total - FADE, 0], [total, 1]] // prettier-ignore
      : leave === undefined
        ? [[0, 0], [at, 0], [at + FADE, 1], [total - FADE, 1], [total, 0]] // prettier-ignore
        : [[0, 0], [at, 0], [at + FADE, 1], [leave, 1], [leave + FADE, 0], [total, 0]]; // prettier-ignore
  let last = 0;
  return points.map(([t, opacity]) => {
    last = Math.min(1, Math.max(last, t / total));
    return { offset: last, opacity };
  });
}

/** Starts one turn's worth of animation, looping, from `from` ms in. */
function play(box: HTMLElement, plan: StepPlan, from: number): Animation[] {
  const { total } = plan;
  const loop: KeyframeAnimationOptions = { duration: total, iterations: Infinity, fill: 'both' };
  const out: Animation[] = [];
  box.querySelectorAll<HTMLElement>('[data-at],[data-leave]').forEach((el) => {
    const at = num(el.getAttribute('data-at'));
    out.push(el.animate(fadeKeys(total, at, num(el.getAttribute('data-leave'))), loop));
    if (at !== undefined && el.classList.contains('now')) {
      const land = at / total;
      const done = Math.min(1, (at + FADE * 2) / total);
      out.push(el.animate([{ offset: 0, transform: 'scale(1)' }, { offset: land, transform: 'scale(1.5)' }, { offset: done, transform: 'scale(1)' }, { offset: 1, transform: 'scale(1)' }], loop));
    }
  });

  const side = box.getBoundingClientRect();
  const spot = (key: string) => {
    const el = box.querySelector(`[data-slot="${key}"]`);
    const r = (el?.querySelector('.mem-val') ?? el)?.getBoundingClientRect();
    if (!r) return undefined;
    // The strip and the output are wide, and their text starts at the left.
    const x = key === 'strip' || key === 'out' ? r.left + 28 : r.left + r.width / 2;
    return { x: x - side.left, y: Math.min(Math.max(r.top + r.height / 2 - side.top, 10), side.height - 10) };
  };
  box.querySelectorAll<HTMLElement>('.act-chip').forEach((el, i) => {
    const c = plan.chips[i];
    const a = spot(c.from);
    const b = spot(c.to);
    if (!a || !b) return;
    const at = (p: { x: number; y: number }) => `translate(${p.x - el.offsetWidth / 2}px, ${p.y - el.offsetHeight / 2}px)`;
    out.push(el.animate(fadeKeys(total, c.at, c.until), loop));
    out.push(
      el.animate(
        [
          { offset: 0, transform: at(a) },
          { offset: c.at / total, transform: at(a), easing: 'ease-in-out' },
          { offset: c.until / total, transform: at(b) },
          { offset: 1, transform: at(b) },
        ],
        loop,
      ),
    );
  });

  // The next line lights up last, once the marked line has finished. Its text has to stay readable, so this fades its color.
  const nextLine = box.closest('.java-main')?.querySelector<HTMLElement>('.cm-java-next');
  if (nextLine) {
    const lit = getComputedStyle(nextLine).backgroundColor;
    const on = plan.flowAt / total;
    out.push(
      nextLine.animate(
        [
          { offset: 0, backgroundColor: 'transparent' },
          { offset: on, backgroundColor: 'transparent' },
          { offset: Math.min(1, on + FADE / total), backgroundColor: lit },
          { offset: 1, backgroundColor: lit },
        ],
        loop,
      ),
    );
  }

  for (const a of out) a.currentTime = from;
  return out;
}

function Row({ row, names, glows }: { row: PlanRow; names: Map<number, string>; glows: PlanGlow[] }) {
  const entering = row.enterAt !== undefined;
  return (
    <div class="mem-row" data-slot={row.key} data-at={row.enterAt} data-leave={row.leaveAt} aria-hidden={entering || undefined}>
      {glows
        .filter((g) => g.key === row.key)
        .map((g, i) => (
          <span class="mem-glow" key={i} data-at={g.at} data-leave={g.until} />
        ))}
      <span>{row.name}</span>
      {row.swapAt === undefined ? (
        <span class="mem-val">
          <Value v={(row.before ?? row.after)!} names={names} />
        </span>
      ) : (
        <span class="mem-val">
          <span class="was" data-leave={row.swapAt}>
            <Value v={row.before!} names={names} />
          </span>
          <span class="now" data-at={row.swapAt} aria-hidden="true">
            <Value v={row.after!} names={names} />
          </span>
        </span>
      )}
    </div>
  );
}

function Box({ b, cls, none, names, glows }: { b: PlanBox; cls: string; none: string; names: Map<number, string>; glows: PlanGlow[] }) {
  // "No variables yet" holds the place until the first one arrives.
  const firstAt = b.rows.every((r) => r.enterAt !== undefined) ? Math.max(0, Math.min(...b.rows.map((r) => r.enterAt!)) - FADE) : undefined;
  return (
    <div class={`${cls} ${b.current ? 'cur' : ''}`} data-id={b.id} data-slot={`frame:${b.id}`} data-at={b.enterAt} data-leave={b.leaveAt} aria-hidden={b.enterAt !== undefined || undefined}>
      <div class="mem-title">{b.label}</div>
      {firstAt !== undefined && (
        <div class="mem-none" data-leave={Number.isFinite(firstAt) ? firstAt : undefined}>
          {none}
        </div>
      )}
      {b.rows.map((r) => (
        <Row key={r.key} row={r} names={names} glows={glows} />
      ))}
    </div>
  );
}

/** One step of the program: what the marked line does, played on a loop over the memory it changes. */
function Stepper({ steps, at, output, cut, crash }: { steps: TraceStep[]; at: number; output: string; cut: boolean; crash?: string }) {
  const step = steps[at];
  const next = steps[at + 1];
  const plan = useMemo(() => planStep(step, next, cut, firstTimeAt(steps, at), crash), [steps, at, cut, crash]);
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const calm = useCalm();
  const still = paused || calm;
  const names = new Map(plan.objects.map((o) => [o.id, o.label]));

  useLayoutEffect(() => {
    const box = root.current?.querySelector<HTMLElement>('.mem');
    if (!box) return;
    const measure = () => {
      const out: Arrow[] = [];
      const o = box.getBoundingClientRect();
      box.querySelectorAll<HTMLElement>('.mem-ref').forEach((ref) => {
        const to = box.querySelector(`.mem-obj[data-id="${ref.dataset.to}"]`);
        if (!to || !ref.getClientRects().length || !to.getClientRects().length) return;
        const a = ref.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = a.right - o.left + box.scrollLeft + 2;
        const y1 = a.top + a.height / 2 - o.top + box.scrollTop;
        const y2 = Math.min(b.top + 16, b.bottom - 8) - o.top + box.scrollTop;
        let d: string;
        if (b.left >= a.right) {
          const x2 = b.left - o.left + box.scrollLeft - 3;
          const mid = (x1 + x2) / 2;
          d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
        } else {
          // Both ends in one column, as on a narrow screen: go around the side.
          const x2 = b.right - o.left + box.scrollLeft + 3;
          const bulge = Math.max(x1, x2) + 18;
          d = `M${x1} ${y1} C${bulge} ${y1} ${bulge} ${y2} ${x2} ${y2}`;
        }
        // An arrow shows while both of its ends do.
        const ends = [ref, to];
        const ats = ends.map((e) => num(e.closest('[data-at]')?.getAttribute('data-at'))).filter((n) => n !== undefined) as number[];
        const leaves = ends.map((e) => num(e.closest('[data-leave]')?.getAttribute('data-leave'))).filter((n) => n !== undefined) as number[];
        out.push({ d, at: ats.length ? Math.max(...ats) : undefined, leave: leaves.length ? Math.min(...leaves) : undefined });
      });
      setArrows((had) => (JSON.stringify(had) === JSON.stringify(out) ? had : out));
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(box);
    return () => seen.disconnect();
  }, [plan, still]);

  useLayoutEffect(() => {
    const box = root.current;
    const mem = box?.querySelector<HTMLElement>('.mem');
    if (!box || !mem) return;
    // Bring what changes into view, if the memory is scrolled.
    const target = plan.chips.map((c) => mem.querySelector(`[data-slot="${c.to}"]`)).find(Boolean);
    if (target) {
      const r = target.getBoundingClientRect();
      const m = mem.getBoundingClientRect();
      if (r.top < m.top) mem.scrollTop -= m.top - r.top + 4;
      else if (r.bottom > m.bottom) mem.scrollTop += r.bottom - m.bottom + 4;
    }
    let running: Animation[] = [];
    // Held still, the picture stays on the line's finished work.
    const done = Math.min(plan.flowAt + FADE, plan.total - FADE);
    const build = () => {
      const from = Number(running[0]?.currentTime ?? 0);
      running.forEach((a) => a.cancel());
      running = play(box, plan, still ? done : from);
      if (still) running.forEach((a) => a.pause());
    };
    build();
    // A chip's path is measured, so it has to change if the picture moves.
    const seen = new ResizeObserver(build);
    seen.observe(box);
    mem.addEventListener('scroll', build, { passive: true });
    return () => {
      seen.disconnect();
      mem.removeEventListener('scroll', build);
      running.forEach((a) => a.cancel());
    };
  }, [plan, still, arrows]);

  // Held on the finished work, a method that has ended is gone, not only faded.
  const framesTop = plan.frames.filter((f) => !still || f.leaveAt === undefined).reverse();
  const allEnter = plan.objects.length > 0 && plan.objects.every((o) => o.enterAt !== undefined);
  const firstObject = allEnter ? Math.max(0, Math.min(...plan.objects.map((o) => o.enterAt!)) - FADE) : undefined;
  const sofar = output.slice(0, step.outLen);
  return (
    <div class="stepper" ref={root}>
      <div class="java-caption" aria-live="polite">
        {plan.say.split('\n').map((line, i) => (
          <div key={i}>
            {i === 0 && next && <b>{still ? 'After the marked line: ' : 'Marked line: '}</b>}
            {line.split(/`([^`]*)`/).map((part, j) => (j % 2 ? <code key={j}>{part}</code> : part))}
          </div>
        ))}
      </div>
      {(plan.texts.length > 0 || plan.flow) && (
        <div class="act">
          <div class="act-stack" data-slot="strip">
            {still ? (
              <code class="act-text">{plan.texts.map((t) => t.text).join(' \u2192 ')}</code>
            ) : (
              plan.texts.map((t, i) => (
                <code class="act-text" key={i} aria-hidden="true" data-at={t.at} data-leave={t.until}>
                  {t.text}
                </code>
              ))
            )}
          </div>
          {plan.flow && <span class="act-flow">{plan.flow}</span>}
          {!calm && (
            <button class="btn tiny act-pause" onClick={() => setPaused(!paused)}>
              {paused ? 'Play' : 'Pause'}
            </button>
          )}
        </div>
      )}
      <div class="mem">
        <svg class="mem-arrows" aria-hidden="true">
          <defs>
            <marker id="mem-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 Z" />
            </marker>
          </defs>
          {arrows.map((a, i) => (
            <path key={`${i}${a.d}`} d={a.d} marker-end="url(#mem-head)" data-at={a.at} data-leave={a.leave} />
          ))}
        </svg>
        <div class="mem-col">
          <h4>Variables</h4>
          {framesTop.map((f) => (
            <Box key={f.id} b={f} cls="mem-frame" none="No variables yet" names={names} glows={plan.glows} />
          ))}
        </div>
        <div class="mem-col">
          <h4>Objects</h4>
          {plan.objects.length === 0 && <div class="mem-none">No objects yet</div>}
          {allEnter && (
            <div class="mem-none" data-leave={firstObject}>
              No objects yet
            </div>
          )}
          {plan.objects.map((o) => (
            <Box key={o.id} b={o} cls="mem-obj" none="" names={names} glows={plan.glows} />
          ))}
        </div>
      </div>
      <div class="java-so-far">
        <h4>Output so far</h4>
        <pre class="java-output" data-slot="out">
          {sofar || (plan.printed ? '' : ' ')}
          {plan.printed && (
            <span data-at={plan.printAt} aria-hidden="true">
              {plan.printed}
            </span>
          )}
        </pre>
      </div>
      {!still && (
        <div class="act-chips" aria-hidden="true">
          {plan.chips.map((c, i) => (
            <code class="act-chip" key={i}>
              {c.text}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}

/** A Java editor, with Run, and Step through if the spec has it. */
export function JavaView({ spec, state: s, send }: DemoViewProps<JavaSpec, JavaState>) {
  const stepping = s.at !== undefined;
  const trace = stepping ? traceOf(spec, s.files) : undefined;
  const step = trace?.steps[s.at!];
  const next = trace?.steps[s.at! + 1];
  const name = step?.file ?? s.open;
  const file = s.files.find((f) => f.name === name) ?? s.files[0];

  // Keys are saved in a pause, so the session isn't asked to save the whole lesson on every letter.
  const pending = useRef<{ file: string; code: string; timer: number } | null>(null);
  const flush = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    send({ edit: p.file, code: p.code });
  };
  const flushNow = useRef(flush);
  flushNow.current = flush;
  const onChange = (code: string) => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { file: file.name, code, timer: window.setTimeout(() => flushNow.current(), SAVE_MS) };
  };
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
    },
    [],
  );

  const [jump, setJump] = useState<{ line: number; n: number }>();
  const goTo = (fileName: string, line: number) => {
    flush();
    send({ tab: fileName });
    setJump((j) => ({ line, n: (j?.n ?? 0) + 1 }));
  };

  const last = s.last;
  const fresh = !s.edited && !stepping;
  const errorLines = fresh
    ? [...(last?.errors ?? []).filter((e) => e.file === file.name).map((e) => e.line), ...(last?.exception?.file === file.name && last.exception.line ? [last.exception.line] : [])]
    : [];

  const checks = spec.checks;
  const count = trace?.steps.length ?? 0;
  return (
    <div class="java">
      <div class="java-bar">
        <div class="java-tabs" role="tablist" aria-label="Files">
          {s.files.map((f) => (
            <button
              key={f.name}
              role="tab"
              aria-selected={f.name === file.name}
              class={`java-tab ${f.name === file.name ? 'on' : ''}`}
              disabled={stepping}
              onClick={() => {
                flush();
                send({ tab: f.name });
              }}
            >
              {f.name}
              {f.locked ? ' (read only)' : ''}
            </button>
          ))}
        </div>
        {!stepping && (
          <div class="java-actions">
            {spec.step && (
              <button
                class="btn small"
                onClick={() => {
                  flush();
                  send({ stepping: true });
                }}
              >
                Step through
              </button>
            )}
            <button
              class="btn primary small java-run"
              onClick={() => {
                flush();
                send({ run: true });
              }}
            >
              <Icon name="play" size={14} /> Run
            </button>
          </div>
        )}
        {stepping && (
          <div class="java-actions">
            <button class="btn small" disabled={s.at === 0} onClick={() => send({ seek: s.at! - 1 })}>
              Back a line
            </button>
            <span class="java-count" aria-live="polite">
              Step {s.at! + 1} of {count}
            </span>
            <button class="btn primary small java-next" disabled={s.at === count - 1} onClick={() => send({ seek: s.at! + 1 })}>
              Next
            </button>
            <button class="btn ghost small" onClick={() => send({ stepping: false })}>
              Stop
            </button>
          </div>
        )}
      </div>
      <div class={`java-main ${stepping ? 'stepping' : ''}`}>
        <Editor file={file} readOnly={stepping || !!file.locked} runLine={step?.line} nextLine={step && next?.file === step.file && next.line !== step.line ? next.line : undefined} errorLines={errorLines} jump={jump} onChange={onChange} />
        <div class="java-side">
          {step ? (
            <Stepper steps={trace!.steps} at={s.at!} output={trace!.output} cut={!!trace?.cut} crash={trace?.crash} />
          ) : (
            <>
              <h4>Output</h4>
              <Console last={last} stale={!!s.edited} onLine={goTo} />
            </>
          )}
        </div>
      </div>
      {checks && (
        <ul class="java-checks" aria-label="Checks">
          {s.held && <li class="java-held">The checks wait until your code compiles. Fix the error, then press Run.</li>}
          {checks.map((c) => {
            const r = s.checks?.find((x) => x.id === c.id);
            const note = s.held ? undefined : r?.note;
            return (
              <li key={c.id} class={r?.ok ? 'ok' : note ? 'no' : ''}>
                <span class="java-mark" aria-hidden="true">
                  {r?.ok ? '✓' : note ? '✗' : '○'}
                </span>
                <span>
                  {c.label}
                  {note && <span class="java-note">{note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
