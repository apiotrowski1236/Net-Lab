import { firstDifference, fromBits, lineUp } from './binary';
import type { CompareSpec, DemoModel } from './types';

export type CompareNote =
  /** Tapped a place before lining up numbers of different lengths. */
  | { kind: 'unpadded' }
  /** Tapped a place where both numbers have the same bit. */
  | { kind: 'same'; col: number }
  /** Tapped a place where they differ, but they differ further left too. */
  | { kind: 'later'; col: number }
  /** Found the place, then picked the smaller number. */
  | { kind: 'wrong-pick'; pick: 0 | 1 };

export interface CompareState {
  pair: number;
  /** Shorter number padded with 0s in front. True from the start when the lengths match. */
  padded: boolean;
  /** Tapped the first place they differ. */
  found: boolean;
  /** Said which is bigger, correctly. */
  done: boolean;
  note?: CompareNote;
}

const sameLength = (spec: CompareSpec, pair: number) => spec.pairs[pair][0].length === spec.pairs[pair][1].length;

/** The pair as drawn: padded once the student lines them up. */
export function comparePair(spec: CompareSpec, s: CompareState): [string, string] {
  const [a, b] = spec.pairs[s.pair];
  return s.padded ? lineUp(a, b) : [a, b];
}

/** 0 if the first number is bigger, 1 if the second is. */
export const bigger = (a: string, b: string): 0 | 1 => (fromBits(a) > fromBits(b) ? 0 : 1);

export const compareModel: DemoModel<CompareSpec, CompareState> = {
  init: (spec) => ({ pair: 0, padded: sameLength(spec, 0), found: false, done: false }),
  apply(spec, s, input) {
    if ('pad' in input) return s.padded ? s : { ...s, padded: true, note: undefined };
    if ('tap' in input) {
      if (s.found) return s;
      if (!s.padded) return s.note?.kind === 'unpadded' ? s : { ...s, note: { kind: 'unpadded' } };
      const [a, b] = comparePair(spec, s);
      const i = input.tap;
      if (i < 0 || i >= a.length) return s;
      if (i === firstDifference(a, b)) return { ...s, found: true, note: undefined };
      return { ...s, note: { kind: a[i] === b[i] ? 'same' : 'later', col: i } };
    }
    if ('pick' in input) {
      if (!s.found || s.done) return s;
      const [a, b] = comparePair(spec, s);
      if (input.pick === bigger(a, b)) return { ...s, done: true, note: undefined };
      return { ...s, note: { kind: 'wrong-pick', pick: input.pick } };
    }
    if ('next' in input) {
      if (!s.done || s.pair >= spec.pairs.length - 1) return s;
      return { pair: s.pair + 1, padded: sameLength(spec, s.pair + 1), found: false, done: false };
    }
    return s;
  },
  facts: (_spec, s) => ({ pair: s.pair, finished: s.pair + (s.done ? 1 : 0) }),
};
