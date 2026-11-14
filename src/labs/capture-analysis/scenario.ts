import type { Ip } from '../../sim/addr';
import { NetBuilder } from '../../sim/build';
import { CAPFILE_TIMING, loadCaptureFile, type CaptureFile, type CaptureFileDef, type FileFrame } from '../../sim/capfile';
import type { Sim, SimOptions } from '../../sim/sim';
import type { TcpScript } from '../../sim/tcp';
import type { Frame } from '../../sim/types';

/**
 * Valley Transit's bus depot (see PLAN.md). One switch joins the dispatch
 * computers, the fare server and kiosks, the camera recorder, the backup
 * server, and the break-room computer to the depot's router. The switch's
 * mirror port copies every frame to the analyst's laptop.
 *
 * The day's capture files are recorded on this same network (capfile.ts):
 * each `record` builds a fresh depot with fast timings, schedules that
 * window's traffic, and captures at the analyst's laptop.
 */

export const IP = {
  gw: '198.51.100.1',
  dispatch1: '198.51.100.11',
  dispatch2: '198.51.100.12',
  fares: '198.51.100.20',
  kiosk1: '198.51.100.31',
  kiosk2: '198.51.100.32',
  kiosk3: '198.51.100.33',
  cams: '198.51.100.40',
  backup: '198.51.100.50',
  breakroom: '198.51.100.60',
  broadcast: '198.51.100.255',
  wan: '100.64.0.2',
  isp: '100.64.0.1',
  /** The bus-tracking service dispatch uses all day. */
  maps: '203.0.113.10',
  /** The command-and-control server on the threat list. */
  c2: '192.0.2.44',
  /** The outside computer that port-scans the fare server. */
  scanner: '203.0.113.66',
  /** The smurf attack's victim: its address is forged on the requests. */
  victim: '203.0.113.77',
} as const;

export const MAC = {
  gw: '00:1b:54:3a:0e:01',
  gwWan: '00:1b:54:3a:0e:02',
  dispatch1: '3c:52:82:17:a4:11',
  dispatch2: '3c:52:82:17:a4:12',
  fares: '00:50:56:8e:20:20',
  kiosk1: 'b8:27:eb:5d:31:01',
  kiosk2: 'b8:27:eb:5d:31:02',
  kiosk3: 'b8:27:eb:5d:31:03',
  cams: '00:40:8c:e2:40:40',
  backup: '00:50:56:8e:50:50',
  breakroom: '3c:52:82:17:b6:60',
  analyst: '3c:52:82:17:c9:99',
} as const;

/** The threat list in the night shift's ticket. */
export const THREAT_LIST = ['192.0.2.44', '198.18.5.9', '203.0.113.250'] as const;

export const KIOSKS = ['kiosk1', 'kiosk2', 'kiosk3'] as const;
export const DISPATCH = ['dispatch1', 'dispatch2'] as const;
/** Every depot computer with an address. */
export const DEPOT = ['dispatch1', 'dispatch2', 'fares', ...KIOSKS, 'cams', 'backup', 'breakroom'] as const;

/** The switch port the break-room computer is plugged into. */
export const BREAKROOM_PORT = 'p7';
export const MIRROR_PORT = 'p12';
export const RSYNC_PORT = 873;
export const C2_PORT = 4444;
export const TELNET_PASSWORD = 'Bus$top42';

