import { NetBuilder } from '../../sim/build';
import { logLine, type FwRuleInput } from '../../sim/firewall';
import { alertLine, type AiEvent, type Baseline } from '../../sim/ids';
import type { Sim } from '../../sim/sim';
import type { IpPacket, LogLevel } from '../../sim/types';
import type { MapZone } from '../types';

// Riverbend Water Utility: one office switch, an edge firewall to the
// internet, a NIDS sensor on the switch's mirror port, and a SIEM that
// collects every device's log. The lab starts at 08:00, after the night the
// student investigates.

export const NET = '10.10.20.0/24';
export const BROADCAST = '10.10.20.255';

export const IP = {
  internet: '203.0.113.1',
  fwWan: '203.0.113.2',
  gateway: '10.10.20.1',
  siem: '10.10.20.8',
  nids: '10.10.20.9',
  files: '10.10.20.10',
  backup: '10.10.20.11',
  pc1: '10.10.20.21',
  pc2: '10.10.20.22',
  control: '10.10.20.31',
  plant: '10.10.20.40',
  mal: '10.10.20.66',
};

export const MAC = {
  gateway: '02:00:0a:0a:14:01',
  mal: '0e:ba:d0:00:00:66',
};

/** The outside address that scanned the utility and tried passwords on the records server. */
export const SCANNER = '203.0.113.66';
/** Where Raj's PC sent 90 MB at 03:12. On no list anywhere. */
export const EXFIL = '45.77.12.9';
export const EXFIL_PORT = 8443;
export const UPLOAD_BYTES = 94371840;
/** A command-and-control server on the threat feed. */
export const C2 = '198.51.100.77';
/** SSH wearing the HTTPS port. */
export const SSH443 = '203.0.113.90';
/** The offsite backup vault: the monthly full backup goes here at 02:00. */
export const VAULT = '192.0.2.50';
export const VAULT_PORT = 873;
export const BACKUP_BYTES = 41943040;
export const DNS = '192.0.2.53';
export const UPDATES = '52.84.150.11';

/** Switch ports. p9 is the spare jack the intruder found; p11 and p12 are empty. */
export const PORT = { fw: 'p1', nids: 'p2', siem: 'p3', files: 'p4', backup: 'p5', pc1: 'p6', pc2: 'p7', control: 'p8', mal: 'p9', plant: 'p10' } as const;

/** Real switches hold thousands of entries. This one holds 64, so an unchecked flood fills it. */
export const TABLE_SIZE = 64;

export const LOG_DEVICES = ['fw', 'sw', 'files', 'backup', 'pc1', 'pc2', 'control', 'plant', 'nids', 'siem'];

/** The edge firewall's rulebook. Log lines name rules by position (rule 3 is the third). */
export const RULES: FwRuleInput[] = [
  { dir: 'in', proto: 'tcp', src: 'any', dst: IP.files, dport: 22, action: 'allow', note: 'Vendor remote support (SSH to the records server)' },
  { dir: 'out', proto: 'udp', src: NET, dst: 'any', dport: 53, action: 'allow', log: true, note: 'DNS lookups' },
  { dir: 'out', proto: 'tcp', src: NET, dst: 'any', dport: 443, action: 'allow', log: true, note: 'Web browsing (HTTPS)' },
  { dir: 'out', proto: 'any', src: NET, dst: 'any', dport: 'any', action: 'allow', log: true, note: 'Everything else out' },
  { dir: 'in', proto: 'icmp', src: 'any', dst: BROADCAST, dport: 'any', action: 'deny', note: 'No pings to the broadcast address' },
  { dir: 'in', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'deny', note: 'Everything else in' },
];

const MB = 1048576;

