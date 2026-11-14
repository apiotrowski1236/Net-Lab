import { NetBuilder } from '../../sim/build';
import type { BenchClient, BenchConfig, BenchDay, BenchRecord, BenchSignature } from '../../sim/bench';
import type { Sim } from '../../sim/sim';
import type { MapZone } from '../types';

// Pick Your Detector: a managed security company (the student's employer)
// chooses detection methods for three clients. Each client's network is a
// small island on the map; the company's detection bench replays a recorded
// day of each one's traffic. Nothing travels between the islands: the bench
// works on recordings, so runs are pure and fast (src/sim/bench.ts).

export const BENCH = 'bench';
export const ANALYST = 'analyst';

export const STREAM = 'streamco';
export const PLANT = 'riverbend';
export const DISPATCH = 'county911';

/** Monthly budget for all three clients. Signature + anomaly + hybrid fits; anything else that meets each client's need does not. */
export const BUDGET = 5400;

// Attack ids.
export const STUFFBOT = 'stuffbot';
export const VIDJACK = 'vidjack';
export const LEAK = 'leak';
export const BEACON = 'beacon';
export const LOCKDOWN = 'lockdown';
export const RADIO = 'radio';

// Recorded days.
export const TODAY = 'nov12';
export const STREAM_BASE = 'nov5';
export const PLANT_CLEAN = 'sep14';
export const PLANT_INFECTED = 'nov9';
export const DISPATCH_BASE = 'nov4';
/** County 911's day replayed with the ransomware's file renamed (step "Get past the signatures"). */
export const RENAMED = 'nov12-renamed';

// Signature database versions.
export const SEP = 'sep';
export const OCT = 'oct';

/** The ransomware's file name, and the name the attacker gives it to dodge the signature. */
export const LOCKDOWN_FILE = 'lockdown.exe';
export const RENAMED_FILE = 'dispatch_patch.exe';

export const NAMES: Record<string, string> = {
  bench: 'Detection bench',
  analyst: 'Analyst desk',
  'sc-net': 'StreamCo network',
  'sc-video': 'Video servers',
  'sc-accounts': 'Sign-in servers',
  'sc-library': 'Content library',
  'rb-net': 'Riverbend network',
  'rb-filler': 'Filler controller',
  'rb-capper': 'Capper controller',
  'rb-hmi': 'Control screen',
  'cd-net': 'County 911 network',
  'cd-console': 'Dispatcher console',
  'cd-cad': 'Dispatch server',
  'cd-radio': 'Radio gateway',
};

// ---------------------------------------------------------------------------
// Recorded days. Generated from a fixed seed, so every build is the same.
// ---------------------------------------------------------------------------

/** A small seeded random number generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Stream {
  host: string;
  peer: string;
  where: 'inside' | 'internet';
  port: number;
  /** Typical MB per hour. */
  typical: number;
}

/**
 * Deviations from typical for a day, as fractions: `bands` of [low, high, how
 * many], each given a random sign (a band reaching past 100% only goes up),
 * then shuffled. Their sizes, not the dice, decide how many hours fall
 * outside each tolerance, so the lesson's numbers stay put.
 */
function deviations(bands: [number, number, number][], r: () => number): number[] {
  const out: number[] = [];
  for (const [lo, hi, n] of bands) {
    for (let i = 0; i < n; i++) {
      const v = lo + (hi - lo) * r();
      out.push(hi > 0.95 || r() < 0.5 ? v : -v);
    }
  }
  return shuffle(out, r);
}

/**
 * One record per stream per hour, typical × (1 + deviation). `pins` fixes the
 * deviation of chosen hours ("host|hour"): the hours attacks land in.
 */
