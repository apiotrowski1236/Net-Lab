import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../../runtime/session';
import { fileLine, fileRows, LOG_PATH, type LogFile } from '../../sim/linux';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';
import { termBig } from './Terminal';

// device-analysis: a Linux server's log files, numbered the way the exam's
// tables number them (row 1 is the file's first line). A search keeps each
// line's own number, so a student can cite rows straight from the results.

/** The open file per session, so changing tabs or steps doesn't lose it. */
const OPEN = new WeakMap<LabSession, Map<string, LogFile>>();

/** Short names for the tabs. */
const TAB: Record<LogFile, string> = { auth: 'auth.log', ufw: 'ufw.log', access: 'access.log', fail2ban: 'fail2ban.log' };

export function LogFilesTool({ session, spec }: ToolCardProps<'log-files'>) {
  void session.simRev.value;
  const sim = session.sim;
  const dev = sim.devices[spec.device];
  const lx = dev?.linux;
  let open = OPEN.get(session);
  if (!open) OPEN.set(session, (open = new Map()));
  const [, redraw] = useState(0);
  const file = spec.files.includes(open.get(dev?.id ?? '') as LogFile) ? (open.get(dev.id) as LogFile) : spec.files[0];
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  // A new step hands out a new card: start it with no filter, so no file looks shorter than it is.
  const lastSpec = useRef(spec);
  if (lastSpec.current !== spec) {
    lastSpec.current = spec;
    if (query) setQuery('');
  }
  const screen = useRef<HTMLDivElement>(null);
  const rows = dev && lx ? fileRows(dev, file) : [];
  const q = query.trim().toLowerCase();
  const lines = lx ? rows.map((e, i) => ({ n: i + 1, e, text: fileLine(lx, e) })) : [];
  const shown = q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines;

  // New lines arrive at the bottom, as in a real file. Follow them only when the student is already there.
  const atEnd = useRef(false);
  const count = rows.length;
  useLayoutEffect(() => {
    const el = screen.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [count]);
  useLayoutEffect(() => {
    if (screen.current) screen.current.scrollTop = 0;
  }, [file, q]);
  const onScroll = () => {
    const el = screen.current;
    if (el) atEnd.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  };

  if (!dev || !lx) return null;
  const pick = (f: LogFile) => {
    open!.set(dev.id, f);
    setPicked(null);
    redraw((n) => n + 1);
  };
  const click = (n: number) => {
    setPicked(n === picked ? null : n);
    const e = rows[n - 1];
    if (e) session.ui({ type: 'ui:open-log', device: dev.id, entry: e });
  };
  const fresh = (t: number) => t >= 0 && sim.t - t < 5000;

  return (
    <div class="tool-card logf-card">
      <div class="tool-title logf-head">
        <span class="logf-name">
          <Icon name="list" /> Log files on {dev.label}
        </span>
        <button
          type="button"
          class="btn tiny term-size"
          title="Make the logs taller for reading."
          aria-pressed={termBig.value}
          onClick={() => (termBig.value = !termBig.value)}
        >
          {termBig.value ? 'Smaller' : 'Bigger'}
        </button>
      </div>
      <div class="seg logf-tabs" role="tablist" aria-label="Log file">
        {spec.files.map((f) => (
          <button key={f} role="tab" aria-selected={f === file} class={f === file ? 'on' : ''} onClick={() => pick(f)}>
            {TAB[f]} <span class="muted">({fileRows(dev, f).length})</span>
          </button>
        ))}
      </div>
      <div class="logf-bar">
        <code class="logf-path">{LOG_PATH[file]}</code>
        <label class="logf-search">
          <Icon name="filter" size={14} />
          <input
            type="search"
            value={query}
            placeholder="Show only lines with…"
            aria-label={`Search ${TAB[file]}`}
            autoComplete="off"
            spellcheck={false}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </label>
        <span class="small muted logf-count">{q ? `${shown.length} of ${lines.length} rows` : `${lines.length} rows`}</span>
      </div>
      <div class="logf-screen" ref={screen} onScroll={onScroll} role="log" aria-label={`${LOG_PATH[file]} on ${dev.label}`}>
        {lines.length === 0 && <div class="logf-empty muted">This file is empty.</div>}
        {lines.length > 0 && shown.length === 0 && <div class="logf-empty muted">No row has “{query.trim()}”.</div>}
        {shown.map((l) => (
          <button type="button" key={l.e.no} class={`logf-row ${fresh(l.e.t) ? 'logf-new' : ''} ${picked === l.n ? 'on' : ''}`} onClick={() => click(l.n)}>
            <span class="logf-no">{l.n}</span>
            <span class="logf-text">{l.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
