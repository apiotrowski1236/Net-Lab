import type { DemoModel, SwitchesSpec } from './types';

export interface SwitchesState {
  /** How many switches are in use. */
  n: number;
  /** Each switch in use, left to right. */
  on: boolean[];
  /** Patterns found for each number of switches ("010" = off, on, off), in the order found. */
  seen: Record<string, string[]>;
}

const pattern = (on: boolean[]) => on.map((b) => (b ? '1' : '0')).join('');

function withSeen(seen: SwitchesState['seen'], n: number, on: boolean[]): SwitchesState['seen'] {
  const list = seen[n] ?? [];
  const p = pattern(on);
  return list.includes(p) ? { ...seen, [n]: list } : { ...seen, [n]: [...list, p] };
}

export const maxSwitches = (spec: SwitchesSpec) => spec.max ?? 3;

/** Patterns found so far with `n` switches. All off counts: it's a pattern too. */
export const foundWith = (s: SwitchesState, n: number) => s.seen[n]?.length ?? 0;

export const switchesModel: DemoModel<SwitchesSpec, SwitchesState> = {
  init: () => ({ n: 1, on: [false], seen: { 1: ['0'] } }),
  apply(spec, s, input) {
    if ('use' in input) {
      const n = Math.max(1, Math.min(maxSwitches(spec), Math.round(input.use)));
      if (n === s.n) return s;
      const on = Array<boolean>(n).fill(false);
      return { n, on, seen: withSeen(s.seen, n, on) };
    }
    if ('flip' in input) {
      if (input.flip < 0 || input.flip >= s.n) return s;
      const on = s.on.map((b, i) => (i === input.flip ? !b : b));
      return { ...s, on, seen: withSeen(s.seen, s.n, on) };
    }
    return s;
  },
  facts: (_spec, s) => ({ n: s.n, found: foundWith(s, s.n), total: 2 ** s.n }),
};
