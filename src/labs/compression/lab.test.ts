import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paintModel, type PaintState } from '../../demos/paint';
import {
  BEACH_H,
  BEACH_W,
  BLACK,
  changedPixels,
  compress,
  percentOf,
  picture,
  PICTURES,
  rawBytes,
  RECEIPT_TOTAL,
  resultOf,
  rowRuns,
  runsOf,
  shrink,
  SMILEY_ROWS,
  unRun,
  WHITE,
  YELLOW,
  type Method,
  type PictureId,
} from '../../demos/pictures';
import { pixelsModel } from '../../demos/pixels';
import { runWalkModel, runWalkFirstRow, runWalkTotal, readSoFar } from '../../demos/runWalk';
import { squareWalkModel, squareWalkTotal } from '../../demos/squareWalk';
import { squeezeModel, type SqueezeState } from '../../demos/squeeze';
import type { DemoInput, DemoModel, DemoSpec, PaintSpec, PixelsSpec, RunWalkSpec, SquareWalkSpec, SqueezeSpec } from '../../demos/types';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import { buildReport } from '../../store/report';
import { playStep } from '../solution';
import { isLesson, wrongFeedback, type ChoiceQuestion, type QuestionDef, type TextQuestion } from '../types';
import { money, num } from './answers';
import { compressionLab as lab } from '.';
import { compressionSolution as key } from './solution';

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

let count = 0;
function fresh(): LabProgress {
  const now = Date.now();
  return { labId: lab.id, labVersion: lab.version, studentId: `cmp-${count++}`, startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] };
}

function run<Spec extends DemoSpec, State>(model: DemoModel<Spec, State>, spec: Spec, inputs: DemoInput[]): State {
  return inputs.reduce((s, input) => model.apply(spec, s, input), model.init(spec));
}
const times = (n: number, input: DemoInput) => Array.from({ length: n }, () => input);

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
const text = (stepId: string, qId: string) => question(stepId, qId) as TextQuestion;
const choice = (stepId: string, qId: string) => question(stepId, qId) as ChoiceQuestion;
const option = (stepId: string, qId: string, id: string) => choice(stepId, qId).options.find((o) => o.id === id)!;
const demoSpec = <T extends DemoSpec>(stepId: string, id: string) => step(stepId).demos!.find((d) => d.id === id) as T;
const n = (v: number) => v.toLocaleString('en-US');

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x && typeof x === 'object' && !(x instanceof RegExp)) for (const v of Object.values(x)) strings(v, out);
  return out;
}

