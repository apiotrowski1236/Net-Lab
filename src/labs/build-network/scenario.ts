import { networkOf, prefixContains, prefixLen, sameSubnet } from '../../sim/addr';
import { NetBuilder } from '../../sim/build';
import type { Sim } from '../../sim/sim';
import type { Iface } from '../../sim/types';

/** The three networks students build. */
export const NET = { office: '192.168.10.0/24', link: '10.0.0.0/24', servers: '203.0.113.0/24' };

export const WEB_IP = '203.0.113.80';
export const SITE_URL = `http://${WEB_IP}/`;

/** The addresses the lesson suggests. Students may pick others on the same networks. */
export const ADDR = {
  alice: '192.168.10.11',
  ben: '192.168.10.12',
  officeLan: '192.168.10.1',
  officeLink: '10.0.0.1',
  dcLink: '10.0.0.2',
  dcServers: '203.0.113.1',
};

/** Where Ben's computer ends up after "someone moved his desk". */
export const BROKEN_NET = '192.168.100.0/24';

export const WEB_PIN = {
  device: 'web',
  cidr: `${WEB_IP}/24`,
  why: `The website is published at ${WEB_IP}. People and other computers already look for it there, so the web server has to keep that address. Type ${WEB_IP}/24.`,
};

export function buildParts(): Sim {
  return new NetBuilder({ linkMs: 500, procMs: 100, l2Ms: 50, httpTimeoutMs: 15000, arpTimeoutMs: 4000, pingTimeoutMs: 12000 })
    .host('alice', { label: 'Alice', icon: 'laptop', x: 90, y: 170 })
    .host('ben', { label: 'Ben', icon: 'desktop', x: 90, y: 430 })
    .switch('sw', { label: 'Office switch', x: 270, y: 300, ports: 4 })
    .router('office', { label: 'Office router', x: 470, y: 300, ifaces: [{ id: 'p1' }, { id: 'p2' }] })
    .router('dc', { label: 'Data center router', x: 690, y: 300, ifaces: [{ id: 'p1' }, { id: 'p2' }] })
    .host('web', {
      label: 'Web server',
      icon: 'server',
      x: 900,
      y: 300,
      web: {
        name: WEB_IP,
        title: 'Company website',
        https: false,
        page: 'It works! This page crossed every cable you plugged in and every route you added.',
      },
    })
    .build();
}

// ---------------------------------------------------------------------------
// Reading the network the student built
// ---------------------------------------------------------------------------

/** The port of `devId` whose cable goes straight to `otherId`. */
export function portToward(sim: Sim, devId: string, otherId: string): Iface | undefined {
  const l = sim.linkBetween(devId, otherId);
  if (!l) return undefined;
  const end = l.a.device === devId ? l.a : l.b;
  return sim.dev(devId).ifaces.find((i) => i.id === end.iface);
}

/** The network a port is on, like 192.168.10.0/24. */
export const netOf = (i: Iface | undefined): string | undefined =>
  i?.ip && i.prefix !== undefined ? networkOf(i.ip, i.prefix) : undefined;

export const hostOn = (sim: Sim, devId: string, net: string) => netOf(sim.dev(devId).ifaces[0]) === net;

/** The address of `devId`'s port that faces `otherId`. */
export const ipToward = (sim: Sim, devId: string, otherId: string) => portToward(sim, devId, otherId)?.ip;

/** The office router's address on the office network, if it has one. */
export function officeLanIp(sim: Sim): string | undefined {
  const p = portToward(sim, 'office', 'sw');
  return netOf(p) === NET.office ? p!.ip : undefined;
}

export function dcServerIp(sim: Sim): string | undefined {
  const p = portToward(sim, 'dc', 'web');
  return netOf(p) === NET.servers ? p!.ip : undefined;
}

/** The two routers' ports on the cable between them share a network. */
export function linkUp(sim: Sim): boolean {
  const a = netOf(portToward(sim, 'office', 'dc'));
  return !!a && a === netOf(portToward(sim, 'dc', 'office'));
}

/** `from` sends packets for `dst` to `next`, through a static route `from` can actually use. */
export function routesVia(sim: Sim, from: string, dst: string, next: string): boolean {
  const dev = sim.dev(from);
  const r = sim.lookup(dev, dst);
  const nh = ipToward(sim, next, from);
  return !!r && r.source === 'static' && !!nh && r.via === nh && !!sim.connectedIface(dev, nh);
}

// ---------------------------------------------------------------------------
// Step setups: put back what earlier steps built, keeping the student's own
// valid choices. Each runs the one before it, and each is safe to repeat.
// ---------------------------------------------------------------------------

/** Which devices each device should be cabled to in the finished network. */
const NEIGHBORS: Record<string, string[]> = {
  alice: ['sw'],
  ben: ['sw'],
  sw: ['alice', 'ben', 'office'],
  office: ['sw', 'dc'],
  dc: ['office', 'web'],
  web: ['dc'],
};

function ensureCable(sim: Sim, a: string, b: string): void {
  if (sim.linkBetween(a, b)) return;
  for (const id of [a, b]) {
    if (sim.freePort(id)) continue;
    const wrong = sim.dev(id).ifaces.find((i) => {
      const p = sim.peer(id, i.id);
      return p && !NEIGHBORS[id].includes(p.device);
    });
    if (wrong) sim.disconnect(id, wrong.id);
  }
  sim.connect({ device: a }, { device: b });
}

