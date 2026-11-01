import type { IdsControl, ToolSpec } from '../../labs/types';
import { SIGNATURES, TOLERANCES, megabytes, type IdsSensor } from '../../sim/ids';
import type { Device } from '../../sim/types';
import { clockTime } from '../LogsView';
import { TOLERANCE_NAME, deviationWhy, toleranceText } from '../idsText';
import { Toggle, recentlyChanged } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

/** Which detection controls the student has for this sensor, from the 'ids' tools they have. */
export function idsControls(tools: ToolSpec[], devId: string): Set<IdsControl> {
  const out = new Set<IdsControl>();
  for (const t of tools) if (t.kind === 'ids' && t.device === devId) for (const c of t.controls) out.add(c);
  return out;
}

const TOLERANCE_BLURB = {
  loose: 'Lets more through. Fewer false alerts, more missed attacks.',
  medium: 'A balance.',
  strict: 'Flags more. Fewer missed attacks, more false alerts.',
};

function OnOff({ on }: { on: boolean }) {
  return <span class={`pill tiny ${on ? 'good' : ''}`}>{on ? 'on' : 'off'}</span>;
}

/**
 * An IDS sensor's detection (logs lab): the signature set, anomaly detection
 * with its tolerance and baseline, prevention mode, and its latest alerts.
 * The 'ids' tool reveals the controls one group at a time.
 */
export function Detection({ session, sim, dev, replaying }: InspectorSectionProps) {
  const s = dev.ids?.sensor;
  if (!s) return null;
  const can = idsControls(session.tools, dev.id);
  const edit = (c: IdsControl) => can.has(c) && !replaying;
  const flash = (what: string) => (recentlyChanged(sim, (e) => e.type === 'config' && e.device === dev.id && e.what === what, 2500) ? 'flash' : '');
  return (
    <section class="ids-section">
      <h4>
        Detection <span class="muted">what the sensor watches for</span>
      </h4>

      <div class={`ids-group ${flash('ids-signatures')}`}>
        {edit('signatures') ? (
          <Toggle on={s.signatures} label={`Signature set (${s.rules} rules)`} onChange={(on) => session.dispatch({ type: 'ids-signatures', device: dev.id, on })} />
        ) : (
          <div class="ids-row">
            <span>Signature set ({s.rules} rules)</span> <OnOff on={s.signatures} />
          </div>
        )}
        <p class="small muted">Matches traffic against stored patterns of known attacks. Some of the rules:</p>
        <ul class="ids-sigs small">
          {SIGNATURES.map((g) => (
            <li key={g.id}>
              <span class="mono">{g.id}</span> {g.text}
            </li>
          ))}
        </ul>
      </div>

      {(can.has('anomaly') || s.anomaly || s.baseline) && (
        <div class={`ids-group ${flash('ids-anomaly')} ${flash('ids-baseline')}`}>
          {edit('anomaly') ? (
            <Toggle on={s.anomaly} label="Anomaly detection" onChange={(on) => session.dispatch({ type: 'ids-anomaly', device: dev.id, on, tolerance: s.tolerance })} />
          ) : (
            <div class="ids-row">
              <span>Anomaly detection</span> <OnOff on={s.anomaly} />
            </div>
          )}
          <p class="small muted">
            Scores each connection against the baseline: +1 outside office hours, +1 to an address the computer never uses, +1 for an upload over 10 times its usual size.
          </p>
          <div class="ids-row">
            <span class="small">Tolerance:</span>
            {edit('anomaly') ? (
              <div class="seg" role="group" aria-label="Anomaly tolerance">
                {TOLERANCES.map((t) => (
                  <button
                    key={t}
                    class={s.tolerance === t ? 'on' : ''}
                    aria-pressed={s.tolerance === t}
                    onClick={() => s.tolerance !== t && session.dispatch({ type: 'ids-anomaly', device: dev.id, on: s.anomaly, tolerance: t })}
                  >
                    {TOLERANCE_NAME[t]}
                  </button>
                ))}
              </div>
            ) : (
              <span class="pill info tiny">{TOLERANCE_NAME[s.tolerance]}</span>
            )}
          </div>
          <p class="small">
            {toleranceText(s.tolerance)}. <span class="muted">{TOLERANCE_BLURB[s.tolerance]}</span>
          </p>
          <BaselineNote s={s} clock={session.lab.clock} />
          {s.judged.length > 0 && <Judged dev={dev} s={s} />}
        </div>
      )}

      {(can.has('prevention') || s.prevention) && (
        <div class={`ids-group ${flash('ids-prevention')}`}>
          {edit('prevention') ? (
            <Toggle on={s.prevention} label="Prevention mode (IPS)" onChange={(on) => session.dispatch({ type: 'ids-prevention', device: dev.id, on })} />
          ) : (
            <div class="ids-row">
              <span>Prevention mode (IPS)</span> <OnOff on={s.prevention} />
            </div>
          )}
          <p class="small muted">
            {s.prevention
              ? 'Acts on its own alerts: shuts the switch port a flood comes from, or blocks the address at the firewall.'
              : 'Off: the sensor only raises alerts (an IDS). On, it acts on them (an IPS).'}
          </p>
        </div>
      )}

      <Alerts dev={dev} clock={session.lab.clock} />
    </section>
  );
}

function BaselineNote({ s, clock }: { s: IdsSensor; clock?: string }) {
  const b = s.baseline;
  if (!b) return <p class="small callout warn">No baseline yet. Anomaly detection needs one to know what normal looks like.</p>;
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <p class="small">
      Baseline: {Object.keys(b.peers).length} computers, office hours {pad(b.hours[0])} to {pad(b.hours[1])}
      {b.recordedAt !== undefined && <span class="muted"> (recorded {clockTime(b.recordedAt, clock).slice(0, 5)})</span>}.
    </p>
  );
}

/** The latest connections anomaly detection scored. */
function Judged({ dev, s }: { dev: Device; s: IdsSensor }) {
  const rows = s.judged.slice(-4).reverse();
  return (
    <table class="table ids-judged small" aria-label={`${dev.label}'s latest anomaly scores`}>
      <thead>
        <tr>
          <th>Connection</th>
          <th>Why</th>
          <th>Deviation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((j, i) => (
          <tr key={i}>
            <td class="mono">
              {j.host} to {j.peer}
              {j.bytes ? `, ${megabytes(j.bytes)}` : ''}
            </td>
            <td>{deviationWhy(j)}</td>
            <td>
              {j.deviation} {j.alerted ? <span class="pill tiny bad">ALERT</span> : <span class="muted">below {j.min}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Alerts({ dev, clock }: { dev: Device; clock?: string }) {
  const alerts = dev.logs.filter((e) => e.level === 'alert').slice(-5).reverse();
  return (
    <div class="ids-group">
      <div class="small">
        <strong>Latest alerts</strong>
      </div>
      {alerts.length === 0 ? (
        <p class="small muted">None.</p>
      ) : (
        <ul class="ids-alerts small">
          {alerts.map((e) => (
            <li key={e.no}>
              <span class="mono muted">{clockTime(e.t, clock).slice(0, 8)}</span> <span class="mono">{e.msg}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
