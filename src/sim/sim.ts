import {
  BROADCAST_MAC,
  isIp,
  networkOf,
  normalizePrefix,
  prefixContains,
  prefixCovers,
  prefixLen,
  sameSubnet,
  type Ip,
  type Mac,
} from './addr';
import type {
  AppData,
  Device,
  Frame,
  Iface,
  InFlight,
  IpPacket,
  Link,
  Route,
  SimEvent,
} from './types';

/**
 * A deliberately simplified network simulator.
 *
 * It models just enough to make the Unit 3 attacks real: Ethernet frames with
 * MAC addresses, IPv4 packets with TTLs, ARP, hubs vs. switches, routers with
 * routing tables, a toy BGP, DNS, and HTTP/HTTPS. It skips everything that
 * doesn't teach (TCP handshakes, NAT, checksums, retransmission, ...).
 *
 * Time is simulated in milliseconds and the simulator is event-driven and
 * fully deterministic: the same actions at the same times always produce the
 * same network. Labs rely on that to rebuild a student's network after a
 * reload by replaying the actions they took.
 */

export interface SimOptions {
  /** How long a frame takes to cross one link (slow enough to watch). */
  linkMs: number;
  /** How long a device "thinks" before it sends a reply. */
  procMs: number;
  /** Hubs and switches pass frames through faster than computers answer. */
  l2Ms: number;
  httpTimeoutMs: number;
  arpTimeoutMs: number;
  /**
   * Resolve MAC addresses instantly instead of sending ARP requests.
   * Use for labs where ARP would just be noise (e.g. internet routing).
   */
  autoArp: boolean;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  linkMs: 900,
  procMs: 160,
  l2Ms: 60,
  httpTimeoutMs: 8000,
  arpTimeoutMs: 8000,
  autoArp: false,
};

interface Job {
  at: number;
  seq: number;
  run: () => void;
}

export type RovResult = 'valid' | 'invalid' | 'unknown';

const MAX_EVENTS = 4000;
const MAX_CAPTURE = 400;

/** Frames are plain data. structuredClone is missing before Safari 15.4, so fall back to JSON. */
const cloneFrame: (f: Frame) => Frame =
  typeof structuredClone === 'function' ? (f) => structuredClone(f) : (f) => JSON.parse(JSON.stringify(f)) as Frame;

export class Sim {
  t = 0;
  devices: Record<string, Device> = {};
  links: Record<string, Link> = {};
  inflight: InFlight[] = [];
  events: SimEvent[] = [];
  /** RPKI: which AS is allowed to originate each prefix. */
  rpki: Record<string, { asn: number; maxLength: number }> = {};
  /** Name -> IP for hosts that have no DNS server configured. */
  hostsFile: Record<string, Ip> = {};
  opts: SimOptions;

  private jobs: Job[] = [];
  private seq = 0;
  private nextFrameId = 1;
  private nextReqId = 1;
  private nextCaptureNo = 1;
  private nextPort = 49152;
  private nextPing = 1;
  private listeners = new Set<(e: SimEvent) => void>();

  constructor(opts: Partial<SimOptions> = {}) {
    this.opts = { ...DEFAULT_SIM_OPTIONS, ...opts };
  }

  // -------------------------------------------------------------------------
  // Clock
  // -------------------------------------------------------------------------

  schedule(delay: number, run: () => void): void {
    const job: Job = { at: this.t + Math.max(0, delay), seq: this.seq++, run };
    let i = this.jobs.length;
    while (i > 0) {
      const prev = this.jobs[i - 1];
      if (prev.at < job.at || (prev.at === job.at && prev.seq < job.seq)) break;
      i--;
    }
    this.jobs.splice(i, 0, job);
  }

  advance(dt: number): void {
    this.advanceTo(this.t + dt);
  }

  advanceTo(target: number): void {
    while (this.jobs.length && this.jobs[0].at <= target) {
      const job = this.jobs.shift()!;
      this.t = job.at;
      job.run();
    }
    if (target > this.t) this.t = target;
  }

  /** Fast-forward until nothing is in flight or scheduled. */
  runUntilIdle(maxMs = 10 * 60 * 1000): void {
    const limit = this.t + maxMs;
    while (this.jobs.length && this.jobs[0].at <= limit) {
      const job = this.jobs.shift()!;
      this.t = job.at;
      job.run();
    }
  }

