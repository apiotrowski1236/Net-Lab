/**
 * Detection bench (built for `detect-methods`).
 *
 * A managed security company tests detection methods on recordings of its
 * clients' traffic before it buys anything. The bench replays one recorded day
 * through signature, anomaly, or hybrid detection and scores the result: real
 * attacks caught and missed, false alarms, time to detect, and the monthly
 * cost of running that method on that client's network. Nothing crosses the
 * map: a run is a pure function of the recording and the settings, so the
 * same settings always give the same score.
 *
 * RECORDINGS
 *   A day (`BenchDay`) is a list of `BenchRecord`s: who sent how much of what
 *   kind of traffic, and when. Normal traffic is one record per stream per
 *   hour (that hour's total). An attack is one or more records labeled with
 *   `attack`; its traffic adds to the hour it lands in. `file` is a detail a
 *   signature can recognize (a file name or a program's name tag).
 *
 * SIGNATURE DETECTION
 *   Compares each record with the installed signature database
 *   (`BenchState.db`). A signature (`BenchSignature`) names one detail of a
 *   known attack; a record with that detail raises an alert at once. A
 *   database version holds every signature added up to it, so an attack
 *   newer than the database (or one whose detail changed) slips through.
 *
 * ANOMALY DETECTION
 *   Needs a baseline (`learnBaseline`): the typical hourly amount of each kind
 *   of traffic (`kindKey`: device, port, and inside or internet) on a
 *   recorded day. On the day being judged, a kind of traffic the baseline
 *   never saw raises one alert ("new kind of traffic"), and an hour whose
 *   total is outside the tolerance range (typical ± `tolerance` percent)
 *   raises one alert. A baseline recorded while an attack was already running
 *   learns the attack as normal.
 *
 * HYBRID
 *   Both at once. Every alert either method raises counts, so hybrid catches
 *   the most and raises the most alerts.
 *
 * SPEED AND COST
 *   Time to detect is the time from an attack's first record to its first
 *   alert, plus the method's analysis delay, which grows with the client's
 *   traffic volume (`signatureDelayMs`, `anomalyDelayMs`): signatures are
 *   faster, much faster on a busy network. Cost per month comes from the
 *   client (`BenchClient.cost`).
 *
 * THE ANALYST
 *   `workQueue` hands a run's alerts, in time order, to a simulated analyst
 *   who checks each one (MINUTES_PER_ALERT) until FATIGUE_AFTER false alarms
 *   in a row; after that the analyst assumes every alert is false and closes
 *   the rest without a look (alert fatigue). A real alert closed that way is
 *   missed.
 *
 * API
 *   Sim (sim.ts, section "detection bench"): configureBench, benchSet,
 *     benchRecordBaseline, benchInstallDb, benchSetDay, benchRun, benchPlan.
 *     Actions bench-set, bench-baseline, bench-db, bench-run, bench-plan.
 *     A finished run writes a summary line and one ALERT line per alert on the
 *     bench device (source 'bench'), and a 'bench' sim event per map device
 *     that alerted or had an attack missed.
 *   Here: runBench (the pure scorer), learnBaseline, workQueue, planCost,
 *     dbSignatures, the delay formulas, and words for the UI.
 */

export type BenchMethod = 'signature' | 'anomaly' | 'hybrid';
export const BENCH_METHODS: BenchMethod[] = ['signature', 'anomaly', 'hybrid'];

/** Tolerance choices, in percent: how far from typical an hour may be before anomaly detection alerts. */
export const TOLERANCES_PCT = [10, 25, 50, 100, 200] as const;
export type TolerancePct = (typeof TOLERANCES_PCT)[number];

/** How long the bench takes to replay a day (sim ms). The result appears after this. */
export const RUN_MS = 600;
/** The analyst spends this long checking one alert. */
export const MINUTES_PER_ALERT = 5;
/** After this many false alarms in a row, the analyst stops looking. */
export const FATIGUE_AFTER = 5;

export interface BenchRecord {
  /** Minutes after midnight. */
  at: number;
  /** The map device that sent or received it. */
  host: string;
  /** Who's on the other end, in words: "viewers", "185.220.101.4". */
  peer: string;
  where: 'inside' | 'internet';
  port: number;
  /** Megabytes. */
  mb: number;
  /** A detail a signature can match: a file name, a program's name tag. */
  file?: string;
  /** The attack this record belongs to (BenchAttack.id). Normal traffic has none. */
  attack?: string;
}

