import { placeValues } from './binary';
import type { DemoModel, FitWalkSpec } from './types';

export interface FitWalkState {
  ex: number;
  /** The bits written so far, left to right. */
  bits: string;
  /** The last wrong call, so the view can explain it. Cleared by a right one. */
  miss?: { col: number; said: 0 | 1 };
  misses: number;
}

export const fitPlaces = (spec: FitWalkSpec) => spec.places ?? 8;

/** What's left of the example's number after the 1s written so far. */
export function fitLeft(spec: FitWalkSpec, s: FitWalkState): number {
  const pv = placeValues(fitPlaces(spec));
  return spec.examples[s.ex] - [...s.bits].reduce((sum, c, i) => sum + (c === '1' ? pv[i] : 0), 0);
}

export const fitDone = (spec: FitWalkSpec, s: FitWalkState) => s.bits.length === fitPlaces(spec);

export const fitWalkModel: DemoModel<FitWalkSpec, FitWalkState> = {
  init: () => ({ ex: 0, bits: '', misses: 0 }),
  apply(spec, s, input) {
    if ('say' in input) {
      if (fitDone(spec, s)) return s;
      const col = s.bits.length;
      const fits = placeValues(fitPlaces(spec))[col] <= fitLeft(spec, s);
      if ((input.say === 1) === fits) return { ...s, bits: s.bits + input.say, miss: undefined };
      return { ...s, miss: { col, said: input.say }, misses: s.misses + 1 };
    }
    if ('next' in input) {
      if (!fitDone(spec, s) || s.ex >= spec.examples.length - 1) return s;
      return { ex: s.ex + 1, bits: '', misses: s.misses };
    }
    return s;
  },
  facts: (spec, s) => ({ ex: s.ex, finished: s.ex + (fitDone(spec, s) ? 1 : 0), misses: s.misses }),
};