const usedBy = (sim: Sim, ip: string, except?: Iface) =>
  Object.values(sim.devices).some((d) => d.ifaces.some((i) => i !== except && i.ip === ip));

/** `want` if nobody else uses it, or else a free address on its /24. */
function freeAddr(sim: Sim, want: string, self?: Iface, fromTop = false): string {
  if (!usedBy(sim, want, self)) return want;
  const base = want.split('.').slice(0, 3).join('.');
  for (let n = 2; n < 255; n++) {
    const ip = `${base}.${fromTop ? 256 - n : n}`;
    if (!usedBy(sim, ip, self)) return ip;
  }
  throw new Error(`No free address near ${want}`);
}

/** Give a port an address on `net` unless it already has its own one there. */
function ensureAddr(sim: Sim, devId: string, iface: Iface, net: string, want: string): void {
  if (netOf(iface) === net && !usedBy(sim, iface.ip!, iface)) return;
  const ip = freeAddr(sim, want, iface);
  const len = prefixLen(net);
  // Each port of a router is on a different network.
  for (const o of sim.dev(devId).ifaces) {
    if (o !== iface && o.ip && o.prefix !== undefined && sameSubnet(o.ip, ip, Math.min(o.prefix, len))) sim.setIp(devId, o.id, null);
  }
  sim.setIp(devId, iface.id, ip, len);
}

function ensureGateway(sim: Sim, devId: string, ip: string): void {
  if (sim.dev(devId).gateway !== ip) sim.setGateway(devId, ip);
}

function ensureRoute(sim: Sim, from: string, dst: string, net: string, next: string): void {
  if (routesVia(sim, from, dst, next)) return;
  for (const r of [...sim.dev(from).routes]) if (r.source === 'static' && prefixContains(r.prefix, dst)) sim.removeRoute(from, r.prefix);
  sim.addRoute(from, net, ipToward(sim, next, from)!);
}

export function cabled(sim: Sim): void {
  ensureCable(sim, 'alice', 'sw');
  ensureCable(sim, 'ben', 'sw');
}

export function officeLan(sim: Sim): void {
  cabled(sim);
  ensureAddr(sim, 'alice', sim.dev('alice').ifaces[0], NET.office, ADDR.alice);
  ensureAddr(sim, 'ben', sim.dev('ben').ifaces[0], NET.office, ADDR.ben);
}

export function officeRouter(sim: Sim): void {
  officeLan(sim);
  ensureCable(sim, 'office', 'sw');
  ensureAddr(sim, 'office', portToward(sim, 'office', 'sw')!, NET.office, ADDR.officeLan);
}

export function gateways(sim: Sim): void {
  officeRouter(sim);
  ensureGateway(sim, 'alice', officeLanIp(sim)!);
  ensureGateway(sim, 'ben', officeLanIp(sim)!);
}

export function dataCenter(sim: Sim): void {
  gateways(sim);
  ensureCable(sim, 'dc', 'web');
  // The server's address is fixed, so it goes first: whoever else took it gives it up.
  const web = sim.dev('web').ifaces[0];
  if (web.ip !== WEB_IP || web.prefix !== 24) {
    for (const d of Object.values(sim.devices)) for (const i of d.ifaces) if (i !== web && i.ip === WEB_IP) sim.setIp(d.id, i.id, null);
    sim.setIp('web', web.id, WEB_IP, 24);
  }
  ensureAddr(sim, 'dc', portToward(sim, 'dc', 'web')!, NET.servers, ADDR.dcServers);
  ensureGateway(sim, 'web', dcServerIp(sim)!);
}

export function routerLink(sim: Sim): void {
  dataCenter(sim);
  ensureCable(sim, 'office', 'dc');
  // Keep any network the student chose for the link, as long as both ends agree on it.
  const a = portToward(sim, 'office', 'dc')!;
  const b = portToward(sim, 'dc', 'office')!;
  const clash = (i: Iface) => !!i.ip && usedBy(sim, i.ip, i);
  if (linkUp(sim) && !clash(a) && !clash(b)) return;
  ensureAddr(sim, 'office', a, NET.link, ADDR.officeLink);
  ensureAddr(sim, 'dc', b, NET.link, ADDR.dcLink);
}

export function forwardRoute(sim: Sim): void {
  routerLink(sim);
  ensureRoute(sim, 'office', WEB_IP, NET.servers, 'dc');
}

export function returnRoute(sim: Sim): void {
  forwardRoute(sim);
  ensureRoute(sim, 'dc', sim.dev('alice').ifaces[0].ip!, NET.office, 'office');
}

/** Three faults on Ben's computer, one per layer: no cable, an address on the wrong network, and a gateway nobody answers to. */
export function breakBen(sim: Sim): void {
  const ben = sim.dev('ben');
  // Close his browser: a page from before the move would say everything still works.
  ben.browser = undefined;
  const port = ben.ifaces[0];
  if (port.linkId) sim.disconnect('ben', port.id);
  sim.setIp('ben', port.id, freeAddr(sim, '192.168.100.12', port), 24);
  sim.setGateway('ben', freeAddr(sim, '192.168.10.254', port, true));
}
