import { ipToInt, isIp, isPrefix, normalizePrefix, prefixContains, prefixLen, type Ip } from './addr';
import type { Device, IpPacket } from './types';

/**
 * Services, ports, client connections, and port scans.
 *
 * A **service** is a program on a host that answers on one port: SSH on 22,
 * HTTPS on 443, file sharing on 445. Hosts list theirs in `Device.services`.
 * A web site (`Device.web`) also answers on 80 and 443, and a DNS server
 * (`Device.dnsZone`) on UDP 53, without listing them (see `listening`).
 *
 * A **connection** is one request and one reply, with source and destination
 * ports, like a real client talking to a server (the simulation skips the TCP
 * handshake, as it does for HTTP). Start one with `sim.connectService`. The
 * client's `Device.conns` records how it ended, and a 'conn-result' event fires:
 *
 *   - open:      a service answered (its banner is in `banner`).
 *   - closed:    the host answered, but nothing listens on that port.
 *   - no-answer: the request or the reply was lost on the way (`at` and
 *                `reason` say where and why, for the teacher's eye), or nothing
 *                came back before the timeout (`SimOptions.pingTimeoutMs`).
 *
 * A **port scan** (`sim.scan`) pings every address in a network and then
 * knocks on a list of ports at each one, recording the answers in
 * `Device.scans`. It fires 'scan-done' when every probe has an answer or has
 * timed out. To keep the map readable, probes go only to addresses that some
 * device uses: the others would never answer anyway.
 *
 * Packets for all of this carry `AppData` of kind 'svc'. `identifyApp` says
 * which application a packet really carries, and `appForPort` which one its
 * port promises. A next-generation firewall (see firewall.ts) or an IDS
 * compares the two to catch a program hiding behind a well-known port.
 */

export type L4 = 'tcp' | 'udp';

export interface Service {
  port: number;
  proto: L4;
  /** The application that answers, as in WELL_KNOWN: 'https', 'ssh', 'smb', ... Any other name works too. */
  app: string;
  /** What a client sees when it connects, like "SSH-2.0-OpenSSH_9.6". nmap -sV prints it as the version. */
  banner?: string;
  /** The program behind it, as netstat -b names it ("sshd", "svchost.exe"). */
  program?: string;
}

export interface WellKnownPort {
  port: number;
  proto: L4;
  /** Application id used in packets and services. */
  app: string;
  /** Short name for tables and pills. */
  name: string;
  /** One line for students. */
  what: string;
}

/** Well-known ports, in one place. Add to this list rather than hard-coding a port somewhere else. */
export const WELL_KNOWN: WellKnownPort[] = [
  { port: 20, proto: 'tcp', app: 'ftp-data', name: 'FTP data', what: 'File transfer (the data itself)' },
  { port: 21, proto: 'tcp', app: 'ftp', name: 'FTP', what: 'File transfer, unencrypted' },
  { port: 22, proto: 'tcp', app: 'ssh', name: 'SSH', what: 'Secure remote login for administrators' },
  { port: 23, proto: 'tcp', app: 'telnet', name: 'Telnet', what: 'Remote login, unencrypted' },
  { port: 25, proto: 'tcp', app: 'smtp', name: 'SMTP', what: 'Sending email between mail servers' },
  { port: 53, proto: 'udp', app: 'dns', name: 'DNS', what: 'Looking up names to get IP addresses' },
  { port: 53, proto: 'tcp', app: 'dns', name: 'DNS', what: 'Looking up names to get IP addresses' },
  { port: 80, proto: 'tcp', app: 'http', name: 'HTTP', what: 'Web pages, unencrypted' },
  { port: 110, proto: 'tcp', app: 'pop3', name: 'POP3', what: 'Downloading email' },
  { port: 143, proto: 'tcp', app: 'imap', name: 'IMAP', what: 'Reading email on a server' },
  { port: 443, proto: 'tcp', app: 'https', name: 'HTTPS', what: 'Web pages, encrypted' },
  { port: 445, proto: 'tcp', app: 'smb', name: 'SMB', what: 'Windows file sharing' },
  { port: 631, proto: 'tcp', app: 'ipp', name: 'IPP', what: 'Printing over the network' },
  { port: 3389, proto: 'tcp', app: 'rdp', name: 'RDP', what: 'Remote desktop' },
];

