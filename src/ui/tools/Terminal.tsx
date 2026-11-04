import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../../runtime/session';
import { checkCommand } from '../../runtime/termInput';
import { TERM_USAGE, type TermRun } from '../../sim/terminal';
import { Icon } from '../icons';
import { commandOf, helpLines, runLines, runMeaning, type TermLine } from '../termText';
import type { ToolCardProps } from './registry';

/**
 * Terminal (net-tools; written for later labs too): a command line on one of
 * the step's computers. The student types ping, traceroute, nslookup, netstat,
 * or nmap; each line is a recorded action, and its output is drawn from the
 * run the sim fills in (see sim/terminal.ts and ui/termText.ts). Mistyped
 * lines, help, and clear only change the screen, so they are kept here and
 * never recorded.
 */

/** A line that only changed the screen: an error, or help's list. */
interface Local {
  n: number;
  t: number;
  /** The newest run on this computer when it was typed: it prints after that run. */
  after: number;
  line: string;
  out: TermLine[];
}

interface DevState {
  local: Local[];
  history: string[];
  /** clear hides everything up to here. */
  cut: { run: number; local: number };
}

/** Kept per session, so switching tabs doesn't wipe the screen. */
const STATE = new WeakMap<LabSession, { at?: string; devs: Map<string, DevState>; n: number }>();

function stateOf(session: LabSession) {
  let s = STATE.get(session);
  if (!s) STATE.set(session, (s = { devs: new Map(), n: 1 }));
  return s;
}

function devState(session: LabSession, id: string): DevState {
  const s = stateOf(session);
  let d = s.devs.get(id);
  if (!d) s.devs.set(id, (d = { local: [], history: [], cut: { run: 0, local: 0 } }));
  return d;
}

