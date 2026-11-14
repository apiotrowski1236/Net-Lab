import type { LabSession } from '../runtime/session';
import type { Sim } from '../sim/sim';
import type { LogEntry } from '../sim/types';
import { citedLogs } from '../labs/helpers';
import { Icon } from './icons';

/**
 * Citing log lines as evidence (watch-the-air). A step that lists
 * `{ kind: 'logs', devices, cite: true }` adds **Cite this line** under an
 * opened line and an evidence list above the log. Citations are SimActions
 * (`log-cite`), so they replay; goals read them with helpers.citedLog. Only a
 * step's own listing turns citing on: it doesn't carry over like the tab does.
 */

/** The devices whose lines this step lets the student cite. */
export function citeDevices(session: LabSession): string[] {
  return (session.step.tools ?? []).flatMap((t) => (t.kind === 'logs' && t.cite ? t.devices : []));
}

const isCited = (sim: Sim, e: LogEntry) => sim.logCites.some((c) => c.device === e.device && c.no === e.no);

/** The cite button under an opened line, when this step lets the student cite it. */
export function CiteButton({ session, entry }: { session: LabSession; entry: LogEntry }) {
  void session.simRev.value;
  if (!citeDevices(session).includes(entry.device)) return null;
  const on = isCited(session.sim, entry);
  return (
    <button class={`btn tiny log-cite-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => session.dispatch({ type: 'log-cite', device: entry.device, no: entry.no, on: !on })}>
      <Icon name={on ? 'x' : 'flag'} size={14} /> {on ? 'Take it out of your evidence' : 'Cite this line as evidence'}
    </button>
  );
}

/** The lines cited in this step, above the log. Click one to open it. */
export function EvidenceList({ session, onOpen }: { session: LabSession; onOpen: (e: LogEntry) => void }) {
  void session.simRev.value;
  if (!citeDevices(session).length) return null;
  const cited = citedLogs(session.sim, session.since);
  return (
    <div class="log-evidence">
      <strong>Your evidence</strong>{' '}
      {cited.length === 0 ? (
        <span class="muted small">Nothing yet. Click a line, then press <strong>Cite this line as evidence</strong>.</span>
      ) : (
        <ol>
          {cited.map((e) => (
            <li key={`${e.device}:${e.no}`}>
              <button class="linklike mono small" onClick={() => onOpen(e)}>
                {e.msg}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
