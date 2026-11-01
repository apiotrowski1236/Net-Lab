import { useEffect, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import type { LogEntry, LogLevel } from '../sim/types';
import { Icon } from './icons';
import { LogDetailExtras } from './logDetail';

/** Most lines the table draws at once. Filters narrow the rest down. */
const MAX_ROWS = 300;

const LEVEL_TEXT: Record<LogLevel, string> = { info: 'info', notice: 'notice', warn: 'warning', alert: 'ALERT' };

/** "09:00" plus simulated milliseconds, as a log timestamp: "09:00:04.2". Negative times count back from the start. */
export function clockTime(t: number, clock = '09:00'): string {
  const [h, m] = clock.split(':').map(Number);
  const day = 24 * 3600 * 1000;
  const ms = ((((h * 60 + m) * 60 * 1000 + Math.round(t)) % day) + day) % day;
  const pad = (n: number) => String(n).padStart(2, '0');
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.${Math.floor((ms % 1000) / 100)}`;
}

/** Every device the unlocked Logs tools point at, in the order the lesson listed them. */
export function logDevices(session: LabSession): string[] {
  const ids: string[] = [];
  for (const t of session.tools) if (t.kind === 'logs') for (const d of t.devices) if (!ids.includes(d)) ids.push(d);
  return ids.filter((d) => session.sim.devices[d]);
}

/**
 * The Logs tab: a log viewer across the devices the lesson hands out, oldest
 * line first like a real log file. Click a line to open its fields; goals can
 * listen for that (helpers.openedLog).
 */
export function LogsView({ session }: { session: LabSession }) {
  const sim = session.sim;
  const ids = logDevices(session);
  const [only, setOnly] = useState<string>('all');
  const [level, setLevel] = useState<'all' | 'warn'>('all');
  // Alerts only: shown once some device has raised an alert (an IDS sensor or a SIEM).
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const all: LogEntry[] = ids.flatMap((id) => sim.devices[id].logs).sort((a, b) => a.t - b.t || a.no - b.no);
  const hasAlerts = all.some((e) => e.level === 'alert');
  const needle = text.trim().toLowerCase();
  const matching = all.filter(
    (e) =>
      (only === 'all' || e.device === only) &&
      (level === 'all' || e.level === 'warn' || e.level === 'alert') &&
      (!alertsOnly || !hasAlerts || e.level === 'alert') &&
      (!needle || `${e.source} ${e.msg} ${sim.devices[e.device]?.label ?? ''}`.toLowerCase().includes(needle)),
  );
  const rows = matching.slice(-MAX_ROWS);

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const sel = all.find((e) => e.no === selected);
  const open = (e: LogEntry) => {
    setSelected(e.no);
    session.ui({ type: 'ui:open-log', device: e.device, entry: e });
  };

  return (
    <div class="capture logs">
      <div class="capture-bar">
        <span>
          <strong>Logs</strong>{' '}
          <span class="muted">
            {matching.length === all.length ? `${all.length} line${all.length === 1 ? '' : 's'}` : `${matching.length} of ${all.length} lines`}
          </span>
        </span>
        <span class="logs-filters">
          {ids.length > 1 && (
            <select aria-label="Which device's log" value={only} onChange={(e) => setOnly((e.target as HTMLSelectElement).value)}>
              <option value="all">All devices</option>
              {ids.map((id) => (
                <option value={id}>{sim.devices[id].label}</option>
              ))}
            </select>
          )}
          <label class="check">
            <input type="checkbox" checked={level === 'warn'} onChange={(e) => setLevel((e.target as HTMLInputElement).checked ? 'warn' : 'all')} /> Warnings and alerts only
          </label>
          {hasAlerts && (
            <label class="check">
              <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly((e.target as HTMLInputElement).checked)} /> Alerts only
            </label>
          )}
          <input class="logs-search" type="search" placeholder="Search" aria-label="Search the logs" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        </span>
      </div>
      {all.length === 0 ? (
        <div class="dock-empty">
          <Icon name="list" size={28} />
          <p>Nothing logged yet. Lines appear here as the devices write them.</p>
        </div>
      ) : (
        <div class="capture-split">
          <div
            class="capture-list"
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
            }}
          >
            {matching.length > rows.length && (
              <p class="muted small logs-more">
                Showing the newest {MAX_ROWS} of {matching.length} matching lines. Search or filter to narrow them down.
              </p>
            )}
            <table class="table capture-table logs-table">
              <thead>
                <tr>
                  <th>Time</th>
                  {ids.length > 1 && <th>Device</th>}
                  <th>Source</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.no} class={`lvl-${e.level} ${selected === e.no ? 'selected' : ''}`} onClick={() => open(e)}>
                    <td class="mono">{clockTime(e.t, session.lab.clock)}</td>
                    {ids.length > 1 && <td>{sim.devices[e.device]?.label}</td>}
                    <td>{e.source}</td>
                    <td class="mono info" title={e.msg}>
                      {e.level !== 'info' && <span class={`pill tiny lvl ${e.level}`}>{LEVEL_TEXT[e.level]}</span>} {e.msg}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p class="muted small logs-more">No lines match.</p>}
          </div>
          <div class="capture-detail">
            {sel ? (
              <div class="layer">
                <div class="layer-title">
                  {sim.devices[sel.device]?.label} · {sel.source} · {LEVEL_TEXT[sel.level]}
                </div>
                <p class="mono small">{sel.msg}</p>
                <table>
                  <tbody>
                    <tr>
                      <td class="k">Time</td>
                      <td class="v mono">{clockTime(sel.t, session.lab.clock)}</td>
                    </tr>
                    {Object.entries(sel.fields ?? {}).map(([k, v]) => (
                      <tr>
                        <td class="k">{k}</td>
                        <td class="v mono">{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <LogDetailExtras session={session} entry={sel} />
              </div>
            ) : (
              <div class="dock-empty small">
                <p>Click a line to open it up.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
