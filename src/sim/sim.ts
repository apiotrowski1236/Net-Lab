import {
  BROADCAST_MAC,
  intToIp,
  ipToInt,
  isIp,
  maskBits,
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
import { burstIp, burstMac, burstSize, type Burst } from './burst';
import { directedBroadcastIface } from './broadcast';
import { clearAllFloods, clearFlood, linkLoad, newCongestion, setFlood, type CongestionState, type FloodKind } from './congestion';
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
import type { WifiProfile } from './wifi';
import {
  isApproved,
  newWidsState,
  noiseLevel,
  NORMAL_NOISE_MAX,
  QUIET_NOISE,
  replayRecord,
  WIDS_RULES,
  type AirRecord,
  type ApprovedAp,
  type WidsMark,
  type WidsReplay,
  type WidsRule,
} from './wids';
import { dirOf, evaluate, logLine, track, type FwMode, type FwRuleInput } from './firewall';
import { applyVlan, sameVlan } from './vlan';
import type { ZoneLevel } from './zones';
import { cleanOutbreak, infectHost, isProbe, newOutbreak, probeArrived, probeEnded } from './malware';
import { cellKey, isPolicyValue, newZonePolicy, policyRules, zoneLogLine, type PolicyValue, type PolicyZone, type ZonePolicy } from './zonePolicy';
import {
  appForPort,
  hostCount,
  isReply,
  listening,
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
import { auditFindings, MAX_REPORTS, scanHosts, type AuditReport, type RiskLevel } from './audit';
import { MANAGEMENT_SERVICES, serviceOn, type HardenSetting } from './hardening';
import { natKey, VPN_AUTH_LABEL, type VpnAuth } from './vpn';
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
import { canGrant, fromClient, grant, newDhcpClient, newDhcpServer, offer, pickAddress, type DhcpMessage } from './dhcp';
import { addEntry, allocPort, endText, findIn, findOut, forwardFor, natPorts, newNat, type NatForward } from './nat';
import { newCaptureRun } from './capture';
import { BENCH_METHODS, clientOf, clock, dbSignatures, learnBaseline, METHOD_NAME, newBench, runBench, RUN_MS, runSettings, TOLERANCES_PCT, type BenchConfig, type BenchMethod, type BenchState, type TolerancePct } from './bench';
import {
  inScope,
  MAX_RUNS,
  NMAP_GAP_MS,
  NMAP_PORTS,
  ownIp,
  parseCommand,
  PING_COUNT,
  PING_GAP_MS,
  reverseName,
  roundTripMs,
  TRACE_MAX_HOPS,
  TRACE_SILENT,
  zoneAnswer,
  type NameLookup,
  type NetstatRow,
  type PingRun,
  type TermRun,
  type TraceRun,
} from './terminal';

/**
 * A deliberately simplified network simulator.
 *
 * It models just enough to make the Unit 3 attacks real: Ethernet frames with
 * MAC addresses, IPv4 packets with TTLs, ARP, hubs vs. switches, routers with
 * routing tables, a toy BGP, DNS, HTTP/HTTPS, DHCP, and NAT. It skips everything
 * that doesn't teach (TCP handshakes, checksums, retransmission, ...).
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
  /**
   * Routers answer a ping whose TTL runs out with an ICMP "time exceeded"
   * message, so traceroute can find them (net-tools). Off by default: the
   * other labs never needed the extra packets.
   */
  icmpErrors: boolean;
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
  icmpErrors: false,
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
  congestion: () => 'This site can’t be reached. The link to it is full right now.',
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
  /** Floods loading links (see src/sim/congestion.ts). A flood fills a link so ordinary packets are dropped. */
  congestion: CongestionState = newCongestion();

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
    if (this.termWaiting.size) this.termEvent(e);
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
    const f: Frame = { id: this.nextFrameId++, src, dst, origin, ...body };
    // The simulated outbreak's tries are drawn red (malware.ts).
    const app = body.ip?.app;
    if (app?.kind === 'svc' && isProbe(this.outbreak, app.conn, app.reply)) f.malware = true;
    return f;
  }

  transmit(devId: string, ifaceId: string, frame: Frame, delay = this.opts.procMs): void {
    const peer = this.peer(devId, ifaceId);
    if (!peer) return;
    const iface = this.dev(devId).ifaces.find((i) => i.id === ifaceId)!;
    const link = this.links[iface.linkId!];
    // A flood fills the link; an ordinary packet finds no room and is dropped here (see congestion.ts).
    if (link && this.congestionDrop(devId, link, frame)) return;
    const copy = cloneFrame(frame);
    // A frame on a cable that gets unplugged before it arrives is lost.
    const stillLinked = () => this.links[link.id] === link;
    this.schedule(delay, () => {
      if (!stillLinked()) return;
      const me = this.devices[devId];
      if (me?.sniffing && me.captureOwn) this.capture(me, copy);
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
      // A MAC learned on a port in another VLAN counts as unknown (vlan.ts).
      const known = frame.dst === BROADCAST_MAC ? undefined : dev.macTable[frame.dst];
      const out = known && sameVlan(dev, ifaceId, known) ? known : undefined;
      if (out) {
        if (out !== ifaceId && portUp(dev, out)) this.transmit(dev.id, out, frame, this.opts.l2Ms);
        return;
      }
      for (const i of dev.ifaces) {
        if (i.id !== ifaceId && i.linkId && portUp(dev, i.id) && sameVlan(dev, ifaceId, i.id)) this.transmit(dev.id, i.id, frame, this.opts.l2Ms);
      }
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
    if (frame.dhcp) this.onDhcp(dev, iface, frame);
    else if (frame.arp) this.onArp(dev, iface, frame);
    else if (frame.bgp) this.onBgp(dev, iface, frame);
    else if (frame.ip) this.onIp(dev, frame, iface);
  }

  private capture(dev: Device, frame: Frame): void {
    // A capture started with startCapture numbers its own packets from 1, as Wireshark does (capture.ts).
    const no = dev.captureRun ? dev.captureRun.next++ : this.nextCaptureNo++;
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
    // A NAT router puts back the inside address on an answer, or drops what nobody asked for (nat.ts).
    if (dev.nat && iface?.id === dev.nat.outside && this.natInbound(dev, frame)) return;
    const pkt = frame.ip!;
    if (dev.vpn?.client && iface && this.vpnRelay(dev, frame, iface)) return;
    if (this.isLocal(dev, pkt.dst) || (dev.impersonate && this.hijacked(dev, pkt.dst))) {
      // A router firewall with guardSelf also checks requests from outside to the router itself.
      if (dev.firewall?.guardSelf && iface?.id === dev.firewall.outside && !isReply(pkt) && !this.fwPass(dev, iface.id, frame)) return;
      this.deliver(dev, pkt, frame);
      return;
    }
    if (!dev.forwarding) {
      this.drop(dev, 'not-forwarding', pkt, frame);
      return;
    }
    // Firewall software in a router checks what it forwards.
    if (dev.firewall && iface && !this.fwPass(dev, iface.id, frame)) return;
    // A packet aimed at one of this router's LANs' broadcast addresses is a directed broadcast.
    if (this.handleDirectedBroadcast(dev, frame, iface)) return;
    pkt.ttl -= 1;
    if (pkt.ttl <= 0) {
      this.drop(dev, 'ttl', pkt, frame);
      if (this.opts.icmpErrors) this.timeExceeded(dev, pkt, iface);
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
    } else if (reason === 'congestion' && pkt?.app.kind === 'http-req') {
      // A flood on a link upstream of the sender drops the request far from home; tell the browser that started it.
      const owner = this.deviceByIp(pkt.src);
      const ob = owner?.browser;
      if (owner && ob && ob.reqId === pkt.app.reqId && (ob.status === 'loading' || ob.status === 'resolving')) {
        this.failBrowser(owner, CANT_SEND.congestion!(pkt.dst, owner));
      }
    }
    if (this.termWaiting.size && pkt && !(reason === 'ttl' && this.opts.icmpErrors)) this.traceLost(pkt);
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

  /**
   * Pick the route, find the next hop's MAC, and send. `frame` is set when
   * forwarding someone else's packet. `burst` carries a flood's aggregate count
   * along: a forwarded burst keeps its size, and an amplified reply sends one.
   */
  routeAndSend(dev: Device, pkt: IpPacket, frame?: Frame, forged = frame?.forged ?? false, burst = frame?.burst): void {
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
    // A NAT router gives what it forwards out its outside port the shared address (nat.ts).
    if (frame && dev.nat && iface === dev.nat.outside) pkt = this.natOutbound(dev, pkt, iface);
    this.sendIp(dev, pkt, r.via ?? pkt.dst, iface, forged, burst);
  }

  private sendIp(dev: Device, pkt: IpPacket, nextHop: Ip, ifaceId: string, forged = false, burst?: Burst): void {
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
      this.transmit(dev.id, iface.id, this.frame(dev.id, iface.mac, entry.mac, { ip: pkt, forged: forged || undefined, burst }));
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

  private originate(dev: Device, pkt: IpPacket, forged = false, burst?: Burst): void {
    // A computer with no cable can't send anything, wherever it's going.
    if (dev.kind === 'host' && !dev.ifaces.some((i) => i.linkId)) {
      this.drop(dev, 'no-link', pkt);
      return;
    }
    this.routeAndSend(dev, pkt, undefined, forged, burst);
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
        else if (this.traceAnswered(dev, pkt, app.seq)) return;
        else {
          this.pings.delete(app.seq);
          const count = burstSize(frame);
          this.emit({ t: this.t, type: 'ping-reply', device: dev.id, from: pkt.src, seq: app.seq, count: count > 1 ? count : undefined, ttl: pkt.ttl });
        }
        return;
      case 'icmp-error':
        this.traceAnswered(dev, pkt, app.seq);
        return;
      case 'http-req':
        this.serveHttp(dev, pkt, frame);
        return;
      case 'http-res':
        this.onHttpResponse(dev, pkt);
        return;
      case 'dns-query':
        if (dev.resolver) this.resolverHandleQuery(dev, pkt);
        else if (dev.dnsZone) {
          const ptr = zoneAnswer(dev.dnsZone, app.name)?.ptr;
          this.reply(dev, pkt, { kind: 'dns-answer', name: app.name, ip: dev.dnsZone[app.name] ?? null, qid: app.qid, ...(ptr ? { ptr } : {}), aa: true });
        }
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

    const page = site.pages?.[req.path];
    let title = page?.title ?? site.title;
    let body = page?.page ?? site.page ?? 'Please sign in to continue.';
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
    if (pending.term !== undefined) {
      this.termDnsAnswer(dev, pending.term, pkt.src, ans);
      return;
    }
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
    this.dhcpLinkChanged(a.device, ia.id, true);
    this.dhcpLinkChanged(b.device, ib.id, true);
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
      this.dhcpLinkChanged(end.device, end.iface, false);
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
    // A resolver that also holds its own records (a small office's DNS server) answers those itself.
    const own = dev.dnsZone ? zoneAnswer(dev.dnsZone, q.name) : undefined;
    if (own) {
      this.reply(dev, pkt, { kind: 'dns-answer', name: q.name, ip: own.ip ?? null, qid: q.qid, ...(own.ptr ? { ptr: own.ptr } : {}), aa: true });
      return;
    }
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
      for (const w of pending.waiters) this.resolverReply(dev, w, ans.name, null, ans.ptr);
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

  private resolverReply(dev: Device, w: Waiter, name: string, ip: Ip | null, ptr?: string): void {
    this.originate(dev, {
      src: this.srcFor(dev, w.ip) ?? dev.ifaces.find((i) => i.ip)?.ip ?? '0.0.0.0',
      dst: w.ip,
      ttl: 64,
      proto: 'udp',
      srcPort: 53,
      dstPort: w.port,
      app: { kind: 'dns-answer', name, ip, qid: w.qid, ...(ptr ? { ptr } : {}) },
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

  // --- directed broadcast + congestion (smurf) ---
  // A directed broadcast forwards a ping to a whole LAN at once, drawing one
  // reply per host (amplification). A flood loads a link so ordinary packets
  // find no room. State lives in broadcast.ts and congestion.ts. See
  // src/sim/broadcast.ts and src/sim/congestion.ts.

  /**
   * Send an ICMP echo request (a ping) from `device` to `target`. With
   * `source` set, that address is written as the packet's source, so the reply
   * goes there, not back to the sender — a forged source, drawn red. With
   * `burst`, one frame stands for a wave of requests. Returns the sequence
   * number. Unlike `ping`, a forged or bursted echo isn't tracked for a reply
   * (the sender isn't the one expecting it), so it never reports a timeout.
   */
  echo(devId: string, target: Ip, opts: { source?: Ip; burst?: { count: number; vary?: Burst['vary'] } } = {}): number {
    const dev = this.dev(devId);
    const seq = this.nextPing++;
    const ownIp = this.srcFor(dev, target) ?? dev.ifaces.find((i) => i.ip)?.ip;
    const count = opts.burst ? Math.max(1, Math.floor(opts.burst.count)) : 1;
    const burst: Burst | undefined = count > 1 ? { count, vary: opts.burst?.vary ?? 'none', seed: this.randInt(2 ** 31) } : undefined;
    const spoofedBurst = burst?.vary === 'src-ip';
    let src = opts.source ?? ownIp ?? '0.0.0.0';
    if (spoofedBurst) src = burstIp(burst!.seed, 0);
    const forged = (opts.source !== undefined && opts.source !== ownIp) || spoofedBurst;
    const tracked = !forged && !burst;
    if (tracked) this.pings.set(seq, { device: devId, to: target });
    this.emit({ t: this.t, type: 'ping-sent', device: devId, to: target, seq, from: src, forged: forged || undefined, count: count > 1 ? count : undefined });
    const pkt: IpPacket = { src, dst: target, ttl: 64, proto: 'icmp', app: { kind: 'ping', seq, reply: false } };
    if (!ownIp) {
      this.drop(dev, 'no-ip', pkt);
      return seq;
    }
    this.originate(dev, pkt, forged, burst);
    if (tracked) {
      this.schedule(this.opts.pingTimeoutMs, () => {
        if (!this.pings.delete(seq)) return;
        this.emit({ t: this.t, type: 'ping-fail', device: devId, to: target, seq, reason: 'timeout' });
      });
    }
    return seq;
  }

  /**
   * A directed broadcast: a packet the router is forwarding is aimed at one of
   * its own LANs' broadcast addresses. On (the default), an echo request is
   * amplified into one reply per host, all aimed at the request's source; off,
   * the router drops it at the door (the fix). Returns true if it consumed the
   * packet. See src/sim/broadcast.ts.
   */
  private handleDirectedBroadcast(dev: Device, frame: Frame, ingress?: Iface): boolean {
    const pkt = frame.ip!;
    const lan = directedBroadcastIface(dev, pkt.dst);
    if (!lan) return false;
    // A broadcast that came in on the LAN itself isn't directed from outside; don't re-amplify.
    if (ingress && ingress.id === lan.id) {
      this.drop(dev, 'no-broadcast', pkt, frame);
      return true;
    }
    const echoRequest = pkt.app.kind === 'ping' && !pkt.app.reply;
    if (dev.directedBroadcast !== true || !echoRequest) {
      this.drop(dev, 'no-broadcast', pkt, frame);
      return true;
    }
    const hosts = lan.lanHosts!;
    // The smurf fingerprint: echo requests to a broadcast address, from outside. Step 6 reads this line.
    this.log(dev.id, {
      source: 'router',
      level: 'warn',
      msg: `ICMP echo request to ${pkt.dst} (directed broadcast) relayed to ${hosts} hosts`,
      fields: { src: pkt.src, dst: pkt.dst, proto: 'icmp', count: hosts },
    });
    const seq = (pkt.app as Extract<AppData, { kind: 'ping' }>).seq;
    const reply: IpPacket = { src: this.lanRepresentative(lan), dst: pkt.src, ttl: 64, proto: 'icmp', app: { kind: 'ping', seq, reply: true } };
    // One aggregated reply burst stands for every host answering: hosts × the size of the request wave.
    const count = hosts * burstSize(frame);
    this.routeAndSend(dev, reply, undefined, false, { count, vary: 'none', seed: this.randInt(2 ** 31) });
    return true;
  }

  /** The address the replies to a directed broadcast appear to come from: the lowest host on the LAN. */
  private lanRepresentative(lan: Iface): Ip {
    let best: Ip | undefined;
    for (const d of Object.values(this.devices)) {
      if (d.kind !== 'host') continue;
      for (const i of d.ifaces) {
        if (i.ip && lan.prefix !== undefined && sameSubnet(i.ip, lan.ip!, lan.prefix) && (best === undefined || ipToInt(i.ip) < ipToInt(best))) best = i.ip;
      }
    }
    return best ?? intToIp((((ipToInt(lan.ip!) & maskBits(lan.prefix!)) >>> 0) + 11) >>> 0);
  }

  /** Would admitting this ordinary packet overflow the link a flood is already filling? If so, drop it (congestion). */
  private congestionDrop(devId: string, link: Link, frame: Frame): boolean {
    const cap = link.capacityPps;
    if (cap === undefined || !frame.ip) return false;
    // A burst stands for the flood itself: it still crosses so students see it and a firewall can judge it.
    if (burstSize(frame) > 1) return false;
    if (linkLoad(this.congestion, link.id) + 1 <= cap) return false;
    this.drop(this.dev(devId), 'congestion', frame.ip, frame);
    return true;
  }

  /** Turn a router's directed-broadcast forwarding on or off. Off ends any smurf flood it was feeding. */
  setDirectedBroadcast(devId: string, on: boolean): void {
    const dev = this.dev(devId);
    dev.directedBroadcast = on;
    if (!on) clearFlood(this.congestion, 'smurf');
    this.emit({ t: this.t, type: 'config', device: devId, what: 'directed-broadcast', on });
  }

  /** Switch a flood on (or change its rate): a steady load of `rate` packets/second on `linkId`. */
  setLinkFlood(linkId: string, kind: FloodKind, rate: number): void {
    setFlood(this.congestion, linkId, kind, rate);
  }

  /** Switch off every flood of `kind`. */
  clearLinkFlood(kind: FloodKind): void {
    clearFlood(this.congestion, kind);
  }

  /** Switch off every flood, whatever its kind (used by step setups to start clean). */
  clearFloods(): void {
    clearAllFloods(this.congestion);
  }

  /** The current load on a link, in packets per second (the traffic meter reads this). */
  linkPps(linkId: string): number {
    return linkLoad(this.congestion, linkId);
  }

  /** A link's capacity in packets per second, or undefined for an effectively unlimited link. */
  linkCapacity(linkId: string): number | undefined {
    return this.links[linkId]?.capacityPps;
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
      if (!clientPasses(ap.wifi!, { mac: client.ifaces[0].mac, passphrase: wc.passphrase, user: wc.user, profile: wc.profile }).ok) continue;
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
            profile: client.wifiClient!.profile,
          });
          const key = `blocked:${blocker.id}:${res.reason}`;
          // A saved profile turns the network down on the device itself: the access point never hears a try.
          if (res.reason !== 'profile' && this.wifiLast.get(client.id) !== key) {
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
    this.widsCheck();
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
    this.dhcpLinkChanged(clientId, client.ifaces[0].id, true);
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
    this.dhcpLinkChanged(clientId, client.ifaces[0].id, false);
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

  /** Rename an AP's network. Clients that knew the old name drop off until they're told the new one (setWifiClient). */
  setWifiSsid(apId: string, ssid: string): void {
    const ap = this.dev(apId);
    if (!ap.wifi || ap.wifi.ssid === ssid) return;
    ap.wifi.ssid = ssid;
    this.emit({ t: this.t, type: 'config', device: apId, what: 'wifi-ssid', detail: ssid });
    this.recomputeWifi();
  }

  /**
   * Tell a Wi-Fi client which network to join and the password it holds, as
   * if someone typed them on the device. An empty `ssid` leaves Wi-Fi. A
   * `passphrase` left out keeps the one it has.
   */
  setWifiClient(devId: string, ssid: string, passphrase?: string): void {
    const wc = this.dev(devId).wifiClient;
    if (!wc) return;
    wc.ssid = ssid;
    if (passphrase !== undefined) wc.passphrase = passphrase;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'wifi-client', detail: ssid });
    this.recomputeWifi();
  }

  /** Hand the shelter's own devices the current passphrase (staff tell the families). Attackers are never told. */
  private shareWifiKey(ap: Device): void {
    if (!ap.wifi) return;
    for (const d of Object.values(this.devices)) {
      if (d.wifiClient && !d.attacker && !d.wifiClient.outsider && d.wifiClient.ssid === ap.wifi.ssid) {
        d.wifiClient.passphrase = ap.wifi.passphrase;
        // Staff re-save the network on devices that keep a profile (watch-the-air).
        if (d.wifiClient.profile) d.wifiClient.profile = { security: ap.wifi.security, auth: ap.wifi.auth, server: ap.wifi.server };
      }
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
  scan(devId: string, target: string, ports: number[] = SCAN_PORTS, gapMs = SCAN_GAP_MS): number {
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
      this.schedule(gapMs * k++, () => this.probePing(dev, scan, h.ip));
      for (const p of scan.ports) this.schedule(gapMs * k++, () => this.probePort(dev, scan, h.ip, p));
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
    if (v.action === 'deny' || rule?.log) this.log(dev.id, dev.zonePolicy ? zoneLogLine(dev.zonePolicy, pkt, dir, v) : logLine(pkt, dir, v));
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
      if (w.scan !== undefined) {
        // What the service said is its version, for nmap -sV (terminal.ts).
        if (status === 'open' && a.text) this.setBanner(dev.id, w.scan, w.ip, w.port, a.text);
        this.setProbe(dev.id, w.scan, w.ip, w.port, status);
      } else this.endConn(dev.id, a.conn, { status, banner: a.text });
      return;
    }
    const proto: L4 = pkt.proto === 'udp' ? 'udp' : 'tcp';
    const svc = serviceAt(dev, proto, pkt.dstPort);
    if (svc) probeArrived(this, this.outbreak, dev, a.conn, pkt.dstPort);
    this.reply(dev, pkt, { kind: 'svc', conn: a.conn, app: svc?.app ?? a.app, reply: true, status: svc ? 'open' : 'closed', text: svc?.banner });
  }

  private endConn(devId: string, id: number, patch: Partial<Conn>): void {
    probeEnded(this, this.outbreak, id);
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

  // --- VLANs, zone plan, malware, and zone policy (segmentation) ---
  // VLANs live in vlan.ts (state on SwitchPort.vlan), the zone plan in zones.ts,
  // the simulated outbreak in malware.ts, and the zone policy in zonePolicy.ts.
  // -------------------------------------------------------------------------

  /** The simulated outbreak (malware.ts). */
  private outbreak = newOutbreak();
  /** Zone plan: how closely each zone is guarded, by zone id (zones.ts). */
  zoneLevels: Record<string, ZoneLevel> = {};

  /** Put a switch port in a VLAN (1 is the default). Clears what the switch learned on that port. Needs configureSwitch first. */
  setVlan(devId: string, port: string, vlan: number): void {
    applyVlan(this, this.dev(devId), port, vlan);
  }

  /** Zone plan: put a device in a zone, or take it out with null. */
  setZone(devId: string, zone: string | null): void {
    const dev = this.dev(devId);
    if ((dev.zone ?? null) === zone) return;
    if (zone) dev.zone = zone;
    else delete dev.zone;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'zone', on: !!zone, detail: zone ?? undefined });
  }

  /** Zone plan: set how closely a zone is guarded, or clear it with null. */
  setZoneLevel(zone: string, level: ZoneLevel | null): void {
    if (level) this.zoneLevels[zone] = level;
    else delete this.zoneLevels[zone];
  }

  /**
   * Simulated outbreak: infect one host (patient zero). It spreads from there
   * (see malware.ts). `how` says how it got there, for the inspector. No-op if
   * already infected.
   */
  infect(devId: string, how?: string): void {
    infectHost(this, this.outbreak, devId, undefined, how);
  }

  /** Clear every simulated infection and stop the spread. */
  cleanMalware(): void {
    cleanOutbreak(this, this.outbreak);
  }

  /** True while the outbreak still has tries to make or answers to wait for. */
  malwareRunning(): boolean {
    return this.outbreak.rounds.size > 0 || this.outbreak.probes.size > 0;
  }

  /**
   * Give a router's firewall a zone policy (every cell Allow all) and let it
   * write the firewall's rules. Zones are listed in table order.
   */
  setupZonePolicy(devId: string, zones: PolicyZone[], outside?: ZonePolicy['outside']): void {
    const dev = this.dev(devId);
    if (!dev.firewall) throw new Error(`${devId} has no firewall`);
    dev.zonePolicy = newZonePolicy(zones, outside);
    this.writeZoneRules(dev);
  }

  /** Change one cell of a zone policy. The firewall's rules are rewritten to match. */
  setZonePolicy(devId: string, from: string, to: string, value: PolicyValue): void {
    const dev = this.dev(devId);
    const zp = dev.zonePolicy;
    if (!zp) throw new Error(`${devId} has no zone policy`);
    if (from === to || !zp.zones.some((z) => z.id === from) || !zp.zones.some((z) => z.id === to)) throw new Error(`No zone policy cell ${from} to ${to}`);
    if (!isPolicyValue(value)) throw new Error(`Bad zone policy value ${value}`);
    const key = cellKey(from, to);
    if ((zp.cells[key] ?? 'allow') === value) return;
    if (value === 'allow') delete zp.cells[key];
    else zp.cells[key] = value;
    this.writeZoneRules(dev);
    this.emit({ t: this.t, type: 'config', device: devId, what: 'zone-policy', detail: `${from}>${to}=${value}` });
  }

  private writeZoneRules(dev: Device): void {
    const fw = dev.firewall!;
    const zp = dev.zonePolicy!;
    fw.rules = [];
    zp.written = {};
    for (const r of policyRules(zp)) {
      const id = `r${fw.nextId++}`;
      fw.rules.push({ ...r.rule, id });
      zp.written[id] = { from: r.from, to: r.to };
    }
    fw.changedAt = this.t;
  }

  // -------------------------------------------------------------------------
  // --- network audit (net-audit) ---
  // Vulnerability scanner and risk register (audit.ts), management hardening
  // (hardening.ts), and the VPN with split tunneling (vpn.ts).
  // -------------------------------------------------------------------------

  /**
   * Run a vulnerability scan from the auditor `devId` (it needs a
   * `Device.audit`): a port scan of its scope, and the outside probe if one is
   * set. When both finish, a report is added to `audit.reports` and
   * 'scan-complete' fires. Does nothing while a scan is already running.
   */
  auditScan(devId: string): void {
    const dev = this.dev(devId);
    const a = dev.audit;
    if (!a || a.running) return;
    const id = a.nextReport++;
    const scans = [{ device: devId, id: this.scan(devId, a.scope, a.ports ?? SCAN_PORTS) }];
    if (a.outside) scans.push({ device: a.outside.from, id: this.scan(a.outside.from, a.outside.target, []) });
    a.running = { id, t: this.t, scans };
    const done = () => scans.every((s) => this.devices[s.device]?.scans?.find((x) => x.id === s.id)?.doneAt !== undefined);
    if (done()) {
      this.finishAudit(devId);
      return;
    }
    const off = this.on((e) => {
      if (e.type !== 'scan-done' || !done()) return;
      off();
      this.finishAudit(devId);
    });
  }

  private finishAudit(devId: string): void {
    const a = this.dev(devId).audit;
    const run = a?.running;
    if (!a || !run) return;
    delete a.running;
    const scanOf = (s?: { device: string; id: number }) => (s ? this.devices[s.device]?.scans?.find((x) => x.id === s.id) : undefined);
    const inside = scanOf(run.scans[0]);
    const outside = scanOf(run.scans[1]);
    const findings = auditFindings(this, a, inside, outside);
    const report: AuditReport = { id: run.id, t: run.t, doneAt: this.t, scope: a.scope, hosts: inside ? scanHosts(this, inside) : [], findings };
    a.reports.push(report);
    if (a.reports.length > MAX_REPORTS) a.reports.splice(0, a.reports.length - MAX_REPORTS);
    this.emit({ t: this.t, type: 'scan-complete', device: devId, report: run.id, findings: findings.map((f) => f.id) });
  }

  /** Set the auditor's rating of a finding in the risk register. A part left out keeps its value. */
  rateRisk(devId: string, finding: string, likelihood?: RiskLevel, impact?: RiskLevel): void {
    const a = this.dev(devId).audit;
    if (!a) return;
    const e = (a.register[finding] ??= {});
    if (likelihood) e.likelihood = likelihood;
    if (impact) e.impact = impact;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'risk-register', detail: finding });
  }

  /**
   * Change a management setting on a device with `Device.hardening`: turn its
   * Telnet or SSH login service on or off, or send logins through the
   * authentication server (removing local accounts) and back.
   */
  setHardening(devId: string, setting: HardenSetting, on: boolean): void {
    const dev = this.dev(devId);
    const h = dev.hardening;
    if (!h) return;
    let msg: string;
    if (setting === 'auth-server') {
      if (h.authServer === on) return;
      h.authServer = on;
      msg = on ? '%AAA-5-CONFIG: logins use the authentication server; local accounts removed' : '%AAA-5-CONFIG: logins use local accounts';
    } else {
      if (serviceOn(dev, setting) === on) return;
      const svc = MANAGEMENT_SERVICES[setting];
      const rest = (dev.services ?? []).filter((x) => !(x.proto === svc.proto && x.port === svc.port));
      dev.services = on ? [...rest, { ...svc }].sort((x, y) => x.port - y.port) : rest;
      msg = `%SYS-5-CONFIG_I: ${setting === 'ssh' ? 'SSH' : 'Telnet'} login ${on ? 'enabled' : 'disabled'}`;
    }
    this.emit({ t: this.t, type: 'config', device: devId, what: `harden-${setting}`, on });
    this.log(devId, { source: 'config', level: 'notice', msg, fields: { rule: setting, action: on ? 'on' : 'off' } });
  }

  /**
   * Change a VPN server's policy. Each client of this server follows it: with
   * split tunneling off, its default gateway becomes the tunnel; with it on,
   * the home router again.
   */
  setVpn(devId: string, patch: { splitTunneling?: boolean; auth?: VpnAuth }): void {
    const s = this.dev(devId).vpn?.server;
    if (!s) return;
    if (patch.splitTunneling !== undefined) s.splitTunneling = patch.splitTunneling;
    if (patch.auth) s.auth = patch.auth;
    for (const d of Object.values(this.devices)) {
      const c = d.vpn?.client;
      if (!c || c.server !== devId) continue;
      const gw = s.splitTunneling ? c.homeGateway : this.peerIp(d.id, c.iface);
      if (gw && d.gateway !== gw) this.setGateway(d.id, gw);
      if (!s.splitTunneling) c.nat = {};
    }
    const detail = `split tunneling ${s.splitTunneling ? 'on' : 'off'}, ${VPN_AUTH_LABEL[s.auth].toLowerCase()}`;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'vpn', on: s.splitTunneling, detail });
    this.log(devId, { source: 'vpn', level: 'notice', msg: `%VPN-5-POLICY: ${detail}`, fields: { action: s.splitTunneling ? 'split' : 'full', rule: s.auth } });
  }

  /**
   * A VPN client's view of an arriving packet (see vpn.ts). Returns true when
   * it handled the packet: carried a home device's packet into the tunnel,
   * passed a reply back to it, or refused it because split tunneling is off.
   */
  private vpnRelay(dev: Device, frame: Frame, iface: Iface): boolean {
    const c = dev.vpn!.client!;
    const pkt = frame.ip!;
    const key = natKey(pkt);
    if (iface.id === c.iface) {
      // A reply for a home device whose request this client carried in.
      const orig = key && isReply(pkt) && this.isLocal(dev, pkt.dst) ? c.nat[key] : undefined;
      if (!key || !orig) return false;
      delete c.nat[key];
      pkt.dst = orig;
      this.emit({ t: this.t, type: 'forwarded', device: dev.id, frame });
      this.routeAndSend(dev, pkt, frame);
      return true;
    }
    if (this.isLocal(dev, pkt.dst)) return false;
    const server = this.devices[c.server]?.vpn?.server;
    if (!server) return false;
    if (!server.splitTunneling) {
      this.drop(dev, 'vpn-split-off', pkt, frame);
      return true;
    }
    const tunnelIp = dev.ifaces.find((i) => i.id === c.iface)?.ip;
    if (this.egress(dev, pkt.dst).iface !== c.iface || !key || isReply(pkt) || !tunnelIp) return false;
    c.nat[key] = pkt.src;
    pkt.src = tunnelIp;
    pkt.ttl -= 1;
    if (pkt.ttl <= 0) {
      this.drop(dev, 'ttl', pkt, frame);
      return true;
    }
    this.emit({ t: this.t, type: 'forwarded', device: dev.id, frame });
    this.routeAndSend(dev, pkt, frame);
    return true;
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

  // -------------------------------------------------------------------------
  // --- DHCP and NAT (home-network) ---
  // A router port hands out addresses (dhcp.ts), and a router shares its
  // outside address with every device behind it (nat.ts).
  // -------------------------------------------------------------------------

  private nextXid = 1;

  /** Make `devId`'s port `iface` hand out `from` to `to` (its own address is the gateway it gives). */
  configureDhcpServer(devId: string, iface: string, from: Ip, to: Ip): void {
    const dev = this.dev(devId);
    (dev.dhcp ??= {}).server = newDhcpServer(iface, from, to);
    this.emit({ t: this.t, type: 'config', device: devId, what: 'dhcp-server', detail: `${iface} ${from}-${to}` });
  }

  /** Make a computer get its address automatically on `iface` (its first port by default). */
  configureDhcpClient(devId: string, iface?: string): void {
    const dev = this.dev(devId);
    (dev.dhcp ??= {}).client = newDhcpClient(iface ?? dev.ifaces[0].id);
  }

  /** A DHCP client asks for an address now: a Discover, broadcast. It also happens by itself when the client's link comes up. */
  dhcpStart(devId: string): void {
    const dev = this.dev(devId);
    const c = dev.dhcp?.client;
    const iface = c && dev.ifaces.find((i) => i.id === c.iface);
    if (!c || !iface?.linkId) return;
    c.state = 'selecting';
    c.xid = this.nextXid++;
    delete c.ip;
    this.dhcpSend(dev, iface, BROADCAST_MAC, { op: 'discover', xid: c.xid, client: iface.mac, name: dev.label });
  }

  /**
   * A link came up or went down on a port. A DHCP client asks for an address
   * shortly after its link comes up, and drops its address and gateway when the
   * link goes down. While a lesson setup arranges the network (Sim.quiet), it
   * gets its address at once, with no messages, so the map stays calm.
   */
  private dhcpLinkChanged(devId: string, ifaceId: string, up: boolean): void {
    const dev = this.devices[devId];
    const c = dev?.dhcp?.client;
    if (!c || c.iface !== ifaceId) return;
    const iface = dev.ifaces.find((i) => i.id === ifaceId);
    if (!iface) return;
    if (!up) {
      c.state = 'idle';
      delete c.xid;
      delete c.ip;
      if (iface.ip) this.setIp(devId, ifaceId, null);
      if (dev.gateway) this.setGateway(devId, null);
      return;
    }
    if (this.quiet) {
      this.dhcpBindNow(devId);
      return;
    }
    const linkId = iface.linkId;
    this.schedule(DHCP_START_MS, () => {
      if (!linkId || iface.linkId !== linkId) return;
      if (c.state === 'bound' && iface.ip) return;
      this.dhcpStart(devId);
    });
  }

  /**
   * Give a DHCP client its address right away, without the four messages: the
   * one the server already holds for its MAC, or the next free one. For lesson
   * setup and for networks built with clients already plugged in.
   */
  dhcpBindNow(devId: string): void {
    const dev = this.dev(devId);
    const c = dev.dhcp?.client;
    const iface = c && dev.ifaces.find((i) => i.id === c.iface);
    if (!c || !iface?.linkId) return;
    const at = this.dhcpServerFor(devId, iface.id);
    const s = at?.dev.dhcp?.server;
    if (!at || !s || !at.iface.ip || at.iface.prefix === undefined) return;
    const ip = pickAddress(s, iface.mac, this.dhcpUsed(at.iface, devId));
    if (!ip) return;
    grant(s, { mac: iface.mac, ip, name: dev.label, t: this.t });
    c.state = 'bound';
    c.ip = ip;
    delete c.xid;
    this.setIp(devId, iface.id, ip, at.iface.prefix);
    this.setGateway(devId, at.iface.ip);
  }

  /** The leases a router's DHCP server has handed out, oldest first. */
  dhcpLeases(devId: string) {
    return this.dev(devId).dhcp?.server?.leases ?? [];
  }

  /** The DHCP server port a client's broadcast would reach: across cables, switches, hubs, and Wi-Fi, to the first router port that serves. */
  private dhcpServerFor(devId: string, ifaceId: string): { dev: Device; iface: Iface } | undefined {
    const seen = new Set<string>([`${devId}/${ifaceId}`]);
    const queue: { device: string; iface: string }[] = [];
    const step = (d: string, i: string) => {
      const p = this.peer(d, i);
      if (p && !seen.has(`${p.device}/${p.iface}`)) {
        seen.add(`${p.device}/${p.iface}`);
        queue.push(p);
      }
    };
    step(devId, ifaceId);
    while (queue.length) {
      const at = queue.shift()!;
      const dev = this.devices[at.device];
      if (!dev) continue;
      if (dev.kind === 'switch' || dev.kind === 'hub') {
        for (const i of dev.ifaces) if (i.linkId && i.id !== at.iface && portUp(dev, i.id) && sameVlan(dev, at.iface, i.id)) step(dev.id, i.id);
        continue;
      }
      if (dev.dhcp?.server?.iface === at.iface) return { dev, iface: dev.ifaces.find((i) => i.id === at.iface)! };
    }
    return undefined;
  }

  /** Addresses on a server port's network that devices already use (other than `except`). */
  private dhcpUsed(serverIface: Iface, except?: string): Set<Ip> {
    return new Set(usedAddresses(Object.values(this.devices), networkOf(serverIface.ip!, serverIface.prefix!), except));
  }

  private dhcpSend(dev: Device, iface: Iface, dst: Mac, msg: DhcpMessage): void {
    this.transmit(dev.id, iface.id, this.frame(dev.id, iface.mac, dst, { dhcp: msg }));
    const client = fromClient(msg) ? dev.id : (this.deviceByMac(msg.client)?.id ?? '');
    this.emit({ t: this.t, type: 'dhcp', device: dev.id, what: msg.op, client, mac: msg.client, ip: msg.ip });
  }

  private onDhcp(dev: Device, iface: Iface, frame: Frame): void {
    const m = frame.dhcp!;
    const s = dev.dhcp?.server;
    if (s && s.iface === iface.id && fromClient(m)) {
      this.dhcpServe(dev, iface, m);
      return;
    }
    const c = dev.dhcp?.client;
    if (!c || c.iface !== iface.id || fromClient(m) || m.client !== iface.mac || m.xid !== c.xid) return;
    if (m.op === 'offer' && c.state === 'selecting' && m.ip) {
      c.state = 'requesting';
      c.ip = m.ip;
      this.dhcpSend(dev, iface, BROADCAST_MAC, { op: 'request', xid: m.xid, client: iface.mac, name: dev.label, ip: m.ip, server: m.server });
    } else if (m.op === 'ack' && c.state === 'requesting' && m.ip && m.ip === c.ip) {
      c.state = 'bound';
      delete c.xid;
      this.setIp(dev.id, iface.id, m.ip, m.prefix ?? 24);
      if (m.gateway) this.setGateway(dev.id, m.gateway);
    }
  }

  /** The server side: answer a Discover with an Offer, and a Request with an Ack. */
  private dhcpServe(dev: Device, iface: Iface, m: DhcpMessage): void {
    const s = dev.dhcp!.server!;
    if (!iface.ip || iface.prefix === undefined) return;
    const tag = `(${iface.id})`;
    const name = m.name ?? '';
    if (m.op === 'discover') {
      this.log(dev.id, { source: 'dhcp', level: 'info', msg: `DHCPDISCOVER${tag} ${m.client}`, fields: { mac: m.client, name } });
      const ip = pickAddress(s, m.client, this.dhcpUsed(iface, this.deviceByMac(m.client)?.id));
      if (!ip) {
        this.log(dev.id, { source: 'dhcp', level: 'warn', msg: `DHCPDISCOVER${tag} ${m.client}: no free address`, fields: { mac: m.client, name } });
        return;
      }
      offer(s, m.client, ip);
      this.log(dev.id, { source: 'dhcp', level: 'info', msg: `DHCPOFFER${tag} ${ip} ${m.client}`, fields: { mac: m.client, ip, name } });
      this.dhcpSend(dev, iface, m.client, { op: 'offer', xid: m.xid, client: m.client, name: m.name, ip, prefix: iface.prefix, gateway: iface.ip, server: iface.ip });
      return;
    }
    // A Request: grant it if it names this server and the address is free for that MAC. (No NAK otherwise.)
    if (!m.ip || (m.server && m.server !== iface.ip) || !canGrant(s, m.client, m.ip)) return;
    this.log(dev.id, { source: 'dhcp', level: 'info', msg: `DHCPREQUEST${tag} ${m.ip} ${m.client}`, fields: { mac: m.client, ip: m.ip, name } });
    grant(s, { mac: m.client, ip: m.ip, name: name || m.client, t: this.t });
    this.log(dev.id, { source: 'dhcp', level: 'info', msg: `DHCPACK${tag} ${m.ip} ${m.client} ${name}`.trimEnd(), fields: { mac: m.client, ip: m.ip, name } });
    this.dhcpSend(dev, iface, m.client, { op: 'ack', xid: m.xid, client: m.client, name: m.name, ip: m.ip, prefix: iface.prefix, gateway: iface.ip, server: iface.ip });
  }

  /** Make a router share its `outside` port's address with everything behind it. `forwards` opens ports on purpose. */
  configureNat(devId: string, outside: string, forwards: NatForward[] = []): void {
    const dev = this.dev(devId);
    if (!dev.ifaces.some((i) => i.id === outside)) throw new Error(`${devId} has no port ${outside}`);
    dev.nat = newNat(outside, forwards);
    this.emit({ t: this.t, type: 'config', device: devId, what: 'nat', on: true, detail: outside });
  }

  /** Port forwarding: send inbound `proto` packets for public `port` to an inside address and port. Replaces a rule for the same port. */
  addNatForward(devId: string, fwd: NatForward): void {
    const nat = this.dev(devId).nat;
    if (!nat) return;
    nat.forwards = [...nat.forwards.filter((f) => !(f.proto === fwd.proto && f.port === fwd.port)), { ...fwd, to: { ...fwd.to } }];
    this.emit({ t: this.t, type: 'config', device: devId, what: 'nat-forward', on: true, detail: `${fwd.proto} ${fwd.port} -> ${fwd.to.ip}:${fwd.to.port}` });
  }

  removeNatForward(devId: string, proto: 'tcp' | 'udp', port: number): void {
    const nat = this.dev(devId).nat;
    if (!nat) return;
    nat.forwards = nat.forwards.filter((f) => !(f.proto === proto && f.port === port));
    this.emit({ t: this.t, type: 'config', device: devId, what: 'nat-forward', on: false, detail: `${proto} ${port}` });
  }

  /** Empty a NAT router's table (answers to conversations already started then drop). */
  clearNat(devId: string): void {
    const nat = this.dev(devId).nat;
    if (!nat) return;
    nat.table = [];
    this.emit({ t: this.t, type: 'config', device: devId, what: 'nat-clear' });
  }

  /** The shared outside address of a NAT router, if it has one. */
  natPublicIp(devId: string): Ip | undefined {
    const dev = this.dev(devId);
    return dev.nat ? dev.ifaces.find((i) => i.id === dev.nat!.outside)?.ip : undefined;
  }

  /**
   * A packet arrived on a NAT router's outside port. An answer (or a packet for
   * a forwarded port) gets its inside address back in `frame.ip` and carries on;
   * returns true when the router dropped it because nobody inside asked.
   */
  private natInbound(dev: Device, frame: Frame): boolean {
    const nat = dev.nat!;
    const pkt = frame.ip!;
    const outside = dev.ifaces.find((i) => i.id === nat.outside);
    if (!outside?.ip || pkt.dst !== outside.ip) return false;
    const ports = natPorts(pkt);
    let e = findIn(nat, pkt);
    if (!e && ports) {
      const fwd = forwardFor(nat, pkt);
      if (fwd) {
        e = addEntry(nat, {
          proto: pkt.proto,
          inside: { ...fwd.to },
          public: fwd.port,
          remote: { ip: pkt.src, port: ports.src },
          t: this.t,
          used: this.t,
          forwarded: true,
        });
      }
    }
    if (e) {
      e.used = this.t;
      const back: IpPacket = { ...pkt, dst: e.inside.ip, nat: { by: dev.id, was: { dst: pkt.dst, dstPort: pkt.dstPort } } };
      if (pkt.proto !== 'icmp') back.dstPort = e.inside.port;
      // The copy of the dead packet inside an ICMP error gets its inside address back too.
      if (back.app.kind === 'icmp-error') back.app = { ...back.app, orig: { ...back.app.orig, src: e.inside.ip } };
      frame.ip = back;
      const entry = { ...e, inside: { ...e.inside }, remote: { ...e.remote } };
      this.emit({ t: this.t, type: 'nat', device: dev.id, what: 'in', entry, publicIp: outside.ip, who: this.deviceByIp(e.inside.ip)?.id, pkt: back });
      return false;
    }
    // An answer to the router's own traffic (its own ping, say) is the router's to read.
    if (isReply(pkt)) return false;
    const proto = pkt.proto.toUpperCase();
    const from = endText(pkt.src, pkt.srcPort, pkt.proto);
    const to = endText(pkt.dst, pkt.dstPort, pkt.proto);
    const fields: Record<string, string | number> = { src: pkt.src, dst: pkt.dst, proto: pkt.proto, action: 'drop' };
    if (pkt.srcPort !== undefined) fields.sport = pkt.srcPort;
    if (pkt.dstPort !== undefined) fields.dport = pkt.dstPort;
    this.log(dev.id, { source: 'nat', level: 'notice', msg: `Blocked incoming ${proto} ${from} -> ${to}, no matching connection`, fields });
    this.drop(dev, 'unsolicited', pkt, frame);
    return true;
  }

  /** A packet leaving a NAT router's outside port: give it the shared address and a public port, and write it in the table. */
  private natOutbound(dev: Device, pkt: IpPacket, ifaceId: string): IpPacket {
    const nat = dev.nat!;
    const out = dev.ifaces.find((i) => i.id === ifaceId);
    if (!out?.ip || out.prefix === undefined || sameSubnet(pkt.src, out.ip, out.prefix)) return pkt;
    const ports = natPorts(pkt);
    if (!ports) return { ...pkt, src: out.ip, nat: { by: dev.id, was: { src: pkt.src } } };
    let e = findOut(nat, pkt);
    if (!e) {
      e = addEntry(nat, {
        proto: pkt.proto,
        inside: { ip: pkt.src, port: ports.src },
        public: pkt.proto === 'icmp' ? ports.src : allocPort(nat),
        remote: { ip: pkt.dst, port: ports.dst },
        t: this.t,
        used: this.t,
      });
    }
    e.used = this.t;
    const moved: IpPacket = { ...pkt, src: out.ip, nat: { by: dev.id, was: { src: pkt.src, srcPort: pkt.srcPort } } };
    if (pkt.proto !== 'icmp') moved.srcPort = e.public;
    const entry = { ...e, inside: { ...e.inside }, remote: { ...e.remote } };
    this.emit({ t: this.t, type: 'nat', device: dev.id, what: 'out', entry, publicIp: out.ip, who: this.deviceByIp(pkt.src)?.id, pkt: moved });
    return moved;
  }

  // --- detection bench (detect-methods) ---
  // Replays a client's recorded day through signature, anomaly, or hybrid
  // detection and scores it. Pure scoring lives in bench.ts; its header
  // explains the model. Every setter emits a 'config' event so the UI redraws.
  // -------------------------------------------------------------------------

  private benchOf(devId: string): BenchState {
    const b = this.dev(devId).bench;
    if (!b) throw new Error(`${devId} is not a detection bench. Call sim.configureBench first.`);
    return b;
  }

  /** Make a device a detection bench for these clients. */
  configureBench(devId: string, config: BenchConfig): void {
    this.dev(devId).bench = newBench(config);
  }

  /** Pick a client's detection method or anomaly tolerance for the next run. */
  benchSet(devId: string, client: string, s: { method?: BenchMethod; tolerance?: TolerancePct }): void {
    const b = this.benchOf(devId);
    clientOf(b, client);
    const cur = b.settings[client];
    if (s.method && BENCH_METHODS.includes(s.method)) cur.method = s.method;
    if (s.tolerance !== undefined && TOLERANCES_PCT.includes(s.tolerance)) cur.tolerance = s.tolerance;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'bench-set', detail: client });
  }

  /** Record a client's anomaly baseline from one of its recorded days. */
  benchRecordBaseline(devId: string, client: string, day: string): void {
    const b = this.benchOf(devId);
    const c = clientOf(b, client);
    if (!c.baselineDays.includes(day) || !c.days[day]) return;
    b.settings[client].baseline = learnBaseline(c.days[day]);
    this.log(devId, {
      source: 'bench',
      level: 'info',
      msg: `baseline for ${c.name} recorded from ${c.days[day].label}`,
      fields: { client, action: 'baseline', day },
    });
    this.emit({ t: this.t, type: 'config', device: devId, what: 'bench-baseline', detail: client });
  }

  /** Install a signature database version (an update, or a roll back). */
  benchInstallDb(devId: string, version: string): void {
    const b = this.benchOf(devId);
    const v = b.config.versions.find((x) => x.id === version);
    if (!v || b.db === version) return;
    b.db = version;
    this.log(devId, {
      source: 'bench',
      level: 'info',
      msg: `signature database ${v.label} installed (${dbSignatures(b.config, version).length} signatures)`,
      fields: { action: 'db', db: version },
    });
    this.emit({ t: this.t, type: 'config', device: devId, what: 'bench-db', detail: version });
  }

  /** Which recorded day a client's runs replay. */
  benchSetDay(devId: string, client: string, day: string): void {
    const b = this.benchOf(devId);
    if (!clientOf(b, client).days[day]) return;
    b.settings[client].day = day;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'bench-day', detail: client });
  }

  /** Choose (or clear) the method recommended for a client. */
  benchPlan(devId: string, client: string, method: BenchMethod | null): void {
    const b = this.benchOf(devId);
    clientOf(b, client);
    if (method) b.plan[client] = method;
    else delete b.plan[client];
    this.emit({ t: this.t, type: 'config', device: devId, what: 'bench-plan', detail: client });
  }

  /**
   * Replay the client's day with its current settings. The result arrives
   * RUN_MS later: a summary line and one ALERT line per alert on the bench,
   * and a 'bench' event for each map device that alerted or was missed.
   */
  benchRun(devId: string, client: string): void {
    const b = this.benchOf(devId);
    const c = clientOf(b, client);
    const set = b.settings[client];
    const run = {
      no: b.runs.length + 1,
      client,
      method: set.method,
      db: b.db,
      tolerance: set.tolerance,
      baselineDay: set.baseline?.day,
      day: set.day,
      startedAt: this.t,
    };
    const baseline = set.baseline;
    b.runs.push(run);
    this.emit({ t: this.t, type: 'config', device: devId, what: 'bench-run', detail: client });
    this.schedule(RUN_MS, () => {
      const r = runBench(b.config, c, { method: run.method, db: run.db, tolerance: run.tolerance, baseline, day: run.day });
      const name = (id: string) => b.config.names?.[id] ?? id;
      const found = r.caught.length;
      const total = found + r.missed.length;
      this.log(devId, {
        source: 'bench',
        level: 'notice',
        msg: `RUN ${run.no} ${c.name} ${METHOD_NAME[run.method].toLowerCase()} (${runSettings(b, run)}), ${c.days[run.day].label}: ${found} of ${total} attacks caught, ${r.falseAlarms} false alarm${r.falseAlarms === 1 ? '' : 's'}`,
        fields: { run: run.no, client, method: run.method, caught: found, missed: r.missed.length, falseAlarms: r.falseAlarms, alerts: r.alerts.length },
      });
      for (const a of r.alerts) {
        const e = this.log(devId, {
          source: 'bench',
          level: 'alert',
          msg: `ALERT run ${run.no} ${c.name} ${a.by} ${clock(a.at)} ${name(a.host)}: ${a.why}`,
          fields: { run: run.no, client, day: run.day, by: a.by, host: a.host, at: clock(a.at), ...(a.attack ? { attack: a.attack } : {}), queue: a.queue ?? '' },
        });
        a.logNo = e.no;
      }
      Object.assign(run, { doneAt: this.t, result: r });
      const per = new Map<string, { alerts: number; missed: number }>();
      const bump = (host: string, k: 'alerts' | 'missed') => {
        const v = per.get(host) ?? { alerts: 0, missed: 0 };
        v[k]++;
        per.set(host, v);
      };
      for (const a of r.alerts) bump(a.host, 'alerts');
      const day = c.days[run.day];
      for (const id of r.missed) {
        const host = day.records.find((x) => x.attack === id)?.host;
        if (host) bump(host, 'missed');
      }
      for (const [host, v] of per) {
        if (v.alerts) this.emit({ t: this.t, type: 'bench', device: host, bench: devId, run: run.no, what: 'alerts', count: v.alerts });
        if (v.missed) this.emit({ t: this.t, type: 'bench', device: host, bench: devId, run: run.no, what: 'missed', count: v.missed });
      }
    });
  }

  // --- capture runs (packet-capture) ---

  /**
   * Start a new capture on a device, as Wireshark's Start button does: the old
   * list is cleared, and the new one is numbered from 1 and timed from now.
   * The device records its own frames too (captureOwn), like Wireshark on your
   * own computer. See capture.ts.
   */
  startCapture(devId: string): void {
    const dev = this.dev(devId);
    dev.capture = [];
    dev.captureRun = newCaptureRun(this.t);
    dev.captureOwn = true;
    dev.sniffing = true;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'capture', on: true });
  }

  /** Stop recording. The packets stay in the list to read. */
  stopCapture(devId: string): void {
    const dev = this.dev(devId);
    if (!dev.sniffing) return;
    dev.sniffing = false;
    if (dev.captureRun) dev.captureRun.stoppedAt = this.t;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'capture', on: false });
  }

  // -------------------------------------------------------------------------
  // --- terminal (net-tools) ---
  // Commands typed on a computer: ping, traceroute, nslookup, netstat, nmap.
  // Each leaves a run on Device.term that fills in as answers arrive, and a
  // 'term-done' event fires when it finishes. See terminal.ts.
  // -------------------------------------------------------------------------

  private nextRun = 1;
  /** What terminal runs are waiting for: ping sequence numbers ('p'), DNS question ids ('d'), and scan ids ('s'). */
  private termWaiting = new Map<string, { device: string; run: number; hop?: number }>();

  /**
   * Run a command line on a computer, as the student typed it. Throws on a line
   * parseCommand rejects, or on help and clear (they only change the screen).
   * Returns the run's id.
   */
  runCommand(devId: string, line: string): number {
    const dev = this.dev(devId);
    const p = parseCommand(line);
    if (!p.ok) throw new Error(`Bad command "${line}": ${p.msg}`);
    const c = p.parsed;
    if (c.cmd === 'help' || c.cmd === 'clear') throw new Error(`${c.cmd} only changes the screen; it never reaches the network`);
    const base = { id: this.nextRun++, t: this.t, line: p.line };
    let run: TermRun;
    switch (c.cmd) {
      case 'ping':
        run = { ...base, kind: 'ping', target: c.target, probes: [] };
        break;
      case 'traceroute':
        run = { ...base, kind: 'traceroute', target: c.target, hops: [] };
        break;
      case 'nslookup': {
        const reverse = isIp(c.name);
        run = { ...base, kind: 'nslookup', name: c.name, reverse, server: c.server ?? dev.dnsServer, status: 'pending' };
        break;
      }
      case 'netstat':
        run = { ...base, kind: 'netstat', all: c.all, programs: c.programs, rows: [] };
        break;
      case 'nmap':
        run = { ...base, kind: 'nmap', target: c.target, versions: c.versions, vuln: c.vuln };
        break;
    }
    const list = (dev.term ??= []);
    list.push(run);
    if (list.length > MAX_RUNS) list.splice(0, list.length - MAX_RUNS);
    switch (run.kind) {
      case 'ping':
      case 'traceroute':
      case 'nmap':
        this.termResolve(dev, run);
        break;
      case 'nslookup':
        this.termLookup(dev, run);
        break;
      case 'netstat':
        run.rows = this.netstatRows(dev, run.all);
        this.termDone(dev, run);
        break;
    }
    return run.id;
  }

  private termRun(devId: string, id: number): TermRun | undefined {
    return this.devices[devId]?.term?.find((r) => r.id === id);
  }

  private termDone(dev: Device, run: TermRun): void {
    if (run.doneAt !== undefined) return;
    run.doneAt = this.t;
    this.emit({ t: this.t, type: 'term-done', device: dev.id, run });
  }

  /** Ask `server` one DNS question for a terminal run; the answer comes back through onDnsAnswer. */
  private termAsk(dev: Device, run: TermRun, server: Ip, name: string): void {
    const qid = this.nextReqId++;
    dev.dnsPending[qid] = { name, reqId: -1, term: run.id };
    this.termWaiting.set(`d${qid}`, { device: dev.id, run: run.id });
    this.originate(dev, {
      src: this.srcFor(dev, server) ?? '0.0.0.0',
      dst: server,
      ttl: 64,
      proto: 'udp',
      srcPort: this.nextPort++,
      dstPort: 53,
      app: { kind: 'dns-query', name, qid },
    });
    this.schedule(this.opts.pingTimeoutMs, () => {
      if (!this.termWaiting.delete(`d${qid}`)) return;
      delete dev.dnsPending[qid];
      if (run.kind === 'nslookup') run.status = 'timeout';
      else if (run.kind !== 'netstat' && run.lookup) run.lookup.status = 'timeout';
      if (run.kind === 'traceroute') run.end = 'no-name';
      this.termDone(dev, run);
    });
  }

  /** A name to look up before a ping, traceroute, or nmap can start (or none: an address goes straight on). */
  private termResolve(dev: Device, run: PingRun | TraceRun | Extract<TermRun, { kind: 'nmap' }>): void {
    if (isIp(run.target) || run.target.includes('/')) {
      if (run.kind !== 'nmap') run.ip = run.target;
      this.termStart(dev, run);
      return;
    }
    const server = dev.dnsServer;
    const lookup: NameLookup = { name: run.target, server: server ?? '', status: 'pending' };
    run.lookup = lookup;
    if (!server) {
      lookup.status = 'nxdomain';
      if (run.kind === 'traceroute') run.end = 'no-name';
      this.termDone(dev, run);
      return;
    }
    this.termAsk(dev, run, server, run.target);
  }

  private termLookup(dev: Device, run: Extract<TermRun, { kind: 'nslookup' }>): void {
    if (!run.server) {
      run.status = 'no-server';
      this.termDone(dev, run);
      return;
    }
    this.termAsk(dev, run, run.server, run.reverse ? reverseName(run.name) : run.name);
  }

  private termDnsAnswer(dev: Device, id: number, from: Ip, ans: Extract<AppData, { kind: 'dns-answer' }>): void {
    if (!this.termWaiting.delete(`d${ans.qid}`)) return;
    const run = this.termRun(dev.id, id);
    if (!run || run.doneAt !== undefined) return;
    if (run.kind === 'nslookup') {
      const answer = run.reverse ? ans.ptr : (ans.ip ?? undefined);
      run.status = answer ? 'found' : 'nxdomain';
      run.answer = answer;
      run.authoritative = !!ans.aa;
      run.server = from;
      this.termDone(dev, run);
      return;
    }
    if (run.kind === 'netstat' || !run.lookup) return;
    if (!ans.ip) {
      run.lookup.status = 'nxdomain';
      if (run.kind === 'traceroute') run.end = 'no-name';
      this.termDone(dev, run);
      return;
    }
    run.lookup.status = 'found';
    if (run.kind === 'nmap') run.target = ans.ip;
    else run.ip = ans.ip;
    this.termStart(dev, run);
  }

  private termStart(dev: Device, run: PingRun | TraceRun | Extract<TermRun, { kind: 'nmap' }>): void {
    if (run.kind === 'ping') {
      for (let i = 0; i < PING_COUNT; i++) this.schedule(i * PING_GAP_MS, () => this.termPingOne(dev, run, i === PING_COUNT - 1));
    } else if (run.kind === 'traceroute') this.traceNext(dev, run);
    else {
      const id = this.scan(dev.id, run.target, NMAP_PORTS, NMAP_GAP_MS);
      run.scan = id;
      const scan = dev.scans?.find((x) => x.id === id);
      // Like real nmap, a scan that covers the scanning computer lists it too: it answers itself at once.
      const own = dev.ifaces.find((i) => i.ip && (i.ip === run.target || inScope([run.target], i.ip)))?.ip;
      if (scan && own && !scan.hosts.some((h) => h.ip === own)) {
        const open = new Set(listening(dev).filter((s) => s.proto === 'tcp').map((s) => s.port));
        const banners = Object.fromEntries(listening(dev).filter((s) => s.banner && open.has(s.port)).map((s) => [s.port, s.banner!]));
        scan.hosts.push({ ip: own, ping: 'open', ports: Object.fromEntries(NMAP_PORTS.map((p) => [p, open.has(p) ? 'open' : 'closed'])), banners });
        scan.hosts.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));
      }
      if (scan?.doneAt !== undefined) this.termDone(dev, run);
      else this.termWaiting.set(`s${id}`, { device: dev.id, run: run.id });
    }
  }

  /** One of ping's four echo requests, through Sim.ping, so the map shows it as any ping. */
  private termPingOne(dev: Device, run: PingRun, last: boolean): void {
    const seq = this.nextPing;
    run.probes.push({ seq, sentAt: this.t, status: 'pending' });
    this.termWaiting.set(`p${seq}`, { device: dev.id, run: run.id });
    this.ping(dev.id, run.ip!);
    this.schedule(this.opts.pingTimeoutMs, () => {
      const probe = run.probes.find((x) => x.seq === seq);
      if (this.termWaiting.delete(`p${seq}`) && probe) this.termPingTimeout(dev, run, probe);
    });
    if (last) this.pingMaybeDone(dev, run);
  }

  private pingMaybeDone(dev: Device, run: PingRun): void {
    if (run.probes.length === PING_COUNT && run.probes.every((x) => x.status !== 'pending')) this.termDone(dev, run);
  }

  /** Ping replies and failures for the terminal's pings, and finished scans for nmap. */
  private termEvent(e: SimEvent): void {
    if (e.type === 'scan-done') {
      const w = this.termWaiting.get(`s${e.scan.id}`);
      if (!w || w.device !== e.device) return;
      this.termWaiting.delete(`s${e.scan.id}`);
      const run = this.termRun(w.device, w.run);
      if (run) this.termDone(this.dev(w.device), run);
      return;
    }
    if (e.type !== 'ping-reply' && e.type !== 'ping-fail') return;
    if (e.seq === undefined) return;
    const w = this.termWaiting.get(`p${e.seq}`);
    if (!w || w.device !== e.device) return;
    const run = this.termRun(w.device, w.run);
    const probe = run?.kind === 'ping' ? run.probes.find((x) => x.seq === e.seq) : undefined;
    if (!run || run.kind !== 'ping' || !probe || probe.status !== 'pending') return;
    const dev = this.dev(w.device);
    if (e.type === 'ping-reply') {
      probe.status = 'reply';
      probe.from = e.from;
      probe.ttl = e.ttl;
      probe.ms = roundTripMs(this, dev.id, e.from, e.seq);
    } else {
      // Some failures send a message back: this computer or a router saying it can't
      // get there. The rest are silence, and the probe waits out its timeout.
      const at = e.at ? this.devices[e.at] : undefined;
      const mine = e.at === dev.id;
      const local = ['no-ip', 'no-link', 'no-gateway', 'gateway-off-net'].includes(e.reason);
      if (mine && (local || e.reason === 'arp-timeout')) {
        probe.status = 'unreachable';
        probe.why = local ? 'local' : 'host';
        probe.from = ownIp(dev);
      } else if (at && !mine && (e.reason === 'arp-timeout' || e.reason === 'no-route')) {
        probe.status = 'unreachable';
        probe.why = e.reason === 'no-route' ? 'net' : 'host';
        const back = this.srcFor(dev, run.ip!);
        probe.from = (back && this.srcFor(at, back)) || ownIp(at);
      } else {
        // Lost on the way: it counts as timed out once its answer would have been back.
        if (e.reason !== 'timeout') this.termLostAfter(`p${e.seq}`, probe.sentAt, () => this.termPingTimeout(dev, run, probe));
        return;
      }
    }
    this.termWaiting.delete(`p${e.seq}`);
    this.pingMaybeDone(dev, run);
  }

  private termPingTimeout(dev: Device, run: PingRun, probe: PingRun['probes'][number]): void {
    if (probe.status === 'pending') probe.status = 'timeout';
    this.pingMaybeDone(dev, run);
  }

  /** Mark a lost probe timed out when its answer would have come back: as long again as it travelled before it was lost. */
  private termLostAfter(key: string, sentAt: number, done: () => void): void {
    this.schedule(Math.max(0, this.t - sentAt) + this.opts.procMs, () => {
      if (this.termWaiting.delete(key)) done();
    });
  }

  /** A traceroute probe, or its answer, was dropped somewhere without a "time exceeded". */
  private traceLost(pkt: IpPacket): void {
    const a = pkt.app;
    if (a.kind !== 'ping' && a.kind !== 'icmp-error') return;
    const key = `p${a.seq}`;
    const w = this.termWaiting.get(key);
    if (w?.hop === undefined) return;
    const run = this.termRun(w.device, w.run);
    const hop = run?.kind === 'traceroute' ? run.hops.find((x) => x.seq === a.seq) : undefined;
    if (!run || run.kind !== 'traceroute' || !hop) return;
    const dev = this.dev(w.device);
    this.termLostAfter(key, hop.sentAt, () => {
      if (hop.status === 'pending') hop.status = 'timeout';
      this.traceStep(dev, run);
    });
  }

  /** traceroute: send the next probe, one hop farther than the last. */
  private traceNext(dev: Device, run: TraceRun): void {
    const ttl = run.hops.length + 1;
    const seq = this.nextPing++;
    const hop = { ttl, seq, sentAt: this.t, status: 'pending' as const };
    run.hops.push(hop);
    const src = this.srcFor(dev, run.ip!);
    if (!src) {
      run.end = 'local';
      this.termDone(dev, run);
      return;
    }
    this.termWaiting.set(`p${seq}`, { device: dev.id, run: run.id, hop: ttl });
    this.originate(dev, { src, dst: run.ip!, ttl, proto: 'icmp', app: { kind: 'ping', seq, reply: false } });
    this.schedule(this.opts.pingTimeoutMs, () => {
      if (!this.termWaiting.delete(`p${seq}`)) return;
      const h = run.hops.find((x) => x.seq === seq);
      if (h?.status === 'pending') h.status = 'timeout';
      this.traceStep(dev, run);
    });
  }

  /** A traceroute probe came back: an echo reply from the target, or a router's "time exceeded". */
  private traceAnswered(dev: Device, pkt: IpPacket, seq: number): boolean {
    const w = this.termWaiting.get(`p${seq}`);
    if (!w || w.device !== dev.id || w.hop === undefined) return false;
    const run = this.termRun(dev.id, w.run);
    const hop = run?.kind === 'traceroute' ? run.hops.find((x) => x.seq === seq) : undefined;
    if (!run || run.kind !== 'traceroute' || !hop) return false;
    this.termWaiting.delete(`p${seq}`);
    hop.status = 'answer';
    hop.from = pkt.src;
    hop.ms = roundTripMs(this, dev.id, pkt.src, seq);
    if (pkt.app.kind === 'ping') hop.last = true;
    this.traceStep(dev, run);
    return true;
  }

  private traceStep(dev: Device, run: TraceRun): void {
    if (run.doneAt !== undefined) return;
    const last = run.hops[run.hops.length - 1];
    let silent = 0;
    for (let i = run.hops.length - 1; i >= 0 && run.hops[i].status === 'timeout'; i--) silent++;
    if (last?.last) run.end = 'reached';
    else if (silent >= TRACE_SILENT) run.end = 'silent';
    else if (run.hops.length >= TRACE_MAX_HOPS) run.end = 'max';
    if (run.end) this.termDone(dev, run);
    else this.traceNext(dev, run);
  }

  /** A router where a ping's TTL ran out tells the sender, from the port the ping came in on. */
  private timeExceeded(dev: Device, pkt: IpPacket, iface?: Iface): void {
    const a = pkt.app;
    if (a.kind !== 'ping' || a.reply) return;
    const src = iface?.ip ?? this.srcFor(dev, pkt.src);
    if (!src) return;
    this.originate(dev, {
      src,
      dst: pkt.src,
      ttl: 64,
      proto: 'icmp',
      app: { kind: 'icmp-error', error: 'time-exceeded', seq: a.seq, orig: { src: pkt.src, dst: pkt.dst } },
    });
  }

  /** netstat's table right now: open connections (gone if the cable is out), and with `all`, the ports waiting for connections. */
  private netstatRows(dev: Device, all: boolean): NetstatRow[] {
    const me = ownIp(dev) ?? '0.0.0.0';
    const rows: NetstatRow[] = [];
    if (all) {
      for (const svc of listening(dev)) {
        const tcp = svc.proto === 'tcp';
        rows.push({ proto: tcp ? 'TCP' : 'UDP', local: `0.0.0.0:${svc.port}`, foreign: tcp ? '0.0.0.0:0' : '*:*', state: tcp ? 'LISTENING' : '', program: svc.program ?? svc.app });
      }
    }
    if (dev.ifaces.some((i) => i.linkId)) {
      for (const s of dev.sockets ?? []) {
        rows.push({ proto: s.proto === 'tcp' ? 'TCP' : 'UDP', local: `${me}:${s.port}`, foreign: `${s.remote}:${s.rport}`, state: 'ESTABLISHED', program: s.program });
      }
    }
    return rows;
  }

  private setBanner(devId: string, scanId: number, ip: Ip, port: number, text: string): void {
    const h = this.devices[devId]?.scans?.find((s) => s.id === scanId)?.hosts.find((x) => x.ip === ip);
    if (h) (h.banners ??= {})[port] = text;
  }

  // --- wireless watch (watch-the-air) ---
  // An access point with Device.wids keeps watch over the air: it logs networks
  // it hasn't heard before, shelter devices talking to a radio that isn't
  // approved, and its channel's noise, and it replays its record through alarm
  // rules. Log citations (citeLog) let a lesson ask for evidence rows. See src/sim/wids.ts.

  /** Log lines cited as evidence, oldest first. `t` is when the citation was made (see citeLog). */
  logCites: { device: string; no: number; t: number }[] = [];

  /** Give access point `apId` a wireless watch with its approved list and a record to replay. */
  configureWids(apId: string, opts: { approved: ApprovedAp[]; record?: AirRecord[]; noiseThreshold?: number; usualCrowd?: number }): void {
    const ap = this.dev(apId);
    if (!ap.wifi) throw new Error(`${apId} is not an access point`);
    ap.wids = newWidsState(opts);
    ap.wids.lastNoise = this.channelNoise(ap.wifi.channel);
  }

  /** Noise on a channel (0 to 100): near the top while jammed, a little higher with a crowd. */
  channelNoise(channel: number): number {
    const jammed = this.jam.on && this.jam.channel === channel;
    let extra = 0;
    for (const d of Object.values(this.devices)) {
      if (d.wids && d.wifi?.channel === channel) extra += Math.max(0, d.wids.crowd - d.wids.usualCrowd);
    }
    return noiseLevel({ jammed, crowd: extra, usualCrowd: 0 });
  }

  /** Mark one network from a scan as approved or unknown, or clear the mark with null. */
  widsMark(apId: string, bssid: Mac, mark: WidsMark | null): void {
    const w = this.dev(apId).wids;
    if (!w) return;
    if (mark) w.marks[bssid] = mark;
    else delete w.marks[bssid];
    this.emit({ t: this.t, type: 'wids', device: apId, what: 'mark', bssid, detail: mark ?? 'clear' });
  }

  widsSetRule(apId: string, rule: WidsRule, on: boolean): void {
    const w = this.dev(apId).wids;
    if (!w || w.rules[rule] === on) return;
    w.rules[rule] = on;
    this.emit({ t: this.t, type: 'wids', device: apId, what: 'rule', detail: `${rule} ${on ? 'on' : 'off'}` });
  }

  widsSetThreshold(apId: string, level: number): void {
    const w = this.dev(apId).wids;
    if (!w || w.noiseThreshold === level) return;
    w.noiseThreshold = level;
    this.emit({ t: this.t, type: 'wids', device: apId, what: 'rule', detail: `noise threshold ${level}` });
  }

  /** Run the saved record through the alarm rules: one alert line per alarm, and a scored run on Device.wids.replays. */
  widsReplay(apId: string): WidsReplay | undefined {
    const ap = this.dev(apId);
    const w = ap.wids;
    if (!w) return undefined;
    const run = replayRecord(w, this.t);
    w.replays.push(run);
    const on = WIDS_RULES.filter((r) => w.rules[r]);
    const days = Math.max(0, ...w.record.map((r) => r.day));
    // Each replay's lines carry its number, so repeated replays don't read as repeated alarms.
    const n = `replay ${w.replays.length}`;
    this.log(apId, {
      source: 'wids',
      level: 'info',
      msg: `${n}: replaying ${days} days of records with ${on.length ? on.join(', ') : 'no rules'}${w.rules.noise ? `, noise alarm above ${w.noiseThreshold}` : ''}`,
      fields: { action: 'replay', rules: on.join(' '), threshold: w.noiseThreshold },
    });
    for (const a of run.alerts) {
      this.log(apId, {
        source: 'wids',
        level: 'alert',
        msg: `${n} ${a.text}`,
        fields: { rule: a.rule, day: a.record.day, time: a.record.time, ...('bssid' in a.record ? { bssid: a.record.bssid } : {}), ...('mac' in a.record ? { mac: a.record.mac } : {}) },
      });
    }
    this.log(apId, {
      source: 'wids',
      level: 'info',
      msg: `${n} done: ${run.alerts.length} alert${run.alerts.length === 1 ? '' : 's'}`,
      fields: { action: 'replay-done', count: run.alerts.length },
    });
    this.emit({ t: this.t, type: 'wids', device: apId, what: 'replay', detail: run.settings });
    return run;
  }

  /** How many devices are online near access point `apId` (a crowd). Raises its channel's noise a little. */
  setWifiCrowd(apId: string, count: number): void {
    const w = this.dev(apId).wids;
    if (!w || w.crowd === count) return;
    w.crowd = count;
    this.emit({ t: this.t, type: 'wids', device: apId, what: 'crowd', detail: String(count) });
    this.recomputeWifi();
  }

  /** Save (or forget, with null) a device's Wi-Fi profile, the way staff set up a phone. */
  setWifiProfile(devId: string, profile: WifiProfile | null): void {
    const wc = this.dev(devId).wifiClient;
    if (!wc) return;
    if (profile) wc.profile = profile;
    else delete wc.profile;
    this.emit({ t: this.t, type: 'config', device: devId, what: 'wifi-profile', detail: profile ? `${profile.security} ${profile.auth}` : 'none' });
    this.recomputeWifi();
  }

  /** Cite a log line as evidence, or take the citation back. */
  citeLog(devId: string, no: number, on: boolean): void {
    const had = this.logCites.some((c) => c.device === devId && c.no === no);
    if (had === on) return;
    if (on) this.logCites.push({ device: devId, no, t: this.t });
    else this.logCites = this.logCites.filter((c) => !(c.device === devId && c.no === no));
    this.emit({ t: this.t, type: 'log-cite', device: devId, no, on });
  }

  /** Hook (end of recomputeWifi): each watching access point logs what changed in the air. */
  private widsCheck(): void {
    for (const ap of Object.values(this.devices)) {
      const w = ap.wids;
      if (!w || !ap.wifi) continue;
      // Networks it can hear: new radio addresses, and a known one that changed its name.
      for (const other of this.activeAps()) {
        if (other.id === ap.id || signalAt(other.wifi!, other, ap) < 1) continue;
        const o = other.wifi!;
        const seen = w.heard[o.bssid];
        if (seen && seen.ssid === o.ssid) continue;
        w.heard[o.bssid] = { t: seen?.t ?? this.t, ssid: o.ssid };
        const approved = isApproved(w, o.bssid);
        const msg = seen
          ? `network ${o.bssid} changed its name from "${seen.ssid}" to "${o.ssid}"`
          : `new network heard: "${o.ssid}" ${o.bssid}, channel ${o.channel}, ${o.security === 'open' ? 'open' : o.security.toUpperCase()}`;
        this.log(ap.id, { source: 'wids', level: approved ? 'info' : 'warn', msg, fields: { ssid: o.ssid, bssid: o.bssid, channel: o.channel, security: o.security, action: seen ? 'renamed' : 'heard' } });
        this.emit({ t: this.t, type: 'wids', device: ap.id, what: 'heard', bssid: o.bssid, detail: o.ssid });
      }
      // Shelter devices now talking to a radio that isn't approved.
      for (const c of Object.values(this.devices)) {
        if (!c.wifiClient || c.attacker) continue;
        const mac = c.ifaces[0].mac;
        const joined = c.wifiClient.joinedAp ? this.devices[c.wifiClient.joinedAp]?.wifi : undefined;
        const stray = joined && !isApproved(w, joined.bssid) ? joined.bssid : undefined;
        if (stray === w.strays[mac]) continue;
        if (!stray) {
          delete w.strays[mac];
          continue;
        }
        w.strays[mac] = stray;
        this.log(ap.id, {
          source: 'wids',
          level: 'warn',
          msg: `${c.label} (${mac}) seen talking to "${joined!.ssid}" ${stray}, which is not on the approved list`,
          fields: { mac, bssid: stray, ssid: joined!.ssid, action: 'stray' },
        });
        this.emit({ t: this.t, type: 'wids', device: ap.id, what: 'stray', bssid: stray, detail: mac });
      }
      // The noise on its own channel, when it changes.
      const noise = this.channelNoise(ap.wifi.channel);
      if (noise !== w.lastNoise) {
        w.lastNoise = noise;
        const jammed = this.jam.on && this.jam.channel === ap.wifi.channel;
        const joined = Object.values(this.devices).filter((d) => d.wifiClient?.joinedAp === ap.id).length;
        const online = jammed ? joined : joined + w.crowd;
        this.log(ap.id, {
          source: 'wids',
          level: noise > 50 ? 'warn' : noise > NORMAL_NOISE_MAX ? 'notice' : 'info',
          msg: `channel ${ap.wifi.channel} noise level ${noise} (quiet is about ${QUIET_NOISE}), ${online} device${online === 1 ? '' : 's'} connected`,
          fields: { channel: ap.wifi.channel, noise, devices: online, action: 'noise' },
        });
        this.emit({ t: this.t, type: 'wids', device: ap.id, what: 'noise', detail: String(noise) });
      }
    }
  }
}

/** Time between one scan probe and the next. */
const SCAN_GAP_MS = 80;
/** How long a DHCP client waits after its link comes up before it asks for an address. */
const DHCP_START_MS = 400;

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
