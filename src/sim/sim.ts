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
  DropReason,
  Frame,
  Iface,
  InFlight,
  IpPacket,
  Link,
  LogEntry,
  Route,
  SimEvent,
} from './types';
import { forgedGuesses, freshEntry, nextQueryParams, type Waiter } from './dns';
import { burstMac, type Burst } from './burst';
import {
  applyPortSecurity,
  applyPortShutdown,
  configureSwitch,
  portUp,
  switchIngress,
  switchLinkChanged,
  type PortSecurityConfig,
} from './switchsec';
import {
  clientPasses,
  crack,
  distance as wifiDistance,
  JOIN_THRESHOLD,
  signalAt,
  type ScanRow,
  type WifiAuth,
  type WifiReading,
  type WifiSecurity,
} from './wifi';
import { dirOf, evaluate, logLine, track, type FwMode, type FwRuleInput } from './firewall';
import {
  appForPort,
  hostCount,
  MAX_CONNS,
  MAX_SCANS,
  SCAN_PORTS,
  scanDone,
  scanTarget,
  serviceAt,
  usedAddresses,
  type Conn,
  type L4,
  type ProbeResult,
  type Scan,
} from './services';
import {
  correlate,
  newSensor,
  newSiem,
  observe,
  type AiEvent,
  type Baseline,
  type FlowInfo,
  type Incident,
  type SensorOptions,
  type SiemOptions,
  type Tolerance,
  type TriageAction,
  type Verdict,
} from './ids';

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
  /** How long a ping waits for its reply. */
  pingTimeoutMs: number;
  /**
   * Resolve MAC addresses instantly instead of sending ARP requests.
   * Use for labs where ARP would just be noise (e.g. internet routing).
   */
  autoArp: boolean;
  /** Seeds Sim.rand. Same seed, same actions: same network, every time. */
  seed: number;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  linkMs: 900,
  procMs: 160,
  l2Ms: 60,
  httpTimeoutMs: 8000,
  arpTimeoutMs: 8000,
  pingTimeoutMs: 10000,
  autoArp: false,
  seed: 1,
};

interface Job {
  at: number;
  seq: number;
  run: () => void;
}

export type RovResult = 'valid' | 'invalid' | 'unknown';

const MAX_EVENTS = 4000;

