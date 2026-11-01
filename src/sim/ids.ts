import { intToIp, maskBits, parsePrefix, prefixContains, type Ip, type Mac } from './addr';
import { burstMacs } from './burst';
import { isReply } from './services';
import type { Sim } from './sim';
import { portLabel, portUp } from './switchsec';
import type { Device, Frame, IpPacket, LogEntry } from './types';

/**
 * Intrusion detection and prevention, and a SIEM (built for `logs`).
 *
 * SENSOR (IDS, and IPS with prevention on)
 *   `Device.ids.sensor` makes a device a network sensor; set it up with
 *   `sim.configureIds(id, { taps, home, ... })`. The sensor sees every frame a
 *   tapped device receives (`taps`): a tap on a switch is its mirror port (every
 *   frame the switch handles); a tap on one router port sees what arrives
 *   there. In the simulation the sensor is handed each frame directly, so no
 *   mirrored copies cross the map. A frame that arrives at a shut switch port
 *   is not seen. The sensor never sees its own frames.
 *
 *   Each kind of detection is switched on by itself:
 *   - signatures (`SIGNATURES`): fixed patterns of known attacks. ARP replies
 *     that give a watched address (`arpWatch`, usually the gateway) another
 *     MAC; a MAC flood on a switch port; a port scan; a ping to a broadcast
 *     address; traffic to or from an address on the threat feed (`feed`).
 *   - anomaly: each new connection from a home host is compared with a
 *     recorded `Baseline`. It earns one point of deviation for each habit it
 *     breaks: outside office hours, a peer the host never talks to, an upload
 *     more than 10 times the host's typical size. `tolerance` decides how many
 *     points raise an alert (`TOLERANCE_MIN`). Without a baseline it judges
 *     nothing. `IpPacket.flow` (FlowInfo) says how many bytes a connection
 *     moved and, for traffic replayed from a recording, when it first
 *     happened: the anomaly rule judges the hour from that.
 *   Signatures and anomaly on together is hybrid detection.
 *   - prevention: the sensor also acts on its alerts, a moment later
 *     (`IPS_DELAY_MS`), through the network's own controls. An alert about
 *     frames that came in a switch port shuts that port (sim.setPortShutdown);
 *     an alert about an address blocks it with two deny rules at the top of
 *     the `firewall` device's rulebook (sim.fwAddRule).
 *
 *   Every alert is a log line on the sensor (source 'ids', level 'alert',
 *   `fields.signature`) and an 'ids' sim event (what 'alert'). The same alert
 *   isn't repeated within DEDUPE_MS, unless the settings change in between.
 *   Every prevention is a log line (source 'ips', fields.action 'shut' with
 *   `port`, or 'block' with `blocked`) and an 'ids' event (what 'shut' or 'block').
 *   Each anomaly judgment, alert or not, is kept in `judged` so the lesson can
 *   say why nothing fired.
 *
 * SIEM
 *   `Device.ids.siem` makes a device a SIEM that collects the logs of
 *   `sources`; set it up with `sim.configureSiem`. `sim.siemCorrelate` groups
 *   the lines that name the same outside address (`fields.src`) within
 *   `window` into one incident once `minKinds` different kinds of event appear
 *   (`kindOf`: a firewall deny, a sensor alert, a failed sign-in). Opening an
 *   incident writes an 'INCIDENT n open' alert line on the SIEM.
 *   `sim.siemTriage` records an analyst's verdict and action.
 *   AI scores: `sim.aiScore` stores a score from 0 to 1 for each event,
 *   `sim.aiSetThreshold` sets the alert threshold, and `aiCounts` says how many
 *   real attacks the threshold catches and how many false alerts it raises.
 *
 * API
 *   Sim (sim.ts, section "ids"): configureIds, idsSetSignatures, idsSetAnomaly,
 *     idsSetPrevention, idsRecordBaseline, configureSiem, siemCorrelate,
 *     siemTriage, aiScore, aiSetThreshold. connectService(..., { flow }).
 *   Here: alertLine (the line a sensor writes, for seeding history too),
 *     judge, kindOf, aiCounts, aiAlerts, TOLERANCE_MIN, SIGNATURES.
 */

export type Tolerance = 'loose' | 'medium' | 'strict';

export const TOLERANCES: Tolerance[] = ['loose', 'medium', 'strict'];

