import { describe, expect, it } from 'vitest';
import { RUN_MS, analystFound, BENCH_METHODS, learnBaseline, queueCounts, runBench, type BenchMethod, type TolerancePct } from '../../sim/bench';
import { detectMethodsLab } from '.';
import {
  BEACON,
  bench,
  BENCH,
  BENCH_CONFIG,
  BUDGET,
  buildDetect,
  CLIENTS,
  DISPATCH,
  DISPATCH_BASE,
  LEAK,
  LOCKDOWN,
  OCT,
  PLANT,
  PLANT_CLEAN,
  PLANT_INFECTED,
  RADIO,
  RENAMED,
  SEP,
  STREAM,
  STREAM_BASE,
  STUFFBOT,
  TODAY,
  VIDJACK,
} from './scenario';

const client = (id: string) => CLIENTS.find((c) => c.id === id)!;
const run = (id: string, method: BenchMethod, opts: { db?: string; tolerance?: TolerancePct; baseline?: string; day?: string } = {}) => {
  const c = client(id);
  return runBench(BENCH_CONFIG, c, {
    method,
    db: opts.db ?? OCT,
    tolerance: opts.tolerance ?? 25,
    baseline: opts.baseline ? learnBaseline(c.days[opts.baseline]) : undefined,
    day: opts.day ?? TODAY,
  });
};
const caughtIds = (r: ReturnType<typeof runBench>) => r.caught.map((c) => c.attack).sort();

