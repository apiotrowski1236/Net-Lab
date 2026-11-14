import { NetBuilder } from '../../sim/build';
import { evaluate, newFirewall, type FwRuleInput } from '../../sim/firewall';
import type { Sim } from '../../sim/sim';
import type { IpPacket } from '../../sim/types';
import type { MapZone } from '../types';

// Smurf Attacks and Amplification (smurf). Hilltop Tickets sells seats behind an edge router on one
// capacity-limited uplink. Westfield College's router forwards directed
// broadcasts, so Mallory can turn 30 campus computers into an amplifier and
// forge the ticket server's address so every reply floods it. Fans at home are
// the authorized users who can no longer buy.

export const MALLORY = '203.0.113.66';
export const FAN = '203.0.120.40';
export const WEB = '192.0.2.10';
export const PC1 = '198.51.100.11';
export const PC2 = '198.51.100.12';
export const PC3 = '198.51.100.13';
export const CAMPUS_NET = '198.51.100.0/24';
export const CAMPUS_BCAST = '198.51.100.255';
export const TICKETS = 'tickets.hilltop.example';

/** Computers on the campus LAN (only pc1–pc3 are drawn; the rest are this count). */
export const LAN_HOSTS = 30;
/** One storm press sends this many forged requests; each is amplified ×LAN_HOSTS. */
export const STORM_COUNT = 8;
/** Steady load each attack puts on Hilltop's uplink, in packets per second. */
export const SMURF_RATE = LAN_HOSTS * STORM_COUNT; // 240
export const BOTNET_RATE = 300;
/** Hilltop's uplink carries only this many packets per second: the bottleneck. */
export const UPLINK_CAP = 60;

/** Hilltop's uplink: the capacity-limited link a flood fills before the edge firewall sees it. */
export function uplinkId(sim: Sim): string {
  return sim.linkBetween('isp', 'edge')!.id;
}

// --- edge firewall (created when step 8 starts) ---------------------------

