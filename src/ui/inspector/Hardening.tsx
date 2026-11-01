import { evaluate, type FwRuleInput } from '../../sim/firewall';
import { serviceOn } from '../../sim/hardening';
import type { Sim } from '../../sim/sim';
import { portLabel, portUp } from '../../sim/switchsec';
import type { Device } from '../../sim/types';
import { VPN_AUTH_LABEL, type VpnAuth } from '../../sim/vpn';
import { Toggle, recentlyChanged } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

const VPN_AUTHS: VpnAuth[] = ['password', 'key', 'mfa'];

/** The rule the "Drop pings from the internet" switch adds, at the top of the list. */
export const DROP_PINGS_RULE: FwRuleInput = { dir: 'in', proto: 'icmp', src: 'any', dst: 'any', dport: 'any', action: 'deny', note: 'Policy: drop pings from the internet' };

/** Does the firewall drop a ping that arrives from the internet for the device itself? */
export function dropsOutsidePings(dev: Device): boolean {
  const fw = dev.firewall;
  const ip = dev.ifaces.find((i) => i.id === fw?.outside)?.ip;
  if (!fw || !ip) return false;
  return evaluate(fw, { src: '192.0.2.1', dst: ip, ttl: 64, proto: 'icmp', app: { kind: 'ping', seq: 0, reply: false } }, 'in').action === 'deny';
}

/** Switch ports with a computer on them, and ports with nothing plugged in. */
export function switchPorts(sim: Sim, sw: Device): { desk: string[]; empty: string[] } {
  const desk: string[] = [];
  const empty: string[] = [];
  for (const i of sw.ifaces) {
    const peer = sim.peer(sw.id, i.id);
    if (!peer) empty.push(i.id);
    else if (sim.devices[peer.device]?.kind === 'host') desk.push(i.id);
  }
  return { desk, empty };
}

/**
 * Security settings (net-audit): the parts of a router, switch, or VPN security
 * policy, as switches. Shows for devices with `Device.hardening` or a VPN
 * server. Editing needs the `hardening` tool for this device. The switches
 * call shared APIs: Telnet and SSH are services (setHardening), the ping
 * switch adds a firewall rule, and the switch policy sets port security.
 */
export function HardeningSection({ session, sim, dev, replaying }: InspectorSectionProps) {
  if (!dev.hardening && !dev.vpn?.server) return null;
  const edit = !replaying && session.tools.some((t) => t.kind === 'hardening' && t.device === dev.id);
  const flash = (what: string) => (recentlyChanged(sim, (e) => e.device === dev.id && e.type === 'config' && e.what.startsWith(what)) ? 'flash' : '');
  return (
    <section class="hardening">
      <h4>
        Security settings <span class="muted">the security policy, applied to this device</span>
      </h4>
      {!edit && !replaying && <p class="small muted">You can look now. The lesson unlocks these settings when it is time to change them.</p>}
      {dev.hardening && dev.kind === 'router' && <RouterSettings session={session} dev={dev} edit={edit} flash={flash} />}
      {dev.hardening && dev.kind === 'switch' && <SwitchSettings session={session} sim={sim} dev={dev} edit={edit} flash={flash} />}
      {dev.vpn?.server && <VpnSettings session={session} dev={dev} edit={edit} flash={flash} />}
    </section>
  );
}

type Part = { session: InspectorSectionProps['session']; dev: Device; edit: boolean; flash: (what: string) => string };

/** One setting: a switch while editing, a read-only state otherwise. */
function Row({ label, on, edit, onChange, onText, offText, why, cls = '' }: { label: string; on: boolean; edit: boolean; onChange: (v: boolean) => void; onText: string; offText: string; why: string; cls?: string }) {
  return (
    <div class={`harden-row ${cls}`}>
      <div class="harden-label">
        <strong>{label}</strong>
        <div class="small muted">{why}</div>
      </div>
      {edit ? <Toggle on={on} label={on ? onText : offText} onChange={onChange} /> : <span class={`pill ${on ? 'info' : 'muted'}`}>{on ? onText : offText}</span>}
    </div>
  );
}

function Logins({ session, dev, edit, flash }: Part) {
  const h = dev.hardening!;
  const acct = h.account;
  const set = (on: boolean) => session.dispatch({ type: 'harden', device: dev.id, setting: 'auth-server', on });
  return (
    <div class={`harden-row ${flash('harden-auth-server')}`}>
      <div class="harden-label">
        <strong>Logins</strong>
        <div class="small muted">
          {h.authServer
            ? 'Every login is checked by the office authentication server. No accounts live on the device.'
            : acct
              ? `A local account lives on the device: "${acct.user}"${acct.factory ? ', still with the factory password' : ''}.`
              : 'Accounts live on the device.'}
        </div>
      </div>
      <div class="seg" role="group" aria-label="Where logins are checked">
        <button class={`btn tiny ${!h.authServer ? 'on' : ''}`} disabled={!edit} aria-pressed={!h.authServer} onClick={() => set(false)}>
          Local account
        </button>
        <button class={`btn tiny ${h.authServer ? 'on' : ''}`} disabled={!edit} aria-pressed={h.authServer} onClick={() => set(true)}>
          Authentication server
        </button>
      </div>
    </div>
  );
}

