import { describe, expect, it } from 'vitest';
import {
  analystFound,
  anomalyDelayMs,
  dbSignatures,
  FATIGUE_AFTER,
  learnBaseline,
  newBench,
  planCost,
  queueCounts,
  runBench,
  signatureDelayMs,
  workQueue,
  type BenchAlert,
  type BenchClient,
  type BenchConfig,
  type BenchDay,
} from './bench';
import { NetBuilder } from './build';

// A tiny client: one steady stream, 100 MB an hour, and a day with two attacks.
const hours = (mb: (h: number) => number, extra: BenchDay['records'] = []): BenchDay['records'] => [
  ...Array.from({ length: 24 }, (_, h) => ({ at: h * 60, host: 'pc', peer: 'server', where: 'inside' as const, port: 443, mb: mb(h) })),
  ...extra,
];

const clean: BenchDay = { id: 'clean', label: 'Clean', records: hours(() => 100) };
const today: BenchDay = {
  id: 'today',
  label: 'Today',
  records: hours(
    (h) => (h === 3 ? 140 : 100),
    [
      // Known: a file the signature knows.
      { at: 9 * 60 + 5, host: 'pc', peer: 'evil', where: 'internet', port: 443, mb: 1, file: 'bad.exe', attack: 'known' },
      // New: a big upload inside the usual stream, no file name.
      { at: 15 * 60 + 10, host: 'pc', peer: 'server', where: 'inside', port: 443, mb: 300, attack: 'novel' },
    ],
  ),
};
const infected: BenchDay = {
  id: 'infected',
  label: 'Infected',
  records: hours(() => 100, [{ at: 60, host: 'pc', peer: 'evil', where: 'internet', port: 443, mb: 1, attack: 'known' }]),
};

const client: BenchClient = {
  id: 'c',
  name: 'Client',
  volume: 10_000,
  cost: { signature: 100, anomaly: 300, hybrid: 400 },
  devices: ['pc'],
  attacks: [
    { id: 'known', name: 'Known attack' },
    { id: 'novel', name: 'New attack', novel: true },
  ],
  days: { today, clean, infected },
  today: 'today',
  baselineDays: ['clean', 'infected'],
};

const config: BenchConfig = {
  clients: [client],
  signatures: [
    { id: 'known', name: 'Known attack', added: 'v2', file: 'bad.exe' },
    { id: 'old', name: 'Old attack', added: 'v1', file: 'old.exe' },
  ],
  versions: [
    { id: 'v1', label: 'Version 1' },
    { id: 'v2', label: 'Version 2' },
  ],
  db: 'v1',
  budget: 500,
};

const base = learnBaseline(clean);

