import { beforeEach, describe, expect, it, vi } from 'vitest';
import { colorHex, firstDifference, fromBits, lineUp, toBits } from '../../demos/binary';
import { bitsModel, type BitsState } from '../../demos/bits';
import { asciiClean } from '../../demos/ascii';
import { compareModel, type CompareState } from '../../demos/compare';
import { counterModel } from '../../demos/counter';
import { fitWalkModel } from '../../demos/fitWalk';
import { placesModel } from '../../demos/places';
import { readWalkModel } from '../../demos/readWalk';
import { thirds } from '../../demos/rounding';
import { switchesModel, type SwitchesState } from '../../demos/switches';
import type { BitsSpec, CompareSpec, CounterSpec, DemoInput, DemoModel, DemoSpec, FitWalkSpec, PlacesSpec, ReadWalkSpec, SwitchesSpec } from '../../demos/types';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import { buildReport } from '../../store/report';
import { LABS } from '..';
import { playStep } from '../solution';
import { isLesson, isWorksheet, wrongFeedback, type ChoiceQuestion, type QuestionDef, type TextQuestion } from '../types';
import { count, num, rangeRe } from './answers';
import { binaryNumbersLab as lab } from '.';
import { binaryNumbersSolution as key } from './solution';

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

let n = 0;
function fresh(): LabProgress {
  const now = Date.now();
  return { labId: lab.id, labVersion: lab.version, studentId: `bin-${n++}`, startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] };
}

/** Run inputs through a model from its starting state. */
function run<Spec extends DemoSpec, State>(model: DemoModel<Spec, State>, spec: Spec, inputs: DemoInput[]): State {
  return inputs.reduce((s, input) => model.apply(spec, s, input), model.init(spec));
}