describe('detect-methods: the recorded days teach what the lesson says', () => {
  it('builds the same days every time', () => {
    expect(JSON.stringify(buildDetect().dev(BENCH).bench)).toBe(JSON.stringify(buildDetect().dev(BENCH).bench));
  });

  it('baseline days average exactly the typical amounts', () => {
    for (const [id, day] of [
      [STREAM, STREAM_BASE],
      [PLANT, PLANT_CLEAN],
      [DISPATCH, DISPATCH_BASE],
    ]) {
      const b = learnBaseline(client(id).days[day]);
      for (const v of Object.values(b.typical)) expect(v).toBeGreaterThan(0);
    }
  });

  it('StreamCo, signatures: September catches StuffBot only; October adds VidJack; the copied shows never', () => {
    const sep = run(STREAM, 'signature', { db: SEP });
    expect(caughtIds(sep)).toEqual([STUFFBOT]);
    expect(sep.falseAlarms).toBe(0);
    const oct = run(STREAM, 'signature');
    expect(caughtIds(oct)).toEqual([STUFFBOT, VIDJACK]);
    expect(oct.missed).toEqual([LEAK]);
    expect(oct.falseAlarms).toBe(0);
    expect(oct.caught[0].detectMs).toBeLessThan(10_000);
  });

  it('StreamCo, anomaly: false alarms fall as the tolerance widens, and ±200% misses the copied shows', () => {
    const fa = ([10, 25, 50, 100, 200] as const).map((t) => run(STREAM, 'anomaly', { baseline: STREAM_BASE, tolerance: t }));
    expect(fa.map((r) => r.falseAlarms)).toEqual([60, 40, 22, 4, 0]);
    for (const r of fa.slice(0, 4)) expect(caughtIds(r)).toContain(LEAK);
    expect(fa[4].missed).toContain(LEAK);
    // Slow on a busy network: minutes, not seconds.
    expect(fa[1].caught.find((c) => c.attack === LEAK)!.detectMs).toBeGreaterThan(5 * 60_000);
  });

  it('StreamCo, the analyst: closes the copied shows unread at ±10% to ±50%, finds them at ±100%', () => {
    for (const t of [10, 25, 50] as const) {
      const r = run(STREAM, 'anomaly', { baseline: STREAM_BASE, tolerance: t });
      expect(analystFound(r, LEAK)).toBe(false);
      expect(r.alerts.find((a) => a.attack === LEAK)!.queue).toBe('closed');
    }
    const r = run(STREAM, 'anomaly', { baseline: STREAM_BASE, tolerance: 100 });
    expect(analystFound(r, LEAK)).toBe(true);
    expect(queueCounts(r).closed).toBe(0);
  });

  it('Riverbend: the clean baseline catches the beacon at every tolerance; the infected one never does', () => {
    for (const t of [10, 25, 50, 100, 200] as const) {
      expect(caughtIds(run(PLANT, 'anomaly', { baseline: PLANT_CLEAN, tolerance: t }))).toEqual([BEACON]);
      expect(run(PLANT, 'anomaly', { baseline: PLANT_INFECTED, tolerance: t }).missed).toEqual([BEACON]);
    }
    expect(run(PLANT, 'anomaly', { baseline: PLANT_CLEAN }).falseAlarms).toBe(0);
    expect(run(PLANT, 'signature').missed).toEqual([BEACON]);
  });

  it('County 911: signature catches LockDown in seconds, anomaly in minutes, hybrid gets both attacks fastest', () => {
    const sig = run(DISPATCH, 'signature');
    expect(caughtIds(sig)).toEqual([LOCKDOWN]);
    const anom = run(DISPATCH, 'anomaly', { baseline: DISPATCH_BASE });
    expect(caughtIds(anom)).toEqual([LOCKDOWN, RADIO]);
    const hyb = run(DISPATCH, 'hybrid', { baseline: DISPATCH_BASE });
    expect(caughtIds(hyb)).toEqual([LOCKDOWN, RADIO]);
    const lock = (r: typeof sig) => r.caught.find((c) => c.attack === LOCKDOWN)!.detectMs;
    expect(lock(hyb)).toBe(lock(sig));
    expect(lock(anom)).toBeGreaterThan(4 * 60_000);
    expect(hyb.alerts.length).toBeGreaterThan(anom.alerts.length);
    expect(anom.alerts.length).toBeGreaterThan(sig.alerts.length);
    // The analyst keeps up at ±25%.
    expect(analystFound(hyb, LOCKDOWN) && analystFound(hyb, RADIO)).toBe(true);
  });

  it('County 911 renamed: signatures miss LockDown; anomaly still catches it at 10:42', () => {
    expect(run(DISPATCH, 'signature', { day: RENAMED }).missed).toContain(LOCKDOWN);
    const hyb = run(DISPATCH, 'hybrid', { baseline: DISPATCH_BASE, day: RENAMED });
    const a = hyb.alerts.find((x) => x.attack === LOCKDOWN)!;
    expect(a.by).toBe('anomaly');
    expect(a.at).toBe(10 * 60 + 42);
  });

  it('only one plan meets every client’s need within the budget', () => {
    const fits: string[] = [];
    for (const s of BENCH_METHODS)
      for (const p of BENCH_METHODS)
        for (const d of BENCH_METHODS) {
          const cost = client(STREAM).cost[s] + client(PLANT).cost[p] + client(DISPATCH).cost[d];
          // StreamCo: few false alarms; Riverbend: catches the new attack; 911: catches both.
          if (cost <= BUDGET && s === 'signature' && p !== 'signature' && d === 'hybrid') fits.push(`${s} ${p} ${d}`);
        }
    expect(fits).toEqual(['signature anomaly hybrid']);
    // A hybrid StreamCo alone blows the budget.
    expect(client(STREAM).cost.hybrid).toBeGreaterThan(BUDGET);
  });
});

