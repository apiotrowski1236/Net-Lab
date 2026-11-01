import { serviceOn } from '../../sim/hardening';
import { VPN_AUTH_LABEL } from '../../sim/vpn';
import { Icon } from '../icons';
import { dropsOutsidePings, switchPorts } from '../inspector/Hardening';
import type { ToolCardProps } from './registry';

/** Security settings (net-audit): the switches live in the device's inspector. This card says so and sums up what is set. */
export function HardeningCard({ session, spec, onSelect }: ToolCardProps<'hardening'>) {
  void session.simRev.value;
  const sim = session.sim;
  const d = sim.devices[spec.device];
  const h = d.hardening;
  const items: [string, string][] = [];
  if (h && d.kind === 'router') {
    items.push(['Telnet', serviceOn(d, 'telnet') ? 'on' : 'off'], ['SSH', serviceOn(d, 'ssh') ? 'on' : 'off']);
    if (d.firewall) items.push(['Pings from the internet', dropsOutsidePings(d) ? 'dropped' : 'answered']);
  }
  if (h && d.kind === 'switch') {
    const { desk, empty } = switchPorts(sim, d);
    const ports = d.switchSec?.ports ?? {};
    const sec = desk.filter((p) => ports[p]?.security).length;
    items.push(['Desk ports with port security', `${sec} of ${desk.length}`], ['Empty ports shut', `${empty.filter((p) => ports[p]?.shutdown).length} of ${empty.length}`]);
  }
  if (h) items.push(['Logins', h.authServer ? 'authentication server' : 'local account']);
  const vpn = d.vpn?.server;
  if (vpn) items.push(['VPN split tunneling', vpn.splitTunneling ? 'allowed' : 'off'], ['VPN sign-in', VPN_AUTH_LABEL[vpn.auth].toLowerCase()]);
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="shield" /> Security settings ({d.label})
      </div>
      <p class="tool-desc">
        Apply the policy to {d.label}. Change it in {d.label}'s inspector, under <strong>Security settings</strong>.
      </p>
      <button class="btn" onClick={() => onSelect(d.id)}>
        <Icon name="sliders" /> Open {d.label}
      </button>
      <ul class="tool-list">
        {items.map(([k, v]) => (
          <li key={k}>
            <span>{k}</span>
            <span class="small">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
