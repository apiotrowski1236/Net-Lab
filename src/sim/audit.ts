import { prefixContains, type Ip } from './addr';
import { factoryLogin, namedPort } from './hardening';
import { appName, listening, scanFindings, type Scan } from './services';
import type { Sim } from './sim';
import { portUp } from './switchsec';
import type { Device } from './types';
import { vpnWeaknesses } from './vpn';
import { crack, SECURITY_LABEL, signalAt, type WifiAp } from './wifi';

/**
 * A vulnerability scanner and a risk register (built for `net-audit`).
 *
 * THE SCAN
 *   `sim.auditScan(auditor)` runs two port scans (see services.ts): one of the
 *   auditor's whole network (`scope`), and, when `outside` is set, a ping-only
 *   probe of the edge router's public address from a device on the internet,
 *   to see what the outside world sees. When both finish, the scanner checks
 *   what answered, plus each device's settings, against the findings catalog
 *   below, writes a report (`AuditState.reports`), and the sim emits
 *   'scan-complete' with the ids still present. (A real scanner reads settings
 *   by signing in with credentials the owner gives it. Here it reads them
 *   directly.)
 *
 * THE CATALOG (FINDINGS, in report order). Each check is generic: it fires for
 * any device with the weak setting, and clears when the setting is fixed.
 *   telnet         a host answered on TCP 23                       high
 *   default-admin  a device still takes its factory login           high
 *   edge-icmp      the outside probe got a ping reply               moderate
 *   switch-open    a switch has desk ports without port security,
 *                  or empty ports still on                          moderate
 *   wifi-weak      an access point an attacker can break into       high when a server shares the network
 *   wifi-beacon    an access point broadcasts its name              low
 *   vpn-split      a VPN allows split tunneling or a bare password  moderate
 *
 * THE RISK REGISTER
 *   The auditor rates each finding's likelihood and impact
 *   (`AuditState.register`, action `rate-risk`). `riskRating` combines them
 *   with the matrix below. The scanner's severity is a starting point; the
 *   register is the auditor's own judgment.
 *
 * Sim methods: auditScan, rateRisk. Tool kinds: `scanner`, `risk-register`.
 */

export type RiskLevel = 'low' | 'moderate' | 'high';

export const RISK_LEVELS: RiskLevel[] = ['low', 'moderate', 'high'];

export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low', moderate: 'Moderate', high: 'High' };

/** Likelihood (rows) x impact (columns). */
const MATRIX: Record<RiskLevel, Record<RiskLevel, RiskLevel>> = {
  low: { low: 'low', moderate: 'low', high: 'moderate' },
  moderate: { low: 'low', moderate: 'moderate', high: 'high' },
  high: { low: 'moderate', moderate: 'high', high: 'high' },
};

/** A risk's rating from its likelihood and impact. */
export function riskRating(likelihood: RiskLevel, impact: RiskLevel): RiskLevel {
  return MATRIX[likelihood][impact];
}

export type FindingId = 'telnet' | 'default-admin' | 'edge-icmp' | 'switch-open' | 'wifi-weak' | 'wifi-beacon' | 'vpn-split';

export interface CatalogEntry {
  id: FindingId;
  /** Short name for the register and lists. */
  name: string;
  /** Usual severity. A check may raise or lower it (see wifi-weak). */
  severity: RiskLevel;
}

export const FINDINGS: CatalogEntry[] = [
  { id: 'telnet', name: 'Telnet login open', severity: 'high' },
  { id: 'default-admin', name: 'Factory admin password', severity: 'high' },
  { id: 'edge-icmp', name: 'Answers pings from the internet', severity: 'moderate' },
  { id: 'switch-open', name: 'Switch ports open to anyone', severity: 'moderate' },
  { id: 'wifi-weak', name: 'Weak Wi-Fi encryption', severity: 'high' },
  { id: 'wifi-beacon', name: 'Wi-Fi beacon broadcast', severity: 'low' },
  { id: 'vpn-split', name: 'VPN split tunneling', severity: 'moderate' },
];

export function findingName(id: string): string {
  return FINDINGS.find((f) => f.id === id)?.name ?? id;
}

export interface Finding {
  id: FindingId;
  /** The device with the weakness. */
  device: string;
  severity: RiskLevel;
  /** One sentence: what is wrong. */
  title: string;
  /** What the scanner saw. */
  evidence: string;
  /** The suggested fix. */
  fix: string;
}

