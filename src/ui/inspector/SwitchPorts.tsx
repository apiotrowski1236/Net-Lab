import { useState } from 'preact/hooks';
import { checkPortSecurity } from '../../runtime/switchInput';
import { macsOnPort, macTableUse, portLabel, type PortSecurityConfig, type SwitchPort } from '../../sim/switchsec';
import type { Device } from '../../sim/types';
import { Toggle, ToolMsg, recentlyChanged, type Msg } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

/** A port with this many MACs or more stands out in the table: a PC or printer has one. */
const MANY_MACS = 4;

function securityText(p: SwitchPort | undefined): string {
  const s = p?.security;
  if (!s) return 'off';
  const who = s.allowed ? `only ${s.allowed.length === 1 ? s.allowed[0] : `${s.allowed.length} listed MACs`}` : `at most ${s.maxMacs} MAC${s.maxMacs === 1 ? '' : 's'}`;
  return `${who}, then ${s.violation === 'shutdown' ? 'shut down' : 'drop'}`;
}

function State({ dev, port }: { dev: Device; port: string }) {
  const p = dev.switchSec?.ports[port];
  const cabled = !!dev.ifaces.find((i) => i.id === port)?.linkId;
  if (p?.shutdown === 'violation') return <span class="pill bad">shut by port security</span>;
  if (p?.shutdown === 'admin') return <span class="pill">shut down</span>;
  if (!cabled) return <span class="muted">no cable</span>;
  return <span class="pill good">on</span>;
}

/**
 * Switch ports with port security (mac-flood): how full the MAC table is,
 * what each port is doing, and (with the port-security tool) the settings
 * for one port. Only for switches with switch security (sim.configureSwitch).
 */
export function SwitchPorts(props: InspectorSectionProps) {
  if (props.dev.kind !== 'switch' || !props.dev.switchSec) return null;
  return <SwitchPortsInner {...props} />;
}