const step = (id: string) => {
  const s = lab.steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id}`);
  return s;
};
const question = (stepId: string, qId: string): QuestionDef => {
  const q = step(stepId).questions?.find((x) => x.id === qId);
  if (!q) throw new Error(`no question ${stepId}/${qId}`);
  return q;
};
const text = (stepId: string, qId: string) => {
  const q = question(stepId, qId);
  if (q.kind !== 'text') throw new Error(`${qId} is not a text question`);
  return q as TextQuestion;
};
const choice = (stepId: string, qId: string) => {
  const q = question(stepId, qId);
  if (q.kind !== 'choice') throw new Error(`${qId} is not a choice question`);
  return q as ChoiceQuestion;
};
const right = (q: ChoiceQuestion) => q.options.filter((o) => o.correct).map((o) => o.text);
const demoSpec = <T extends DemoSpec>(stepId: string, id: string) => step(stepId).demos!.find((d) => d.id === id) as T;

/** Every string in the lesson a student can read. */
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x && typeof x === 'object' && !(x instanceof RegExp)) for (const v of Object.values(x)) strings(v, out);
  return out;
}

describe('binary-numbers: lesson shape', () => {
  it('is a lesson with no network, and only it, wireshark, java-classes, and the Intro CS labs are', () => {
    const lessons = ['wireshark', 'java-classes', 'js-arrays', 'js-loops', 'js-dom', 'p5-draw', 'p5-move', 'p5-game'];
    expect(isLesson(lab)).toBe(true);
    // Answer sheets (LabDef.worksheet) have no network either, but they aren't lessons: they have no stage at all.
    for (const l of LABS) if (l.id !== lab.id && !isWorksheet(l)) expect(isLesson(l), l.id).toBe(lessons.includes(l.id));
  });

  it('gives every step except submit something to finish', () => {
    for (const s of lab.steps) {
      if (s.kind === 'submit') continue;
      expect((s.goals?.length ?? 0) + (s.questions?.length ?? 0), s.id).toBeGreaterThan(0);
    }
  });

  it('puts the optional extra challenge after the submit step: hex, colors, text, then what bits mean', () => {
    const at = lab.steps.findIndex((s) => s.kind === 'submit');
    expect(lab.steps.slice(at + 1).map((s) => s.id)).toEqual(['hex', 'colors', 'text', 'meaning']);
    expect(lab.steps.slice(at + 1).every((s) => s.extra)).toBe(true);
    expect(lab.steps.slice(0, at).some((s) => s.extra)).toBe(false);
  });

  it('keeps demo ids unique within a step', () => {
    for (const s of lab.steps) {
      const ids = (s.demos ?? []).map((d) => d.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
    }
  });

  it('uses the house style in student text', () => {
    for (const t of strings(lab.steps)) {
      expect(t, t).not.toMatch(/—/);
      expect(t, t).not.toMatch(/\b(simply|just|easy|easier|obviously)\b/i);
      expect(t, t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('binary-numbers: demo models', () => {
  const sw: SwitchesSpec = { kind: 'switches', id: 'sw', title: 'x', max: 3 };

  it('switches: counts all off as a pattern and finds 2, 4, then 8', () => {
    let s = switchesModel.init(sw);
    expect(switchesModel.facts(sw, s)).toEqual({ n: 1, found: 1, total: 2 });
    s = switchesModel.apply(sw, s, { flip: 0 });
    expect(switchesModel.facts(sw, s)).toEqual({ n: 1, found: 2, total: 2 });
    s = [{ use: 2 }, { flip: 0 }, { flip: 1 }, { flip: 0 }].reduce<SwitchesState>((st, i) => switchesModel.apply(sw, st, i), s);
    expect(switchesModel.facts(sw, s)).toEqual({ n: 2, found: 4, total: 4 });
    s = [{ use: 3 }, ...[0, 1, 0, 2, 0, 1, 0].map((flip) => ({ flip }))].reduce<SwitchesState>((st, i) => switchesModel.apply(sw, st, i), s);
    expect(switchesModel.facts(sw, s)).toEqual({ n: 3, found: 8, total: 8 });
    expect(new Set(s.seen[3]).size).toBe(8);
  });

  it('switches: repeats and bad inputs change nothing', () => {
    const s = switchesModel.init(sw);
    expect(switchesModel.apply(sw, s, { use: 1 })).toBe(s);
    expect(switchesModel.apply(sw, s, { flip: 5 })).toBe(s);
    expect(switchesModel.apply(sw, s, { use: 9 }).n).toBe(3);
    // Flipping back to a pattern already found doesn't count it twice.
    const twice = run(switchesModel, sw, [{ flip: 0 }, { flip: 0 }, { flip: 0 }]);
    expect(twice.seen[1]).toEqual(['0', '1']);
  });

  it('bits: flips, clears, and counts views', () => {
    const wires: BitsSpec = { kind: 'bits', id: 'b', title: 'x', style: 'wires', places: 8, start: '01000001' };
    let s = bitsModel.init(wires);
    expect(bitsModel.facts(wires, s)).toMatchObject({ value: 65, flips: 0, views: 1 });
    s = run(bitsModel, wires, [{ flip: 0 }, { view: 'light' }, { view: 'light' }, { view: 'bits' }]);
    expect(bitsModel.facts(wires, s)).toMatchObject({ value: 193, bits: '11000001', flips: 1, views: 3 });
    s = bitsModel.apply(wires, s, { clear: true });
    expect(s.bits).toBe('00000000');
    expect(bitsModel.apply(wires, s, { clear: true })).toBe(s);
  });

  it('bits: the cards moves in the key make 9, 21, and 31', () => {
    const cards = demoSpec<BitsSpec>('cards', 'cards');
    const values: number[] = [];
    let s: BitsState = bitsModel.init(cards);
    for (const m of key.cards.moves ?? []) {
      if (!('demo' in m)) continue;
      s = bitsModel.apply(cards, s, m.input);
      values.push(fromBits(s.bits));
    }
    expect(values).toEqual([8, 9, 25, 17, 21, 29, 31]);
    // Each target is logged once, in the order it was made.
    expect(s.found).toEqual([9, 21, 31]);
    expect(bitsModel.facts(cards, s)).toMatchObject({ found: 3 });
    // Making 9 again doesn't log it twice; values that aren't targets aren't logged.
    for (const input of [{ clear: true }, { flip: 1 }, { flip: 4 }, { flip: 3 }] as DemoInput[]) s = bitsModel.apply(cards, s, input);
    expect(s.found).toEqual([9, 21, 31]);
  });

  it('places: base 10 digits stop at 0 and 9, base 2 bits flip, and the key makes 10', () => {
    const b10 = demoSpec<PlacesSpec>('bits', 'base10');
    const b2 = demoSpec<PlacesSpec>('bits', 'base2');
    expect(placesModel.facts(b10, placesModel.init(b10))).toMatchObject({ value: 2305, changes: 0 });
    expect(placesModel.facts(b2, placesModel.init(b2))).toMatchObject({ value: 12, digits: '1100' });
    const up = run(placesModel, b10, [{ bump: 0, by: 1 }, { bump: 2, by: -1 }, { bump: 3, by: 1 }, { bump: 3, by: 1 }, { bump: 3, by: 1 }, { bump: 3, by: 1 }, { bump: 3, by: 1 }]);
    // 2 -> 3 in the 1000s; the 10s stays 0 (no lowering past 0); 5 -> 9 in the 1s, then stays 9.
    expect(placesModel.facts(b10, up)).toMatchObject({ value: 3309, changes: 5 });
    // Flips don't apply to base 10, and bumps don't apply to base 2.
    expect(placesModel.apply(b10, up, { flip: 0 })).toBe(up);
    const two = placesModel.init(b2);
    expect(placesModel.apply(b2, two, { bump: 0, by: 1 })).toBe(two);
    let s = two;
    for (const m of key.bits.moves ?? []) if ('demo' in m && m.demo === 'base2') s = placesModel.apply(b2, s, m.input);
    expect(placesModel.facts(b2, s)).toMatchObject({ value: 10, digits: '1010' });
  });

  it('read-walk: 0s add nothing, 1s add their place value, next waits for the end', () => {
    const spec = demoSpec<ReadWalkSpec>('to-decimal', 'read');
    expect(spec.examples.map(fromBits)).toEqual([74, 147]);
    let s = readWalkModel.init(spec);
    s = readWalkModel.apply(spec, s, { tap: 0 });
    expect(s).toMatchObject({ added: [], zero: 0 });
    expect(readWalkModel.apply(spec, s, { next: true })).toBe(s);
    s = run(readWalkModel, spec, [{ tap: 1 }, { tap: 1 }]);
    // A second tap on a 1 says it's already in the sum, and clears the 0 note.
    expect(s).toMatchObject({ added: [1], zero: undefined, again: 1 });
    s = run(readWalkModel, spec, [{ tap: 1 }, { tap: 1 }, { tap: 4 }, { tap: 6 }]);
    expect(s.added).toEqual([1, 4, 6]);
    expect(s.again).toBeUndefined();
    expect(readWalkModel.facts(spec, s)).toEqual({ ex: 0, finished: 1 });
    s = readWalkModel.apply(spec, s, { next: true });
    expect(readWalkModel.facts(spec, s)).toEqual({ ex: 1, finished: 1 });
  });

  it('fit-walk: a wrong call is explained and does not move on', () => {
    const spec = demoSpec<FitWalkSpec>('to-binary', 'fit');
    expect(spec.examples.map((x) => toBits(x))).toEqual(['01001011', '10011100']);
    let s = fitWalkModel.apply(spec, fitWalkModel.init(spec), { say: 1 });
    expect(s).toMatchObject({ bits: '', miss: { col: 0, said: 1 }, misses: 1 });
    s = fitWalkModel.apply(spec, s, { say: 0 });
    expect(s).toMatchObject({ bits: '0', miss: undefined, misses: 1 });
    // Walking each answer's bits finishes the example.
    const all = [...'01001011'].map((c) => ({ say: c === '1' ? 1 : 0 }) as DemoInput);
    s = run(fitWalkModel, spec, all);
    expect(s.bits).toBe('01001011');
    expect(fitWalkModel.facts(spec, s)).toEqual({ ex: 0, finished: 1, misses: 0 });
  });

  it('compare: must line up first, then find the first difference, then pick', () => {
    const spec = demoSpec<CompareSpec>('compare', 'compare');
    expect(spec.pairs.map(([a, b]) => firstDifference(...lineUp(a, b)))).toEqual([4, 0, 0]);
    expect(spec.pairs.map(([a, b]) => [fromBits(a), fromBits(b)])).toEqual([
      [105, 103],
      [128, 127],
      [9, 6],
    ]);
    let s: CompareState = compareModel.init(spec);
    s = compareModel.apply(spec, s, { tap: 0 });
    expect(s.note).toEqual({ kind: 'same', col: 0 });
    s = compareModel.apply(spec, s, { tap: 6 });
    expect(s.note).toEqual({ kind: 'later', col: 6 });
    s = compareModel.apply(spec, s, { tap: 4 });
    expect(s).toMatchObject({ found: true, note: undefined });
    s = compareModel.apply(spec, s, { pick: 1 });
    expect(s.note).toEqual({ kind: 'wrong-pick', pick: 1 });
    s = run(compareModel, spec, [{ tap: 4 }, { pick: 0 }, { next: true }, { tap: 0 }, { pick: 0 }, { next: true }]);
    expect(s).toMatchObject({ pair: 2, padded: false });
    s = compareModel.apply(spec, s, { tap: 0 });
    expect(s.note).toEqual({ kind: 'unpadded' });
    s = run(compareModel, spec, [{ tap: 4 }, { pick: 0 }, { next: true }, { tap: 0 }, { pick: 0 }, { next: true }, { pad: true }, { tap: 0 }, { pick: 0 }]);
    expect(compareModel.facts(spec, s)).toEqual({ pair: 2, finished: 3 });
  });

  it('counter: 1111 + 1 shows 0000, and the odometer rolls 999 to 000', () => {
    const bin: CounterSpec = { kind: 'counter', id: 'c', title: 'x', base: 2, digits: 4, start: 15 };
    const s = counterModel.apply(bin, counterModel.init(bin), { add: 1 });
    expect(s).toEqual({ value: 0, overflows: 1, carried: true });
    expect(counterModel.apply(bin, s, { add: 1 })).toEqual({ value: 1, overflows: 1, carried: false });
    const odo = demoSpec<CounterSpec>('overflow', 'odometer');
    const after = run(counterModel, odo, Array.from({ length: 5 }, () => ({ add: 1 })));
    expect(after).toEqual({ value: 0, overflows: 1, carried: true });
    const four = demoSpec<CounterSpec>('overflow', 'counter');
    expect(run(counterModel, four, Array.from({ length: 3 }, () => ({ add: 1 }))).overflows).toBe(0);
    expect(run(counterModel, four, Array.from({ length: 4 }, () => ({ add: 1 }))).overflows).toBe(1);
  });

  it('rounding and ascii', () => {
    expect(thirds(2)).toEqual({ stored: '0.33', times3: '0.99', off: '0.01' });
    expect(thirds(8)).toEqual({ stored: '0.33333333', times3: '0.99999999', off: '0.00000001' });
    expect(asciiClean({ kind: 'ascii', id: 'a', title: 'x' }, 'Hé llo!\u{1F600}world wide')).toBe('H llo!worl');
    expect('A'.charCodeAt(0)).toBe(65);
    expect(toBits(65)).toBe('01000001');
  });
});

describe('binary-numbers: answer key arithmetic', () => {
  const partA: [string, string, number][] = [
    ['w1', '00001010', 10],
    ['w2', '00101101', 45],
    ['w3', '01100100', 100],
    ['w4', '11111111', 255],
    ['w5', '10000001', 129],
  ];
  const partB: [string, number, string][] = [
    ['w6', 13, '00001101'],
    ['w7', 50, '00110010'],
    ['w8', 77, '01001101'],
    ['w9', 200, '11001000'],
    ['w10', 255, '11111111'],
  ];

  it('worksheet 1 to 5: binary to decimal', () => {
    for (const [id, bits, value] of partA) {
      const q = text('practice-decimal', id);
      expect(fromBits(bits)).toBe(value);
      expect(q.prompt).toContain(bits);
      expect(q.expect!.test(String(value))).toBe(true);
      expect(q.expect!.test(String(value + 1))).toBe(false);
    }
  });

  it('worksheet 6 to 10: decimal to binary', () => {
    for (const [id, value, bits] of partB) {
      const q = text('practice-binary', id);
      expect(toBits(value)).toBe(bits);
      expect(q.prompt).toContain(String(value));
      expect(q.expect!.test(bits)).toBe(true);
      expect(q.expect!.test(`${bits.slice(0, 4)} ${bits.slice(4)}`)).toBe(true);
      expect(q.expect!.test(toBits(value + 1))).toBe(false);
    }
  });

  it('worksheet 11: least to greatest', () => {
    const list = ['01011010', '00111111', '01010111', '10000000'];
    const sorted = [...list].sort((a, b) => fromBits(a) - fromBits(b));
    expect(sorted.map(fromBits)).toEqual([63, 87, 90, 128]);
    expect(right(choice('compare', 'order'))).toEqual([sorted.join(', ')]);
    expect(choice('compare', 'order').prompt).toContain(list.join(', '));
  });

  it('worksheet 12 to 14 and the review quiz', () => {
    const fewestBits = (items: number) => Math.ceil(Math.log2(items));
    expect(2 ** 6).toBe(64);
    expect(text('limits', 'w12-values').expect!.test('64')).toBe(true);
    expect(text('limits', 'w12-range').expect!.test('0 to 63')).toBe(true);
    expect(fewestBits(100)).toBe(7);
    expect(text('limits', 'w13').expect!.test('7')).toBe(true);
    expect(toBits((fromBits('1110') + 2) % 16, 4)).toBe('0000');
    expect(text('overflow', 'w14').expect!.test('0000')).toBe(true);

    expect(fromBits('01011')).toBe(11);
    expect(right(choice('exit', 'e1'))).toEqual(['11']);
    const e2 = { b192: fromBits('11000000'), d190: 190, b191: fromBits('10111111'), d189: 189 };
    const top = Object.entries(e2).sort((a, b) => b[1] - a[1])[0][0];
    expect(choice('exit', 'e2').options.find((o) => o.correct)!.id).toBe(top);
    expect(fewestBits(1200)).toBe(11);
    expect(right(choice('exit', 'e3'))).toEqual(['11']);
    const e4 = text('exit', 'e4');
    expect(e4.expect).toBeUndefined();
    expect(e4.minWords).toBeGreaterThan(0);
  });

  it('the earlier steps', () => {
    expect(text('switches', 'four').expect!.test('16')).toBe(true);
    expect(right(choice('switches', 'rule'))).toEqual(['2ⁿ']);
    expect(text('bits', 'byte').expect!.test('256')).toBe(true);
    expect(16 + 8 + 4 + 2 + 1).toBe(31);
    expect(fromBits('00000011')).toBe(3);
    expect(fromBits('11000000')).toBe(192);
  });
});

describe('binary-numbers: typed answers', () => {
  it('accepts the ways students write numbers', () => {
    const re = num(45);
    for (const ok of ['45', ' 45 ', '45.', '32 + 8 + 4 + 1 = 45', '32+8+4+1=45', '45 in decimal']) expect(re.test(ok), ok).toBe(true);
    for (const bad of ['450', '145', '4 5', '44', '', '45 = 32 + 8 + 4 + 1']) expect(re.test(bad), bad).toBe(false);
    expect(text('limits', 'w12-values').expect!.test('2^6 = 64')).toBe(true);
    expect(text('limits', 'w12-values').expect!.test('64 values')).toBe(true);
    expect(text('switches', 'four').expect!.test('16 patterns')).toBe(true);
  });

  it('accepts a count written as a power of 2', () => {
    const re = count(256);
    for (const ok of ['256', '2^8', '2 ^ 8', '2**8', '2⁸', '2^8 = 256', '2⁸ patterns', '256 patterns']) expect(re.test(ok), ok).toBe(true);
    for (const bad of ['2^7', '2^81', '28', '2⁸ = 255', '255']) expect(re.test(bad), bad).toBe(false);
    expect(text('bits', 'byte').expect!.test('2^8')).toBe(true);
    expect(text('switches', 'four').expect!.test('2⁴')).toBe(true);
    expect(text('limits', 'w12-values').expect!.test('2**6')).toBe(true);
    // Not a power of 2: a plain number only.
    expect(count(100).test('100')).toBe(true);
  });

  it('accepts the ways students write ranges', () => {
    const re = rangeRe(0, 63);
    for (const ok of ['0 to 63', '0-63', '0 - 63', '0–63', 'from 0 to 63', '0 through 63', '0...63', '0 to 63 values', 'From 0 To 63.']) expect(re.test(ok), ok).toBe(true);
    for (const bad of ['0 to 64', '1 to 63', '63', '0 to 630']) expect(re.test(bad), bad).toBe(false);
  });

  it('answers the common mistakes, binary to decimal', () => {
    const fb = (id: string, v: string) => wrongFeedback(text('practice-decimal', id), v);
    // Read from the wrong end.
    expect(fb('w1', '80')).toMatch(/wrong end/);
    expect(fb('w2', '180')).toMatch(/wrong end/);
    expect(fb('w3', '38')).toMatch(/wrong end/);
    // Counted the 1s.
    expect(fb('w2', '4')).toMatch(/how many 1s/);
    expect(fb('w4', '8')).toMatch(/how many 1s/);
    // 256 for 11111111.
    expect(fb('w4', '256')).toMatch(/256 is how many patterns/);
    // A sum that skipped one of the 1s names the place it skipped.
    expect(fb('w2', '32 + 8 + 4 = 44')).toBe('That sum leaves out the 1s place, which holds a 1 too.');
    expect(fb('w3', '36')).toMatch(/leaves out the 64s place/);
    expect(fb('w4', '254')).toMatch(/leaves out the 1s place/);
    // Counting the 1s wins over a skipped place when they give the same number.
    expect(fb('w1', '2')).toMatch(/how many 1s/);
    // The right places with a wrong total: an adding slip.
    expect(fb('w4', '128 + 64 + 32 + 16 + 8 + 4 + 2 + 1 = 245')).toBe('Not quite. You picked the right places. Add them up again.');
    expect(fb('w2', '1+4+8+32=46')).toMatch(/right places/);
    // Anything else gets the general hint.
    expect(fb('w5', '130')).toBe(text('practice-decimal', 'w5').expectHint);
  });

  it('accepts the work without the total, binary to decimal', () => {
    const q = text('practice-decimal', 'w2');
    for (const ok of ['32+8+4+1', '32 + 8 + 4 + 1', '1 + 4 + 8 + 32', '32 + 8 + 4 + 1 = 45', '45']) expect(q.expect!.test(ok), ok).toBe(true);
    for (const no of ['32 + 8 + 4', '32 + 8 + 1', '32 + 8 + 4 + 1 = 44', '8 + 32 + 4 + 1 + 1']) expect(q.expect!.test(no), no).toBe(false);
    // A single 1: the number itself.
    expect(text('practice-decimal', 'w4').expect!.test('128+64+32+16+8+4+2+1')).toBe(true);
  });

  it('names the wrong place in typed work, binary to decimal', () => {
    const fb = (id: string, v: string) => wrongFeedback(text('practice-decimal', id), v);
    // 01100100: the 8s place holds a 0, and the 4s place holds the 1.
    const both = "The 8s place holds a 0, so don't add 8. The sum also leaves out the 4s place, which holds a 1.";
    expect(fb('w3', '64+32+8')).toBe(both);
    expect(fb('w3', '64 + 32 + 8 = 104.')).toBe(both);
    expect(fb('w3', '64 + 32 + 4 + 8')).toBe("The 8s place holds a 0, so don't add 8.");
    // 00101101 without the 4s place, with or without a total.
    expect(fb('w2', '32 + 8 + 1')).toBe('That sum leaves out the 4s place, which holds a 1 too.');
    expect(fb('w2', '1 + 8 + 32 = 41')).toBe('That sum leaves out the 4s place, which holds a 1 too.');
    expect(fb('w1', '8 + 2 + 1')).toBe("The 1s place holds a 0, so don't add 1.");
    // Both slips in one try: name both.
    expect(fb('w2', '32 + 8 + 2 + 1 = 43')).toBe("The 2s place holds a 0, so don't add 2. The sum also leaves out the 4s place, which holds a 1.");
    expect(fb('w4', '128 + 64 + 32 + 16 + 8 + 4 + 2')).toMatch(/leaves out the 1s place/);
    // 41 is not the 4s place.
    expect(fb('w2', '32 + 8 + 41')).toBe('That sum leaves out the 4s place, which holds a 1 too.');
  });

  it('answers the common mistakes, decimal to binary', () => {
    const fb = (id: string, v: string) => wrongFeedback(text('practice-binary', id), v);
    expect(fb('w6', '1101')).toMatch(/write all 8/);
    expect(fb('w7', '110010')).toMatch(/write all 8/);
    // Some of the 0s in front, not all: still the right bits.
    expect(fb('w7', '0110010')).toBe('Right bits, but write all 8. Put one more 0 in front.');
    expect(fb('w6', '001101')).toBe('Right bits, but write all 8. Put 2 more 0s in front.');
    expect(fb('w6', '10110000')).toMatch(/reverse order/);
    expect(fb('w9', '00010011')).toMatch(/reverse order/);
    expect(fb('w6', '13')).toMatch(/only the digits 0 and 1/);
    expect(fb('w8', '0100110')).toMatch(/You wrote 7 bits\./);
    // Seven 1s for 255: don't tell them to add a 0.
    expect(fb('w10', '1111111')).not.toMatch(/0s in front/);
    expect(fb('w8', '001001101')).toMatch(/exactly 8 bits/);
    expect(fb('w10', '100000000')).toMatch(/That's 256/);
    // Any other byte: say what it makes.
    expect(fb('w10', '11111110')).toBe('Not quite. Your bits make 254, which is 1 less than 255. Ask "does it fit?" at each place again.');
    expect(fb('w6', '00001111')).toMatch(/make 15, which is 2 more than 13/);
  });

  it('asks for digits when a number is written in words', () => {
    const digits = 'Write the number with digits, like 7 instead of seven.';
    expect(wrongFeedback(text('switches', 'four'), 'sixteen')).toBe(digits);
    expect(wrongFeedback(text('bits', 'byte'), 'two hundred fifty six')).toBe(digits);
    expect(wrongFeedback(text('limits', 'w13'), 'Seven')).toBe(digits);
    expect(wrongFeedback(text('practice-decimal', 'w1'), 'eleven')).toBe(digits);
    expect(wrongFeedback(text('practice-decimal', 'w4'), 'two hundred fifty-five')).toBe(digits);
    // Digits still pass, and words with "one" inside them are not number words.
    expect(text('switches', 'four').expect?.test('16 patterns')).toBe(true);
    expect(wrongFeedback(text('limits', 'w13'), 'none')).not.toBe(digits);
  });

  it('answers the common mistakes about counting and overflow', () => {
    expect(wrongFeedback(text('bits', 'byte'), '255')).toMatch(/counting starts at 0/);
    expect(wrongFeedback(text('overflow', 'w14'), '10000')).toMatch(/needs 5 bits/);
    expect(wrongFeedback(text('overflow', 'w14'), '16')).toMatch(/true total/);
    expect(wrongFeedback(text('overflow', 'w14'), '1111')).toMatch(/one count up/);
    expect(wrongFeedback(text('limits', 'w12-range'), '0 to 64')).toMatch(/65 numbers/);
    expect(wrongFeedback(text('limits', 'w13'), '6')).toMatch(/too few/);
    const crash = choice('overflow', 'meaning').options.find((o) => o.id === 'crash')!;
    expect(crash.correct).toBeFalsy();
    expect(crash.feedback).toMatch(/keeps running/);
    const count = choice('compare', 'shortcut').options.find((o) => o.id === 'count')!;
    expect(count.feedback).toMatch(/00111111 has six 1s but is the smallest/);
  });
});

describe('binary-numbers: saving and resuming', () => {
  it('saves demo state, and a reload resumes it with goals kept', () => {
    const s = new LabSession(lab, fresh());
    s.demo('switches', { flip: 0 });
    s.demo('switches', { use: 2 });
    s.demo('switches', { flip: 0 });
    expect(s.goalDone('switches', 'one')).toBe(true);
    expect(s.goalDone('switches', 'two')).toBe(false);

    const again = new LabSession(lab, JSON.parse(JSON.stringify(s.progress)) as LabProgress);
    expect(again.replayWarning).toBe('');
    expect(again.goalDone('switches', 'one')).toBe(true);
    const st = again.demoState<SwitchesState>(again.demoSpec('switches')!);
    expect(st).toEqual({ n: 2, on: [true, false], seen: { 1: ['0', '1'], 2: ['00', '10'] } });
    // Pick up where they left off.
    again.demo('switches', { flip: 1 });
    again.demo('switches', { flip: 0 });
    expect(again.goalDone('switches', 'two')).toBe(true);
  });

  it('resumes mid-lesson on the same step with its demo where it was', () => {
    const s = new LabSession(lab, fresh());
    for (const id of ['switches', 'bits', 'cards']) {
      playStep(s, key[id]);
      expect(s.missing(), id).toEqual([]);
      s.goTo(s.progress.step + 1);
    }
    expect(s.step.id).toBe('to-decimal');
    s.demo('read', { tap: 1 });
    s.demo('read', { tap: 4 });
    const again = new LabSession(lab, JSON.parse(JSON.stringify(s.progress)) as LabProgress);
    expect(again.step.id).toBe('to-decimal');
    expect(again.demoState(again.demoSpec('read')!)).toEqual({ ex: 0, added: [1, 4] });
    expect(again.goalDone('to-decimal', 'ex1')).toBe(false);
    again.demo('read', { tap: 6 });
    expect(again.goalDone('to-decimal', 'ex1')).toBe(true);
    // Earlier steps' work came back too.
    expect(again.demoState<BitsState>(again.demoSpec('cards', 'cards')!, 'cards').bits).toBe('11111');
    expect(again.goalDone('cards', 'thirty-one')).toBe(true);
  });

  it('keeps each step its own scratch board', () => {
    const p = fresh();
    const s = new LabSession(lab, p);
    for (const id of ['switches', 'bits', 'cards', 'to-decimal']) {
      playStep(s, key[id]);
      s.goTo(s.progress.step + 1);
    }
    expect(s.step.id).toBe('practice-decimal');
    s.demo('board', { flip: 4 });
    expect(Object.keys(p.demos ?? {})).toContain('practice-decimal/board');
    expect(s.demoState<BitsState>(s.demoSpec('board')!, 'practice-binary').bits).toBe('00000000');
  });

  it('"Start over" restores a demo but keeps its goals', () => {
    const s = new LabSession(lab, fresh());
    playStep(s, key.switches);
    s.resetDemo('switches');
    expect(s.demoState<SwitchesState>(s.demoSpec('switches')!)).toEqual(switchesModel.init(demoSpec('switches', 'switches')));
    expect(s.goalDone('switches', 'three')).toBe(true);
  });

  it('a demo on another step does not finish this step', () => {
    const s = new LabSession(lab, fresh());
    // The board isn't on step 1, so this does nothing.
    s.demo('board', { flip: 0 });
    expect(s.progress.demos ?? {}).toEqual({});
  });

  it('a lesson update starts activities fresh but keeps answers and goals', () => {
    const s = new LabSession(lab, fresh());
    playStep(s, key.switches);
    const saved = JSON.parse(JSON.stringify(s.progress)) as LabProgress;
    saved.labVersion = lab.version - 1;
    const again = new LabSession(lab, saved);
    expect(again.replayWarning).toMatch(/lesson was updated/);
    expect(again.progress.demos).toEqual({});
    expect(again.goalDone('switches', 'three')).toBe(true);
    expect(again.answer('switches', 'four')?.correct).toBe(true);
  });

  it('leaves format slips out of the tries on the report', () => {
    const s = new LabSession(lab, fresh());
    const who = { id: 'x', name: 'Test Student', period: '', createdAt: 0 };
    const tries = (stepId: string, qId: string) => buildReport(lab, s.progress, who, 'submitted').questions.find((q) => q.step === stepId && q.id === qId)?.attempts;
    const answer = (stepId: string, qId: string, v: string) => {
      const q = text(stepId, qId);
      s.setDraft(stepId, q, v);
      return s.check(stepId, q);
    };
    // A number in words, then digits: one try.
    expect(answer('switches', 'four', 'sixteen')).toBe(false);
    expect(answer('switches', 'four', '16')).toBe(true);
    expect(s.answer('switches', 'four')?.attempts).toBe(2);
    expect(tries('switches', 'four')).toBe(1);
    // Right bits with 0s missing in front, then all 8: one try. A real mistake still counts.
    expect(answer('practice-binary', 'w6', '1101')).toBe(false);
    expect(answer('practice-binary', 'w6', '0001101')).toBe(false);
    expect(answer('practice-binary', 'w6', '00001100')).toBe(false);
    expect(answer('practice-binary', 'w6', '00001101')).toBe(true);
    expect(tries('practice-binary', 'w6')).toBe(2);
  });

  it('builds a report with no network', () => {
    const s = new LabSession(lab, fresh());
    for (let i = 0; i < lab.steps.length; i++) {
      playStep(s, key[s.step.id]);
      if (i < lab.steps.length - 1) s.goTo(i + 1);
    }
    const r = buildReport(lab, s.progress, { id: 'x', name: 'Test Student', period: '', createdAt: 0 }, 'submitted');
    expect(r.goals.every((g) => g.done)).toBe(true);
    expect(r.score.auto).toBe(r.score.autoMax);
    expect(r.questions.find((q) => q.id === 'e4')?.answer).toMatch(/overflow/i);
  });

  it('gives the optional extra challenge no points, so skipping it costs nothing', () => {
    const s = new LabSession(lab, fresh());
    const submitAt = lab.steps.findIndex((x) => x.kind === 'submit');
    for (let i = 0; i < submitAt; i++) {
      playStep(s, key[s.step.id]);
      s.goTo(i + 1);
    }
    const who = { id: 'x', name: 'Test Student', period: '', createdAt: 0 };
    const skipped = buildReport(lab, s.progress, who, 'submitted');
    expect(skipped.score.auto).toBe(skipped.score.autoMax);
    for (const x of [...skipped.goals, ...skipped.questions]) expect(!!x.extra, x.id).toBe(['hex', 'colors', 'text', 'meaning'].includes(x.step));

    for (let i = submitAt; i < lab.steps.length; i++) {
      playStep(s, key[s.step.id]);
      if (i < lab.steps.length - 1) s.goTo(i + 1);
    }
    const all = buildReport(lab, s.progress, who, 'submitted');
    expect(all.score.autoMax).toBe(skipped.score.autoMax);
    expect(all.score.auto).toBe(skipped.score.auto);
    expect(all.score.teacherMax).toBe(skipped.score.teacherMax);
  });

  it('reads the color and meaning demos the way the goals expect', () => {
    expect(colorHex('111111111000000000000000')).toBe('FF8000');
    expect(colorHex('111111111111111111111111')).toBe('FFFFFF');
    const spec = step('colors').demos![0] as BitsSpec;
    let st = bitsModel.init(spec);
    for (const m of key.colors.moves ?? []) if ('demo' in m) st = bitsModel.apply(spec, st, m.input);
    // Orange comes first: the first green bit on the way to yellow makes FF8000.
    expect(st.found).toEqual([0xff8000, 0xffff00, 0xffffff]);
  });
});
