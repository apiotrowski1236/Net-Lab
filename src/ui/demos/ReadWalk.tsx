import { useRef } from 'preact/hooks';
import { fromBits, placeValues } from '../../demos/binary';
import { readDone, readTerms, type ReadWalkState } from '../../demos/readWalk';
import type { ReadWalkSpec } from '../../demos/types';
import { Icon } from '../icons';
import { focusInto, placeName, type DemoViewProps } from './parts';

/** Binary to decimal, worked: tap each 1 and its place value joins the sum. */
export function ReadWalkView({ spec, state: s, send }: DemoViewProps<ReadWalkSpec, ReadWalkState>) {
  const bits = spec.examples[s.ex] ?? spec.examples[0];
  const pv = placeValues(bits.length);
  const done = readDone(spec, s);
  const terms = readTerms(spec, s);
  const more = s.ex < spec.examples.length - 1;
  const root = useRef<HTMLDivElement>(null);
  return (
    <div class="walk" ref={root}>
      <div class="walk-top">
        <span class="pill info">
          Example {s.ex + 1} of {spec.examples.length}
        </span>
        <span>
          Turn <code class="bits-code">{bits}</code> into decimal.
        </span>
      </div>
      <div class="pv-grid" style={{ '--n': bits.length }}>
        {pv.map((v) => (
          <div key={`h${v}`} class="pv-head">
            {v}
          </div>
        ))}
        {[...bits].map((c, i) => {
          const added = s.added.includes(i);
          return (
            <button
              key={`b${i}`}
              class={`pv-bit ${c === '1' ? 'one' : ''} ${added ? 'added' : ''} ${s.zero === i ? 'zero' : ''}`}
              aria-label={`${placeName(pv[i])} holds ${c}${added ? ', added' : ''}`}
              onClick={() => send({ tap: i })}
            >
              {c}
            </button>
          );
        })}
        {pv.map((v, i) => (
          <div key={`a${v}`} class="pv-add" aria-hidden="true">
            {s.added.includes(i) ? `+${v}` : ''}
          </div>
        ))}
      </div>
      <div class="walk-sum" aria-live="polite">
        {terms.length ? terms.join(' + ') : <span class="muted">Tap each box that holds a 1 to add its place value.</span>}
        {done && (
          <>
            {' '}
            = <strong>{fromBits(bits)}</strong>
          </>
        )}
      </div>
      {s.zero !== undefined && !done && (
        <p class="walk-note">
          {placeName(pv[s.zero]).replace(/^t/, 'T')} holds a 0, so it adds nothing. Tap the boxes that hold a 1.
        </p>
      )}
      {s.again !== undefined && !done && (
        <p class="walk-note">
          {placeName(pv[s.again]).replace(/^t/, 'T')} is already in the sum. Tap a 1 you haven't added yet.
        </p>
      )}
      {done && (
        <div class="callout good small walk-done">
          <span>
            <Icon name="check" size={14} /> <code>{bits}</code> is <strong>{fromBits(bits)}</strong> in decimal.
          </span>
          {more ? (
            <button
              class="btn primary small"
              onClick={() => {
                send({ next: true });
                focusInto(root.current, '.pv-bit');
              }}
            >
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
