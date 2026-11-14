import type { Ip, Mac } from './addr';
import { newResolver } from './dns';
import { hashMac, Sim, type SimOptions } from './sim';
import type { Device, DeviceIcon, DeviceKind, Iface, WebSite } from './types';
import type { WifiAp, WifiClient } from './wifi';
import { newFirewall, type FwMode, type FwRuleInput } from './firewall';
import type { Service } from './services';
import { newDhcpClient, newDhcpServer } from './dhcp';
import { newNat, type NatForward } from './nat';
import { newLinux, type LinuxOpts } from './linux';

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
  /** CIDR, e.g. "192.168.1.10/24". Leave out for a computer that hasn't been set up yet. */
  ip?: string;
  gateway?: Ip;
  dns?: Ip;
  mac?: Mac;
  attacker?: boolean;
  web?: WebSite;
  dnsZone?: Record<string, Ip>;
  /** Make this host a recursive resolver: it forwards cache misses to `upstream` and caches for `ttl` ms (default 60000). */
  resolver?: { upstream: Ip; ttl?: number };
  /** Makes this computer a Wi-Fi client (wireless lab): it joins a network by name. */
  wifiClient?: WifiClient;
  /** Programs answering on ports (SSH on 22, file sharing on 445, ...). See services.ts. */
  services?: Service[];
  /** Gets its address automatically (a DHCP client; see dhcp.ts). Leave out `ip` and `gateway`. */
  dhcp?: boolean;
  /** A host firewall on the computer itself (device-analysis): checks what arrives for it and what it sends. See firewall.ts and ufw.ts. */
  firewall?: { mode?: Exclude<FwMode, 'ngfw'>; rules?: FwRuleInput[] };
  /** Makes this computer a Linux server with log files, sshd, nginx, and fail2ban (device-analysis; see linux.ts). */
  linux?: LinuxOpts;
}

export interface FirewallOpts extends Placed {
  mode?: FwMode;
  rules?: FwRuleInput[];
}

export interface RouterOpts extends Placed {
  /** Leave out a port's ip for a port that hasn't been set up yet. */
  ifaces: { id: string; ip?: string; mac?: Mac }[];
  routes?: { prefix: string; via?: Ip; iface: string }[];
  /** BGP: AS number. Routers with an ASN peer with every directly linked router that also has one. */
  asn?: number;
  origins?: string[];
  attacker?: boolean;
  impersonate?: WebSite;
  /** Firewall software inside the router: it checks the packets the router forwards. `outside` is the port facing the less trusted side. See firewall.ts. */
  firewall?: { outside: string; mode?: FwMode; rules?: FwRuleInput[]; guardSelf?: boolean };
  /** Programs answering on the router's own addresses (Telnet or SSH for management). See services.ts and hardening.ts. */
  services?: Service[];
  /** A DHCP server on port `iface`, handing out `from` to `to` (see dhcp.ts). */
  dhcp?: { iface: string; from: Ip; to: Ip };
  /** NAT: share port `outside`'s address with everything behind the router (see nat.ts). */
  nat?: { outside: string; forwards?: NatForward[] };
}

export interface L2Opts extends Placed {
  /** Make this many empty ports up front (p1, p2, ...). Without it, ports appear as cables are linked. */
  ports?: number;
  /** Named ports made before the numbered ones, like a home Wi-Fi router's built-in 'inside' port (home-network). */
  named?: string[];
  /** Makes this an access point (wireless lab). Open Wi-Fi is a hub; encrypted is a switch. */
  wifi?: WifiAp;
  /** A switch's mirror port: every frame the switch accepts is copied out this port (capture-analysis; see Device.mirror). */
  mirror?: string;
}

type End = string | [device: string, iface: string];

