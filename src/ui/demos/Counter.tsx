import { useRef } from 'preact/hooks';
import { digitsOf } from '../../demos/binary';
import { counterMax, type CounterState } from '../../demos/counter';
import type { CounterSpec } from '../../demos/types';
import type { DemoViewProps } from './parts';

/**
 * An odometer (base 10) or a binary counter (base 2) with a fixed number of digits.
 * Each +1 rolls the wheels that change, like a car's odometer: the old digit
 * rolls up and off the top as the new one comes in from below, so at 999 all
 * three 9s roll off together.
 */
export function CounterView({ spec, state: s, send }: DemoViewProps<CounterSpec, CounterState>) {
  const max = counterMax(spec);
  const digits = digitsOf(s.value, spec.base, spec.digits);
  const top = (max - 1).toString(spec.base);
  const shown = digits.join('');
  const unit = spec.base === 2 ? 'bits' : 'digits';
  const lost = (spec.base ** spec.digits).toLocaleString('en-US', { useGrouping: false });

  // What the counter showed before this value, kept across re-renders that don't change it.
  // Only a +1 rolls; "Start over" and a reload jump straight to the number.
  const roll = useRef({ value: s.value, from: -1, n: 0 });
  if (roll.current.value !== s.value) roll.current = { value: s.value, from: roll.current.value, n: roll.current.n + 1 };
  const { from, n } = roll.current;
  const counting = from >= 0 && s.value === (from + 1) % max;
  const before = counting ? digitsOf(from, spec.base, spec.digits) : digits;

  return (
    <div class={`ctr ${spec.base === 10 ? 'odo' : 'bin'}`}>
      <div class="ctr-line">
        <div class={`ctr-display ${s.carried ? 'carried' : ''}`} role="img" aria-label={`${spec.base === 2 ? 'Counter' : 'Odometer'} shows ${shown}`}>
          {s.carried && (
            <span key={`c${n}`} class="ctr-carry" aria-hidden="true">
              1
            </span>
          )}
          {digits.map((d, i) =>
            before[i] !== d ? (
              <span key={`r${i}-${n}`} class="ctr-digit">
                <span class="ctr-reel roll">
                  <span>{before[i]}</span>
                  <span>{d}</span>
                </span>
              </span>
            ) : (
              <span key={`s${i}`} class="ctr-digit">
                <span class="ctr-reel">
                  <span>{d}</span>
                </span>
              </span>
            ),
          )}
        </div>
        <button class="btn primary big" onClick={() => send({ add: 1 })}>
          +1
        </button>
      </div>
      {spec.base === 2 && (
        <div class="ctr-sub">
          In decimal: <strong>{s.value}</strong>
        </div>
      )}
      <div aria-live="polite">
        {s.carried ? (
          <div class="callout warn small">
            <strong>Overflow!</strong> {top} + 1 = 1{'0'.repeat(spec.digits)}, which needs {spec.digits + 1} {unit}. We only have space for {spec.digits} {unit} on the display, so the {lost}s place is
            lost and the display rolls over back to 0.
          </div>
        ) : (
          s.overflows > 0 && <p class="muted small">It rolled over {s.overflows === 1 ? 'once' : `${s.overflows} times`}. Keep counting if you like.</p>
        )}
      </div>
    </div>
  );
}
