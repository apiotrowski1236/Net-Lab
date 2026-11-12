import { average, colorName, picture, PIXEL_BYTES, rawBytes, sameColor, shrink, square, stretch, changedPixels, type RGB } from '../../demos/pictures';
import { squaresAcross, squareWalkTotal, WALK_SQUARE as K, type SquareWalkState } from '../../demos/squareWalk';
import type { SquareWalkSpec } from '../../demos/types';
import { Icon } from '../icons';
import { cellsOf, Fig, n, PixelGrid, SizeBars, Swatch, WalkControls, type Cell } from './pictureParts';
import type { DemoViewProps } from './parts';

const CH = ['Red', 'Green', 'Blue'] as const;

/** "3 yellow and 1 black", or "all yellow". */
function mixOf(colors: RGB[]): string {
  const counts: { c: RGB; n: number }[] = [];
  for (const c of colors) {
    const hit = counts.find((x) => sameColor(x.c, c));
    if (hit) hit.n++;
    else counts.push({ c, n: 1 });
  }
  if (counts.length === 1) return `all ${colorName(counts[0].c)}`;
  counts.sort((a, b) => b.n - a.n);
  const parts = counts.map((x) => `${x.n} ${colorName(x.c)}`);
  return parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** The four pixels of a square, their totals, and the average, channel by channel. */
function SquareMath({ colors }: { colors: RGB[] }) {
  const sums = [0, 1, 2].map((k) => colors.reduce((t, c) => t + c[k], 0));
  const avg = average(colors);
  const rounded = sums.findIndex((t) => t % colors.length !== 0);
  return (
    <div class="sq-math">
      <table class="demo-table sq-math-table">
        <thead>
          <tr>
            <th>Pixel</th>
            {CH.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {colors.map((c, i) => (
            <tr key={i}>
              <th>
                <Swatch c={c} /> {colorName(c)}
              </th>
              {c.map((v, k) => (
                <td key={k}>{v}</td>
              ))}
            </tr>
          ))}
          <tr class="sum">
            <th>Total</th>
            {sums.map((v, k) => (
              <td key={k}>{v}</td>
            ))}
          </tr>
          <tr class="avg">
            <th>
              <Swatch c={avg} /> ÷ {colors.length} = average
            </th>
            {avg.map((v, k) => (
              <td key={k}>
                <b>{v}</b>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {rounded >= 0 && (
        <p class="small muted">
          {CH[rounded]}: {sums[rounded]} ÷ {colors.length} = {sums[rounded] / colors.length}. A byte holds a whole number, so it's rounded to {avg[rounded]}.
        </p>
      )}
    </div>
  );
}

/**
 * Averaging 2×2 squares, one step at a time. 'encode': each Step averages one
 * square of the original into one stored pixel. 'decode': each Step stretches
 * one stored pixel back into a square, and the end counts the pixels that
 * changed.
 */
export function SquareWalkView(props: DemoViewProps<SquareWalkSpec, SquareWalkState>) {
  return props.spec.mode === 'encode' ? <Encode {...props} /> : <Decode {...props} />;
}

function Encode({ spec, state: s, send }: DemoViewProps<SquareWalkSpec, SquareWalkState>) {
  const p = picture(spec.picture);
  const small = shrink(p, K);
  const total = squareWalkTotal(spec);
  const across = squaresAcross(spec);
  const done = s.pos === total;
  const last = s.pos - 1;
  const bx = last % across;
  const by = Math.floor(last / across);
  const colors = s.pos > 0 ? square(p, K, bx, by) : [];
  const stored: Cell[] = small.px.map((c, i) => (i < s.pos ? { color: c, pop: i === last && !done ? 0 : undefined } : { color: null }));
  const same = colors.length > 0 && colors.every((c) => sameColor(c, colors[0]));
  return (
    <div class="walk-pix">
      <div class="walk-figs">
        <Fig title="Original">
          <PixelGrid w={p.w} h={p.h} cells={cellsOf(p)} squares={K} label="The original picture, in 2×2 squares" ring={s.pos > 0 && !done ? { x: bx * K, y: by * K, size: K } : undefined} />
        </Fig>
        {s.pos > 0 && !done && <SquareMath colors={colors} />}
        <Fig title="Stored picture">
          <PixelGrid w={small.w} h={small.h} cells={stored} label="The stored picture so far" ring={s.pos > 0 && !done ? { x: bx, y: by } : undefined} />
        </Fig>
      </div>
      {!done && (
        <p class="walk-note" aria-live="polite">
          {s.pos === 0 ? (
            <>
              Press <strong>Step</strong> to average the first square.
            </>
          ) : same ? (
            <>
              Square {s.pos} of {total} is {mixOf(colors)}, so its average is the same {colorName(colors[0])}. Nothing is lost in this square.
            </>
          ) : (
            <>
              Square {s.pos} of {total} has {mixOf(colors)}. Their average is a new color that wasn't in the picture. The 4 colors are thrown away, and only the average is stored.
            </>
          )}
        </p>
      )}
      <SizeBars
        rows={[
          {
            label: (
              <>
                Original: {p.w * p.h} pixels × {PIXEL_BYTES} bytes = <b>{n(rawBytes(p))} bytes</b>
              </>
            ),
            bytes: rawBytes(p),
            tone: 'base',
          },
          {
            label: (
              <>
                Stored: {s.pos} pixels × {PIXEL_BYTES} bytes = <b>{n(s.pos * PIXEL_BYTES)} bytes</b>
              </>
            ),
            bytes: s.pos * PIXEL_BYTES,
            tone: 'good',
          },
        ]}
      />
      {done ? (
        <div class="callout good small walk-done">
          <span>
            <Icon name="check" size={14} /> The stored picture has {total} pixels, one for each square. That's {total} × {PIXEL_BYTES} = <b>{n(total * PIXEL_BYTES)} bytes</b>, down from {n(rawBytes(p))}.
          </span>
        </div>
      ) : (
        <WalkControls pos={s.pos} total={total} canSkip={s.pos >= across} ms={1400} unit="Square" send={send} />
      )}
    </div>
  );
}

function Decode({ spec, state: s, send }: DemoViewProps<SquareWalkSpec, SquareWalkState>) {
  const p = picture(spec.picture);
  const small = shrink(p, K);
  const big = stretch(small, K);
  const total = squareWalkTotal(spec);
  const across = squaresAcross(spec);
  const done = s.pos === total;
  const last = s.pos - 1;
  const bx = last % across;
  const by = Math.floor(last / across);
  const changed = changedPixels(p, big);
  const rebuilt: Cell[] = big.px.map((c, i) => {
    const x = i % p.w;
    const y = Math.floor(i / p.w);
    const sq = Math.floor(y / K) * across + Math.floor(x / K);
    if (sq >= s.pos) return { color: null };
    return { color: c, pop: sq === last && !done ? ((y % K) * K + (x % K)) * 60 : undefined, mark: done && s.changes && !sameColor(c, p.px[i]) };
  });
  const orig = s.pos > 0 ? square(p, K, bx, by) : [];
  const kept = orig.filter((c) => sameColor(c, small.px[last])).length;
  return (
    <div class="walk-pix">
      <div class="walk-figs">
        <Fig title="Stored picture">
          <PixelGrid w={small.w} h={small.h} cells={cellsOf(small)} label="The stored picture" ring={s.pos > 0 && !done ? { x: bx, y: by } : undefined} />
        </Fig>
        <Fig title="Rebuilt">
          <PixelGrid w={p.w} h={p.h} cells={rebuilt} squares={K} label="The picture rebuilt so far" ring={s.pos > 0 && !done ? { x: bx * K, y: by * K, size: K } : undefined} />
        </Fig>
        <Fig title="Original">
          <PixelGrid w={p.w} h={p.h} cells={cellsOf(p, (i) => ({ mark: done && s.changes && !sameColor(p.px[i], big.px[i]) }))} squares={K} label="The original picture" />
        </Fig>
      </div>
      {!done && (
        <p class="walk-note" aria-live="polite">
          {s.pos === 0 ? (
            <>
              Press <strong>Step</strong> to stretch the first stored pixel back into a square.
            </>
          ) : (
            <>
              Stored pixel {s.pos} of {total} becomes a 2×2 square of its color.{' '}
              {kept === K * K ? 'This square was all one color, so all 4 pixels come back exactly.' : kept === 0 ? `None of the 4 pixels comes back as it was. The original had ${mixOf(orig)}.` : `Only ${kept} of the 4 pixels ${kept === 1 ? 'comes back as it was' : 'come back as they were'}. The original had ${mixOf(orig)}.`}
            </>
          )}
        </p>
      )}
      {done ? (
        <div class="callout warn small walk-done" role="status">
          <span>
            The picture is rebuilt. Compare it with the original: <b>{changed} of the {p.w * p.h} pixels changed.</b> The stored picture kept one average for each square, not the 4 colors that made it.
          </span>
          <button class={`btn small sq-changes ${s.changes ? 'on' : ''}`} aria-pressed={s.changes} onClick={() => send({ changes: !s.changes })}>
            <Icon name="eye" size={14} /> {s.changes ? 'Hide what changed' : 'Show what changed'}
          </button>
        </div>
      ) : (
        <WalkControls pos={s.pos} total={total} canSkip={s.pos >= across} ms={650} unit="Square" send={send} />
      )}
    </div>
  );
}