/** The smallest deviation that raises an anomaly alert at each tolerance. There are three habits to break, so Loose never alerts on one connection. */
export const TOLERANCE_MIN: Record<Tolerance, number> = { loose: 4, medium: 2, strict: 1 };

/** The signature set's patterns. */
export const SIGNATURES: { id: string; text: string }[] = [
  { id: 'arp-spoof', text: 'An ARP reply gives the gateway a MAC address that is not its own.' },
  { id: 'mac-flood', text: 'More than 20 new source MACs on one switch port within 5 seconds.' },
  { id: 'port-scan', text: 'One address tries more than 15 ports within 60 seconds.' },
  { id: 'icmp-broadcast', text: 'A ping sent to a broadcast address.' },
  { id: 'known-bad-ip', text: 'Traffic to or from an address on the threat feed.' },
];

export const MAC_FLOOD = { macs: 20, windowMs: 5000 };
export const PORT_SCAN = { ports: 15, windowMs: 60_000 };
/** The same alert (same signature and subject) isn't logged again this soon. */
export const DEDUPE_MS = 10_000;
/** How long the IPS takes to act after an alert. */
export const IPS_DELAY_MS = 200;
/** An upload counts as unusual above this many times the host's typical upload. */
export const UPLOAD_FACTOR = 10;

const DAY = 24 * 3600 * 1000;
const MAX_JUDGED = 8;

/** What one packet stands for: the bytes its connection moved, and when it first happened if it is replayed from a recording. `IpPacket.flow`. */
export interface FlowInfo {
  bytes?: number;
  /** Sim time the recorded traffic originally happened (negative: before the lab started). */
  recordedAt?: number;
}

/** Where a sensor gets its copies: every frame `device` receives, or only those arriving on `iface`. */
export interface IdsTap {
  device: string;
  iface?: string;
}

/** A picture of a normal week, per home host. */
export interface Baseline {
  /** Office hours: from `hours[0]`:00 up to `hours[1]`:00. */
  hours: [number, number];
  /** Addresses each host normally talks to. */
  peers: Record<Ip, Ip[]>;
  /** Each host's typical upload, in bytes. */
  typical: Record<Ip, number>;
  /** Typical upload for a host the baseline doesn't list. */
  defaultTypical: number;
  /** When it was recorded (sim time). */
  recordedAt?: number;
}

/** How the anomaly rule judged one connection. */
export interface Judgment {
  t: number;
  host: Ip;
  peer: Ip;
  /** Wall-clock time the connection happened, "03:12". */
  time: string;
  hour: number;
  bytes: number;
  offHours: boolean;
  newPeer: boolean;
  big: boolean;
  deviation: number;
  /** Deviation needed to alert at the tolerance in force. */
  min: number;
  alerted: boolean;
}

export interface IdsSensor {
  signatures: boolean;
  anomaly: boolean;
  tolerance: Tolerance;
  prevention: boolean;
  baseline?: Baseline;
  taps: IdsTap[];
  /** The network the sensor protects ("10.10.20.0/24"): its hosts get anomaly checks. */
  home: string;
  /** Address -> the MAC that really owns it. An ARP reply that says otherwise fires arp-spoof. */
  arpWatch: Record<Ip, Mac>;
  /** Threat feed: address -> tag ("known-c2"). */
  feed: Record<Ip, string>;
  /** The firewall the IPS writes block rules into. */
  firewall?: string;
  /** Time of day at sim time 0, in ms. */
  clockMs: number;
  /** Size of the signature set, for display. */
  rules: number;
  /** When the sensor last saw a frame. */
  lastSeen?: number;
  /** The latest anomaly judgments (newest last). */
  judged: Judgment[];
  /** Recent sightings for the windowed signatures: key -> [time, value] pairs. */
  windows: Record<string, number[][]>;
  /** When each alert (signature and subject) last fired. Cleared when a setting changes. */
  fired: Record<string, number>;
}

export interface SensorOptions {
  taps: IdsTap[];
  home: string;
  arpWatch?: Record<Ip, Mac>;
  feed?: Record<Ip, string>;
  firewall?: string;
  /** Time of day at sim time 0 ("08:00"), as in LabDef.clock. */
  clock?: string;
  rules?: number;
}

