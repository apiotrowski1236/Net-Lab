import { useState } from 'preact/hooks';
import type { LabSession } from '../../runtime/session';
import { aiAlerts, aiCounts, type AiEvent, type Incident, type Siem, type TriageAction, type Verdict } from '../../sim/ids';
import type { Sim } from '../../sim/sim';
import { clockTime } from '../LogsView';
import { ToolMsg, recentlyChanged, type Msg } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

const KIND_TEXT: Record<string, string> = {
  deny: 'Firewall denied it',
  scan: 'Port-scan alert',
  'auth-fail': 'Failed sign-ins',
};

const TRUTH_TEXT: Record<AiEvent['truth'], string> = { attack: 'real attack', 'false-alarm': 'false alarm', normal: 'normal' };

/** "Escalated: real attack", "Open". */
export function triageText(inc: Incident): string {
  if (!inc.action) return 'Open';
  return `${inc.action === 'escalate' ? 'Escalated' : 'Closed'}: ${inc.verdict === 'real' ? 'real attack' : 'false alarm'}`;
}

/** The SIEM that holds incident `id`, if any. */
export function findIncident(sim: Sim, id: number): { siem: string; inc: Incident } | undefined {
  for (const d of Object.values(sim.devices)) {
    const inc = d.ids?.siem?.incidents.find((i) => i.id === id);
    if (inc) return { siem: d.id, inc };
  }
  return undefined;
}

/** May the student triage this SIEM's incidents? */
export const canTriage = (session: LabSession, siemId: string) => session.tools.some((t) => t.kind === 'siem' && t.device === siemId);

/**
 * One incident: the kinds of event the SIEM tied together, and (with the
 * 'siem' tool) the analyst's triage. Used in the SIEM's inspector and in the
 * Logs tab when the student opens the incident's line.
 */
