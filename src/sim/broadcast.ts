import { intToIp, ipToInt, maskBits, type Ip } from './addr';
import type { Device, Iface } from './types';

/**
 * Directed broadcasts (built for `smurf`).
 *
 * Every IPv4 network has one broadcast address: the last address in its range
 * (198.51.100.255 for 198.51.100.0/24). A packet sent there is meant for every
 * device on that network at once. A router that forwards a packet from outside
 * to one of its own networks' broadcast addresses is doing a "directed
 * broadcast" — a setting many routers used to have on, and the thing a smurf
 * attack abuses to turn one ping into a reply from every host.
 *
 * To avoid drawing thirty hosts, a router carries a host count on the LAN's
 * interface (`Iface.lanHosts`). A directed broadcast of an echo request draws
 * that many replies, aggregated into one `Frame.burst` (see burst.ts). The
 * simulator owns the amplification in sim.ts; this module just does the
 * addressing arithmetic.
 */

/** The broadcast address of the network an interface sits on. */
export function broadcastAddr(ip: Ip, prefix: number): Ip {
  const mask = maskBits(prefix);
  return intToIp((((ipToInt(ip) & mask) >>> 0) | ((~mask) >>> 0)) >>> 0);
}

/**
 * The router interface whose LAN broadcast address is `ip`, if the router
 * stands in for a network of hosts there (`lanHosts` set). This is the
 * interface a directed broadcast would be delivered onto.
 */
export function directedBroadcastIface(dev: Device, ip: Ip): Iface | undefined {
  return dev.ifaces.find(
    (i) => i.ip !== undefined && i.prefix !== undefined && i.lanHosts !== undefined && broadcastAddr(i.ip, i.prefix) === ip,
  );
}