/** What the anomaly detector learns from a clean week of office hours. */
export const BASELINE: Baseline = {
  hours: [8, 18],
  peers: {
    [IP.pc1]: [IP.files, DNS, '140.82.113.21', '151.101.1.69', '172.217.4.110', '13.107.42.14'],
    [IP.pc2]: [IP.files, DNS, '140.82.113.21', '151.101.1.69', '172.217.4.110', '104.16.132.229'],
    [IP.control]: [IP.plant, IP.files],
    [IP.plant]: [IP.control],
    [IP.files]: [IP.backup, DNS, UPDATES],
    [IP.backup]: [IP.files, VAULT],
    [IP.siem]: [],
    [IP.nids]: [IP.siem],
  },
  typical: { [IP.backup]: 2 * MB, [IP.files]: 5 * MB },
  defaultTypical: MB,
};

/** What the AI model scores when the analyst presses "Score this morning's events". */
export const AI_EVENTS: AiEvent[] = [
  { id: 'arp', label: 'Forged ARP replies for the gateway, from the unknown laptop', when: '02:30', score: 0.95, truth: 'attack' },
  { id: 'upload', label: "Raj's PC uploads 90 MB to 45.77.12.9", when: '03:12', score: 0.9, truth: 'attack' },
  { id: 'scan', label: 'Port scan from 203.0.113.66', when: '01:02', score: 0.75, truth: 'attack' },
  { id: 'dana', label: 'Dana signs in early for maintenance', when: '07:40', score: 0.7, truth: 'false-alarm' },
  { id: 'backup', label: 'Monthly backup sends 40 MB offsite', when: '02:00', score: 0.65, truth: 'false-alarm' },
  { id: 'update', label: 'Records server checks for software updates', when: '03:30', score: 0.4, truth: 'normal' },
  { id: 'poll', label: 'Control room PC polls the plant controller', when: '04:00', score: 0.3, truth: 'normal' },
  { id: 'browse', label: 'Staff web browsing', when: '07:50', score: 0.2, truth: 'normal' },
  { id: 'read', label: 'Staff open a report on the records server', when: '07:45', score: 0.15, truth: 'normal' },
  { id: 'dns', label: 'DNS lookups', when: '07:55', score: 0.1, truth: 'normal' },
];

const MIN = 60_000;

/**
 * Sim time of a wall-clock time during the night before the lab: 12:00 to
 * 23:59 is yesterday, 00:00 to 07:59 is this morning. The lab starts at 08:00.
 */
export function at(h: number, m: number, s = 0): number {
  const mins = h * 60 + m;
  const back = h >= 12 ? 8 * 60 + (24 * 60 - mins) : 8 * 60 - mins;
  return -back * MIN + s * 1000;
}