function day(id: string, label: string, streams: Stream[], devs: number[], pins: Record<string, number> = {}, extra: BenchRecord[] = []): BenchDay {
  const records: BenchRecord[] = [];
  let k = 0;
  for (const s of streams) {
    for (let h = 0; h < 24; h++) {
      const pin = pins[`${s.host}|${s.port}|${s.where}|${h}`];
      const dev = pin ?? devs[k++];
      records.push({ at: h * 60, host: s.host, peer: s.peer, where: s.where, port: s.port, mb: s.typical * (1 + dev) });
    }
  }
  if (k !== devs.length) throw new Error(`${label}: ${devs.length} deviations for ${k} hours`);
  records.push(...extra);
  records.sort((a, b) => a.at - b.at);
  return { id, label, records };
}

/** A clean day for a baseline: each stream's 24 hours average exactly its typical amount. */
function evenDay(id: string, label: string, streams: Stream[], spread: number, seed: number, extra: BenchRecord[] = []): BenchDay {
  const r = rng(seed);
  const devs: number[] = [];
  for (let i = 0; i < streams.length; i++) {
    const half = Array.from({ length: 12 }, () => spread * r());
    devs.push(...shuffle([...half, ...half.map((v) => -v)], r));
  }
  return day(id, label, streams, devs, {}, extra);
}

const pinKey = (s: Stream, hour: number) => `${s.host}|${s.port}|${s.where}|${hour}`;

// StreamCo: huge volume that swings all day.
const SC = {
  video: { host: 'sc-video', peer: 'viewers', where: 'internet', port: 443, typical: 40_000 },
  signin: { host: 'sc-accounts', peer: 'viewers signing in', where: 'internet', port: 443, typical: 600 },
  copies: { host: 'sc-library', peer: 'Video servers', where: 'inside', port: 445, typical: 5_000 },
  studios: { host: 'sc-library', peer: 'partner studios', where: 'internet', port: 443, typical: 2_000 },
} satisfies Record<string, Stream>;
const SC_STREAMS = Object.values(SC);

const streamToday = day(
  TODAY,
  'Nov 12',
  SC_STREAMS,
  deviations(
    [
      [0, 0.08, 33],
      [0.12, 0.22, 20],
      [0.3, 0.45, 18],
      [0.6, 0.9, 18],
      [1.15, 1.6, 4],
    ],
    rng(512),
  ),
  { [pinKey(SC.signin, 9)]: 0, [pinKey(SC.video, 11)]: 0, [pinKey(SC.studios, 14)]: 0 },
  [
    // A sign-in bot trying stolen passwords. Its traffic hides in the 09:00 sign-ins.
    { at: 9 * 60 + 10, host: 'sc-accounts', peer: 'a botnet', where: 'internet', port: 443, mb: 90, file: 'StuffBot/2.1', attack: STUFFBOT },
    // Last month's video player exploit: a tiny file inside 40 GB of video.
    { at: 11 * 60 + 40, host: 'sc-video', peer: '203.0.113.77', where: 'internet', port: 443, mb: 25, file: 'vidjack.js', attack: VIDJACK },
    // Today's new attack: unreleased shows copied out over the studios' usual channel.
    { at: 14 * 60 + 20, host: 'sc-library', peer: 'a cloud drive (198.51.100.23)', where: 'internet', port: 443, mb: 3_000, attack: LEAK },
  ],
);

// Riverbend Bottling: the same machines say the same things all day.
const RB = {
  filler: { host: 'rb-filler', peer: 'Control screen', where: 'inside', port: 502, typical: 12 },
  capper: { host: 'rb-capper', peer: 'Control screen', where: 'inside', port: 502, typical: 12 },
  reports: { host: 'rb-hmi', peer: 'plant office', where: 'inside', port: 443, typical: 30 },
} satisfies Record<string, Stream>;
const RB_STREAMS = Object.values(RB);

/** The infected filler controller checking in with its owner every hour, from `fromHour` on. */
const beacon = (fromHour: number): BenchRecord[] =>
  Array.from({ length: 24 - fromHour }, (_, i) => ({
    at: (fromHour + i) * 60 + 15,
    host: 'rb-filler',
    peer: '185.220.101.4',
    where: 'internet' as const,
    port: 4444,
    mb: 0.4,
    attack: BEACON,
  }));