  get idle(): boolean {
    return this.jobs.length === 0;
  }

  /** Simulated time of the next scheduled job, if any. */
  get nextJobAt(): number | undefined {
    return this.jobs[0]?.at;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  on(listener: (e: SimEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    for (const l of this.listeners) l(e);
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  dev(id: string): Device {
    const d = this.devices[id];
    if (!d) throw new Error(`No device "${id}"`);
    return d;
  }

  /** First interface with an IP address (hosts have exactly one). */
  ipOf(id: string): Ip {
    const ip = this.dev(id).ifaces.find((i) => i.ip)?.ip;
    if (!ip) throw new Error(`Device "${id}" has no IP`);
    return ip;
  }

  macOf(id: string): Mac {
    return this.dev(id).ifaces[0].mac;
  }

  /** Which device owns this IP address (by configuration, not by ARP). */
  deviceByIp(ip: Ip): Device | undefined {
    return Object.values(this.devices).find((d) => d.ifaces.some((i) => i.ip === ip));
  }

  deviceByMac(mac: Mac): Device | undefined {
    return Object.values(this.devices).find((d) => d.ifaces.some((i) => i.mac === mac));
  }

  /** The interface at the other end of a device's link. */
  peer(devId: string, ifaceId: string): { device: string; iface: string } | undefined {
    const iface = this.dev(devId).ifaces.find((i) => i.id === ifaceId);
    if (!iface?.linkId) return undefined;
    const link = this.links[iface.linkId];
    return link.a.device === devId && link.a.iface === ifaceId ? link.b : link.a;
  }

  peerIp(devId: string, ifaceId: string): Ip | undefined {
    const p = this.peer(devId, ifaceId);
    if (!p) return undefined;
    return this.dev(p.device).ifaces.find((i) => i.id === p.iface)?.ip;
  }

  /** Longest-prefix-match route lookup. Connected beats static beats BGP at equal length. */
  lookup(dev: Device, ip: Ip): Route | undefined {
    let best: Route | undefined;
    let bestRank = -1;
    for (const r of dev.routes) {
      if (!prefixContains(r.prefix, ip)) continue;
      const rank = prefixLen(r.prefix) * 4 + (r.source === 'connected' ? 3 : r.source === 'static' ? 2 : 1);
      if (rank > bestRank) {
        best = r;
        bestRank = rank;
      }
    }
    return best;
  }

  /** RPKI route-origin validation for one announcement. */
  rov(prefix: string, originAsn: number | undefined): RovResult {
    let covered = false;
    for (const [roaPrefix, roa] of Object.entries(this.rpki)) {
      if (!prefixCovers(roaPrefix, prefix)) continue;
      covered = true;
      if (roa.asn === originAsn && prefixLen(prefix) <= roa.maxLength) return 'valid';
    }
    return covered ? 'invalid' : 'unknown';
  }

  // -------------------------------------------------------------------------
  // Layer 1/2: moving frames across links, hubs, and switches
  // -------------------------------------------------------------------------

  private frame(origin: string, src: Mac, dst: Mac, body: Partial<Frame>): Frame {
    return { id: this.nextFrameId++, src, dst, origin, ...body };
  }

  transmit(devId: string, ifaceId: string, frame: Frame, delay = this.opts.procMs): void {
    const peer = this.peer(devId, ifaceId);
    if (!peer) return;
    const iface = this.dev(devId).ifaces.find((i) => i.id === ifaceId)!;
    const copy = cloneFrame(frame);
    this.schedule(delay, () => {
      const flight: InFlight = {
        frame: copy,
        linkId: iface.linkId!,
        from: devId,
        to: peer.device,
        toIface: peer.iface,
        depart: this.t,
        arrive: this.t + this.opts.linkMs,
      };
      this.inflight.push(flight);
      this.schedule(this.opts.linkMs, () => {
        const i = this.inflight.indexOf(flight);
        if (i >= 0) this.inflight.splice(i, 1);
        this.receive(peer.device, peer.iface, copy);
      });
    });
  }

  private receive(devId: string, ifaceId: string, frame: Frame): void {
    const dev = this.devices[devId];
    if (!dev) return;
    if (dev.kind === 'hub') {
      for (const i of dev.ifaces) if (i.id !== ifaceId && i.linkId) this.transmit(dev.id, i.id, frame, this.opts.l2Ms);
      return;
    }
    if (dev.kind === 'switch') {
      if (dev.macTable[frame.src] !== ifaceId) {
        dev.macTable[frame.src] = ifaceId;
        this.emit({ t: this.t, type: 'mac-learn', device: dev.id, mac: frame.src, iface: ifaceId });
      }
      const out = frame.dst === BROADCAST_MAC ? undefined : dev.macTable[frame.dst];
      if (out) {
        if (out !== ifaceId) this.transmit(dev.id, out, frame, this.opts.l2Ms);
        return;
      }
      for (const i of dev.ifaces) if (i.id !== ifaceId && i.linkId) this.transmit(dev.id, i.id, frame, this.opts.l2Ms);
      return;
    }
    const iface = dev.ifaces.find((i) => i.id === ifaceId);
    if (iface) this.nic(dev, iface, frame);
  }

  /** A network card receiving a frame. */
  private nic(dev: Device, iface: Iface, frame: Frame): void {
    if (dev.sniffing) this.capture(dev, frame);
    const forMe = frame.dst === iface.mac || frame.dst === BROADCAST_MAC;
    if (!forMe) {
      this.emit({ t: this.t, type: 'ignored', device: dev.id, frame });
      return;
    }
    if (frame.arp) this.onArp(dev, iface, frame);
    else if (frame.bgp) this.onBgp(dev, iface, frame);
    else if (frame.ip) this.onIp(dev, frame);
  }

  private capture(dev: Device, frame: Frame): void {
    const no = this.nextCaptureNo++;
    dev.capture.push({ no, t: this.t, frame: cloneFrame(frame) });
    if (dev.capture.length > MAX_CAPTURE) dev.capture.splice(0, dev.capture.length - MAX_CAPTURE);
    this.emit({ t: this.t, type: 'captured', device: dev.id, no, frame });
  }

  // -------------------------------------------------------------------------
  // ARP
  // -------------------------------------------------------------------------

  private onArp(dev: Device, iface: Iface, frame: Frame): void {
    const a = frame.arp!;
    if (a.op === 'request') {
      if (!iface.ip || a.targetIp !== iface.ip) return;
      this.learnArp(dev, a.senderIp, a.senderMac, 'request', frame.forged);
      const reply = this.frame(dev.id, iface.mac, a.senderMac, {
        arp: { op: 'reply', senderIp: iface.ip, senderMac: iface.mac, targetIp: a.senderIp, targetMac: a.senderMac },
      });
      this.transmit(dev.id, iface.id, reply);
    } else {
      // The flaw ARP poisoning exploits: replies are believed even if nobody asked.
      this.learnArp(dev, a.senderIp, a.senderMac, 'reply', frame.forged);
    }
  }

  private learnArp(dev: Device, ip: Ip, mac: Mac, via: 'reply' | 'request', forged?: boolean): void {
    const onSubnet = dev.ifaces.some((i) => i.ip && i.prefix !== undefined && sameSubnet(i.ip, ip, i.prefix));
    if (!onSubnet) return;
    const prev = dev.arp[ip];
    if (prev?.via === 'static') {
      if (prev.mac !== mac) this.emit({ t: this.t, type: 'arp-rejected', device: dev.id, ip, mac });
      return;
    }
    dev.arp[ip] = { mac, at: this.t, via };
    if (!prev || prev.mac !== mac) {
      this.emit({ t: this.t, type: 'arp-update', device: dev.id, ip, mac, prev: prev?.mac, forged });
    }
    this.flushPending(dev, ip);
  }

  private flushPending(dev: Device, ip: Ip): void {
    const entry = dev.arp[ip];
    if (!entry) return;
    const ready = dev.pending.filter((p) => p.nextHop === ip);
    if (!ready.length) return;
    dev.pending = dev.pending.filter((p) => p.nextHop !== ip);
    for (const p of ready) {
      const iface = dev.ifaces.find((i) => i.id === p.iface)!;
      this.transmit(dev.id, iface.id, this.frame(dev.id, iface.mac, entry.mac, { ip: p.pkt }));
    }
  }

  // -------------------------------------------------------------------------
  // IP
  // -------------------------------------------------------------------------

  private isLocal(dev: Device, ip: Ip): boolean {
    return dev.ifaces.some((i) => i.ip === ip);
  }

  /** True when a router has a black-hole route it originated itself (a hijack) for this address. */
  private hijacked(dev: Device, ip: Ip): boolean {
    const r = this.lookup(dev, ip);
    return !!r && r.source === 'bgp' && !r.via && r.learnedFrom === dev.id;
  }

  private onIp(dev: Device, frame: Frame): void {
    const pkt = frame.ip!;
    if (this.isLocal(dev, pkt.dst) || (dev.impersonate && this.hijacked(dev, pkt.dst))) {
      this.deliver(dev, pkt, frame);
      return;
    }
    if (!dev.forwarding) {
      this.emit({ t: this.t, type: 'drop', device: dev.id, reason: 'not-forwarding', pkt, frame });
      return;
    }
    pkt.ttl -= 1;
    if (pkt.ttl <= 0) {
      this.emit({ t: this.t, type: 'drop', device: dev.id, reason: 'ttl', pkt, frame });
      return;
    }
    this.emit({ t: this.t, type: 'forwarded', device: dev.id, frame });
    this.routeAndSend(dev, pkt, frame);
  }

  /** Pick the route, find the next hop's MAC, and send. */
  routeAndSend(dev: Device, pkt: IpPacket, frame?: Frame): void {
    const r = this.lookup(dev, pkt.dst);
    if (!r) {
      this.emit({ t: this.t, type: 'drop', device: dev.id, reason: 'no-route', pkt, frame });
      return;
    }
    if (!r.via && r.source === 'bgp') {
      this.emit({ t: this.t, type: 'drop', device: dev.id, reason: 'blackhole', pkt, frame });
      return;
    }
    this.sendIp(dev, pkt, r.via ?? pkt.dst, r.iface);
  }

  private sendIp(dev: Device, pkt: IpPacket, nextHop: Ip, ifaceId: string): void {
    const iface = dev.ifaces.find((i) => i.id === ifaceId);
    if (!iface) return;
    let entry = dev.arp[nextHop];
    if (!entry && this.opts.autoArp) {
      const owner = this.deviceByIp(nextHop);
      const mac = owner?.ifaces.find((i) => i.ip === nextHop)?.mac;
      if (mac) entry = dev.arp[nextHop] = { mac, at: this.t, via: 'auto' };
    }
    if (entry) {
      this.transmit(dev.id, iface.id, this.frame(dev.id, iface.mac, entry.mac, { ip: pkt }));
      return;
    }
    const alreadyAsking = dev.pending.some((p) => p.nextHop === nextHop);
    dev.pending.push({ pkt, nextHop, iface: ifaceId, since: this.t });
    if (alreadyAsking) return;
    const ask = this.frame(dev.id, iface.mac, BROADCAST_MAC, {
      arp: { op: 'request', senderIp: iface.ip!, senderMac: iface.mac, targetIp: nextHop },
    });
    this.transmit(dev.id, iface.id, ask);
    this.schedule(this.opts.arpTimeoutMs, () => {
      const stuck = dev.pending.filter((p) => p.nextHop === nextHop);
      if (!stuck.length) return;
      dev.pending = dev.pending.filter((p) => p.nextHop !== nextHop);
      for (const p of stuck) this.emit({ t: this.t, type: 'drop', device: dev.id, reason: 'arp-timeout', pkt: p.pkt });
    });
  }

  private originate(dev: Device, pkt: IpPacket): void {
    this.routeAndSend(dev, pkt);
  }

  private reply(dev: Device, req: IpPacket, app: AppData): void {
    this.originate(dev, {
      src: req.dst,
      dst: req.src,
      ttl: 64,
      proto: req.proto,
      srcPort: req.dstPort,
      dstPort: req.srcPort,
      encrypted: req.encrypted,
      app,
    });
  }

  // -------------------------------------------------------------------------
  // Applications: ping, HTTP(S), DNS
  // -------------------------------------------------------------------------

  private deliver(dev: Device, pkt: IpPacket, frame: Frame): void {
    const app = pkt.app;
    switch (app.kind) {
      case 'ping':
        if (!app.reply) this.reply(dev, pkt, { kind: 'ping', seq: app.seq, reply: true });
        else this.emit({ t: this.t, type: 'ping-reply', device: dev.id, from: pkt.src });
        return;
      case 'http-req':
        this.serveHttp(dev, pkt, frame);
        return;
      case 'http-res':
        this.onHttpResponse(dev, pkt);
        return;
      case 'dns-query':
        if (dev.dnsZone) {
          this.reply(dev, pkt, { kind: 'dns-answer', name: app.name, ip: dev.dnsZone[app.name] ?? null, qid: app.qid });
        }
        return;
      case 'dns-answer':
        this.onDnsAnswer(dev, pkt);
        return;
    }
  }

  private serveHttp(dev: Device, pkt: IpPacket, frame: Frame): void {
    const req = pkt.app as Extract<AppData, { kind: 'http-req' }>;
    const impostor = !this.isLocal(dev, pkt.dst) ? dev.impersonate : undefined;
    const site = impostor ?? dev.web;
    if (!site) {
      this.emit({ t: this.t, type: 'drop', device: dev.id, reason: 'no-service', pkt, frame });
      return;
    }
    const fake = !!site.fake || !!impostor;
    this.emit({ t: this.t, type: 'http-request', device: dev.id, frame, fake });

    // An impostor can't complete an HTTPS handshake for a name it has no certificate for,
    // so the browser stops before anything secret is sent.
    if (fake && pkt.encrypted) {
      this.reply(dev, pkt, { kind: 'http-res', status: 0, title: '', body: '', reqId: req.reqId, certName: null });
      return;
    }

    let title = site.title;
    let body = 'Please sign in to continue.';
    if (req.method === 'POST') {
      const creds = parseForm(req.body ?? '');
      const user = creds.user ?? creds.username ?? 'friend';
      title = `${site.title} · My account`;
      body = `Welcome back, ${user}! Checking balance: $1,284.16`;
      if (fake && creds.pass) {
        dev.stolen.push({ t: this.t, user, pass: creds.pass, victimIp: pkt.src });
        this.emit({ t: this.t, type: 'credentials-stolen', device: dev.id, user, pass: creds.pass });
      }
    }
    this.reply(dev, pkt, {
      kind: 'http-res',
      status: 200,
      title,
      body,
      reqId: req.reqId,
      certName: fake ? null : site.name,
    });
  }

  private onHttpResponse(dev: Device, pkt: IpPacket): void {
    const res = pkt.app as Extract<AppData, { kind: 'http-res' }>;
    const b = dev.browser;
    if (!b || b.reqId !== res.reqId || b.status !== 'loading') return;
    b.from = pkt.src;
    if (b.secure && res.certName !== b.host) {
      b.status = 'warning';
      b.fake = true;
      b.error = `Your connection is not private. This server could not prove it is ${b.host}.`;
    } else {
      b.status = 'loaded';
      b.title = res.title;
      b.body = res.body;
      b.fake = res.certName !== b.host;
    }
    this.emit({ t: this.t, type: 'page', device: dev.id, browser: { ...b } });
  }

  private onDnsAnswer(dev: Device, pkt: IpPacket): void {
    const ans = pkt.app as Extract<AppData, { kind: 'dns-answer' }>;
    const pending = dev.dnsPending[ans.qid];
    // First answer wins; later ones are ignored. (DNS spoofing races exploit exactly this.)
    if (!pending || pending.name !== ans.name) return;
    delete dev.dnsPending[ans.qid];
    this.emit({ t: this.t, type: 'dns-answer', device: dev.id, name: ans.name, ip: ans.ip });
    const b = dev.browser;
    if (!ans.ip) {
      if (b && b.reqId === pending.reqId) this.failBrowser(dev, `Can't find a server named ${ans.name}.`);
      return;
    }
    dev.dnsCache[ans.name] = ans.ip;
    if (b && b.reqId === pending.reqId && b.status === 'resolving') this.sendHttp(dev, ans.ip);
  }

  private failBrowser(dev: Device, error: string): void {
    const b = dev.browser!;
    b.status = 'failed';
    b.error = error;
    this.emit({ t: this.t, type: 'page', device: dev.id, browser: { ...b } });
  }

  private sendHttp(dev: Device, ip: Ip): void {
    const b = dev.browser!;
    b.status = 'loading';
    this.originate(dev, {
      src: this.ipOf(dev.id),
      dst: ip,
      ttl: 64,
      proto: 'tcp',
      srcPort: this.nextPort++,
      dstPort: b.secure ? 443 : 80,
      encrypted: b.secure,
      app: {
        kind: 'http-req',
        method: b.postBody ? 'POST' : 'GET',
        host: b.host,
        path: b.path,
        body: b.postBody,
        reqId: b.reqId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Actions a lab (or a student) can take
  // -------------------------------------------------------------------------

  /** Open a URL in a host's browser. Pass `body` to submit a form (POST). */
  browse(devId: string, url: string, body?: string): void {
    const dev = this.dev(devId);
    const m = /^(https?):\/\/([^/]+)(\/.*)?$/.exec(url.trim());
    if (!m) throw new Error(`Bad URL: ${url}`);
    const secure = m[1] === 'https';
    const host = m[2];
    const reqId = this.nextReqId++;
    dev.browser = { url, host, secure, path: m[3] ?? '/', postBody: body, status: 'resolving', startedAt: this.t, reqId };

    if (isIp(host)) this.sendHttp(dev, host);
    else if (dev.dnsCache[host]) this.sendHttp(dev, dev.dnsCache[host]);
    else if (dev.dnsServer) {
      const qid = reqId;
      dev.dnsPending[qid] = { name: host, reqId };
      this.originate(dev, {
        src: this.ipOf(dev.id),
        dst: dev.dnsServer,
        ttl: 64,
        proto: 'udp',
        srcPort: this.nextPort++,
        dstPort: 53,
        app: { kind: 'dns-query', name: host, qid },
      });
    } else if (this.hostsFile[host]) this.sendHttp(dev, this.hostsFile[host]);
    else {
      this.failBrowser(dev, `Can't find a server named ${host}.`);
      return;
    }

    this.schedule(this.opts.httpTimeoutMs, () => {
      const b = dev.browser;
      if (b && b.reqId === reqId && (b.status === 'resolving' || b.status === 'loading')) {
        this.failBrowser(dev, 'This site can’t be reached. The server never answered.');
      }
    });
  }

  ping(devId: string, ip: Ip): void {
    const dev = this.dev(devId);
    this.originate(dev, {
      src: this.ipOf(devId),
      dst: ip,
      ttl: 64,
      proto: 'icmp',
      app: { kind: 'ping', seq: this.nextPing++, reply: false },
    });
  }

  setSniffing(devId: string, on: boolean): void {
    const dev = this.dev(devId);
    dev.sniffing = on;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'sniffing', on });
  }

  setForwarding(devId: string, on: boolean): void {
    const dev = this.dev(devId);
    dev.forwarding = on;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'forwarding', on });
  }

  /**
   * ARP poisoning: send `victim` an unrequested ARP reply claiming that
   * `claimIp` lives at the attacker's MAC address.
   */
  arpSpoof(attackerId: string, victimId: string, claimIp: Ip): void {
    const att = this.dev(attackerId);
    const ai = att.ifaces[0];
    const victim = this.dev(victimId);
    const vi =
      victim.ifaces.find((i) => i.ip && ai.ip && ai.prefix !== undefined && sameSubnet(i.ip, ai.ip, ai.prefix)) ??
      victim.ifaces[0];
    const f = this.frame(att.id, ai.mac, vi.mac, {
      forged: true,
      arp: { op: 'reply', senderIp: claimIp, senderMac: ai.mac, targetIp: vi.ip!, targetMac: vi.mac },
    });
    this.transmit(att.id, ai.id, f, 0);
    this.emit({
      t: this.t,
      type: 'config',
      device: attackerId,
      what: 'arp-spoof',
      detail: `told ${victim.label} that ${claimIp} is at ${ai.mac}`,
    });
  }

  /** Lock an ARP entry so forged replies are ignored (static ARP / Dynamic ARP Inspection). */
  setStaticArp(devId: string, ip: Ip, mac: Mac): void {
    this.dev(devId).arp[ip] = { mac, at: this.t, via: 'static' };
    this.emit({ t: this.t, type: 'config', device: devId, what: 'static-arp', detail: `${ip} = ${mac}` });
  }

  clearArp(devId: string): void {
    this.dev(devId).arp = {};
    this.emit({ t: this.t, type: 'config', device: devId, what: 'clear-arp' });
  }

  clearDnsCache(devId: string): void {
    this.dev(devId).dnsCache = {};
  }

  /** Swap a hub for a switch (or back). The switch starts with an empty MAC table. */
  setL2Kind(devId: string, kind: 'hub' | 'switch', look?: { label?: string; sublabel?: string; icon?: Device['icon'] }): void {
    const dev = this.dev(devId);
    dev.kind = kind;
    dev.macTable = {};
    if (look?.label) dev.label = look.label;
    if (look?.sublabel !== undefined) dev.sublabel = look.sublabel;
    if (look?.icon) dev.icon = look.icon;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'kind', detail: kind });
  }

  /** Fill a switch's MAC table as if it had been running for a while. */
  prelearnSwitch(devId: string): void {
    const sw = this.dev(devId);
    for (const port of sw.ifaces) {
      const peer = this.peer(sw.id, port.id);
      if (!peer) continue;
      for (const mac of this.macsBehind(peer.device, peer.iface, new Set([sw.id]))) sw.macTable[mac] = port.id;
    }
  }

  private macsBehind(devId: string, inIface: string, seen: Set<string>): Mac[] {
    const dev = this.dev(devId);
    if (seen.has(devId)) return [];
    seen.add(devId);
    if (dev.kind !== 'hub' && dev.kind !== 'switch') {
      const i = dev.ifaces.find((x) => x.id === inIface);
      return i ? [i.mac] : [];
    }
    const out: Mac[] = [];
    for (const port of dev.ifaces) {
      if (port.id === inIface) continue;
      const peer = this.peer(dev.id, port.id);
      if (peer) out.push(...this.macsBehind(peer.device, peer.iface, seen));
    }
    return out;
  }

  /** Give the listed devices correct ARP entries for every neighbor on their subnets. */
  prewarmArp(devIds: string[]): void {
    const all = Object.values(this.devices);
    for (const id of devIds) {
      const dev = this.dev(id);
      for (const mine of dev.ifaces) {
        if (!mine.ip || mine.prefix === undefined) continue;
        for (const other of all) {
          if (other.id === dev.id || other.kind === 'hub' || other.kind === 'switch') continue;
          for (const theirs of other.ifaces) {
            if (theirs.ip && sameSubnet(theirs.ip, mine.ip, mine.prefix)) {
              dev.arp[theirs.ip] = { mac: theirs.mac, at: this.t, via: 'auto' };
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // BGP (simplified path-vector routing between networks)
  // -------------------------------------------------------------------------

  /** Every BGP router announces its own prefixes. Follow with runUntilIdle() to converge. */
  bgpStart(): void {
    for (const dev of Object.values(this.devices)) {
      if (!dev.bgp) continue;
      for (const prefix of dev.bgp.origins) this.bgpRecompute(dev, prefix);
    }
  }

  announce(devId: string, prefix: string): void {
    const dev = this.dev(devId);
    if (!dev.bgp) throw new Error(`${devId} doesn't speak BGP`);
    const p = normalizePrefix(prefix);
    if (!dev.bgp.origins.includes(p)) dev.bgp.origins.push(p);
    this.emit({ t: this.t, type: 'config', device: devId, what: 'announce', detail: p });
    this.bgpRecompute(dev, p);
  }

  withdraw(devId: string, prefix: string): void {
    const dev = this.dev(devId);
    if (!dev.bgp) return;
    const p = normalizePrefix(prefix);
    dev.bgp.origins = dev.bgp.origins.filter((x) => x !== p);
    this.emit({ t: this.t, type: 'config', device: devId, what: 'withdraw', detail: p });
    this.bgpRecompute(dev, p);
  }

  setValidation(devId: string, on: boolean): void {
    const dev = this.dev(devId);
    if (!dev.bgp) return;
    dev.bgp.validate = on;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'validate', on });
    if (!on) return;
    for (const nb of dev.bgp.neighbors) {
      const adj = dev.bgp.adjIn[nb.device];
      if (!adj) continue;
      for (const [prefix, path] of Object.entries(adj)) {
        if (this.rov(prefix, path[path.length - 1]) === 'invalid') {
          delete adj[prefix];
          this.emit({
            t: this.t,
            type: 'route-rejected',
            device: dev.id,
            prefix,
            from: nb.device,
            reason: `AS${path[path.length - 1]} is not allowed to announce ${prefix}`,
          });
          this.bgpRecompute(dev, prefix);
        }
      }
    }
  }

  private onBgp(dev: Device, iface: Iface, frame: Frame): void {
    const b = dev.bgp;
    if (!b) return;
    const nb = b.neighbors.find((n) => n.iface === iface.id);
    if (!nb) return;
    const u = frame.bgp!;
    const adj = (b.adjIn[nb.device] ??= {});
    if (u.kind === 'withdraw' || u.path.includes(b.asn)) {
      if (adj[u.prefix]) {
        delete adj[u.prefix];
        this.bgpRecompute(dev, u.prefix);
      }
      return;
    }
    if (b.validate) {
      const origin = u.path[u.path.length - 1];
      if (this.rov(u.prefix, origin) === 'invalid') {
        this.emit({
          t: this.t,
          type: 'route-rejected',
          device: dev.id,
          prefix: u.prefix,
          from: nb.device,
          reason: `AS${origin} is not allowed to announce ${u.prefix}`,
        });
        if (adj[u.prefix]) {
          delete adj[u.prefix];
          this.bgpRecompute(dev, u.prefix);
        }
        return;
      }
    }
    adj[u.prefix] = u.path;
    this.bgpRecompute(dev, u.prefix);
  }

  private bgpRecompute(dev: Device, prefix: string): void {
    const b = dev.bgp!;
    const asnOf = (devId: string | null) => b.neighbors.find((n) => n.device === devId)?.asn ?? Infinity;
    let best: { path: number[]; from: string | null } | null = null;
    if (b.origins.includes(prefix)) best = { path: [], from: null };
    else {
      for (const nb of b.neighbors) {
        const p = b.adjIn[nb.device]?.[prefix];
        if (!p) continue;
        if (
          !best ||
          p.length < best.path.length ||
          (p.length === best.path.length && nb.asn < asnOf(best.from))
        ) {
          best = { path: p, from: nb.device };
        }
      }
    }

    const old = b.best[prefix];
    const same =
      (!old && !best) || (!!old && !!best && old.from === best.from && old.path.join(' ') === best.path.join(' '));
    if (!same) {
      if (best) b.best[prefix] = best;
      else delete b.best[prefix];
      dev.routes = dev.routes.filter((r) => !(r.source === 'bgp' && r.prefix === prefix));
      let route: Route | undefined;
      if (best?.from) {
        const nb = b.neighbors.find((n) => n.device === best!.from)!;
        route = {
          prefix,
          via: this.peerIp(dev.id, nb.iface),
          iface: nb.iface,
          source: 'bgp',
          asPath: best.path,
          learnedFrom: nb.device,
        };
      } else if (best && !dev.routes.some((r) => r.source === 'connected' && r.prefix === prefix)) {
        route = { prefix, iface: '', source: 'bgp', asPath: [], learnedFrom: dev.id };
      }
      if (route) dev.routes.push(route);
      this.emit({ t: this.t, type: 'route-change', device: dev.id, prefix, route });
    }

    for (const nb of b.neighbors) {
      const desired = best && best.from !== nb.device ? [b.asn, ...best.path] : null;
      const sent = b.sentTo[nb.device]?.[prefix];
      const iface = dev.ifaces.find((i) => i.id === nb.iface)!;
      const peerMac = this.peerMac(dev.id, nb.iface);
      if (!peerMac) continue;
      if (!desired) {
        if (sent !== undefined) {
          delete b.sentTo[nb.device][prefix];
          this.transmit(dev.id, iface.id, this.frame(dev.id, iface.mac, peerMac, { bgp: { kind: 'withdraw', prefix, path: [] } }));
        }
      } else {
        const key = desired.join(' ');
        if (sent !== key) {
          (b.sentTo[nb.device] ??= {})[prefix] = key;
          this.transmit(
            dev.id,
            iface.id,
            this.frame(dev.id, iface.mac, peerMac, {
              bgp: { kind: 'announce', prefix, path: desired },
              forged: dev.attacker && !this.rpkiAllows(prefix, b.asn) ? true : undefined,
            }),
          );
        }
      }
    }
  }

  private rpkiAllows(prefix: string, asn: number): boolean {
    return this.rov(prefix, asn) !== 'invalid';
  }

  private peerMac(devId: string, ifaceId: string): Mac | undefined {
    const p = this.peer(devId, ifaceId);
    if (!p) return undefined;
    return this.dev(p.device).ifaces.find((i) => i.id === p.iface)?.mac;
  }

  // -------------------------------------------------------------------------
  // Helpers for labs and the UI
  // -------------------------------------------------------------------------

  connectedRoutes(dev: Device): Route[] {
    return dev.ifaces
      .filter((i) => i.ip && i.prefix !== undefined)
      .map((i) => ({ prefix: networkOf(i.ip!, i.prefix!), iface: i.id, source: 'connected' as const }));
  }
}

export function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}
