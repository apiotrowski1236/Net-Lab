import type { Beat, Shown, Slot, TraceFrame, TraceObject, TraceStep, TraceVar } from '../java';

/** Fading a thing in or out, in ms. Not scaled, so a fast step still reads as a fade. */
export const FADE = 250;

const START = 450; // A moment to read the marked line.
const TEXT = 850; // How long each stage of working out an expression stays up.
const FLY = 650; // A value moving from one place to another.
const LAND = 250; // A pause after it lands.
const END = 1500; // How long the finished picture holds before the loop starts again.
const LONGEST = 7000; // A line that does a lot plays faster instead of taking longer.

export interface PlanRow {
  /** Where chips and glows find this row. */
  key: string;
  name: string;
  before?: Shown;
  after?: Shown;
  enterAt?: number;
  swapAt?: number;
  leaveAt?: number;
}

/** A method's variables, or an object. */
export interface PlanBox {
  id: number;
  label: string;
  rows: PlanRow[];
  enterAt?: number;
  leaveAt?: number;
  /** The method that is running. */
  current?: boolean;
}

export interface PlanText {
  text: string;
  at: number;
  until: number;
}

/** A value flying across the picture. `from` and `to` are row keys, `frame:<id>`, `strip`, or `out`. */
export interface PlanChip {
  text: string;
  from: string;
  to: string;
  at: number;
  until: number;
}

export interface PlanGlow {
  key: string;
  at: number;
  until: number;
}

/** One line's action, laid out in ms from the start of the loop. */
export interface StepPlan {
  total: number;
  frames: PlanBox[];
  objects: PlanBox[];
  texts: PlanText[];
  chips: PlanChip[];
  glows: PlanGlow[];
  /** The whole action in sentences, for the caption and for anyone not watching the picture. */
  say: string;
  /** Where Java goes after this line. */
  flow?: string;
  flowAt: number;
  printed?: string;
  printAt?: number;
}

export const slotKey = (s: Slot) => ('frame' in s ? `f${s.frame}:${s.name}` : `o${s.obj}:${s.name}`);

const same = (a?: Shown, b?: Shown) => JSON.stringify(a) === JSON.stringify(b);

function mergeRows(prefix: string, was: TraceVar[] = [], now: TraceVar[] = []): PlanRow[] {
  const names = [...new Set([...was, ...now].map((v) => v.name))];
  return names.map((name) => ({ key: `${prefix}:${name}`, name, before: was.find((v) => v.name === name)?.value, after: now.find((v) => v.name === name)?.value }));
}

function mergeFrames(was: TraceFrame[], now: TraceFrame[], current?: number): PlanBox[] {
  const ids = [...new Set([...was, ...now].map((f) => f.id))].sort((a, b) => a - b);
  return ids.map((id) => {
    const a = was.find((f) => f.id === id);
    const b = now.find((f) => f.id === id);
    return { id, label: (a ?? b)!.label, rows: mergeRows(`f${id}`, a?.vars, b?.vars), current: id === current };
  });
}

function mergeObjects(was: TraceObject[], now: TraceObject[]): PlanBox[] {
  const ids = [...new Set([...was, ...now].map((o) => o.id))].sort((a, b) => a - b);
  return ids.map((id) => {
    const a = was.find((o) => o.id === id);
    const b = now.find((o) => o.id === id);
    return { id, label: `${(a ?? b)!.label} #${id}`, rows: mergeRows(`o${id}`, a?.fields, b?.fields) };
  });
}