const plantToday = day(TODAY, 'Nov 12', RB_STREAMS, deviations([[0, 0.04, 71]], rng(77)), { [pinKey(RB.reports, 14)]: 0.16 }, beacon(10).map((x) => x));
// The infection started Nov 3, so a day after that already has the beacon in it all day.
const plantInfected = evenDay(PLANT_INFECTED, 'Nov 9', RB_STREAMS, 0.04, 91, beacon(0));
const plantClean = evenDay(PLANT_CLEAN, 'Sep 14', RB_STREAMS, 0.04, 14);

// County 911 Dispatch: moderate, fairly steady traffic. Critical.
const CD = {
  dispatch: { host: 'cd-console', peer: 'Dispatch server', where: 'inside', port: 443, typical: 120 },
  radio: { host: 'cd-radio', peer: 'Dispatch server', where: 'inside', port: 5060, typical: 300 },
  state: { host: 'cd-cad', peer: 'state records', where: 'internet', port: 443, typical: 60 },
  web: { host: 'cd-console', peer: 'software updates', where: 'internet', port: 443, typical: 40 },
} satisfies Record<string, Stream>;
const CD_STREAMS = Object.values(CD);

const lockdown = (file: string): BenchRecord[] => [
  // The download: an ordinary-sized file from the internet. Only its name gives it away.
  { at: 10 * 60 + 38, host: 'cd-console', peer: '91.215.85.12', where: 'internet', port: 443, mb: 3, file, attack: LOCKDOWN },
  // Four minutes later it starts encrypting the dispatch server's shared files.
  { at: 10 * 60 + 42, host: 'cd-console', peer: 'Dispatch server', where: 'inside', port: 445, mb: 1_800, attack: LOCKDOWN },
];
const radioLeak: BenchRecord = { at: 15 * 60 + 5, host: 'cd-radio', peer: '203.0.113.140', where: 'internet', port: 9001, mb: 250, attack: RADIO };

const cdDevs = deviations(
  [
    [0, 0.08, 77],
    [0.12, 0.22, 12],
    [0.3, 0.45, 4],
    [0.6, 0.9, 2],
  ],
  rng(911),
);
const cdPins = { [pinKey(CD.web, 10)]: -0.05 };
const dispatchToday = day(TODAY, 'Nov 12', CD_STREAMS, cdDevs, cdPins, [...lockdown(LOCKDOWN_FILE), radioLeak]);
const dispatchRenamed = day(RENAMED, 'Nov 12 (file renamed)', CD_STREAMS, cdDevs, cdPins, [...lockdown(RENAMED_FILE), radioLeak]);
const dispatchBase = evenDay(DISPATCH_BASE, 'Nov 4', CD_STREAMS, 0.2, 4);

export const CLIENTS: BenchClient[] = [
  {
    id: STREAM,
    name: 'StreamCo',
    volume: 900_000,
    cost: { signature: 2000, anomaly: 9000, hybrid: 11000 },
    devices: ['sc-net', 'sc-video', 'sc-accounts', 'sc-library'],
    attacks: [
      { id: STUFFBOT, name: 'StuffBot password-guessing bot' },
      { id: VIDJACK, name: 'VidJack video player exploit' },
      { id: LEAK, name: 'Unreleased shows copied out', novel: true },
    ],
    days: { [TODAY]: streamToday, [STREAM_BASE]: evenDay(STREAM_BASE, 'Nov 5', SC_STREAMS, 0.9, 5) },
    today: TODAY,
    baselineDays: [STREAM_BASE],
  },
  {
    id: PLANT,
    name: 'Riverbend Bottling',
    volume: 1_200,
    cost: { signature: 300, anomaly: 800, hybrid: 1100 },
    devices: ['rb-net', 'rb-filler', 'rb-capper', 'rb-hmi'],
    attacks: [{ id: BEACON, name: 'Filler controller calling an outside server', novel: true }],
    days: { [TODAY]: plantToday, [PLANT_CLEAN]: plantClean, [PLANT_INFECTED]: plantInfected },
    today: TODAY,
    baselineDays: [PLANT_CLEAN, PLANT_INFECTED],
  },
  {
    id: DISPATCH,
    name: 'County 911',
    volume: 15_000,
    cost: { signature: 600, anomaly: 1800, hybrid: 2400 },
    devices: ['cd-net', 'cd-console', 'cd-cad', 'cd-radio'],
    attacks: [
      { id: LOCKDOWN, name: 'LockDown ransomware' },
      { id: RADIO, name: 'Radio gateway sending recordings out', novel: true },
    ],
    days: { [TODAY]: dispatchToday, [RENAMED]: dispatchRenamed, [DISPATCH_BASE]: dispatchBase },
    today: TODAY,
    baselineDays: [DISPATCH_BASE],
  },
];

