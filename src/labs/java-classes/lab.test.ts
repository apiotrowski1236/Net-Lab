import { describe, expect, test } from 'vitest';
import { javaModel, traceOf, type JavaState } from '../../demos/java';
import { planStep } from '../../demos/javaPlan';
import { objectsModel } from '../../demos/objects';
import type { JavaSpec, ObjectsSpec } from '../../demos/types';
import { LabSession } from '../../runtime/session';
import { buildReport } from '../../store/report';
import { playStep } from '../solution';
import { javaClassesLab } from './index';
import { javaClassesSolution } from './solution';

const spec = (step: string, demo: string): JavaSpec => javaClassesLab.steps.find((s) => s.id === step)!.demos!.find((d) => d.id === demo) as JavaSpec;

const run = (s: JavaSpec, state: JavaState = javaModel.init(s)) => javaModel.apply(s, state, { run: true });

function withEdits(s: JavaSpec, edits: Record<string, string>): JavaState {
  let state = javaModel.init(s);
  for (const [file, code] of Object.entries(edits)) state = javaModel.apply(s, state, { edit: file, code });
  return run(s, state);
}

describe('starting code', () => {
  test('step 1 runs and prints two players', () => {
    const r = run(spec('why', 'loose'));
    expect(r.last?.kind).toBe('ok');
    expect(r.last?.output).toBe('Ada has 70\nGrace has 80\n');
  });

  test('step 6 starts with the constructor error it promises', () => {
    const r = run(spec('fields-ctor', 'song'));
    expect(r.last?.kind).toBe('errors');
    expect(r.last?.errors?.[0].text).toContain('constructor Song in class Song cannot be applied to given types;');
    expect(r.last?.errors?.[0].help).toBe('Song has no constructor yet, so Java gives it a default constructor, which takes no values. You gave it 2. To pass values in, write a constructor for Song with parameters.');
  });

  test('the Pet bug prints what step 9 says', () => {
    expect(run(spec('this', 'pets')).last?.output).toBe('null is 0\nnull is 0\n');
  });

  test('opening a tab counts, and Main stays open until then', () => {
    const s = spec('anatomy', 'players');
    const start = javaModel.init(s);
    expect(javaModel.facts(s, start)['opened:Player.java']).toBeUndefined();
    expect(javaModel.facts(s, javaModel.apply(s, start, { tab: 'Player.java' }))['opened:Player.java']).toBe(true);
  });

  test('a compile error in Main holds a check of what Main prints', () => {
    const s = spec('anatomy', 'players');
    const start = javaModel.init(s).files[0].text;
    const r = withEdits(s, { 'Main.java': start.replace('ada.takeDamage(30);', 'ada.takeDamage(30)') });
    expect(r.last?.kind).toBe('errors');
    expect(r.held).toBe(true);
  });

  test('step 9 names the variable still missing', () => {
    const s = spec('this', 'pets');
    const start = javaModel.init(s).files[0].text;
    expect(withEdits(s, { 'Pet.java': start.replace('name = name;', 'this.name = name;') }).checks?.[0].note).toBe('age is still empty. In the constructor, write this.age on the left of the =.');
  });

  test('the step-through has the length the answer key plays', () => {
    const s = spec('trace', 'trace');
    expect(traceOf(s, javaModel.init(s).files).steps).toHaveLength(17);
  });

  test('Run stays on the tab the student is working in', () => {
    const r = run(spec('fields-ctor', 'song'));
    expect(r.last?.errors?.[0].file).toBe('Main.java');
    expect(r.open).toBe('Song.java');
  });
});

