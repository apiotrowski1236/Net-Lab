import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { pageOf, firstUnmet, traceOf, type JsCheckResult, type JsLast, type JsState } from '../../demos/js';
import type { DemoInput, JsCheck, JsSpec } from '../../demos/types';
import { srcdoc, type PageState } from '../../dom';
import { errorText, type LintNote, type OutputLine, type TraceFrame, type TraceStep, type TraceVar, type Waiting } from '../../js';
import { Icon } from '../icons';
import { EditorPane, useSavedEdits } from './EditorPane';
import type { DemoViewProps } from './parts';

type GoTo = (file: string, line: number) => void;

/** Text from a check or a hint, where `backticks` mark code. */
function Text({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]*)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
    </>
  );
}

function Place({ file, line, onLine }: { file: string; line: number; onLine: GoTo }) {
  return (
    <button class="java-place" onClick={() => onLine(file, line)}>
      {file}, line {line}
    </button>
  );
}

function Line({ line: l }: { line: OutputLine }) {
  if (l.kind === 'log') return <div class={`js-line ${l.error ? 'js-bad' : ''}`}>{l.text || ' '}</div>;
  const answer = l.answer === null ? 'You pressed Cancel.' : l.kind === 'confirm' ? 'You pressed OK.' : `You typed: ${l.answer}`;
  return (
    <div class={`js-line is-${l.kind}`}>
      <span class="js-tag">{l.kind}</span>
      {l.text}
      {l.kind !== 'alert' && <span class="js-said">{answer}</span>}
    </div>
  );
}

function Lines({ lines }: { lines: OutputLine[] }) {
  return (
    <div class="js-lines">
      {lines.map((l, i) => (
        <Line key={i} line={l} />
      ))}
    </div>
  );
}

/** Asks in the output panel, as a browser's prompt box would. Nothing blocks, so the rest of the page keeps working. */
function PromptBox({ ask, send, stop }: { ask: Waiting; send: (answer: string | null) => void; stop?: () => void }) {
  const [text, setText] = useState(ask.default);
  const box = useRef<HTMLInputElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  // Before the box paints, so a key pressed the moment it appears lands in it.
  useLayoutEffect(() => {
    (box.current ?? ok.current)?.focus();
    box.current?.select();
  }, []);
  const typed = ask.kind === 'prompt';
  return (
    <form
      class="js-prompt"
      aria-label={`The program asks: ${ask.message}`}
      onSubmit={(e) => {
        e.preventDefault();
        send(typed ? text : '');
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        send(null);
      }}
    >
      <p class="js-ask">{ask.message}</p>
      {typed && <input ref={box} type="text" value={text} spellcheck={false} autocomplete="off" aria-label="Your answer" onInput={(e) => setText((e.target as HTMLInputElement).value)} />}
      <div class="js-prompt-buttons">
        {stop && (
          <button type="button" class="btn ghost small js-stop" onClick={stop}>
            Stop
          </button>
        )}
        <button type="button" class="btn small" onClick={() => send(null)}>
          Cancel
        </button>
        <button ref={ok} type="submit" class="btn primary small">
          OK
        </button>
      </div>
    </form>
  );
}

/** What the last Run did: its output, the error or limit that stopped it, and any prompt it's waiting on. */
function Output({ last, stale, ask, onLine }: { last?: JsLast; stale: boolean; ask?: preact.ComponentChild; onLine: GoTo }) {
  if (!last) {
    return (
      <p class="java-empty">
        Press <b>Run</b> to run your code. What it prints shows up here.
      </p>
    );
  }
  const { error, limit, lines } = last;
  const syntax = error?.type === 'SyntaxError';
  return (
    <>
      <div class="java-result" role="status">
        {stale && <p class="java-stale">You changed the code since this ran. Press Run to check it.</p>}
        {!stale && last.status === 'waiting' && !ask && <p class="java-stale">This run stopped at a prompt. Press Run to start it again.</p>}
        {lines.length > 0 && <Lines lines={lines} />}
        {last.status === 'ok' && !lines.length && <p class="java-empty">It ran, and printed nothing.</p>}
        {error && (
          <>
            <p class="java-head bad">{syntax ? 'This code has a syntax error, so none of it ran.' : 'The program stopped here.'}</p>
            <div class="java-error">
              <Place file={error.pos.file} line={error.pos.line} onLine={onLine} />
              {error.help && <p class="java-help">{error.help}</p>}
              <pre class="java-msg">{errorText(error)}</pre>
            </div>
          </>
        )}
        {limit && (
          <div class="java-error">
            {limit.file && limit.line !== undefined && <Place file={limit.file} line={limit.line} onLine={onLine} />}
            <p class="java-help">{limit.text}</p>
          </div>
        )}
      </div>
      {ask}
    </>
  );
}