function RouterSettings(p: Part) {
  const { session, dev, edit, flash } = p;
  const fw = dev.firewall;
  const dropping = dropsOutsidePings(dev);
  const setDrop = (on: boolean) => {
    if (!fw) return;
    if (on) session.dispatch({ type: 'fw-add-rule', device: dev.id, rule: DROP_PINGS_RULE, at: 0 });
    else for (const r of fw.rules.filter((r) => r.dir === 'in' && r.proto === 'icmp' && r.action === 'deny')) session.dispatch({ type: 'fw-delete-rule', device: dev.id, id: r.id });
  };
  return (
    <>
      <div class="harden-group">Remote login</div>
      <Row
        cls={flash('harden-telnet')}
        label="Telnet (port 23)"
        why="Sends everything you type, password included, as plain text."
        on={serviceOn(dev, 'telnet')}
        edit={edit}
        onText="On"
        offText="Off"
        onChange={(on) => session.dispatch({ type: 'harden', device: dev.id, setting: 'telnet', on })}
      />
      <Row
        cls={flash('harden-ssh')}
        label="SSH (port 22)"
        why="The same remote login, inside encryption."
        on={serviceOn(dev, 'ssh')}
        edit={edit}
        onText="On"
        offText="Off"
        onChange={(on) => session.dispatch({ type: 'harden', device: dev.id, setting: 'ssh', on })}
      />
      <Logins {...p} />
      {fw && (
        <>
          <div class="harden-group">Firewall</div>
          <Row
            cls={flash('firewall')}
            label="Drop pings from the internet"
            why={dropping ? 'A firewall rule drops pings that arrive on the internet side.' : 'Anyone online can ping this router and learn the office is there.'}
            on={dropping}
            edit={edit}
            onText="Dropping"
            offText="Answering"
            onChange={setDrop}
          />
        </>
      )}
    </>
  );
}

function SwitchSettings({ sim, ...p }: Part & { sim: Sim }) {
  const { session, dev, edit, flash } = p;
  const ports = dev.switchSec?.ports ?? {};
  const { desk, empty } = switchPorts(sim, dev);
  const secured = desk.length > 0 && desk.every((id) => !!ports[id]?.security);
  const filtered = desk.length > 0 && desk.every((id) => !!ports[id]?.security?.allowed?.length);
  const shut = empty.length > 0 && empty.every((id) => !portUp(dev, id));
  const peerMac = (port: string) => {
    const peer = sim.peer(dev.id, port);
    return peer ? sim.devices[peer.device]?.ifaces.find((i) => i.id === peer.iface)?.mac : undefined;
  };
  const setSecurity = (on: boolean, filter: boolean) => {
    for (const port of desk) {
      const mac = peerMac(port);
      const config = on ? { maxMacs: 1, violation: 'shutdown' as const, ...(filter && mac ? { allowed: [mac] } : {}) } : null;
      session.dispatch({ type: 'port-security', device: dev.id, port, config });
    }
  };
  const setShut = (on: boolean) => {
    for (const port of empty) session.dispatch({ type: 'port-shutdown', device: dev.id, port, shut: on });
  };
  const named = (id: string) => {
    const n = dev.hardening?.portNames?.[id];
    return n ? `${portLabel(id)} (${n})` : portLabel(id);
  };
  return (
    <>
      <Logins {...p} />
      {desk.length > 0 && (
        <>
          <div class="harden-group">Desk ports: {desk.map(portLabel).join(', ')}</div>
          <Row
            cls={flash('port-security')}
            label="Port security"
            why="Each desk port accepts one device. A second MAC address shuts the port down."
            on={secured}
            edit={edit}
            onText="On"
            offText="Off"
            onChange={(on) => setSecurity(on, on && filtered)}
          />
          <Row
            cls={flash('port-security')}
            label="MAC filtering"
            why="Each desk port accepts only the MAC address of the computer plugged in now."
            on={filtered}
            edit={edit}
            onText="On"
            offText="Off"
            onChange={(on) => setSecurity(on || secured, on)}
          />
        </>
      )}
      {empty.length > 0 && (
        <>
          <div class="harden-group">Empty ports: {empty.map(named).join(', ')}</div>
          <Row
            cls={flash('port')}
            label="Shut ports nobody uses"
            why="A shut port carries nothing, even if someone plugs a laptop into the wall jack."
            on={shut}
            edit={edit}
            onText="Shut"
            offText="Live"
            onChange={setShut}
          />
        </>
      )}
    </>
  );
}

function VpnSettings({ session, dev, edit, flash }: Part) {
  const s = dev.vpn!.server!;
  return (
    <>
      <div class="harden-group">VPN</div>
      <Row
        cls={flash('vpn')}
        label="Split tunneling"
        why={
          s.splitTunneling
            ? 'Only office traffic uses the tunnel. The remote computer stays on its home network at the same time.'
            : 'All of the remote computer’s traffic goes through the tunnel. Its home network stays out.'
        }
        on={s.splitTunneling}
        edit={edit}
        onText="Allowed"
        offText="Off"
        onChange={(on) => session.dispatch({ type: 'vpn-config', device: dev.id, splitTunneling: on })}
      />
      <div class={`harden-row ${flash('vpn')}`}>
        <div class="harden-label">
          <strong>Sign-in</strong>
          <div class="small muted">
            {s.auth === 'password' ? 'A password alone. Anyone who learns it can connect.' : s.auth === 'key' ? 'A key file stored on the user’s computer.' : 'A password plus a code from the user’s phone.'}
          </div>
        </div>
        <div class="seg" role="group" aria-label="VPN sign-in">
          {VPN_AUTHS.map((a) => (
            <button key={a} class={`btn tiny ${s.auth === a ? 'on' : ''}`} disabled={!edit} aria-pressed={s.auth === a} onClick={() => session.dispatch({ type: 'vpn-config', device: dev.id, auth: a })}>
              {VPN_AUTH_LABEL[a]}
            </button>
          ))}
        </div>
      </div>
      <div class="harden-row">
        <div class="harden-label">
          <strong>Who may connect</strong>
          <div class="small muted">Roles the policy allows on the VPN.</div>
        </div>
        <span>{s.roles.join(', ') || 'Nobody'}</span>
      </div>
    </>
  );
}
