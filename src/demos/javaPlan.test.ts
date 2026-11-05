import { describe, expect, test } from 'vitest';
import { compile, runProgram } from '../java';
import { firstTimeAt, planStep, slotKey } from './javaPlan';

function trace(main: string, cls = '') {
  const { program, errors } = compile([{ name: 'Main.java', text: `public class Main {\n  public static void main(String[] args) {\n${main}\n  }\n}\n${cls}` }]);
  expect(errors).toEqual([]);
  return runProgram(program!, { mainClass: 'Main', trace: true }).trace!;
}

const plans = (steps: ReturnType<typeof trace>) => steps.map((s, i) => planStep(s, steps[i + 1], false, firstTimeAt(steps, i)));
const words = (steps: ReturnType<typeof trace>) => plans(steps).map((p) => p.say).join('\n');

const BOX = `class Box {
  private int size;
  public Box(int startSize) {
    size = startSize;
  }
  public int getSize() {
    return size;
  }
  public void grow(int by) {
    size += by;
  }
}`;

describe('planStep', () => {
  test('each idea is explained once, at the first line that shows it', () => {
    const steps = trace('Box a = new Box(1);\nBox b = new Box(2);\na.grow(1);', BOX);
    const says = plans(steps).map((p) => p.say);
    const count = (text: string) => says.filter((s) => s.includes(text)).length;
    expect(says.find((s) => s.includes('default values'))).toContain('Java jumps into the constructor: startSize gets 1.');
    expect(count('default values')).toBe(1);
    expect(count('The word `this` means the object the code is working on. Here that is Box #1.')).toBe(1);
    expect(count('where the object is, not the object itself')).toBe(1);
    expect(count('b now refers to Box #2.')).toBe(1);
    expect(count("The constructor's box of variables goes away, but objects stay.")).toBe(1);
    expect(count('box of variables')).toBe(1);
    expect(count('`new` makes an empty Box object.')).toBe(2);
  });

  test('a new variable appears when its value lands', () => {
    const steps = trace('int total = 2 + 3;\nSystem.out.println(total);');
    const [first] = plans(steps);
    expect(first.texts.map((t) => t.text)).toEqual(['2 + 3', '5']);
    expect(first.say).toBe('total is created and gets 5.');
    const row = first.frames[0].rows.find((r) => r.name === 'total')!;
    expect(row.enterAt).toBe(first.chips[0].until);
    expect(first.chips[0]).toMatchObject({ text: '5', from: 'strip', to: row.key });
  });

  test('an assignment shows its working, swaps the value, and lights what it read', () => {
    const steps = trace('int a = 4;\nint b = 1;\nb = a * 2;');
    const third = plans(steps)[2];
    expect(third.texts.map((t) => t.text)).toEqual(['a * 2', '4 * 2', '8']);
    const b = third.frames[0].rows.find((r) => r.name === 'b')!;
    expect(b.before).toEqual({ t: 'value', text: '1' });
    expect(b.after).toEqual({ t: 'value', text: '8' });
    expect(b.swapAt).toBe(third.chips[0].until);
    expect(third.glows.map((g) => g.key)).toEqual([third.frames[0].rows.find((r) => r.name === 'a')!.key]);
  });

  test('parentheses in the working match the source', () => {
    const steps = trace('int a = 4;\nint b = (a + 1) * 2 - (a - 1);');
    expect(plans(steps)[1].texts.map((t) => t.text)).toEqual(['(a + 1) * 2 - (a - 1)', '(4 + 1) * 2 - (4 - 1)', '7']);
  });

  test('a call opens a frame, and fills its parameters as they arrive', () => {
    const steps = trace('Box b = new Box(3);', BOX);
    const first = plans(steps)[0];
    expect(first.say).toBe('`new` makes an empty Box object.\nIts instance variables start at their default values: 0 for an int, and null for a String. `null` means no object at all.\nJava jumps into the constructor: startSize gets 3.');
    const ctor = first.frames[1];
    expect(ctor.enterAt).toBeDefined();
    expect(ctor.rows.map((r) => r.name)).toEqual(['this', 'startSize']);
    expect(ctor.rows.every((r) => r.enterAt !== undefined)).toBe(true);
    expect(first.objects[0].enterAt).toBeLessThan(ctor.enterAt!);
  });

  test('a value given back carries on to the variable that takes it, and the frame goes', () => {
    const steps = trace('Box b = new Box(3);\nint n = b.getSize();', BOX);
    const at = steps.findIndex((s) => s.beats.some((x) => x.k === 'return' && x.name === 'getSize'));
    const p = planStep(steps[at], steps[at + 1]);
    expect(p.say).toBe('getSize gives back 3 and ends.\nn is created and gets 3.');
    expect(p.frames[1].leaveAt).toBeGreaterThanOrEqual(p.chips[0].until);
    const main = p.frames[0];
    expect(p.chips.map((c) => [c.from, c.to])).toEqual([
      [`frame:${p.frames[1].id}`, `frame:${main.id}`],
      [`frame:${main.id}`, main.rows.find((r) => r.name === 'n')!.key],
    ]);
  });

  test('a method with no return value says where Java goes back to', () => {
    const steps = trace('Box b = new Box(3);\nb.grow(2);', BOX);
    const at = steps.findIndex((s) => s.beats.some((x) => x.k === 'return' && x.name === 'grow'));
    expect(planStep(steps[at], steps[at + 1]).say).toBe('grow ends, and Java goes back to main.');
  });

  test('a write to an object names the object', () => {
    const steps = trace('Box b = new Box(3);\nb.grow(2);', BOX);
    const at = steps.findIndex((s) => s.beats.some((x) => x.k === 'write' && x.name === 'size' && x.value.t === 'value' && x.value.text === '5'));
    const p = planStep(steps[at], steps[at + 1]);
    expect(p.say).toBe('size in Box #1 becomes 5.');
    expect(p.texts.map((t) => t.text)).toEqual(['size + by', '3 + 2', '5']);
    expect(p.objects[0].rows.find((r) => r.name === 'size')?.swapAt).toBeDefined();
  });

  test.each([
    ['if (a > 5) {\n  a = 1;\n}', '`3 > 5` is false, so Java skips the if block.'],
    ['if (a > 1) {\n  a = 1;\n}', '`3 > 1` is true, so Java runs the if block.'],
    ['if (a > 5) {\n  a = 1;\n} else {\n  a = 2;\n}', '`3 > 5` is false, so Java runs the else block.'],
  ])('%s', (code, said) => {
    const steps = trace(`int a = 3;\n${code}`);
    expect(plans(steps)[1].say).toBe(said);
  });

  test('a for loop counts up on its own line, then tests', () => {
    const steps = trace('for (int i = 0; i < 2; i++) {\n  System.out.print(i);\n}');
    const lines = steps.map((s) => s.line);
    expect(lines).toEqual([3, 4, 3, 4, 3, 6]);
    expect(plans(steps)[0].say).toBe('i is created and gets 0.\n`0 < 2` is true, so Java runs the loop body.');
    const again = plans(steps)[2];
    expect(again.texts.map((t) => t.text)).toEqual(['i + 1', '0 + 1', '1', 'i < 2', '1 < 2', 'true']);
    expect(again.say).toBe('i becomes 1.\n`1 < 2` is true, so Java runs the loop body.');
    expect(plans(steps)[4].say).toBe('i becomes 2.\n`2 < 2` is false, so the loop ends.');
  });

  test('a for-each stops on its own line for each item', () => {
    const steps = trace('int[] xs = {7, 8};\nfor (int x : xs) {\n  System.out.print(x);\n}');
    const p = plans(steps);
    expect(steps.map((s) => s.line)).toEqual([3, 4, 5, 4, 5, 4, 7]);
    expect(p[1].say).toBe('Java takes the next item.\nx is created and gets 7.');
    expect(p[3].say).toBe('Java takes the next item.\nx becomes 8.');
    expect(p[5].say).toBe('There are no more items, so the loop ends.');
  });

  test('printing lands in the output', () => {
    const steps = trace('System.out.println("hi");');
    const [first] = plans(steps);
    expect(first.say).toBe('This prints hi.');
    expect(first.printed).toBe('hi\n');
    expect(first.chips[0].to).toBe('out');
    expect(first.printAt).toBe(first.chips[0].until);
  });

  test('break says it leaves', () => {
    const steps = trace('while (true) {\n  break;\n}');
    expect(plans(steps).some((p) => p.say === 'break leaves the loop.')).toBe(true);
  });

  test('the last step has nowhere to go next', () => {
    const steps = trace('int a = 1;');
    const last = planStep(steps[steps.length - 1], undefined);
    expect(last.say).toBe('This is the end of the program.');
    expect(last.flow).toBeUndefined();
    expect(planStep(steps[steps.length - 1], undefined, true).say).toBe('This program has more steps than can be shown.');
  });

  test('flow names another file only when Java changes files', () => {
    const steps = trace('int a = 1;\nint b = 2;');
    expect(planStep(steps[0], steps[1]).flow).toBe('Next: line 4');
    expect(planStep(steps[0], { ...steps[1], file: 'Box.java' }).flow).toBe('Next: Box.java, line 4');
  });

  test('a line that does a lot plays faster, not longer', () => {
    const steps = trace('int a = 1;\nint b = a + a + a + a + a + a + a + a + a + a;\nb = b + b * 2 - a;\nb = (b > 1) ? (b - 1) * 2 : b + 1;');
    for (const p of plans(steps)) {
      expect(p.total).toBeLessThanOrEqual(7001);
      for (const t of p.texts) expect(t.at).toBeLessThan(p.total);
    }
  });

  test('slot keys tell a variable from an object field', () => {
    expect(slotKey({ frame: 2, name: 'a' })).toBe('f2:a');
    expect(slotKey({ obj: 2, name: 'a' })).toBe('o2:a');
  });
});

