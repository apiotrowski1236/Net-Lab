import { useState } from 'preact/hooks';
import { macTableUse } from '../../sim/switchsec';
import { Icon } from '../icons';
import { ToolMsg } from './parts';
import type { ToolCardProps } from './registry';

const BURSTS = [1, 3, 5];
const PER_BURST = 20;

/** MAC flooder (mac-flood): bursts of frames from made-up MACs, to fill a switch's MAC table. */
export function MacFlooder({ session, spec }: ToolCardProps<'mac-flood'>) {
  // Shows the switch's table as it fills: re-render whenever the network changes.
  void session.simRev.value;
  const sim = session.sim;
  const d = sim.devices[spec.device];
  const [bursts, setBursts] = useState(1);
  const iface = d.ifaces.find((i) => i.linkId);
  const peer = iface ? sim.peer(d.id, iface.id) : undefined;
  const sw = peer ? sim.devices[peer.device] : undefined;
  const use = sw?.kind === 'switch' && sw.switchSec ? macTableUse(sw) : undefined;
  return (
    <div class="tool-card attack">
      <div class="tool-title">
        <Icon name="bolt" /> MAC flooder ({d.label})
      </div>
      <p class="tool-desc">
        Send frames from made-up MAC addresses, one right after another. A switch learns every new From MAC, so each one takes a spot
        in its MAC table.
      </p>
      <div class="sentence">
        Send
        <span class="seg" role="group" aria-label="How many bursts">
          {BURSTS.map((n) => (
            <button key={n} class={bursts === n ? 'on' : ''} aria-pressed={bursts === n} onClick={() => setBursts(n)}>
              {n}
            </button>
          ))}
        </span>
        {bursts === 1 ? 'burst' : 'bursts'} of {PER_BURST} frames
      </div>
      <button class="btn" disabled={!iface} onClick={() => session.dispatch({ type: 'mac-flood', device: d.id, bursts })}>
        <Icon name="bolt" /> Flood
      </button>
      {!iface && <ToolMsg msg={{ tone: 'info', text: `${d.label} has no cable yet. Plug in first.` }} />}
      {use && sw && (
        <div class="flood-meter small">
          <span>
            {sw.label} MAC table: <strong>{use.used}</strong> of {use.size} spots used
          </span>
          <span class="meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (100 * use.used) / (use.size ?? (use.used || 1)))}%` }} />
          </span>
        </div>
      )}
    </div>
  );
}