export function buildUtility(): Sim {
  const host = (ip: string) => ({ ip: `${ip}/24`, gateway: IP.gateway, dns: DNS });
  const sim = new NetBuilder({ linkMs: 700 })
    .router('internet', {
      label: 'Internet',
      icon: 'cloud',
      x: 900,
      y: 300,
      ifaces: [
        { id: 'edge', ip: `${IP.internet}/24` },
        { id: 'site', ip: `${EXFIL}/32` },
        { id: 'vault', ip: `${VAULT}/32` },
      ],
      routes: [{ prefix: NET, via: IP.fwWan, iface: 'edge' }],
      notes: [`Stands in for every server outside the utility, including the upload site ${EXFIL} and the offsite backup vault ${VAULT}.`],
    })
    .router('fw', {
      label: 'Edge firewall',
      sublabel: IP.gateway,
      icon: 'firewall',
      x: 740,
      y: 300,
      ifaces: [
        { id: 'wan', ip: `${IP.fwWan}/24` },
        { id: 'lan', ip: `${IP.gateway}/24`, mac: MAC.gateway },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: IP.internet, iface: 'wan' }],
      firewall: { outside: 'wan', mode: 'stateful', rules: RULES },
      notes: ['The gateway for the office. It logs every connection out and every packet it blocks.'],
    })
    .switch('sw', { label: 'Office switch', sublabel: '12 ports', icon: 'switch', x: 500, y: 300, ports: 12 })
    .host('nids', {
      label: 'NIDS sensor',
      sublabel: 'mirror port',
      icon: 'server',
      x: 500,
      y: 110,
      ...host(IP.nids),
      notes: [
        "Plugged into the switch's mirror port, which copies every frame the switch handles to the sensor. It also has a tap on the firewall's internet line.",
        'The simulation hands the sensor each frame directly instead of drawing the copies.',
      ],
    })
    .host('siem', {
      label: 'SIEM server',
      sublabel: 'log collector',
      icon: 'server',
      x: 660,
      y: 90,
      ...host(IP.siem),
      notes: ['Collects a copy of every log on the network and connects related lines into incidents.'],
    })
    .host('files', {
      label: 'Records server',
      sublabel: IP.files,
      icon: 'server',
      x: 300,
      y: 90,
      ...host(IP.files),
      services: [
        { port: 445, proto: 'tcp', app: 'smb' },
        { port: 22, proto: 'tcp', app: 'ssh', banner: 'SSH-2.0-OpenSSH_9.6' },
        { port: 80, proto: 'tcp', app: 'http' },
      ],
      notes: ['Billing records and plant reports. A vendor reaches it over SSH for remote support.'],
    })
    .host('backup', {
      label: 'Backup server',
      sublabel: IP.backup,
      icon: 'server',
      x: 120,
      y: 160,
      ...host(IP.backup),
      services: [{ port: 873, proto: 'tcp', app: 'rsync' }],
      notes: [`Copies the records server every afternoon. On the first of the month at 02:00 it sends a full backup to the offsite vault ${VAULT}.`],
    })
    .host('pc1', { label: "Dana's PC", sublabel: 'operator', icon: 'desktop', x: 120, y: 330, ...host(IP.pc1) })
    .host('pc2', { label: "Raj's PC", sublabel: 'finance clerk', icon: 'desktop', x: 120, y: 500, ...host(IP.pc2) })
    .host('control', { label: 'Control room PC', icon: 'desktop', x: 330, y: 500, ...host(IP.control) })
    .host('plant', {
      label: 'Plant controller',
      sublabel: 'treatment plant',
      icon: 'desktop',
      x: 560,
      y: 500,
      ...host(IP.plant),
      services: [{ port: 502, proto: 'tcp', app: 'modbus' }],
      notes: ['Runs the pumps and the chlorine dosing. Only the control room PC should talk to it.'],
    })
    .host('mal', {
      label: 'Unknown laptop',
      sublabel: 'on port 9',
      icon: 'attacker',
      x: 340,
      y: 300,
      ...host(IP.mal),
      mac: MAC.mal,
      attacker: true,
      notes: ['Found plugged into a spare wall jack (switch port 9) this morning. Nobody on staff owns it.'],
    })
    .link(['internet', 'edge'], ['fw', 'wan'])
    .link(['fw', 'lan'], ['sw', PORT.fw])
    .link('nids', ['sw', PORT.nids])
    .link('siem', ['sw', PORT.siem])
    .link('files', ['sw', PORT.files])
    .link('backup', ['sw', PORT.backup])
    .link('pc1', ['sw', PORT.pc1])
    .link('pc2', ['sw', PORT.pc2])
    .link('control', ['sw', PORT.control])
    .link('mal', ['sw', PORT.mal])
    .link('plant', ['sw', PORT.plant])
    .build();
  sim.dev('internet').services = [
    { port: EXFIL_PORT, proto: 'tcp', app: 'https' },
    { port: VAULT_PORT, proto: 'tcp', app: 'rsync' },
  ];
  sim.configureSwitch('sw', { tableSize: TABLE_SIZE });
  sim.prelearnSwitch('sw');
  sim.prewarmArp(Object.keys(sim.devices).filter((id) => id !== 'sw'));
  sim.configureIds('nids', {
    taps: [{ device: 'sw' }, { device: 'fw', iface: 'wan' }],
    home: NET,
    arpWatch: { [IP.gateway]: MAC.gateway },
    feed: { [C2]: 'known-c2' },
    firewall: 'fw',
    clock: '08:00',
    rules: 248,
  });
  sim.configureSiem('siem', { sources: LOG_DEVICES.filter((d) => d !== 'siem'), home: NET, firstIncident: 1041, threshold: 0.5 });
  seedHistory(sim);
  sim.siemCorrelate('siem');
  // The history is in the logs. Nothing on the live network has happened yet.
  sim.events = [];
  return sim;
}

