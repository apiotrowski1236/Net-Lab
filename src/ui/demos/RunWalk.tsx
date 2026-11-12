import { colorName, picture, PIXEL_BYTES, RUN_BYTES, sameColor, type Run } from '../../demos/pictures';
import { flatRuns, readSoFar, runWalkFirstRow, runWalkTotal, walkRuns, type RunWalkState } from '../../demos/runWalk';
import type { RunWalkSpec } from '../../demos/types';
import { Icon } from '../icons';
import { cellsOf, Fig, n, PixelGrid, SizeBars, Swatch, WalkControls, type Cell } from './pictureParts';
import type { DemoViewProps } from './parts';

const name = (r: Run) => colorName(r.color) ?? 'mixed';

/** One run as a chip: its count and its color. */
function RunChip({ run, cls = '' }: { run: Run; cls?: string }) {
  return (
    <span class={`run-chip ${cls}`}>
      <Swatch c={run.color} /> <b>{run.count}</b> {name(run)}
    </span>
  );
}

/** The runs, one line per row. `cls` styles each run by row and place. */
function RunList({ rows, cls, label }: { rows: Run[][]; cls?: (y: number, k: number) => string; label: string }) {
  return (
    <ol class="run-list" aria-label={label}>
      {rows.map((row, y) => (
        <li key={y}>
          <span class="run-row">Row {y + 1}</span>
          <span class="run-chips">
            {row.map((run, k) => (
              <RunChip key={k} run={run} cls={cls?.(y, k)} />
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Run-length encoding, one step at a time. 'encode': each Step reads one
 * pixel, left to right and row by row, and counts it into a run. 'decode':
 * each Step paints one run back, and the end compares with the original.
 */
export function RunWalkView(props: DemoViewProps<RunWalkSpec, RunWalkState>) {
  return props.spec.mode === 'encode' ? <Encode {...props} /> : <Decode {...props} />;
}

function Encode({ spec, state: s, send }: DemoViewProps<RunWalkSpec, RunWalkState>) {
  const p = picture(spec.picture);
  const total = runWalkTotal(spec);
  const { rows, open } = readSoFar(p, s.pos);
  const runs = rows.reduce((t, r) => t + r.length, 0);
  const done = s.pos === total;
  const last = s.pos - 1;
  const lx = last % p.w;
  const ly = Math.floor(last / p.w);
  // Each pixel read in the row being read shows its count within its run.
  const counts = new Map<number, number>();
  if (s.pos > 0 && !done) {
    let k = 0;
    for (let x = 0; x <= lx; x++) {
      const i = ly * p.w + x;
      k = x > 0 && sameColor(p.px[i], p.px[i - 1]) ? k + 1 : 1;
      counts.set(i, k);
    }
  }
  const cells: Cell[] = cellsOf(p, (i) => ({
    label: counts.has(i) ? String(counts.get(i)) : undefined,
    pop: i === last && !done ? 0 : undefined,
  }));

  let status: preact.ComponentChildren = (
    <>
      Press <strong>Step</strong> to read the first pixel.
    </>
  );
  if (done) status = null;
  else if (s.pos > 0) {
    const c = colorName(p.px[last]);
    const rowRuns = rows[rows.length - 1];
    const cur = rowRuns[rowRuns.length - 1];
    const prev = rowRuns[rowRuns.length - 2];
    const end = lx === p.w - 1;
    status = (
      <>
        {lx === 0 ? (
          <>
            Row {ly + 1}, pixel 1 is {c}. A {c} run starts: <b>1</b>.
          </>
        ) : cur.count > 1 ? (
          <>
            Pixel {lx + 1} is {c} too. The {c} run grows to <b>{cur.count}</b>.
          </>
        ) : (
          <>
            Pixel {lx + 1} is {c}, a new color. The {name(prev)} run ends at <b>{prev.count}</b>, and a {c} run starts: <b>1</b>.
          </>
        )}
        {end && (
          <>
            {' '}
            That's the end of row {ly + 1}, so this {c} run ends at <b>{cur.count}</b>.
          </>
        )}
      </>
    );
  }

  return (
    <div class="walk-pix">
      <div class="walk-figs">
        <Fig title="Picture">
          <PixelGrid w={p.w} h={p.h} cells={cells} label="The picture" ring={s.pos > 0 && !done ? { x: lx, y: ly } : undefined} />
        </Fig>
        <div class="walk-side">
          <h4 class="walk-h">Runs stored</h4>
          {rows.length ? (
            <RunList rows={rows} label="Runs stored so far" cls={(y, k) => (open && !done && y === rows.length - 1 && k === rows[y].length - 1 ? 'open' : '')} />
          ) : (
            <p class="muted small">None yet.</p>
          )}
        </div>
      </div>
      {status && (
        <p class="walk-note" aria-live="polite">
          {status}
        </p>
      )}
      <SizeBars
        rows={[
          {
            label: (
              <>
                Pixels read: {s.pos} × {PIXEL_BYTES} bytes = <b>{n(s.pos * PIXEL_BYTES)} bytes</b>
              </>
            ),
            bytes: s.pos * PIXEL_BYTES,
            tone: 'base',
          },
          {
            label: (
              <>
                Runs: {runs} × {RUN_BYTES} bytes = <b>{n(runs * RUN_BYTES)} bytes</b>
              </>
            ),
            bytes: runs * RUN_BYTES,
            tone: 'good',
          },
        ]}
      />
      {done ? (
        <div class="callout good small walk-done">
          <span>
            <Icon name="check" size={14} /> All {total} pixels are stored as {runs} runs. That's {runs} × {RUN_BYTES} = <b>{n(runs * RUN_BYTES)} bytes</b>, down from {n(total * PIXEL_BYTES)}.
          </span>
        </div>
      ) : (
        <WalkControls pos={s.pos} total={total} canSkip={s.pos >= runWalkFirstRow(spec)} ms={450} unit="Pixel" send={send} />
      )}
    </div>
  );
}

function Decode({ spec, state: s, send }: DemoViewProps<RunWalkSpec, RunWalkState>) {
  const p = picture(spec.picture);
  const all = flatRuns(spec);
  const total = all.length;
  const done = s.pos === total;
  // Which run (in reading order) each row's k-th run is.
  const index = new Map<string, number>();
  all.forEach((r, i) => index.set(`${r.row}:${r.start}`, i));
  const painted: Cell[] = p.px.map(() => ({ color: null }));
  all.slice(0, s.pos).forEach((r, i) => {
    for (let j = 0; j < r.run.count; j++) {
      const at = r.row * p.w + r.start + j;
      painted[at] = { color: r.run.color, pop: i === s.pos - 1 && !done ? j * 70 : undefined };
    }
  });
  const cur = s.pos > 0 ? all[s.pos - 1] : undefined;
  const cls = (y: number, at: number) => {
    const row = walkRuns(spec)[y];
    let x = 0;
    for (let j = 0; j < at; j++) x += row[j].count;
    const i = index.get(`${y}:${x}`) ?? 0;
    return i === s.pos - 1 && !done ? 'open' : i >= s.pos ? 'dim' : '';
  };
  return (
    <div class="walk-pix">
      <div class="walk-figs">
        <div class="walk-side">
          <h4 class="walk-h">Runs stored</h4>
          <RunList rows={walkRuns(spec)} label="The stored runs" cls={cls} />
        </div>
        <Fig title="Rebuilt from the runs">
          <PixelGrid w={p.w} h={p.h} cells={painted} label="The picture rebuilt so far" ring={cur && !done ? { x: cur.start, y: cur.row } : undefined} />
        </Fig>
        <Fig title="Original">
          <PixelGrid w={p.w} h={p.h} cells={cellsOf(p)} label="The original picture" />
        </Fig>
      </div>
      {!done && (
        <p class="walk-note" aria-live="polite">
          {cur ? (
            <>
              Run {s.pos} of {total}: <b>{cur.run.count}</b> {name(cur.run)}. Paint {cur.run.count === 1 ? '1 pixel' : `${cur.run.count} pixels`} {name(cur.run)}
              {cur.start === 0 ? `, starting a new row (row ${cur.row + 1})` : ''}.
            </>
          ) : (
            <>
              Press <strong>Step</strong> to paint the first run.
            </>
          )}
        </p>
      )}
      {done ? (
        <div class="callout good small walk-done" role="status">
          <span>
            <Icon name="check" size={14} /> The picture is rebuilt. Compare it with the original: all {p.w * p.h} pixels match. <b>0 pixels changed.</b>
          </span>
        </div>
      ) : (
        <WalkControls pos={s.pos} total={total} canSkip={s.pos >= runWalkFirstRow(spec)} ms={700} unit="Run" send={send} />
      )}
    </div>
  );
}
