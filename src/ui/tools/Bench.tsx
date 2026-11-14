import { useState } from 'preact/hooks';
import {
  clientOf,
  clock,
  dbSignatures,
  dollars,
  duration,
  FATIGUE_AFTER,
  lastRun,
  METHOD_NAME,
  MINUTES_PER_ALERT,
  planCost,
  queueCounts,
  runSettings,
  TOLERANCES_PCT,
  type BenchAlert,
  type BenchMethod,
  type BenchRun,
  type BenchState,
  type QueueStatus,
} from '../../sim/bench';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

// Pick Your Detector (detect-methods): the detection bench, the analyst
// queue, and the plan. The model and its rules are in src/sim/bench.ts.

const uses = (m: BenchMethod, part: 'signature' | 'anomaly') => m === 'hybrid' || m === part;

function Seg<T extends string | number>({ label, value, opts, onPick }: { label: string; value: T; opts: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {opts.map(([v, text]) => (
        <button key={String(v)} class={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => value !== v && onPick(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Each attack in a run: caught by what, how fast, or missed. */
function RunDetail({ b, run }: { b: BenchState; run: BenchRun }) {
  const c = clientOf(b, run.client);
  const r = run.result;
  if (!r) return <p class="small muted">Run {run.no} is replaying the day…</p>;
  const day = c.days[run.day];
  const inDay = c.attacks.filter((a) => day.records.some((x) => x.attack === a.id));
  return (
    <div class="bench-detail">
      <p class="small">
        <strong>Run {run.no}</strong>: {METHOD_NAME[run.method]} on {day.label} ({runSettings(b, run)})
      </p>
      <ul class="bench-attacks">
        {inDay.map((a) => {
          const hit = r.caught.find((x) => x.attack === a.id);
          return (
            <li key={a.id} class={hit ? 'caught' : 'missed'}>
              <Icon name={hit ? 'check' : 'x'} />
              <span>
                {a.name}
                {a.novel && <span class="pill tiny muted">new</span>}
              </span>
              <span class="small">{hit ? `caught by ${hit.by} in ${duration(hit.detectMs)}` : 'missed'}</span>
            </li>
          );
        })}
      </ul>
      <p class="small bench-totals">
        <span>
          False alarms: <strong>{r.falseAlarms}</strong>
        </span>
        <span>
          Alerts in all: <strong>{r.alerts.length}</strong>
        </span>
        <span>
          Cost: <strong>{dollars(r.cost)}</strong> a month
        </span>
      </p>
    </div>
  );
}

/**
 * The detection bench: pick a client, a method, and settings; replay the
 * client's recorded day; read the score. The scoreboard keeps every run so
 * students can compare methods side by side.
 */
export function BenchCard({ session, spec }: ToolCardProps<'bench'>) {
  void session.simRev.value;
  const [pick, setPick] = useState(spec.clients[0]);
  const [shown, setShown] = useState<number | null>(null);
  const b = session.sim.devices[spec.device]?.bench;
  if (!b) return null;
  const cid = spec.clients.includes(pick) ? pick : spec.clients[0];
  const c = clientOf(b, cid);
  const set = b.settings[cid];
  const send = (a: { method?: BenchMethod; tolerance?: (typeof TOLERANCES_PCT)[number] }) => session.dispatch({ type: 'bench-set', device: spec.device, client: cid, ...a });
  const has = (k: (typeof spec.controls)[number]) => spec.controls.includes(k);
  const versions = b.config.versions;
  const dbAt = versions.findIndex((v) => v.id === b.db);
  const newer = versions[dbAt + 1];
  const busy = b.runs.some((r) => r.client === cid && !r.result);
  const needsBaseline = uses(set.method, 'anomaly') && !set.baseline;
  const runs = b.runs.filter((r) => r.client === cid);
  const detail = runs.find((r) => r.no === shown) ?? runs[runs.length - 1];
  const dayLabel = c.days[set.day].label;
  return (
    <div class="tool-card defend bench-card">
      <div class="tool-title">
        <Icon name="target" /> Detection bench: {c.name}
      </div>
      <div class="bench-cols">
        <div class="bench-settings">
          {spec.clients.length > 1 && (
            <div class="bench-row">
              <span class="small">Client:</span>
              <Seg label="Client" value={cid} opts={spec.clients.map((id) => [id, clientOf(b, id).name])} onPick={(v) => (setPick(v), setShown(null))} />
            </div>
          )}
          <div class="bench-row">
            <span class="small">Method:</span>
            {spec.methods.length > 1 ? (
              <Seg label="Method" value={set.method} opts={spec.methods.map((m) => [m, METHOD_NAME[m]])} onPick={(m) => send({ method: m })} />
            ) : (
              <strong>{METHOD_NAME[set.method]}</strong>
            )}
          </div>
          {uses(set.method, 'signature') && (
            <div class="bench-row">
              <span class="small">Signature database:</span>
              <span>
                <strong>{versions[dbAt].label}</strong> <span class="small muted">({dbSignatures(b.config, b.db).length} signatures)</span>
              </span>
              {has('db') && newer && (
                <button class="btn tiny" onClick={() => session.dispatch({ type: 'bench-db', device: spec.device, version: newer.id })}>
                  <Icon name="download" /> Install the {newer.label} update
                </button>
              )}
            </div>
          )}
          {uses(set.method, 'anomaly') && (
            <>
              <div class="bench-row">
                <span class="small">Baseline:</span>
                <strong>{set.baseline ? `recorded from ${c.days[set.baseline.day].label}` : 'none yet'}</strong>
              </div>
              {has('baseline') && (
                <div class="bench-row">
                  <span class="small">Record a baseline from:</span>
                  {c.baselineDays.map((d) => (
                    <button
                      key={d}
                      class={`btn tiny ${set.baseline?.day === d ? 'on' : ''}`}
                      onClick={() => session.dispatch({ type: 'bench-baseline', device: spec.device, client: cid, day: d })}
                    >
                      {c.days[d].label}
                    </button>
                  ))}
                </div>
              )}
              <div class="bench-row">
                <span class="small">Tolerance:</span>
                {has('tolerance') ? (
                  <Seg label="Tolerance" value={set.tolerance} opts={TOLERANCES_PCT.map((t) => [t, `±${t}%`])} onPick={(t) => send({ tolerance: t })} />
                ) : (
                  <strong>±{set.tolerance}%</strong>
                )}
              </div>
            </>
          )}
          <div class="bench-row">
            <span class="small">Cost on this network:</span>
            <strong>{dollars(c.cost[set.method])} a month</strong>
          </div>
          <div class="bench-row">
            <button class="btn primary" disabled={busy || needsBaseline} onClick={() => (session.dispatch({ type: 'bench-run', device: spec.device, client: cid }), setShown(null))}>
              <Icon name="play" /> Run {METHOD_NAME[set.method].toLowerCase()} on {dayLabel}
            </button>
            {busy && <span class="small muted bench-busy">Replaying {dayLabel}…</span>}
            {needsBaseline && !busy && <span class="small muted">Record a baseline first.</span>}
          </div>
        </div>
        <div class="bench-results">
          {spec.queue && <AnalystQueue key={lastRun(b, (r) => r.client === cid)?.no ?? 0} session={session} devId={spec.device} client={cid} />}
          {detail ? <RunDetail b={b} run={detail} /> : !spec.queue && <p class="small muted">No runs on {c.name} yet. Results show here.</p>}
          {runs.length > 1 && !spec.queue && (
            <table class="table bench-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Method</th>
                  <th>Settings</th>
                  <th>Caught</th>
                  <th>False alarms</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {[...runs].reverse().map((r) => {
                  const res = r.result;
                  const all = res ? res.caught.length + res.missed.length : 0;
                  return (
                    <tr key={r.no} class={r === detail ? 'selected' : ''} onClick={() => setShown(r.no)} title="Show this run">
                      <td>{r.no}</td>
                      <td>{METHOD_NAME[r.method]}</td>
                      <td class="small">
                        {runSettings(b, r)}
                        {r.day !== c.today && `; ${c.days[r.day].label}`}
                      </td>
                      <td>{res ? `${res.caught.length} of ${all}` : '…'}</td>
                      <td>{res ? res.falseAlarms : '…'}</td>
                      <td>{dollars(c.cost[r.method])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const QUEUE_TEXT: Record<QueueStatus, string> = { real: 'real attack', false: 'false alarm', closed: 'closed unread' };
const QUEUE_TONE: Record<QueueStatus, string> = { real: 'good', false: 'muted', closed: 'bad' };

/**
 * A tired analyst works through the newest run's alerts (bench.ts workQueue).
 * Each row opens its ALERT line, as the Logs tab does. Shown in the bench
 * card when its spec has `queue` (step "Alert fatigue").
 */
function AnalystQueue({ session, devId, client }: { session: ToolCardProps['session']; devId: string; client: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const sim = session.sim;
  const dev = sim.devices[devId];
  const b = dev.bench!;
  const c = clientOf(b, client);
  const run = lastRun(b, (r) => r.client === client);
  const name = (id: string) => b.config.names?.[id] ?? sim.devices[id]?.label ?? id;
  const pick = (a: BenchAlert, i: number) => {
    setOpen(open === i ? null : i);
    const entry = dev.logs.find((e) => e.no === a.logNo);
    if (entry) session.ui({ type: 'ui:open-log', device: dev.id, entry });
  };
  const r = run?.result;
  const q = r && queueCounts(r);
  return (
    <div class="bench-queue">
      <p class="small">
        <strong>Analyst queue.</strong> The analyst checks alerts in order, {MINUTES_PER_ALERT} minutes each. After {FATIGUE_AFTER} false alarms in a row, they stop
        looking and close the rest unread.
      </p>
      {!run || !r || !q ? (
        <p class="small muted">No finished run on {c.name} yet. Run the bench, and its alerts land here.</p>
      ) : (
        <>
          <p class="small">
            Run {run.no}: {r.alerts.length} alert{r.alerts.length === 1 ? '' : 's'}. Checked {q.checked}, with {q.falseMinutes} minutes spent on false alarms.
            {q.closed > 0 && (
              <>
                {' '}
                Closed <strong>{q.closed}</strong> unread
                {q.realClosed > 0 ? (
                  <>
                    , including <strong class="bad-ink">{q.realClosed === 1 ? 'a real attack' : `${q.realClosed} real attacks`}</strong>.
                  </>
                ) : (
                  '.'
                )}
              </>
            )}
          </p>
          {r.alerts.length > 0 && (
            <ol class="bench-alerts" aria-label={`Run ${run.no} alerts`}>
              {r.alerts.map((a, i) => (
                <li key={`${run.no}-${i}`} class={open === i ? 'open' : ''}>
                  <button class="bench-alert" onClick={() => pick(a, i)} aria-expanded={open === i}>
                    <span class="mono">{clock(a.at)}</span>
                    <span>{name(a.host)}</span>
                    <span class={`pill tiny ${QUEUE_TONE[a.queue ?? 'false']}`}>{QUEUE_TEXT[a.queue ?? 'false']}</span>
                  </button>
                  {open === i && (
                    <p class="small">
                      {a.by === 'signature' ? 'Signature' : 'Anomaly'}: {a.why}.
                      {a.attack ? ` This one was real: ${c.attacks.find((x) => x.id === a.attack)?.name}.` : ' Nothing was wrong.'}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** Recommend one method per client. The total has to fit the budget. */
export function BenchPlanCard({ session, spec }: ToolCardProps<'bench-plan'>) {
  void session.simRev.value;
  const b = session.sim.devices[spec.device]?.bench;
  if (!b) return null;
  const total = planCost(b);
  const done = b.config.clients.every((c) => b.plan[c.id]);
  const over = total > b.config.budget;
  return (
    <div class="tool-card defend bench-plan">
      <div class="tool-title">
        <Icon name="flag" /> Detection plan
      </div>
      <p class="tool-desc">Choose one method for each client. The total has to fit the monthly budget of {dollars(b.config.budget)}.</p>
      {b.config.clients.map((c) => (
        <div class="tool-row bench-plan-row" key={c.id}>
          <span>{c.name}</span>
          <Seg
            label={`Method for ${c.name}`}
            value={b.plan[c.id] ?? ''}
            opts={(['signature', 'anomaly', 'hybrid'] as BenchMethod[]).map((m) => [m, `${METHOD_NAME[m]} ${dollars(c.cost[m])}`])}
            onPick={(m) => session.dispatch({ type: 'bench-plan', device: spec.device, client: c.id, method: m as BenchMethod })}
          />
        </div>
      ))}
      <p class={`small bench-plan-total ${over ? 'bad-ink' : ''}`}>
        Total: <strong>{dollars(total)}</strong> of {dollars(b.config.budget)} a month
        {over ? '. Over budget.' : done ? '. Fits the budget.' : '.'}
      </p>
    </div>
  );
}