export function IncidentCard({ session, sim, siemId, inc, edit }: { session: LabSession; sim: Sim; siemId: string; inc: Incident; edit: boolean }) {
  const [verdict, setVerdict] = useState<Verdict | undefined>(inc.verdict);
  const [action, setAction] = useState<TriageAction | undefined>(inc.action);
  const [msg, setMsg] = useState<Msg>(null);
  const clock = session.lab.clock;
  const end = Math.max(...inc.parts.map((p) => p.last));
  const save = () => {
    if (!verdict || !action) {
      setMsg({ tone: 'bad', text: 'Choose a verdict and an action first.' });
      return;
    }
    session.dispatch({ type: 'siem-triage', device: siemId, incident: inc.id, verdict, action });
    setMsg({ tone: 'good', text: `Saved. Incident ${inc.id} is ${triageText({ ...inc, verdict, action }).toLowerCase()}.` });
  };
  const seg = <T extends string>(label: string, value: T | undefined, set: (v: T) => void, opts: [T, string][]) => (
    <div class="ids-row">
      <span class="small">{label}:</span>
      <div class="seg" role="group" aria-label={`Incident ${inc.id} ${label.toLowerCase()}`}>
        {opts.map(([v, text]) => (
          <button key={v} class={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => (set(v), setMsg(null))}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div class="incident-card">
      <div class="incident-head">
        <strong>Incident {inc.id}</strong>
        <span class={`pill tiny ${inc.action === 'escalate' ? 'bad' : inc.action === 'close' ? '' : 'warn'}`}>{triageText(inc)}</span>
      </div>
      <p class="small">
        {inc.parts.length} kinds of event from <span class="mono">{inc.src}</span>, {clockTime(inc.start, clock).slice(0, 5)} to {clockTime(end, clock).slice(0, 5)}:
      </p>
      <ul class="incident-parts small">
        {inc.parts.map((p) => (
          <li key={p.kind}>
            <strong>{KIND_TEXT[p.kind] ?? `${p.kind} alert`}</strong> on {sim.devices[p.device]?.label ?? p.device}: {p.count} line{p.count === 1 ? '' : 's'}, first at{' '}
            {clockTime(p.first, clock).slice(0, 8)}
          </li>
        ))}
      </ul>
      {edit && (
        <div class="incident-triage">
          {seg<Verdict>('Verdict', verdict, setVerdict, [
            ['real', 'Real attack'],
            ['false', 'False alarm'],
          ])}
          {seg<TriageAction>('Action', action, setAction, [
            ['escalate', 'Escalate'],
            ['close', 'Close'],
          ])}
          <button class="btn small" onClick={save}>
            Save triage
          </button>
          <ToolMsg msg={msg} />
        </div>
      )}
    </div>
  );
}

/**
 * A SIEM (logs lab): where its logs come from, its incidents, and (with the
 * 'ai-threshold' tool) the AI model's scores and alert threshold.
 */
export function SiemConsole({ session, sim, dev, replaying }: InspectorSectionProps) {
  const q = dev.ids?.siem;
  const [open, setOpen] = useState<number | null>(null);
  if (!q) return null;
  const triage = canTriage(session, dev.id) && !replaying;
  const show = (inc: Incident) => {
    setOpen(open === inc.id ? null : inc.id);
    const entry = dev.logs.find((e) => e.no === inc.logNo);
    if (entry && !replaying && open !== inc.id) session.ui({ type: 'ui:open-log', device: dev.id, entry });
  };
  const ai = session.tools.some((t) => t.kind === 'ai-threshold' && t.device === dev.id) || q.ai;
  return (
    <>
      <section class="siem-section">
        <h4>
          Incidents <span class="muted">lines the SIEM tied together</span>
        </h4>
        <p class="small muted">
          Collects the logs of {q.sources.length} devices. When one outside address shows up in {q.minKinds} kinds of event within {Math.round(q.window / 60_000)} minutes, it opens
          an incident.
        </p>
        {q.incidents.length === 0 ? (
          <p class="small muted">No incidents.</p>
        ) : (
          <ul class="incident-list">
            {q.incidents.map((inc) => (
              <li key={inc.id}>
                <button class={`btn small ghost incident-row ${open === inc.id ? 'on' : ''}`} aria-expanded={open === inc.id} onClick={() => show(inc)}>
                  <span>
                    <strong>{inc.id}</strong> from <span class="mono">{inc.src}</span> at {clockTime(inc.start, session.lab.clock).slice(0, 5)}
                  </span>
                  <span class={`pill tiny ${inc.action === 'escalate' ? 'bad' : inc.action === 'close' ? '' : 'warn'}`}>{triageText(inc)}</span>
                </button>
                {open === inc.id && <IncidentCard session={session} sim={sim} siemId={dev.id} inc={inc} edit={triage} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {ai && <AiThreshold session={session} sim={sim} devId={dev.id} q={q} edit={!replaying && session.tools.some((t) => t.kind === 'ai-threshold' && t.device === dev.id)} />}
    </>
  );
}

function AiThreshold({ session, sim, devId, q, edit }: { session: LabSession; sim: Sim; devId: string; q: Siem; edit: boolean }) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? q.threshold;
  const flash = recentlyChanged(sim, (e) => e.type === 'config' && e.device === devId && e.what === 'ai-score', 2500);
  if (!q.ai) {
    return (
      <section class="siem-section">
        <h4>
          AI threshold <span class="muted">which scores become alerts</span>
        </h4>
        <p class="small callout">Nothing scored yet. Press <strong>Score this morning's events</strong> in the lesson.</p>
      </section>
    );
  }
  const c = aiCounts(q, value);
  const hit = new Set(aiAlerts(q.ai.events, value).map((e) => e.id));
  const events = [...q.ai.events].sort((a, b) => b.score - a.score);
  return (
    <section class={`siem-section ${flash ? 'flash' : ''}`}>
      <h4>
        AI threshold <span class="muted">scores at or above it become alerts</span>
      </h4>
      <div class="ai-slider">
        <label class="small" for={`ai-th-${devId}`}>
          Threshold <strong class="mono">{value.toFixed(2)}</strong>
        </label>
        <input
          id={`ai-th-${devId}`}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          disabled={!edit}
          onInput={(e) => setDraft(Number((e.target as HTMLInputElement).value))}
          onChange={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            setDraft(null);
            if (Math.abs(v - q.threshold) > 1e-9) session.dispatch({ type: 'ai-threshold', device: devId, value: v });
          }}
        />
      </div>
      <div class="ai-counts">
        <span class={`pill ${c.caught === c.attacks ? 'good' : 'bad'}`}>
          Real attacks caught: {c.caught} of {c.attacks}
        </span>
        <span class={`pill ${c.falseAlerts > 1 ? 'bad' : c.falseAlerts === 1 ? 'warn' : 'good'}`}>False alerts: {c.falseAlerts}</span>
      </div>
      <table class="table ai-table small">
        <thead>
          <tr>
            <th>Score</th>
            <th>Event</th>
            <th>Time</th>
            <th>Alert?</th>
            <th>What it was</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} class={hit.has(e.id) ? 'ai-hit' : ''}>
              <td class="mono">{e.score.toFixed(2)}</td>
              <td>{e.label}</td>
              <td class="mono">{e.when}</td>
              <td>{hit.has(e.id) ? <span class="pill tiny bad">ALERT</span> : <span class="muted">no</span>}</td>
              <td class={e.truth === 'attack' ? 'ai-attack' : 'muted'}>{TRUTH_TEXT[e.truth]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
