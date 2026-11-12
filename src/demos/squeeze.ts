import { resultOf, type Method, type PictureId } from './pictures';
import type { DemoFacts, DemoModel, SqueezeSpec } from './types';

export interface SqueezeState {
  picture: PictureId;
  method: Method;
  /** Show what changed: the rebuilt picture's side shows how far each pixel moved. */
  changes: boolean;
  /** Every picture and method looked at, as "picture:method". */
  tried: string[];
}

const add = (tried: string[], k: string) => (tried.includes(k) ? tried : [...tried, k]);

export const squeezeModel: DemoModel<SqueezeSpec, SqueezeState> = {
  init: (spec) => {
    const method = spec.methods.includes('none') ? 'none' : spec.methods[0];
    return { picture: spec.pictures[0], method, changes: false, tried: [`${spec.pictures[0]}:${method}`] };
  },
  apply(spec, s, input) {
    if ('picture' in input) {
      if (!spec.pictures.includes(input.picture) || input.picture === s.picture) return s;
      return { ...s, picture: input.picture, tried: add(s.tried, `${input.picture}:${s.method}`) };
    }
    if ('method' in input) {
      if (!spec.methods.includes(input.method) || input.method === s.method) return s;
      return { ...s, method: input.method, tried: add(s.tried, `${s.picture}:${input.method}`) };
    }
    if ('changes' in input) return input.changes === s.changes ? s : { ...s, changes: input.changes };
    return s;
  },
  facts(_spec, s) {
    const r = resultOf(s.picture, s.method);
    const f: DemoFacts = { picture: s.picture, method: s.method, changes: s.changes, bytes: r.bytes, changed: r.changed };
    for (const k of s.tried) f[`tried:${k}`] = true;
    return f;
  },
};
