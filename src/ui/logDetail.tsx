import type { LabSession } from '../runtime/session';
import type { LogEntry } from '../sim/types';
import { canTriage, findIncident, IncidentCard } from './inspector/SiemConsole';

/**
 * Extra panels under an opened line in the Logs tab, for lines that stand for
 * something bigger. Today: a SIEM incident line shows the incident (logs lab).
 * Lines without one show nothing extra.
 */
export function LogDetailExtras({ session, entry }: { session: LabSession; entry: LogEntry }) {
  const id = entry.fields?.incident;
  if (typeof id !== 'number') return null;
  const found = findIncident(session.sim, id);
  if (!found) return null;
  return <IncidentCard key={id} session={session} sim={session.sim} siemId={found.siem} inc={found.inc} edit={canTriage(session, found.siem)} />;
}