describe('captions', () => {
  test('a program that crashes does not say it reached its end', () => {
    const steps = trace('int zero = 0;\nint z = 1 / zero;');
    const last = planStep(steps[steps.length - 1], undefined, false, {}, 'ArithmeticException').say;
    expect(last).toContain('The program stops with an error: `ArithmeticException`.');
    expect(last).not.toContain('This is the end of the program.');
  });

  test('a for-each left by break still has items', () => {
    const say = words(trace('int[] a = {1, 2, 3};\nfor (int x : a) {\nif (x == 2) {\nbreak;\n}\n}'));
    expect(say).toContain('break leaves the loop.');
    expect(say).not.toContain('There are no more items');
  });

  test('a for-each that finishes says so', () => {
    expect(words(trace('int[] a = {1};\nfor (int x : a) {\nint y = x;\n}'))).toContain('There are no more items, so the loop ends.');
  });

  test('a static variable that changes is not created again', () => {
    const steps = trace('C.bump();\nC.bump();', 'class C {\n  static int count = 0;\n  static void bump() {\n    count = count + 1;\n    count++;\n  }\n}');
    const say = words(steps);
    expect(say).toContain('count becomes 1.');
    expect(say).not.toContain('count is created');
  });

  test('a field with a starting value says so on its own line', () => {
    const say = words(trace('Tape t = new Tape();', 'class Tape {\n  private int plays = 5;\n}'));
    expect(say).toContain('plays in Tape #1 becomes 5.');
  });
});

describe('the trace', () => {
  test('a plain Object can be stepped through', () => {
    const steps = trace('Object o = new Object();\nint a = 1;');
    expect(steps[steps.length - 1].objects).toMatchObject([{ label: 'Object', fields: [] }]);
  });

  test('values a line produces come before the step that shows them', () => {
    const steps = trace('int a = 1;\na = a + 1;');
    expect(steps[1].frames[0].vars.find((v) => v.name === 'a')?.value).toEqual({ t: 'value', text: '1' });
    expect(steps[2].frames[0].vars.find((v) => v.name === 'a')?.value).toEqual({ t: 'value', text: '2' });
  });

  test("showing a program never runs the student's toString", () => {
    const steps = trace('T t = new T();\nObject o = t;', 'class T {\n  public String toString() {\n    System.out.println("ran");\n    return "x";\n  }\n}');
    const words = plans(steps)
      .flatMap((p) => [p.say, ...p.texts.map((t) => t.text)])
      .join(' ');
    expect(words).toContain('T #1');
    expect(words).not.toContain('ran');
  });
});
