import type { DemoKind, DemoSpec } from '../../demos/types';
import { AsciiView } from './Ascii';
import { BitsView } from './Bits';
import { CompareView } from './Compare';
import { CounterView } from './Counter';
import { FitWalkView } from './FitWalk';
import { JavaView } from './Java';
import { NoteView } from './Note';
import { ObjectsView } from './Objects';
import type { DemoView } from './parts';
import { PlacesView } from './Places';
import { ReadWalkView } from './ReadWalk';
import { RoundingView } from './Rounding';
import { SwitchesView } from './Switches';

/** The view for each kind of demo. Models are listed separately, in src/demos/registry.ts. */
export const DEMO_VIEWS: { [K in DemoKind]: DemoView<Extract<DemoSpec, { kind: K }>, any> } = {
  switches: SwitchesView,
  bits: BitsView,
  places: PlacesView,
  'read-walk': ReadWalkView,
  'fit-walk': FitWalkView,
  compare: CompareView,
  counter: CounterView,
  rounding: RoundingView,
  ascii: AsciiView,
  note: NoteView,
  java: JavaView,
  objects: ObjectsView,
};

/** What a demo is called in the printed guide's "On screen" line. */
export const DEMO_NAME: Record<DemoKind, string> = {
  switches: 'Light switches',
  bits: 'Bits to flip',
  places: 'Place values',
  'read-walk': 'Worked examples',
  'fit-walk': 'Worked examples',
  compare: 'Compare two numbers',
  counter: 'Counter',
  rounding: 'Rounding',
  ascii: 'ASCII',
  note: 'Notes',
  java: 'Code editor',
  objects: 'Class and objects',
};