describe('detect-methods: steps', () => {
  const step = (id: string) => detectMethodsLab.steps.find((s) => s.id === id)!;

  it('the fatigue step’s setup leaves a StreamCo run whose copied-shows alert was closed unread', () => {
    const sim = buildDetect();
    step('fatigue').setup!(sim);
    sim.runUntilIdle();
    const runs = bench(sim).runs.filter((r) => r.client === STREAM);
    const last = runs[runs.length - 1];
    expect(last.result!.alerts.find((a) => a.attack === LEAK)!.queue).toBe('closed');
    // Run again: it keeps the student's run instead of adding another.
    step('fatigue').setup!(sim);
    sim.runUntilIdle();
    expect(bench(sim).runs.filter((r) => r.client === STREAM)).toHaveLength(runs.length);
  });

  it('the bypass step’s setup records a 911 baseline only if there is none', () => {
    const sim = buildDetect();
    step('bypass').setup!(sim);
    expect(bench(sim).settings[DISPATCH].baseline?.day).toBe(DISPATCH_BASE);
  });

  it('the rename button switches County 911 to the renamed day', () => {
    const sim = buildDetect();
    step('bypass').actions![0].run(sim);
    expect(bench(sim).settings[DISPATCH].day).toBe(RENAMED);
  });

  it('the run card’s reason lines say what the questions ask about', () => {
    // Step 4: the beacon stands out as new traffic, port 4444 included.
    const plant = run(PLANT, 'anomaly', { baseline: PLANT_CLEAN });
    expect(plant.alerts.find((a) => a.attack === BEACON)!.why).toBe('new kind of traffic, not in the baseline: Filler controller to 198.51.100.4 on the internet, port 4444 (no common service)');
    // Step 9: signatures caught the original at the 10:38 download; anomaly catches the repack at 10:42, locking files.
    const orig = run(DISPATCH, 'signature').alerts.find((a) => a.attack === LOCKDOWN)!;
    expect([orig.at, orig.why]).toEqual([10 * 60 + 38, 'matched the "LockDown ransomware" signature (file hash 313e2d61…)']);
    const repack = run(DISPATCH, 'hybrid', { baseline: DISPATCH_BASE, day: RENAMED }).alerts.find((a) => a.attack === LOCKDOWN)!;
    expect([repack.at, repack.why]).toEqual([10 * 60 + 42, 'new kind of traffic, not in the baseline: Dispatcher console to Dispatch server, port 445 (file sharing)']);
    // Step 7: the volume alert spells out how much more than usual.
    const leak = run(STREAM, 'anomaly', { baseline: STREAM_BASE }).alerts.find((a) => a.attack === LEAK)!;
    expect(leak.why).toBe('Content library to partner studios, port 443 (secure web): at this rate, 14:00 to 15:00 adds up to 5.0 GB, usual 2.0 GB (3.0 GB more, +150%, outside ±25%)');
  });

  it('the 911 step lists its goals in the order the steps say', () => {
    expect(step('hybrid').goals!.map((g) => g.id)).toEqual(['signature', 'baseline', 'anomaly', 'hybrid']);
  });
  it('the run card says why each missed attack got through', () => {
    const sep = run(STREAM, 'signature', { db: SEP });
    expect(sep.missedWhy).toEqual({ [VIDJACK]: 'the September 2026 database has no signature for it', [LEAK]: 'no signature exists for it yet' });
    // Step 7 at ±200%: the copied shows' hour was +150%, inside the range.
    expect(run(STREAM, 'anomaly', { baseline: STREAM_BASE, tolerance: 200 }).missedWhy![LEAK]).toBe('its hour was +150%, inside the ±200% tolerance');
    // Step 6: StuffBot's hour stayed inside ±25%.
    expect(run(STREAM, 'anomaly', { baseline: STREAM_BASE }).missedWhy![STUFFBOT]).toMatch(/^its hour was [+−]\d+%, inside the ±25% tolerance$/);
    // Step 6: VidJack's small file adds nothing visible to 40 GB of video, and the card says so.
    expect(run(STREAM, 'anomaly', { baseline: STREAM_BASE }).missedWhy![VIDJACK]).toBe('it added almost no traffic: its hour was +0%, inside the ±25% tolerance');
    // Step 5: the infected baseline. It names the match, not the reason, so the question still asks for it.
    expect(run(PLANT, 'anomaly', { baseline: PLANT_INFECTED }).missedWhy![BEACON]).toBe('its traffic matched the Nov 9 baseline');
    // Step 9: the repacked file has a hash no signature knows.
    expect(run(DISPATCH, 'signature', { day: RENAMED }).missedWhy![LOCKDOWN]).toBe('no signature matches its file');
    // Hybrid gives both methods' reasons.
    expect(run(PLANT, 'hybrid', { baseline: PLANT_INFECTED }).missedWhy![BEACON]).toBe('no signature exists for it yet; its traffic matched the Nov 9 baseline');
    // Step 9 on hybrid: anomaly catches the repack, and the card still says why the signature half missed.
    const hyb = run(DISPATCH, 'hybrid', { baseline: DISPATCH_BASE, day: RENAMED });
    expect(hyb.missed).not.toContain(LOCKDOWN);
    expect(hyb.notBy![LOCKDOWN]).toEqual({ signature: 'no signature matches its file' });
  });
});