const filler = (id: string, name: string, added: string): BenchSignature => ({ id, name, added });

export const SIGNATURES: BenchSignature[] = [
  { id: STUFFBOT, name: 'StuffBot password-guessing bot', added: SEP, file: 'StuffBot/2.1' },
  { id: LOCKDOWN, name: 'LockDown ransomware', added: SEP, file: LOCKDOWN_FILE },
  filler('mirai', 'Mirai botnet login', SEP),
  filler('emotet', 'Emotet email attachment', SEP),
  filler('log4shell', 'Log4Shell web exploit', SEP),
  filler('eternalblue', 'EternalBlue file-sharing exploit', SEP),
  filler('wannacry', 'WannaCry ransomware', SEP),
  filler('zeus', 'Zeus banking trojan', SEP),
  filler('sqli', 'SQL injection probe', SEP),
  filler('cobalt', 'Cobalt Strike beacon', SEP),
  filler('qakbot', 'Qakbot loader', SEP),
  filler('blackenergy', 'BlackEnergy power-grid malware', SEP),
  { id: VIDJACK, name: 'VidJack video player exploit', added: OCT, file: 'vidjack.js' },
  filler('akira', 'Akira ransomware', OCT),
  filler('vpn-exploit', 'VPN sign-in exploit', OCT),
];

export const BENCH_CONFIG: BenchConfig = {
  clients: CLIENTS,
  signatures: SIGNATURES,
  versions: [
    { id: SEP, label: 'September 2026' },
    { id: OCT, label: 'October 2026' },
  ],
  db: SEP,
  budget: BUDGET,
  names: NAMES,
};

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

const TOP = 230;
const ROW = 400;