// ---------------------------------------------------------------------------
// Replays: recorded traffic from the night, fed through the live network
// ---------------------------------------------------------------------------

/** R1, 02:30: the unknown laptop tells the control room PC and the plant controller that the gateway is at its MAC. */
export function replayArp(sim: Sim): void {
  sim.arpSpoof('mal', 'control', IP.gateway);
  sim.arpSpoof('mal', 'plant', IP.gateway);
}

/** R2, 03:12: Raj's PC uploads 90 MB to an address nobody knows. */
export function replayUpload(sim: Sim): void {
  sim.connectService('pc2', EXFIL, EXFIL_PORT, { sport: 52110, flow: { bytes: UPLOAD_BYTES, recordedAt: at(3, 12, 20) } });
}

/** R3, 02:45: the unknown laptop floods the switch with made-up MACs, 5 bursts of 40. */
export function replayFlood(sim: Sim): void {
  sim.macFlood('mal', 5, 40, 300);
}

/** R4, 02:00: the monthly full backup goes to the offsite vault. Legitimate. */
export function replayBackup(sim: Sim): void {
  sim.connectService('backup', VAULT, VAULT_PORT, { flow: { bytes: BACKUP_BYTES, recordedAt: at(2, 0, 5) } });
}

// ---------------------------------------------------------------------------
// The night's logs
// ---------------------------------------------------------------------------

type Line = { source: string; level: LogLevel; msg: string; fields?: Record<string, string | number> };

const SITES = ['140.82.113.21', '151.101.1.69', '172.217.4.110', '104.16.132.229', '13.107.42.14', '23.215.0.136'];
const REPORTS = ['flow.csv', 'chlorine.csv', 'billing-summary.xlsx', 'pump-hours.csv', 'outages.docx', 'meter-reads.csv'];
/** The scanner's probes the firewall denied: 41 ports, plus 22, which rule 1 lets in. */
const SCANNED = [
  21, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 465, 587, 993, 995, 1025, 1433, 1521, 1723, 2049, 2082, 3306, 3389, 5060, 5432, 5900, 6379, 8000, 8008,
  8080, 8081, 8443, 8888, 9000, 9090, 9200, 10000, 11211, 27017, 49152,
];

