import type { Ip, Mac } from './addr';
import type { DnsResolver } from './dns';
import type { Burst } from './burst';
import type { SwitchSec } from './switchsec';
import type { WifiAp, WifiClient } from './wifi';

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * How a device behaves.
 *  - host:   a computer, phone or server. Has an IP stack (ARP, IP, apps).
 *  - router: forwards IP packets between networks; may speak BGP.
 *  - switch: learns which MAC lives on which port and forwards only there.
 *  - hub:    repeats every frame out every port (also models open Wi-Fi: radio reaches everyone).
 */
export type DeviceKind = 'host' | 'router' | 'switch' | 'hub';

export type DeviceIcon =
  | 'laptop'
  | 'phone'
  | 'desktop'
  | 'server'
  | 'printer'
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
  /** The MAC built into the card, kept while `mac` is changed (MAC spoofing, see Sim.setMac). */
  factoryMac?: Mac;
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
  /** Line shown after a successful sign-in (POST), after "Welcome back, NAME!". Defaults to a bank balance. */
  dashboard?: string;
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
  /** A recursive resolver's cache, pending lookups, and defenses (see src/sim/dns.ts). */
  resolver?: DnsResolver;
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
  /** Switch security: MAC table size, port security, shut ports (see switchsec.ts and Sim.configureSwitch). */
  switchSec?: SwitchSec;
  /** Wi-Fi access point settings, when this device is an access point (see src/sim/wifi.ts). */
  wifi?: WifiAp;
  /** Wi-Fi client settings, when this device joins wireless networks (see src/sim/wifi.ts). */
  wifiClient?: WifiClient;
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
  | { kind: 'dns-answer'; name: string; ip: Ip | null; qid: number };

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
  /** This one frame stands for many (a flood). See burst.ts. */
  burst?: Burst;
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
  /** The switch port is shut down (by an admin, or by port security). */
  | 'port-shutdown'
  /** Port security refused the frame's source MAC. */
  | 'port-security';

export type SimEvent = (
  | { t: number; type: 'captured'; device: string; no: number; frame: Frame }
  | { t: number; type: 'ignored'; device: string; frame: Frame }
  | { t: number; type: 'arp-update'; device: string; ip: Ip; mac: Mac; prev?: Mac; forged?: boolean }
  | { t: number; type: 'arp-rejected'; device: string; ip: Ip; mac: Mac }
  /** A switch learned `mac` on `iface`. From a burst, `count` new MACs at once (`mac` is the first). */
  | { t: number; type: 'mac-learn'; device: string; mac: Mac; iface: string; count?: number }
  /** A full MAC table pushed out its oldest entries to learn new ones on `iface`. */
  | { t: number; type: 'mac-overflow'; device: string; iface: string; learned: number; evicted: Mac[] }
  /** Port security caught a MAC it doesn't allow on `iface`: shut the port, or dropped `count` frames. */
  | { t: number; type: 'port-security'; device: string; iface: string; mac: Mac; action: 'shutdown' | 'restrict'; count: number }
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
  /**
   * A Wi-Fi event: a device joined or left an access point, a join was
   * rejected, or the attacker scanned, cracked, or jammed. See src/sim/wifi.ts.
   */
  | {
      t: number;
      type: 'wifi';
      device: string;
      what: 'join' | 'leave' | 'rejected' | 'scan' | 'crack' | 'jam' | 'ssid-seen';
      ssid?: string;
      bssid?: Mac;
      client?: string;
      ok?: boolean;
      detail?: string;
    }
  /** A device wrote a log line (see Sim.log). */
  | { t: number; type: 'log'; device: string; entry: LogEntry }) & {
  /** Happened while a lesson setup arranged the network (see Sim.quiet). */
  quiet?: boolean;
};

export type SimEventType = SimEvent['type'];
