import { useState } from 'preact/hooks';
import { checkNewMac } from '../../runtime/switchInput';
import { Icon } from '../icons';
import { ToolMsg, type Msg } from './parts';
import type { ToolCardProps } from './registry';

/** MAC changer (mac-flood): set the MAC a device's network card sends, or put back the factory one. */
export function MacChanger({ session, spec }: ToolCardProps<'mac-change'>) {
  void session.simRev.value;
  const sim = session.sim;
  const d = sim.devices[spec.device];
  const iface = d.ifaces[0];
  const factory = iface.factoryMac ?? iface.mac;
  const changed = iface.mac !== factory;
  const [mac, setMac] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const change = () => {
    const r = checkNewMac(sim, d.id, mac);
    if (!r.ok) return setMsg({ tone: 'bad', text: r.msg });
    session.dispatch({ type: 'set-mac', device: d.id, mac: r.mac });
    setMac('');
    const owner = Object.values(sim.devices).find((x) => x.id !== d.id && x.ifaces.some((i) => i.mac === r.mac));
    setMsg({ tone: 'good', text: `Done. ${d.label}'s frames now say they come from ${r.mac}${owner ? `, the same MAC as ${owner.label}` : ''}.` });
  };
  const restore = () => {
    session.dispatch({ type: 'set-mac', device: d.id, mac: null });
    setMsg({ tone: 'info', text: `${d.label} is back to its factory MAC.` });
  };
  return (
    <div class="tool-card attack">
      <div class="tool-title">
        <Icon name="sliders" /> MAC changer ({d.label})
      </div>
      <p class="tool-desc">A network card gets its MAC at the factory, but software decides which MAC goes in each frame. Nothing checks it.</p>
      <ul class="tool-list">
        <li>
          <span>Factory MAC</span>
          <span class="mono">{factory}</span>
        </li>
        <li>
          <span>Sending now</span>
          <span class="mono">
            {iface.mac} {changed && <span class="pill bad">changed</span>}
          </span>
        </li>
      </ul>
      <div class="sentence" style={{ marginTop: '10px' }}>
        Use
        <input
          class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
          value={mac}
          placeholder="MAC address"
          autoComplete="off"
          spellcheck={false}
          size={19}
          aria-label="New MAC address"
          onInput={(e) => {
            setMac((e.target as HTMLInputElement).value);
            setMsg(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && change()}
        />
        <button class="btn" onClick={change}>
          Change MAC
        </button>
      </div>
      <ToolMsg msg={msg} />
      {changed && (
        <button class="btn ghost small" onClick={restore}>
          <Icon name="reset" /> Put back the factory MAC
        </button>
      )}
    </div>
  );
}
