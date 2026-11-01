import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../runtime/session';
import { checkPrefix, checkSpoofClaim, checkStaticArp } from '../runtime/toolInput';
import { hashOverridePassword, OVERRIDE_SALT, sha256Hex } from '../store/override';
import type { LabProgress } from '../store/progress';
import { buildReport } from '../store/report';
import { LABS } from '.';
import { onPathSolution } from './on-path/solution';
import { IP, MAC } from './on-path/scenario';
import { routeHijackSolution } from './route-hijack/solution';
import { shuffledOptions } from './shuffle';
import { correctChoice, playMove, playStep, type LabSolution } from './solution';
import type { LabDef } from './types';

// The stores write to localStorage. Give them an in-memory one.
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

let n = 0;
function freshProgress(lab: LabDef): LabProgress {
  const now = Date.now();
  return {
    labId: lab.id,
    labVersion: lab.version,
    studentId: `test-${n++}`,
    startedAt: now,
    updatedAt: now,
    activeMs: 0,
    step: 0,
    maxStep: 0,
    stepStart: {},
    goals: {},
    answers: {},
    actions: [],
    log: [],
  };
}

const SOLUTIONS: Record<string, LabSolution> = { 'on-path': onPathSolution, 'route-hijack': routeHijackSolution };

/** Play a lab from the start through step `until` (inclusive), asserting every step completes. */
function playThrough(lab: LabDef, until = lab.steps.length - 1, s = new LabSession(lab, freshProgress(lab))): LabSession {
  for (let i = s.progress.step; i <= until; i++) {
    expect(s.progress.step, `should be on step ${i + 1}`).toBe(i);
    playStep(s, SOLUTIONS[lab.id][s.step.id]);
    expect(s.missing(), `step ${i + 1} "${s.step.id}" left unfinished`).toEqual([]);
    if (i < lab.steps.length - 1 && i < until) s.goTo(i + 1);
  }
  return s;
}