describe('step-through', () => {
  const s = spec('trace', 'trace');
  const steps = traceOf(s, javaModel.init(s).files).steps;
  const main = (i: number) => steps[i].frames[0].vars.map((v) => v.name);

  test('the last step still shows both players, since step 4 sends students there to compare', () => {
    const last = steps[steps.length - 1];
    expect(main(steps.length - 1)).toEqual(['ada', 'grace']);
    expect(last.objects.map((o) => o.label)).toEqual(['Player', 'Player']);
    expect(last.objects.map((o) => o.fields[1].value)).toEqual([
      { t: 'value', text: '70' },
      { t: 'value', text: '80' },
    ]);
  });

  test('main never shows its empty args array', () => {
    expect(main(0)).toEqual([]);
    expect(steps[0].objects).toEqual([]);
  });

  test('step 4 sends students to Step 2 to see the default', () => {
    const first = steps.findIndex((x) => x.frames.length === 2);
    expect(first).toBe(1);
  });

  test('step 9 explains why name = name changes nothing', () => {
    const pets = spec('this', 'pets');
    const trace = traceOf(pets, javaModel.init(pets).files).steps;
    const i = trace.findIndex((x) => x.file === 'Pet.java');
    expect(planStep(trace[i], trace[i + 1]).say).toBe('name here is the parameter, not the instance variable, so it stays "Biscuit". Pet #1 does not change.');
  });

  test('inside the constructor, health shows its default until it is set', () => {
    const first = steps.find((x) => x.frames.length === 2)!;
    expect(first.frames[1].label).toBe('Player constructor');
    expect(first.objects[0].fields).toEqual([
      { name: 'name', value: { t: 'null' } },
      { name: 'health', value: { t: 'value', text: '0' } },
    ]);
  });
});

describe('private', () => {
  test('reaching into health gives the private-access error', () => {
    const s = spec('private', 'guard');
    const code = javaModel.init(s).files[0].text.replace('// Your line goes here.', 'ada.health = -50;');
    const r = withEdits(s, { 'Main.java': code });
    expect(r.last?.errors?.[0]).toMatchObject({ code: 'private-access', help: 'health is private, so only code inside Player can change it. Call a public method of Player that changes it.' });
    expect(javaModel.facts(s, r).errors).toBe('private-access');
  });

  test('a locked file cannot be edited', () => {
    const s = spec('anatomy', 'players');
    const state = javaModel.init(s);
    expect(javaModel.apply(s, state, { edit: 'Player.java', code: 'nope' })).toBe(state);
  });
});

