import type { CounterSpec, DemoModel } from './types';

export interface CounterState {
  value: number;
  /** Times the counter has rolled over. */
  overflows: number;
  /** The last count rolled over: a carry fell off the left end. */
  carried: boolean;
}

export const counterMax = (spec: CounterSpec) => spec.base ** spec.digits;

export const counterModel: DemoModel<CounterSpec, CounterState> = {
  init: (spec) => ({ value: spec.start % counterMax(spec), overflows: 0, carried: false }),
  apply(spec, s, input) {
    if ('add' in input) {
      const k = Math.max(0, Math.round(input.add));
      if (!k) return s;
      const raw = s.value + k;
      const carried = raw >= counterMax(spec);
      return { value: raw % counterMax(spec), overflows: s.overflows + (carried ? 1 : 0), carried };
    }
    if ('clear' in input) {
      const value = spec.start % counterMax(spec);
      return value === s.value && !s.carried ? s : { ...s, value, carried: false };
    }
    return s;
  },
  facts: (_spec, s) => ({ value: s.value, overflows: s.overflows }),
};