/** Names for applications that have no well-known port of their own. */
const OTHER_APPS: Record<string, string> = {
  'remote-control': 'Remote-control tool',
  // segmentation: the submarine's own software
  'target-data': 'Target data',
  'status-reports': 'Status reports',
};

/** Ports a scan knocks on when it isn't given a list. */
export const SCAN_PORTS = [21, 22, 23, 25, 53, 80, 443, 445, 3389];

export function portInfo(port: number, proto: L4 = 'tcp'): WellKnownPort | undefined {
  return WELL_KNOWN.find((w) => w.port === port && w.proto === proto) ?? WELL_KNOWN.find((w) => w.port === port);
}

/** "443 (HTTPS)", or "8443" for a port with no well-known name. */
export function portLabel(port: number, proto: L4 = 'tcp'): string {
  const w = portInfo(port, proto);
  return w ? `${port} (${w.name})` : String(port);
}

/** The application a port promises, if it's a well-known one. */
export function appForPort(proto: L4, port: number | undefined): string | undefined {
  if (port === undefined) return undefined;
  return WELL_KNOWN.find((w) => w.port === port && w.proto === proto)?.app;
}

/** Display name for an application id: 'smb' -> "SMB". */
export function appName(app: string): string {
  return WELL_KNOWN.find((w) => w.app === app)?.name ?? OTHER_APPS[app] ?? app.toUpperCase();
}

/** The port number for a typed service name ("https", "SSH"), if it is well known. */
export function portForName(name: string): number | undefined {
  const n = name.trim().toLowerCase();
  return WELL_KNOWN.find((w) => w.app === n || w.name.toLowerCase() === n)?.port;
}

/**
 * Every service a host answers: its own list, plus a web site's HTTP and
 * HTTPS and a DNS server's port 53 when the list doesn't already name them.
 */
export function listening(dev: Device): Service[] {
  const out = [...(dev.services ?? [])];
  const has = (proto: L4, port: number) => out.some((s) => s.proto === proto && s.port === port);
  if (dev.web && !has('tcp', 443) && dev.web.https) out.push({ port: 443, proto: 'tcp', app: 'https' });
  if (dev.web && !has('tcp', 80)) out.push({ port: 80, proto: 'tcp', app: 'http' });
  if (dev.dnsZone && !has('udp', 53)) out.push({ port: 53, proto: 'udp', app: 'dns' });
  return out.sort((a, b) => a.port - b.port);
}

export function serviceAt(dev: Device, proto: L4, port: number | undefined): Service | undefined {
  return port === undefined ? undefined : listening(dev).find((s) => s.proto === proto && s.port === port);
}

/**
 * Which application a packet really carries, as deep packet inspection would
 * find it. (In the simulation the packet names its program. A real
 * next-generation firewall recognizes programs by patterns in their traffic.)
 */
export function identifyApp(pkt: IpPacket): string | undefined {
  const a = pkt.app;
  switch (a.kind) {
    case 'ping':
    case 'icmp-error':
      return 'ping';
    case 'http-req':
    case 'http-res':
      return pkt.encrypted ? 'https' : 'http';
    case 'dns-query':
    case 'dns-answer':
      return 'dns';
    case 'svc':
      return a.app;
    default:
      return undefined;
  }
}