describe('checks', () => {
  const key = javaClassesSolution['fields-ctor'].moves!;
  const built = (key[0] as { input: { code: string } }).input.code;

  test('checks stop at the first thing left to do', () => {
    const s = spec('fields-ctor', 'song');
    const r = withEdits(s, { 'Song.java': 'public class Song {\n  private String title;\n  public Song(String a, String b) { }\n}\n' });
    expect(r.checks).toEqual([{ id: 'fields', ok: false, note: 'Song needs an instance variable called artist. Write: private String artist;' }, { id: 'ctor', ok: false }, { id: 'sets', ok: false }]);
  });

  test('an unstored parameter gets its own message', () => {
    const s = spec('fields-ctor', 'song');
    const r = withEdits(s, { 'Song.java': built.replace('title = songTitleIn;', '') });
    expect(r.checks?.[2].note).toBe('title is still null. In the constructor, store songTitleIn in the instance variable title.');
  });

  test('swapped parameters get their own message', () => {
    const s = spec('fields-ctor', 'song');
    const r = withEdits(s, { 'Song.java': built.replace('title = songTitleIn;', 'title = songArtistIn;').replace('artist = songArtistIn;', 'artist = songTitleIn;') });
    expect(r.checks?.[2].note).toBe('The title and the artist are swapped. Check which parameter goes where.');
  });

  test('finished parts count while Main still calls something unwritten', () => {
    const s = spec('fields-ctor', 'song');
    const r = withEdits(s, { 'Song.java': 'public class Song {\n  private String title;\n  private String artist;\n  private int plays;\n}\n' });
    expect(r.last?.kind).toBe('errors');
    expect(r.checks).toEqual([{ id: 'fields', ok: true }, { id: 'ctor', ok: false, note: 'Write a constructor: public Song(String songTitleIn, String songArtistIn). Write nothing between public and Song.' }, { id: 'sets', ok: false }]);
    expect(javaModel.facts(s, r)['check:fields']).toBe(true);
  });

  test('a class that does not compile keeps the last results, marked as held', () => {
    const s = spec('fields-ctor', 'song');
    const good = withEdits(s, { 'Song.java': built });
    expect(good.checks?.every((c) => c.ok)).toBe(true);
    expect(good.held).toBe(false);
    const bad = run(s, javaModel.apply(s, good, { edit: 'Song.java', code: built.replace('plays = 0;', 'plays = 0') }));
    expect(bad.last?.kind).toBe('errors');
    expect(bad.checks).toEqual(good.checks);
    expect(bad.held).toBe(true);
    expect(run(s, javaModel.apply(s, bad, { edit: 'Song.java', code: built })).held).toBe(false);
  });

  test('printing a whole Player explains the code it shows', () => {
    const s = spec('anatomy', 'players');
    const start = javaModel.init(s).files[0].text;
    const r = withEdits(s, { 'Main.java': start.replace('ada.takeDamage(30);', 'Player linus = new Player("Linus", 90);\n    System.out.println(linus);\n    ada.takeDamage(30);') });
    expect(r.checks?.[0].note).toMatch(/^Printing a Player object directly/);
  });

  test('comparing an object with > says to call a method', () => {
    const s = spec('anatomy', 'players');
    const start = javaModel.init(s).files[0].text;
    const r = withEdits(s, { 'Main.java': start.replace('ada.takeDamage(30);', 'boolean more = ada > 5;') });
    expect(r.last?.errors?.[0].help).toBe('> compares numbers, but one side here is a Player. Call a method on it that gives back a number.');
  });

  test('renaming the parameters fixes Pet, but the step asks for this', () => {
    const s = spec('this', 'pets');
    const start = javaModel.init(s).files[0].text;
    const r = withEdits(s, { 'Pet.java': start.replace('String name, int age', 'String n, int a').replace('name = name;', 'name = n;').replace('age = age;', 'age = a;') });
    expect(r.checks?.[0].note).toBe('That works, but this step is practice with this. Keep the parameters called name and age, and write this.name = name;');
  });

  test('withdraw must refuse an amount over the balance, and allow all of it', () => {
    const s = spec('scratch', 'bank');
    const done = (javaClassesSolution.scratch.moves![0] as { input: { code: string } }).input.code;
    const noGuard = withEdits(s, { 'BankAccount.java': done.replace('if (amount <= balance) {', 'if (true) {') });
    expect(noGuard.checks?.find((c) => c.id === 'withdraw')?.note).toBe('withdraw(51) from a balance of 50 should change nothing. Use an if.');
    const offByOne = withEdits(s, { 'BankAccount.java': done.replace('amount <= balance', 'amount < balance') });
    expect(offByOne.checks?.find((c) => c.id === 'withdraw')?.note).toBe('withdraw(50) from a balance of 50 should leave 0. You can take out all of it.');
  });

  test('step 6 asks for plays = 0 even though the default matches', () => {
    const s = spec('fields-ctor', 'song');
    const r = withEdits(s, { 'Song.java': 'public class Song {\n  private String title;\n  private String artist;\n  private int plays;\n\n  public Song(String songTitleIn, String songArtistIn) {\n    title = songTitleIn;\n    artist = songArtistIn;\n  }\n}\n' });
    expect(r.checks?.find((c) => c.id === 'sets')?.note).toBe('Java starts plays at 0 on its own, but write plays = 0; anyway, so your code says what you mean.');
  });

  test('BankAccount constructor parameters end in In', () => {
    const s = spec('scratch', 'bank');
    const done = (javaClassesSolution.scratch.moves![0] as { input: { code: string } }).input.code;
    const r = withEdits(s, { 'BankAccount.java': done.replace('String ownerIn, int balanceIn', 'String who, int start').replace('owner = ownerIn', 'owner = who').replace('balance = balanceIn', 'balance = start') });
    expect(r.checks?.find((c) => c.id === 'ctor')?.note).toBe("End each constructor parameter's name in In, as in ownerIn.");
  });

  test('step 1 stops at three printed lines', () => {
    const s = spec('why', 'loose');
    const main = javaModel.init(s).files.find((f) => f.name === 'Main.java')!.text;
    const third = main.replace('System.out.println(', 'String n3 = "Linus";\n    int h3 = 90;\n    System.out.println(n3 + " has " + h3);\n    System.out.println(n3);\n    System.out.println(');
    expect(withEdits(s, { 'Main.java': third }).checks?.[0].note).toBe('Main should print three lines, one for each player.');
  });

  test('a loop that never ends stops with a message, not a hang', () => {
    const s = spec('why', 'loose');
    const r = withEdits(s, { 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    while (true) {\n      int x = 1;\n    }\n  }\n}\n' });
    expect(r.last).toMatchObject({ kind: 'limit', limit: 'steps' });
  });
});

