import { useState } from 'preact/hooks';
import { cellKey, cellValue, isPolicyValue, onlyPort, pairName, type PolicyValue, type PolicyZone, type ZonePolicy } from '../../sim/zonePolicy';
import { LEVEL_NAME, type ZoneLevel } from '../../sim/zones';
import { ToolMsg, recentlyChanged, type Msg } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

function valueText(to: PolicyZone, v: PolicyValue): string {
  if (v === 'allow') return 'Allow all';
  if (v === 'deny') return 'Deny';
  const port = onlyPort(v)!;
  const s = to.services.find((x) => x.port === port);
  return `Only ${s ? s.name : 'port'} (port ${port})`;
}

function options(to: PolicyZone): { value: PolicyValue; text: string }[] {
  const vals: PolicyValue[] = ['allow', 'deny', ...to.services.map((s): PolicyValue => `only:${s.port}`)];
  return vals.map((value) => ({ value, text: valueText(to, value) }));
}

/** "Shore link" -> "the shore link". */
const the = (label: string) => `the ${label.charAt(0).toLowerCase()}${label.slice(1)}`;

/**
 * A firewall's zone policy (segmentation): which zone may start connections to
 * which, as a table with one row per "from" zone. Each change rewrites the
 * firewall's rules (see src/sim/zonePolicy.ts), which the rules section below
 * lists. Shown once a step has handed out the zone-policy tool for this device.
 */
export function ZonePolicySection(props: InspectorSectionProps) {
  const { session, dev } = props;
  // Read-only after the step that sets it, so later steps can still show it.
  if (!dev.zonePolicy || !session.introduced().some((t) => t.kind === 'zone-policy' && t.device === dev.id)) return null;
  return <ZonePolicyInner {...props} zp={dev.zonePolicy} />;
}

function ZonePolicyInner({ session, sim, dev, has, zp }: InspectorSectionProps & { zp: ZonePolicy }) {
  const [msg, setMsg] = useState<Msg>(null);
  const edit = has('zone-policy');
  const set = (from: PolicyZone, to: PolicyZone, raw: string) => {
    if (!isPolicyValue(raw)) return;
    session.dispatch({ type: 'set-zone-policy', device: dev.id, from: from.id, to: to.id, value: raw });
    const warn = raw === 'allow' && from.allowWarning;
    setMsg(
      warn
        ? { tone: 'info', text: `Saved. ${warn.replace('{to}', to.label)}` }
        : { tone: 'good', text: `Saved. ${pairName(zp, from.id, to.id)}: ${valueText(to, raw)}.` },
    );
  };
  const level = (z: PolicyZone) => {
    const l = sim.zoneLevels[z.id] as ZoneLevel | undefined;
    return l ? LEVEL_NAME[l] : '';
  };
  return (
    <section class="zone-policy">
      <h4>
        Zone policy <span class="muted">which zone may start connections to which</span>
      </h4>
      <table class="table zone-grid">
        <thead>
          <tr>
            <th class="corner">
              <span class="small muted">To →</span>
            </th>
            {zp.zones.map((z) => (
              <th key={z.id} scope="col">
                {z.label}
                {level(z) && <div class={`small zone-level level-${sim.zoneLevels[z.id]}`}>{level(z)}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zp.zones.map((a) => (
            <tr key={a.id}>
              <th scope="row">From {a.label}</th>
              {zp.zones.map((b) => {
                if (a.id === b.id) {
                  return (
                    <td key={b.id} class="same-zone" title="Traffic inside a zone never reaches the firewall.">
                      Same zone
                    </td>
                  );
                }
                const v = cellValue(zp, a.id, b.id);
                const flash = recentlyChanged(sim, (e) => e.type === 'config' && e.device === dev.id && e.what === 'zone-policy' && !!e.detail?.startsWith(`${cellKey(a.id, b.id)}=`));
                return (
                  <td key={b.id} class={`cell-${v === 'allow' ? 'allow' : v === 'deny' ? 'deny' : 'only'} ${flash ? 'flash' : ''}`}>
                    {edit ? (
                      <select value={v} aria-label={pairName(zp, a.id, b.id)} onChange={(e) => set(a, b, (e.target as HTMLSelectElement).value)}>
                        {options(b).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.text}
                          </option>
                        ))}
                      </select>
                    ) : (
                      valueText(b, v)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {zp.outside && <p class="small">{zp.outside.label}: nothing from {the(zp.outside.label)} may start a connection inside.</p>}
      <p class="muted small">A reply to an allowed connection always gets back. The firewall rules below are written from this table.</p>
      <ToolMsg msg={msg} />
    </section>
  );
}
