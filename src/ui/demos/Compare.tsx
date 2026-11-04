import { useRef } from 'preact/hooks';
import { firstDifference, fromBits, placeValues } from '../../demos/binary';
import { comparePair, type CompareState } from '../../demos/compare';
import type { CompareSpec } from '../../demos/types';
import { Icon } from '../icons';
import { focusInto, keepFocus, placeName, type DemoViewProps } from './parts';

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
  const root = useRef<HTMLDivElement>(null);
  // A right pick removes the pick buttons: keep keyboard focus in the card.
  const pick = (i: 0 | 1) => {
    send({ pick: i });
    keepFocus(root.current, '.walk-done .btn', '.cmp-col.hit');
  };

  // The pair as given, before any 0s: which row is shorter, and by how much.
  const [oa, ob] = spec.pairs[s.pair];
  const shortRow: 0 | 1 | -1 = oa.length === ob.length ? -1 : oa.length < ob.length ? 0 : 1;
  const short = shortRow === 0 ? oa : ob;
  const added = shortRow === -1 ? 0 : width - short.length;
  const padded = s.padded && added > 0;

  // Animate only when the student presses Line them up, not on a reload or a new pair.
  const prev = useRef({ pair: s.pair, padded: s.padded });
  const anim = useRef(false);
  if (prev.current.pair !== s.pair) anim.current = false;
  else if (!prev.current.padded && s.padded) anim.current = true;
  prev.current = { pair: s.pair, padded: s.padded };

  /** One digit of row `row` in column `i`, with the classes for the added 0s and the digits that slid over. */
  const digit = (row: 0 | 1, i: number) => {
    const d = (row === 0 ? a : b)[i];
    let cls = `cmp-digit ${d === '1' ? 'one' : ''}`;
    let style: Record<string, number> | undefined;
    if (padded && row === shortRow) {
      if (i < added) cls += ' added';
      if (anim.current && i < added) {
        cls += ' drop';
        style = { '--d': i };
      } else if (anim.current) {
        cls += ' slide';
        style = { '--shift': added };
      }
    }
    return (
      <span class={cls} style={style}>
        {d ?? ''}
      </span>
    );
  };

  return (
    <div class="cmp" ref={root}>
      <div class="walk-top">
        <span class="pill info">
          Pair {s.pair + 1} of {spec.pairs.length}
        </span>
        <span>{s.found ? 'Which one is bigger?' : 'Tap the first place, from the left, where the two numbers are different.'}</span>
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
          <button
            class="btn small"
            onClick={() => {
              send({ pad: true });
              keepFocus(root.current, '.cmp-col');
            }}
          >
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
              <span class={`cmp-head ${anim.current ? 'appear' : ''}`}>{s.padded ? pv[i] : ''}</span>
              {digit(0, i)}
              {digit(1, i)}
            </button>
          );
        })}
      </div>

      {padded && (
        <p class={`cmp-padded ${anim.current ? 'appear' : ''}`} style={{ '--d': added }} role="status">
          <code>{short}</code> became <code>{shortRow === 0 ? a : b}</code>. {added === 1 ? 'A 0 in front adds' : '0s in front add'} nothing, so it's still {fromBits(short)}. Now
          the places line up.
        </p>
      )}

      {note && (
        <p class={`walk-note ${note.kind === 'wrong-pick' ? 'bad' : ''}`} role="status">
          {note.kind === 'unpadded' && 'Line them up first. Comparing from the left only works when the places match.'}
          {note.kind === 'same' && `Both have ${a[note.col]} in ${placeName(pv[note.col])}. Keep looking to the right.`}
          {note.kind === 'later' && `They are different here, but they are already different further left. The leftmost difference decides.`}
          {note.kind === 'wrong-pick' &&
            `${note.pick === 0 ? a : b} has a 0 in ${placeName(pv[first])}, and the other has a 1. That 1 is worth more than all the places to its right put together.`}
        </p>
      )}

      {s.found && !s.done && (
        <div class="row gap-sm cmp-pick">
          <button class="btn" aria-label={`${a} is bigger`} onClick={() => pick(0)}>
            <code>{a}</code> is bigger
          </button>
          <button class="btn" aria-label={`${b} is bigger`} onClick={() => pick(1)}>
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
            <button
              class="btn primary small"
              onClick={() => {
                send({ next: true });
                focusInto(root.current, '.cmp-pad .btn, .cmp-col');
              }}
            >
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