export interface BenchDay {
  id: string;
  /** "Nov 12". */
  label: string;
  records: BenchRecord[];
}

export interface BenchAttack {
  id: string;
  /** "StuffBot sign-in attack". */
  name: string;
  /** No signature exists for it anywhere: a new attack. */
  novel?: boolean;
}

export interface BenchSignature {
  id: string;
  name: string;
  /** The database version that added it (BenchDbVersion.id). */
  added: string;
  /** The detail it recognizes. A signature with no `file` never matches a record (it's in the list for other networks). */
  file?: string;
}

export interface BenchDbVersion {
  id: string;
  /** "September 2026". */
  label: string;
}

export interface BenchClient {
  id: string;
  name: string;
  /** Connections per minute: drives the analysis delay. */
  volume: number;
  /** Dollars per month for each method on this network. */
  cost: Record<BenchMethod, number>;
  /** Map devices on this client's network. */
  devices: string[];
  attacks: BenchAttack[];
  /** Days the bench can replay, keyed by id. */
  days: Record<string, BenchDay>;
  /** The day a run replays unless benchSetDay picks another. */
  today: string;
  /** Days a baseline can be recorded from. */
  baselineDays: string[];
}

export interface BenchConfig {
  clients: BenchClient[];
  signatures: BenchSignature[];
  /** Oldest first. */
  versions: BenchDbVersion[];
  /** The version installed at the start. */
  db: string;
  /** Dollars per month for every client together. */
  budget: number;
  /** Device id -> its name on screen, for alert text. */
  names?: Record<string, string>;
}

/** A baseline: each kind of traffic's typical hourly amount. */
export interface BenchBaseline {
  day: string;
  typical: Record<string, number>;
}

export interface ClientSettings {
  method: BenchMethod;
  tolerance: TolerancePct;
  baseline?: BenchBaseline;
  /** The day a run replays. */
  day: string;
}

export interface BenchAlert {
  /** Minutes after midnight on the replayed day. */
  at: number;
  host: string;
  by: 'signature' | 'anomaly';
  /** Why, in words. */
  why: string;
  /** The attack it found, or none for a false alarm. */
  attack?: string;
  /** The log line it was written as (LogEntry.no). */
  logNo?: number;
  /** What the analyst did with it (workQueue). */
  queue?: QueueStatus;
}

export type QueueStatus = 'real' | 'false' | 'closed';

export interface CaughtAttack {
  attack: string;
  by: 'signature' | 'anomaly';
  /** From the attack's first record to its alert, in ms. */
  detectMs: number;
}

export interface BenchResult {
  alerts: BenchAlert[];
  caught: CaughtAttack[];
  /** Attack ids with no alert: false negatives. */
  missed: string[];
  falseAlarms: number;
  cost: number;
}

export interface BenchRun {
  no: number;
  client: string;
  method: BenchMethod;
  db: string;
  tolerance: TolerancePct;
  baselineDay?: string;
  day: string;
  startedAt: number;
  /** Set when the result is in (RUN_MS after it starts). */
  doneAt?: number;
  result?: BenchResult;
}

export interface BenchState {
  config: BenchConfig;
  db: string;
  settings: Record<string, ClientSettings>;
  runs: BenchRun[];
  /** The recommended method for each client (step "Recommend"). */
  plan: Record<string, BenchMethod>;
}

export function newBench(config: BenchConfig): BenchState {
  const settings: Record<string, ClientSettings> = {};
  for (const c of config.clients) settings[c.id] = { method: 'signature', tolerance: 25, day: c.today };
  return { config, db: config.db, settings, runs: [], plan: {} };
}

export const clientOf = (b: BenchState, id: string): BenchClient => {
  const c = b.config.clients.find((x) => x.id === id);
  if (!c) throw new Error(`The bench has no client "${id}"`);
  return c;
};

// ---------------------------------------------------------------------------
// The pure model
// ---------------------------------------------------------------------------

/** One kind of traffic, for baselines: device, port, and which side the other end is on. */
export const kindKey = (r: Pick<BenchRecord, 'host' | 'port' | 'where'>): string => `${r.host}|${r.port}|${r.where}`;

