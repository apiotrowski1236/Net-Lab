import type { DemoModel, RoundingSpec } from './types';

export interface RoundingState {
  digits: number;
  /** Every setting the student has tried. */
  tried: number[];
}

/** 1 ÷ 3 kept to `d` decimal digits, that times 3, and how far off it is, as exact decimal strings. */
export function thirds(d: number): { stored: string; times3: string; off: string } {
  return { stored: `0.${'3'.repeat(d)}`, times3: `0.${'9'.repeat(d)}`, off: `0.${'0'.repeat(d - 1)}1` };
}

export const roundingModel: DemoModel<RoundingSpec, RoundingState> = {
  init: (spec) => ({ digits: spec.digits[0], tried: [spec.digits[0]] }),
  apply(spec, s, input) {
    if (!('digits' in input) || !spec.digits.includes(input.digits) || input.digits === s.digits) return s;
    return { digits: input.digits, tried: s.tried.includes(input.digits) ? s.tried : [...s.tried, input.digits] };
  },
  facts: (_spec, s) => ({ digits: s.digits, tried: s.tried.length }),
};
