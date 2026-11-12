import { picture, rowOf, rowRuns, runsOf, type Picture, type Run } from './pictures';
import type { DemoModel, RunWalkSpec } from './types';

/** How far a walk-through has gone: pixels read ('encode') or runs painted ('decode'). */
export interface RunWalkState {
  pos: number;
}

/** The picture's runs, row by row, worked out once per picture. */
const runsCache = new Map<string, Run[][]>();
export function walkRuns(spec: RunWalkSpec): Run[][] {
  let r = runsCache.get(spec.picture);
  if (!r) runsCache.set(spec.picture, (r = runsOf(picture(spec.picture))));
  return r;
}

/** Every run in reading order, with the row it sits in and the pixel it starts at. */
export function flatRuns(spec: RunWalkSpec): { row: number; start: number; run: Run }[] {
  const out: { row: number; start: number; run: Run }[] = [];
  walkRuns(spec).forEach((row, y) => {
    let x = 0;
    for (const run of row) {
      out.push({ row: y, start: x, run });
      x += run.count;
    }
  });
  return out;
}

/** Steps in the whole walk: one per pixel to encode, one per run to decode. */
export function runWalkTotal(spec: RunWalkSpec): number {
  const p = picture(spec.picture);
  return spec.mode === 'encode' ? p.w * p.h : flatRuns(spec).length;
}

/** Steps in the first row. Skip to the end waits until the student has watched them. */
export function runWalkFirstRow(spec: RunWalkSpec): number {
  return spec.mode === 'encode' ? picture(spec.picture).w : walkRuns(spec)[0].length;
}

/**
 * The runs found after reading `pos` pixels: each finished row's runs, then
 * the row being read so far. `open` says the last run may still grow, because
 * its row isn't finished.
 */
export function readSoFar(p: Picture, pos: number): { rows: Run[][]; open: boolean } {
  const rows: Run[][] = [];
  const full = Math.floor(pos / p.w);
  for (let y = 0; y < full; y++) rows.push(rowRuns(rowOf(p, y)));
  const x = pos % p.w;
  if (x > 0) rows.push(rowRuns(rowOf(p, full).slice(0, x)));
  return { rows, open: x > 0 };
}

export const runWalkModel: DemoModel<RunWalkSpec, RunWalkState> = {
  init: () => ({ pos: 0 }),
  apply(spec, s, input) {
    const total = runWalkTotal(spec);
    if ('advance' in input) return s.pos < total ? { pos: s.pos + 1 } : s;
    if ('finish' in input) return s.pos >= runWalkFirstRow(spec) && s.pos < total ? { pos: total } : s;
    return s;
  },
  facts: (spec, s) => ({ pos: s.pos, total: runWalkTotal(spec), done: s.pos === runWalkTotal(spec) }),
};
