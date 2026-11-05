import type { DemoInput, DemoModel, ObjectsSpec } from './types';

export interface ObjectsState {
  /** Health of each object made so far, in the order of `spec.make`. */
  health: number[];
  /** The code each press stands for, newest last. */
  log: string[];
}

export const objectsModel: DemoModel<ObjectsSpec, ObjectsState> = {
  init: () => ({ health: [], log: [] }),

  apply(spec, s, input: DemoInput) {
    if ('make' in input) {
      const next = spec.make[s.health.length];
      if (!next) return s;
      return { health: [...s.health, next.health], log: [...s.log, `${spec.cls} ${next.name} = new ${spec.cls}("${next.label}", ${next.health});`] };
    }
    if ('hit' in input) {
      const i = input.hit;
      if (i < 0 || i >= s.health.length || s.health[i] <= 0) return s;
      const health = s.health.map((h, j) => (j === i ? Math.max(0, h - spec.hit) : h));
      return { health, log: [...s.log, `${spec.make[i].name}.takeDamage(${spec.hit});`] };
    }
    return s;
  },

  facts(spec, s) {
    return {
      made: s.health.length,
      hurt: s.health.filter((h, i) => h < spec.make[i].health).length,
      // Someone was hit while someone else kept all their health.
      separate: s.health.some((h, i) => h < spec.make[i].health) && s.health.some((h, i) => h === spec.make[i].health),
    };
  },
};
