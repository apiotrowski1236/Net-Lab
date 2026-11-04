import { placesValue, placeValuesIn, type PlacesState } from '../../demos/places';
import type { PlacesSpec } from '../../demos/types';
import type { DemoViewProps } from './parts';

/**
 * A number laid out by place value, read top to bottom: each place's value
 * (with "×10" or "×2" arcs showing how each place grows from the one to its
 * right), the digit in it, and what it adds to the total. Base 10 digits have
 * up and down arrows; base 2 bits flip with a tap.
 */
export function PlacesView({ spec, state: s, send }: DemoViewProps<PlacesSpec, PlacesState>) {
  const n = s.digits.length;
  const pv = placeValuesIn(spec.base, n);
  const total = placesValue(spec, s.digits);
  const two = spec.base === 2;
  const sum = s.digits.map((d, i) => `${d} × ${pv[i]}`).join(' + ');

  return (
    <div class={`pl base${spec.base}`} style={{ '--n': n }}>
      <div class="pl-grid">
        {pv.map((v, i) => (
          <div key={`h${i}`} class="pl-head">
            {i > 0 && (
              <span class="pl-arc" aria-hidden="true">
                <span class="pl-arc-label">×{spec.base}</span>
              </span>
            )}
            <span class="pl-place">{v}</span>
          </div>
        ))}
        <div class="pl-head pl-total-head">Total</div>

        {s.digits.map((d, i) =>
          two ? (
            <div key={`d${i}`} class="pl-cell">
              <button class={`pl-tile ${d ? 'on' : 'off'}`} aria-pressed={d === 1} aria-label={`The ${pv[i]}s place: ${d}`} onClick={() => send({ flip: i })}>
                {d}
              </button>
            </div>
          ) : (
            <div key={`d${i}`} class="pl-cell pl-spin">
              <button class="pl-step" aria-label={`Raise the ${pv[i]}s digit`} onClick={() => send({ bump: i, by: 1 })}>
                <Chevron up />
              </button>
              <span class={`pl-tile ${d ? 'on' : 'off'}`} aria-label={`The ${pv[i]}s place: ${d}`}>
                {d}
              </span>
              <button class="pl-step" aria-label={`Lower the ${pv[i]}s digit`} onClick={() => send({ bump: i, by: -1 })}>
                <Chevron />
              </button>
            </div>
          ),
        )}
        <div class="pl-cell" aria-hidden="true" />

        {s.digits.map((d, i) => (
          <div key={`p${i}`} class={`pl-part ${d ? 'on' : 'off'}`} aria-hidden="true">
            {i > 0 && <span class="pl-op">+</span>}
            <span class="pl-times">
              {d} × {pv[i]}
            </span>
            <span class="pl-product">{d * pv[i]}</span>
          </div>
        ))}
        <div class="pl-part pl-total" aria-hidden="true">
          <span class="pl-op">=</span>
          <span class="pl-total-box">{total}</span>
        </div>
      </div>
      <p class="visually-hidden" aria-live="polite">
        {two ? 'Binary' : 'Decimal'} {s.digits.join('')} = {sum} = {total}
      </p>
    </div>
  );
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <path d={up ? 'M3.5 10 L8 5.5 L12.5 10' : 'M3.5 6 L8 10.5 L12.5 6'} fill="none" stroke="currentColor" stroke-width={2.2} stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