/** One kind of event inside an incident. */
export interface IncidentPart {
  kind: string;
  /** Device and log line where this kind first appeared. */
  device: string;
  firstNo: number;
  first: number;
  /** Time of its latest line. */
  last: number;
  count: number;
}

export type Verdict = 'real' | 'false';
export type TriageAction = 'escalate' | 'close';

export interface Incident {
  id: number;
  src: Ip;
  /** Time of its first line, and when the SIEM opened it (sim time). */
  start: number;
  opened: number;
  /** The 'INCIDENT n open' line on the SIEM. */
  logNo: number;
  parts: IncidentPart[];
  verdict?: Verdict;
  action?: TriageAction;
  triagedAt?: number;
}

/** One event an AI model scored. */
export interface AiEvent {
  id: string;
  label: string;
  /** Wall-clock time, "02:30". */
  when: string;
  /** 0 to 1: how likely the model thinks it is malicious. */
  score: number;
  /** What it really was (known after investigation). */
  truth: 'attack' | 'false-alarm' | 'normal';
}

export interface Siem {
  sources: string[];
  home: string;
  window: number;
  minKinds: number;
  nextIncident: number;
  incidents: Incident[];
  ai?: { events: AiEvent[]; scoredAt: number };
  /** AI alert threshold, 0 to 1. */
  threshold: number;
}

export interface SiemOptions {
  sources: string[];
  home: string;
  /** Default 20 minutes. */
  window?: number;
  /** Default 3. */
  minKinds?: number;
  /** Number of the first incident. Default 1. */
  firstIncident?: number;
  /** Default 0.5. */
  threshold?: number;
}

/** `Device.ids`: a sensor, a SIEM, or both. */
export interface IdsState {
  sensor?: IdsSensor;
  siem?: Siem;
}

/** An 'ids' sim event, minus the time. */
export interface IdsEventBody {
  device: string;
  what: 'alert' | 'shut' | 'block';
  signature: string;
  detail: string;
  /** The port shut or the address blocked. */
  target?: string;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function clockMs(clock = '00:00'): number {
  const [h, m] = clock.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) * 60_000;
}

export function newSensor(o: SensorOptions): IdsSensor {
  return {
    signatures: false,
    anomaly: false,
    tolerance: 'loose',
    prevention: false,
    taps: o.taps.map((t) => ({ ...t })),
    home: o.home,
    arpWatch: { ...o.arpWatch },
    feed: { ...o.feed },
    firewall: o.firewall,
    clockMs: clockMs(o.clock),
    rules: o.rules ?? 248,
    judged: [],
    windows: {},
    fired: {},
  };
}