describe('detection bench: the pure model', () => {
  it('learns the average hourly amount of each kind of traffic', () => {
    expect(base.typical['pc|443|inside']).toBe(100);
    expect(Object.keys(base.typical)).toEqual(['pc|443|inside']);
  });

  it('a database version holds every signature up to it', () => {
    expect(dbSignatures(config, 'v1').map((s) => s.id)).toEqual(['old']);
    expect(dbSignatures(config, 'v2').map((s) => s.id)).toEqual(['known', 'old']);
  });

  it('signatures catch only what the database knows, with no false alarms', () => {
    const v1 = runBench(config, client, { method: 'signature', db: 'v1', tolerance: 25, day: 'today' });
    expect(v1.caught).toEqual([]);
    expect(v1.missed).toEqual(['known', 'novel']);
    const v2 = runBench(config, client, { method: 'signature', db: 'v2', tolerance: 25, day: 'today' });
    expect(v2.caught).toEqual([{ attack: 'known', by: 'signature', detectMs: signatureDelayMs(10_000) }]);
    expect(v2.missed).toEqual(['novel']);
    expect(v2.falseAlarms).toBe(0);
    expect(v2.cost).toBe(100);
  });

  it('anomaly alerts on new kinds of traffic and on hours outside the tolerance', () => {
    const r = runBench(config, client, { method: 'anomaly', db: 'v1', tolerance: 25, baseline: base, day: 'today' });
    // The known attack is new traffic (to the internet); the upload pushes 15:00 to +300%; 03:00 at +40% is a false alarm.
    expect(r.caught.map((c) => c.attack).sort()).toEqual(['known', 'novel']);
    expect(r.falseAlarms).toBe(1);
    expect(r.caught.find((c) => c.attack === 'novel')!.detectMs).toBe(anomalyDelayMs(10_000));
    const loose = runBench(config, client, { method: 'anomaly', db: 'v1', tolerance: 50, baseline: base, day: 'today' });
    expect(loose.falseAlarms).toBe(0);
    const wide = runBench(config, client, { method: 'anomaly', db: 'v1', tolerance: 200, baseline: base, day: 'today' });
    expect(wide.missed).toEqual([]);
  });

  it('a baseline recorded during an attack learns the attack as normal', () => {
    const bad = learnBaseline(infected);
    const r = runBench(config, client, { method: 'anomaly', db: 'v1', tolerance: 25, baseline: bad, day: 'today' });
    expect(r.missed).toContain('known');
  });

  it('hybrid raises every alert either method raises, and takes the faster catch', () => {
    const sig = runBench(config, client, { method: 'signature', db: 'v2', tolerance: 25, day: 'today' });
    const anom = runBench(config, client, { method: 'anomaly', db: 'v2', tolerance: 25, baseline: base, day: 'today' });
    const hyb = runBench(config, client, { method: 'hybrid', db: 'v2', tolerance: 25, baseline: base, day: 'today' });
    expect(hyb.alerts.length).toBe(sig.alerts.length + anom.alerts.length);
    expect(hyb.caught.find((c) => c.attack === 'known')!.by).toBe('signature');
    expect(hyb.cost).toBe(400);
  });

  it('is slower on a busy network, and anomaly slower than signature', () => {
    expect(signatureDelayMs(900_000)).toBeGreaterThan(signatureDelayMs(1_000));
    expect(anomalyDelayMs(900_000)).toBeGreaterThan(anomalyDelayMs(1_000));
    expect(anomalyDelayMs(1_000)).toBeGreaterThan(signatureDelayMs(900_000));
  });

  it('the tired analyst stops reading after enough false alarms in a row', () => {
    const fake = (n: number): BenchAlert[] => Array.from({ length: n }, (_, i) => ({ at: i, host: 'pc', by: 'anomaly', why: '' }));
    const alerts = [...fake(FATIGUE_AFTER), { at: 99, host: 'pc', by: 'anomaly' as const, why: '', attack: 'novel' }];
    expect(workQueue(alerts)).toEqual({ checked: FATIGUE_AFTER, closed: 1, falseMinutes: FATIGUE_AFTER * 5 });
    expect(alerts[FATIGUE_AFTER].queue).toBe('closed');
    // A real alert before the streak ends resets it.
    const early = [...fake(FATIGUE_AFTER - 1), { at: 50, host: 'pc', by: 'anomaly' as const, why: '', attack: 'novel' }, ...fake(3)];
    workQueue(early);
    expect(early.every((a) => a.queue !== 'closed')).toBe(true);
    const r = { alerts: early, caught: [], missed: [], falseAlarms: 7, cost: 0 };
    expect(analystFound(r, 'novel')).toBe(true);
    expect(queueCounts(r)).toMatchObject({ closed: 0, realClosed: 0 });
  });

  it('adds up a plan', () => {
    const b = newBench(config);
    expect(planCost(b)).toBe(0);
    b.plan.c = 'hybrid';
    expect(planCost(b)).toBe(400);
  });
});

describe('detection bench: on the sim', () => {
  const build = () => {
    const sim = new NetBuilder().host('bench', { label: 'Bench', x: 0, y: 0, ip: '10.0.0.1/24' }).host('pc', { label: 'PC', x: 100, y: 0, ip: '10.0.0.2/24' }).build();
    sim.configureBench('bench', config);
    return sim;
  };

  it('logs a summary and one ALERT line per alert, and marks the map', () => {
    const sim = build();
    sim.benchInstallDb('bench', 'v2');
    sim.benchRun('bench', 'c');
    expect(sim.dev('bench').bench!.runs[0].result).toBeUndefined();
    sim.runUntilIdle();
    const run = sim.dev('bench').bench!.runs[0];
    expect(run.result!.caught.map((c) => c.attack)).toEqual(['known']);
    const logs = sim.dev('bench').logs;
    expect(logs.some((e) => e.msg.startsWith('RUN 1 Client signature') && e.fields?.caught === 1)).toBe(true);
    const alert = logs.find((e) => e.level === 'alert')!;
    expect(alert.fields).toMatchObject({ run: 1, attack: 'known', day: 'today', queue: 'real' });
    expect(run.result!.alerts[0].logNo).toBe(alert.no);
    expect(sim.events.some((e) => e.type === 'bench' && e.device === 'pc' && e.what === 'alerts')).toBe(true);
    expect(sim.events.some((e) => e.type === 'bench' && e.device === 'pc' && e.what === 'missed')).toBe(true);
  });

  it('a run keeps the settings it started with', () => {
    const sim = build();
    sim.benchSet('bench', 'c', { method: 'anomaly', tolerance: 50 });
    sim.benchRecordBaseline('bench', 'c', 'clean');
    sim.benchRun('bench', 'c');
    sim.benchSet('bench', 'c', { tolerance: 10 });
    sim.runUntilIdle();
    const run = sim.dev('bench').bench!.runs[0];
    expect(run.tolerance).toBe(50);
    expect(run.result!.falseAlarms).toBe(0);
  });

  it('ignores a baseline day or database version the bench does not have', () => {
    const sim = build();
    sim.benchRecordBaseline('bench', 'c', 'today');
    sim.benchInstallDb('bench', 'v9');
    const b = sim.dev('bench').bench!;
    expect(b.settings.c.baseline).toBeUndefined();
    expect(b.db).toBe('v1');
  });
});
