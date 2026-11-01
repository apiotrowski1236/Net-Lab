import type { Ip, Mac } from './addr';
import type { FirewallState, FwDir, FwVerdict } from './firewall';
import type { Conn, Scan, Service } from './services';

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * How a device behaves.
 *  - host:   a computer, phone or server. Has an IP stack (ARP, IP, apps).
 *  - router: forwards IP packets between networks; may speak BGP.
 *  - switch: learns which MAC lives on which port and forwards only there.
 *  - hub:    repeats every frame out every port (also models open Wi-Fi: radio reaches everyone).
 *  - firewall: a standalone two-port firewall. Passes frames between its ports like a cable, but checks each IP packet against its rules (see firewall.ts).
 */
export type DeviceKind = 'host' | 'router' | 'switch' | 'hub' | 'firewall';

export type DeviceIcon =
  | 'laptop'
  | 'phone'
  | 'desktop'
  | 'server'
  | 'router'
  | 'switch'
  | 'hub'
  | 'wifi'
  | 'cloud'
  | 'attacker'
  | 'firewall'
  | 'isp';

export interface Iface {
  id: string;
  mac: Mac;
  ip?: Ip;
  prefix?: number;
  linkId?: string;
}

export interface ArpEntry {
  mac: Mac;
  at: number;
  /** 'static' entries are locked and ignore ARP replies (a defense). */
  via: 'reply' | 'request' | 'static' | 'auto';
}

export interface Route {
  prefix: string;
  /** Next-hop router IP. Missing = directly connected (or a black hole for BGP self-originated routes). */
  via?: Ip;
  iface: string;
  source: 'connected' | 'static' | 'bgp';
  asPath?: number[];
  learnedFrom?: string;
}

export interface WebSite {
  /** The name the site claims to be, e.g. "bank.example". */
  name: string;
  title: string;
  https: boolean;
  /** An impostor. Looks the same, but cannot prove its identity over HTTPS. */
  fake?: boolean;
  /** Text of the page a plain visit (GET) shows. Defaults to a sign-in prompt. */
  page?: string;
}

export interface BrowserState {
  url: string;
  host: string;
  secure: boolean;
  status: 'resolving' | 'loading' | 'loaded' | 'failed' | 'warning';
  path: string;
  postBody?: string;
  startedAt: number;
  /** When the page loaded or failed. */
  doneAt?: number;
  reqId: number;
  title?: string;
  body?: string;
  /** IP address the page actually came from. */
  from?: Ip;
  fake?: boolean;
  error?: string;
}

export interface BgpNeighbor {
  iface: string;
  device: string;
  asn: number;
}

export interface BgpState {
  asn: number;
  /** Prefixes this network announces as its own. */
  origins: string[];
  neighbors: BgpNeighbor[];
  /** What each neighbor told us: neighbor device id -> prefix -> AS path. */
  adjIn: Record<string, Record<string, number[]>>;
  /** Chosen path per prefix. from = null means "we originate it". */
  best: Record<string, { path: number[]; from: string | null }>;
  /** What we last told each neighbor: neighbor -> prefix -> path joined by spaces. */
  sentTo: Record<string, Record<string, string>>;
  /** RPKI-style route origin validation: reject announcements whose origin AS isn't authorized. */
  validate: boolean;
}

export interface Captured {
  no: number;
  t: number;
  frame: Frame;
}

