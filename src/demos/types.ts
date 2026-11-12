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
  /**
   * 'color': 24 bits as three bytes, red, green, and blue, mixed into one color
   * with its hex code. 'meaning': one byte read four ways at once (number, hex,
   * ASCII character, shade of gray).
   */
  style: 'cards' | 'board' | 'wires' | 'hex' | 'color' | 'meaning';
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
  /** Names for the targets, in the same order ('color': "Yellow"). */
  labels?: string[];
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

/** A file in a code editor. `locked`: the student can read it, not change it. */
export interface JavaFile {
  name: string;
  text: string;
  locked?: boolean;
}

/** What a check gets. See src/demos/java.ts for the helpers. */
export type JavaCheckCtx = import('./java').JavaCheckCtx;

/** A test of the student's code, run on every Run. Returns what's still wrong, or nothing if it passes. */
export interface JavaCheck {
  id: string;
  /** What the check wants, shown beside a check mark. */
  label: string;
  test: (c: JavaCheckCtx) => string | undefined;
  /** Judges what Main prints, so it has nothing to say until Main compiles. */
  main?: boolean;
}

/**
 * A Java editor with Run: src/java compiles and runs the code in the browser.
 * `step` adds Step through, which walks the program a line at a time and draws
 * its variables and objects.
 */
export interface JavaSpec extends DemoBase {
  kind: 'java';
  files: JavaFile[];
  /** Start from the student's own code in an earlier step. `files`: which files. Default: every file both have. */
  from?: { step: string; demo: string; files?: string[] };
  /** The class whose main runs. Default: the first class that has one. */
  main?: string;
  /** Tab to open first. Default: the first file. */
  open?: string;
  step?: boolean;
  checks?: JavaCheck[];
  /** Put the student's final code in the report the teacher reads. */
  report?: boolean;
}

/** A file in a js demo. A file whose name doesn't end in .js is shown but not run. */
export type JsFile = JavaFile;

/** What a check gets. See src/demos/js.ts. */
export type JsCheckCtx = import('./js').JsCheckCtx;

/** A test of the student's code, run when a Run finishes. Returns what's still wrong, or nothing if it passes. */
export interface JsCheck {
  id: string;
  /** What the check wants, shown beside a check mark. */
  label: string;
  test: (c: JsCheckCtx) => string | undefined;
  /** Shown one at a time by the Hint button on the first unmet check. The last one sits close to the answer. */
  hints?: string[];
  /** What's left is the next task, not a mistake, so the row keeps an open circle and a plain note. */
  next?: boolean;
}

/**
 * A JavaScript editor with Run: src/js runs the code in the browser, with
 * prompts answered in the output panel. `step` adds Step through.
 */
export interface JsSpec extends DemoBase {
  kind: 'js';
  files: JsFile[];
  /** Start from the student's own code in an earlier step. `files`: which files. Default: every file both have. */
  from?: { step: string; demo: string; files?: string[] };
  /** Tab to open first. Default: the first file. */
  open?: string;
  step?: boolean;
  checks?: JsCheck[];
  /** Put the student's final code in the report the teacher reads. */
  report?: boolean;
  /** Mistake detector rules to leave out (see LINT_RULES in src/js/lint.ts), for a step that teaches the pattern a rule warns about. */
  lintOff?: string[];
  /** Objects the program can reach as globals, such as `document`. Each run gets new ones, built from the student's files. */
  hosts?: (rt: import('../js').Runtime, files: JsFile[]) => Record<string, import('../js').HostObject>;
  /** The page before the first Run. Having one is what turns on the preview. */
  startPage?: (files: JsFile[]) => import('../dom').PageState;
  /** The code is a p5.js sketch: p5.js's names, setup() and draw(), and a live canvas beside the output (src/sketch). */
  sketch?: true;
}

