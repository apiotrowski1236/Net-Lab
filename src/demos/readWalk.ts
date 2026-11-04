import { placeValues } from './binary';
import type { DemoModel, ReadWalkSpec } from './types';

export interface ReadWalkState {
  /** Which example is on screen. */
  ex: number;
  /** Columns the student has added, in the order tapped. Only 1s get added. */
  added: number[];
  /** The 0 the student tapped last, so the view can say it adds nothing. */
  zero?: number;
}

const ones = (bits: string) => [...bits].filter((c) => c === '1').length;

/** The student has added every 1 in the current example. */
export const readDone = (spec: ReadWalkSpec, s: ReadWalkState) => s.added.length === ones(spec.examples[s.ex]);

/** The place values added so far, in tap order. */
export const readTerms = (spec: ReadWalkSpec, s: ReadWalkState) => {
  const pv = placeValues(spec.examples[s.ex].length);
  return s.added.map((i) => pv[i]);
};

export const readWalkModel: DemoModel<ReadWalkSpec, ReadWalkState> = {
  init: () => ({ ex: 0, added: [] }),
  apply(spec, s, input) {
    const bits = spec.examples[s.ex];
    if ('tap' in input) {
      const i = input.tap;
      if (i < 0 || i >= bits.length || readDone(spec, s)) return s;
      if (bits[i] === '0') return s.zero === i ? s : { ...s, zero: i };
      if (s.added.includes(i)) return s;
      return { ...s, added: [...s.added, i], zero: undefined };
    }
    if ('next' in input) {
      if (!readDone(spec, s) || s.ex >= spec.examples.length - 1) return s;
      return { ex: s.ex + 1, added: [] };
    }
    return s;
  },
  facts: (spec, s) => ({ ex: s.ex, finished: s.ex + (readDone(spec, s) ? 1 : 0) }),
};