const deviceState = (s: LabSession) => JSON.stringify({ t: s.sim.t, devices: s.sim.devices });

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe.each(LABS.map((l) => [l.id, l] as const))('lab %s', (_id, lab) => {
  it('has a solution for every step', () => {
    const sol = SOLUTIONS[lab.id];
    expect(sol).toBeDefined();
    for (const key of Object.keys(sol)) expect(lab.steps.map((s) => s.id)).toContain(key);
  });

  it('has unique step, goal, question, and action ids', () => {
    const steps = lab.steps.map((s) => s.id);
    expect(new Set(steps).size).toBe(steps.length);
    for (const s of lab.steps) {
      for (const list of [s.goals ?? [], s.questions ?? [], s.actions ?? []]) {
        const ids = list.map((x) => x.id);
        expect(new Set(ids).size, `duplicate id in ${s.id}`).toBe(ids.length);
      }
    }
    expect(lab.steps[lab.steps.length - 1].kind).toBe('submit');
  });

  it('can be played start to finish, and every step completes', () => {
    const s = playThrough(lab);
    expect(s.progress.step).toBe(lab.steps.length - 1);
    const r = buildReport(lab, s.progress, { id: s.progress.studentId, name: 'Test Student', period: 'Period 1', createdAt: 0 }, 'submitted');
    expect(r.goals.every((g) => g.done)).toBe(true);
    expect(r.score.auto).toBe(r.score.autoMax);
    expect(r.questions.every((q) => q.answer.trim().length > 0)).toBe(true);
    for (const text of [...r.goals.map((g) => g.label), ...r.questions.map((q) => q.prompt)]) expect(text).not.toMatch(/\[\[|\*\*/);
  });

  it('cannot skip ahead past an unfinished step', () => {
    const s = new LabSession(lab, freshProgress(lab));
    s.goTo(1);
    // Step 1 has unfinished goals or questions in every lab, so this stays put.
    expect(s.progress.step).toBe(0);
    s.goTo(5);
    expect(s.progress.step).toBe(0);
  });

  it('rebuilds the same network after a reload', () => {
    const s = playThrough(lab);
    const saved = JSON.parse(JSON.stringify(s.progress)) as LabProgress;
    const again = new LabSession(lab, saved);
    expect(again.progress.step).toBe(s.progress.step);
    expect(again.replayWarning).toBe('');
    expect(deviceState(again)).toBe(deviceState(s));
    for (const key of Object.keys(s.progress.goals)) expect(again.progress.goals[key]).toBeDefined();
  });

  it('keeps goals and answers after "Reset network"', () => {
    const s = playThrough(lab);
    const goals = { ...s.progress.goals };
    const answers = Object.keys(s.progress.answers).length;
    s.resetNetwork();
    expect(s.progress.goals).toEqual(goals);
    expect(Object.keys(s.progress.answers).length).toBe(answers);
    expect(s.progress.actions.every((x) => x.a.type === 'setup')).toBe(true);
  });

  it('survives a lab version change', () => {
    const s = playThrough(lab, 2);
    const saved = JSON.parse(JSON.stringify(s.progress)) as LabProgress;
    saved.labVersion = lab.version - 1;
    const again = new LabSession(lab, saved);
    expect(again.replayWarning).not.toBe('');
    expect(Object.keys(again.progress.answers).length).toBeGreaterThan(0);
  });
});

describe('on-path lab details', () => {
  const lab = LABS.find((l) => l.id === 'on-path')!;

  it('a student who resets the network mid-attack can still finish the relay step', () => {
    const s = playThrough(lab, lab.steps.findIndex((x) => x.id === 'broken'));
    s.goTo(s.progress.step + 1);
    expect(s.step.id).toBe('relay');
    s.resetNetwork();
    s.sim.runUntilIdle();
    // Setups put Mallory back in the middle.
    expect(s.sim.dev('alice').arp[IP.router]?.mac).toBe(MAC.mallory);
    playStep(s, onPathSolution.relay);
    expect(s.missing()).toEqual([]);
  });

  it("the router's ARP table shows Mallory's MAC twice when the detect step opens", () => {
    const s = playThrough(lab, lab.steps.findIndex((x) => x.id === 'https'));
    s.goTo(s.progress.step + 1);
    s.sim.runUntilIdle();
    expect(s.step.id).toBe('detect');
    const macs = Object.values(s.sim.dev('router').arp).map((e) => e.mac);
    expect(macs.filter((m) => m === MAC.mallory)).toHaveLength(2);
  });

  it('the sniffing goal needs a capture made in this step, not an earlier one', () => {
    const s = playThrough(lab, 1);
    s.goTo(2);
    playMove(s, { press: 'login' }); // capture is still off
    expect(s.goalDone('sniff', 'caught')).toBe(false);
  });

  it('a wrong answer is recorded and does not complete the step', () => {
    const s = new LabSession(lab, freshProgress(lab));
    const q = s.step.questions![0];
    s.setDraft(s.step.id, q, 'mac');
    expect(s.check(s.step.id, q)).toBe(false);
    expect(s.answer(s.step.id, q.id)?.attempts).toBe(1);
    expect(s.missing()).toContain('1 question');
  });
});

describe('route-hijack lab details', () => {
  const lab = LABS.find((l) => l.id === 'route-hijack')!;

  it('validating only at HomeNet blocks the fake route but leaves Alice with no route', () => {
    const s = playThrough(lab, lab.steps.findIndex((x) => x.id === 'impersonate'));
    s.goTo(s.progress.step + 1);
    playMove(s, { tool: { type: 'validate', device: 'home', on: true } });
    playMove(s, { press: 'open-https' });
    expect(s.goalDone('rov', 'reject')).toBe(true);
    expect(s.goalDone('rov', 'real')).toBe(false);
    // West then fixes it for everyone.
    playMove(s, { tool: { type: 'validate', device: 'west', on: true } });
    playMove(s, { press: 'open-https' });
    expect(s.goalDone('rov', 'real')).toBe(true);
  });

  it('the AS path answer accepts common formats', () => {
    const q = lab.steps.find((x) => x.id === 'learn')!.questions!.find((x) => x.id === 'west-path')!;
    if (q.kind !== 'text' || !q.expect) throw new Error('expected an auto-checked text question');
    for (const ok of ['300 400', '300, 400', '300 -> 400', 'AS300 AS400', '300→400']) expect(q.expect.test(ok), ok).toBe(true);
    for (const bad of ['400 300', '200 300 400', '300', '']) expect(q.expect.test(bad), bad).toBe(false);
  });
});

describe('multiple choice order', () => {
  it('shows options in a fixed shuffled order, and the correct answer is not always first', () => {
    let total = 0;
    let firstIsCorrect = 0;
    for (const lab of LABS) {
      for (const step of lab.steps) {
        for (const q of step.questions ?? []) {
          if (q.kind !== 'choice') continue;
          const order = shuffledOptions(lab.id, step.id, q);
          expect(order.map((o) => o.id).sort()).toEqual(q.options.map((o) => o.id).sort());
          expect(shuffledOptions(lab.id, step.id, q)).toEqual(order);
          // Options marked "last" stay at the end.
          const pinned = q.options.filter((o) => o.last).map((o) => o.id);
          if (pinned.length) expect(order.slice(-pinned.length).map((o) => o.id)).toEqual(pinned);
          total++;
          if (order[0].correct) firstIsCorrect++;
        }
      }
    }
    expect(total).toBeGreaterThan(5);
    expect(firstIsCorrect / total).toBeLessThan(0.5);
  });

  it('students can change an answer after it was marked correct', () => {
    const lab = LABS[0];
    const s = new LabSession(lab, freshProgress(lab));
    const q = s.step.questions!.find((x) => x.kind === 'choice')!;
    if (q.kind !== 'choice') throw new Error('expected a choice question');
    s.setDraft(s.step.id, q, correctChoice(q));
    expect(s.check(s.step.id, q)).toBe(true);
    const wrong = q.options.find((o) => !o.correct)!.id;
    s.setDraft(s.step.id, q, wrong);
    expect(s.answer(s.step.id, q.id)?.correct).toBeUndefined();
    expect(s.questionDone(s.step.id, q)).toBe(false);
    expect(s.check(s.step.id, q)).toBe(false);
  });
});

describe('typed tool inputs', () => {
  const onPath = LABS.find((l) => l.id === 'on-path')!;
  const hijack = LABS.find((l) => l.id === 'route-hijack')!;
  const cafe = () => onPath.build();

  it('the ARP spoofer explains bad addresses', () => {
    const sim = cafe();
    const bad = (ip: string) => {
      const r = checkSpoofClaim(sim, 'mallory', 'alice', ip);
      expect(r.ok, ip).toBe(false);
      return r.ok ? '' : r.msg;
    };
    expect(bad('')).toMatch(/Type the IP/);
    expect(bad('192.168.1')).toMatch(/four numbers/);
    expect(bad('192.168.1.300')).toMatch(/four numbers/);
    expect(bad('10.0.0.1')).toMatch(/not on this network/);
    expect(bad(IP.alice)).toMatch(/Alice's own address/);
    expect(bad(IP.mallory)).toMatch(/already Mallory's own/);
    expect(bad('192.168.1.99')).toMatch(/No device/);
    expect(checkSpoofClaim(sim, 'mallory', 'alice', ` ${IP.router} `)).toEqual({ ok: true, ip: IP.router });
  });

  it('the ARP lock needs the real MAC, and calls out the attacker', () => {
    const sim = cafe();
    const msg = (ip: string, mac: string) => {
      const r = checkStaticArp(sim, 'alice', ip, mac);
      return r.ok ? 'ok' : r.msg;
    };
    expect(msg(IP.router, MAC.mallory)).toMatch(/forged ARP replies/);
    expect(msg(IP.router, MAC.sam)).toMatch(/belongs to Sam/);
    expect(msg(IP.router, '0c:af:e0:00:00')).toMatch(/six pairs/);
    expect(msg(IP.router, 'aa:bb:cc:dd:ee:ff')).toMatch(/No device/);
    expect(msg(IP.alice, MAC.alice)).toMatch(/Alice's own address/);
    expect(msg(IP.router, MAC.router.toUpperCase().replace(/:/g, '-'))).toBe('ok');
  });

  it('the route announcer suggests the network address and rejects junk', () => {
    const sim = hijack.build();
    const r = checkPrefix(sim, 'shady', '203.0.113.10/24');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggest).toBe('203.0.113.0/24');
    for (const junk of ['', '203.0.113.0', '203.0.113.0/33', 'bank', '0.0.0.0/0']) expect(checkPrefix(sim, 'shady', junk).ok, junk).toBe(false);
    expect(checkPrefix(sim, 'shady', '203.0.113.0/24')).toEqual({ ok: true, prefix: '203.0.113.0/24' });
  });

  it('any more-specific prefix that contains the bank finishes the "specific" step', () => {
    const s = playThrough(hijack, hijack.steps.findIndex((x) => x.id === 'blackhole'));
    s.goTo(s.progress.step + 1);
    expect(s.step.id).toBe('specific');
    playMove(s, { tool: { type: 'announce', device: 'shady', prefix: '203.0.113.0/26' } });
    playMove(s, { inspect: 'east' });
    expect(s.goalDone('specific', 'announce')).toBe(true);
    expect(s.goalDone('specific', 'east')).toBe(true);
  });
});

describe('teacher override', () => {
  const lab = LABS.find((l) => l.id === 'on-path')!;
  const verify = (pw: string) => hashOverridePassword(pw) === hashOverridePassword('correct horse');

  it('hashes with real SHA-256', () => {
    for (const text of ['', 'abc', 'netlab-teacher-override:v1:correct horse', 'é ü 漢字', 'x'.repeat(200)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
    expect(hashOverridePassword('  correct horse ')).toBe(createHash('sha256').update(`${OVERRIDE_SALT}correct horse`).digest('hex'));
  });

  it('unlocks Continue on a stuck step and shows on the report', () => {
    const s = new LabSession(lab, freshProgress(lab));
    s.goTo(1);
    expect(s.progress.step).toBe(0);
    expect(s.tryOverride('nope', '', verify)).toBe('wrong');
    expect(s.tryOverride('correct horse', 'Map would not load', verify)).toBe('ok');
    expect(s.missing()).not.toEqual([]); // the goals are still not done
    s.goTo(1);
    expect(s.progress.step).toBe(1);
    const r = buildReport(lab, s.progress, { id: s.progress.studentId, name: 'T', period: 'P', createdAt: 0 }, 'in-progress');
    expect(r.overrides).toEqual([expect.objectContaining({ step: lab.steps[0].id, number: 1, note: 'Map would not load' })]);
    expect(r.overrideFailures).toBe(1);
    expect(r.goals.filter((g) => g.step === lab.steps[0].id).every((g) => g.overridden && !g.done)).toBe(true);
    expect(r.score.auto).toBe(0);
  });

  it('locks for a minute after three wrong passwords', () => {
    const s = new LabSession(lab, freshProgress(lab));
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(s.tryOverride('nope', '', verify, t0)).toBe('wrong');
    expect(s.tryOverride('correct horse', '', verify, t0 + 1000)).toBe('wait');
    expect(s.tryOverride('correct horse', '', verify, t0 + 61_000)).toBe('ok');
    expect(s.progress.overrideFailures).toBe(3);
  });
});

describe('replay', () => {
  const lab = LABS.find((l) => l.id === 'on-path')!;

  it('replays a step on a copy of the network without touching the real one', () => {
    const s = playThrough(lab, lab.steps.findIndex((x) => x.id === 'poison'));
    const before = deviceState(s);
    const goals = { ...s.progress.goals };
    expect(s.canReplay()).toBe(true);
    expect(s.startReplay()).toBe(true);
    const rp = s.replay.value!;
    // At the start of the step, Alice still trusts the real router.
    expect(rp.sim.dev('alice').arp[IP.router]?.mac).not.toBe(MAC.mallory);
    for (let i = 0; i < 2000 && !rp.done; i++) rp.advance(50);
    expect(rp.done).toBe(true);
    // By the end, the replay shows the poisoned table, just like the real network.
    expect(rp.sim.dev('alice').arp[IP.router]?.mac).toBe(MAC.mallory);
    expect(deviceState(s)).toBe(before);
    expect(s.progress.goals).toEqual(goals);
    // Doing anything on the real network ends the replay.
    s.dispatch({ type: 'sniff', device: 'mallory', on: true });
    expect(s.replay.value).toBeNull();
  });

  it('has nothing to replay for a step where the student only read', () => {
    const s = playThrough(lab, 0);
    expect(s.canReplay(0)).toBe(false);
    expect(s.startReplay(0)).toBe(false);
  });
});