export interface StolenCredential {
  t: number;
  user: string;
  pass: string;
  victimIp: Ip;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  label: string;
  sublabel?: string;
  icon: DeviceIcon;
  x: number;
  y: number;
  attacker?: boolean;
  ifaces: Iface[];
  gateway?: Ip;
  dnsServer?: Ip;
  arp: Record<Ip, ArpEntry>;
  macTable: Record<Mac, string>;
  routes: Route[];
  bgp?: BgpState;
  web?: WebSite;
  /** Router answers traffic for prefixes it hijacked with this fake site. */
  impersonate?: WebSite;
  dnsZone?: Record<string, Ip>;
  dnsCache: Record<string, Ip>;
  dnsPending: Record<number, { name: string; reqId: number }>;
  sniffing: boolean;
  forwarding: boolean;
  capture: Captured[];
  stolen: StolenCredential[];
  browser?: BrowserState;
  pending: { pkt: IpPacket; nextHop: Ip; iface: string; since: number }[];
  /** Extra notes shown in the inspector. */
  notes?: string[];
  /** What this device wrote to its log (newest last). Shown in the Logs tab. See Sim.log. */
  logs: LogEntry[];
  /** Programs answering on ports (see services.ts). A web site and a DNS zone answer without being listed. */
  services?: Service[];
  /** Connections this device started with Sim.connectService (newest last). */
  conns?: Conn[];
  /** Port scans this device ran with Sim.scan (newest last). */
  scans?: Scan[];
  /** Firewall rules and state, on a router or a 'firewall' device (see firewall.ts). */
  firewall?: FirewallState;
}

// ---------------------------------------------------------------------------
// Logs: what firewalls, switches, servers, and sensors write down
// ---------------------------------------------------------------------------

/** How serious a log line is. 'alert' is for detection tools (IDS, SIEM) raising an alarm. */
export type LogLevel = 'info' | 'notice' | 'warn' | 'alert';

/**
 * One line in a device's log. Write `msg` the way the real device would
 * ("DENY in TCP 203.0.113.9:51522 -> 10.0.2.10:22 rule 3"), and put the same
 * facts in `fields` so filters and goal checks don't parse text.
 */