describe('carrying code between steps', () => {
  test('a later step starts from the earlier Song, but keeps its own Main', () => {
    const later = spec('getters', 'song');
    const earlier = javaModel.init(spec('fields-ctor', 'song'));
    const mine = 'public class Song { /* mine */ }\n';
    const prior: JavaState = { ...earlier, files: earlier.files.map((f) => (f.name === 'Song.java' ? { ...f, text: mine } : { ...f, text: 'old main' })) };
    const s = javaModel.start!(later, () => prior);
    expect(s.files.find((f) => f.name === 'Song.java')?.text).toBe(mine);
    expect(s.files.find((f) => f.name === 'Main.java')?.text).toContain('getSummary');
  });

  test('with no earlier work, the built-in code is used', () => {
    const later = spec('getters', 'song');
    expect(javaModel.start!(later, () => undefined)).toEqual(javaModel.init(later));
  });
});

describe('report', () => {
  test('the teacher sees the code from each marked step', () => {
    const now = Date.now();
    const session = new LabSession(javaClassesLab, { labId: javaClassesLab.id, labVersion: javaClassesLab.version, studentId: 's', startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] });
    for (const step of javaClassesLab.steps) {
      playStep(session, javaClassesSolution[step.id]);
      if (step.kind === 'submit' || step.extra) break;
      session.goTo(session.progress.step + 1);
    }
    const report = buildReport(javaClassesLab, session.progress, { id: 's', name: 'Sam', period: '1', createdAt: 0 }, 'submitted');
    expect(report.code?.map((c) => c.step)).toEqual(['mutators', 'this', 'scratch']);
    expect(report.code?.[0].files.map((f) => f.name)).toEqual(['Song.java', 'Main.java']);
    expect(report.code?.[0].files[0].text).toContain('public void addPlays(int amount)');
  });
});

describe('objects demo', () => {
  const s = javaClassesLab.steps.find((x) => x.id === 'what')!.demos![0] as ObjectsSpec;

  test('hitting one object leaves the others alone, and logs the code', () => {
    let st = objectsModel.init(s);
    st = objectsModel.apply(s, st, { make: true });
    st = objectsModel.apply(s, st, { make: true });
    expect(objectsModel.facts(s, st)).toEqual({ made: 2, hurt: 0, separate: false });
    st = objectsModel.apply(s, st, { hit: 1 });
    expect(st.health).toEqual([100, 70]);
    expect(st.log).toEqual(['Player ada = new Player("Ada", 100);', 'Player grace = new Player("Grace", 80);', 'grace.takeDamage(10);']);
    expect(objectsModel.facts(s, st).separate).toBe(true);
  });

  test('the button stops when the list of objects runs out', () => {
    let st = objectsModel.init(s);
    for (let i = 0; i < 3; i++) st = objectsModel.apply(s, st, { make: true });
    expect(objectsModel.apply(s, st, { make: true })).toBe(st);
  });
});