export function build(opts: Partial<SimOptions> = {}): Sim {
  const host = (ip: string, mac: string) => ({ ip: `${ip}/24`, gateway: IP.gw, mac });
  const sim = new NetBuilder({ linkMs: 600, procMs: 120, l2Ms: 50, ...opts })
    .router('internet', {
      label: 'Internet',
      icon: 'cloud',
      x: 80,
      y: 300,
      ifaces: [
        { id: 'wan', ip: `${IP.isp}/30` },
        // Far-off computers this cloud stands in for (not drawn).
        { id: 'maps', ip: `${IP.maps}/32` },
        { id: 'c2', ip: `${IP.c2}/32` },
        { id: 'scanner', ip: `${IP.scanner}/32` },
        { id: 'victim', ip: `${IP.victim}/32` },
      ],
      routes: [{ prefix: '198.51.100.0/24', via: IP.wan, iface: 'wan' }],
      services: [
        { port: 443, proto: 'tcp', app: 'https' },
        { port: C2_PORT, proto: 'tcp', app: 'http' },
      ],
    })
    .router('gw', {
      label: 'Depot router',
      x: 235,
      y: 300,
      ifaces: [
        { id: 'lan', ip: `${IP.gw}/24`, mac: MAC.gw },
        { id: 'wan', ip: `${IP.wan}/30`, mac: MAC.gwWan },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: IP.isp, iface: 'wan' }],
      firewall: {
        outside: 'wan',
        mode: 'stateless',
        rules: [
          { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow', note: 'Depot to the internet' },
          { dir: 'in', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow', note: 'Set up in a hurry: lets everything in' },
        ],
      },
    })
    .switch('switch', { label: 'Depot switch', x: 480, y: 300, ports: 12, mirror: MIRROR_PORT })
    .host('dispatch1', { label: 'Dispatch 1', icon: 'desktop', x: 640, y: 95, ...host(IP.dispatch1, MAC.dispatch1) })
    .host('dispatch2', { label: 'Dispatch 2', icon: 'desktop', x: 790, y: 95, ...host(IP.dispatch2, MAC.dispatch2) })
    .host('fares', {
      label: 'Fare server',
      icon: 'server',
      x: 900,
      y: 230,
      ...host(IP.fares, MAC.fares),
      services: [
        { port: 443, proto: 'tcp', app: 'https' },
        { port: RSYNC_PORT, proto: 'tcp', app: 'rsync' },
      ],
    })
    .host('kiosk1', { label: 'Kiosk 1', icon: 'console', x: 900, y: 380, ...host(IP.kiosk1, MAC.kiosk1) })
    .host('kiosk2', { label: 'Kiosk 2', icon: 'console', x: 810, y: 500, ...host(IP.kiosk2, MAC.kiosk2) })
    .host('kiosk3', { label: 'Kiosk 3', icon: 'console', x: 680, y: 535, ...host(IP.kiosk3, MAC.kiosk3) })
    .host('cams', { label: 'Camera recorder', icon: 'server', x: 330, y: 95, ...host(IP.cams, MAC.cams) })
    .host('backup', { label: 'Backup server', icon: 'server', x: 480, y: 80, ...host(IP.backup, MAC.backup) })
    .host('breakroom', { label: 'Break-room PC', icon: 'desktop', x: 300, y: 520, ...host(IP.breakroom, MAC.breakroom) })
    .host('analyst', { label: 'Analyst laptop', icon: 'laptop', x: 520, y: 520, mac: MAC.analyst })
    .link('internet', ['gw', 'wan'], { ms: 18 })
    .link(['gw', 'lan'], ['switch', 'p1'])
    .link('dispatch1', ['switch', 'p2'])
    .link('dispatch2', ['switch', 'p3'])
    .link('fares', ['switch', 'p4'])
    .link('kiosk1', ['switch', 'p5'])
    .link('kiosk2', ['switch', 'p6'])
    .link('breakroom', ['switch', BREAKROOM_PORT])
    .link('kiosk3', ['switch', 'p8'])
    .link('cams', ['switch', 'p9'])
    .link('backup', ['switch', 'p10'])
    .link('analyst', ['switch', MIRROR_PORT])
    .build();
  sim.configureSwitch('switch', { tableSize: 1024 });
  sim.prelearnSwitch('switch');
  sim.prewarmArp([...DEPOT, 'gw']);
  sim.events = [];
  return sim;
}

// ---------------------------------------------------------------------------
// Traffic: what the depot's computers do all day
// ---------------------------------------------------------------------------

/** A card payment from a kiosk to the fare server: encrypted, small. */
const FARE: TcpScript = {
  app: 'https',
  encrypted: true,
  lines: [
    { from: 'client', len: 517 },
    { from: 'server', len: 1210 },
    { from: 'client', len: 96 },
  ],
};

/** Dispatch checks where the buses are. */
const MAPS: TcpScript = {
  app: 'https',
  encrypted: true,
  lines: [
    { from: 'client', len: 420 },
    { from: 'server', len: 1400, count: 3 },
  ],
};

const BACKUP = (segments: number): TcpScript => ({
  app: 'rsync',
  gapMs: 16,
  lines: [
    { from: 'client', text: '@RSYNCD: 31.0\nfares-data/' },
    { from: 'server', len: 1448, count: segments },
  ],
});

const BEACON = (cmd: string): TcpScript => ({
  app: 'http',
  lines: [
    { from: 'client', text: `POST /checkin HTTP/1.1\nHost: ${IP.c2}:${C2_PORT}\nUser-Agent: Mozilla/4.0\n\nid=REC-01&status=idle` },
    { from: 'server', text: `HTTP/1.1 200 OK\nContent-Type: text/plain\n\n${cmd}` },
  ],
});

const UPLOAD: TcpScript = {
  app: 'http',
  gapMs: 12,
  lines: [
    { from: 'client', text: `POST /upload HTTP/1.1\nHost: ${IP.c2}:${C2_PORT}\nContent-Type: video/mp4\n\nfile=garage_cam3_0130.mp4` },
    { from: 'client', len: 1400, count: 60 },
    { from: 'server', text: 'HTTP/1.1 200 OK\n\nreceived' },
  ],
};

const TELNET: TcpScript = {
  app: 'telnet',
  gapMs: 400,
  lines: [
    { from: 'server', text: 'depot-gw login: ' },
    { from: 'client', text: 'fleetadmin' },
    { from: 'server', text: 'Password: ' },
    { from: 'client', text: TELNET_PASSWORD },
    { from: 'server', text: 'Welcome to depot-gw.\ndepot-gw> ' },
    { from: 'client', text: 'show interfaces' },
    { from: 'server', text: 'lan 198.51.100.1/24 up\nwan 100.64.0.2/30 up\ndepot-gw> ' },
    { from: 'client', text: 'exit' },
  ],
};

/** Starts at `from` ms, every `every` ms (give or take a little), until `to`. */
function every(sim: Sim, from: number, to: number, every: number, run: (k: number) => void): void {
  let t = from;
  let k = 0;
  while (t < to) {
    const n = k++;
    sim.schedule(t, () => run(n));
    t += every * (0.75 + sim.rand() * 0.5);
  }
}

/** Kiosk payments and dispatch's bus map: the depot's everyday traffic. */
function dayTraffic(sim: Sim, ms: number): void {
  KIOSKS.forEach((k, i) => every(sim, 300 + i * 1700 + sim.randInt(1400), ms - 1500, 6000, () => sim.tcpConnect(k, IP.fares, 443, FARE)));
  DISPATCH.forEach((d, i) => every(sim, 900 + i * 3100 + sim.randInt(2000), ms - 2000, 8000, () => sim.tcpConnect(d, IP.maps, 443, MAPS)));
}

const FAST: Partial<SimOptions> = { ...CAPFILE_TIMING, seed: 7 };

function recorder(seed: number, more: Partial<SimOptions> = {}): Sim {
  const sim = build({ ...FAST, seed, ...more });
  sim.setSniffing('analyst', true);
  return sim;
}

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// The day's capture files
// ---------------------------------------------------------------------------

export const FILES = {
  morning: {
    id: 'morning',
    name: '07:00 depot.pcap',
    note: 'A normal morning',
    record: () => {
      const sim = recorder(701);
      dayTraffic(sim, MINUTE);
      return { sim, device: 'analyst', ms: MINUTE };
    },
  },
  outage: {
    id: 'outage',
    name: '08:00 depot.pcap',
    note: 'Kiosks can’t take cards',
    record: () => {
      const sim = recorder(801);
      // The fare program crashed: the server is up, but nothing listens on 443.
      sim.dev('fares').services = sim.dev('fares').services!.filter((s) => s.port !== 443);
      KIOSKS.forEach((k, i) => every(sim, 500 + i * 900, MINUTE - 1000, 3000, () => sim.tcpConnect(k, IP.fares, 443, FARE)));
      DISPATCH.forEach((d, i) => every(sim, 1200 + i * 3100, MINUTE - 2000, 8000, () => sim.tcpConnect(d, IP.maps, 443, MAPS)));
      return { sim, device: 'analyst', ms: MINUTE };
    },
  },
  noon: {
    id: 'noon',
    name: '12:00 depot.pcap',
    note: 'Slow at lunch',
    record: () => {
      const sim = recorder(1201, { broadcastEcho: true });
      sim.dev('gw').directedBroadcast = true;
      dayTraffic(sim, MINUTE);
      // The smurf: echo requests to the depot's broadcast address, with the victim's address forged as the source.
      for (let i = 0; i < 80; i++) {
        sim.schedule(14_000 + i * 125, () =>
          sim.sendPacket('internet', { src: IP.victim, dst: IP.broadcast, proto: 'icmp', app: { kind: 'ping', seq: 30_000 + i, reply: false } }),
        );
      }
      // The nightly backup, started early by hand.
      sim.schedule(38_000, () => sim.tcpConnect('backup', IP.fares, RSYNC_PORT, BACKUP(560)));
      return { sim, device: 'analyst', ms: MINUTE };
    },
  },
  arp: {
    id: 'arp',
    name: '13:00 depot.pcap',
    note: 'After lunch',
    record: () => {
      const sim = recorder(1301);
      // Dispatch 2 starts the hour with no ARP entry for the router: its first look-up is the real answer.
      delete sim.dev('dispatch2').arp[IP.gw];
      dayTraffic(sim, MINUTE);
      sim.setForwarding('breakroom', true);
      every(sim, 16_000, MINUTE - 3000, 4000, () => {
        sim.arpSpoof('breakroom', 'dispatch1', IP.gw);
        sim.arpSpoof('breakroom', 'dispatch2', IP.gw);
      });
      return { sim, device: 'analyst', ms: MINUTE };
    },
  },
  flood: {
    id: 'flood',
    name: '14:00 depot.pcap',
    note: 'The switch acted like a hub',
    record: () => {
      const sim = recorder(1401);
      dayTraffic(sim, MINUTE);
      sim.schedule(20_000, () => sim.macFlood('breakroom', 30, 100, 330));
      return { sim, device: 'analyst', ms: MINUTE, burstGapMs: 3 };
    },
  },
  scan: {
    id: 'scan',
    name: '15:00 depot.pcap',
    note: 'Afternoon',
    record: () => {
      const sim = recorder(1501);
      dayTraffic(sim, MINUTE);
      const ports = Array.from({ length: 1024 }, (_, i) => i + 1);
      sim.schedule(25_000, () => sim.tcpSynScan('internet', IP.fares, ports, { gapMs: 6, src: IP.scanner, sport: 61_337 }));
      return { sim, device: 'analyst', ms: MINUTE };
    },
  },
  night: {
    id: 'night',
    name: '02:00 depot.pcap',
    note: 'Overnight: nobody at the depot',
    record: () => {
      const sim = recorder(201);
      // The real nightly backup.
      sim.schedule(5_000, () => sim.tcpConnect('backup', IP.fares, RSYNC_PORT, BACKUP(240)));
      for (let i = 0; i < 6; i++) sim.schedule(2_000 + i * 10_000, () => sim.tcpConnect('cams', IP.c2, C2_PORT, BEACON(i === 3 ? 'cmd=upload garage_cam3_0130.mp4' : 'cmd=sleep 10')));
      sim.schedule(33_500, () => sim.tcpConnect('cams', IP.c2, C2_PORT, UPLOAD));
      return { sim, device: 'analyst', ms: MINUTE };
    },
  },
  telnet: {
    id: 'telnet',
    name: '16:00 depot.pcap',
    note: 'Someone signs in to the router',
    record: () => {
      const sim = recorder(1601);
      sim.dev('gw').services = [{ port: 23, proto: 'tcp', app: 'telnet' }];
      dayTraffic(sim, 30_000);
      sim.schedule(6_000, () => sim.tcpConnect('dispatch2', IP.gw, 23, TELNET));
      return { sim, device: 'analyst', ms: 30_000 };
    },
  },
} satisfies Record<string, CaptureFileDef>;

export type FileId = keyof typeof FILES;
export const FILE_DEFS: CaptureFileDef[] = Object.values(FILES);
export const file = (id: FileId): CaptureFile => loadCaptureFile(FILES[id]);

// ---------------------------------------------------------------------------
// Reading frames: what the questions and goals look for
// ---------------------------------------------------------------------------

const tcp = (f: Frame) => (f.ip?.proto === 'tcp' ? f.ip.tcp : undefined);
export const isSyn = (f: Frame) => !!tcp(f)?.flags.syn && !tcp(f)?.flags.ack;
export const isSynAck = (f: Frame) => !!tcp(f)?.flags.syn && !!tcp(f)?.flags.ack;
export const isRst = (f: Frame) => !!tcp(f)?.flags.rst;
export const isEchoRequest = (f: Frame) => f.ip?.app.kind === 'ping' && !f.ip.app.reply;
export const isEchoReply = (f: Frame) => f.ip?.app.kind === 'ping' && f.ip.app.reply;
/** A forged ARP reply: the break-room PC's MAC claiming the router's address. */
export const isPoison = (f: Frame) => f.arp?.op === 'reply' && f.arp.senderIp === IP.gw && f.arp.senderMac === MAC.breakroom;
/** A frame from the MAC flood: a made-up source MAC (the locally administered bit is set). */
export const isFloodFrame = (f: Frame) => !f.ip && !f.arp && (parseInt(f.src.slice(0, 2), 16) & 2) === 2;
export const toC2 = (f: Frame) => f.ip?.dst === IP.c2 || f.ip?.src === IP.c2;

/** Where a file's first matching packet is (for the answer key and tests). */
export function firstNo(id: FileId, pred: (c: FileFrame) => boolean): number {
  const hit = file(id).frames.find(pred);
  if (!hit) throw new Error(`No matching packet in ${id}`);
  return hit.no;
}

// ---------------------------------------------------------------------------
// The live network's lesson buttons (the fix step)
// ---------------------------------------------------------------------------

/** The 14:00 flood again, from the Break-room PC. */
export function replayFlood(sim: Sim): void {
  sim.macFlood('breakroom', 3, 100, 330);
}

/** One of the camera recorder's 2 a.m. check-ins with 192.0.2.44. */
export function replayCheckin(sim: Sim): void {
  sim.tcpConnect('cams', IP.c2, C2_PORT, BEACON('cmd=sleep 10'));
}

export type { Ip };