const hourOf = (r: BenchRecord) => Math.floor(r.at / 60);

/** Each kind of traffic's hourly totals on a day: key -> hour -> MB. */
function hourly(day: BenchDay): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const r of day.records) {
    const k = kindKey(r);
    const m = out.get(k) ?? new Map<number, number>();
    m.set(hourOf(r), (m.get(hourOf(r)) ?? 0) + r.mb);
    out.set(k, m);
  }
  return out;
}

/** Learn what normal looks like from a recorded day: the average hourly amount of each kind of traffic. */
export function learnBaseline(day: BenchDay): BenchBaseline {
  const typical: Record<string, number> = {};
  for (const [k, hours] of hourly(day)) {
    let sum = 0;
    for (const v of hours.values()) sum += v;
    typical[k] = sum / hours.size;
  }
  return { day: day.id, typical };
}

/** The signatures in a database version: every one added up to it. */
export function dbSignatures(config: BenchConfig, db: string): BenchSignature[] {
  const upto = config.versions.findIndex((v) => v.id === db);
  const ok = new Set(config.versions.slice(0, upto + 1).map((v) => v.id));
  return config.signatures.filter((s) => ok.has(s.added));
}

/** Signature analysis delay: about a second, plus a little more on a busy network. */
export const signatureDelayMs = (volume: number): number => Math.round(1000 + volume / 200);
/** Anomaly analysis delay: about 20 seconds, plus much more on a busy network. */
export const anomalyDelayMs = (volume: number): number => Math.round(20_000 + volume / 2);

export interface RunInput {
  method: BenchMethod;
  /** Installed signature database version. */
  db: string;
  tolerance: TolerancePct;
  baseline?: BenchBaseline;
  day: string;
}

/** Replay one day of one client through a method and score it. */
export function runBench(config: BenchConfig, client: BenchClient, input: RunInput): BenchResult {
  const day = client.days[input.day];
  if (!day) throw new Error(`${client.name} has no recorded day "${input.day}"`);
  const name = (id: string) => config.names?.[id] ?? id;
  const alerts: BenchAlert[] = [];
  const useSig = input.method !== 'anomaly';
  const useAnom = input.method !== 'signature';

  if (useSig) {
    const sigs = dbSignatures(config, input.db).filter((s) => s.file);
    for (const r of day.records) {
      const s = sigs.find((x) => x.file === r.file);
      if (s) alerts.push({ at: r.at, host: r.host, by: 'signature', why: `matched signature "${s.name}" (${s.file})`, attack: r.attack });
    }
  }

  if (useAnom && input.baseline) {
    const typical = input.baseline.typical;
    const tol = input.tolerance / 100;
    const seenNew = new Set<string>();
    const buckets = new Map<string, BenchRecord[]>();
    for (const r of day.records) {
      const k = kindKey(r);
      if (typical[k] === undefined) {
        if (seenNew.has(k)) continue;
        seenNew.add(k);
        alerts.push({
          at: r.at,
          host: r.host,
          by: 'anomaly',
          why: `new kind of traffic: ${name(r.host)} ${r.where === 'internet' ? 'to the internet' : 'inside'} (${r.peer}) on port ${r.port}`,
          attack: r.attack,
        });
        continue;
      }
      const b = `${k}#${hourOf(r)}`;
      buckets.set(b, [...(buckets.get(b) ?? []), r]);
    }
    for (const rs of buckets.values()) {
      const k = kindKey(rs[0]);
      const total = rs.reduce((s, r) => s + r.mb, 0);
      const usual = typical[k];
      const dev = (total - usual) / usual;
      if (Math.abs(dev) <= tol) continue;
      const bad = rs.find((r) => r.attack);
      const h = hourOf(rs[0]);
      alerts.push({
        at: bad ? bad.at : h * 60 + 30,
        host: rs[0].host,
        by: 'anomaly',
        why: `${name(rs[0].host)} to ${rs[0].peer}, port ${rs[0].port}: on pace for ${amount(total)} in the hour starting ${clock(h * 60)}, usual ${amount(usual)} (${signedPct(dev)}, outside ±${input.tolerance}%)`,
        attack: bad?.attack,
      });
    }
  }

  alerts.sort((a, b) => a.at - b.at || (a.by === b.by ? 0 : a.by === 'signature' ? -1 : 1));

  const caught: CaughtAttack[] = [];
  const missed: string[] = [];
  for (const atk of client.attacks) {
    const first = day.records.filter((r) => r.attack === atk.id).reduce((m, r) => Math.min(m, r.at), Infinity);
    if (first === Infinity) continue; // not in this recording
    let best: CaughtAttack | undefined;
    for (const a of alerts) {
      if (a.attack !== atk.id) continue;
      const ms = (a.at - first) * 60_000 + (a.by === 'signature' ? signatureDelayMs(client.volume) : anomalyDelayMs(client.volume));
      if (!best || ms < best.detectMs) best = { attack: atk.id, by: a.by, detectMs: ms };
    }
    if (best) caught.push(best);
    else missed.push(atk.id);
  }

  workQueue(alerts);
  return { alerts, caught, missed, falseAlarms: alerts.filter((a) => !a.attack).length, cost: client.cost[input.method] };
}

