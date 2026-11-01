import type { Device } from '../../sim/types';
import type { Sim } from '../../sim/sim';
import { Icon } from '../icons';
import { Toggle } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

/** The links this router has that carry a capacity limit, with the peer at the far end. */
function meteredLinks(sim: Sim, dev: Device): { linkId: string; peer: string; pps: number; cap: number }[] {
  const out: { linkId: string; peer: string; pps: number; cap: number }[] = [];
  for (const i of dev.ifaces) {
    if (!i.linkId) continue;
    const link = sim.links[i.linkId];
    if (!link || link.capacityPps === undefined) continue;
    const peer = sim.peer(dev.id, i.id);
    out.push({
      linkId: link.id,
      peer: peer ? sim.devices[peer.device]?.label ?? peer.device : '?',
      pps: sim.linkPps(link.id),
      cap: link.capacityPps,
    });
  }
  return out;
}

/**
 * This lab's router panel (smurf): a traffic meter on each capacity-limited
 * link, and — on a router that forwards directed broadcasts — the toggle that
 * turns that forwarding off (the fix at the amplifier). Returns nothing for
 * devices that have neither.
 */
export function RouterPanel({ session, sim, dev, replaying, has }: InspectorSectionProps) {
  void session.simRev.value;
  const links = dev.kind === 'router' ? meteredLinks(sim, dev) : [];
  const showMeter = links.length > 0;
  const showToggle = dev.directedBroadcast !== undefined;
  if (!showMeter && !showToggle) return null;
  const canToggle = has('directed-broadcast') && !replaying;
  return (
    <>
      {showMeter && (
        <section>
          <h4>
            Traffic meter <span class="muted">packets per second on each link</span>
          </h4>
          <ul class="meter-list">
            {links.map((l) => {
              const over = l.pps > l.cap;
              const pct = Math.min(100, Math.round((l.pps / l.cap) * 100));
              return (
                <li key={l.linkId} class={`meter-row ${over ? 'over' : ''}`}>
                  <div class="meter-head">
                    <span>to {l.peer}</span>
                    <span class="mono">
                      {l.pps} / {l.cap} pps
                      {over && (
                        <>
                          {' '}
                          <Icon name="warn" size={13} /> full
                        </>
                      )}
                    </span>
                  </div>
                  <div class="meter-track">
                    <span class="meter-fill" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {showToggle && (
        <section>
          <h4>
            Directed broadcasts <span class="muted">forward pings to the whole LAN at once</span>
          </h4>
          <p class="small muted">
            When on, a ping sent to this network's broadcast address is copied to every computer, and each one replies. That's the amplifier a smurf attack needs.
          </p>
          {canToggle ? (
            <Toggle
              on={!!dev.directedBroadcast}
              label={dev.directedBroadcast ? 'Forwarding directed broadcasts (on)' : 'Not forwarding directed broadcasts (off)'}
              onChange={(on) => session.dispatch({ type: 'directed-broadcast', device: dev.id, on })}
            />
          ) : (
            <span class={`pill ${dev.directedBroadcast ? 'warn' : 'good'}`}>{dev.directedBroadcast ? 'On' : 'Off'}</span>
          )}
        </section>
      )}
    </>
  );
}

export const routerPanelSection = { id: 'router-panel', slot: 'settings' as const, Section: RouterPanel };
