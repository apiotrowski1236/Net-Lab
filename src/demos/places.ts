import type { DemoModel, PlacesSpec } from './types';

export interface PlacesState {
  /** One digit per place, biggest place first. */
  digits: number[];
  /** How many times the student changed a digit. */
  changes: number;
}

/** Place values for `places` digits in `base`, left to right: 1000, 100, 10, 1 or 8, 4, 2, 1. */
export const placeValuesIn = (base: number, places: number): number[] => Array.from({ length: places }, (_, i) => base ** (places - 1 - i));

export const placesValue = (spec: PlacesSpec, digits: number[]): number => digits.reduce((n, d) => n * spec.base + d, 0);

export const placesModel: DemoModel<PlacesSpec, PlacesState> = {
  init: (spec) => ({ digits: [...spec.start].map((c) => Math.min(spec.base - 1, Math.max(0, Number(c) || 0))), changes: 0 }),
  apply(spec, s, input) {
    let i: number;
    let to: number;
    if ('flip' in input && spec.base === 2) {
      i = input.flip;
      to = 1 - (s.digits[i] ?? 0);
    } else if ('bump' in input && spec.base === 10) {
      i = input.bump;
      to = ((s.digits[i] ?? 0) + input.by + 10) % 10;
    } else return s;
    if (i < 0 || i >= s.digits.length) return s;
    return { digits: s.digits.map((d, j) => (j === i ? to : d)), changes: s.changes + 1 };
  },
  facts: (spec, s) => ({ value: placesValue(spec, s.digits), digits: s.digits.join(''), changes: s.changes }),
};
