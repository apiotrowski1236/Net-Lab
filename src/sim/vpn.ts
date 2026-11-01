import type { Ip } from './addr';
import type { IpPacket } from './types';

/**
 * A remote-access VPN with split tunneling (built for `net-audit`).
 *
 * A **VPN** is an encrypted tunnel from a remote computer into the office
 * network. The simulation draws the tunnel as a dashed line (`Link.tunnel`)
 * between the remote computer's `vpn` port and the office router's `vpn`
 * port. Packets cross it in one hop; the internet in between and the
 * encryption are not modeled, only where traffic is allowed to go.
 *
 * The router holds the policy (`VpnState.server`): split tunneling on or off,
 * and how users sign in. The remote computer holds the client
 * (`VpnState.client`), which follows the server's policy:
 *
 *  - **Split tunneling on:** office traffic goes through the tunnel, and
 *    everything else goes straight out the home network (the client's default
 *    gateway is the home router). The laptop sits on both networks at once,
 *    and in this simulation it also carries packets from other devices on the
 *    home network into the tunnel (a home device using it as a way in). It
 *    rewrites their source address to its own tunnel address, as a computer
 *    sharing its connection does, and passes the replies back.
 *  - **Split tunneling off (full tunnel):** all of the laptop's traffic goes
 *    through the tunnel (its default gateway is the office end), and the client
 *    refuses traffic from the home network: dropped with reason 'vpn-split-off'.
 *
 * Sim method: `setVpn(router, { splitTunneling?, auth? })`, which also moves
 * each client's default gateway. Action: `vpn-config`. Settings live in the
 * router's `hardening` inspector section.
 */

/** How VPN users prove who they are. */
export type VpnAuth = 'password' | 'key' | 'mfa';

export const VPN_AUTH_LABEL: Record<VpnAuth, string> = {
  password: 'Password only',
  key: 'Key file',
  mfa: 'Password + MFA',
};

export interface VpnServer {
  splitTunneling: boolean;
  auth: VpnAuth;
  /** Roles allowed to connect, for the policy display ("Bookkeeper"). */
  roles: string[];
  /** The router's port the tunnels arrive on. */
  iface: string;
}

export interface VpnClient {
  /** The VPN server's device id. */
  server: string;
  /** This computer's tunnel port. */
  iface: string;
  /** The default gateway on the home network, used while split tunneling is on. */
  homeGateway: Ip;
  /** Home devices whose packets this client carried into the tunnel: key (see natKey) -> their real address. */
  nat: Record<string, Ip>;
}

export interface VpnState {
  server?: VpnServer;
  client?: VpnClient;
}

/** The key that matches a relayed request to its reply: the ping number or the connection id. */
export function natKey(pkt: IpPacket): string | undefined {
  const a = pkt.app;
  if (a.kind === 'ping') return `icmp:${a.seq}`;
  if (a.kind === 'svc' && a.conn) return `svc:${a.conn}`;
  return undefined;
}

/** What a scanner reports about a VPN's policy, as verb phrases ("allows split tunneling"). Empty when it meets policy. */
export function vpnWeaknesses(s: VpnServer): string[] {
  const out: string[] = [];
  if (s.splitTunneling) out.push('allows split tunneling');
  if (s.auth === 'password') out.push('accepts a password alone');
  return out;
}