function cidr(s: string | undefined): { ip?: Ip; prefix?: number } {
  if (!s) return {};
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
    logs: [],
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
    if (o.resolver) d.resolver = newResolver(o.resolver.upstream, o.resolver.ttl ?? 60_000);
    d.wifiClient = o.wifiClient;
    if (o.services) d.services = o.services.map((x) => ({ ...x }));
    if (o.dhcp) d.dhcp = { client: newDhcpClient('eth0') };
    if (o.firewall) d.firewall = newFirewall('eth0', o.firewall.mode, o.firewall.rules);
    if (o.linux) d.linux = newLinux(id, o.linux);
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
    if (o.firewall) d.firewall = newFirewall(o.firewall.outside, o.firewall.mode, o.firewall.rules);
    if (o.firewall?.guardSelf) d.firewall!.guardSelf = true;
    if (o.services) d.services = o.services.map((x) => ({ ...x }));
    if (o.dhcp) d.dhcp = { server: newDhcpServer(o.dhcp.iface, o.dhcp.from, o.dhcp.to) };
    if (o.nat) d.nat = newNat(o.nat.outside, o.nat.forwards);
    if (o.routes) (this.staticRoutes[id] ??= []).push(...o.routes);
    if (o.asn !== undefined) {
      d.bgp = { asn: o.asn, origins: o.origins ?? [], neighbors: [], adjIn: {}, best: {}, sentTo: {}, validate: false };
    }
    this.sim.devices[id] = d;
    return this;
  }

  switch(id: string, o: L2Opts): this {
    const d = this.ports(blank(id, 'switch', o, 'switch'), o.ports, o.named);
    d.wifi = o.wifi;
    if (o.mirror) d.mirror = o.mirror;
    this.sim.devices[id] = d;
    return this;
  }

  hub(id: string, o: L2Opts): this {
    const d = this.ports(blank(id, 'hub', o, 'hub'), o.ports, o.named);
    d.wifi = o.wifi;
    this.sim.devices[id] = d;
    return this;
  }

  /**
   * A standalone firewall with two ports, 'outside' and 'inside', and no IP
   * addresses. Link it into place, or leave it unplugged and let the lab put it
   * into a cable with sim.placeFirewall. See firewall.ts.
   */
  firewall(id: string, o: FirewallOpts): this {
    const d = blank(id, 'firewall', o, 'firewall');
    for (const p of ['outside', 'inside']) d.ifaces.push({ id: p, mac: hashMac(`${id}/${p}`) });
    d.firewall = newFirewall('outside', o.mode, o.rules);
    this.sim.devices[id] = d;
    return this;
  }

  private ports(dev: Device, n = 0, named: string[] = []): Device {
    for (const p of named) dev.ifaces.push({ id: p, mac: hashMac(`${dev.id}/${p}`) });
    for (let i = 1; i <= n; i++) dev.ifaces.push({ id: `p${i}`, mac: hashMac(`${dev.id}/p${i}`) });
    return dev;
  }

  /**
   * `tunnel` marks a VPN tunnel (drawn dashed and labeled; see vpn.ts) instead of a cable. `capacity` is the link's
   * packets per second (see congestion.ts). `fixed` is a cable built into one box: students can't unplug it.
   * `ms` is the real-world one-way time across it, for ping and traceroute times (see terminal.ts).
   */
  link(a: End, b: End, opts: { wireless?: boolean; tunnel?: boolean; capacity?: number; fixed?: boolean; ms?: number } = {}): this {
    const id = `L${this.linkSeq++}`;
    const ea = this.endpoint(a, id);
    const eb = this.endpoint(b, id);
    this.sim.links[id] = { id, a: ea, b: eb, wireless: opts.wireless, capacityPps: opts.capacity };
    if (opts.tunnel) this.sim.links[id].tunnel = true;
    if (opts.fixed) this.sim.links[id].fixed = true;
    if (opts.ms !== undefined) this.sim.links[id].ms = opts.ms;
    return this;
  }

  private endpoint(end: End, linkId: string): { device: string; iface: string } {
    const [devId, ifaceId] = typeof end === 'string' ? [end, undefined] : end;
    const dev = this.sim.dev(devId);
    let iface: Iface | undefined;
    if (ifaceId) iface = dev.ifaces.find((i) => i.id === ifaceId);
    else if (dev.kind === 'hub' || dev.kind === 'switch') {
      iface = dev.ifaces.find((i) => !i.linkId);
      if (!iface) {
        iface = { id: `p${dev.ifaces.length + 1}`, mac: hashMac(`${devId}/p${dev.ifaces.length + 1}`) };
        dev.ifaces.push(iface);
      }
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
      if (dev.kind === 'hub' || dev.kind === 'switch' || dev.kind === 'firewall') continue;
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
    // DHCP clients plugged in from the start already have their addresses.
    for (const dev of Object.values(sim.devices)) if (dev.dhcp?.client) sim.dhcpBindNow(dev.id);
    sim.events = [];
    return sim;
  }
}
