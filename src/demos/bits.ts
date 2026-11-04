import { fromBits } from './binary';
import type { BitsSpec, DemoModel, WireView } from './types';

export interface BitsState {
  bits: string;
  /** How the 'wires' style draws the bits right now. */
  view: WireView;
  /** Every view the student has looked at. */
  views: WireView[];
  flips: number;
}

const VIEWS: WireView[] = ['voltage', 'light', 'bits'];

export const bitsModel: DemoModel<BitsSpec, BitsState> = {
  init: (spec) => {
    const view: WireView = spec.style === 'wires' ? 'voltage' : 'bits';
    const start = (spec.start ?? '').replace(/[^01]/g, '');
    return { bits: start.length === spec.places ? start : '0'.repeat(spec.places), view, views: [view], flips: 0 };
  },
  apply(_spec, s, input) {
    if ('flip' in input) {
      if (input.flip < 0 || input.flip >= s.bits.length) return s;
      const bits = [...s.bits].map((c, i) => (i === input.flip ? (c === '1' ? '0' : '1') : c)).join('');
      return { ...s, bits, flips: s.flips + 1 };
    }
    if ('clear' in input) {
      if (!s.bits.includes('1')) return s;
      return { ...s, bits: '0'.repeat(s.bits.length) };
    }
    if ('view' in input) {
      if (!VIEWS.includes(input.view) || input.view === s.view) return s;
      return { ...s, view: input.view, views: s.views.includes(input.view) ? s.views : [...s.views, input.view] };
    }
    return s;
  },
  facts: (_spec, s) => ({ value: fromBits(s.bits), bits: s.bits, flips: s.flips, views: s.views.length }),
};