describe('compression: lesson shape', () => {
  it('is a lesson with no network', () => {
    expect(isLesson(lab)).toBe(true);
  });

  it('has a tour first, a review before submit, and the optional extra challenge after it', () => {
    const at = lab.steps.findIndex((s) => s.kind === 'submit');
    expect(at + 1).toBeGreaterThanOrEqual(9);
    expect(at + 1).toBeLessThanOrEqual(13);
    expect(lab.steps[0].id).toBe('pixels');
    expect(lab.steps[at - 1].id).toBe('review');
    expect(lab.steps.slice(at + 1).map((s) => s.id)).toEqual(['paint']);
    for (const s of lab.steps.slice(at + 1)) {
      expect(s.extra, s.id).toBe(true);
      expect(s.title, s.id).toMatch(/^Optional extra challenge: /);
    }
    expect(lab.steps.slice(0, at).some((s) => s.extra)).toBe(false);
  });

  it('gives every step except submit something to finish, and no more than 2 questions outside the review', () => {
    for (const s of lab.steps) {
      if (s.kind === 'submit') continue;
      expect((s.goals?.length ?? 0) + (s.questions?.length ?? 0), s.id).toBeGreaterThan(0);
      if (s.id !== 'review') expect(s.questions?.length ?? 0, s.id).toBeLessThanOrEqual(2);
    }
  });

  it('keeps demo ids unique within a step', () => {
    for (const s of lab.steps) {
      const ids = (s.demos ?? []).map((d) => d.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
    }
  });

  it('gives every wrong option feedback, and the right answer is not always the longest', () => {
    let longest = 0;
    let total = 0;
    for (const s of lab.steps)
      for (const q of s.questions ?? []) {
        if (q.kind !== 'choice') continue;
        total++;
        for (const o of q.options) if (!o.correct) expect(o.feedback, `${s.id}/${q.id}/${o.id}`).toBeTruthy();
        const right = q.options.find((o) => o.correct)!;
        if (q.options.every((o) => o === right || o.text.length < right.text.length)) longest++;
      }
    expect(longest).toBeLessThan(total / 2);
  });

  it('uses the house style in student text', () => {
    for (const t of strings(lab.steps)) {
      expect(t, t).not.toMatch(/—/);
      expect(t, t).not.toMatch(/\b(simply|just|easy|easier|obviously)\b/i);
      expect(t, t).not.toMatch(/\b(extra credit|bonus)\b/i);
      expect(t, t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('compression: the pictures', () => {
  const ids = Object.keys(PICTURES) as PictureId[];

  it('draws the same pictures every time', () => {
    for (const id of ids) expect(PICTURES[id].make(), id).toEqual(picture(id));
  });

  it('draws the smiley from its rows, in 3 colors', () => {
    const p = picture('smiley');
    expect([p.w, p.h]).toEqual([8, 8]);
    expect(SMILEY_ROWS.join('').length).toBe(64);
    expect(new Set(p.px.map(String)).size).toBe(3);
    expect(p.px[18]).toEqual(BLACK);
    expect(p.px[2]).toEqual(YELLOW);
  });

  it('rebuilds every picture exactly from its runs', () => {
    for (const id of ids) {
      const p = picture(id);
      expect(unRun(runsOf(p), p.w), id).toEqual(p);
      expect(resultOf(id, 'runs').changed, id).toBe(0);
    }
  });

  it('never runs past the end of a row, and caps a run at 255', () => {
    const row = Array.from({ length: 300 }, () => WHITE);
    expect(rowRuns(row).map((r) => r.count)).toEqual([255, 45]);
    // Two rows of one color are two runs, not one.
    expect(runsOf({ w: 2, h: 2, px: [WHITE, WHITE, WHITE, WHITE] }).flat().length).toBe(2);
  });

  it('rounds each average to a whole number', () => {
    const p = { w: 2, h: 2, px: [WHITE, BLACK, BLACK, BLACK] as const };
    expect(shrink({ ...p, px: [...p.px] }, 2).px[0]).toEqual([64, 64, 64]);
  });

  it('gives the smiley the numbers the lesson uses', () => {
    expect(rawBytes(picture('smiley'))).toBe(192);
    const runs = resultOf('smiley', 'runs');
    expect(runs.runs).toBe(26);
    expect(runs.bytes).toBe(104);
    expect(percentOf(runs.bytes, 192)).toBe('54%');
    expect(runsOf(picture('smiley')).map((r) => r.length)).toEqual([3, 3, 5, 1, 5, 3, 3, 3]);
    const avg = resultOf('smiley', 'avg2');
    expect(avg.bytes).toBe(48);
    expect(avg.changed).toBe(40);
  });

  it('makes the beach photo big enough that 2×2 looks close, and runs make it bigger', () => {
    const p = picture('beach');
    expect([p.w, p.h]).toEqual([BEACH_W, BEACH_H]);
    expect(rawBytes(p)).toBe(115200);
    const runs = resultOf('beach', 'runs');
    expect(runs.bytes).toBeGreaterThan(rawBytes(p));
    expect(percentOf(runs.bytes, rawBytes(p))).toBe('133%');
    expect([resultOf('beach', 'avg2').bytes, resultOf('beach', 'avg4').bytes, resultOf('beach', 'avg8').bytes]).toEqual([28800, 7200, 1800]);
    // Bigger squares change more of the photo.
    const moved = (m: Method) => {
      const r = resultOf('beach', m).rebuilt;
      return p.px.reduce((t, c, i) => t + Math.abs(c[0] - r.px[i][0]) + Math.abs(c[1] - r.px[i][1]) + Math.abs(c[2] - r.px[i][2]), 0);
    };
    expect(moved('avg2')).toBeLessThan(moved('avg4'));
    expect(moved('avg4')).toBeLessThan(moved('avg8'));
  });

  it('makes the receipt shrink more with runs than with 2×2, and adds up its total', () => {
    const p = picture('receipt');
    const runs = resultOf('receipt', 'runs');
    const avg = resultOf('receipt', 'avg2');
    expect(percentOf(runs.bytes, rawBytes(p))).toBe('17%');
    expect(runs.bytes).toBeLessThan(avg.bytes);
    expect(avg.changed).toBeGreaterThan(0);
    expect((950 + 275 + 180) / 100).toBe(Number(RECEIPT_TOTAL));
  });

  it('quotes the numbers the pictures really give', () => {
    const smiley = (m: Method) => resultOf('smiley', m);
    expect(option('side-by-side', 'trade', 'runs-smaller').feedback).toContain(`${smiley('runs').bytes} bytes`);
    expect(option('side-by-side', 'trade', 'runs-smaller').feedback).toContain(`${smiley('avg2').bytes}`);
    expect(option('side-by-side', 'trade', 'free').feedback).toContain(`${smiley('avg2').changed} of the 64`);
    expect(choice('side-by-side', 'trade').explain).toContain(`changed ${smiley('avg2').changed} pixels`);
    expect(text('side-by-side', 'saved').expect!.test(String(192 - smiley('runs').bytes))).toBe(true);
    const beach = (m: Method) => n(resultOf('beach', m).bytes);
    expect(option('bigger-squares', 'trend', 'bigger-file').feedback).toBe(`Look at the Size column: ${beach('avg2')} bytes for 2×2, ${beach('avg4')} for 4×4, and ${beach('avg8')} for 8×8.`);
    expect(choice('no-runs', 'receipt-why').prompt).toContain(percentOf(resultOf('receipt', 'runs').bytes, rawBytes(picture('receipt'))));
    expect(option('details', 'receipt-method', 'avg2').feedback).toContain(`${n(resultOf('receipt', 'runs').bytes)} bytes`);
    expect(option('details', 'receipt-method', 'none').feedback).toContain(`all ${n(64 * 96)} pixels`);
  });
});

describe('compression: demo models', () => {
  it('pixels: counts each color once', () => {
    const spec: PixelsSpec = demoSpec('pixels', 'pixels');
    let s = run(pixelsModel, spec, [{ peek: 0 }, { peek: 1 }, { peek: 2 }]);
    expect(pixelsModel.facts(spec, s)).toMatchObject({ colors: 2, total: 3, at: 2 });
    s = pixelsModel.apply(spec, s, { peek: 18 });
    expect(pixelsModel.facts(spec, s)).toMatchObject({ colors: 3, total: 3 });
  });

  it('run-walk: Skip to the end waits for the first row', () => {
    const enc: RunWalkSpec = demoSpec('runs', 'encode');
    expect(runWalkTotal(enc)).toBe(64);
    expect(runWalkFirstRow(enc)).toBe(8);
    expect(run(runWalkModel, enc, [...times(7, { advance: 1 }), { finish: true }]).pos).toBe(7);
    expect(run(runWalkModel, enc, [...times(8, { advance: 1 }), { finish: true }]).pos).toBe(64);
    expect(runWalkModel.apply(enc, { pos: 64 }, { advance: 1 }).pos).toBe(64);
    // Mid-row, the last run may still grow.
    expect(readSoFar(picture('smiley'), 11)).toEqual({ rows: [rowRuns(picture('smiley').px.slice(0, 8)), rowRuns(picture('smiley').px.slice(8, 11))], open: true });

    const dec: RunWalkSpec = demoSpec('rebuild-runs', 'decode');
    expect(runWalkTotal(dec)).toBe(26);
    expect(runWalkFirstRow(dec)).toBe(3);
    expect(runWalkModel.facts(dec, run(runWalkModel, dec, [...times(3, { advance: 1 }), { finish: true }]))).toEqual({ pos: 26, total: 26, done: true });
  });

  it('square-walk: Show what changed works only once the stretch is done', () => {
    const enc: SquareWalkSpec = demoSpec('average', 'encode');
    const dec: SquareWalkSpec = demoSpec('stretch', 'decode');
    expect(squareWalkTotal(enc)).toBe(16);
    expect(run(squareWalkModel, enc, [...times(3, { advance: 1 }), { finish: true }]).pos).toBe(3);
    const done = run(squareWalkModel, enc, [...times(4, { advance: 1 }), { finish: true }]);
    expect(done.pos).toBe(16);
    expect(squareWalkModel.apply(enc, done, { changes: true }).changes).toBe(false);
    expect(run(squareWalkModel, dec, [{ advance: 1 }, { changes: true }]).changes).toBe(false);
    const shown = run(squareWalkModel, dec, [...times(4, { advance: 1 }), { finish: true }, { changes: true }]);
    expect(squareWalkModel.facts(dec, shown)).toEqual({ pos: 16, total: 16, done: true, changes: true });
  });

  it('squeeze: remembers each picture and method tried, and ignores ones not offered', () => {
    const spec: SqueezeSpec = demoSpec('no-runs', 'squeeze');
    let s: SqueezeState = squeezeModel.init(spec);
    expect(s).toEqual({ picture: 'beach', method: 'none', changes: false, tried: ['beach:none'] });
    s = run(squeezeModel, spec, [{ method: 'runs' }, { picture: 'receipt' }, { method: 'avg2' }, { picture: 'receipt' }]);
    expect(s.tried).toEqual(['beach:none', 'beach:runs', 'receipt:runs']);
    expect(squeezeModel.facts(spec, s)).toMatchObject({ 'tried:receipt:runs': true, bytes: resultOf('receipt', 'runs').bytes, changed: 0 });
  });

  it('paint: a checkerboard makes runs bigger, and whole 2×2 squares survive averaging', () => {
    const spec: PaintSpec = demoSpec('paint', 'paint');
    const blank = paintModel.init(spec);
    expect(paintModel.facts(spec, blank)).toMatchObject({ runs: 8, runBytes: 32, raw: 192, changed: 0, colors: 1 });
    const checker = Array.from({ length: 64 }, (_, i) => i).filter((i) => ((i % 8) + Math.floor(i / 8)) % 2 === 0);
    const board = run(paintModel, spec, checker.map((paint) => ({ paint })));
    expect(paintModel.facts(spec, board)).toMatchObject({ runs: 64, runBytes: 256, raw: 192 });
    const lined = run(paintModel, spec, [0, 1, 8, 9].map((paint) => ({ paint })));
    expect(paintModel.facts(spec, lined)).toMatchObject({ colors: 2, changed: 0 });
    // The same square one pixel over straddles 4 averaging squares.
    const off: PaintState = run(paintModel, spec, [1, 2, 9, 10].map((paint) => ({ paint })));
    expect(paintModel.facts(spec, off).changed).toBeGreaterThan(0);
    expect(paintModel.apply(spec, blank, { clear: true })).toBe(blank);
    expect(paintModel.apply(spec, blank, { brush: 9 })).toBe(blank);
  });

  it('compress: no compression changes nothing, and averaging changes the smiley', () => {
    const p = picture('smiley');
    expect(compress(p, 'none')).toMatchObject({ bytes: 192, changed: 0 });
    expect(changedPixels(p, compress(p, 'avg8').rebuilt)).toBeGreaterThan(changedPixels(p, compress(p, 'avg2').rebuilt));
  });
});

describe('compression: typed answers', () => {
  it('accepts the ways students write numbers', () => {
    const re = num(192);
    for (const ok of ['192', ' 192 ', '192.', '192 bytes', '8 x 8 x 3 = 192', '64*3=192', '192 Bytes']) expect(re.test(ok), ok).toBe(true);
    for (const bad of ['1920', '19', '192 = 64 x 3', '', '64']) expect(re.test(bad), bad).toBe(false);
    expect(num(1536).test('1,536')).toBe(true);
    expect(num(1536).test('1536 bits')).toBe(true);
  });

  it('accepts the ways students write money', () => {
    const re = money(RECEIPT_TOTAL);
    for (const ok of ['14.05', '$14.05', '$ 14.05', '14,05', '14.05 dollars', '14.05.']) expect(re.test(ok), ok).toBe(true);
    for (const bad of ['14.5', '14.050', '1405', '14.06', '11.05', '$14']) expect(re.test(bad), bad).toBe(false);
  });

  it('answers the common mistakes', () => {
    expect(wrongFeedback(text('pixels', 'bytes'), '64')).toMatch(/number of pixels/);
    expect(wrongFeedback(text('pixels', 'bytes'), '1,536')).toMatch(/bits/);
    expect(wrongFeedback(text('pixels', 'bytes'), 'one hundred ninety-two')).toMatch(/digits/);
    expect(wrongFeedback(text('average', 'avg-red'), '600')).toMatch(/Divide it by 4/);
    expect(wrongFeedback(text('average', 'stored-bytes'), '16')).toMatch(/3 bytes/);
    expect(wrongFeedback(text('side-by-side', 'saved'), '104')).toMatch(/fewer bytes/);
    expect(wrongFeedback(text('details', 'total'), '16.05')).toMatch(/every digit is sharp/);
    expect(text('side-by-side', 'saved').expect!.test('192 - 104 = 88')).toBe(true);
    expect(text('average', 'avg-red').expect!.test('(200+200+100+100)/4 = 150')).toBe(true);
  });

  it('asks for a real explanation in the review', () => {
    const q4 = text('review', 'q4');
    expect(q4.expect).toBeUndefined();
    expect(q4.minWords).toBeGreaterThanOrEqual(25);
    expect(key.review.text!.q4.split(/\s+/).length).toBeGreaterThanOrEqual(q4.minWords!);
  });
});

describe('compression: saving and resuming', () => {
  it('resumes a walk-through where it was, with goals kept', () => {
    const s = new LabSession(lab, fresh());
    playStep(s, key.pixels);
    s.goTo(1);
    for (let i = 0; i < 8; i++) s.demo('encode', { advance: 1 });
    expect(s.goalDone('runs', 'row1')).toBe(true);
    s.demo('encode', { advance: 1 });
    const again = new LabSession(lab, JSON.parse(JSON.stringify(s.progress)) as LabProgress);
    expect(again.replayWarning).toBe('');
    expect(again.step.id).toBe('runs');
    expect(again.demoState(again.demoSpec('encode')!)).toEqual({ pos: 9 });
    expect(again.goalDone('runs', 'row1')).toBe(true);
    expect(again.goalDone('pixels', 'colors')).toBe(true);
    again.demo('encode', { finish: true });
    expect(again.goalDone('runs', 'all')).toBe(true);
  });

  it('keeps each step its own copy of Compare methods', () => {
    const p = fresh();
    const s = new LabSession(lab, p);
    for (const id of ['pixels', 'runs', 'rebuild-runs', 'average', 'stretch', 'side-by-side']) {
      playStep(s, key[id]);
      expect(s.missing(), id).toEqual([]);
      s.goTo(s.progress.step + 1);
    }
    expect(s.step.id).toBe('bigger-squares');
    expect(s.demoState<SqueezeState>(s.demoSpec('squeeze')!).picture).toBe('beach');
    expect(s.demoState<SqueezeState>(s.demoSpec('squeeze', 'side-by-side')!, 'side-by-side').tried).toContain('smiley:avg2');
    expect(Object.keys(p.demos ?? {})).toContain('side-by-side/squeeze');
  });

  it('builds a full report, and the optional extra challenge earns no points', () => {
    const s = new LabSession(lab, fresh());
    const submitAt = lab.steps.findIndex((x) => x.kind === 'submit');
    for (let i = 0; i < submitAt; i++) {
      playStep(s, key[s.step.id]);
      s.goTo(i + 1);
    }
    const who = { id: 'x', name: 'Test Student', period: '', createdAt: 0 };
    const skipped = buildReport(lab, s.progress, who, 'submitted');
    expect(skipped.score.auto).toBe(skipped.score.autoMax);
    for (const x of [...skipped.goals, ...skipped.questions]) expect(!!x.extra, x.id).toBe(x.step === 'paint');

    for (let i = submitAt; i < lab.steps.length; i++) {
      playStep(s, key[s.step.id]);
      if (i < lab.steps.length - 1) s.goTo(i + 1);
    }
    const all = buildReport(lab, s.progress, who, 'submitted');
    expect(all.goals.every((g) => g.done)).toBe(true);
    expect(all.score.autoMax).toBe(skipped.score.autoMax);
    expect(all.score.auto).toBe(skipped.score.auto);
    expect(all.questions.find((q) => q.id === 'q4')?.answer).toMatch(/lossless/i);
  });
});
