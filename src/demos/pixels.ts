import { colorName, picture, type RGB } from './pictures';
import type { DemoModel, PixelsSpec } from './types';

export interface PixelsState {
  /** The pixel tapped last, by its index row by row. */
  at?: number;
  /** Every pixel tapped, in order, once each. */
  seen: number[];
  /** Every color found by tapping, as "r,g,b", in order. */
  colors: string[];
}

const key = (c: RGB) => c.join(',');

/** How many different colors a picture has. */
export function colorsIn(spec: PixelsSpec): number {
  return new Set(picture(spec.picture).px.map(key)).size;
}

/** The colors found so far, with their names, in the order they were found. */
export const foundColors = (s: PixelsState) =>
  s.colors.map((k) => {
    const c = k.split(',').map(Number) as unknown as RGB;
    return { color: c, name: colorName(c) ?? 'a mix' };
  });

export const pixelsModel: DemoModel<PixelsSpec, PixelsState> = {
  init: () => ({ seen: [], colors: [] }),
  apply(spec, s, input) {
    if (!('peek' in input)) return s;
    const p = picture(spec.picture);
    const i = input.peek;
    if (!Number.isInteger(i) || i < 0 || i >= p.px.length || i === s.at) return s;
    const k = key(p.px[i]);
    return {
      at: i,
      seen: s.seen.includes(i) ? s.seen : [...s.seen, i],
      colors: s.colors.includes(k) ? s.colors : [...s.colors, k],
    };
  },
  facts: (spec, s) => ({ peeks: s.seen.length, colors: s.colors.length, total: colorsIn(spec), at: s.at ?? -1 }),
};