export function buildDetect(): Sim {
  const n = new NetBuilder({ linkMs: 600 })
    .host('bench', {
      label: NAMES.bench,
      sublabel: 'replays recorded days',
      icon: 'server',
      x: 120,
      y: TOP,
      ip: '10.9.0.10/24',
      notes: [
        'Your company’s test machine. Each client’s network sensor records a full day of traffic and sends it here.',
        'The bench replays a recorded day through a detection method and scores it: attacks caught and missed, false alarms, time to detect, and cost.',
      ],
    })
    .host('analyst', {
      label: NAMES.analyst,
      sublabel: 'checks alerts',
      icon: 'desktop',
      x: 120,
      y: ROW,
      ip: '10.9.0.20/24',
      notes: ['Where an analyst reads each alert and decides whether it is a real attack. Checking one alert takes about 5 minutes.'],
    })
    .switch('sc-net', {
      label: NAMES['sc-net'],
      sublabel: 'sensor on mirror port',
      x: 430,
      y: TOP,
      notes: [
        'StreamCo streams shows to about 2 million viewers. Its traffic is enormous and changes all day: a new season or a big game can double it in an hour.',
        'Its sensor sees about 900,000 connections a minute.',
      ],
    })
    .host('sc-video', { label: NAMES['sc-video'], icon: 'tv', x: 280, y: ROW, ip: '10.1.0.10/24', notes: ['Sends video to viewers. About 40 GB an hour, more in the evening.'] })
    .host('sc-accounts', { label: NAMES['sc-accounts'], icon: 'server', x: 430, y: ROW, ip: '10.1.0.20/24', notes: ['Checks viewers’ passwords when they sign in.'] })
    .host('sc-library', {
      label: NAMES['sc-library'],
      icon: 'server',
      x: 580,
      y: ROW,
      ip: '10.1.0.30/24',
      notes: ['Holds every show, including ones not released yet. Copies shows to the video servers and trades files with partner studios.'],
    })
    .switch('rb-net', {
      label: NAMES['rb-net'],
      sublabel: 'sensor on mirror port',
      x: 930,
      y: TOP,
      notes: [
        'Riverbend Bottling fills and caps bottles. Its control network runs the machines on the factory floor.',
        'The same machines send the same messages every few seconds, all day, every day. Its sensor sees about 1,200 connections a minute.',
      ],
    })
    .host('rb-filler', { label: NAMES['rb-filler'], icon: 'server', x: 780, y: ROW, ip: '10.2.0.11/24', notes: ['Runs the bottle filler. Reports to the control screen.'] })
    .host('rb-capper', { label: NAMES['rb-capper'], icon: 'server', x: 930, y: ROW, ip: '10.2.0.12/24', notes: ['Runs the capping machine. Reports to the control screen.'] })
    .host('rb-hmi', { label: NAMES['rb-hmi'], icon: 'desktop', x: 1080, y: ROW, ip: '10.2.0.20/24', notes: ['Where operators watch and steer the machines. Sends shift reports to the plant office.'] })
    .switch('cd-net', {
      label: NAMES['cd-net'],
      sublabel: 'sensor on mirror port',
      x: 1430,
      y: TOP,
      notes: [
        'County 911 Dispatch answers emergency calls and sends police, fire, and ambulances. If it goes down, help arrives late.',
        'Its sensor sees about 15,000 connections a minute.',
      ],
    })
    .host('cd-console', { label: NAMES['cd-console'], icon: 'desktop', x: 1280, y: ROW, ip: '10.3.0.21/24', notes: ['Where a dispatcher takes calls and assigns units.'] })
    .host('cd-cad', { label: NAMES['cd-cad'], icon: 'server', x: 1430, y: ROW, ip: '10.3.0.10/24', notes: ['Keeps every open call, every unit’s location, and the shared files dispatchers use.'] })
    .host('cd-radio', { label: NAMES['cd-radio'], icon: 'wifi', x: 1580, y: ROW, ip: '10.3.0.30/24', notes: ['Connects the dispatch system to the police and fire radios, and records calls.'] })
    .link('bench', 'analyst');
  for (const [hub, hosts] of [
    ['sc-net', ['sc-video', 'sc-accounts', 'sc-library']],
    ['rb-net', ['rb-filler', 'rb-capper', 'rb-hmi']],
    ['cd-net', ['cd-console', 'cd-cad', 'cd-radio']],
  ] as const) {
    for (const h of hosts) n.link(hub, h);
  }
  const sim = n.build();
  sim.configureBench(BENCH, BENCH_CONFIG);
  return sim;
}

export function zones(): MapZone[] {
  const y = TOP - 95;
  const h = ROW - TOP + 190;
  return [
    { id: 'soc', shape: { kind: 'rect', x: 30, y, w: 180, h }, label: 'Your company', tone: 'info' },
    { id: STREAM, shape: { kind: 'rect', x: 200 + 30, y, w: 400, h }, label: 'StreamCo: video streaming', tone: 'neutral' },
    { id: PLANT, shape: { kind: 'rect', x: 700, y, w: 460, h }, label: 'Riverbend Bottling: plant controls', tone: 'neutral' },
    { id: DISPATCH, shape: { kind: 'rect', x: 1200, y, w: 460, h }, label: 'County 911 Dispatch', tone: 'neutral' },
  ];
}

// ---------------------------------------------------------------------------
// Read helpers for goals and buttons
// ---------------------------------------------------------------------------

export const bench = (sim: Sim) => sim.dev(BENCH).bench!;