export interface AuditReport {
  id: number;
  /** When the scan started and finished. */
  t: number;
  doneAt: number;
  scope: string;
  /** What answered on the scanned network: the map an adversary would build. */
  hosts: { ip: Ip; device?: string; open: number[] }[];
  findings: Finding[];
}

/** The auditor's rating of one finding. */
export interface RiskEntry {
  likelihood?: RiskLevel;
  impact?: RiskLevel;
}

export interface AuditConfig {
  /** The network to scan, like "192.168.50.0/24". */
  scope: string;
  /** An outside probe: `from` (a device on the internet) pings `target` (the edge router's public address). */
  outside?: { from: string; target: Ip };
  /** Where the beacon check listens from (a spot outside the building). */
  listenAt?: { x: number; y: number; label: string };
  /** Ports to knock on at each host (default: SCAN_PORTS). */
  ports?: number[];
}

export interface AuditState extends AuditConfig {
  /** A scan in progress: its report number, and the port scans it waits on. */
  running?: { id: number; t: number; scans: { device: string; id: number }[] };
  nextReport: number;
  /** Newest last. */
  reports: AuditReport[];
  /** Finding id -> the auditor's rating. */
  register: Record<string, RiskEntry>;
}

/** Reports each auditor keeps (oldest dropped first). */
export const MAX_REPORTS = 10;

export function newAudit(cfg: AuditConfig): AuditState {
  return { ...cfg, nextReport: 1, reports: [], register: {} };
}

/** The rating a register row computes to, once both parts are set. */
export function entryRating(e: RiskEntry | undefined): RiskLevel | undefined {
  return e?.likelihood && e.impact ? riskRating(e.likelihood, e.impact) : undefined;
}

/** Every finding any report has listed, in catalog order (the register's rows). */
export function seenFindings(a: AuditState): Finding[] {
  const latest = new Map<string, Finding>();
  for (const r of a.reports) for (const f of r.findings) latest.set(f.id, f);
  return FINDINGS.flatMap((c) => latest.get(c.id) ?? []);
}