/**
 * The tired analyst: check alerts in time order until FATIGUE_AFTER false
 * alarms in a row, then close the rest without a look. Sets each alert's
 * `queue` and returns the counts.
 */
export function workQueue(alerts: BenchAlert[]): { checked: number; closed: number; falseMinutes: number } {
  let streak = 0;
  let checked = 0;
  let falseMinutes = 0;
  for (const a of alerts) {
    if (streak >= FATIGUE_AFTER) {
      a.queue = 'closed';
      continue;
    }
    checked++;
    if (a.attack) {
      a.queue = 'real';
      streak = 0;
    } else {
      a.queue = 'false';
      streak++;
      falseMinutes += MINUTES_PER_ALERT;
    }
  }
  return { checked, closed: alerts.length - checked, falseMinutes };
}

/** Totals for a run's analyst queue. */
export function queueCounts(r: BenchResult): { checked: number; closed: number; falseMinutes: number; realClosed: number } {
  const checked = r.alerts.filter((a) => a.queue !== 'closed').length;
  return {
    checked,
    closed: r.alerts.length - checked,
    falseMinutes: r.alerts.filter((a) => a.queue === 'false').length * MINUTES_PER_ALERT,
    realClosed: r.alerts.filter((a) => a.queue === 'closed' && a.attack).length,
  };
}

/** Whether the analyst found an attack: one of its alerts was checked. */
export const analystFound = (r: BenchResult, attack: string): boolean => r.alerts.some((a) => a.attack === attack && a.queue === 'real');

/** A plan's monthly cost. Clients with no method chosen cost nothing yet. */
export function planCost(b: BenchState): number {
  return b.config.clients.reduce((s, c) => s + (b.plan[c.id] ? c.cost[b.plan[c.id]] : 0), 0);
}

// ---------------------------------------------------------------------------
// Words for the UI and logs
// ---------------------------------------------------------------------------

export const METHOD_NAME: Record<BenchMethod, string> = { signature: 'Signature', anomaly: 'Anomaly', hybrid: 'Hybrid' };

/** "09:05". */
export function clock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "740 MB", "3.0 GB". */
export function amount(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

const signedPct = (dev: number) => `${dev >= 0 ? '+' : '−'}${Math.round(Math.abs(dev) * 100)}%`;

/** "6 seconds", "7 min 50 s". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** "$2,000". */
export const dollars = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** The settings a run used, in a few words: "Sep database", "Sep 14 baseline, ±25%". */
export function runSettings(b: BenchState, r: BenchRun): string {
  const parts: string[] = [];
  if (r.method !== 'anomaly') parts.push(`${b.config.versions.find((v) => v.id === r.db)?.label ?? r.db} signatures`);
  if (r.method !== 'signature') {
    const c = clientOf(b, r.client);
    parts.push(r.baselineDay ? `${c.days[r.baselineDay]?.label ?? r.baselineDay} baseline, ±${r.tolerance}%` : 'no baseline');
  }
  return parts.join('; ');
}

/** The newest finished run that matches. */
export function lastRun(b: BenchState, pred: (r: BenchRun) => boolean = () => true): BenchRun | undefined {
  for (let i = b.runs.length - 1; i >= 0; i--) if (b.runs[i].result && pred(b.runs[i])) return b.runs[i];
  return undefined;
}