/** A list in a sentence: "a, b and c". */
function listed(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function layout(step: TraceStep, next: TraceStep | undefined, cut: boolean, speed: number): StepPlan {
  const after = next ?? step;
  const frames = mergeFrames(step.frames, after.frames, step.frames[step.frames.length - 1]?.id);
  const objects = mergeObjects(step.objects, after.objects);
  const rows = new Map([...frames, ...objects].flatMap((b) => b.rows).map((r) => [r.key, r]));
  const objectLabel = new Map(objects.map((o) => [o.id, o.label]));
  const held = (v: Shown) => (v.t === 'null' ? 'null' : v.t === 'value' ? v.text : (objectLabel.get(v.id) ?? `#${v.id}`));
  const inScene = (at: string) => rows.has(at) || at === 'strip' || at === 'out' || frames.some((f) => at === `frame:${f.id}`);

  const texts: PlanText[] = [];
  const chips: PlanChip[] = [];
  const glows: PlanGlow[] = [];
  const say: string[] = [];
  let printed: string | undefined;
  let printAt: number | undefined;
  let t = START * speed;
  // Where the value in hand is, and whether the strip is already showing it.
  let cursor = 'strip';
  let showing = false;

  const write = (text: string) => {
    texts.push({ text, at: t, until: 0 });
    t += TEXT * speed;
    showing = true;
  };
  const fly = (text: string, to: string) => {
    if (inScene(cursor) && inScene(to)) chips.push({ text, from: cursor, to, at: t, until: t + FLY * speed });
  };
  const leaving = (id: number) => {
    const f = frames.find((b) => b.id === id);
    if (f && !after.frames.some((x) => x.id === id)) f.leaveAt = t;
  };

  const play = (b: Beat, i: number, all: Beat[]) => {
    switch (b.k) {
      case 'eval':
        for (const s of b.steps) write(s);
        for (const r of b.reads) glows.push({ key: slotKey(r), at: START * speed, until: t });
        cursor = 'strip';
        break;
      case 'write': {
        if (!showing) write(`${b.name} = ${held(b.value)}`);
        const key = b.to ? slotKey(b.to) : '';
        const row = rows.get(key);
        fly(held(b.value), key);
        t += FLY * speed;
        if (row?.before === undefined && row) row.enterAt = t;
        else if (row && !same(row.before, row.after)) row.swapAt = t;
        else if (row) glows.push({ key, at: t, until: t + LAND * 2 * speed });
        t += LAND * speed;
        const place = b.to && 'obj' in b.to && !/^\d/.test(b.to.name) ? `${b.to.name} in ${objectLabel.get(b.to.obj) ?? 'the object'}` : b.name;
        if (b.value.t === 'ref') say.push(`${place} now refers to ${held(b.value)}.`);
        else say.push(b.declares || row?.before === undefined ? `${place} is created and gets ${held(b.value)}.` : `${place} becomes ${held(b.value)}.`);
        cursor = 'strip';
        showing = false;
        break;
      }
      case 'new': {
        const o = objects.find((x) => x.id === b.id);
        write(`new ${b.cls}`);
        if (o && !step.objects.some((x) => x.id === b.id)) o.enterAt = t - TEXT * speed;
        say.push(`new makes an empty ${b.cls} object. Its instance variables start at their default values.`);
        showing = false;
        break;
      }
      case 'call': {
        write(b.text);
        cursor = 'strip';
        const f = frames.find((x) => x.id === b.frame);
        if (f) f.enterAt = t;
        for (const a of b.args) fly(held(a.value), `f${b.frame}:${a.name}`);
        t += FLY * speed;
        for (const a of b.args) {
          const row = rows.get(`f${b.frame}:${a.name}`);
          if (row) row.enterAt = t;
        }
        t += LAND * speed;
        const given = b.args.filter((a) => a.name !== 'this').map((a) => `${a.name} gets ${held(a.value)}`);
        say.push(`Java jumps into ${b.ctor ? 'the constructor' : b.name}${given.length ? `: ${listed(given)}` : ''}.`);
        showing = false;
        break;
      }
      case 'return': {
        const caller = after.frames[after.frames.length - 1];
        cursor = frames.some((f) => f.id === b.frame) ? `frame:${b.frame}` : 'strip';
        if (b.value) {
          texts.push({ text: `gives back ${held(b.value)}`, at: t, until: 0 });
          fly(held(b.value), caller ? `frame:${caller.id}` : 'strip');
        } else {
          texts.push({ text: `end of ${b.name}`, at: t, until: 0 });
        }
        t += (b.value ? FLY + LAND : TEXT) * speed;
        leaving(b.frame);
        const back = caller?.label.split('.').pop() ?? '';
        if (b.ctor) say.push(`The constructor ends, and new gives back ${held(b.value!)}.`);
        else if (b.value) say.push(`${b.name} gives back ${held(b.value)} and ends.`);
        else say.push(`${b.name} ends, and Java goes back to ${back}.`);
        cursor = caller ? `frame:${caller.id}` : 'strip';
        showing = !!b.value;
        break;
      }
      case 'branch': {
        const word = b.kind === 'each' ? (b.taken ? 'next item' : 'no more items') : String(b.taken);
        if (!showing) write(word);
        if (b.kind === 'if') say.push(`The condition is ${b.taken}, so Java ${b.taken ? 'runs the if block' : b.hasElse ? 'runs the else block' : 'skips the if block'}.`);
        else if (b.kind === 'loop') say.push(`The condition is ${b.taken}, so ${b.taken ? 'Java runs the loop body' : 'the loop ends'}.`);
        else say.push(b.taken ? 'Java takes the next item.' : 'There are no more items, so the loop ends.');
        showing = false;
        // A for-each moves straight on to storing the item.
        if (all[i + 1]?.k === 'write') showing = true;
        break;
      }
      case 'jump':
        write(b.word);
        say.push(b.word === 'break' ? 'break leaves the loop.' : 'continue skips to the next turn of the loop.');
        showing = false;
        break;
      case 'print': {
        const line = b.text.replace(/\n$/, '');
        if (!showing) write(JSON.stringify(line));
        fly(line, 'out');
        t += FLY * speed;
        printAt ??= t;
        printed = (printed ?? '') + b.text;
        t += LAND * speed;
        say.push(line ? `This prints ${line}.` : 'This prints an empty line.');
        cursor = 'strip';
        showing = false;
        break;
      }
    }
  };

  // The end of main has nowhere to go back to.
  const beats = step.beats.filter((b) => next || b.k !== 'return');
  beats.forEach(play);

  // Anything the beats didn't place still has to change, once they are done.
  for (const b of [...frames, ...objects]) {
    const was = 'current' in b ? step.frames.some((f) => f.id === b.id) : step.objects.some((o) => o.id === b.id);
    const now = 'current' in b ? after.frames.some((f) => f.id === b.id) : after.objects.some((o) => o.id === b.id);
    if (!was) b.enterAt ??= t;
    if (!now) b.leaveAt ??= t;
    if (!was || !now) continue;
    for (const r of b.rows) {
      if (r.before === undefined) r.enterAt ??= t;
      else if (r.after === undefined) r.leaveAt ??= t;
      else if (!same(r.before, r.after)) r.swapAt ??= t;
    }
  }

  const flowAt = t;
  const total = t + END * speed;
  texts.forEach((x, i) => (x.until = texts[i + 1]?.at ?? total - FADE));
  if (next) {
    if (!say.length) say.push(`Java moves on to line ${next.line}.`);
  } else {
    say.push(cut ? 'This program has more steps than can be shown.' : 'This is the end of the program.');
  }
  const flow = next && (next.file === step.file ? `Next: line ${next.line}` : `Next: ${next.file}, line ${next.line}`);
  return { total, frames, objects, texts, chips, glows, say: say.join(' '), flow, flowAt, printed, printAt };
}

/** Works out how to play what the marked line does: `next` is the step after it. */
export function planStep(step: TraceStep, next: TraceStep | undefined, cut = false): StepPlan {
  const plan = layout(step, next, cut, 1);
  return plan.total > LONGEST ? layout(step, next, cut, LONGEST / plan.total) : plan;
}
