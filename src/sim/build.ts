import type { Ip, Mac } from './addr';
import { Sim, type SimOptions } from './sim';
import type { Device, DeviceIcon, DeviceKind, Iface, WebSite } from './types';

/**
 * Friendly builder for lab scenarios.
 *
 *   const net = new NetBuilder()
 *     .host('alice', { label: 'Alice', icon: 'laptop', x: 120, y: 300, ip: '192.168.1.10/24', gateway: '192.168.1.1' })
 *     .hub('wifi', { label: 'Café Wi-Fi', icon: 'wifi', x: 400, y: 300 })
 *     .link('alice', 'wifi', { wireless: true });
 *   const sim = net.build();
 *
 * Coordinates are in a 1000 x 600 canvas.
 */

interface Placed {
  label: string;
  sublabel?: string;
  icon?: DeviceIcon;
  x: number;
  y: number;
  notes?: string[];
}

export interface HostOpts extends Placed {
  /** CIDR, e.g. "192.168.1.10/24" */
  ip: string;
  gateway?: Ip;
  dns?: Ip;
  mac?: Mac;
  attacker?: boolean;
  web?: WebSite;
  dnsZone?: Record<string, Ip>;
}

export interface RouterOpts extends Placed {
  ifaces: { id: string; ip: string; mac?: Mac }[];
  routes?: { prefix: string; via?: Ip; iface: string }[];
  /** BGP: AS number. Routers with an ASN peer with every directly linked router that also has one. */
  asn?: number;
  origins?: string[];
  attacker?: boolean;
  impersonate?: WebSite;
}

type End = string | [device: string, iface: string];

function hashMac(id: string): Mac {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const bytes = [0x02, (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, (h * 31) & 255];
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(':');
}

function cidr(s: string): { ip: Ip; prefix: number } {
  const [ip, p] = s.split('/');
  return { ip, prefix: p === undefined ? 24 : Number(p) };
}

function blank(id: string, kind: DeviceKind, o: Placed, icon: DeviceIcon): Device {
  return {
    id,
    kind,
    label: o.label,
    sublabel: o.sublabel,
    icon: o.icon ?? icon,
    x: o.x,
    y: o.y,
    ifaces: [],
    arp: {},
    macTable: {},
    routes: [],
    dnsCache: {},
    dnsPending: {},
    sniffing: false,
    forwarding: false,
    capture: [],
    stolen: [],
    pending: [],
    notes: o.notes,
  };
}

export class NetBuilder {
  readonly sim: Sim;
  private linkSeq = 1;
  private staticRoutes: Record<string, { prefix: string; via?: Ip; iface: string }[]> = {};

  constructor(opts: Partial<SimOptions> = {}) {
    this.sim = new Sim(opts);
  }

  host(id: string, o: HostOpts): this {
    const d = blank(id, 'host', o, o.attacker ? 'attacker' : 'laptop');
    const { ip, prefix } = cidr(o.ip);
    d.ifaces.push({ id: 'eth0', mac: o.mac ?? hashMac(id), ip, prefix });
    d.gateway = o.gateway;
    d.dnsServer = o.dns;
    d.attacker = o.attacker;
    d.web = o.web;
    d.dnsZone = o.dnsZone;
    if (o.gateway) (this.staticRoutes[id] ??= []).push({ prefix: '0.0.0.0/0', via: o.gateway, iface: 'eth0' });
    this.sim.devices[id] = d;
    return this;
  }

  router(id: string, o: RouterOpts): this {
    const d = blank(id, 'router', o, o.attacker ? 'attacker' : 'router');
    for (const i of o.ifaces) {
      const { ip, prefix } = cidr(i.ip);
      d.ifaces.push({ id: i.id, mac: i.mac ?? hashMac(`${id}/${i.id}`), ip, prefix });
    }
    d.forwarding = true;
    d.attacker = o.attacker;
    d.impersonate = o.impersonate;
    if (o.routes) (this.staticRoutes[id] ??= []).push(...o.routes);
    if (o.asn !== undefined) {
      d.bgp = { asn: o.asn, origins: o.origins ?? [], neighbors: [], adjIn: {}, best: {}, sentTo: {}, validate: false };
    }
    this.sim.devices[id] = d;
    return this;
  }

  switch(id: string, o: Placed): this {
    this.sim.devices[id] = blank(id, 'switch', o, 'switch');
    return this;
  }

  hub(id: string, o: Placed): this {
    this.sim.devices[id] = blank(id, 'hub', o, 'hub');
    return this;
  }

  link(a: End, b: End, opts: { wireless?: boolean } = {}): this {
    const id = `L${this.linkSeq++}`;
    const ea = this.endpoint(a, id);
    const eb = this.endpoint(b, id);
    this.sim.links[id] = { id, a: ea, b: eb, wireless: opts.wireless };
    return this;
  }

  private endpoint(end: End, linkId: string): { device: string; iface: string } {
    const [devId, ifaceId] = typeof end === 'string' ? [end, undefined] : end;
    const dev = this.sim.dev(devId);
    let iface: Iface | undefined;
    if (ifaceId) iface = dev.ifaces.find((i) => i.id === ifaceId);
    else if (dev.kind === 'hub' || dev.kind === 'switch') {
      iface = { id: `p${dev.ifaces.length + 1}`, mac: hashMac(`${devId}/p${dev.ifaces.length + 1}`) };
      dev.ifaces.push(iface);
    } else iface = dev.ifaces.find((i) => !i.linkId);
    if (!iface) throw new Error(`No free interface on ${devId}${ifaceId ? `/${ifaceId}` : ''}`);
    if (iface.linkId) throw new Error(`${devId}/${iface.id} is already linked`);
    iface.linkId = linkId;
    return { device: devId, iface: iface.id };
  }

  /** Authorize `asn` to originate `prefix` (an RPKI "ROA"). */
  roa(prefix: string, asn: number, maxLength?: number): this {
    this.sim.rpki[prefix] = { asn, maxLength: maxLength ?? Number(prefix.split('/')[1]) };
    return this;
  }

  hostsFile(entries: Record<string, Ip>): this {
    Object.assign(this.sim.hostsFile, entries);
    return this;
  }

  build(): Sim {
    const sim = this.sim;
    for (const dev of Object.values(sim.devices)) {
      if (dev.kind === 'hub' || dev.kind === 'switch') continue;
      dev.routes = [...sim.connectedRoutes(dev), ...(this.staticRoutes[dev.id] ?? []).map((r) => ({ ...r, source: 'static' as const }))];
    }
    // BGP neighbors: directly linked routers that both have an ASN.
    for (const link of Object.values(sim.links)) {
      const a = sim.dev(link.a.device);
      const b = sim.dev(link.b.device);
      if (a.bgp && b.bgp) {
        a.bgp.neighbors.push({ iface: link.a.iface, device: b.id, asn: b.bgp.asn });
        b.bgp.neighbors.push({ iface: link.b.iface, device: a.id, asn: a.bgp.asn });
      }
    }
    if (Object.values(sim.devices).some((d) => d.bgp)) {
      sim.bgpStart();
      sim.runUntilIdle();
    }
    sim.events = [];
    return sim;
  }
}
