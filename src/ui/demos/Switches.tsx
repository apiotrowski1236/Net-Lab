import { foundWith, maxSwitches, type SwitchesState } from '../../demos/switches';
import type { SwitchesSpec } from '../../demos/types';
import { Bulb, plural, type DemoViewProps } from './parts';

const words = (p: string) => [...p].map((c) => (c === '1' ? 'on' : 'off')).join(', ');

/** Light switches: pick how many, flip them, and see each new pattern listed. */
export function SwitchesView({ spec, state: s, send }: DemoViewProps<SwitchesSpec, SwitchesState>) {
  const max = maxSwitches(spec);
  const found = s.seen[s.n] ?? [];
  const total = 2 ** s.n;
  const complete = found.length === total;
  const counts = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div class="sw-demo">
      <div class="demo-row">
        <span class="demo-label" id={`${spec.id}-count`}>
          Switches
        </span>
        <div class="seg" role="group" aria-labelledby={`${spec.id}-count`}>
          {counts.map((k) => (
            <button key={k} class={k === s.n ? 'on' : ''} aria-pressed={k === s.n} onClick={() => send({ use: k })}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div class="sw-row">
        {s.on.map((on, i) => (
          <button key={i} class={`sw ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={`Switch ${i + 1}`} onClick={() => send({ flip: i })}>
            <Bulb on={on} size={44} />
            <span class="sw-toggle" aria-hidden="true">
              <span class="sw-knob" />
            </span>
            <span class="sw-state">{on ? 'On' : 'Off'}</span>
          </button>
        ))}
      </div>

      <div class="sw-found" aria-live="polite">
        <div class="sw-found-head">
          <strong>
            Patterns found with {plural(s.n, 'switch', 'switches')}: {found.length}
          </strong>
          {complete && <span class="pill good">That's all of them</span>}
        </div>
        <ul class="sw-patterns" aria-label="Patterns found">
          {found.map((p) => (
            <li key={p} class="sw-pattern" aria-label={words(p)} title={words(p)}>
              {[...p].map((c, i) => (
                <span key={i} class={`pdot ${c === '1' ? 'on' : ''}`} />
              ))}
            </li>
          ))}
        </ul>
        {!complete && <p class="muted small">Keep flipping. Is there a pattern you haven't made yet?</p>}
      </div>

      <table class="demo-table" aria-label="Your count so far">
        <thead>
          <tr>
            <th>Switches</th>
            <th>Patterns</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((k) => {
            const n = foundWith(s, k);
            const done = n === 2 ** k;
            return (
              <tr key={k} class={k === s.n ? 'cur' : ''}>
                <td>{k}</td>
                <td>{done ? <strong>{n}</strong> : <span class="muted">{n ? `${n} so far` : 'not tried yet'}</span>}</td>
              </tr>
            );
          })}
          <tr>
            <td>{max + 1}</td>
            <td class="muted">Predict it</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