function SwitchPortsInner({ session, sim, dev, has }: InspectorSectionProps) {
  const edit = has('port-security');
  const [sel, setSel] = useState<string | null>(null);
  const use = macTableUse(dev);
  const full = use.size !== undefined && use.used >= use.size;
  return (
    <section class="switch-ports">
      <h4>
        Ports and port security <span class="muted">what each port is doing</span>
      </h4>
      {use.size !== undefined && (
        <div class={`flood-meter ${full ? 'full' : ''}`}>
          <span>
            MAC table: <strong>{use.used}</strong> of {use.size} spots used
            {full && <span class="pill bad">full</span>}
          </span>
          <span class="meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (100 * use.used) / use.size)}%` }} />
          </span>
        </div>
      )}
      <table class="table">
        <thead>
          <tr>
            <th>Port</th>
            <th>Goes to</th>
            <th title="MAC addresses the switch has learned on this port">MACs</th>
            <th title="Frames that came in this port">Frames in</th>
            <th>State</th>
            {edit && <th />}
          </tr>
        </thead>
        <tbody>
          {dev.ifaces.map((i) => {
            const peer = sim.peer(dev.id, i.id);
            const n = macsOnPort(dev, i.id).length;
            const p = dev.switchSec?.ports[i.id];
            const flash = recentlyChanged(sim, (e) => e.device === dev.id && (e.type === 'port-security' || (e.type === 'config' && (e.what === 'port' || e.what === 'port-security'))) && (('iface' in e && e.iface === i.id) || ('detail' in e && !!e.detail?.startsWith(i.id))));
            return (
              <tr key={i.id} class={`${n >= MANY_MACS ? 'dup' : ''} ${flash ? 'flash' : ''} ${sel === i.id ? 'selected' : ''}`}>
                <td>{portLabel(i.id)}</td>
                <td>{peer ? sim.devices[peer.device].label : <span class="muted">nothing</span>}</td>
                <td class="num">{n}</td>
                <td class="num">{p?.framesIn ?? 0}</td>
                <td>
                  <State dev={dev} port={i.id} />
                  {p?.security && <div class="small muted">{securityText(p)}</div>}
                </td>
                {edit && (
                  <td class="row-action">
                    <button class="btn tiny ghost" aria-expanded={sel === i.id} onClick={() => setSel(sel === i.id ? null : i.id)}>
                      {sel === i.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {edit && !sel && <p class="muted small">Choose Edit on a port to change its port security or shut it down.</p>}
      {edit && sel && <PortEditor key={sel} session={session} dev={dev} port={sel} />}
    </section>
  );
}

function PortEditor({ session, dev, port }: { session: InspectorSectionProps['session']; dev: Device; port: string }) {
  const sim = session.sim;
  const p = dev.switchSec?.ports[port];
  const cur = p?.security;
  const [on, setOn] = useState(!!cur);
  const [max, setMax] = useState(String(cur?.maxMacs ?? 1));
  const [violation, setViolation] = useState<PortSecurityConfig['violation']>(cur?.violation ?? 'shutdown');
  const [allowed, setAllowed] = useState((cur?.allowed ?? []).join(' '));
  const [msg, setMsg] = useState<Msg>(null);
  const where = portLabel(port);
  const save = () => {
    if (!on) {
      if (!cur) return setMsg({ tone: 'info', text: `Port security is already off on ${where}.` });
      session.dispatch({ type: 'port-security', device: dev.id, port, config: null });
      return setMsg({ tone: 'info', text: `Port security is off on ${where}. Any device can use it.` });
    }
    const r = checkPortSecurity(sim, dev.id, port, max, violation, allowed);
    if (!r.ok) return setMsg({ tone: 'bad', text: r.msg, field: r.field });
    session.dispatch({ type: 'port-security', device: dev.id, port, config: r.config });
    const c = r.config;
    const who = c.allowed ? `only ${c.allowed.join(', ')}` : `at most ${c.maxMacs} MAC${c.maxMacs === 1 ? '' : 's'}`;
    setMsg({ tone: 'good', text: `Saved. ${where} allows ${who}. Anything else ${c.violation === 'shutdown' ? 'shuts the port down' : 'gets dropped'}.` });
  };
  const shut = !!p?.shutdown;
  const toggleShut = () => {
    session.dispatch({ type: 'port-shutdown', device: dev.id, port, shut: !shut });
    setMsg({ tone: 'info', text: shut ? `${where} is on again.` : `${where} is shut down. It carries nothing until you turn it back on.` });
  };
  const bad = (f: string) => (msg?.tone === 'bad' && msg.field === f ? 'invalid' : '');
  return (
    <div class="port-edit">
      <div class="port-edit-head">
        <strong>{where}</strong>
        <button class="btn small" onClick={toggleShut}>
          {shut ? 'Turn port on' : 'Shut port down'}
        </button>
      </div>
      <Toggle on={on} label={on ? 'Port security on' : 'Port security off'} onChange={(v) => (setOn(v), setMsg(null))} />
      {on && (
        <div class="port-edit-fields">
          <label>
            <span>Most MACs</span>
            <input
              class={`mono ${bad('max')}`}
              value={max}
              inputMode="numeric"
              size={3}
              onInput={(e) => (setMax((e.target as HTMLInputElement).value), setMsg(null))}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>
          <label>
            <span>If another MAC shows up</span>
            <select value={violation} onChange={(e) => setViolation((e.target as HTMLSelectElement).value as PortSecurityConfig['violation'])}>
              <option value="shutdown">Shut the port down</option>
              <option value="restrict">Drop its frames, keep the port on</option>
            </select>
          </label>
          <label class="wide">
            <span>
              Only these MACs <span class="muted">(MAC filtering, optional)</span>
            </span>
            <input
              class={`mono ${bad('allowed')}`}
              value={allowed}
              placeholder="Empty: the first MACs seen"
              autoComplete="off"
              spellcheck={false}
              onInput={(e) => (setAllowed((e.target as HTMLInputElement).value), setMsg(null))}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </label>
        </div>
      )}
      <ToolMsg msg={msg} />
      <button class="btn" onClick={save}>
        Save {where}
      </button>
    </div>
  );
}
