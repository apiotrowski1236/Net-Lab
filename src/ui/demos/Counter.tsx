import { digitsOf } from '../../demos/binary';
import { counterMax, type CounterState } from '../../demos/counter';
import type { CounterSpec } from '../../demos/types';
import type { DemoViewProps } from './parts';

/** An odometer (base 10) or a binary counter (base 2) with a fixed number of digits. */
export function CounterView({ spec, state: s, send }: DemoViewProps<CounterSpec, CounterState>) {
  const digits = digitsOf(s.value, spec.base, spec.digits);
  const top = (counterMax(spec) - 1).toString(spec.base);
  const shown = digits.join('');
  const unit = spec.base === 2 ? 'bits' : 'digits';
  return (
    <div class={`ctr ${spec.base === 10 ? 'odo' : 'bin'}`}>
      <div class="ctr-line">
        <div class={`ctr-display ${s.carried ? 'carried' : ''}`} role="img" aria-label={`${spec.base === 2 ? 'Counter' : 'Odometer'} shows ${shown}`}>
          {s.carried && (
            <span class="ctr-carry" aria-hidden="true">
              1
            </span>
          )}
          {digits.map((d, i) => (
            <span key={i} class="ctr-digit">
              {d}
            </span>
          ))}
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
            <strong>Overflow!</strong> {top} + 1 = 1{'0'.repeat(spec.digits)}, which needs {spec.digits + 1} {unit}. There are only {spec.digits}, so the 1 on the left is lost and it shows{' '}
            <code>{shown}</code>.
          </div>
        ) : (
          s.overflows > 0 && <p class="muted small">It rolled over {s.overflows === 1 ? 'once' : `${s.overflows} times`}. Keep counting if you like.</p>
        )}
      </div>
    </div>
  );
}
