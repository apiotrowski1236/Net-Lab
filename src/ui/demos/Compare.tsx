import { firstDifference, fromBits, placeValues } from '../../demos/binary';
import { comparePair, type CompareState } from '../../demos/compare';
import type { CompareSpec } from '../../demos/types';
import { Icon } from '../icons';
import { placeName, type DemoViewProps } from './parts';

/** Compare two binary numbers: line them up, find the first place they differ, say which is bigger. */
export function CompareView({ spec, state: s, send }: DemoViewProps<CompareSpec, CompareState>) {
  const [a, b] = comparePair(spec, s);
  const width = Math.max(a.length, b.length);
  const pv = placeValues(width);
  const first = s.padded ? firstDifference(a, b) : -1;
  const more = s.pair < spec.pairs.length - 1;
  const note = s.note;
  const big = fromBits(a) > fromBits(b) ? a : b;
  const small = big === a ? b : a;
  return (
    <div class="cmp">
      <div class="walk-top">
        <span class="pill info">
          Pair {s.pair + 1} of {spec.pairs.length}
        </span>
        <span>{s.found ? 'Which one is bigger?' : 'Tap the first place, from the left, where the two numbers differ.'}</span>
      </div>

      <p class="cmp-nums">
        <span>
          Top: <code class="bits-code">{a}</code>
        </span>
        <span>
          Bottom: <code class="bits-code">{b}</code>
        </span>
      </p>

      {!s.padded && (
        <div class="callout warn small cmp-pad">
          <span>
            These numbers have different lengths, so their places don't line up. {a} has {a.length} bits and {b} has {b.length}.
          </span>
          <button class="btn small" onClick={() => send({ pad: true })}>
            Line them up
          </button>
        </div>
      )}

      <div class={`cmp-grid ${s.padded ? '' : 'ragged'}`} style={{ '--n': width }}>
        {Array.from({ length: width }, (_, i) => {
          const hit = s.found && i === first;
          return (
            <button
              key={i}
              class={`cmp-col ${hit ? 'hit' : ''} ${note && 'col' in note && note.col === i ? 'tried' : ''}`}
              aria-label={s.padded ? `${placeName(pv[i])}: ${a[i]} and ${b[i]}` : `Digit ${i + 1}: ${a[i] ?? 'none'} and ${b[i] ?? 'none'}`}
              onClick={() => send({ tap: i })}
            >
              <span class="cmp-head">{s.padded ? pv[i] : ''}</span>
              <span class={`cmp-digit ${a[i] === '1' ? 'one' : ''}`}>{a[i] ?? ''}</span>
              <span class={`cmp-digit ${b[i] === '1' ? 'one' : ''}`}>{b[i] ?? ''}</span>
            </button>
          );
        })}
      </div>

      {note && (
        <p class={`walk-note ${note.kind === 'wrong-pick' ? 'bad' : ''}`} role="status">
          {note.kind === 'unpadded' && 'Line them up first. Comparing from the left only works when the places match.'}
          {note.kind === 'same' && `Both have ${a[note.col]} in ${placeName(pv[note.col])}. Keep looking to the right.`}
          {note.kind === 'later' && `They differ here, but they already differ further left. The leftmost difference decides.`}
          {note.kind === 'wrong-pick' &&
            `${note.pick === 0 ? a : b} has a 0 in ${placeName(pv[first])}, and the other has a 1. That 1 is worth more than all the places to its right put together.`}
        </p>
      )}

      {s.found && !s.done && (
        <div class="row gap-sm cmp-pick">
          <button class="btn" onClick={() => send({ pick: 0 })}>
            <code>{a}</code> is bigger
          </button>
          <button class="btn" onClick={() => send({ pick: 1 })}>
            <code>{b}</code> is bigger
          </button>
        </div>
      )}

      {s.done && (
        <div class="callout good small walk-done">
          <span>
            <Icon name="check" size={14} /> <code>{big}</code> is bigger. Check: {fromBits(big)} is more than {fromBits(small)}.
          </span>
          {more ? (
            <button class="btn primary small" onClick={() => send({ next: true })}>
              Next pair <Icon name="chevronRight" size={14} />
            </button>
          ) : (
            <span>That was the last pair.</span>
          )}
        </div>
      )}
    </div>
  );
}
