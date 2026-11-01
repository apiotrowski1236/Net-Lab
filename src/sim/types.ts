import type { Ip, Mac } from './addr';

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
}

export interface BrowserState {
  url: string;
  host: string;
  secure: boolean;
  status: 'resolving' | 'loading' | 'loaded' | 'failed' | 'warning';
  path: string;
  postBody?: string;
  startedAt: number;
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

export type DropReason = 'no-route' | 'ttl' | 'blackhole' | 'arp-timeout' | 'not-forwarding' | 'no-service';

export type SimEvent =
  | { t: number; type: 'captured'; device: string; no: number; frame: Frame }
  | { t: number; type: 'ignored'; device: string; frame: Frame }
  | { t: number; type: 'arp-update'; device: string; ip: Ip; mac: Mac; prev?: Mac; forged?: boolean }
  | { t: number; type: 'arp-rejected'; device: string; ip: Ip; mac: Mac }
  | { t: number; type: 'mac-learn'; device: string; mac: Mac; iface: string }
  | { t: number; type: 'route-change'; device: string; prefix: string; route?: Route }
  | { t: number; type: 'route-rejected'; device: string; prefix: string; from: string; reason: string }
  | { t: number; type: 'drop'; device: string; reason: DropReason; pkt?: IpPacket; frame?: Frame }
  | { t: number; type: 'forwarded'; device: string; frame: Frame }
  | { t: number; type: 'http-request'; device: string; frame: Frame; fake: boolean }
  | { t: number; type: 'credentials-stolen'; device: string; user: string; pass: string }
  | { t: number; type: 'page'; device: string; browser: BrowserState }
  | { t: number; type: 'dns-answer'; device: string; name: string; ip: Ip | null }
  | { t: number; type: 'ping-reply'; device: string; from: Ip }
  | { t: number; type: 'config'; device: string; what: string; on?: boolean; detail?: string };

export type SimEventType = SimEvent['type'];
