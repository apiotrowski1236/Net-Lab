import { useEffect, useRef } from 'preact/hooks';
import { RULE_TEXT, settingsKey, WIDS_RULES } from '../../sim/wids';
import { Icon } from '../icons';
import { Toggle } from './parts';
import type { ToolCardProps } from './registry';

/** The noise levels the alarm can be set to fire above. */
export const NOISE_LEVELS = [10, 20, 40, 60, 80, 95];

/**
 * Wireless watch (watch-the-air): turn alarm rules on, pick the noise level
 * that sets off the noise alarm, and replay the access point's saved record
 * to see what the alarms would have caught. The alerts go to the Logs tab.
 * See src/sim/wids.ts.
 */
export function WidsCard({ session, spec }: ToolCardProps<'wids'>) {
  void session.simRev.value;
  const sim = session.sim;
  const d = sim.devices[spec.device];
  const w = d?.wids;
  // After a replay, bring the score into view: on a short screen it lands below the fold.
  const score = useRef<HTMLDivElement>(null);
  const runs = useRef(w?.replays.length ?? 0);
  const count = w?.replays.length ?? 0;
  useEffect(() => {
    if (count > runs.current) score.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    runs.current = count;
  }, [count]);
  if (!w) return null;
  const last = w.replays[w.replays.length - 1];
  const stale = last && last.settings !== settingsKey(w);
  const days = Math.max(0, ...w.record.map((r) => r.day));
  const set = (a: Parameters<typeof session.dispatch>[0]) => session.dispatch(a);

  return (
    <div class="tool-card defend wids-card">
      <div class="tool-title">
        <Icon name="flag" /> Wireless alarms on {d.label}
      </div>
      <p class="tool-desc">Choose what raises an alarm. Then replay the last {days} days to test your choices. Each alarm becomes an alert line in the Logs tab.</p>
      <div class="wids-rules">
        {WIDS_RULES.map((r) => (
          <Toggle key={r} on={w.rules[r]} label={RULE_TEXT[r]} onChange={(on) => set({ type: 'wids-rule', device: d.id, rule: r, on })} />
        ))}
      </div>
      <div class="wids-threshold">
        <span class="small" id="wids-level">
          Noise alarm level, 0 to 100 (quiet is about 5)
        </span>
        <div class="seg" role="group" aria-labelledby="wids-level">
          {NOISE_LEVELS.map((n) => (
            <button key={n} class={`btn tiny ${w.noiseThreshold === n ? 'on' : ''}`} aria-pressed={w.noiseThreshold === n} onClick={() => set({ type: 'wids-threshold', device: d.id, level: n })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <button class="btn" onClick={() => set({ type: 'wids-replay', device: d.id })}>
        <Icon name="replay" /> Replay the last {days} days
      </button>
      {last && (
        <div class="wids-score" role="status" ref={score}>
          {stale && <p class="small muted">You changed the alarms since this replay. Replay again to test the new settings.</p>}
          <table class="table kv">
            <tbody>
              <tr>
                <td>Attacks caught</td>
                <td>
                  {last.caught.length} of {last.caught.length + last.missed.length}
                </td>
              </tr>
              <tr>
                <td>Attacks missed</td>
                <td class={last.missed.length ? 'bad' : ''}>{last.missed.length ? last.missed.join(', ') : 'none'}</td>
              </tr>
              <tr>
                <td>False alarms</td>
                <td class={last.falseAlarms.length ? 'warn' : ''}>{last.falseAlarms.length ? last.falseAlarms.join(', ') : 'none'}</td>
              </tr>
              <tr>
                <td>Alert lines</td>
                <td>{last.alerts.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
