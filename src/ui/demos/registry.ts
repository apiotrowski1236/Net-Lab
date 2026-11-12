import type { DemoKind, DemoSpec } from '../../demos/types';
import { AsciiView } from './Ascii';
import { BitsView } from './Bits';
import { CompareView } from './Compare';
import { CounterView } from './Counter';
import { FitWalkView } from './FitWalk';
import { JavaView } from './Java';
import { JsView } from './Js';
import { NoteView } from './Note';
import { ObjectsView } from './Objects';
import { PaintView } from './Paint';
import type { DemoView } from './parts';
import { PixelsView } from './Pixels';
import { PlacesView } from './Places';
import { ReadWalkView } from './ReadWalk';
import { RoundingView } from './Rounding';
import { RunWalkView } from './RunWalk';
import { SquareWalkView } from './SquareWalk';
import { SqueezeView } from './Squeeze';
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
  js: JsView,
  objects: ObjectsView,
  pixels: PixelsView,
  'run-walk': RunWalkView,
  'square-walk': SquareWalkView,
  squeeze: SqueezeView,
  paint: PaintView,
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
  js: 'Code editor',
  objects: 'Class and objects',
  pixels: 'Pixels',
  'run-walk': 'Run-length encoding, step by step',
  'square-walk': 'Averaging squares, step by step',
  squeeze: 'Compare methods',
  paint: 'Paint a picture',
};