export interface LogEntry {
  /** Running number across the whole network, in the order lines were written. */
  no: number;
  /** Simulated time. Seeded history (logs from before the lab starts) may be negative. */
  t: number;
  device: string;
  /** The part of the device that wrote it: 'firewall', 'port-security', 'switch', 'dns', 'wifi', 'ids', 'auth', 'web', ... */
  source: string;
  level: LogLevel;
  msg: string;
  /** Common keys: src, dst, proto, sport, dport, mac, ip, ssid, rule, action, user, count. */
  fields?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Frames and packets (only the fields that teach something)
// ---------------------------------------------------------------------------

export type AppData =
  | { kind: 'ping'; seq: number; reply: boolean }
  | { kind: 'http-req'; method: 'GET' | 'POST'; host: string; path: string; body?: string; reqId: number }
  | {
      kind: 'http-res';
      status: number;
      title: string;
      body: string;
      reqId: number;
      /** The name the responding server really holds a certificate for. */
      certName: string | null;
    }
  | { kind: 'dns-query'; name: string; qid: number }
  | { kind: 'dns-answer'; name: string; ip: Ip | null; qid: number }
  /**
   * A connection to a service on a port (see services.ts). `app` is the program
   * really speaking. A reply says whether a service answered ('open') or nothing
   * listens there ('closed'). `conn` is 0 on a packet that belongs to no real connection.
   */
  | { kind: 'svc'; conn: number; app: string; reply: boolean; status?: 'open' | 'closed'; text?: string };

export interface IpPacket {
  src: Ip;
  dst: Ip;
  ttl: number;
  proto: 'icmp' | 'tcp' | 'udp';
  srcPort?: number;
  dstPort?: number;
  /** Carried inside TLS (HTTPS). Anyone in the middle sees only gibberish. */
  encrypted?: boolean;
  app: AppData;
}

export interface ArpPayload {
  op: 'request' | 'reply';
  senderIp: Ip;
  senderMac: Mac;
  targetIp: Ip;
  targetMac?: Mac;
}

export interface RouteUpdate {
  kind: 'announce' | 'withdraw';
  prefix: string;
  path: number[];
}

export interface Frame {
  id: number;
  src: Mac;
  dst: Mac;
  arp?: ArpPayload;
  ip?: IpPacket;
  bgp?: RouteUpdate;
  /** Device that built this frame (for the teacher's eyes only; real frames carry no such label). */
  origin: string;
  /** Set when an attacker forged this frame. Drawn in red so students can follow it. */
  forged?: boolean;
}

export interface Link {
  id: string;
  a: { device: string; iface: string };
  b: { device: string; iface: string };
  wireless?: boolean;
}

export interface InFlight {
  frame: Frame;
  linkId: string;
  from: string;
  to: string;
  toIface: string;
  depart: number;
  arrive: number;
}

// ---------------------------------------------------------------------------
// Events: everything interesting the simulator does. Lab goals listen to these.
// ---------------------------------------------------------------------------

export type DropReason =
  | 'no-route'
  | 'ttl'
  | 'blackhole'
  | 'arp-timeout'
  | 'not-forwarding'
  | 'no-service'
  /** The device has no IP address, so it can't send IP packets at all. */
  | 'no-ip'
  /** The port the packet needs has no cable. */
  | 'no-link'
  /** A computer has no route for the destination: it isn't local and there's no default gateway. */
  | 'no-gateway'
  /** A computer's default gateway isn't on any network it is part of. */
  | 'gateway-off-net'
  /** A firewall's rules denied the packet (the 'firewall' event just before says which rule). */
  | 'firewall';

export type SimEvent = (
  | { t: number; type: 'captured'; device: string; no: number; frame: Frame }
  | { t: number; type: 'ignored'; device: string; frame: Frame }
  | { t: number; type: 'arp-update'; device: string; ip: Ip; mac: Mac; prev?: Mac; forged?: boolean }
  | { t: number; type: 'arp-rejected'; device: string; ip: Ip; mac: Mac }
  | { t: number; type: 'mac-learn'; device: string; mac: Mac; iface: string }
  | { t: number; type: 'route-change'; device: string; prefix: string; route?: Route }
  | { t: number; type: 'route-rejected'; device: string; prefix: string; from: string; reason: string }
  | { t: number; type: 'drop'; device: string; reason: DropReason; pkt?: IpPacket; frame?: Frame; nextHop?: Ip }
  | { t: number; type: 'forwarded'; device: string; frame: Frame }
  | { t: number; type: 'http-request'; device: string; frame: Frame; fake: boolean }
  | { t: number; type: 'credentials-stolen'; device: string; user: string; pass: string }
  | { t: number; type: 'page'; device: string; browser: BrowserState }
  | { t: number; type: 'dns-answer'; device: string; name: string; ip: Ip | null }
  | { t: number; type: 'ping-reply'; device: string; from: Ip; seq?: number }
  | { t: number; type: 'ping-sent'; device: string; to: Ip; seq: number }
  /** A ping from `device` got no reply: dropped at `at` (with the reason), or timed out. */
  | { t: number; type: 'ping-fail'; device: string; to: Ip; seq: number; reason: DropReason | 'timeout'; at?: string; ip?: Ip }
  | { t: number; type: 'config'; device: string; what: string; on?: boolean; detail?: string }
  /** A device wrote a log line (see Sim.log). */
  | { t: number; type: 'log'; device: string; entry: LogEntry }
  /** A firewall checked a packet (see firewall.ts). */
  | { t: number; type: 'firewall'; device: string; dir: FwDir; verdict: FwVerdict; pkt: IpPacket }
  /** A connection started with Sim.connectService ended (it's also in the client's Device.conns). */
  | { t: number; type: 'conn-result'; device: string; conn: Conn }
  /** A port scan finished: every probe answered or timed out. */
  | { t: number; type: 'scan-done'; device: string; scan: Scan }
  /** A reply nobody asked for reached `device` (a forged reply, for example). The device ignores it. */
  | { t: number; type: 'stray-reply'; device: string; pkt: IpPacket }) & {
  /** Happened while a lesson setup arranged the network (see Sim.quiet). */
  quiet?: boolean;
};

export type SimEventType = SimEvent['type'];