export function newSiem(o: SiemOptions): Siem {
  return {
    sources: [...o.sources],
    home: o.home,
    window: o.window ?? 20 * 60_000,
    minKinds: o.minKinds ?? 3,
    nextIncident: o.firstIncident ?? 1,
    incidents: [],
    threshold: o.threshold ?? 0.5,
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Minutes past midnight at sim time `t`. */
export function minuteOfDay(clock: number, t: number): number {
  return Math.floor((((clock + t) % DAY) + DAY) % DAY / 60_000);
}

export function hhmm(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** 94371840 -> "90 MB". */
export function megabytes(bytes: number): string {
  const mb = bytes / 1048576;
  return mb >= 10 ? `${Math.round(mb)} MB` : mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The log line a sensor writes for an alert. `fields` are the facts
 * (arp-spoof: ip, mac, was; mac-flood: port, count, window; port-scan: src,
 * ports, window; icmp-broadcast: src, dst; known-bad-ip: ip, threat;
 * anomaly: host, peer, bytes, deviation, hour). `why` is anomaly's reasons.
 */
export function alertLine(signature: string, fields: Record<string, string | number>, why?: string): Omit<LogEntry, 'no' | 't' | 'device'> {
  const f = fields;
  let text: string;
  switch (signature) {
    case 'arp-spoof':
      text = `${f.ip} now claims MAC ${f.mac} (was ${f.was})`;
      break;
    case 'mac-flood':
      text = `${f.count} new MACs on switch ${portLabel(String(f.port))} in ${f.window}s`;
      break;
    case 'port-scan':
      text = `${f.src} hit ${f.ports} ports in ${f.window}s`;
      break;
    case 'icmp-broadcast':
      text = `${f.src} pinged the broadcast address ${f.dst}`;
      break;
    case 'known-bad-ip':
      text = `${f.ip} is on the threat feed (${f.threat})`;
      break;
    case 'anomaly':
      text = `${f.host} off-baseline (${why ?? `deviation ${f.deviation}`})`;
      break;
    default:
      text = why ?? '';
  }
  return { source: 'ids', level: 'alert', msg: `ALERT ${signature}: ${text}`, fields: { signature, ...fields } };
}

// ---------------------------------------------------------------------------
// The sensor
// ---------------------------------------------------------------------------

function inNet(prefix: string, ip: Ip): boolean {
  try {
    return prefixContains(prefix, ip);
  } catch {
    return false;
  }
}

function isBroadcast(s: IdsSensor, ip: Ip): boolean {
  if (ip === '255.255.255.255') return true;
  const { net, len } = parsePrefix(s.home);
  return len < 31 && ip === intToIp((net | (~maskBits(len) >>> 0)) >>> 0);
}

/** Add a sighting to a window and drop the old ones. Returns what's left. */
function sight(s: IdsSensor, key: string, t: number, value: number, windowMs: number): number[][] {
  const w = (s.windows[key] ?? []).filter(([at]) => t - at <= windowMs);
  w.push([t, value]);
  s.windows[key] = w;
  return w;
}

/** How the anomaly rule judges one connection from a home host. Needs a baseline. */
export function judge(s: IdsSensor, pkt: IpPacket, now: number): Judgment {
  const b = s.baseline!;
  const at = pkt.flow?.recordedAt ?? now;
  const minutes = minuteOfDay(s.clockMs, at);
  const hour = Math.floor(minutes / 60);
  const bytes = pkt.flow?.bytes ?? 0;
  const offHours = hour < b.hours[0] || hour >= b.hours[1];
  const newPeer = !(b.peers[pkt.src] ?? []).includes(pkt.dst);
  const big = bytes > UPLOAD_FACTOR * (b.typical[pkt.src] ?? b.defaultTypical);
  const deviation = Number(offHours) + Number(newPeer) + Number(big);
  const min = TOLERANCE_MIN[s.tolerance];
  return { t: now, host: pkt.src, peer: pkt.dst, time: hhmm(minutes), hour, bytes, offHours, newPeer, big, deviation, min, alerted: deviation >= min };
}

/** A sensor gets a copy of one frame that `tap` received on `ifaceId`. Called by the sim for each tap. */
export function observe(sim: Sim, sensorId: string, tap: Device, ifaceId: string, frame: Frame): void {
  const dev = sim.devices[sensorId];
  const s = dev?.ids?.sensor;
  if (!s || frame.origin === sensorId) return;
  if (tap.kind === 'switch' && !portUp(tap, ifaceId)) return;
  s.lastSeen = sim.t;
  if (s.signatures) matchSignatures(sim, dev, s, tap, ifaceId, frame);
  if (s.anomaly) checkAnomaly(sim, dev, s, frame);
}

interface Response {
  /** Frames came in this switch port: prevention shuts it. */
  port?: { device: string; port: string };
  /** Prevention blocks this address at the firewall. */
  block?: Ip;
}

function matchSignatures(sim: Sim, dev: Device, s: IdsSensor, tap: Device, ifaceId: string, frame: Frame): void {
  const viaPort = tap.kind === 'switch' ? { device: tap.id, port: ifaceId } : undefined;
  const a = frame.arp;
  if (a?.op === 'reply') {
    const real = s.arpWatch[a.senderIp];
    if (real && a.senderMac !== real) {
      raise(sim, dev, s, `arp-spoof|${a.senderIp}|${a.senderMac}`, alertLine('arp-spoof', { ip: a.senderIp, mac: a.senderMac, was: real }), { port: viaPort });
    }
  }
  if (tap.kind === 'switch') {
    const fresh = burstMacs(frame).filter((m) => tap.macTable[m] !== ifaceId).length;
    if (fresh) {
      const w = sight(s, `macs|${tap.id}|${ifaceId}`, sim.t, fresh, MAC_FLOOD.windowMs);
      const count = w.reduce((sum, [, n]) => sum + n, 0);
      if (count > MAC_FLOOD.macs) {
        raise(sim, dev, s, `mac-flood|${tap.id}|${ifaceId}`, alertLine('mac-flood', { device: tap.id, port: ifaceId, count, window: MAC_FLOOD.windowMs / 1000 }), {
          port: viaPort,
        });
      }
    }
  }
  const p = frame.ip;
  if (!p) return;
  if (p.app.kind === 'ping' && !p.app.reply && isBroadcast(s, p.dst)) {
    raise(sim, dev, s, `icmp-broadcast|${p.src}`, alertLine('icmp-broadcast', { src: p.src, dst: p.dst, proto: 'icmp' }), { block: p.src });
  }
  const bad = s.feed[p.dst] ? p.dst : s.feed[p.src] ? p.src : undefined;
  if (bad) {
    raise(sim, dev, s, `known-bad-ip|${bad}`, alertLine('known-bad-ip', { ip: bad, threat: s.feed[bad], src: p.src, dst: p.dst }), { block: bad });
  }
  if (p.dstPort !== undefined && !isReply(p)) {
    const w = sight(s, `ports|${p.src}`, sim.t, p.dstPort, PORT_SCAN.windowMs);
    const ports = new Set(w.map(([, port]) => port)).size;
    if (ports > PORT_SCAN.ports) {
      raise(sim, dev, s, `port-scan|${p.src}`, alertLine('port-scan', { src: p.src, ports, window: PORT_SCAN.windowMs / 1000 }), { block: p.src });
    }
  }
}

function checkAnomaly(sim: Sim, dev: Device, s: IdsSensor, frame: Frame): void {
  const p = frame.ip;
  if (!p || p.app.kind !== 'svc' || p.app.reply || !s.baseline || !inNet(s.home, p.src)) return;
  const j = judge(s, p, sim.t);
  s.judged.push(j);
  if (s.judged.length > MAX_JUDGED) s.judged.splice(0, s.judged.length - MAX_JUDGED);
  if (!j.alerted) return;
  const why = [j.offHours ? j.time : '', j.newPeer ? `new peer ${j.peer}` : '', j.big ? megabytes(j.bytes) : ''].filter(Boolean).join(', ');
  const line = alertLine('anomaly', { host: j.host, hour: j.hour, peer: j.peer, bytes: j.bytes, deviation: j.deviation }, why);
  raise(sim, dev, s, `anomaly|${j.host}|${j.peer}`, line, { block: j.host });
}

function raise(sim: Sim, dev: Device, s: IdsSensor, key: string, line: Omit<LogEntry, 'no' | 't' | 'device'>, response: Response): void {
  const last = s.fired[key];
  if (last !== undefined && sim.t - last < DEDUPE_MS) return;
  s.fired[key] = sim.t;
  const signature = String(line.fields?.signature ?? '');
  sim.log(dev.id, line);
  emitIds(sim, { device: dev.id, what: 'alert', signature, detail: line.msg });
  if (s.prevention) prevent(sim, dev, s, signature, response);
}

function emitIds(sim: Sim, body: IdsEventBody): void {
  sim.emit({ t: sim.t, type: 'ids', ...body });
}

/** The note on firewall rules the IPS adds, so it doesn't add them twice. */
export function ipsNote(ip: Ip): string {
  return `Added by the IPS: block ${ip}`;
}

function prevent(sim: Sim, dev: Device, s: IdsSensor, signature: string, r: Response): void {
  const sensorId = dev.id;
  if (r.port && sim.devices[r.port.device]?.switchSec) {
    const { device, port } = r.port;
    sim.schedule(IPS_DELAY_MS, () => {
      const sw = sim.devices[device];
      if (!sw || !portUp(sw, port)) return;
      sim.setPortShutdown(device, port, true);
      const msg = `IPS shut switch ${portLabel(port)} (${signature}${signature === 'mac-flood' ? ' from many MACs' : ''})`;
      sim.log(sensorId, { source: 'ips', level: 'alert', msg, fields: { action: 'shut', device, port, signature } });
      emitIds(sim, { device: sensorId, what: 'shut', signature, detail: msg, target: port });
    });
    return;
  }
  const fwId = s.firewall;
  if (!r.block || !fwId) return;
  const ip = r.block;
  const home = inNet(s.home, ip);
  sim.schedule(IPS_DELAY_MS, () => {
    const fw = sim.devices[fwId]?.firewall;
    if (!fw || fw.rules.some((x) => x.note === ipsNote(ip))) return;
    const note = ipsNote(ip);
    // Traffic from a home host leaves "out"; traffic from an outside address comes "in".
    sim.fwAddRule(fwId, { dir: 'in', proto: 'any', src: home ? 'any' : ip, dst: home ? ip : 'any', dport: 'any', action: 'deny', note }, 0);
    sim.fwAddRule(fwId, { dir: 'out', proto: 'any', src: home ? ip : 'any', dst: home ? 'any' : ip, dport: 'any', action: 'deny', note }, 0);
    const msg = `IPS blocked ${ip} (${signature})`;
    sim.log(sensorId, { source: 'ips', level: 'alert', msg, fields: { action: 'block', blocked: ip, signature, firewall: fwId } });
    emitIds(sim, { device: sensorId, what: 'block', signature, detail: msg, target: ip });
  });
}

// ---------------------------------------------------------------------------
// The SIEM
// ---------------------------------------------------------------------------

/** What kind of event a log line is, for correlation. Undefined: not one the SIEM correlates. */
export function kindOf(e: LogEntry): string | undefined {
  if (e.source === 'firewall' && e.fields?.action === 'deny') return 'deny';
  if (e.source === 'ids' && e.level === 'alert') return e.fields?.signature === 'port-scan' ? 'scan' : String(e.fields?.signature ?? 'alert');
  if (e.source === 'auth' && e.fields?.action === 'fail') return 'auth-fail';
  return undefined;
}

/**
 * Group the sources' lines into incidents: lines naming the same outside
 * `fields.src` within the window, once `minKinds` kinds of event appear.
 * Opens each new incident with a line on the SIEM, dated when its last kind
 * appeared. Running it again opens nothing twice. Returns the new incidents.
 */
export function correlate(sim: Sim, siemId: string): Incident[] {
  const q = sim.dev(siemId).ids?.siem;
  if (!q) return [];
  const lines = q.sources
    .flatMap((id) => sim.devices[id]?.logs ?? [])
    .filter((e) => kindOf(e) && typeof e.fields?.src === 'string' && !inNet(q.home, String(e.fields.src)))
    .sort((a, b) => a.t - b.t || a.no - b.no);
  const groups = new Map<string, { start: number; parts: IncidentPart[]; incident?: Incident }>();
  const opened: Incident[] = [];
  for (const e of lines) {
    const src = String(e.fields!.src);
    const kind = kindOf(e)!;
    let g = groups.get(src);
    if (!g || e.t - g.start > q.window) {
      g = { start: e.t, parts: [], incident: q.incidents.find((i) => i.src === src && i.start === e.t) };
      groups.set(src, g);
    }
    let part = g.parts.find((x) => x.kind === kind);
    if (!part) g.parts.push((part = { kind, device: e.device, firstNo: e.no, first: e.t, last: e.t, count: 0 }));
    part.count++;
    part.last = e.t;
    if (g.incident || g.parts.length < q.minKinds) continue;
    const id = q.nextIncident++;
    const entry = sim.log(
      siemId,
      {
        source: 'siem',
        level: 'alert',
        msg: `INCIDENT ${id} open: ${g.parts.length} event types from ${src}`,
        fields: { incident: id, src, kinds: g.parts.map((x) => x.kind).join(','), triage: 'open' },
      },
      e.t,
    );
    g.incident = { id, src, start: g.start, opened: e.t, logNo: entry.no, parts: g.parts };
    q.incidents.push(g.incident);
    opened.push(g.incident);
  }
  return opened;
}

/** How a threshold sorts the scored events. */
export function aiCounts(q: Siem, threshold = q.threshold): { attacks: number; caught: number; falseAlerts: number; alerts: number } {
  const events = q.ai?.events ?? [];
  const hit = aiAlerts(events, threshold);
  return {
    attacks: events.filter((e) => e.truth === 'attack').length,
    caught: hit.filter((e) => e.truth === 'attack').length,
    falseAlerts: hit.filter((e) => e.truth !== 'attack').length,
    alerts: hit.length,
  };
}

/** Events scored at or above the threshold. */
export function aiAlerts(events: AiEvent[], threshold: number): AiEvent[] {
  return events.filter((e) => e.score >= threshold - 1e-9);
}