function Notes({ notes, onLine }: { notes: LintNote[]; onLine: GoTo }) {
  return (
    <section class="js-notes">
      <h4>Something to check</h4>
      <ul>
        {notes.map((n, i) => (
          <li key={i}>
            <Place file={n.file} line={n.line} onLine={onLine} />
            <p>{n.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Boxes({ v }: { v: TraceVar }) {
  return (
    <ol class="js-boxes" aria-label={`${v.name} is ${v.text}`}>
      {v.items!.map((item, i) => (
        <li key={i} class={`js-box ${item.changed ? 'changed' : ''} ${item.hole ? 'hole' : ''}`}>
          <span class="js-index">{i}</span>
          <code>{item.text}</code>
        </li>
      ))}
      {!!v.more && <li class="js-more">and {v.more} more</li>}
      {!v.items!.length && <li class="js-more">no items</li>}
    </ol>
  );
}

function Frame({ frame, named }: { frame: TraceFrame; named: boolean }) {
  return (
    <table class="js-vars">
      {named && <caption>{frame.name}</caption>}
      <tbody>
        {!frame.vars.length && (
          <tr>
            <td class="java-empty">No variables yet</td>
          </tr>
        )}
        {frame.vars.map((v) => (
          <tr key={v.name} class={v.changed ? 'changed' : ''}>
            <th scope="row">
              <code>{v.name}</code>
            </th>
            <td>
              {v.items ? <Boxes v={v} /> : <code>{v.text}</code>}
              {v.changed && <span class="js-changed">changed</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stepper({ step, lines, ask }: { step: TraceStep; lines: OutputLine[]; ask?: preact.ComponentChild }) {
  const frames = [...step.frames].reverse();
  const sofar = lines.slice(0, step.out);
  return (
    <div class="js-stepper">
      <p class="java-caption" aria-live="polite">
        {step.say}
      </p>
      {ask}
      <h4>Variables</h4>
      <div class="js-frames">
        {frames.map((f, i) => (
          <Frame key={i} frame={f} named={frames.length > 1} />
        ))}
      </div>
      <h4>Output so far</h4>
      {sofar.length ? <Lines lines={sofar} /> : <p class="java-empty">Nothing yet</p>}
    </div>
  );
}

function CheckRow({ check: c, result: r, note, first, shown, send }: { check: JsCheck; result?: JsCheckResult; note?: string; first: boolean; shown: number; send: (input: DemoInput) => void }) {
  const hints = first ? (c.hints ?? []) : [];
  // A new hint can land below the edge of the panel, along with the button for the next one.
  const row = useRef<HTMLLIElement>(null);
  const seen = useRef(shown);
  useEffect(() => {
    if (shown !== seen.current) row.current?.scrollIntoView({ block: 'nearest' });
    seen.current = shown;
  }, [shown]);
  return (
    <li ref={row} class={r?.ok ? 'ok' : note ? 'no' : ''}>
      <span class="java-mark" aria-hidden="true">
        {r?.ok ? '✓' : note ? '✗' : '○'}
      </span>
      <span class="js-check">
        {c.label}
        {note && (
          <span class="java-note">
            <Text text={note} />
          </span>
        )}
        {hints.length > 0 && (
          <>
            {shown > 0 && (
              <ol class="js-hints">
                {hints.slice(0, shown).map((h, i) => (
                  <li key={i}>
                    <Text text={h} />
                  </li>
                ))}
              </ol>
            )}
            {shown < hints.length && (
              <button class="btn tiny js-hint" onClick={() => send({ hint: c.id })}>
                {shown ? 'Another hint' : 'Hint'}
              </button>
            )}
          </>
        )}
      </span>
    </li>
  );
}

const languageOf = (file: string) => (file.endsWith('.html') ? 'html' : file.endsWith('.css') ? 'css' : 'javascript');

/** A new secret for each render of the frame, so only the bridge script runs in it. */
function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The student's page in a sandboxed frame with no same-origin access. The page
 * can't run anything of its own. The bridge script tells this view about clicks,
 * and a message counts only if it came from this frame's own window.
 */
function Preview({ page, onClick }: { page: PageState; onClick: (path: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef(0);
  const clicked = useRef(onClick);
  clicked.current = onClick;
  const { body, head } = page;
  const doc = useMemo(() => srcdoc({ body, head }, { nonce: makeNonce(), scrollY: scroll.current }), [body, head]);
  useEffect(() => {
    const hear = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { netlab?: unknown; path?: unknown; y?: unknown } | null;
      if (d?.netlab !== 'click' || typeof d.path !== 'string' || !/^\d+(?:\.\d+)*$/.test(d.path)) return;
      scroll.current = typeof d.y === 'number' ? d.y : 0;
      clicked.current(d.path);
    };
    addEventListener('message', hear);
    return () => removeEventListener('message', hear);
  }, []);
  return (
    <section class="js-preview" data-preview="page">
      <div class="js-preview-bar">
        <h4>Your page</h4>
        {page.made > 0 && (
          <span class="js-made">
            {page.made.toLocaleString('en-US')} {page.made === 1 ? 'element' : 'elements'} made by {page.lines} {page.lines === 1 ? 'line' : 'lines'} of code
          </span>
        )}
      </div>
      <iframe ref={frame} title="Preview of your page" sandbox="allow-scripts" srcDoc={doc} />
    </section>
  );
}

/** A JavaScript editor, with Run, and Step through if the spec has it. */
export function JsView({ spec, state: s, send }: DemoViewProps<JsSpec, JsState>) {
  const stepping = s.at !== undefined;
  const trace = stepping ? traceOf(spec, s) : undefined;
  const step = trace?.steps[s.at!];
  const next = trace?.steps[s.at! + 1];
  const name = step?.file || s.open;
  const file = s.files.find((f) => f.name === name) ?? s.files[0];
  const { onChange, flush } = useSavedEdits(file.name, send);
  const root = useRef<HTMLDivElement>(null);

  const [jump, setJump] = useState<{ line: number; n: number }>();
  const goTo: GoTo = (fileName, line) => {
    flush();
    send({ tab: fileName });
    setJump((j) => ({ line, n: (j?.n ?? 0) + 1 }));
  };

  /** The box goes away when it's answered. Unless another one took its place, focus goes to the next thing to press. */
  const leavePrompt = (input: DemoInput) => {
    send(input);
    requestAnimationFrame(() => {
      const r = root.current;
      if (r && !r.querySelector('.js-prompt')) r.querySelector<HTMLElement>('.java-next, .java-run')?.focus();
    });
  };
  const answer = (value: string | null) => leavePrompt({ answer: value });
  const waiting = stepping ? (step?.end === 'waiting' ? trace?.waiting : undefined) : s.waiting;
  // The step-through has its own Stop.
  const ask = waiting && <PromptBox key={s.answers.length} ask={waiting} send={answer} stop={stepping ? undefined : () => leavePrompt({ stop: true })} />;

  const last = s.last;
  // Like a console, show the end. A loop that printed 2,000 lines has its stop message down there.
  const side = useRef<HTMLDivElement>(null);
  const shown = useRef(last);
  useLayoutEffect(() => {
    if (side.current) side.current.scrollTop = side.current.scrollHeight;
    // On a narrow screen the page scrolls, and the output or the note on what to fix can land under the lesson's bottom bar.
    if (last !== shown.current && matchMedia('(max-width: 900px)').matches) (root.current?.querySelector('.java-checks li.no') ?? side.current)?.scrollIntoView({ block: 'nearest' });
    shown.current = last;
  }, [last]);

  const fresh = !s.edited && !stepping;
  // Nothing has run on the first move, so its line is the next one, not the last one.
  const starting = s.at === 0;
  const errorLines = fresh ? [last?.error, last?.limit && { pos: { file: last.limit.file, line: last.limit.line } }].flatMap((e) => (e?.pos.file === file.name && e.pos.line ? [e.pos.line] : [])) : [];

  const checks = spec.checks;
  const unmet = firstUnmet(spec, s);
  const count = trace?.steps.length ?? 0;
  const page = spec.startPage && (pageOf(spec, s) ?? spec.startPage(s.files));
  const click = (path: string) => {
    flush();
    send({ click: path });
  };
  // Nothing much to read under the page, so the page takes the room.
  const quiet = !!page && !s.last?.error && !s.last?.limit && !s.waiting && !s.notes?.length && (s.last?.lines.length ?? 0) <= 2;

  return (
    <div class={`java js ${page ? 'has-page' : ''}`} ref={root}>
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
              Move {s.at! + 1} of {count}
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
        <EditorPane language={languageOf} label={page ? 'Code' : 'JavaScript code'} file={file} readOnly={stepping || !!file.locked} runLine={starting ? undefined : step?.line} nextLine={starting ? step?.line : step && next?.file === step.file && next.line !== step.line ? next.line : undefined} errorLines={errorLines} jump={jump} onChange={onChange} />
        {/* A column of panes, so a page preview can sit above the output. */}
        <div class={`js-panes ${quiet ? 'quiet' : ''}`}>
          {page && <Preview page={page} onClick={click} />}
          <div class="java-side" ref={side}>
            {step ? (
              <Stepper step={step} lines={trace!.lines} ask={ask} />
            ) : (
              <>
                <h4>Output</h4>
                <Output last={last} stale={!!s.edited} ask={ask} onLine={goTo} />
                {s.notes && !s.edited && <Notes notes={s.notes} onLine={goTo} />}
              </>
            )}
          </div>
        </div>
      </div>
      {checks && (
        <ul class="java-checks" aria-label="Checks">
          {s.held && <li class="java-held">The checks wait until your code has no syntax errors. Fix the error, then press Run.</li>}
          {stepping && s.edited && <li class="java-held">You changed your code, and only Run checks it. Press Stop, then Run.</li>}
          {checks.map((c) => {
            const r = s.checks?.find((x) => x.id === c.id);
            return <CheckRow key={c.id} check={c} result={r} note={s.held ? undefined : r?.note} first={c === unmet} shown={s.hints?.[c.id] ?? 0} send={send} />;
          })}
        </ul>
      )}
    </div>
  );
}