/** Fans reach the ticket site over HTTPS. */
const EDGE_TICKETS: FwRuleInput = { dir: 'in', proto: 'tcp', src: 'any', dst: WEB, dport: 443, action: 'allow', note: 'Fans reach the ticket site' };
/** The open-ICMP weakness: ping allowed from anywhere. Step 8 is about closing this. */
const EDGE_PING_OPEN: FwRuleInput = { dir: 'in', proto: 'icmp', src: 'any', dst: 'any', dport: 'any', action: 'allow', note: 'Ping allowed from anywhere' };
/** The server's replies and anything it starts go out. */
const EDGE_REPLIES: FwRuleInput = { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow', note: 'Replies and outbound traffic' };

/** Give Hilltop's edge router its stateless firewall, open to ping (the weakness). Idempotent. */
export function ensureEdgeFirewall(sim: Sim): void {
  const edge = sim.dev('edge');
  if (edge.firewall) return;
  edge.firewall = newFirewall('wan', 'stateless', [EDGE_TICKETS, EDGE_PING_OPEN, EDGE_REPLIES]);
}

// --- ISP upstream filter (the step 8 "scrubbing" action) ------------------

/** Drop pings heading into Hilltop at the provider, one hop before the uplink. */
const ISP_DENY_ICMP: FwRuleInput = { dir: 'in', proto: 'icmp', src: 'any', dst: 'any', dport: 'any', action: 'deny', note: 'Scrubbing: drop ping floods heading to Hilltop' };
const ISP_OUT: FwRuleInput = { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow', note: 'Customer traffic out' };
const ISP_IN: FwRuleInput = { dir: 'in', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow', note: 'Everything else in' };

/** The ISP starts scrubbing: deny inbound ICMP from the internet, and clear the flood off the uplink. Idempotent. */
export function ispFilterUpstream(sim: Sim): void {
  const isp = sim.dev('isp');
  if (!isp.firewall) isp.firewall = newFirewall('pub', 'stateless', [ISP_DENY_ICMP, ISP_OUT, ISP_IN]);
  sim.clearLinkFlood('botnet');
}

/** A sample inbound ping from the internet to the ticket server, for checking a firewall denies it. */
const SAMPLE_ICMP_IN: IpPacket = { src: MALLORY, dst: WEB, ttl: 64, proto: 'icmp', app: { kind: 'ping', seq: 0, reply: false } };

/** Does `device`'s firewall now drop inbound ICMP from the internet? */
export function deniesInboundIcmp(sim: Sim, device: string): boolean {
  const fw = sim.dev(device).firewall;
  return !!fw && evaluate(fw, SAMPLE_ICMP_IN, 'in').action === 'deny';
}

// --- map ------------------------------------------------------------------

export function smurfZones(): MapZone[] {
  return [
    { id: 'internet', shape: { kind: 'rect', x: 60, y: 60, w: 520, h: 300 }, label: 'The internet', tone: 'neutral', dashed: true },
    { id: 'campus', shape: { kind: 'rect', x: 120, y: 400, w: 580, h: 180 }, label: `Westfield College · ${LAN_HOSTS} computers`, tone: 'info', dashed: true },
    { id: 'hilltop', shape: { kind: 'rect', x: 660, y: 120, w: 320, h: 170 }, label: 'Hilltop Tickets', tone: 'good' },
  ];
}

export function buildEchoStorm(): Sim {
  const sim = new NetBuilder({ linkMs: 240, procMs: 70, httpTimeoutMs: 9000, pingTimeoutMs: 6000, autoArp: true })
    .host('mallory', { label: 'Mallory', sublabel: MALLORY, icon: 'attacker', x: 150, y: 110, ip: `${MALLORY}/24`, gateway: '203.0.113.1', attacker: true })
    .host('fan', { label: 'Fan at home', sublabel: FAN, icon: 'laptop', x: 150, y: 300, ip: `${FAN}/24`, gateway: '203.0.120.1' })
    .router('isp', {
      label: 'The internet',
      sublabel: 'the provider',
      icon: 'cloud',
      x: 470,
      y: 200,
      ifaces: [
        { id: 'pub', ip: '203.0.113.1/24' },
        { id: 'home', ip: '203.0.120.1/24' },
        { id: 'hilltop', ip: '100.64.0.1/30' },
        { id: 'campus', ip: '100.64.0.5/30' },
      ],
      routes: [
        { prefix: '192.0.2.0/24', via: '100.64.0.2', iface: 'hilltop' },
        { prefix: CAMPUS_NET, via: '100.64.0.6', iface: 'campus' },
      ],
    })
    .router('edge', {
      label: 'Hilltop edge router',
      icon: 'router',
      x: 710,
      y: 200,
      ifaces: [
        { id: 'wan', ip: '100.64.0.2/30' },
        { id: 'lan', ip: '192.0.2.1/24' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '100.64.0.1', iface: 'wan' }],
    })
    .host('web', {
      label: 'Ticket server',
      sublabel: WEB,
      icon: 'server',
      x: 900,
      y: 200,
      ip: `${WEB}/24`,
      gateway: '192.0.2.1',
      web: { name: TICKETS, title: 'Hilltop Tickets: state championship', https: true, page: 'Choose your seats for Friday’s game.' },
    })
    .router('campus', {
      label: 'Westfield College router',
      icon: 'router',
      x: 470,
      y: 430,
      ifaces: [
        { id: 'wan', ip: '100.64.0.6/30' },
        { id: 'lan', ip: '198.51.100.1/24' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '100.64.0.5', iface: 'wan' }],
    })
    .switch('campussw', { label: 'Campus switch', x: 470, y: 545 })
    .host('pc1', { label: 'Westfield PC', sublabel: PC1, icon: 'desktop', x: 220, y: 470, ip: `${PC1}/24`, gateway: '198.51.100.1' })
    .host('pc2', { label: 'Westfield PC', sublabel: PC2, icon: 'desktop', x: 340, y: 545, ip: `${PC2}/24`, gateway: '198.51.100.1' })
    .host('pc3', { label: 'Westfield PC', sublabel: PC3, icon: 'desktop', x: 630, y: 520, ip: `${PC3}/24`, gateway: '198.51.100.1' })
    .link('mallory', ['isp', 'pub'])
    .link('fan', ['isp', 'home'])
    .link(['isp', 'hilltop'], ['edge', 'wan'], { capacity: UPLINK_CAP })
    .link(['edge', 'lan'], 'web')
    .link(['isp', 'campus'], ['campus', 'wan'], { capacity: 300 })
    .link(['campus', 'lan'], 'campussw')
    .link('campussw', 'pc1')
    .link('campussw', 'pc2')
    .link('campussw', 'pc3')
    .hostsFile({ [TICKETS]: WEB })
    .build();
  // Westfield's router stands in for 30 computers and forwards directed broadcasts (the amplifier).
  const lan = sim.dev('campus').ifaces.find((i) => i.id === 'lan')!;
  lan.lanHosts = LAN_HOSTS;
  sim.dev('campus').directedBroadcast = true;
  return sim;
}