function seedHistory(sim: Sim): void {
  const pick = <T>(xs: T[]): T => xs[sim.randInt(xs.length)];
  const sport = () => 49152 + sim.randInt(16000);
  const log = (dev: string, t: number, line: Line) => sim.log(dev, line, t);

  /** A firewall line exactly as the edge firewall writes it, for a packet that rule `rule` decided. */
  const fw = (
    t: number,
    p: { proto: 'tcp' | 'udp' | 'icmp'; src: string; dst: string; sport?: number; dport?: number; bytes?: number },
    rule: number,
    extra: { app?: string; threat?: string } = {},
  ) => {
    const r = RULES[rule - 1];
    const pkt: IpPacket = {
      src: p.src,
      dst: p.dst,
      ttl: 64,
      proto: p.proto,
      srcPort: p.proto === 'icmp' ? undefined : (p.sport ?? sport()),
      dstPort: p.dport,
      app: p.proto === 'icmp' ? { kind: 'ping', seq: 0, reply: false } : { kind: 'svc', conn: 0, app: p.proto, reply: false },
      flow: p.bytes ? { bytes: p.bytes } : undefined,
    };
    const line = logLine(pkt, r.dir, { action: r.action, by: 'rule', ruleNo: rule });
    const fields = { ...line.fields };
    let { msg, level } = line;
    if (extra.app) {
      msg += ` app=${extra.app}`;
      fields.app = extra.app;
      level = 'warn';
    }
    if (extra.threat) {
      msg += ` threat-feed=${extra.threat}`;
      fields.threat = extra.threat;
      level = 'notice';
    }
    log('fw', t, { source: 'firewall', level, msg, fields });
  };

  // --- Staff browsing: yesterday afternoon and this morning ---
  const browse = (from: number, to: number, who: string[], n: number) => {
    for (let i = 0; i < n; i++) {
      const t = from + sim.randInt(to - from);
      const src = pick(who);
      if (sim.rand() < 0.5) fw(t - 400, { proto: 'udp', src, dst: DNS, dport: 53 }, 2);
      fw(t, { proto: 'tcp', src, dst: pick(SITES), dport: 443 }, 3);
    }
  };
  browse(at(16, 0), at(17, 30), [IP.pc1, IP.pc2], 26);
  browse(at(7, 38), at(7, 59, 50), [IP.pc1], 12);

  // --- Servers: afternoon snapshot, update check ---
  fw(at(16, 31, 2), { proto: 'tcp', src: IP.backup, dst: VAULT, dport: VAULT_PORT, bytes: 1887436 }, 4);
  fw(at(3, 30, 4), { proto: 'udp', src: IP.files, dst: DNS, dport: 53 }, 2);
  fw(at(3, 30, 5), { proto: 'tcp', src: IP.files, dst: UPDATES, dport: 443 }, 3);

  // --- Background noise: the internet knocking on closed doors all night ---
  for (let i = 0; i < 34; i++) {
    const t = at(17, 0) + sim.randInt(at(7, 55) - at(17, 0));
    const src = `${pick([185, 45, 91, 193, 61, 222, 89, 5])}.${sim.randInt(256)}.${sim.randInt(256)}.${1 + sim.randInt(254)}`;
    const dst = pick([IP.files, IP.backup, IP.pc1, IP.plant]);
    fw(t, { proto: 'tcp', src, dst, dport: pick([23, 3389, 445, 5900, 1433, 8080, 502]) }, 6);
  }

  // --- I2, 01:02: the scan. 41 probes denied in a minute (port 22 was let in). ---
  SCANNED.forEach((dport, i) => fw(at(1, 2) + Math.round((i * 60_000) / SCANNED.length), { proto: 'tcp', src: SCANNER, dst: IP.files, sport: 44001 + i, dport }, 6));
  // --- I3, 01:03: the sensor catches it. ---
  log('nids', at(1, 3, 1), alertLine('port-scan', { src: SCANNER, ports: 42, window: 60 }));
  // --- I1, 01:05 to 01:18: password guessing over SSH. ---
  for (let i = 0; i < 14; i++) {
    log('files', at(1, 5 + i, 7 + sim.randInt(40)), {
      source: 'auth',
      level: 'warn',
      msg: `sign-in FAILED user=admin src=${SCANNER}`,
      fields: { action: 'fail', user: 'admin', src: SCANNER, proto: 'ssh' },
    });
  }

  // --- 02:00: the monthly backup (legitimate) ---
  fw(at(2, 0, 5), { proto: 'tcp', src: IP.backup, dst: VAULT, dport: VAULT_PORT, bytes: BACKUP_BYTES }, 4);
  log('backup', at(2, 0, 0), { source: 'backup', level: 'notice', msg: `monthly full backup started: records to vault ${VAULT}`, fields: { dst: VAULT, kind: 'full' } });
  log('backup', at(2, 4, 12), { source: 'backup', level: 'info', msg: 'monthly full backup finished: 40 MB sent', fields: { dst: VAULT, bytes: BACKUP_BYTES } });
  log('backup', at(16, 31, 0), { source: 'backup', level: 'info', msg: 'afternoon snapshot of the records server OK (1.8 MB changed)', fields: { src: IP.files } });

  // --- 02:24: someone plugs into the spare jack. 02:45: the switch's table overflows. ---
  log('sw', at(2, 24, 31), { source: 'link', level: 'notice', msg: '%LINK-3-UPDOWN: Interface port 9, changed state to up', fields: { port: PORT.mal, state: 'up' } });
  log('sw', at(2, 45, 2), {
    source: 'mac-table',
    level: 'warn',
    msg: `%SW_MATM-4-TABLE_FULL: MAC address table full (${TABLE_SIZE}/${TABLE_SIZE}). Removed 147 oldest entries to learn 200 new addresses on port 9`,
    fields: { port: PORT.mal, count: 200, evicted: 147, size: TABLE_SIZE },
  });
  log('sw', at(16, 12, 40), { source: 'system', level: 'notice', msg: '%SYS-5-CONFIG_I: Configured from console by admin', fields: { user: 'admin' } });
  log('sw', at(17, 32, 15), { source: 'link', level: 'notice', msg: '%LINK-3-UPDOWN: Interface port 6, changed state to down', fields: { port: PORT.pc1, state: 'down' } });
  log('sw', at(7, 36, 2), { source: 'link', level: 'notice', msg: '%LINK-3-UPDOWN: Interface port 6, changed state to up', fields: { port: PORT.pc1, state: 'up' } });
  log('sw', at(4, 10, 9), { source: 'link', level: 'notice', msg: '%LINK-3-UPDOWN: Interface port 10, changed state to down', fields: { port: PORT.plant, state: 'down' } });
  log('sw', at(4, 10, 21), { source: 'link', level: 'notice', msg: '%LINK-3-UPDOWN: Interface port 10, changed state to up', fields: { port: PORT.plant, state: 'up' } });

  // --- I6, I7: Raj's PC, 03:11 and 03:12 ---
  log('pc2', at(3, 11, 48), { source: 'host', level: 'notice', msg: 'process start svc-update.exe user=raj', fields: { user: 'raj', proc: 'svc-update.exe' } });
  fw(at(3, 12, 20), { proto: 'tcp', src: IP.pc2, dst: EXFIL, sport: 52110, dport: EXFIL_PORT, bytes: UPLOAD_BYTES }, 4);

  // --- I8, 03:40: broadcast pings ---
  for (let i = 0; i < 24; i++) fw(at(3, 40) + Math.round((i * 40_000) / 24), { proto: 'icmp', src: SCANNER, dst: BROADCAST }, 5);
  // --- I9, 04:20: a beacon to a known command-and-control server ---
  fw(at(4, 20, 13), { proto: 'tcp', src: IP.pc2, dst: C2, sport: 49777, dport: 443 }, 3, { threat: 'known-c2' });
  // --- I10, 05:00: SSH on the HTTPS port ---
  fw(at(5, 0, 2), { proto: 'tcp', src: IP.pc2, dst: SSH443, sport: 50980, dport: 443 }, 3, { app: 'ssh' });

  // --- The records server: sign-ins and file reads ---
  const users = [
    ['dana', IP.pc1],
    ['raj', IP.pc2],
  ];
  for (let i = 0; i < 8; i++) {
    const [user, src] = users[i % 2];
    log('files', at(16, 0) + sim.randInt(90 * MIN), { source: 'auth', level: 'info', msg: `sign-in OK user=${user} src=${src}`, fields: { action: 'ok', user, src } });
  }
  log('files', at(7, 40, 11), { source: 'auth', level: 'info', msg: `sign-in OK user=dana src=${IP.pc1}`, fields: { action: 'ok', user: 'dana', src: IP.pc1 } });
  const read = (t: number, user: string) => {
    const path = `\\\\records\\reports\\2026-10\\${pick(REPORTS)}`;
    log('files', t, { source: 'smb', level: 'info', msg: `read ${path} user=${user}`, fields: { user, path } });
  };
  for (let i = 0; i < 22; i++) read(at(16, 0) + sim.randInt(95 * MIN), pick(['dana', 'raj']));
  for (let i = 0; i < 5; i++) read(at(7, 41) + sim.randInt(18 * MIN), 'dana');
  log('files', at(3, 30, 3), { source: 'update', level: 'info', msg: 'update check: no updates available', fields: { dst: UPDATES } });

  // --- Staff PCs and the control room ---
  log('pc1', at(17, 31, 40), { source: 'host', level: 'info', msg: 'shutdown requested by dana', fields: { user: 'dana' } });
  log('pc1', at(7, 36, 30), { source: 'host', level: 'info', msg: 'boot OK', fields: {} });
  log('pc1', at(7, 37, 5), { source: 'host', level: 'info', msg: 'antivirus definitions up to date', fields: {} });
  log('pc1', at(7, 38, 0), { source: 'host', level: 'info', msg: 'user dana signed in', fields: { user: 'dana' } });
  log('pc2', at(16, 4, 51), { source: 'host', level: 'info', msg: 'user raj signed in', fields: { user: 'raj' } });
  log('pc2', at(17, 26, 3), { source: 'host', level: 'info', msg: 'screen locked (user raj)', fields: { user: 'raj' } });
  log('pc2', at(6, 0, 0), { source: 'host', level: 'info', msg: 'antivirus scan finished: no threats found', fields: {} });
  for (let h = 18; h !== 8; h = (h + 2) % 24) {
    log('control', at(h, 0, 30), { source: 'host', level: 'info', msg: 'HMI: plant status normal, 4 pumps running', fields: { pumps: 4 } });
  }

  // --- The plant controller answers the control room's polls ---
  for (let k = 0; k < 32; k++) {
    log('plant', at(16, 0) + k * 30 * MIN + sim.randInt(20_000), { source: 'modbus', level: 'info', msg: `poll OK from ${IP.control}`, fields: { src: IP.control, proto: 'modbus' } });
  }

  // --- The sensor and the SIEM ---
  log('nids', at(16, 0, 4), { source: 'ids', level: 'notice', msg: 'sensor started on the mirror port (switch port 2)', fields: { port: PORT.nids } });
  log('nids', at(0, 0, 5), { source: 'ids', level: 'notice', msg: 'signature set loaded (248 rules)', fields: { rules: 248 } });
  log('nids', at(2, 0, 0), {
    source: 'ids',
    level: 'warn',
    msg: 'signature update failed: detection paused until an analyst restarts it',
    fields: { setting: 'ids-signatures', state: 'off' },
  });
  for (let h = 17; h !== 8; h = (h + 1) % 24) {
    log('nids', at(h, 0, 0), { source: 'ids', level: 'info', msg: h >= 2 && h < 12 ? 'heartbeat OK (detection paused)' : 'heartbeat OK', fields: {} });
    log('siem', at(h, 0, 30), { source: 'siem', level: 'info', msg: 'ingest OK: firewall, switch, records, backup, sensor', fields: { sources: 5 } });
  }
  log('siem', at(16, 20, 0), { source: 'siem', level: 'notice', msg: 'INCIDENT 1040 closed: false alarm', fields: { incident: 1040, verdict: 'false', action: 'close', triage: 'closed' } });
}

/** The office on the map. */
export function zones(_sim: Sim): MapZone[] {
  return [{ id: 'office', shape: { kind: 'rect', x: 40, y: 28, w: 670, h: 535 }, label: 'Office LAN 10.10.20.0/24', tone: 'neutral' }];
}