/** What a browser says when its own computer can't send the request. */
const CANT_SEND: Partial<Record<DropReason, (ip: Ip, dev: Device) => string>> = {
  'no-link': () => 'This computer isn’t plugged in to the network.',
  'no-ip': () => 'This computer has no IP address, so it can’t send anything.',
  'no-gateway': () => 'This computer has no default gateway, so it can’t reach other networks.',
  'gateway-off-net': (ip, dev) => {
    const me = dev.ifaces.find((i) => i.ip && i.prefix !== undefined);
    const mine = me ? ` (${me.ip}/${me.prefix})` : '';
    return `This computer’s IP address${mine} and its default gateway (${ip}) aren’t on the same network, so it can’t reach other networks.`;
  },
  'arp-timeout': (ip) => `Nobody answered at ${ip}, so the request never left this network.`,
};
const MAX_CAPTURE = 400;
/** Lines each device keeps in its log. */
const MAX_LOG = 2000;

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
  /** While true, events are tagged `quiet`: a lesson setup is arranging the network, so the map doesn't flag each change. */
  quiet = false;
  /** Radio jamming: when on, no device can join an access point on the jammed channel. */
  jam: { on: boolean; channel: number; source?: string } = { on: false, channel: 0 };
  /** Signal readings taken for triangulation (see Sim.wifiMeasure). */
  wifiReadings: WifiReading[] = [];

  private jobs: Job[] = [];
  private seq = 0;
  private nextFrameId = 1;
  private nextReqId = 1;
  private nextCaptureNo = 1;
  private nextPort = 49152;
  private nextPing = 1;
  private nextLogNo = 1;
  private randState = 0;
  /** Last Wi-Fi outcome logged per client, to avoid repeating the same join/reject line. */
  private wifiLast = new Map<string, string>();
  /** Pings still waiting for an answer: sequence number -> who sent it, and to where. */
  private pings = new Map<number, { device: string; to: Ip }>();
  private listeners = new Set<(e: SimEvent) => void>();

  constructor(opts: Partial<SimOptions> = {}) {
    this.opts = { ...DEFAULT_SIM_OPTIONS, ...opts };
    this.randState = this.opts.seed >>> 0;
  }

  /**
   * A random number in [0, 1). Use this, never Math.random: a saved lab is
   * rebuilt by replaying its actions, and this replays the same numbers.
   */
  rand(): number {
    // mulberry32
    let x = (this.randState = (this.randState + 0x6d2b79f5) >>> 0);
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  /** A random whole number from 0 to n - 1. */
  randInt(n: number): number {
    return Math.floor(this.rand() * n);
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
    if (this.quiet) e.quiet = true;
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    for (const l of this.listeners) l(e);
  }

  /**
   * A device writes one line to its log. Features call this where a real
   * device would log (a firewall rule matched, a switch port shut down, a DNS
   * answer changed). `at` backdates a line, for seeding history in a step setup.
   */
  log(devId: string, line: Omit<LogEntry, 'no' | 't' | 'device'>, at = this.t): LogEntry {
    const dev = this.dev(devId);
    const entry: LogEntry = { no: this.nextLogNo++, t: at, device: devId, ...line };
    dev.logs.push(entry);
    if (dev.logs.length > MAX_LOG) dev.logs.splice(0, dev.logs.length - MAX_LOG);
    this.emit({ t: this.t, type: 'log', device: devId, entry });
    return entry;
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
    // Mid-disconnect, the link is gone before both ports forget it.
    if (!link) return undefined;
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
    const link = this.links[iface.linkId!];
    const copy = cloneFrame(frame);
    // A frame on a cable that gets unplugged before it arrives is lost.
    const stillLinked = () => this.links[link.id] === link;
    this.schedule(delay, () => {
      if (!stillLinked()) return;
      const flight: InFlight = {
        frame: copy,
        linkId: link.id,
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
        if (stillLinked()) this.receive(peer.device, peer.iface, copy);
      });
    });
  }

  private receive(devId: string, ifaceId: string, frame: Frame): void {
    if (this.idsSensors.length) this.idsTap(devId, ifaceId, frame);
    const dev = this.devices[devId];
    if (!dev) return;
    if (dev.kind === 'firewall') {
      this.fwBridge(dev, ifaceId, frame);
      return;
    }
    if (dev.kind === 'hub') {
      for (const i of dev.ifaces) if (i.id !== ifaceId && i.linkId) this.transmit(dev.id, i.id, frame, this.opts.l2Ms);
      return;
    }
    if (dev.kind === 'switch') {
      // Learn the sender's MAC; switch security (switchsec.ts) may refuse the frame first.
      const refused = switchIngress(this, dev, ifaceId, frame);
      if (refused) {
        this.drop(dev, refused, frame.ip, frame);
        return;
      }
      const out = frame.dst === BROADCAST_MAC ? undefined : dev.macTable[frame.dst];
      if (out) {
        if (out !== ifaceId && portUp(dev, out)) this.transmit(dev.id, out, frame, this.opts.l2Ms);
        return;
      }
      for (const i of dev.ifaces) if (i.id !== ifaceId && i.linkId && portUp(dev, i.id)) this.transmit(dev.id, i.id, frame, this.opts.l2Ms);
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
    else if (frame.ip) this.onIp(dev, frame, iface);
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

  private onIp(dev: Device, frame: Frame, iface?: Iface): void {
    const pkt = frame.ip!;
    if (this.isLocal(dev, pkt.dst) || (dev.impersonate && this.hijacked(dev, pkt.dst))) {
      this.deliver(dev, pkt, frame);
      return;
    }
    if (!dev.forwarding) {
      this.drop(dev, 'not-forwarding', pkt, frame);
      return;
    }
    // Firewall software in a router checks what it forwards.
    if (dev.firewall && iface && !this.fwPass(dev, iface.id, frame)) return;
    pkt.ttl -= 1;
    if (pkt.ttl <= 0) {
      this.drop(dev, 'ttl', pkt, frame);
      return;
    }
    this.emit({ t: this.t, type: 'forwarded', device: dev.id, frame });
    this.routeAndSend(dev, pkt, frame);
  }

  /**
   * Record a dropped packet. A dropped ping (on its way out or on its way
   * back) also ends that ping, so the sender learns where it died.
   */
  private drop(dev: Device, reason: DropReason, pkt?: IpPacket, frame?: Frame, nextHop?: Ip): void {
    this.emit({ t: this.t, type: 'drop', device: dev.id, reason, pkt, frame, nextHop });
    this.svcDropped(dev, reason, pkt);
    // A request that can't leave its own computer fails right away, like a real browser with no connection.
    const b = dev.browser;
    if (pkt?.app.kind === 'http-req' && b?.reqId === pkt.app.reqId && (b.status === 'loading' || b.status === 'resolving')) {
      const why = CANT_SEND[reason];
      if (why) this.failBrowser(dev, why(nextHop ?? pkt.dst, dev));
    }
    if (pkt?.app.kind !== 'ping') return;
    const seq = pkt.app.seq;
    const p = this.pings.get(seq);
    if (!p) return;
    this.pings.delete(seq);
    this.emit({ t: this.t, type: 'ping-fail', device: p.device, to: p.to, seq, reason, at: dev.id, ip: nextHop ?? pkt.dst });
  }

  /** The port whose network contains `ip`, if the device is on that network. */
  connectedIface(dev: Device, ip: Ip): string | undefined {
    return dev.ifaces.find((i) => i.ip && i.prefix !== undefined && sameSubnet(i.ip, ip, i.prefix))?.id;
  }

  /**
   * Which port a packet to `dst` leaves from. A static route's next hop must
   * sit on one of the device's own networks; the route leaves through that port.
   */
  private egress(dev: Device, dst: Ip): { route: Route; iface: string } | { route?: Route; iface?: undefined } {
    const route = this.lookup(dev, dst);
    if (!route) return {};
    if (route.via && route.source === 'static') {
      const iface = this.connectedIface(dev, route.via);
      return iface ? { route, iface } : { route };
    }
    return { route, iface: route.iface };
  }

  /** The address a device sends from when it talks to `dst`: the IP of the port the packet leaves through. */
  srcFor(dev: Device, dst: Ip): Ip | undefined {
    const out = this.egress(dev, dst).iface;
    return dev.ifaces.find((i) => i.id === out && i.ip)?.ip ?? dev.ifaces.find((i) => i.ip)?.ip;
  }

  /** Pick the route, find the next hop's MAC, and send. `frame` is set when forwarding someone else's packet. */
  routeAndSend(dev: Device, pkt: IpPacket, frame?: Frame, forged = frame?.forged ?? false): void {
    const mine = !frame && dev.kind === 'host';
    const { route: r, iface } = this.egress(dev, pkt.dst);
    if (!r) {
      this.drop(dev, mine ? 'no-gateway' : 'no-route', pkt, frame);
      return;
    }
    if (!r.via && r.source === 'bgp') {
      this.drop(dev, 'blackhole', pkt, frame);
      return;
    }
    if (!iface) {
      this.drop(dev, mine ? 'gateway-off-net' : 'no-route', pkt, frame, r.via);
      return;
    }
    this.sendIp(dev, pkt, r.via ?? pkt.dst, iface, forged);
  }

  private sendIp(dev: Device, pkt: IpPacket, nextHop: Ip, ifaceId: string, forged = false): void {
    const iface = dev.ifaces.find((i) => i.id === ifaceId);
    if (!iface) return;
    if (!iface.ip) {
      this.drop(dev, 'no-ip', pkt);
      return;
    }
    if (!iface.linkId) {
      this.drop(dev, 'no-link', pkt);
      return;
    }
    let entry = dev.arp[nextHop];
    if (!entry && this.opts.autoArp) {
      const owner = this.deviceByIp(nextHop);
      const mac = owner?.ifaces.find((i) => i.ip === nextHop)?.mac;
      if (mac) entry = dev.arp[nextHop] = { mac, at: this.t, via: 'auto' };
    }
    if (entry) {
      this.transmit(dev.id, iface.id, this.frame(dev.id, iface.mac, entry.mac, { ip: pkt, forged: forged || undefined }));
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
      for (const p of stuck) this.drop(dev, 'arp-timeout', p.pkt, undefined, nextHop);
    });
  }

  private originate(dev: Device, pkt: IpPacket, forged = false): void {
    // A computer with no cable can't send anything, wherever it's going.
    if (dev.kind === 'host' && !dev.ifaces.some((i) => i.linkId)) {
      this.drop(dev, 'no-link', pkt);
      return;
    }
    this.routeAndSend(dev, pkt, undefined, forged);
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
        else if (this.scanPingAnswered(dev, app.seq)) return;
        else {
          this.pings.delete(app.seq);
          this.emit({ t: this.t, type: 'ping-reply', device: dev.id, from: pkt.src, seq: app.seq });
        }
        return;
      case 'http-req':
        this.serveHttp(dev, pkt, frame);
        return;
      case 'http-res':
        this.onHttpResponse(dev, pkt);
        return;
      case 'dns-query':
        if (dev.resolver) this.resolverHandleQuery(dev, pkt);
        else if (dev.dnsZone) this.reply(dev, pkt, { kind: 'dns-answer', name: app.name, ip: dev.dnsZone[app.name] ?? null, qid: app.qid });
        return;
      case 'dns-answer':
        if (dev.resolver && this.resolverHandleAnswer(dev, pkt)) return;
        this.onDnsAnswer(dev, pkt);
        return;
      case 'svc':
        this.onSvc(dev, pkt);
        return;
    }
  }

  private serveHttp(dev: Device, pkt: IpPacket, frame: Frame): void {
    const req = pkt.app as Extract<AppData, { kind: 'http-req' }>;
    const impostor = !this.isLocal(dev, pkt.dst) ? dev.impersonate : undefined;
    const site = impostor ?? dev.web;
    if (!site) {
      this.drop(dev, 'no-service', pkt, frame);
      return;
    }
    const fake = !!site.fake || !!impostor;
    this.emit({ t: this.t, type: 'http-request', device: dev.id, frame, fake });

    // Web servers keep an access log: one line per request. The logs lab reuses it.
    this.log(dev.id, {
      source: 'web',
      level: 'info',
      msg: `${req.method} ${req.path} from ${pkt.src}`,
      fields: { src: pkt.src, method: req.method, path: req.path, host: req.host },
    });

    // An impostor can't complete an HTTPS handshake for a name it has no certificate for,
    // so the browser stops before anything secret is sent.
    if (fake && pkt.encrypted) {
      this.reply(dev, pkt, { kind: 'http-res', status: 0, title: '', body: '', reqId: req.reqId, certName: null });
      return;
    }

    let title = site.title;
    let body = site.page ?? 'Please sign in to continue.';
    if (req.method === 'POST') {
      const creds = parseForm(req.body ?? '');
      const user = creds.user ?? creds.username ?? 'friend';
      title = `${site.title} · My account`;
      body = `Welcome back, ${user}! ${site.dashboard ?? 'Checking balance: $1,284.16'}`;
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
    b.doneAt = this.t;
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
    // A host that uses a resolver re-asks every time, so the resolver's cache
    // (not the host's) is the one that matters. Hosts with no resolver keep
    // their own small cache.
    if (!dev.dnsServer) dev.dnsCache[ans.name] = ans.ip;
    if (b && b.reqId === pending.reqId && b.status === 'resolving') this.sendHttp(dev, ans.ip);
  }

  private failBrowser(dev: Device, error: string): void {
    const b = dev.browser!;
    b.status = 'failed';
    b.error = error;
    b.doneAt = this.t;
    this.emit({ t: this.t, type: 'page', device: dev.id, browser: { ...b } });
  }

  private sendHttp(dev: Device, ip: Ip): void {
    const b = dev.browser!;
    b.status = 'loading';
    this.originate(dev, {
      src: this.srcFor(dev, ip) ?? '0.0.0.0',
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

    if (!dev.ifaces.some((i) => i.ip)) {
      this.drop(dev, 'no-ip');
      this.failBrowser(dev, 'This computer has no IP address, so it can’t send anything.');
      return;
    }
    if (isIp(host)) this.sendHttp(dev, host);
    else if (dev.dnsCache[host]) this.sendHttp(dev, dev.dnsCache[host]);
    else if (dev.dnsServer) {
      const qid = reqId;
      dev.dnsPending[qid] = { name: host, reqId };
      this.originate(dev, {
        src: this.srcFor(dev, dev.dnsServer) ?? '0.0.0.0',
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

  /**
   * Send a ping from a device. It ends with a 'ping-reply' event, or a
   * 'ping-fail' that says where it was dropped (or that it timed out).
   * Returns the ping's sequence number.
   */
  ping(devId: string, ip: Ip): number {
    const dev = this.dev(devId);
    const seq = this.nextPing++;
    this.pings.set(seq, { device: devId, to: ip });
    this.emit({ t: this.t, type: 'ping-sent', device: devId, to: ip, seq });
    const src = this.srcFor(dev, ip);
    const pkt: IpPacket = { src: src ?? '0.0.0.0', dst: ip, ttl: 64, proto: 'icmp', app: { kind: 'ping', seq, reply: false } };
    if (!src) {
      this.drop(dev, 'no-ip', pkt);
      return seq;
    }
    this.originate(dev, pkt);
    this.schedule(this.opts.pingTimeoutMs, () => {
      if (!this.pings.delete(seq)) return;
      this.emit({ t: this.t, type: 'ping-fail', device: devId, to: ip, seq, reason: 'timeout' });
    });
    return seq;
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

  // -------------------------------------------------------------------------
  // Building a network: cables, addresses, gateways, and static routes
  // -------------------------------------------------------------------------

  /** A port with no cable. Switches and hubs grow a new port when every port is taken. */
  freePort(devId: string): string | undefined {
    const dev = this.dev(devId);
    const free = dev.ifaces.find((i) => !i.linkId);
    if (free) return free.id;
    return dev.kind === 'switch' || dev.kind === 'hub' ? `p${dev.ifaces.length + 1}` : undefined;
  }

  /** The cable between two devices, if there is one. */
  linkBetween(a: string, b: string): Link | undefined {
    return Object.values(this.links).find(
      (l) => (l.a.device === a && l.b.device === b) || (l.a.device === b && l.b.device === a),
    );
  }

  /** Plug a cable between two ports. Leave a port out to use the device's first free port. Returns the link id. */
  connect(a: { device: string; iface?: string }, b: { device: string; iface?: string }): string {
    if (a.device === b.device) throw new Error('A cable needs two different devices');
    const end = (e: { device: string; iface?: string }) => {
      const dev = this.dev(e.device);
      const id = e.iface ?? this.freePort(e.device);
      if (!id) throw new Error(`${e.device} has no free port`);
      let iface = dev.ifaces.find((i) => i.id === id);
      if (!iface && (dev.kind === 'switch' || dev.kind === 'hub')) {
        iface = { id, mac: portMac(dev, id) };
        dev.ifaces.push(iface);
      }
      if (!iface) throw new Error(`${e.device} has no port ${id}`);
      if (iface.linkId) throw new Error(`${e.device}/${id} already has a cable`);
      return iface;
    };
    const ia = end(a);
    const ib = end(b);
    const id = `${a.device}.${ia.id}~${b.device}.${ib.id}`;
    ia.linkId = id;
    ib.linkId = id;
    this.links[id] = { id, a: { device: a.device, iface: ia.id }, b: { device: b.device, iface: ib.id } };
    const la = this.dev(a.device).label;
    const lb = this.dev(b.device).label;
    this.emit({ t: this.t, type: 'config', device: a.device, what: 'cable', on: true, detail: `${ia.id} to ${lb} ${ib.id}` });
    this.emit({ t: this.t, type: 'config', device: b.device, what: 'cable', on: true, detail: `${ib.id} to ${la} ${ia.id}` });
    switchLinkChanged(this, a.device, ia.id, true);
    switchLinkChanged(this, b.device, ib.id, true);
    return id;
  }

  /** Unplug the cable from one port (both ends come free). Frames on the cable are lost. */
  disconnect(devId: string, ifaceId: string): void {
    const iface = this.dev(devId).ifaces.find((i) => i.id === ifaceId);
    const link = iface?.linkId ? this.links[iface.linkId] : undefined;
    if (!link) return;
    delete this.links[link.id];
    this.inflight = this.inflight.filter((f) => f.linkId !== link.id);
    for (const end of [link.a, link.b]) {
      const dev = this.dev(end.device);
      const port = dev.ifaces.find((i) => i.id === end.iface);
      if (port) delete port.linkId;
      // A switch forgets the addresses it learned on that port.
      for (const [mac, p] of Object.entries(dev.macTable)) if (p === end.iface) delete dev.macTable[mac];
      this.emit({ t: this.t, type: 'config', device: end.device, what: 'cable', on: false, detail: end.iface });
      switchLinkChanged(this, end.device, end.iface, false);
    }
  }

  /**
   * Set (or, with `ip` null, remove) a port's IP address. The device's
   * connected routes follow, and its ARP table starts over.
   */
  setIp(devId: string, ifaceId: string, ip: Ip | null, prefix = 24): void {
    const dev = this.dev(devId);
    const iface = dev.ifaces.find((i) => i.id === ifaceId);
    if (!iface) throw new Error(`${devId} has no port ${ifaceId}`);
    if (ip) {
      iface.ip = ip;
      iface.prefix = prefix;
    } else {
      delete iface.ip;
      delete iface.prefix;
    }
    dev.routes = [...this.connectedRoutes(dev), ...dev.routes.filter((r) => r.source !== 'connected')];
    for (const [k, e] of Object.entries(dev.arp)) if (e.via !== 'static') delete dev.arp[k];
    dev.pending = [];
    this.emit({ t: this.t, type: 'config', device: devId, what: 'ip', on: !!ip, detail: ip ? `${ifaceId} ${ip}/${prefix}` : ifaceId });
  }

  /** A computer's default gateway: where it sends anything that isn't on its own network. `null` removes it. */
  setGateway(devId: string, ip: Ip | null): void {
    const dev = this.dev(devId);
    dev.gateway = ip ?? undefined;
    dev.routes = dev.routes.filter((r) => !(r.source === 'static' && r.prefix === '0.0.0.0/0'));
    if (ip) dev.routes.push({ prefix: '0.0.0.0/0', via: ip, iface: this.connectedIface(dev, ip) ?? dev.ifaces[0].id, source: 'static' });
    this.emit({ t: this.t, type: 'config', device: devId, what: 'gateway', on: !!ip, detail: ip ?? undefined });
  }

  /** Add a static route (replacing any static route for the same prefix). */
  addRoute(devId: string, prefix: string, via: Ip): void {
    const dev = this.dev(devId);
    const p = normalizePrefix(prefix);
    dev.routes = dev.routes.filter((r) => !(r.source === 'static' && r.prefix === p));
    const route: Route = { prefix: p, via, iface: this.connectedIface(dev, via) ?? '', source: 'static' };
    dev.routes.push(route);
    if (p === '0.0.0.0/0' && dev.kind === 'host') dev.gateway = via;
    this.emit({ t: this.t, type: 'route-change', device: devId, prefix: p, route });
  }

  removeRoute(devId: string, prefix: string): void {
    const dev = this.dev(devId);
    const p = normalizePrefix(prefix);
    const before = dev.routes.length;
    dev.routes = dev.routes.filter((r) => !(r.source === 'static' && r.prefix === p));
    if (dev.routes.length === before) return;
    if (p === '0.0.0.0/0' && dev.kind === 'host') dev.gateway = undefined;
    this.emit({ t: this.t, type: 'route-change', device: devId, prefix: p });
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

  // -------------------------------------------------------------------------
  // --- DNS resolver (dns-spoof) ---
  //
  // A recursive resolver answers clients from its cache, and on a miss forwards
  // the question to the authoritative name server, caching the answer for its
  // TTL. It accepts the first answer whose query ID, name, and port match the
  // question it asked. It cannot tell a forged source address from a real one,
  // so an attacker who guesses the ID and port and claims to be the name server
  // can poison the cache. See src/sim/dns.ts for the state and the ID rules.
  // -------------------------------------------------------------------------

  /** A client asked this resolver to look up a name. */
  private resolverHandleQuery(dev: Device, pkt: IpPacket): void {
    const q = pkt.app as Extract<AppData, { kind: 'dns-query' }>;
    const r = dev.resolver!;
    const hit = freshEntry(r, q.name, this.t);
    if (hit) {
      this.log(dev.id, { source: 'dns', level: 'info', msg: `cache hit ${q.name} -> ${hit.ip}`, fields: { name: q.name, ip: hit.ip } });
      this.reply(dev, pkt, { kind: 'dns-answer', name: q.name, ip: hit.ip, qid: q.qid });
      return;
    }
    const waiter: Waiter = { ip: pkt.src, port: pkt.srcPort ?? 0, qid: q.qid };
    const existing = Object.values(r.pending).find((p) => p.name === q.name);
    if (existing) {
      existing.waiters.push(waiter);
      return;
    }
    this.resolverAsk(dev, q.name, [waiter]);
  }

  /** The resolver sends its own question to the authoritative name server. */
  private resolverAsk(dev: Device, name: string, waiters: Waiter[]): void {
    const r = dev.resolver!;
    const { qid, port } = nextQueryParams(r, (n) => this.randInt(n));
    r.pending[qid] = { name, qid, srcPort: port, since: this.t, waiters };
    this.log(dev.id, { source: 'dns', level: 'info', msg: `query ${name} to ${r.upstream} (id ${qid})`, fields: { name, id: qid, dport: 53 } });
    this.originate(dev, {
      src: this.srcFor(dev, r.upstream) ?? '0.0.0.0',
      dst: r.upstream,
      ttl: 64,
      proto: 'udp',
      srcPort: port,
      dstPort: 53,
      app: { kind: 'dns-query', name, qid },
    });
  }

  /** An answer reached the resolver. Returns true when it matched a question we asked. */
  private resolverHandleAnswer(dev: Device, pkt: IpPacket): boolean {
    const r = dev.resolver!;
    const ans = pkt.app as Extract<AppData, { kind: 'dns-answer' }>;
    const pending = r.pending[ans.qid];
    if (!pending || pending.name !== ans.name || pkt.dstPort !== pending.srcPort) return false;
    delete r.pending[ans.qid];
    this.emit({ t: this.t, type: 'dns-answer', device: dev.id, name: ans.name, ip: ans.ip });
    if (ans.ip == null) {
      for (const w of pending.waiters) this.resolverReply(dev, w, ans.name, null);
      return true;
    }
    const prev = r.cache[ans.name];
    r.cache[ans.name] = { ip: ans.ip, at: this.t, ttl: r.defaultTtl, from: pkt.src };
    const changed = !!prev && prev.ip !== ans.ip;
    this.log(dev.id, {
      source: 'dns',
      level: changed ? 'notice' : 'info',
      msg: changed ? `cached ${ans.name} -> ${ans.ip} (was ${prev!.ip})` : `cached ${ans.name} -> ${ans.ip} (ttl ${Math.round(r.defaultTtl / 1000)}s)`,
      fields: { name: ans.name, ip: ans.ip, from: pkt.src, ttl: Math.round(r.defaultTtl / 1000) },
    });
    for (const w of pending.waiters) this.resolverReply(dev, w, ans.name, ans.ip);
    return true;
  }

  private resolverReply(dev: Device, w: Waiter, name: string, ip: Ip | null): void {
    this.originate(dev, {
      src: this.srcFor(dev, w.ip) ?? dev.ifaces.find((i) => i.ip)?.ip ?? '0.0.0.0',
      dst: w.ip,
      ttl: 64,
      proto: 'udp',
      srcPort: 53,
      dstPort: w.port,
      app: { kind: 'dns-answer', name, ip, qid: w.qid },
    });
  }

  /**
   * Cache poisoning. `attacker` floods `resolver` with forged answers that
   * claim to come from the name server, each saying `name` is at `ip`. First it
   * makes sure a question for `name` is in flight, then it sends one forged
   * answer for every query ID and port it guesses. If the resolver is not
   * hardened, one guess matches and the forgery is cached before the real
   * answer, which has farther to travel, gets back.
   */
  forgeDnsAnswer(attackerId: string, resolverId: string, name: string, ip: Ip): void {
    const att = this.dev(attackerId);
    const resolver = this.dev(resolverId);
    const r = resolver.resolver;
    if (!r) throw new Error(`${resolverId} is not a resolver`);
    if (!Object.values(r.pending).some((p) => p.name === name)) this.resolverAsk(resolver, name, []);
    const resolverIp = this.ipOf(resolverId);
    for (const g of forgedGuesses()) {
      this.originate(
        att,
        {
          src: r.upstream, // spoofed: the forgery claims to be the name server
          dst: resolverIp,
          ttl: 64,
          proto: 'udp',
          srcPort: 53,
          dstPort: g.port,
          app: { kind: 'dns-answer', name, ip, qid: g.qid },
        },
        true,
      );
    }
    this.emit({ t: this.t, type: 'config', device: attackerId, what: 'dns-forge', detail: `forged ${name} = ${ip}` });
  }

  /** Turn the resolver's defense on or off: unpredictable query IDs and source ports. */
  setResolverHardened(resolverId: string, on: boolean): void {
    const r = this.dev(resolverId).resolver;
    if (!r) return;
    r.hardened = on;
    this.log(resolverId, {
      source: 'dns',
      level: 'notice',
      msg: on ? 'hardening on: random query IDs and source ports' : 'hardening off',
    });
    this.emit({ t: this.t, type: 'config', device: resolverId, what: 'resolver-hardened', on });
  }

  /** Empty the resolver's cache, so the next lookup asks the name server again. */
  flushResolverCache(resolverId: string): void {
    const r = this.dev(resolverId).resolver;
    if (!r) return;
    r.cache = {};
    r.pending = {};
    this.log(resolverId, { source: 'dns', level: 'notice', msg: 'cache flushed' });
    this.emit({ t: this.t, type: 'config', device: resolverId, what: 'resolver-flush' });
  }

  // --- switch security, bursts, and MAC flooding (mac-flood) ---
  // State and switch behavior live in switchsec.ts and burst.ts.

  /**
   * Turn on a switch's security features: a MAC table that holds at most
   * `tableSize` entries, per-port frame counts, log lines, port security, and
   * shutting ports. See switchsec.ts.
   */
  configureSwitch(devId: string, opts: { tableSize?: number } = {}): void {
    configureSwitch(this.dev(devId), opts);
  }

  /**
   * Send one frame that stands for `burst.count` frames (see burst.ts), out
   * the device's first port with a cable. Works for any frame: pass `ip` for
   * a flood of pings, nothing for bare Ethernet frames. With vary 'src-mac'
   * and no `src`, every copy gets a made-up source MAC. Returns the frame, or
   * undefined if the device has no cable.
   */
  sendBurst(
    devId: string,
    body: Partial<Pick<Frame, 'src' | 'arp' | 'ip' | 'bgp' | 'forged'>> & { dst: Mac },
    burst: Omit<Burst, 'seed'> & { seed?: number },
    delay = 0,
  ): Frame | undefined {
    const dev = this.dev(devId);
    const iface = dev.ifaces.find((i) => i.linkId);
    if (!iface) return undefined;
    const b: Burst = { count: Math.max(1, Math.floor(burst.count)), vary: burst.vary, seed: burst.seed ?? this.randInt(2 ** 31) };
    const src = body.src ?? (b.vary === 'src-mac' ? burstMac(b.seed, 0) : iface.mac);
    const f = this.frame(dev.id, src, body.dst, { ...body, src, burst: b.count > 1 ? b : undefined });
    this.transmit(dev.id, iface.id, f, delay);
    return f;
  }

  /**
   * MAC flooding: `bursts` bursts of `perBurst` frames, each frame from a
   * made-up source MAC and to a made-up destination, `gapMs` apart. A switch
   * learns every source MAC, so its table fills up.
   */
  macFlood(devId: string, bursts = 1, perBurst = 20, gapMs = 300): void {
    const n = Math.max(1, Math.floor(bursts));
    const seeds = Array.from({ length: n }, () => this.randInt(2 ** 31));
    seeds.forEach((seed, k) => {
      // The destination is made up too, so no switch knows it: it goes out every port.
      const dst = burstMac(seed, perBurst);
      this.sendBurst(devId, { dst, forged: true }, { count: perBurst, vary: 'src-mac', seed }, k * gapMs);
    });
    this.emit({ t: this.t, type: 'config', device: devId, what: 'mac-flood', detail: `${n} × ${perBurst} frames` });
  }

  /**
   * Change the MAC address a device's network card sends (MAC spoofing).
   * `null` puts back the card's factory MAC. Other devices' ARP tables keep
   * the old MAC until they hear from it again. A Wi-Fi client re-associates.
   */
  setMac(devId: string, mac: Mac | null, ifaceId?: string): void {
    const dev = this.dev(devId);
    const iface = ifaceId ? dev.ifaces.find((i) => i.id === ifaceId) : dev.ifaces[0];
    if (!iface) throw new Error(`${devId} has no port ${ifaceId}`);
    const factory = iface.factoryMac ?? iface.mac;
    const next = mac ?? factory;
    const prev = iface.mac;
    if (next === prev) return;
    iface.factoryMac = factory;
    iface.mac = next;
    if (next === factory) delete iface.factoryMac;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'mac', on: next !== factory, detail: `${prev} to ${next}` });
    // A Wi-Fi client forgets what it learned and joins again under the new MAC.
    if (dev.wifiClient) {
      for (const k of Object.keys(dev.arp)) delete dev.arp[k];
      this.recomputeWifi();
    }
  }

  /** Port security on one switch port, or null to turn it off. Needs configureSwitch first. */
  setPortSecurity(devId: string, port: string, cfg: PortSecurityConfig | null): void {
    applyPortSecurity(this, this.dev(devId), port, cfg);
  }

  /** Shut a switch port down, or turn it back on (which also clears a port that port security shut). Needs configureSwitch first. */
  setPortShutdown(devId: string, port: string, shut: boolean): void {
    applyPortShutdown(this, this.dev(devId), port, shut);
  }

  // --- Wi-Fi (wireless) ---
  // Access points live on Device.wifi; clients on Device.wifiClient. Association
  // is derived from positions and settings by recomputeWifi, which runs after
  // any Wi-Fi change, so a replay reproduces it exactly. See src/sim/wifi.ts.

  /** Access points that are powered on. */
  private activeAps(): Device[] {
    return Object.values(this.devices).filter((d) => d.wifi && !d.wifi.off);
  }

  private wifiLinkId(apId: string, clientId: string): string {
    return `W:${apId}:${clientId}`;
  }

  /** The AP a client currently hears best and may join, or undefined. */
  private bestApFor(client: Device): Device | undefined {
    const wc = client.wifiClient!;
    let best: Device | undefined;
    let bestSig = -Infinity;
    for (const ap of this.activeAps()) {
      if (ap.id === client.id || ap.wifi!.ssid !== wc.ssid) continue;
      if (this.jam.on && this.jam.channel === ap.wifi!.channel) continue;
      const sig = signalAt(ap.wifi!, ap, client, wc.antennaBoost ?? 0);
      if (sig < JOIN_THRESHOLD) continue;
      if (!clientPasses(ap.wifi!, { mac: client.ifaces[0].mac, passphrase: wc.passphrase, user: wc.user }).ok) continue;
      if (sig > bestSig || (sig === bestSig && best && ap.wifi!.bssid < best.wifi!.bssid)) {
        best = ap;
        bestSig = sig;
      }
    }
    return best;
  }

  /** Recompute every client's association from current positions and settings. */
  recomputeWifi(): void {
    for (const client of Object.values(this.devices)) {
      if (!client.wifiClient) continue;
      const best = this.bestApFor(client);
      this.wifiSetAssociation(client.id, best?.id);
      // Note a would-be join blocked by security (for the Logs tab and detection), once per change.
      if (!best) {
        const blocker = this.activeAps().find(
          (ap) =>
            ap.id !== client.id &&
            ap.wifi!.ssid === client.wifiClient!.ssid &&
            !(this.jam.on && this.jam.channel === ap.wifi!.channel) &&
            signalAt(ap.wifi!, ap, client, client.wifiClient!.antennaBoost ?? 0) >= JOIN_THRESHOLD,
        );
        if (blocker) {
          const res = clientPasses(blocker.wifi!, {
            mac: client.ifaces[0].mac,
            passphrase: client.wifiClient!.passphrase,
            user: client.wifiClient!.user,
          });
          const key = `blocked:${blocker.id}:${res.reason}`;
          if (this.wifiLast.get(client.id) !== key) {
            this.wifiLast.set(client.id, key);
            this.emit({ t: this.t, type: 'wifi', device: blocker.id, what: 'rejected', client: client.id, ssid: blocker.wifi!.ssid, bssid: blocker.wifi!.bssid, detail: res.reason });
            this.log(blocker.id, {
              source: 'wifi',
              level: 'notice',
              msg: `association from ${client.label} (${client.ifaces[0].mac}) denied: ${res.reason}`,
              fields: { ssid: blocker.wifi!.ssid, bssid: blocker.wifi!.bssid, mac: client.ifaces[0].mac, action: 'denied', rule: res.reason ?? '' },
            });
          }
        } else {
          this.wifiLast.delete(client.id);
        }
      }
    }
  }

  private wifiSetAssociation(clientId: string, apId: string | undefined): void {
    const client = this.dev(clientId);
    const cur = client.wifiClient?.joinedAp;
    if (cur === apId) return;
    if (cur) this.wifiDisassociate(clientId);
    if (apId) this.wifiAssociate(apId, clientId);
  }

  /** Join a client to an access point (creates a wireless link). Normally called by recomputeWifi. */
  wifiAssociate(apId: string, clientId: string): void {
    const ap = this.dev(apId);
    const client = this.dev(clientId);
    if (client.wifiClient?.joinedAp && client.wifiClient.joinedAp !== apId) this.wifiDisassociate(clientId);
    const portId = `w:${clientId}`;
    let port = ap.ifaces.find((i) => i.id === portId);
    if (!port) {
      port = { id: portId, mac: portMac(ap, portId) };
      ap.ifaces.push(port);
    }
    const linkId = this.wifiLinkId(apId, clientId);
    port.linkId = linkId;
    client.ifaces[0].linkId = linkId;
    this.links[linkId] = { id: linkId, a: { device: apId, iface: portId }, b: { device: clientId, iface: client.ifaces[0].id }, wireless: true };
    if (client.wifiClient) client.wifiClient.joinedAp = apId;
    this.wifiLast.set(clientId, `joined:${apId}`);
    this.emit({ t: this.t, type: 'wifi', device: apId, what: 'join', client: clientId, ssid: ap.wifi?.ssid, bssid: ap.wifi?.bssid });
    this.log(apId, {
      source: 'wifi',
      level: 'info',
      msg: `${client.label} (${client.ifaces[0].mac}) joined ${ap.wifi?.ssid ?? ap.label}`,
      fields: { ssid: ap.wifi?.ssid ?? '', bssid: ap.wifi?.bssid ?? '', mac: client.ifaces[0].mac, action: 'joined' },
    });
  }

  /** Drop a client's Wi-Fi association. */
  wifiDisassociate(clientId: string): void {
    const client = this.dev(clientId);
    const apId = client.wifiClient?.joinedAp;
    if (!apId) return;
    const linkId = this.wifiLinkId(apId, clientId);
    if (this.links[linkId]) {
      delete this.links[linkId];
      this.inflight = this.inflight.filter((f) => f.linkId !== linkId);
      const ap = this.devices[apId];
      if (ap) {
        const portId = `w:${clientId}`;
        ap.ifaces = ap.ifaces.filter((i) => i.id !== portId);
        for (const [mac, p] of Object.entries(ap.macTable)) if (p === portId) delete ap.macTable[mac];
      }
      if (client.ifaces[0].linkId === linkId) delete client.ifaces[0].linkId;
    }
    if (client.wifiClient) client.wifiClient.joinedAp = undefined;
    const ap = this.devices[apId];
    this.emit({ t: this.t, type: 'wifi', device: apId, what: 'leave', client: clientId, ssid: ap?.wifi?.ssid, bssid: ap?.wifi?.bssid });
    this.log(apId, {
      source: 'wifi',
      level: 'info',
      msg: `${client.label} (${client.ifaces[0].mac}) left ${ap?.wifi?.ssid ?? ap?.label ?? ''}`,
      fields: { ssid: ap?.wifi?.ssid ?? '', bssid: ap?.wifi?.bssid ?? '', mac: client.ifaces[0].mac, action: 'left' },
    });
  }

  /** Set an AP's security mode (and passphrase). Open runs as a hub (everyone hears everyone); encrypted as a switch. */
  setWifiSecurity(apId: string, security: WifiSecurity, passphrase?: string): void {
    const ap = this.dev(apId);
    if (!ap.wifi) return;
    ap.wifi.security = security;
    if (passphrase !== undefined) ap.wifi.passphrase = passphrase;
    const kind = security === 'open' ? 'hub' : 'switch';
    if (ap.kind !== kind) this.setL2Kind(apId, kind);
    this.shareWifiKey(ap);
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-security', detail: security });
    this.recomputeWifi();
  }

  setWifiPassphrase(apId: string, passphrase: string): void {
    const ap = this.dev(apId);
    if (!ap.wifi) return;
    ap.wifi.passphrase = passphrase;
    this.shareWifiKey(ap);
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-passphrase', detail: passphrase });
    this.recomputeWifi();
  }

  /** Hand the shelter's own devices the current passphrase (staff tell the families). Attackers are never told. */
  private shareWifiKey(ap: Device): void {
    if (!ap.wifi) return;
    for (const d of Object.values(this.devices)) {
      if (d.wifiClient && !d.attacker && d.wifiClient.ssid === ap.wifi.ssid) d.wifiClient.passphrase = ap.wifi.passphrase;
    }
  }

  setWifiPower(apId: string, power: 1 | 2 | 3 | 4): void {
    const ap = this.dev(apId);
    if (!ap.wifi) return;
    ap.wifi.power = power;
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-power', detail: String(power) });
    this.recomputeWifi();
  }

  setWifiBeacon(apId: string, on: boolean): void {
    const ap = this.dev(apId);
    if (!ap.wifi) return;
    ap.wifi.beacon = on;
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-beacon', on });
  }

  setWifiWps(apId: string, on: boolean): void {
    const ap = this.dev(apId);
    if (!ap.wifi) return;
    ap.wifi.wps = on;
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-wps', on });
  }

  setWifiAuth(apId: string, auth: WifiAuth): void {
    const ap = this.dev(apId);
    if (!ap.wifi) return;
    ap.wifi.auth = auth;
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-auth', detail: auth });
    this.recomputeWifi();
  }

  /** Turn an AP's MAC filter on or off. Pass the allowed MAC list when turning it on. */
  setWifiMacFilter(apId: string, on: boolean, allow?: Mac[]): void {
    const ap = this.dev(apId);
    if (!ap.wifi) return;
    ap.wifi.macFilter = { on, allow: allow ?? ap.wifi.macFilter?.allow ?? [] };
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-macfilter', on });
    this.recomputeWifi();
  }

  /** Power an access point on or off (used for the rogue AP and the evil twin before they appear). */
  setWifiOff(apId: string, off: boolean): void {
    const ap = this.dev(apId);
    if (!ap.wifi) return;
    ap.wifi.off = off;
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-off', on: off });
    this.recomputeWifi();
  }

  /** Try to crack an AP's key from the attacker's position. On success the attacker learns the passphrase. */
  wifiCrack(attackerId: string, apId: string): void {
    const ap = this.dev(apId);
    const att = this.dev(attackerId);
    if (!ap.wifi) return;
    const res = crack(ap.wifi);
    if (res.ok && ap.wifi.passphrase && att.wifiClient) att.wifiClient.passphrase = ap.wifi.passphrase;
    this.emit({ t: this.t, type: 'wifi', device: attackerId, what: 'crack', ssid: ap.wifi.ssid, bssid: ap.wifi.bssid, ok: res.ok, detail: res.estimate });
    this.log(attackerId, {
      source: 'wifi',
      level: res.ok ? 'warn' : 'info',
      msg: res.ok ? `recovered the key for ${ap.wifi.ssid} by ${res.method} in ${res.estimate}` : `could not break ${ap.wifi.ssid}: ${res.estimate}`,
      fields: { ssid: ap.wifi.ssid, bssid: ap.wifi.bssid, action: res.ok ? 'cracked' : 'crack-failed' },
    });
    this.recomputeWifi();
  }

  /** Turn jamming on or off on a channel. While on, nothing can join an AP on that channel. */
  setWifiJam(sourceId: string, on: boolean, channel = 6): void {
    this.jam = { on, channel, source: on ? sourceId : undefined };
    this.emit({ t: this.t, type: 'wifi', device: sourceId, what: 'jam', ok: on, detail: `channel ${channel}` });
    this.log(sourceId, {
      source: 'wifi',
      level: on ? 'warn' : 'info',
      msg: on ? `jamming channel ${channel}: loud noise across the band` : `stopped jamming channel ${channel}`,
      fields: { action: on ? 'jam-on' : 'jam-off', count: channel },
    });
    this.recomputeWifi();
  }

  /** The access points a scanner at `point` can hear, strongest first. */
  wifiScanRows(point: { x: number; y: number }, rxBoost = 0): ScanRow[] {
    const rows: ScanRow[] = [];
    for (const ap of this.activeAps()) {
      const signal = signalAt(ap.wifi!, ap, point, rxBoost);
      if (signal < 1) continue;
      rows.push({
        device: ap.id,
        ssid: ap.wifi!.ssid,
        bssid: ap.wifi!.bssid,
        security: ap.wifi!.security,
        auth: ap.wifi!.auth,
        wps: ap.wifi!.wps,
        channel: ap.wifi!.channel,
        signal,
        rogue: !!ap.wifi!.rogue,
      });
    }
    return rows.sort((a, b) => b.signal - a.signal || a.bssid.localeCompare(b.bssid));
  }

  /** Record that a scanner looked at the air (for a goal), and log what it saw. */
  wifiScan(scannerId: string): ScanRow[] {
    const scanner = this.dev(scannerId);
    const rows = this.wifiScanRows(scanner, scanner.wifiClient?.antennaBoost ?? 0);
    this.emit({ t: this.t, type: 'wifi', device: scannerId, what: 'scan', detail: String(rows.length) });
    this.log(scannerId, {
      source: 'wifi',
      level: 'info',
      msg: `scan found ${rows.length} network${rows.length === 1 ? '' : 's'}${this.jam.on ? `, heavy noise on channel ${this.jam.channel}` : ''}`,
      fields: { action: 'scan', count: rows.length },
    });
    return rows;
  }

  /** Take one signal reading of `bssid` from `point`, for triangulation. */
  wifiMeasure(scannerId: string, bssid: Mac, x: number, y: number): void {
    const ap = Object.values(this.devices).find((d) => d.wifi?.bssid === bssid);
    if (!ap) return;
    // The distance the measured signal implies. The model is idealized, so this is the true distance.
    const dist = wifiDistance(ap, { x, y });
    this.wifiReadings = this.wifiReadings.filter((r) => !(r.bssid === bssid && r.x === x && r.y === y));
    this.wifiReadings.push({ bssid, x, y, dist });
    this.emit({ t: this.t, type: 'wifi', device: scannerId, what: 'ssid-seen', bssid, ssid: ap.wifi!.ssid, detail: `reading at ${Math.round(x)},${Math.round(y)}` });
  }

  // --- firewall (firewall) ---
  // Services, connections, port scans (services.ts), and firewalls (firewall.ts).
  // -------------------------------------------------------------------------

  private nextConn = 1;
  private nextScan = 1;
  /** Connections and scan probes waiting for a reply: connection id -> who is waiting. */
  private svcWaiting = new Map<number, { device: string; scan?: number; ip: Ip; port: number }>();
  /** Scan pings waiting for a reply: ping sequence number -> which scan sent it. */
  private scanPings = new Map<number, { device: string; scan: number; ip: Ip }>();

  /**
   * Connect from a device to a service: one request to `to` on `port`, and one
   * reply. Returns the connection id. The result lands in the device's
   * `conns` and in a 'conn-result' event (see services.ts for what each status
   * means). `app` is the program the client speaks: by default, the one the
   * port is known for. `sport` picks the client's own port.
   */
  connectService(
    devId: string,
    to: Ip,
    port: number,
    opts: { proto?: L4; app?: string; sport?: number; data?: string; tag?: string; flow?: FlowInfo } = {},
  ): number {
    const dev = this.dev(devId);
    const proto = opts.proto ?? 'tcp';
    const id = this.nextConn++;
    const app = opts.app ?? appForPort(proto, port) ?? proto;
    const conn: Conn = { id, t: this.t, to, port, proto, sport: opts.sport ?? this.nextPort++, app, status: 'pending' };
    if (opts.data) conn.data = opts.data;
    if (opts.tag) conn.tag = opts.tag;
    const list = (dev.conns ??= []);
    list.push(conn);
    if (list.length > MAX_CONNS) list.splice(0, list.length - MAX_CONNS);
    this.svcWaiting.set(id, { device: devId, ip: to, port });
    const src = this.srcFor(dev, to);
    const pkt: IpPacket = {
      src: src ?? '0.0.0.0',
      dst: to,
      ttl: 64,
      proto,
      srcPort: conn.sport,
      dstPort: port,
      encrypted: app === 'https' || app === 'ssh' ? true : undefined,
      app: { kind: 'svc', conn: id, app, reply: false, text: opts.data },
    };
    if (opts.flow) pkt.flow = { ...opts.flow };
    if (!src) {
      this.drop(dev, 'no-ip', pkt);
      return id;
    }
    this.originate(dev, pkt);
    this.schedule(this.opts.pingTimeoutMs, () => {
      if (this.svcWaiting.delete(id)) this.endConn(devId, id, { status: 'no-answer', reason: 'timeout' });
    });
    return id;
  }

  /**
   * Port scan: ping every address in `target` (an address, or a network like
   * "10.0.1.0/24"), then knock on each of `ports` there. Probes go out a little
   * apart, as a real scanner paces them. Results fill in the device's `scans`;
   * a 'scan-done' event fires when the last probe has its answer. Only
   * addresses some device uses get probes (the others never answer).
   */
  scan(devId: string, target: string, ports: number[] = SCAN_PORTS): number {
    const dev = this.dev(devId);
    const tgt = scanTarget(target);
    if (!tgt) throw new Error(`Bad scan target: ${target}`);
    const id = this.nextScan++;
    const addrs = usedAddresses(Object.values(this.devices), tgt.prefix, devId);
    const scan: Scan = {
      id,
      t: this.t,
      target: target.trim(),
      ports: [...ports],
      size: tgt.single ? 1 : hostCount(tgt.prefix),
      hosts: addrs.map((ip) => ({ ip, ping: 'pending', ports: Object.fromEntries(ports.map((p) => [p, 'pending' as ProbeResult])) })),
    };
    const list = (dev.scans ??= []);
    list.push(scan);
    if (list.length > MAX_SCANS) list.splice(0, list.length - MAX_SCANS);
    this.emit({ t: this.t, type: 'config', device: devId, what: 'scan', detail: scan.target });
    if (!addrs.length) {
      scan.doneAt = this.t;
      this.emit({ t: this.t, type: 'scan-done', device: devId, scan });
      return id;
    }
    let k = 0;
    for (const h of scan.hosts) {
      this.schedule(SCAN_GAP_MS * k++, () => this.probePing(dev, scan, h.ip));
      for (const p of scan.ports) this.schedule(SCAN_GAP_MS * k++, () => this.probePort(dev, scan, h.ip, p));
    }
    return id;
  }

  /**
   * Send a hand-built IP packet from a device exactly as given: any source
   * address, any ports, any contents. Labs use it for forged packets, such as
   * a fake reply that answers nothing (AppData 'svc' with conn 0).
   */
  sendPacket(devId: string, pkt: Omit<IpPacket, 'ttl'> & { ttl?: number }): void {
    this.originate(this.dev(devId), { ttl: 64, ...pkt });
  }

  /**
   * Put a standalone firewall (a 'firewall' device) into the cable between
   * devices `a` and `b`. Its outside port faces `outside` (a or b). Addresses
   * and routes stay the same: the firewall passes frames along like the cable
   * did, after checking them. It moves to the middle of that cable on the map.
   */
  placeFirewall(fwId: string, a: string, b: string, outside: string): void {
    const box = this.dev(fwId);
    const fw = box.firewall;
    if (box.kind !== 'firewall' || !fw) throw new Error(`${fwId} is not a standalone firewall`);
    if (outside !== a && outside !== b) throw new Error(`The outside of ${fwId} must face ${a} or ${b}`);
    if (fw.placed) this.unplaceFirewall(fwId);
    const link = this.linkBetween(a, b);
    if (!link) throw new Error(`No cable between ${a} and ${b}`);
    const [outEnd, inEnd] = link.a.device === outside ? [link.a, link.b] : [link.b, link.a];
    const inPort = box.ifaces.find((i) => i.id !== fw.outside);
    if (!inPort) throw new Error(`${fwId} needs two ports`);
    const home = { x: box.x, y: box.y };
    this.disconnect(outEnd.device, outEnd.iface);
    this.connect({ device: outEnd.device, iface: outEnd.iface }, { device: fwId, iface: fw.outside });
    this.connect({ device: fwId, iface: inPort.id }, { device: inEnd.device, iface: inEnd.iface });
    fw.placed = { a: { ...outEnd }, b: { ...inEnd }, home };
    fw.conns = [];
    fw.changedAt = this.t;
    const da = this.dev(outEnd.device);
    const db = this.dev(inEnd.device);
    box.x = Math.round((da.x + db.x) / 2);
    box.y = Math.round((da.y + db.y) / 2);
    this.emit({ t: this.t, type: 'config', device: fwId, what: 'firewall-placed', on: true, detail: `between ${da.label} and ${db.label}` });
  }

  /** Take a placed firewall out of its cable and plug the two ends back together. */
  unplaceFirewall(fwId: string): void {
    const box = this.dev(fwId);
    const p = box.firewall?.placed;
    if (!p) return;
    for (const i of box.ifaces) if (i.linkId) this.disconnect(fwId, i.id);
    const free = (e: { device: string; iface: string }) => !this.devices[e.device]?.ifaces.find((i) => i.id === e.iface)?.linkId;
    if (free(p.a) && free(p.b)) this.connect(p.a, p.b);
    box.x = p.home.x;
    box.y = p.home.y;
    delete box.firewall!.placed;
    box.firewall!.conns = [];
    box.firewall!.changedAt = this.t;
    this.emit({ t: this.t, type: 'config', device: fwId, what: 'firewall-placed', on: false });
  }

  private fwOf(devId: string) {
    const fw = this.dev(devId).firewall;
    if (!fw) throw new Error(`${devId} has no firewall`);
    return fw;
  }

  private fwChanged(devId: string, detail: string): void {
    this.fwOf(devId).changedAt = this.t;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'firewall-rules', detail });
  }

  /** Add a rule at position `at` (0 = top; default: the bottom, just above the implicit deny). Returns its id. */
  fwAddRule(devId: string, rule: FwRuleInput, at?: number): string {
    const fw = this.fwOf(devId);
    const id = `r${fw.nextId++}`;
    const i = at === undefined ? fw.rules.length : Math.max(0, Math.min(fw.rules.length, at));
    fw.rules.splice(i, 0, { ...rule, id });
    this.fwChanged(devId, `added rule ${i + 1}`);
    return id;
  }

  /** Replace a rule's criteria and action. It keeps its id and place. */
  fwEditRule(devId: string, id: string, rule: FwRuleInput): void {
    const fw = this.fwOf(devId);
    const i = fw.rules.findIndex((r) => r.id === id);
    if (i < 0) return;
    fw.rules[i] = { ...rule, id };
    this.fwChanged(devId, `changed rule ${i + 1}`);
  }

  fwDeleteRule(devId: string, id: string): void {
    const fw = this.fwOf(devId);
    const i = fw.rules.findIndex((r) => r.id === id);
    if (i < 0) return;
    fw.rules.splice(i, 1);
    this.fwChanged(devId, `deleted rule ${i + 1}`);
  }

  /** Move a rule to position `to` (0 = top). */
  fwMoveRule(devId: string, id: string, to: number): void {
    const fw = this.fwOf(devId);
    const i = fw.rules.findIndex((r) => r.id === id);
    if (i < 0) return;
    const [r] = fw.rules.splice(i, 1);
    const j = Math.max(0, Math.min(fw.rules.length, to));
    fw.rules.splice(j, 0, r);
    this.fwChanged(devId, `moved rule ${i + 1} to ${j + 1}`);
  }

  /** Switch between stateless, stateful, and next-generation. The connection table starts empty. */
  fwSetMode(devId: string, mode: FwMode): void {
    const fw = this.fwOf(devId);
    fw.mode = mode;
    fw.conns = [];
    fw.changedAt = this.t;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'firewall-mode', detail: mode });
  }

  fwClearConns(devId: string): void {
    this.fwOf(devId).conns = [];
  }

  /** A firewall checks one IP packet that arrived on `ingress`. Denied: logs it, drops it, and returns false. */
  private fwPass(dev: Device, ingress: string, frame: Frame): boolean {
    const fw = dev.firewall!;
    const pkt = frame.ip!;
    const dir = dirOf(fw, ingress);
    const v = evaluate(fw, pkt, dir);
    track(fw, pkt, dir, v, this.t);
    this.emit({ t: this.t, type: 'firewall', device: dev.id, dir, verdict: v, pkt });
    const rule = v.ruleId ? fw.rules.find((r) => r.id === v.ruleId) : undefined;
    if (v.action === 'deny' || rule?.log) this.log(dev.id, logLine(pkt, dir, v));
    if (v.action === 'allow') return true;
    this.drop(dev, 'firewall', pkt, frame);
    return false;
  }

  /** A standalone firewall: frames pass from one port to the other, and IP packets are checked first. */
  private fwBridge(dev: Device, ingress: string, frame: Frame): void {
    const out = dev.ifaces.find((i) => i.id !== ingress && i.linkId);
    if (!out) return;
    // A switch floods a frame when it doesn't yet know where the destination is.
    // A flooded copy for a device on the side it came from goes no further, as
    // on any bridge, and the firewall doesn't judge it: it was never going through.
    if (frame.dst !== BROADCAST_MAC && !this.macBeyond(dev.id, out.id, frame.dst)) return;
    if (frame.ip && dev.firewall && !this.fwPass(dev, ingress, frame)) return;
    this.transmit(dev.id, out.id, frame, this.opts.l2Ms);
  }

  /** Does a device with this MAC sit beyond port `ifaceId` of device `fromId` (without coming back through it)? */
  private macBeyond(fromId: string, ifaceId: string, mac: string): boolean {
    const first = this.peer(fromId, ifaceId);
    if (!first) return false;
    const seen = new Set([fromId, first.device]);
    const queue = [first.device];
    while (queue.length) {
      const d = this.devices[queue.shift()!];
      if (!d) continue;
      if (d.ifaces.some((i) => i.mac === mac)) return true;
      for (const i of d.ifaces) {
        const p = i.linkId ? this.peer(d.id, i.id) : undefined;
        if (p && !seen.has(p.device)) {
          seen.add(p.device);
          queue.push(p.device);
        }
      }
    }
    return false;
  }

  /** A service request arrived, or a reply to one of this device's connections. */
  private onSvc(dev: Device, pkt: IpPacket): void {
    const a = pkt.app as Extract<AppData, { kind: 'svc' }>;
    if (a.reply) {
      const w = a.conn ? this.svcWaiting.get(a.conn) : undefined;
      if (!w || w.device !== dev.id) {
        this.emit({ t: this.t, type: 'stray-reply', device: dev.id, pkt });
        return;
      }
      this.svcWaiting.delete(a.conn);
      const status = a.status ?? 'open';
      if (w.scan !== undefined) this.setProbe(dev.id, w.scan, w.ip, w.port, status);
      else this.endConn(dev.id, a.conn, { status, banner: a.text });
      return;
    }
    const proto: L4 = pkt.proto === 'udp' ? 'udp' : 'tcp';
    const svc = serviceAt(dev, proto, pkt.dstPort);
    this.reply(dev, pkt, { kind: 'svc', conn: a.conn, app: svc?.app ?? a.app, reply: true, status: svc ? 'open' : 'closed', text: svc?.banner });
  }

  private endConn(devId: string, id: number, patch: Partial<Conn>): void {
    const c = this.devices[devId]?.conns?.find((x) => x.id === id);
    if (!c || c.status !== 'pending') return;
    Object.assign(c, patch, { doneAt: this.t });
    this.emit({ t: this.t, type: 'conn-result', device: devId, conn: { ...c } });
  }

  /** A dropped packet ends the connection or scan probe it belonged to. */
  private svcDropped(at: Device, reason: DropReason, pkt?: IpPacket): void {
    const a = pkt?.app;
    if (a?.kind === 'ping') {
      const s = this.scanPings.get(a.seq);
      if (!s) return;
      this.scanPings.delete(a.seq);
      this.setProbe(s.device, s.scan, s.ip, 'ping', 'no-answer');
      return;
    }
    if (a?.kind !== 'svc' || !a.conn) return;
    const w = this.svcWaiting.get(a.conn);
    if (!w) return;
    this.svcWaiting.delete(a.conn);
    if (w.scan !== undefined) this.setProbe(w.device, w.scan, w.ip, w.port, 'no-answer');
    else this.endConn(w.device, a.conn, { status: 'no-answer', at: at.id, reason });
  }

  private scanPingAnswered(dev: Device, seq: number): boolean {
    const s = this.scanPings.get(seq);
    if (!s || s.device !== dev.id) return false;
    this.scanPings.delete(seq);
    this.setProbe(dev.id, s.scan, s.ip, 'ping', 'open');
    return true;
  }

  private probePing(dev: Device, scan: Scan, ip: Ip): void {
    const seq = this.nextPing++;
    const src = this.srcFor(dev, ip);
    if (!src) {
      this.setProbe(dev.id, scan.id, ip, 'ping', 'no-answer');
      return;
    }
    this.scanPings.set(seq, { device: dev.id, scan: scan.id, ip });
    this.originate(dev, { src, dst: ip, ttl: 64, proto: 'icmp', app: { kind: 'ping', seq, reply: false } });
    this.schedule(this.opts.pingTimeoutMs, () => {
      if (this.scanPings.delete(seq)) this.setProbe(dev.id, scan.id, ip, 'ping', 'no-answer');
    });
  }

  private probePort(dev: Device, scan: Scan, ip: Ip, port: number): void {
    const id = this.nextConn++;
    const src = this.srcFor(dev, ip);
    if (!src) {
      this.setProbe(dev.id, scan.id, ip, port, 'no-answer');
      return;
    }
    this.svcWaiting.set(id, { device: dev.id, scan: scan.id, ip, port });
    this.originate(dev, {
      src,
      dst: ip,
      ttl: 64,
      proto: 'tcp',
      srcPort: this.nextPort++,
      dstPort: port,
      app: { kind: 'svc', conn: id, app: appForPort('tcp', port) ?? 'tcp', reply: false },
    });
    this.schedule(this.opts.pingTimeoutMs, () => {
      if (this.svcWaiting.delete(id)) this.setProbe(dev.id, scan.id, ip, port, 'no-answer');
    });
  }

  private setProbe(devId: string, scanId: number, ip: Ip, which: number | 'ping', result: ProbeResult): void {
    const scan = this.devices[devId]?.scans?.find((s) => s.id === scanId);
    const h = scan?.hosts.find((x) => x.ip === ip);
    if (!scan || !h) return;
    if (which === 'ping') h.ping = result;
    else h.ports[which] = result;
    if (!scan.doneAt && scanDone(scan)) {
      scan.doneAt = this.t;
      this.emit({ t: this.t, type: 'scan-done', device: devId, scan });
    }
  }

  // --- ids (logs) ---
  // Network sensors (IDS, IPS), the SIEM, and AI scores. Rules and state live
  // in ids.ts; its header explains them.
  // -------------------------------------------------------------------------

  /** Devices with a sensor. receive() hands taps only when a lab has one. */
  private idsSensors: string[] = [];

  private sensorOf(devId: string) {
    const s = this.dev(devId).ids?.sensor;
    if (!s) throw new Error(`${devId} is not a sensor. Call sim.configureIds first.`);
    return s;
  }

  private siemOf(devId: string) {
    const q = this.dev(devId).ids?.siem;
    if (!q) throw new Error(`${devId} is not a SIEM. Call sim.configureSiem first.`);
    return q;
  }

  /** A tapped device received a frame: hand a copy to each sensor watching it. */
  private idsTap(devId: string, ifaceId: string, frame: Frame): void {
    const tap = this.devices[devId];
    if (!tap) return;
    for (const id of this.idsSensors) {
      const s = this.devices[id]?.ids?.sensor;
      if (s?.taps.some((t) => t.device === devId && (!t.iface || t.iface === ifaceId))) observe(this, id, tap, ifaceId, frame);
    }
  }

  private idsChanged(devId: string, what: string, on: boolean, msg: string): void {
    this.sensorOf(devId).fired = {};
    this.log(devId, { source: 'ids', level: 'notice', msg, fields: { setting: what, state: on ? 'on' : 'off' } });
    this.emit({ t: this.t, type: 'config', device: devId, what, on });
  }

  /** Make a device a network sensor, with every kind of detection off. See ids.ts. */
  configureIds(devId: string, opts: SensorOptions): void {
    (this.dev(devId).ids ??= {}).sensor = newSensor(opts);
    if (!this.idsSensors.includes(devId)) this.idsSensors.push(devId);
  }

  /** Signature detection on or off. */
  idsSetSignatures(devId: string, on: boolean): void {
    const s = this.sensorOf(devId);
    if (s.signatures === on) return;
    s.signatures = on;
    this.idsChanged(devId, 'ids-signatures', on, on ? `signature set enabled (${s.rules} rules)` : 'signature set disabled');
  }

  /** Anomaly detection on or off, and its tolerance. */
  idsSetAnomaly(devId: string, on: boolean, tolerance?: Tolerance): void {
    const s = this.sensorOf(devId);
    const tol = tolerance ?? s.tolerance;
    if (s.anomaly === on && s.tolerance === tol) return;
    s.anomaly = on;
    s.tolerance = tol;
    this.idsChanged(devId, 'ids-anomaly', on, on ? `anomaly detection on (tolerance ${tol})` : `anomaly detection off (tolerance ${tol})`);
  }

  /** Prevention on (the sensor acts on its alerts: an IPS) or off (it only alerts: an IDS). */
  idsSetPrevention(devId: string, on: boolean): void {
    const s = this.sensorOf(devId);
    if (s.prevention === on) return;
    s.prevention = on;
    this.idsChanged(devId, 'ids-prevention', on, on ? 'prevention mode on: acting on alerts (IPS)' : 'prevention mode off: alerts only (IDS)');
  }

  /** Store the anomaly baseline: what normal looks like. */
  idsRecordBaseline(devId: string, baseline: Baseline): void {
    const s = this.sensorOf(devId);
    s.baseline = { ...baseline, hours: [...baseline.hours], peers: { ...baseline.peers }, typical: { ...baseline.typical }, recordedAt: this.t };
    const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
    this.idsChanged(
      devId,
      'ids-baseline',
      true,
      `baseline recorded: ${Object.keys(baseline.peers).length} hosts, office hours ${pad(baseline.hours[0])} to ${pad(baseline.hours[1])}`,
    );
  }

  /** Make a device a SIEM that collects the logs of `sources`. See ids.ts. */
  configureSiem(devId: string, opts: SiemOptions): void {
    (this.dev(devId).ids ??= {}).siem = newSiem(opts);
  }

  /** Group the sources' lines into incidents. Returns the incidents it opened. */
  siemCorrelate(devId: string): Incident[] {
    this.siemOf(devId);
    return correlate(this, devId);
  }

  /** An analyst's call on an incident: real attack or false alarm, escalate or close. */
  siemTriage(devId: string, incident: number, verdict: Verdict, action: TriageAction): void {
    const inc = this.siemOf(devId).incidents.find((i) => i.id === incident);
    if (!inc) return;
    inc.verdict = verdict;
    inc.action = action;
    inc.triagedAt = this.t;
    const done = action === 'escalate' ? 'escalated' : 'closed';
    this.log(devId, {
      source: 'siem',
      level: 'notice',
      msg: `INCIDENT ${incident} ${done}: ${verdict === 'real' ? 'real attack' : 'false alarm'}`,
      fields: { incident, verdict, action, triage: done },
    });
    this.emit({ t: this.t, type: 'config', device: devId, what: 'siem-triage', detail: `${incident} ${verdict} ${action}` });
  }

  /** An AI model scores these events (0 to 1, how likely each is malicious). */
  aiScore(devId: string, events: AiEvent[]): void {
    const q = this.siemOf(devId);
    q.ai = { events: events.map((e) => ({ ...e })), scoredAt: this.t };
    this.log(devId, { source: 'ai', level: 'notice', msg: `AI model scored ${events.length} events`, fields: { count: events.length } });
    this.emit({ t: this.t, type: 'config', device: devId, what: 'ai-score' });
  }

  /** Set the AI alert threshold (0 to 1, in steps of 0.05). */
  aiSetThreshold(devId: string, value: number): void {
    const q = this.siemOf(devId);
    const v = Math.round(Math.min(1, Math.max(0, value)) * 20) / 20;
    if (q.threshold === v) return;
    q.threshold = v;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'ai-threshold', detail: v.toFixed(2) });
  }
}

/** Time between one scan probe and the next. */
const SCAN_GAP_MS = 80;

/** A stable, locally administered MAC address for a port, from the device and port names. */
export function portMac(dev: Device, ifaceId: string): Mac {
  return hashMac(`${dev.id}/${ifaceId}`);
}

export function hashMac(id: string): Mac {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const bytes = [0x02, (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, (h * 31) & 255];
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(':');
}

export function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}
