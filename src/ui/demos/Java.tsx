import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { traceOf, type JavaLast, type JavaState } from '../../demos/java';
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
  errorLines: number[];
  /** Set to scroll to a line and put the cursor there. */
  jump?: { line: number; n: number };
  onChange: (text: string) => void;
}

/** CodeMirror, once it has loaded. A plain text box does the job until then, or if it can't load. */
function Editor({ file, readOnly, runLine, errorLines, jump, onChange }: EditorProps) {
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

  useEffect(() => {
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

  useEffect(() => {
    if (ed.current?.file() === file.name) ed.current.open(file.name, known.current, readOnly);
  }, [ready, readOnly]);

  useEffect(() => {
    ed.current?.marks({ run: runLine, errors: errorLines });
    if (runLine) ed.current?.reveal(runLine);
  }, [ready, file.name, runLine, errorLines.join()]);

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
          {last.errors!.map((e, i) => (
            <div class="java-error" key={i}>
              {place(e.file, e.line)}
              {e.help && <p class="java-help">{e.help}</p>}
              {/* The message wraps. The code below it can't, or its ^ would stop pointing at the right spot. */}
              <pre class="java-msg">{e.text.split('\n')[0]}</pre>
              <pre>{e.text.split('\n').slice(1).join('\n')}</pre>
            </div>
          ))}
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
          <pre>{last.exception.text}</pre>
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

/** The program's memory at one step: variables on the left, objects on the right, arrows between them. */
function Memory({ step }: { step: TraceStep }) {
  const root = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const names = new Map(step.objects.map((o) => [o.id, `${o.label} #${o.id}`]));

  useLayoutEffect(() => {
    const box = root.current;
    if (!box) return;
    const measure = () => {
      if (getComputedStyle(box).getPropertyValue('--mem-arrows').trim() === 'none') return setLines([]);
      const o = box.getBoundingClientRect();
      const out: string[] = [];
      box.querySelectorAll<HTMLElement>('.mem-ref').forEach((ref) => {
        const to = box.querySelector(`.mem-obj[data-id="${ref.dataset.to}"]`);
        if (!to) return;
        const a = ref.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = a.right - o.left + box.scrollLeft + 2;
        const y1 = a.top + a.height / 2 - o.top + box.scrollTop;
        const y2 = Math.min(b.top + 16, b.bottom - 8) - o.top + box.scrollTop;
        if (b.left >= a.right) {
          const x2 = b.left - o.left + box.scrollLeft - 3;
          const mid = (x1 + x2) / 2;
          out.push(`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`);
        } else {
          // An object pointing at another object in the same column: go around the side.
          const x2 = b.right - o.left + box.scrollLeft + 3;
          const bulge = Math.max(x1, x2) + 18;
          out.push(`M${x1} ${y1} C${bulge} ${y1} ${bulge} ${y2} ${x2} ${y2}`);
        }
      });
      setLines(out);
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(box);
    return () => seen.disconnect();
  }, [step]);

  const frames = [...step.frames].reverse();
  return (
    <div class="mem" ref={root}>
      <svg class="mem-arrows" aria-hidden="true">
        <defs>
          <marker id="mem-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 Z" />
          </marker>
        </defs>
        {lines.map((d, i) => (
          <path key={i} d={d} marker-end="url(#mem-head)" />
        ))}
      </svg>
      <div class="mem-col">
        <h4>Variables</h4>
        {frames.map((f, i) => (
          <div class={`mem-frame ${i === 0 ? 'cur' : ''}`} key={`${frames.length - i}`}>
            <div class="mem-title">{f.label}</div>
            {f.vars.length === 0 && <div class="mem-none">No variables yet</div>}
            {f.vars.map((v) => (
              <div class="mem-row" key={v.name}>
                <span>{v.name}</span>
                <Value v={v.value} names={names} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div class="mem-col">
        <h4>Objects</h4>
        {step.objects.length === 0 && <div class="mem-none">No objects yet</div>}
        {step.objects.map((o) => (
          <div class="mem-obj" data-id={o.id} key={o.id}>
            <div class="mem-title">{names.get(o.id)}</div>
            {o.fields.map((v) => (
              <div class="mem-row" key={v.name}>
                <span>{v.name}</span>
                <Value v={v.value} names={names} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A Java editor, with Run, and Step through if the spec has it. */
export function JavaView({ spec, state: s, send }: DemoViewProps<JavaSpec, JavaState>) {
  const stepping = s.at !== undefined;
  const trace = stepping ? traceOf(spec, s.files) : undefined;
  const step = trace?.steps[s.at!];
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
              Back
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
        <Editor file={file} readOnly={stepping || !!file.locked} runLine={step?.line} errorLines={errorLines} jump={jump} onChange={onChange} />
        <div class="java-side">
          {step ? (
            <>
              <div class="java-caption" aria-live="polite">
                <b>The marked line is about to run.</b> {step.note}
                {s.at === count - 1 && !trace?.cut && ' This is the end of the program.'}
                {trace?.cut && s.at === count - 1 && ' This program has more steps than can be shown.'}
              </div>
              <Memory step={step} />
              <div class="java-so-far">
                <h4>Output so far</h4>
                <pre class="java-output">{trace!.output.slice(0, step.outLen) || ' '}</pre>
              </div>
            </>
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
          {checks.map((c) => {
            const r = s.checks?.find((x) => x.id === c.id);
            return (
              <li key={c.id} class={r?.ok ? 'ok' : r?.note ? 'no' : ''}>
                <span class="java-mark" aria-hidden="true">
                  {r?.ok ? '✓' : r?.note ? '✗' : '○'}
                </span>
                <span>
                  {c.label}
                  {r?.note && <span class="java-note">{r.note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
