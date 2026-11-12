import { picture } from './pictures';
import type { DemoModel, SquareWalkSpec } from './types';

/** The walk-throughs average 2×2 squares. */
export const WALK_SQUARE = 2;

export interface SquareWalkState {
  /** Squares averaged ('encode') or stretched back ('decode'). */
  pos: number;
  /** Show what changed: marks the pixels that aren't the original color. 'decode' only, once it's done. */
  changes: boolean;
}

export const squaresAcross = (spec: SquareWalkSpec) => picture(spec.picture).w / WALK_SQUARE;
export const squareWalkTotal = (spec: SquareWalkSpec) => squaresAcross(spec) * (picture(spec.picture).h / WALK_SQUARE);

export const squareWalkModel: DemoModel<SquareWalkSpec, SquareWalkState> = {
  init: () => ({ pos: 0, changes: false }),
  apply(spec, s, input) {
    const total = squareWalkTotal(spec);
    if ('advance' in input) return s.pos < total ? { ...s, pos: s.pos + 1 } : s;
    // Skip to the end waits until the first row of squares is done.
    if ('finish' in input) return s.pos >= squaresAcross(spec) && s.pos < total ? { ...s, pos: total } : s;
    if ('changes' in input) {
      if (spec.mode !== 'decode' || s.pos < total || input.changes === s.changes) return s;
      return { ...s, changes: input.changes };
    }
    return s;
  },
  facts: (spec, s) => ({ pos: s.pos, total: squareWalkTotal(spec), done: s.pos === squareWalkTotal(spec), changes: s.changes }),
};
