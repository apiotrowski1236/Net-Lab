import { placeValues } from '../../demos/binary';
import { fitDone, fitLeft, fitPlaces, type FitWalkState } from '../../demos/fitWalk';
import type { FitWalkSpec } from '../../demos/types';
import { Icon } from '../icons';
import { placeName, type DemoViewProps } from './parts';

/** Decimal to binary with "does it fit?": one place at a time, from the left. */
export function FitWalkView({ spec, state: s, send }: DemoViewProps<FitWalkSpec, FitWalkState>) {
  const places = fitPlaces(spec);
  const pv = placeValues(places);
  const n = spec.examples[s.ex] ?? spec.examples[0];
  const done = fitDone(spec, s);
  const col = s.bits.length;
  const left = fitLeft(spec, s);
  const more = s.ex < spec.examples.length - 1;
  // What was left before each place, for the worked lines.
  const trail: { v: number; before: number; bit: string }[] = [];
  let rest = n;
  for (let i = 0; i < s.bits.length; i++) {
    trail.push({ v: pv[i], before: rest, bit: s.bits[i] });
    if (s.bits[i] === '1') rest -= pv[i];
  }
  const miss = s.miss && s.miss.col === col ? s.miss : undefined;
  return (
    <div class="walk">
      <div class="walk-top">
        <span class="pill info">
          Example {s.ex + 1} of {spec.examples.length}
        </span>
        <span>
          Turn <strong>{n}</strong> into {places}-bit binary.
        </span>
      </div>
      <div class="pv-grid" style={{ '--n': places }}>
        {pv.map((v) => (
          <div key={`h${v}`} class="pv-head">
            {v}
          </div>
        ))}
        {pv.map((v, i) => (
          <div key={`b${v}`} class={`pv-bit static ${s.bits[i] === '1' ? 'one' : ''} ${i === col && !done ? 'current' : ''}`} aria-hidden="true">
            {i < col ? s.bits[i] : i === col && !done ? '?' : ''}
          </div>
        ))}
      </div>

      {!done && (
        <div class="fit-ask">
          <p aria-live="polite">
            Left to place: <strong>{left}</strong>. Does <strong>{pv[col]}</strong> fit in {left}?
          </p>
          <div class="row gap-sm">
            <button class="btn" onClick={() => send({ say: 1 })}>
              Fits: write 1
            </button>
            <button class="btn" onClick={() => send({ say: 0 })}>
              Too big: write 0
            </button>
          </div>
          {miss && (
            <p class="walk-note bad" role="status">
              {miss.said === 1
                ? `${pv[col]} is bigger than ${left}, so it doesn't fit. Write 0 in ${placeName(pv[col])}.`
                : `${pv[col]} is not bigger than ${left}, so it fits. Write 1 and subtract it.`}
            </p>
          )}
        </div>
      )}

      {trail.length > 0 && (
        <ol class="fit-trail" aria-label="Your work so far">
          {trail.map((t) => (
            <li key={t.v} class={t.bit === '1' ? 'one' : ''}>
              {t.bit === '1' ? (
                <>
                  {t.v} fits in {t.before}: write <b>1</b>. {t.before} − {t.v} = {t.before - t.v}.
                </>
              ) : (
                <>
                  {t.v} is bigger than {t.before}: write <b>0</b>.
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {done && (
        <div class="callout good small walk-done">
          <span>
            <Icon name="check" size={14} /> {n} is <code>{s.bits}</code> in binary. Nothing is left over.
          </span>
          {more ? (
            <button class="btn primary small" onClick={() => send({ next: true })}>
              Next example <Icon name="chevronRight" size={14} />
            </button>
          ) : (
            <span>That was the last example.</span>
          )}
        </div>
      )}
    </div>
  );
}
