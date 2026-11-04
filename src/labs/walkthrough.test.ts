import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../runtime/session';
import { checkAddress, checkCable, checkGateway, checkPing, checkPrefix, checkRoute, checkSpoofClaim, checkStaticArp } from '../runtime/toolInput';
import { applyBackup, makeBackup, readBackup } from '../store/backup';
import { hashOverridePassword, OVERRIDE_SALT, sha256Hex } from '../store/override';
import type { Profile } from '../store/profile';
import { peekProgress, type LabProgress } from '../store/progress';
import { buildReport } from '../store/report';
import { pingFailText } from '../ui/describe';
import { reportHtml } from '../ui/Submit';
import { LABS } from '.';
import { ADDR, NET, portToward, WEB_IP, WEB_PIN } from './build-network/scenario';
import { buildNetworkSolution } from './build-network/solution';
import { onPathSolution } from './on-path/solution';
import { IP, MAC } from './on-path/scenario';
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

/**
 * Every lab's answer key, found by folder: src/labs/<lab id>/solution.ts must
 * export one LabSolution whose name ends in "Solution".
 */
const SOLUTIONS: Record<string, LabSolution> = Object.fromEntries(
  Object.entries(import.meta.glob<Record<string, unknown>>('./*/solution.ts', { eager: true })).map(([path, mod]) => {
    const found = Object.entries(mod).find(([name]) => name.endsWith('Solution'));
    if (!found) throw new Error(`${path} exports no ...Solution`);
    return [path.split('/')[1], found[1] as LabSolution];
  }),
);

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
    // The submit step comes last, unless extra-credit steps follow it. Extra credit only goes after it.
    const submitAt = lab.steps.findIndex((s) => s.kind === 'submit');
    expect(submitAt).toBeGreaterThan(0);
    expect(lab.steps.slice(submitAt + 1).every((s) => s.extra)).toBe(true);
    expect(lab.steps.slice(0, submitAt).some((s) => s.extra)).toBe(false);
  });

  it('can be played start to finish, and every step completes', () => {
    const s = playThrough(lab);
    expect(s.progress.step).toBe(lab.steps.length - 1);
    const r = buildReport(lab, s.progress, { id: s.progress.studentId, name: 'Test Student', period: 'Period 1', createdAt: 0 }, 'submitted');
    expect(r.goals.every((g) => g.done)).toBe(true);
    expect(r.score.auto).toBe(r.score.autoMax);
    expect(r.score.extra ?? 0).toBe(r.score.extraMax ?? 0);
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

describe('build-network lab details', () => {
  const lab = LABS.find((l) => l.id === 'build-network')!;
  const at = (id: string) => lab.steps.findIndex((x) => x.id === id);
  /** Play through the step before `id`, then open `id`. */
  function openStep(id: string): LabSession {
    const s = playThrough(lab, at(id) - 1);
    s.goTo(at(id));
    s.sim.runUntilIdle();
    expect(s.step.id).toBe(id);
    return s;
  }
  const lastDrop = (s: LabSession) => [...s.sim.events].reverse().find((e) => e.type === 'drop');
  const lastPingFail = (s: LabSession) => [...s.sim.events].reverse().find((e) => e.type === 'ping-fail');

  it('the first ping fails because Alice has no address, not because of the cables', () => {
    const s = openStep('cables');
    playMove(s, { tool: { type: 'cable', a: 'alice', b: 'sw' } });
    playMove(s, { press: 'ping-ben' });
    expect(lastPingFail(s)).toMatchObject({ device: 'alice', reason: 'no-ip', at: 'alice' });
  });

  it('without a gateway the request dies at Alice; with one it dies at the office router', () => {
    const s = openStep('gateway');
    playMove(s, { press: 'open' });
    expect(lastDrop(s)).toMatchObject({ device: 'alice', reason: 'no-gateway' });
    // The browser says why right away instead of waiting for a timeout.
    expect(s.sim.dev('alice').browser).toMatchObject({ status: 'failed', error: expect.stringMatching(/no default gateway/) });
    expect(s.goalDone('gateway', 'reach')).toBe(false);
    playMove(s, { tool: { type: 'gateway', device: 'alice', ip: ADDR.officeLan } });
    playMove(s, { press: 'open' });
    expect(lastDrop(s)).toMatchObject({ device: 'office', reason: 'no-route' });
    expect(s.goalDone('gateway', 'reach')).toBe(true);
  });

  it('with only the forward route, the reply is dropped at the data center router', () => {
    const s = openStep('route');
    playStep(s, buildNetworkSolution.route);
    expect(s.sim.events.some((e) => e.type === 'drop' && e.device === 'dc' && e.reason === 'no-route' && e.pkt?.src === WEB_IP)).toBe(true);
    expect(s.sim.dev('alice').browser?.status).toBe('failed');
  });

  it("Ben's faults show up one layer at a time", () => {
    const s = openStep('fix');
    // The setup breaks three things at once; none of the goals count as done halfway through it.
    expect(lab.steps[at('fix')].goals!.filter((g) => s.goalDone('fix', g.id))).toEqual([]);
    const ben = s.sim.dev('ben');
    // His browser from the last step is closed, so it can't show a page his broken computer couldn't load.
    expect(ben.browser).toBeUndefined();
    // The setup's changes are quiet, so the map doesn't tag Ben with "unplugged" and give the faults away.
    const unplug = [...s.sim.events].reverse().find((e) => e.type === 'config' && e.device === 'ben' && e.what === 'cable');
    expect(unplug).toMatchObject({ on: false, quiet: true });
    playMove(s, { press: 'open-ben' });
    expect(ben.browser).toMatchObject({ status: 'failed', error: expect.stringMatching(/plugged in/) });
    expect(ben.ifaces[0].linkId).toBeUndefined();
    expect(ben.ifaces[0].ip?.startsWith('192.168.100.')).toBe(true);
    playMove(s, { tool: { type: 'ping', device: 'ben', ip: ADDR.officeLan } });
    expect(lastPingFail(s)).toMatchObject({ reason: 'no-link' });
    playMove(s, { tool: { type: 'cable', a: 'ben', b: 'sw' } });
    // The goals count fixes without naming them.
    expect(['one', 'two', 'three'].map((g) => s.goalDone('fix', g))).toEqual([true, false, false]);
    playMove(s, { tool: { type: 'ping', device: 'ben', ip: ADDR.officeLan } });
    expect(lastPingFail(s)).toMatchObject({ reason: 'gateway-off-net' });
    playMove(s, { tool: { type: 'set-ip', device: 'ben', iface: 'eth0', cidr: `${ADDR.ben}/24` } });
    expect(['one', 'two', 'three'].map((g) => s.goalDone('fix', g))).toEqual([true, true, false]);
    playMove(s, { tool: { type: 'ping', device: 'ben', ip: ADDR.officeLan } });
    expect(s.sim.events.at(-1)).toMatchObject({ type: 'ping-reply', device: 'ben' });
    playMove(s, { tool: { type: 'ping', device: 'ben', ip: WEB_IP } });
    expect(lastPingFail(s)).toMatchObject({ reason: 'arp-timeout', at: 'ben', ip: '192.168.10.254' });
    expect(s.goalDone('fix', 'loaded')).toBe(false);
  });

  it('resetting the network in the fix step breaks Ben again, and the fix still works', () => {
    const s = openStep('fix');
    playMove(s, { tool: { type: 'cable', a: 'ben', b: 'sw' } });
    s.resetNetwork();
    s.sim.runUntilIdle();
    expect(s.sim.dev('ben').ifaces[0].linkId).toBeUndefined();
    expect(s.sim.lookup(s.sim.dev('dc'), ADDR.alice)?.via).toBe(ADDR.officeLink);
    playStep(s, buildNetworkSolution.fix);
    expect(s.missing()).toEqual([]);
  });

  it("setups keep the student's own valid choices", () => {
    const s = openStep('addresses');
    playMove(s, { tool: { type: 'set-ip', device: 'alice', iface: 'eth0', cidr: '192.168.10.1/24' } });
    playMove(s, { tool: { type: 'set-ip', device: 'ben', iface: 'eth0', cidr: '192.168.10.50/24' } });
    // Skip the rest of the lab with teacher overrides; every setup runs on the way.
    const verify = () => true;
    for (let i = at('addresses'); i < at('fix'); i++) {
      expect(s.tryOverride('x', '', verify)).toBe('ok');
      s.goTo(i + 1);
      s.sim.runUntilIdle();
    }
    expect(s.step.id).toBe('fix');
    const sim = s.sim;
    expect(sim.dev('alice').ifaces[0].ip).toBe('192.168.10.1');
    // The router couldn't have .1, so it took the next free address, and Alice's gateway points there.
    const lan = sim.dev('office').ifaces.find((i) => i.ip?.startsWith('192.168.10.'))!;
    expect(lan.ip).not.toBe('192.168.10.1');
    expect(sim.dev('alice').gateway).toBe(lan.ip);
    sim.browse('alice', `http://${WEB_IP}/`);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
  });

  it('explains bad addresses, gateways, routes, and cables', () => {
    const s = openStep('link');
    const sim = s.sim;
    const msg = (r: { ok: boolean; msg?: string }) => (r.ok ? 'ok' : r.msg);
    const addr = (dev: string, port: string, raw: string) => checkAddress(sim, dev, port, raw, [WEB_PIN]);
    const bare = addr('office', 'p2', '10.0.0.1');
    expect(bare).toMatchObject({ ok: false, suggest: '10.0.0.1/24' });
    expect(msg(addr('office', 'p2', '10.0.0.0/24'))).toMatch(/address of the network itself/);
    expect(msg(addr('office', 'p2', '10.0.0.255/24'))).toMatch(/broadcast/);
    expect(msg(addr('office', 'p2', `${ADDR.alice}/24`))).toMatch(/Alice already uses/);
    expect(msg(addr('office', 'p2', '192.168.10.99/24'))).toMatch(/port 1 is already on 192\.168\.10\.0\/24/);
    expect(msg(addr('web', 'eth0', '203.0.113.81/24'))).toMatch(/published at/);
    expect(msg(addr('office', 'p2', '10.0.0.1/33'))).toMatch(/Type an IP address and a prefix length/);
    expect(addr('office', 'p2', '10.0.0.1/24')).toMatchObject({ ok: true, cidr: '10.0.0.1/24', note: expect.stringMatching(/port 2 has no cable/) });
    // An address on a port with no cable: the failed ping says which port.
    sim.setIp('office', 'p2', '10.0.0.1', 24);
    const lost = { t: 0, type: 'ping-fail', device: 'alice', to: '10.0.0.1', seq: 1, reason: 'arp-timeout', at: 'alice', ip: '10.0.0.1' } as const;
    expect(pingFailText(sim, lost)).toMatch(/Office router has that address on port 2, but that port has no cable/);
    sim.setIp('office', 'p2', null);
    expect(msg(addr('office', 'p1', `${ADDR.officeLan}/24`))).toMatch(/already has/);

    expect(msg(checkGateway(sim, 'alice', ADDR.dcServers))).toMatch(/not on it/);
    expect(msg(checkGateway(sim, 'alice', ADDR.ben))).toMatch(/a computer, not a router/);
    expect(msg(checkGateway(sim, 'alice', '192.168.10.1/24'))).toMatch(/no slash/);

    expect(checkRoute(sim, 'office', '203.0.113.80', ADDR.dcLink)).toMatchObject({ ok: false, suggest: NET.servers });
    expect(checkRoute(sim, 'office', '203.0.113.5/24', ADDR.dcLink)).toMatchObject({ ok: false, suggest: NET.servers });
    expect(msg(checkRoute(sim, 'office', NET.office, ADDR.dcLink))).toMatch(/plugged into 192\.168\.10\.0\/24 already/);
    // Before the link has addresses, the data center router isn't a neighbor yet.
    expect(msg(checkRoute(sim, 'office', NET.servers, ADDR.dcServers))).toMatch(/has to be a neighbor/);

    expect(msg(checkCable(sim, 'alice', undefined, 'sw', undefined))).toMatch(/already connected/);
    expect(msg(checkCable(sim, 'web', undefined, 'office', undefined))).toMatch(/no free port/);
    expect(msg(checkCable(sim, 'office', 'p1', 'dc', 'p1'))).toMatch(/port 1 already has a cable/);

    // A next hop on the neighbor's far side points to the network the two routers share, and only the next-hop box is at fault.
    sim.connect({ device: 'office' }, { device: 'dc' });
    sim.setIp('office', portToward(sim, 'office', 'dc')!.id, ADDR.officeLink, 24);
    sim.setIp('dc', portToward(sim, 'dc', 'office')!.id, ADDR.dcLink, 24);
    const far = checkRoute(sim, 'office', NET.servers, ADDR.dcServers);
    expect(far).toMatchObject({ ok: false, field: 'via' });
    expect(msg(far)).toMatch(/far side.*network Office router shares with it, 10\.0\.0\.0\/24/);
    expect(checkRoute(sim, 'office', NET.servers, `${ADDR.dcLink}/24`)).toMatchObject({ ok: false, field: 'via', suggest: ADDR.dcLink });

    // With his own address on the wrong network, the right gateway can't work: say to fix the address first.
    sim.setIp('ben', 'eth0', '192.168.100.12', 24);
    expect(msg(checkGateway(sim, 'ben', ADDR.officeLan))).toMatch(/Check Ben's IP address first/);
    expect(msg(checkGateway(sim, 'ben', '192.168.100.1'))).toMatch(/No router has an address on 192\.168\.100\.0\/24.*Check Ben's IP address first\. If it's right, give the router a port on 192\.168\.100\.0\/24\./);

    expect(checkPing(sim, 'alice', `${ADDR.ben}/24`)).toMatchObject({ ok: false, suggest: ADDR.ben });
  });
});

describe('typed tool inputs', () => {
  const onPath = LABS.find((l) => l.id === 'on-path')!;
  const hijack = LABS.find((l) => l.id === 'route-hijack')!;
  const cafe = () => onPath.build!();

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
    const sim = hijack.build!();
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

describe('restore from a report file', () => {
  const lab = LABS.find((l) => l.id === 'on-path')!;
  const ids = LABS.map((l) => l.id);
  const riley: Profile = { id: 'riley-laptop', name: 'Riley Seeded', period: 'Period 2', createdAt: 0 };
  /** A report Riley downloaded partway through the lab. */
  function rileysReport() {
    const s = playThrough(lab, 3);
    const p = s.progress;
    const html = reportHtml(lab, buildReport(lab, p, riley, 'in-progress'), makeBackup(p, riley));
    return { s, p, html };
  }

  it('restores the work for the same student after the browser lost it', () => {
    const { s, p, html } = rileysReport();
    const workId = buildReport(lab, p, riley, 'in-progress').workId;
    // Safari wiped the data: new profile id, same name typed a little differently.
    const again: Profile = { id: 'riley-new', name: '  riley   seeded ', period: 'Period 2', createdAt: 1 };
    const r = readBackup(html, again, ids);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const restored = applyBackup(r, again);
    expect(restored.studentId).toBe('riley-new');
    expect(peekProgress('riley-new', lab.id)).toBe(restored);
    expect(restored.answers).toEqual(p.answers);
    expect(restored.goals).toEqual(p.goals);
    const back = new LabSession(lab, restored);
    expect(back.progress.step).toBe(s.progress.step);
    expect(back.missing()).toEqual([]);
    const report = buildReport(lab, restored, again, 'in-progress');
    expect(report.workId).toBe(workId);
    expect(report.restores).toHaveLength(1);
    expect(report.restores[0]).toMatchObject({ fromName: 'Riley Seeded', fromPeriod: 'Period 2', otherName: false });
    expect(report.timeline.some((t) => t.kind === 'restore')).toBe(true);
  });

  it('refuses another student’s file', () => {
    const { html } = rileysReport();
    const sam: Profile = { id: 'sam-laptop', name: 'Sam Copier', period: 'Period 2', createdAt: 0 };
    const r = readBackup(html, sam, ids);
    expect(r).toMatchObject({ ok: false, reason: 'not-yours' });
  });

  it('refuses a file that was edited, for example to change the name in it', () => {
    const { html } = rileysReport();
    const edited = html.split('Riley Seeded').join('Sam Copier');
    const sam: Profile = { id: 'sam-laptop', name: 'Sam Copier', period: 'Period 2', createdAt: 0 };
    expect(readBackup(edited, sam, ids)).toMatchObject({ ok: false, reason: 'changed' });
  });

  it('flags work restored under one name and handed in under another', () => {
    const { html } = rileysReport();
    // Sam signs in as Riley to get past the name check, restores, then switches back.
    const fake: Profile = { id: 'sam-laptop', name: 'Riley Seeded', period: 'Period 2', createdAt: 0 };
    const r = readBackup(html, fake, ids);
    if (!r.ok) throw new Error('expected the file to open');
    const p = applyBackup(r, fake);
    const report = buildReport(lab, p, { ...fake, name: 'Sam Copier' }, 'submitted');
    expect(report.restores[0].otherName).toBe(true);
    expect(reportHtml(lab, report)).toContain('That is not the name on this report.');
  });

  it('keeps the Work ID of the original attempt', () => {
    const { p, html } = rileysReport();
    const original = buildReport(lab, p, riley, 'in-progress').workId;
    const r = readBackup(html, { ...riley, id: 'other-id' }, ids);
    if (!r.ok) throw new Error('expected the file to open');
    expect(buildReport(lab, applyBackup(r, { ...riley, id: 'other-id' }), riley, 'in-progress').workId).toBe(original);
  });

  it('survives student text that looks like HTML', () => {
    const s = playThrough(lab, 0);
    s.progress.answers['x/y'] = { value: '</script><b>hi</b> & "quotes"', updatedAt: 0, attempts: 1 };
    const html = reportHtml(lab, buildReport(lab, s.progress, riley, 'in-progress'), makeBackup(s.progress, riley));
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const r = readBackup(html, riley, ids);
    expect(r.ok && r.data.progress.answers['x/y'].value).toBe('</script><b>hi</b> & "quotes"');
  });

  it('explains files that have no saved work or are for another site', () => {
    expect(readBackup('<html><body>hello</body></html>', riley, ids)).toMatchObject({ ok: false, reason: 'none' });
    const { html } = rileysReport();
    expect(readBackup(html, riley, ['route-hijack'])).toMatchObject({ ok: false, reason: 'unknown-lab' });
  });
});