/** True for packets that answer something: ping replies, web pages, DNS answers, service replies. */
export function isReply(pkt: IpPacket): boolean {
  const a = pkt.app;
  switch (a.kind) {
    case 'ping':
    case 'svc':
      return a.reply;
    case 'http-res':
    case 'dns-answer':
    case 'icmp-error':
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Client connections and scans (state kept on the client's Device)
// ---------------------------------------------------------------------------

export type ConnStatus = 'pending' | 'open' | 'closed' | 'no-answer';

/** One connection a device started (newest last in `Device.conns`). */
export interface Conn {
  id: number;
  /** When it started. */
  t: number;
  doneAt?: number;
  to: Ip;
  port: number;
  proto: L4;
  /** The client's own port (an ephemeral port unless the caller chose one). */
  sport: number;
  /** The application the client speaks. */
  app: string;
  /** What the client sends after connecting, if anything ("open PatientRecords"). */
  data?: string;
  status: ConnStatus;
  /** What the service said when it answered. */
  banner?: string;
  /** Where the request or reply was lost (device id), and why. The teacher's view: a real client only sees silence. */
  at?: string;
  reason?: string;
  /** Free-form label a lab can set to find its connection again ("patient-books"). */
  tag?: string;
}

export type ProbeResult = 'pending' | 'open' | 'closed' | 'no-answer';

export interface ScanHost {
  ip: Ip;
  ping: ProbeResult;
  /** Port -> what came back. */
  ports: Record<number, ProbeResult>;
  /** Port -> what the service said when it answered (its version, for nmap -sV). */
  banners?: Record<number, string>;
}

/** One scan a device ran (newest last in `Device.scans`). */
export interface Scan {
  id: number;
  t: number;
  doneAt?: number;
  /** What the scanner was told to scan: an address or a network ("10.0.1.0/24"). */
  target: string;
  ports: number[];
  /** How many addresses the target covers, network and broadcast addresses left out. */
  size: number;
  /** Every address probed, in order. Show only the ones that answered: the rest look the same as empty addresses. */
  hosts: ScanHost[];
}

/** Connections and scans each device keeps (oldest dropped first). */
export const MAX_CONNS = 40;
export const MAX_SCANS = 10;

/** A scan target: one address, or a network written as a prefix. */
export function scanTarget(raw: string): { prefix: string; single: boolean } | undefined {
  const s = raw.trim();
  if (isIp(s)) return { prefix: `${s}/32`, single: true };
  if (isPrefix(s)) return { prefix: normalizePrefix(s), single: false };
  return undefined;
}

/** Addresses in `prefix` that can be hosts (no network or broadcast address on networks bigger than /31). */
export function hostCount(prefix: string): number {
  const len = prefixLen(prefix);
  const all = 2 ** (32 - len);
  return len >= 31 ? all : all - 2;
}

/** Addresses in `prefix` that some device in `devices` uses, lowest first. */
export function usedAddresses(devices: Device[], prefix: string, except?: string): Ip[] {
  const out = new Set<Ip>();
  for (const d of devices) {
    if (d.id === except) continue;
    for (const i of d.ifaces) if (i.ip && prefixContains(prefix, i.ip)) out.add(i.ip);
  }
  return [...out].sort((a, b) => ipToInt(a) - ipToInt(b));
}

/** The answered parts of a scan, for display: hosts that replied to anything, with their open ports. */
export function scanFindings(s: Scan): { ip: Ip; ping: boolean; open: number[]; closed: number[] }[] {
  return s.hosts
    .map((h) => ({
      ip: h.ip,
      ping: h.ping === 'open',
      open: s.ports.filter((p) => h.ports[p] === 'open'),
      closed: s.ports.filter((p) => h.ports[p] === 'closed'),
    }))
    .filter((h) => h.ping || h.open.length || h.closed.length);
}

/** True when every probe in the scan has an answer or has timed out. */
export function scanDone(s: Scan): boolean {
  return s.hosts.every((h) => h.ping !== 'pending' && s.ports.every((p) => h.ports[p] !== 'pending'));
}

