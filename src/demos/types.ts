/**
 * Demos: interactive widgets on the stage of a lesson that has no network (a
 * LabDef without `build`, such as binary-numbers). Each step lists its demos
 * in `StepDef.demos`; the stage shows them where a lab shows its map.
 *
 * Every kind has two halves:
 *  - a pure model here, src/demos/<kind>.ts: `init`, `apply` (one student
 *    input to the next state), and `facts` (what goals check). The session runs
 *    it, saves the state in the student's progress so it survives a reload, and
 *    sends the facts as a `ui:demo` event after every change. The answer key
 *    plays the same inputs ({ demo, input } moves), so the walkthrough test
 *    proves a goal can be reached through the model.
 *  - a view, src/ui/demos/<Kind>.tsx: draws the state and sends inputs. It holds
 *    no lesson state of its own.
 *
 * To add a kind: add its spec and input below, write the model and list it in
 * DEMO_MODELS (src/demos/registry.ts), then write the view and list it in
 * DEMO_VIEWS (src/ui/demos/registry.ts). Bump the lab's `version` when a
 * demo's spec changes in a way that would confuse a saved state.
 */

/** What a demo reports after each change. Goals read these (see `demoFact` in src/labs/helpers.ts). */
export type DemoFacts = Record<string, number | string | boolean>;

interface DemoBase {
  /** Unique within its step. Names the demo in events, saved state, and answer keys. */
  id: string;
  /** Heading on the demo's card. */
  title: string;
  /** One or two sentences of markdown under the heading: what to do with it. */
  intro?: string;
}

/** Light switches with bulbs. Pick how many switches (1 to `max`), flip them, and the demo lists each pattern found. */
export interface SwitchesSpec extends DemoBase {
  kind: 'switches';
  /** Most switches the student can use. Default 3. */
  max?: number;
}

/**
 * A row of bits the student flips, worth 2^(places-1) down to 1.
 * - 'cards': binary cards with dots, face up = 1.
 * - 'board': an 8-column place-value board (scratch paper unless `total`).
 * - 'wires': the same bits seen as voltages, lights, or 0s and 1s (abstraction).
 * - 'hex': grouped in fours, with each group's hex digit.
 */
export interface BitsSpec extends DemoBase {
  kind: 'bits';
  places: number;
  style: 'cards' | 'board' | 'wires' | 'hex';
  /** Show the decimal value. Off for scratch boards during practice. */
  total?: boolean;
  /** Starting bits, e.g. "00000". Default all 0. */
  start?: string;
  /**
   * Values to make ('cards'). Each shows as a tracker on the demo, and the
   * first time the bits add up to one, it is checked off and logged with its
   * bits below.
   */
  targets?: number[];
}

/**
 * A number's place values, drawn as an equation: each place's value, the digit
 * under it, and what that place adds to the total. Base 10 digits go up and
 * down; base 2 bits flip.
 */
export interface PlacesSpec extends DemoBase {
  kind: 'places';
  base: 2 | 10;
  /** Starting digits, which also set the number of places, e.g. "2305" or "1100". */
  start: string;
}

/** Worked binary-to-decimal examples: the student taps each 1 to add its place value. */
export interface ReadWalkSpec extends DemoBase {
  kind: 'read-walk';
  /** Binary numbers, all the same length (8 bits). */
  examples: string[];
}

/** Worked decimal-to-binary examples with "does it fit?": at each place the student says 1 (fits) or 0 (too big). */
export interface FitWalkSpec extends DemoBase {
  kind: 'fit-walk';
  examples: number[];
  /** Number of bits. Default 8. */
  places?: number;
}

/** Compare pairs of binary numbers: line them up, tap the first place they differ, say which is bigger. */
export interface CompareSpec extends DemoBase {
  kind: 'compare';
  pairs: [string, string][];
}

/** A counter with a fixed number of digits: an odometer (base 10) or a binary counter (base 2). Shows overflow. */
export interface CounterSpec extends DemoBase {
  kind: 'counter';
  base: 2 | 10;
  digits: number;
  start: number;
}

/** 1 ÷ 3 kept to a few decimal digits, then times 3: rounding error. */
export interface RoundingSpec extends DemoBase {
  kind: 'rounding';
  /** Choices for how many digits to keep, e.g. [2, 4, 8]. */
  digits: number[];
}

/** Type a short word and see each letter's ASCII code in decimal and binary. */
export interface AsciiSpec extends DemoBase {
  kind: 'ascii';
  start?: string;
  /** Longest word accepted. Default 10. */
  maxLength?: number;
}

/** A card of markdown on the stage: a reference table or a reminder. Not interactive. */
export interface NoteSpec extends DemoBase {
  kind: 'note';
  md: string;
}

export type DemoSpec = SwitchesSpec | BitsSpec | PlacesSpec | ReadWalkSpec | FitWalkSpec | CompareSpec | CounterSpec | RoundingSpec | AsciiSpec | NoteSpec;

export type DemoKind = DemoSpec['kind'];

/** Everything a student can do to a demo. Each model handles its own kind's inputs and ignores the rest. */
export type DemoInput =
  // switches
  | { use: number }
  // switches, bits, places (base 2)
  | { flip: number }
  // places (base 10): raise or lower one digit, wrapping 9 to 0
  | { bump: number; by: 1 | -1 }
  // bits
  | { view: WireView }
  | { clear: true }
  // read-walk, compare
  | { tap: number }
  // read-walk, fit-walk, compare
  | { next: true }
  // fit-walk
  | { say: 0 | 1 }
  // compare
  | { pad: true }
  | { pick: 0 | 1 }
  // counter
  | { add: number }
  // rounding
  | { digits: number }
  // ascii
  | { text: string };

export type WireView = 'voltage' | 'light' | 'bits';

/**
 * The logic behind one kind of demo. Pure and deterministic: the same inputs
 * from `init` always give the same state, so the answer key and a reload agree
 * with what the student saw. State must be plain JSON (it is saved as is).
 */
export interface DemoModel<Spec extends DemoSpec = DemoSpec, State = unknown> {
  init(spec: Spec): State;
  /** The state after one input. Return `state` itself when the input changes nothing. */
  apply(spec: Spec, state: State, input: DemoInput): State;
  facts(spec: Spec, state: State): DemoFacts;
}