/** The newest finished report. */
export function latestReport(a: AuditState | undefined): AuditReport | undefined {
  return a?.reports[a.reports.length - 1];
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function wifiText(ap: WifiAp): string {
  return ap.security === 'open' ? 'no encryption' : SECURITY_LABEL[ap.security];
}

/** The hosts that answered a scan, with their open ports. */
export function scanHosts(sim: Sim, s: Scan): AuditReport['hosts'] {
  return scanFindings(s).map((h) => ({ ip: h.ip, device: sim.deviceByIp(h.ip)?.id, open: h.open }));
}

/** Run the catalog against the scans and the devices' settings. */
export function auditFindings(sim: Sim, a: AuditConfig, inside?: Scan, outside?: Scan): Finding[] {
  const out: Finding[] = [];
  const devs = Object.values(sim.devices);
  const hosts = inside ? scanHosts(sim, inside) : [];
  const openOn = (dev: Device) => hosts.find((h) => h.device === dev.id)?.open ?? [];

  // Telnet: the scan found TCP 23 answering.
  const telnet = hosts.find((h) => h.open.includes(23));
  if (telnet) {
    const d = telnet.device ? sim.devices[telnet.device] : undefined;
    out.push({
      id: 'telnet',
      device: d?.id ?? telnet.ip,
      severity: 'high',
      title: `${d?.label ?? telnet.ip} has Telnet (port 23) open. Logins cross the network as plain text.`,
      evidence: `Port 23 on ${telnet.ip} answered with a Telnet login prompt.`,
      fix: 'Turn Telnet off. Manage the device over SSH, which encrypts the session.',
    });
  }

  // Factory login: the scanner reached a login service and the factory password worked.
  const admin = devs.find((d) => factoryLogin(d) && (openOn(d).includes(23) || openOn(d).includes(22)));
  if (admin) {
    const acct = factoryLogin(admin)!;
    out.push({
      id: 'default-admin',
      device: admin.id,
      severity: 'high',
      title: `${admin.label} has a local "${acct.user}" account that still uses the factory password.`,
      evidence: `The scanner signed in as ${acct.user} with the password from the manual.`,
      fix: 'Remove local accounts. Send every login through the authentication server.',
    });
  }

  // Edge ICMP: the outside probe got a ping reply.
  const edge = outside?.hosts.find((h) => h.ping === 'open');
  if (edge) {
    const d = sim.deviceByIp(edge.ip);
    out.push({
      id: 'edge-icmp',
      device: d?.id ?? edge.ip,
      severity: 'moderate',
      title: `The edge firewall on ${d?.label ?? edge.ip} answers pings from the internet.`,
      evidence: `A ping from the internet to ${edge.ip} got a reply. Anyone online can learn the office is there.`,
      fix: 'Add a firewall rule that drops pings arriving from the internet.',
    });
  }

  // Switch ports: desk ports with no port security, and empty ports left on.
  for (const sw of devs) {
    if (sw.kind !== 'switch' || !sw.switchSec || !sw.hardening) continue;
    const desk: string[] = [];
    const empty: string[] = [];
    for (const i of sw.ifaces) {
      const peer = sim.peer(sw.id, i.id);
      if (!peer) {
        if (portUp(sw, i.id)) empty.push(i.id);
      } else if (sim.devices[peer.device]?.kind === 'host' && !sw.switchSec.ports[i.id]?.security) desk.push(i.id);
    }
    if (!desk.length && !empty.length) continue;
    const parts: string[] = [];
    if (desk.length) parts.push(`no port security on ${desk.length === 1 ? 'one desk port' : `${desk.length} desk ports`}`);
    if (empty.length) parts.push(`${list(empty.map((p) => namedPort(sw, p)))} ${empty.length === 1 ? 'is' : 'are'} live with nothing plugged in`);
    out.push({
      id: 'switch-open',
      device: sw.id,
      severity: 'moderate',
      title: `${sw.label} has ${parts.join(', and ')}.`,
      evidence: 'The switch accepts any MAC address on any port. A laptop plugged into an open port joins the office network.',
      fix: 'Turn on port security for each desk port. Shut ports nobody uses.',
    });
    break;
  }

  // Wi-Fi: an access point an attacker can break into, and its beacon.
  const aps = devs.filter((d) => d.wifi && !d.wifi.off && !d.wifi.rogue);
  const servers = devs.filter((d) => d.kind === 'host' && d.ifaces.some((i) => i.ip && prefixContains(a.scope, i.ip)) && listening(d).length > 0);
  const weak = aps.find((d) => crack(d.wifi!).ok);
  if (weak) {
    const ap = weak.wifi!;
    const c = crack(ap);
    const srv = servers[0];
    const ports = srv ? openOn(srv) : [];
    out.push({
      id: 'wifi-weak',
      device: weak.id,
      severity: srv ? 'high' : 'moderate',
      title: srv
        ? `${weak.label} uses ${wifiText(ap)} on the office network, which also holds ${srv.label}.`
        : `${weak.label} uses ${wifiText(ap)}, which an attacker can break.`,
      evidence: `The beacon advertises ${wifiText(ap)}. Breaking in takes ${c.estimate}.${
        srv && ports.length ? ` From the Wi-Fi, ${srv.label} answers on ${list(ports.map((p) => `${p} (${appName(portAppName(srv, p))})`))}.` : ''
      }`,
      fix: 'Use strong encryption: WPA3, or WPA2 with a long passphrase. Later, move the server onto its own network segment.',
    });
  }
  const loud = aps.find((d) => d.wifi!.beacon);
  if (loud) {
    const ap = loud.wifi!;
    const heard = a.listenAt ? signalAt(ap, loud, a.listenAt) : undefined;
    out.push({
      id: 'wifi-beacon',
      device: loud.id,
      severity: 'low',
      title: `${loud.label} broadcasts a beacon with its network name and encryption type.`,
      evidence:
        a.listenAt && heard
          ? `Heard from ${a.listenAt.label} at signal ${heard} of 100: "${ap.ssid}", ${wifiText(ap)}.`
          : `Any device nearby hears "${ap.ssid}", ${wifiText(ap)}.`,
      fix: 'Optional: hide the network name. A patient scanner still finds it, so this low risk is often accepted.',
    });
  }

  // VPN: split tunneling, or a password alone.
  const vpn = devs.find((d) => d.vpn?.server && vpnWeaknesses(d.vpn.server).length);
  if (vpn) {
    const s = vpn.vpn!.server!;
    out.push({
      id: 'vpn-split',
      device: vpn.id,
      severity: 'moderate',
      title: `The VPN on ${vpn.label} ${list(vpnWeaknesses(s))}.`,
      evidence: s.splitTunneling
        ? 'A remote computer sits on its home network and the office network at the same time.'
        : 'Anyone who learns a user’s password can connect.',
      fix: 'Turn split tunneling off. Require keys or MFA to sign in.',
    });
  }
  return out;
}

function portAppName(dev: Device, port: number): string {
  return listening(dev).find((s) => s.port === port)?.app ?? String(port);
}
