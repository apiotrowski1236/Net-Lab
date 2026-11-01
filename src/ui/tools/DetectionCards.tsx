import { aiCounts } from '../../sim/ids';
import { Icon } from '../icons';
import { TOLERANCE_NAME } from '../idsText';
import { triageText } from '../inspector/SiemConsole';
import type { ToolCardProps } from './registry';

// Log Detective (logs): the detection settings live in the inspector. These
// cards say where, and show what's set.

/** The IDS sensor's detection controls. */
export function IdsCard({ session, spec, onSelect }: ToolCardProps<'ids'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  const s = d.ids?.sensor;
  if (!s) return null;
  const has = (c: (typeof spec.controls)[number]) => session.tools.some((t) => t.kind === 'ids' && t.device === d.id && t.controls.includes(c));
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="eye" /> Detection ({d.label})
      </div>
      <p class="tool-desc">
        Choose what the sensor watches for. Change it in {d.label}'s inspector, under <strong>Detection</strong>.
      </p>
      <button class="btn" onClick={() => onSelect(d.id)}>
        <Icon name="sliders" /> Open {d.label}
      </button>
      <ul class="tool-list">
        <li>
          <span>Signature set</span>
          <span class="small">{s.signatures ? 'on' : 'off'}</span>
        </li>
        {has('anomaly') && (
          <li>
            <span>Anomaly detection</span>
            <span class="small">
              {s.anomaly ? `on, ${TOLERANCE_NAME[s.tolerance]}` : 'off'}
              {s.baseline ? '' : ', no baseline'}
            </span>
          </li>
        )}
        {has('prevention') && (
          <li>
            <span>Prevention mode</span>
            <span class="small">{s.prevention ? 'on (IPS)' : 'off (IDS)'}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** The SIEM's incidents and triage. */
export function SiemCard({ session, spec, onSelect }: ToolCardProps<'siem'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  const q = d.ids?.siem;
  if (!q) return null;
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="list" /> SIEM incidents
      </div>
      <p class="tool-desc">
        Read an incident and triage it in {d.label}'s inspector, under <strong>Incidents</strong>. Opening an INCIDENT line in the Logs tab shows it too.
      </p>
      <button class="btn" onClick={() => onSelect(d.id)}>
        <Icon name="sliders" /> Open {d.label}
      </button>
      {q.incidents.length > 0 && (
        <ul class="tool-list">
          {q.incidents.map((inc) => (
            <li key={inc.id}>
              <span>Incident {inc.id}</span>
              <span class="small">{triageText(inc)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The AI model's alert threshold. */
export function AiThresholdCard({ session, spec, onSelect }: ToolCardProps<'ai-threshold'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  const q = d.ids?.siem;
  if (!q) return null;
  const c = aiCounts(q);
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="target" /> AI threshold
      </div>
      <p class="tool-desc">
        Set which AI scores become alerts. Move the slider in {d.label}'s inspector, under <strong>AI threshold</strong>.
      </p>
      <button class="btn" onClick={() => onSelect(d.id)}>
        <Icon name="sliders" /> Open {d.label}
      </button>
      <ul class="tool-list">
        <li>
          <span>Threshold</span>
          <span class="small mono">{q.threshold.toFixed(2)}</span>
        </li>
        {q.ai && (
          <li>
            <span>Results</span>
            <span class="small">
              {c.caught} of {c.attacks} attacks caught, {c.falseAlerts} false alert{c.falseAlerts === 1 ? '' : 's'}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