/** One class stamping out objects: press to make one, and hit one to see that only it changes. */
export interface ObjectsSpec extends DemoBase {
  kind: 'objects';
  cls: string;
  /** Objects the button makes, in order. */
  make: { name: string; label: string; health: number }[];
  /** Taken off one object's health at each hit. */
  hit: number;
}

// compression (src/demos/pictures.ts holds the pictures and both methods)

/** A picture to look at up close: tap a pixel to see the three bytes of its color. */
export interface PixelsSpec extends DemoBase {
  kind: 'pixels';
  picture: import('./pictures').PictureId;
}

/**
 * Run-length encoding, one step at a time. 'encode' reads the pixels left to
 * right, one per step, counting each run. 'decode' paints the runs back, one
 * run per step, and compares the result with the original.
 */
export interface RunWalkSpec extends DemoBase {
  kind: 'run-walk';
  picture: import('./pictures').PictureId;
  mode: 'encode' | 'decode';
}

/**
 * Averaging squares, one step at a time. 'encode' averages each 2×2 square
 * into one stored pixel. 'decode' stretches each stored pixel back into a
 * square and compares the result with the original.
 */
export interface SquareWalkSpec extends DemoBase {
  kind: 'square-walk';
  picture: import('./pictures').PictureId;
  mode: 'encode' | 'decode';
}

/** Pick a picture and a method: see it rebuilt beside the original, with its size and the pixels that changed. */
export interface SqueezeSpec extends DemoBase {
  kind: 'squeeze';
  pictures: import('./pictures').PictureId[];
  methods: import('./pictures').Method[];
}

/** An 8×8 picture to paint, with what each method does to it, live. */
export interface PaintSpec extends DemoBase {
  kind: 'paint';
}

export type DemoSpec =
  | SwitchesSpec
  | BitsSpec
  | PlacesSpec
  | ReadWalkSpec
  | FitWalkSpec
  | CompareSpec
  | CounterSpec
  | RoundingSpec
  | AsciiSpec
  | NoteSpec
  | JavaSpec
  | JsSpec
  | ObjectsSpec
  | PixelsSpec
  | RunWalkSpec
  | SquareWalkSpec
  | SqueezeSpec
  | PaintSpec;

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
  | { text: string }
  // java
  | { edit: string; code: string }
  | { tab: string }
  | { run: true }
  | { stepping: boolean }
  | { seek: number }
  // js, which also takes the java inputs above
  | { answer: string | null }
  | { stop: true }
  | { hint: string }
  /** An element on the preview, by its path or a selector. It re-executes from the start, then clicks in order, the way `answer` does. */
  | { click: string }
  // objects
  | { make: true }
  | { hit: number }
  // pixels: tap one pixel, by its index row by row
  | { peek: number }
  // run-walk, square-walk: Step (and each tick of Play) moves one step; Skip to the end finishes
  | { advance: 1 }
  | { finish: true }
  // square-walk, squeeze: Show what changed
  | { changes: boolean }
  // squeeze
  | { picture: import('./pictures').PictureId }
  | { method: import('./pictures').Method }
  // paint (Clear is `clear`)
  | { brush: number }
  | { paint: number };

export type WireView = 'voltage' | 'light' | 'bits';

/**
 * The logic behind one kind of demo. Pure and deterministic: the same inputs
 * from `init` always give the same state, so the answer key and a reload agree
 * with what the student saw. State must be plain JSON (it is saved as is).
 */
export interface DemoModel<Spec extends DemoSpec = DemoSpec, State = unknown> {
  init(spec: Spec): State;
  /** Used instead of `init` by a demo that starts from the student's work in an earlier step. `earlier` is that demo's state. */
  start?(spec: Spec, earlier: (step: string, demo: string) => unknown): State;
  /** The state after one input. Return `state` itself when the input changes nothing. */
  apply(spec: Spec, state: State, input: DemoInput): State;
  facts(spec: Spec, state: State): DemoFacts;
}
