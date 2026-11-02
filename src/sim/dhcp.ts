import { intToIp, ipToInt, type Ip, type Mac } from './addr';

/**
 * DHCP: a router hands out IP addresses (built for `home-network`).
 *
 * A **DHCP server** runs on one router port (`DhcpState.server`). It owns a
 * pool of addresses and a lease table: which MAC address got which IP address,
 * the device's name, and when. A **DHCP client** (`DhcpState.client`) is a
 * computer set to get its address automatically.
 *
 * When a client's link comes up (a cable is plugged in, or it joins Wi-Fi), it
 * asks for an address with four messages, carried as `Frame.dhcp`:
 *
 *   1. Discover (broadcast): "Can someone give me an IP address?"
 *   2. Offer (to the client's MAC): "You can have this one."
 *   3. Request (broadcast): "I'll take it."
 *   4. Ack (to the client's MAC): "It's yours", with the prefix and the
 *      default gateway (the server's own port address).
 *
 * The server offers the address it already leased to that MAC, so a device
 * that rejoins gets the same address back; otherwise the lowest free address
 * in the pool (skipping any address a device already uses). When the client's
 * link goes down, it drops its address and gateway.
 *
 * Simplifications (the lesson says so): real DHCP rides in UDP inside IP
 * (ports 68 and 67); here the frame carries only the DHCP fields, and the
 * capture shows the IP addresses a real one would have (0.0.0.0 to
 * 255.255.255.255 for the broadcasts). Leases never expire, a rejoining client
 * always sends all four messages (real ones often skip to Request), there are
 * no retries, and a server ignores a Request it can't grant instead of
 * answering with a NAK.
 *
 * Sim: `dhcpStart` (ask now), hooks in `connect`/`disconnect` and Wi-Fi
 * association, and `dhcpLeases` for the inspector. Events `type: 'dhcp'`; log
 * source `dhcp` on the server. NetBuilder: host option `dhcp: true`, router
 * option `dhcp: { iface, from, to }`. Inspector section `dhcp-leases`
 * ("Connected devices").
 */

export type DhcpOp = 'discover' | 'offer' | 'request' | 'ack';

/** One DHCP message, carried as `Frame.dhcp`. */
export interface DhcpMessage {
  op: DhcpOp;
  /** Transaction ID: ties the four messages of one exchange together. */
  xid: number;
  /** The client's MAC address. */
  client: Mac;
  /** The client's device name (the hostname a real client sends). */
  name?: string;
  /** Offer, Request, Ack: the address being handed out. */
  ip?: Ip;
  prefix?: number;
  /** Offer and Ack: the default gateway the client should use. */
  gateway?: Ip;
  /** The server's address (Offer and Ack send from it; Request names it). */
  server?: Ip;
}

export interface DhcpLease {
  mac: Mac;
  ip: Ip;
  /** The name the device gave when it asked. */
  name: string;
  /** When the lease was granted (or last renewed). */
  t: number;
}

export interface DhcpServer {
  /** The router port it serves. Its address is the gateway it hands out. */
  iface: string;
  /** First and last address in the pool. */
  from: Ip;
  to: Ip;
  /** Leases, oldest first. */
  leases: DhcpLease[];
  /** Addresses offered and not yet requested, so two devices asking at once get different ones. */
  offered: { mac: Mac; ip: Ip }[];
}

export interface DhcpClient {
  /** The port it gets an address for. */
  iface: string;
  state: 'idle' | 'selecting' | 'requesting' | 'bound';
  /** The exchange in progress. */
  xid?: number;
  /** The address offered (requesting) or bound. */
  ip?: Ip;
}

/** Lives on `Device.dhcp`. A device can be a server, a client, or (in principle) both. */
export interface DhcpState {
  server?: DhcpServer;
  client?: DhcpClient;
}

export function newDhcpServer(iface: string, from: Ip, to: Ip): DhcpServer {
  return { iface, from, to, leases: [], offered: [] };
}

export function newDhcpClient(iface = 'eth0'): DhcpClient {
  return { iface, state: 'idle' };
}

/** How many addresses the pool holds. */
export function poolSize(s: DhcpServer): number {
  return ipToInt(s.to) - ipToInt(s.from) + 1;
}

export function inPool(s: DhcpServer, ip: Ip): boolean {
  const n = ipToInt(ip);
  return n >= ipToInt(s.from) && n <= ipToInt(s.to);
}

/**
 * The address to offer `mac`: the one it already has a lease for, else the
 * lowest pool address that is neither leased nor in `used` (addresses devices
 * already have). Undefined when the pool is full.
 */
export function pickAddress(s: DhcpServer, mac: Mac, used: Set<Ip>): Ip | undefined {
  const mine = s.leases.find((l) => l.mac === mac) ?? s.offered.find((o) => o.mac === mac);
  if (mine) return mine.ip;
  const taken = new Set([...s.leases.map((l) => l.ip), ...s.offered.map((o) => o.ip)]);
  for (let n = ipToInt(s.from); n <= ipToInt(s.to); n++) {
    const ip = intToIp(n);
    if (!taken.has(ip) && !used.has(ip)) return ip;
  }
  return undefined;
}

/** Can `mac` have `ip`? It must be in the pool, and not leased or offered to another MAC. */
export function canGrant(s: DhcpServer, mac: Mac, ip: Ip): boolean {
  if (!inPool(s, ip)) return false;
  const holder = s.leases.find((l) => l.ip === ip) ?? s.offered.find((o) => o.ip === ip);
  return !holder || holder.mac === mac;
}

/** Hold `ip` for `mac` until it asks for it (replacing an earlier offer to that MAC). */
export function offer(s: DhcpServer, mac: Mac, ip: Ip): void {
  s.offered = [...s.offered.filter((o) => o.mac !== mac), { mac, ip }];
}

/** Record (or renew) a lease. */
export function grant(s: DhcpServer, lease: DhcpLease): void {
  s.leases = s.leases.filter((l) => l.mac !== lease.mac && l.ip !== lease.ip);
  s.leases.push(lease);
  s.offered = s.offered.filter((o) => o.mac !== lease.mac);
}

export const DHCP_OP_LABEL: Record<DhcpOp, string> = {
  discover: 'Discover',
  offer: 'Offer',
  request: 'Request',
  ack: 'Ack',
};

/** True for the messages a client sends (as broadcasts). */
export function fromClient(m: DhcpMessage): boolean {
  return m.op === 'discover' || m.op === 'request';
}

/** The message in plain words, like a capture's Info column. */
export function dhcpSays(m: DhcpMessage): string {
  switch (m.op) {
    case 'discover':
      return 'Discover: can someone give me an IP address?';
    case 'offer':
      return `Offer: you can have ${m.ip}`;
    case 'request':
      return `Request: I'll take ${m.ip}`;
    case 'ack':
      return `Ack: ${m.ip} is yours`;
  }
}

/** The IP addresses a real DHCP message would carry: from 0.0.0.0 to everyone, or from the server to the address offered. */
export function dhcpIps(m: DhcpMessage): { src: Ip; dst: Ip } {
  return fromClient(m) ? { src: '0.0.0.0', dst: '255.255.255.255' } : { src: m.server ?? '0.0.0.0', dst: m.ip ?? '255.255.255.255' };
}