describe('detect-methods: goals finished the wrong way', () => {
  const step = (id: string) => detectMethodsLab.steps.find((s) => s.id === id)!;
  const goal = (sid: string, gid: string) => step(sid).goals!.find((g) => g.id === gid)!;
  const finish = (sim: ReturnType<typeof buildDetect>) => sim.runUntilIdle();

  it('step 9: a signature run before Load the day doesn’t count as the repacked run', () => {
    const sim = buildDetect();
    step('bypass').setup!(sim);
    const since = sim.t;
    sim.benchSet(BENCH, DISPATCH, { method: 'signature' });
    sim.benchRun(BENCH, DISPATCH);
    finish(sim);
    expect(goal('bypass', 'renamed-sig').check({ sim, since })).toBe(false);
    step('bypass').actions![0].run(sim);
    sim.benchRun(BENCH, DISPATCH);
    finish(sim);
    expect(goal('bypass', 'renamed-sig').check({ sim, since })).toBe(true);
    // Signature can't catch it, so only an anomaly or hybrid run finishes the second goal.
    expect(goal('bypass', 'renamed-anom').check({ sim, since })).toBe(false);
    sim.benchSet(BENCH, DISPATCH, { method: 'anomaly' });
    sim.benchRun(BENCH, DISPATCH);
    finish(sim);
    expect(goal('bypass', 'renamed-anom').check({ sim, since })).toBe(true);
  });

  it('a run started just before Continue doesn’t count in the next step, even though its result lands there', () => {
    const sim = buildDetect();
    sim.benchSet(BENCH, STREAM, { method: 'anomaly' });
    sim.benchRecordBaseline(BENCH, STREAM, STREAM_BASE);
    sim.benchSet(BENCH, STREAM, { tolerance: 100 });
    sim.benchRun(BENCH, STREAM);
    const since = sim.t + RUN_MS / 2; // Continue pressed while it replays
    finish(sim);
    expect(analystFound(bench(sim).runs[0].result!, LEAK)).toBe(true);
    expect(goal('fatigue', 'found').check({ sim, since })).toBe(false);
  });

  it('step 7: a ±200% signature-only run can’t stand in for the anomaly miss', () => {
    const sim = buildDetect();
    const since = sim.t;
    sim.benchRun(BENCH, STREAM); // signature misses the copied shows too
    finish(sim);
    expect(goal('fatigue', 'too-wide').check({ sim, since })).toBe(false);
  });

  it('step 5: the Sep 14 button pressed before the Nov 9 run doesn’t finish “record it again”', () => {
    const sim = buildDetect();
    step('bad-baseline').setup!(sim);
    const since = sim.t;
    sim.benchRecordBaseline(BENCH, PLANT, PLANT_CLEAN);
    expect(goal('bad-baseline', 'sep14-again').check({ sim, since })).toBe(false);
    sim.benchRecordBaseline(BENCH, PLANT, PLANT_INFECTED);
    sim.benchRun(BENCH, PLANT);
    finish(sim);
    expect(goal('bad-baseline', 'sep14-again').check({ sim, since })).toBe(false);
    sim.benchRecordBaseline(BENCH, PLANT, PLANT_CLEAN);
    expect(goal('bad-baseline', 'sep14-again').check({ sim, since })).toBe(true);
  });
});
