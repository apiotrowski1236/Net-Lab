import { asciiModel } from './ascii';
import { bitsModel } from './bits';
import { compareModel } from './compare';
import { counterModel } from './counter';
import { fitWalkModel } from './fitWalk';
import { placesModel } from './places';
import { readWalkModel } from './readWalk';
import { roundingModel } from './rounding';
import { switchesModel } from './switches';
import type { DemoKind, DemoModel, DemoSpec, NoteSpec } from './types';

const noteModel: DemoModel<NoteSpec, Record<string, never>> = {
  init: () => ({}),
  apply: (_spec, s) => s,
  facts: () => ({}),
};

/** The model behind each kind of demo. Views are listed separately, in src/ui/demos/registry.ts. */
export const DEMO_MODELS: { [K in DemoKind]: DemoModel<Extract<DemoSpec, { kind: K }>, any> } = {
  switches: switchesModel,
  bits: bitsModel,
  places: placesModel,
  'read-walk': readWalkModel,
  'fit-walk': fitWalkModel,
  compare: compareModel,
  counter: counterModel,
  rounding: roundingModel,
  ascii: asciiModel,
  note: noteModel,
};

export function demoModel<S extends DemoSpec>(spec: S): DemoModel<S, unknown> {
  return DEMO_MODELS[spec.kind] as unknown as DemoModel<S, unknown>;
}

/** Demos with nothing to change (notes) get no "Start over" button. */
export const isStatic = (spec: DemoSpec) => spec.kind === 'note';
