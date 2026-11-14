import { useEffect, useRef } from 'preact/hooks';
import { portText, protoText } from '../../sim/firewall';
import { UFW_DEFAULT } from '../../sim/ufw';
import { recentlyChanged } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

/**
 * A host-based firewall's rules (device-analysis): the firewall on a computer
 * itself, shaped like the exam's firewall table (number, action, source,
 * destination, direction, port, protocol), with the default policy last.
 * Read-only: students change it with ufw in the Terminal.
 */
export function HostFirewallSection({ session, sim, dev }: InspectorSectionProps) {
  void session.simRev.value;
  const box = useRef<HTMLElement>(null);
  const lastHit = useRef(-1);
  // A lesson button lit a row: bring it into view, once per packet.
  const hitAt = latestHit(sim, dev.id);
  useEffect(() => {
    if (hitAt < 0 || hitAt === lastHit.current) return;
    lastHit.current = hitAt;
    box.current?.querySelector('tr.flash')?.scrollIntoView({ block: 'nearest' });
  }, [hitAt]);
  const fw = dev.firewall;
  if (dev.kind !== 'host' || !fw) return null;
  const policy = dev.linux?.ufw ?? UFW_DEFAULT;
  const terminal = session.tools.some((t) => t.kind === 'terminal' && t.devices.includes(dev.id));
  const hit = (pred: (v: { ruleId?: string; by: string; action: string }) => boolean) => recentlyChanged(sim, (e) => e.type === 'firewall' && e.device === dev.id && pred(e.verdict), 2500);
  const fresh = (i: number) => recentlyChanged(sim, (e) => e.type === 'config' && e.device === dev.id && e.what === 'firewall-rules' && e.detail === `added rule ${i + 1}`, 4000);
  const any = (a: string) => (a === 'any' ? 'Anywhere' : a);
  return (
    <section ref={box} class="fw-section hostfw" data-tools="host-firewall">
      <h4>
        Firewall rules{dev.linux ? ' (ufw)' : ''} <span class="muted">a host-based firewall on {dev.label} itself</span>
      </h4>
      <p class="small fw-dir-note">
        <strong>In</strong> is traffic arriving for {dev.label}. <strong>Out</strong> is traffic {dev.label} starts. Rules are checked from the top, and the first rule that matches decides.
        {dev.linux ? (terminal ? ' Change them with ufw in the Terminal.' : ' The admin changes them with ufw.') : ''}
      </p>
      <div class="fw-table-wrap">
        <table class="table fw-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Action</th>
              <th>Source</th>
              <th>Destination</th>
              <th>Direction</th>
              <th>Port</th>
              <th>Protocol</th>
            </tr>
          </thead>
          <tbody>
            {fw.rules.map((r, i) => (
              <tr key={r.id} class={`${hit((v) => v.ruleId === r.id) ? 'flash' : ''} ${fresh(i) ? 'hostfw-new' : ''}`}>
                <td class="mono">{i + 1}</td>
                <td>
                  <span class={`pill tiny ${r.action === 'allow' ? 'good' : 'bad'}`}>{r.action.toUpperCase()}</span>
                  {r.note && <div class="muted small fw-note">added by {r.note}</div>}
                </td>
                <td class="mono">
                  {any(r.src)}
                  {r.sport !== undefined && r.sport !== 'any' ? <span class="muted"> from port {r.sport}</span> : null}
                </td>
                <td class="mono">{any(r.dst)}</td>
                <td>{r.dir === 'in' ? 'Inbound' : 'Outbound'}</td>
                <td class="mono">{r.proto === 'icmp' ? '' : r.dport === 'any' ? 'Any' : portText(r.dport, r.proto)}</td>
                <td>{r.proto === 'any' ? 'Any' : protoText(r.proto)}</td>
              </tr>
            ))}
            <tr class={`fw-implicit ${hit((v) => v.by === 'implicit' && v.action === policy.in) ? 'flash' : ''}`}>
              <td class="mono">*</td>
              <td colSpan={6} class="small">
                <strong>Default policy:</strong> {policy.in} inbound, {policy.out} outbound. It decides what no rule matches.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** When the last firewall verdict on this device happened, if it was in the last 2.5 seconds. */
function latestHit(sim: InspectorSectionProps['sim'], id: string): number {
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i];
    if (sim.t - e.t > 2500) return -1;
    if (e.type === 'firewall' && e.device === id) return e.t;
  }
  return -1;
}
