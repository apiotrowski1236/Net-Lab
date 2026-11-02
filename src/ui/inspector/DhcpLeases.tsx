import type { Sim } from '../../sim/sim';
import type { Mac } from '../../sim/addr';
import { recentlyChanged } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

/** How the device with this MAC address is connected right now. */
function connectedBy(sim: Sim, mac: Mac): string {
  const dev = sim.deviceByMac(mac);
  const iface = dev?.ifaces.find((i) => i.mac === mac);
  const link = iface?.linkId ? sim.links[iface.linkId] : undefined;
  if (!link) return 'not connected';
  return link.wireless ? 'Wi-Fi' : 'cable';
}

/**
 * Connected devices (home-network): a router's DHCP leases, one row per
 * device it handed an address to. See src/sim/dhcp.ts.
 */
export function DhcpLeases({ session, sim, dev }: InspectorSectionProps) {
  void session.simRev.value;
  const server = dev.dhcp?.server;
  if (dev.kind !== 'router' || !server) return null;
  const port = dev.ifaces.find((i) => i.id === server.iface);
  return (
    <section class="dhcp-leases">
      <h4>
        Connected devices <span class="muted">the IP addresses this router handed out</span>
      </h4>
      <p class="small muted">
        It hands out {server.from} to {server.to}, and tells each device its default gateway: {port?.ip ?? 'this router'}.
      </p>
      {server.leases.length === 0 ? (
        <p class="muted small">Empty. No device has asked for an address yet.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Device</th>
              <th>MAC address</th>
              <th>IP address</th>
              <th>Connected by</th>
            </tr>
          </thead>
          <tbody>
            {server.leases.map((l) => {
              const flash = recentlyChanged(sim, (e) => e.type === 'dhcp' && e.device === dev.id && e.what === 'ack' && e.mac === l.mac);
              const how = connectedBy(sim, l.mac);
              return (
                <tr key={l.mac} class={flash ? 'flash' : ''}>
                  <td>{l.name}</td>
                  <td class="mono">{l.mac}</td>
                  <td class="mono">{l.ip}</td>
                  <td class={how === 'not connected' ? 'muted' : ''}>{how}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export const dhcpLeasesSection = { id: 'dhcp-leases', slot: 'settings' as const, Section: DhcpLeases };
