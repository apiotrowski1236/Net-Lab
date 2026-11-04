import type { Ip } from './addr';
import type { IpPacket } from './types';

/**
 * NAT: one public address shared by a whole home network (built for
 * `home-network`; written so the firewall lab and others can reuse it).
 *
 * A router with `Device.nat` shares the address of its **outside** port (the
 * one facing the internet) with every device behind it:
 *
 *  - **Out.** A packet the router forwards out the outside port, from any
 *    address not on the outside network, leaves with the outside address as its
 *    "from" address and a fresh **public port** (counting up from
 *    `NAT_FIRST_PORT`, so replay is deterministic). The router writes a line in
 *    its table (`NatEntry`): protocol, the inside address and port, the public
 *    port, and the far end. Later packets of the same conversation reuse the
 *    line. A ping has no ports; its ID (the sim's ping sequence number) stands in
 *    for both, unchanged.
 *  - **In.** A packet arriving on the outside port for the outside address
 *    matches a line by protocol, public port, and far end. The router puts the
 *    inside address and port back and forwards it in.
 *  - **Nobody asked.** With no matching line (and no port-forwarding rule), the
 *    packet is dropped with reason 'unsolicited' and a log line (source 'nat').
 *    A reply to the router's own traffic (a ping it sent, say) is still
 *    delivered to the router.
 *  - **Port forwarding** (`NatState.forwards`): a public port the owner opened
 *    on purpose. Inbound packets for it go to the inside address and port, and a
 *    table line is written so the replies go back out the same way.
 *
 * Every packet the router rewrites carries `IpPacket.nat` (a `NatNote`: what
 * the addresses were before), so a capture can show the before and after.
 *
 * Order with a router firewall (firewall.ts): the firewall checks a packet
 * before NAT on the way out and after NAT on the way in, so rules name inside
 * addresses both ways.
 *
 * Simplified on purpose: no timeouts (lines stay until the table holds
 * `MAX_NAT_ENTRIES`, oldest dropped first), no TCP state, one outside address.
 *
 * Sim: `configureNat`, `addNatForward`, `removeNatForward`, `clearNat`.
 * Events `type: 'nat'` (`what: 'out' | 'in'`); drop reason 'unsolicited'.
 * NetBuilder router option `nat: { outside, forwards? }`. Inspector section
 * `nat-table` ("Address sharing (NAT)").
 */

export type NatProto = 'tcp' | 'udp' | 'icmp';

/** One end of a conversation: an address and a port (a ping's ID for ICMP). */
export interface NatEnd {
  ip: Ip;
  port: number;
}

/** One line in a NAT table. */
export interface NatEntry {
  proto: NatProto;
  /** The device in the home: its private address and its own port. */
  inside: NatEnd;
  /** The port number on the shared outside address. For a ping, its ID. */
  public: number;
  /** Who it's talking to, out on the internet. */
  remote: NatEnd;
  /** When the line was written, and last used. */
  t: number;
  used: number;
  /** Written by a port-forwarding rule (the conversation started from outside). */
  forwarded?: boolean;
}

/** A port opened on purpose: inbound packets to `port` go to `to`. */
export interface NatForward {
  proto: 'tcp' | 'udp';
  port: number;
  to: NatEnd;
}

/** Lives on `Device.nat` (a router). */
export interface NatState {
  /** The port facing the internet. Its address is the shared public address. */
  outside: string;
  /** Lines, oldest first. */
  table: NatEntry[];
  /** The next public port to hand out. */
  nextPort: number;
  forwards: NatForward[];
}

/** What a packet looked like before a NAT router rewrote it. Lives on `IpPacket.nat`. */
export interface NatNote {
  /** The router that rewrote it. */
  by: string;
  /** The fields as they were. Out: src and srcPort. In: dst and dstPort. */
  was: { src?: Ip; srcPort?: number; dst?: Ip; dstPort?: number };
}

export const NAT_FIRST_PORT = 50001;
export const MAX_NAT_ENTRIES = 64;

export function newNat(outside: string, forwards: NatForward[] = []): NatState {
  return { outside, table: [], nextPort: NAT_FIRST_PORT, forwards: forwards.map((f) => ({ ...f, to: { ...f.to } })) };
}

/** The numbers NAT tracks: the ports, or a ping's ID for both. Undefined when the packet has none. */
export function natPorts(pkt: IpPacket): { src: number; dst: number } | undefined {
  if (pkt.proto === 'icmp') return pkt.app.kind === 'ping' ? { src: pkt.app.seq, dst: pkt.app.seq } : undefined;
  if (pkt.srcPort === undefined || pkt.dstPort === undefined) return undefined;
  return { src: pkt.srcPort, dst: pkt.dstPort };
}

/** The line for a packet leaving the home (matched on its inside end and far end). */
export function findOut(nat: NatState, pkt: IpPacket): NatEntry | undefined {
  const p = natPorts(pkt);
  if (!p) return undefined;
  return nat.table.find(
    (e) => e.proto === pkt.proto && e.inside.ip === pkt.src && e.inside.port === p.src && e.remote.ip === pkt.dst && e.remote.port === p.dst,
  );
}

/** The line for a packet arriving from outside (matched on the public port and far end). */
export function findIn(nat: NatState, pkt: IpPacket): NatEntry | undefined {
  // An ICMP error (traceroute's "time exceeded") comes from a router along the
  // way, not the far end. It carries the start of the packet that died, and
  // that packet's ping ID and destination find the line, as on a real router.
  if (pkt.app.kind === 'icmp-error') {
    const { seq, orig } = pkt.app;
    return nat.table.find((e) => e.proto === 'icmp' && e.public === seq && e.remote.ip === orig.dst);
  }
  const p = natPorts(pkt);
  if (!p) return undefined;
  return nat.table.find((e) => e.proto === pkt.proto && e.public === p.dst && e.remote.ip === pkt.src && e.remote.port === p.src);
}

/** A port-forwarding rule for an inbound packet, if one matches. */
export function forwardFor(nat: NatState, pkt: IpPacket): NatForward | undefined {
  if (pkt.proto === 'icmp') return undefined;
  return nat.forwards.find((f) => f.proto === pkt.proto && f.port === pkt.dstPort);
}

/** A public port no line or forward uses. */
export function allocPort(nat: NatState): number {
  const busy = new Set([...nat.table.filter((e) => e.proto !== 'icmp').map((e) => e.public), ...nat.forwards.map((f) => f.port)]);
  while (busy.has(nat.nextPort)) nat.nextPort++;
  return nat.nextPort++;
}

export function addEntry(nat: NatState, e: NatEntry): NatEntry {
  nat.table.push(e);
  if (nat.table.length > MAX_NAT_ENTRIES) nat.table.splice(0, nat.table.length - MAX_NAT_ENTRIES);
  return e;
}

/** "203.0.113.25:50001" (no port for a ping). */
export function endText(ip: Ip, port: number | undefined, proto: NatProto): string {
  return proto === 'icmp' || port === undefined ? ip : `${ip}:${port}`;
}
