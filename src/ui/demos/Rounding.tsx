import { thirds, type RoundingState } from '../../demos/rounding';
import type { RoundingSpec } from '../../demos/types';
import type { DemoViewProps } from './parts';

/** 1 ÷ 3 kept to a few digits, then times 3: it never comes back to exactly 1. */
export function RoundingView({ spec, state: s, send }: DemoViewProps<RoundingSpec, RoundingState>) {
  const t = thirds(s.digits);
  return (
    <div class="round">
      <div class="demo-row">
        <span class="demo-label" id={`${spec.id}-digits`}>
          Digits kept
        </span>
        <div class="seg" role="group" aria-labelledby={`${spec.id}-digits`}>
          {spec.digits.map((d) => (
            <button key={d} class={d === s.digits ? 'on' : ''} aria-pressed={d === s.digits} onClick={() => send({ digits: d })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <table class="demo-table kv" aria-live="polite">
        <tbody>
          <tr>
            <th>1 ÷ 3</th>
            <td>
              <code>0.3333333333…</code> <span class="muted small">(the 3s never end)</span>
            </td>
          </tr>
          <tr>
            <th>Stored</th>
            <td>
              <code>{t.stored}</code>
            </td>
          </tr>
          <tr>
            <th>Stored × 3</th>
            <td>
              <code>{t.times3}</code> <span class="muted small">(should be 1)</span>
            </td>
          </tr>
          <tr>
            <th>Stored × 3 is off by</th>
            <td>
              <code>{t.off}</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="small">
        {s.tried.length > 1 ? 'More digits make the error smaller, but it never goes away.' : 'Keep more digits. Does the error go away?'}
      </p>
    </div>
  );
}