export function TerminalTool({ session, spec, selected }: ToolCardProps<'terminal'>) {
  // Shows live network state: re-render whenever the network changes.
  void session.simRev.value;
  const sim = session.sim;
  const st = stateOf(session);
  const at = st.at && spec.devices.includes(st.at) ? st.at : spec.devices[0];
  const [, redraw] = useState(0);
  const setAt = (id: string) => {
    st.at = id;
    redraw((n) => n + 1);
  };
  // Clicking a computer on the map (or its name in the lesson) sits you down at it.
  useEffect(() => {
    if (selected && selected !== at && spec.devices.includes(selected)) setAt(selected);
  }, [selected]);
  const dev = sim.devices[at];
  const ds = devState(session, at);
  const [draft, setDraft] = useState('');
  const [hist, setHist] = useState(-1);
  const [showOld, setShowOld] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLDivElement>(null);

  const since = session.since;
  const all = dev?.term ?? [];
  const runs = all.filter((r) => r.id > ds.cut.run);
  const older = showOld ? 0 : runs.filter((r) => r.t < since).length;
  const shown = runs.slice(older);
  const locals = ds.local.filter((l) => l.n > ds.cut.local && (showOld || l.t >= since));
  const newest = all[all.length - 1];
  const busy = !!newest && newest.doneAt === undefined;

  type Entry = { key: string; order: [number, number]; line: string; out: TermLine[]; run?: TermRun };
  const entries: Entry[] = [
    ...shown.map((r) => ({ key: `r${r.id}`, order: [r.id, 0] as [number, number], line: r.line, out: runLines(sim, at, r), run: r })),
    ...locals.map((l) => ({ key: `l${l.n}`, order: [l.after, l.n] as [number, number], line: l.line, out: l.out })),
  ].sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  const last = entries[entries.length - 1];
  const meaning = last?.run ? runMeaning(sim, at, last.run) : undefined;

  // Keep the newest output in view, the way a terminal scrolls.
  const size = entries.reduce((n, e) => n + e.out.length + 1, 0);
  useLayoutEffect(() => {
    const el = screen.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [size, at, meaning]);

  const addLocal = (line: string, out: TermLine[]) => {
    ds.local.push({ n: st.n++, t: sim.t, after: newest?.id ?? 0, line, out });
    if (ds.local.length > 60) ds.local.splice(0, ds.local.length - 60);
  };

  const run = () => {
    const raw = draft.trim();
    if (!raw || !dev) return;
    if (busy) return;
    if (ds.history[ds.history.length - 1] !== raw) ds.history.push(raw);
    setHist(-1);
    setDraft('');
    const r = checkCommand(sim, spec, at, raw);
    if (!r.ok) {
      addLocal(raw, [{ text: r.msg, tone: 'bad' }]);
      redraw((n) => n + 1);
      return;
    }
    if (r.parsed.cmd === 'help') {
      addLocal(r.line, helpLines(spec.commands));
      redraw((n) => n + 1);
      return;
    }
    if (r.parsed.cmd === 'clear') {
      ds.cut = { run: newest?.id ?? 0, local: st.n++ };
      redraw((n) => n + 1);
      return;
    }
    session.dispatch({ type: 'term', device: at, line: r.line });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const h = ds.history;
      if (!h.length) return;
      e.preventDefault();
      const i = e.key === 'ArrowUp' ? (hist < 0 ? h.length - 1 : Math.max(0, hist - 1)) : hist < 0 ? -1 : hist + 1;
      if (i < 0 || i >= h.length) {
        setHist(-1);
        setDraft('');
      } else {
        setHist(i);
        setDraft(h[i]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      ds.cut = { run: newest?.id ?? 0, local: st.n++ };
      redraw((n) => n + 1);
    }
  };

  const start = (c: string) => {
    setDraft(`${c} `);
    setHist(-1);
    input.current?.focus();
  };
  // A tap anywhere on the screen puts the cursor in the command line, unless the student is selecting text to copy.
  const focusInput = () => {
    if (!window.getSelection()?.toString()) input.current?.focus();
  };

  const typed = commandOf(draft);
  const prompt = `${at}>`;
  const nmapHere = spec.commands.includes('nmap') && spec.nmap?.from === at;

  return (
    <div class="tool-card term-card">
      <div class="tool-title term-head">
        <span class="term-name">
          <Icon name="terminal" /> Terminal
        </span>
        <label class="term-at">
          Sitting at
          {spec.devices.length > 1 ? (
            <select value={at} onChange={(e) => setAt((e.target as HTMLSelectElement).value)} aria-label="Computer to type commands on">
              {spec.devices.map((id) => (
                <option key={id} value={id}>
                  {sim.devices[id]?.label ?? id}
                </option>
              ))}
            </select>
          ) : (
            <b>{dev?.label ?? at}</b>
          )}
        </label>
      </div>
      <div class="term-screen" ref={screen} onClick={focusInput} role="log" aria-live="polite" aria-label={`Terminal on ${dev?.label ?? at}`}>
        {older > 0 && (
          <button class="btn tiny term-older" onClick={() => setShowOld(true)}>
            Show {older} earlier command{older === 1 ? '' : 's'}
          </button>
        )}
        {entries.length === 0 && <div class="term-line muted">Type a command and press Enter. Type help to see the commands.</div>}
        {entries.map((e) => (
          <div class="term-entry" key={e.key} data-local={e.run ? undefined : ''}>
            <div class="term-cmd">
              <span class="term-prompt">{prompt}</span> {e.line}
            </div>
            {e.out.map((l, i) => (
              <div key={i} class={`term-line ${l.tone ?? ''}`}>
                {l.text || ' '}
              </div>
            ))}
            {e.run && e.run.doneAt === undefined && <div class="term-line muted term-wait">running…</div>}
          </div>
        ))}
        <div class="term-input-row">
          <label class="term-prompt" for={`term-in-${at}`}>
            {prompt}
          </label>
          <input
            id={`term-in-${at}`}
            ref={input}
            class="term-input"
            value={draft}
            disabled={!dev}
            placeholder={busy ? 'wait for it to finish…' : ''}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellcheck={false}
            enterKeyHint="go"
            aria-label={`Command to run on ${dev?.label ?? at}`}
            onInput={(e) => {
              setDraft((e.target as HTMLInputElement).value);
              setHist(-1);
            }}
            onKeyDown={onKey}
          />
          <button class="btn tiny term-run" onClick={run} disabled={busy || !draft.trim()}>
            Run
          </button>
        </div>
      </div>
      {meaning && (
        <p class="term-meaning" aria-live="polite">
          <Icon name="info" size={14} />
          <span>
            <b>What this means:</b> {meaning}
          </span>
        </p>
      )}
      <div class="term-help">
        <span class="term-chips" role="group" aria-label="Start a command">
          {spec.commands.map((c) => (
            <button key={c} class={`btn tiny term-chip ${typed === c ? 'on' : ''} ${c === 'nmap' ? 'danger' : ''}`} onClick={() => start(c)} disabled={c === 'nmap' && !nmapHere}>
              {c}
            </button>
          ))}
        </span>
        <span class="term-usage muted">
          {typed ? (
            <>
              <code>{TERM_USAGE[typed].usage}</code> {TERM_USAGE[typed].what}
            </>
          ) : (
            'Press a command to start typing it, or type help.'
          )}
        </span>
      </div>
      {spec.commands.includes('nmap') && spec.nmap && (
        <p class="term-scope">
          <Icon name="warn" size={14} />
          <span>
            nmap runs only on {sim.devices[spec.nmap.from]?.label ?? spec.nmap.from}, and only on <span class="mono">{spec.nmap.scope.join(', ')}</span>: what {spec.nmap.owner} gave written
            permission to scan.
          </span>
        </p>
      )}
    </div>
  );
}
