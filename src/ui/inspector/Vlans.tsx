import { useState } from 'preact/hooks';
import { portLabel } from '../../sim/switchsec';
import { DEFAULT_VLAN, vlanOf } from '../../sim/vlan';
import { ToolMsg, recentlyChanged, type Msg } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A switch's VLANs (segmentation): which VLAN each port is in. With the vlan
 * tool, each port's VLAN is a select that applies right away. Shown on
 * switches with switch security once the student has the tool, or once any
 * port is out of VLAN 1.
 */
export function VlansSection(props: InspectorSectionProps) {
  const { session, dev, has } = props;
  if (dev.kind !== 'switch' || !dev.switchSec) return null;
  const edit = has('vlan') && session.tools.some((t) => t.kind === 'vlan' && t.device === dev.id);
  if (!edit && dev.ifaces.every((i) => vlanOf(dev, i.id) === DEFAULT_VLAN)) return null;
  return <VlansInner {...props} edit={edit} />;
}

function VlansInner({ session, sim, dev, edit }: InspectorSectionProps & { edit: boolean }) {
  const [msg, setMsg] = useState<Msg>(null);
  const spec = session.tools.find((t) => t.kind === 'vlan' && t.device === dev.id);
  const named = new Map<number, string>((spec?.kind === 'vlan' ? spec.vlans ?? [] : []).map((v) => [v.id, v.name]));
  // Offer VLAN 1, the lab's named VLANs, and any other VLAN a port is already in.
  const ids = [...new Set([DEFAULT_VLAN, ...named.keys(), ...dev.ifaces.map((i) => vlanOf(dev, i.id))])].sort((a, b) => a - b);
  const name = (v: number) => (named.has(v) ? `${v} ${named.get(v)}` : String(v));
  const set = (port: string, vlan: number) => {
    session.dispatch({ type: 'set-vlan', device: dev.id, iface: port, vlan });
    const peer = sim.peer(dev.id, port);
    const where = cap(portLabel(port));
    setMsg({
      tone: 'good',
      text: peer
        ? `${where} (${sim.devices[peer.device].label}) is now in VLAN ${vlan}.`
        : `${where} has no cable. Its VLAN still counts: whatever plugs in later lands in VLAN ${vlan}.`,
    });
  };
  return (
    <section class="vlans">
      <h4>
        VLANs <span class="muted">which ports can hear each other</span>
      </h4>
      <table class="table">
        <thead>
          <tr>
            <th>Port</th>
            <th>Goes to</th>
            <th>VLAN</th>
          </tr>
        </thead>
        <tbody>
          {dev.ifaces.map((i) => {
            const peer = sim.peer(dev.id, i.id);
            const v = vlanOf(dev, i.id);
            const flash = recentlyChanged(sim, (e) => e.type === 'config' && e.device === dev.id && e.what === 'vlan' && !!e.detail?.startsWith(`${i.id}=`));
            return (
              <tr key={i.id} class={`vlan-${v} ${flash ? 'flash' : ''}`}>
                <td>{portLabel(i.id)}</td>
                <td>{peer ? sim.devices[peer.device].label : <span class="muted">no cable</span>}</td>
                <td>
                  {edit ? (
                    <select
                      value={String(v)}
                      aria-label={`VLAN for ${portLabel(i.id)}`}
                      onChange={(e) => set(i.id, Number((e.target as HTMLSelectElement).value))}
                    >
                      {ids.map((id) => (
                        <option key={id} value={String(id)}>
                          {name(id)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    name(v)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ToolMsg msg={msg} />
    </section>
  );
}
