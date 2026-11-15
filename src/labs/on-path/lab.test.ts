import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import { infoOf, layersOf, protoOf } from '../../ui/describe';
import { checkStaticArp, staticArpIpError } from '../../runtime/toolInput';
import { isPlainLogin } from '../helpers';
import { playMove, playStep } from '../solution';
import { onPathLab as lab } from '.';
import { buildCafe, enableWpa2, IP, LOGIN_BODY, MAC, PASSWORD } from './scenario';
import { onPathSolution as sol } from './solution';

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
function fresh(): LabSession {
  const now = Date.now();
  const p: LabProgress = {
    labId: lab.id,
    labVersion: lab.version,
    studentId: `on-path-${n++}`,
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
  return new LabSession(lab, p);
}

const index = (id: string) => lab.steps.findIndex((s) => s.id === id);

/** Play the answer key through the step before `id`, then open `id`. */
function openStep(id: string): LabSession {
  const s = fresh();
  for (let i = 0; i < index(id); i++) {
    playStep(s, sol[s.step.id]);
    expect(s.missing(), `step "${s.step.id}" left unfinished`).toEqual([]);
    s.goTo(i + 1);
  }
  s.sim.runUntilIdle();
  return s;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('on-path: WPA2 seals other devices’ frames', () => {
  it('Mallory still receives Alice’s login, but sealed, with nothing inside', () => {
    const sim = buildCafe();
    enableWpa2(sim);
    sim.setSniffing('mallory', true);
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    // Alice's ARP request is a broadcast, which every member can read (the next test). Everything else is sealed.
    const caught = sim.dev('mallory').capture.map((c) => c.frame).filter((f) => f.dst !== 'ff:ff:ff:ff:ff:ff');
    expect(caught.length).toBeGreaterThan(0);
    for (const f of caught) {
      expect(f.sealed).toEqual({ mode: 'WPA2' });
      expect(f.ip).toBeUndefined();
      expect(protoOf(f)).toBe('WPA2');
      expect(infoOf(f)).toBe('Encrypted Wi-Fi data (WPA2)');
      expect(JSON.stringify(layersOf(sim, f))).not.toContain(PASSWORD);
    }
    // Both directions: Alice to the router and the router to Alice.
    expect(caught.some((f) => f.src === MAC.alice && f.dst === MAC.router)).toBe(true);
    expect(caught.some((f) => f.src === MAC.router && f.dst === MAC.alice)).toBe(true);
  });

  it('a broadcast stays readable, and the wired router gets frames as they are', () => {
    const sim = buildCafe();
    enableWpa2(sim);
    sim.setSniffing('mallory', true);
    sim.setSniffing('router', true);
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY); // Alice has no ARP entry yet, so she asks first
    sim.runUntilIdle();
    const mallory = sim.dev('mallory').capture.map((c) => c.frame);
    expect(mallory.some((f) => f.arp?.op === 'request' && !f.sealed)).toBe(true);
    expect(sim.dev('router').capture.some((c) => isPlainLogin(c.frame))).toBe(true);
  });

  it('a frame addressed to Mallory reaches her readable, so ARP poisoning still works', () => {
    const sim = buildCafe();
    enableWpa2(sim);
    sim.setSniffing('mallory', true);
    sim.setForwarding('mallory', true);
    sim.arpSpoof('mallory', 'alice', IP.router);
    sim.arpSpoof('mallory', 'router', IP.alice);
    sim.runUntilIdle();
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    expect(sim.dev('mallory').capture.some((c) => isPlainLogin(c.frame))).toBe(true);
  });

  it('frames between two Wi-Fi devices stay off the wired port to the router', () => {
    const sim = buildCafe();
    enableWpa2(sim);
    sim.setSniffing('router', true);
    sim.setSniffing('mallory', true);
    sim.setForwarding('mallory', true);
    sim.arpSpoof('mallory', 'alice', IP.router);
    sim.arpSpoof('mallory', 'router', IP.alice);
    sim.runUntilIdle();
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    const atRouter = sim.dev('router').capture.map((c) => c.frame);
    // Alice to Mallory and Mallory to Alice never reach the router. Mallory to the router does.
    expect(atRouter.some((f) => f.dst === MAC.alice || f.src === MAC.alice)).toBe(false);
    expect(atRouter.some((f) => f.src === MAC.mallory && f.dst === MAC.router && isPlainLogin(f))).toBe(true);
    expect(sim.dev('mallory').capture.some((c) => isPlainLogin(c.frame))).toBe(true);
  });

  it('the ARP lock blames the IP box only when the IP is wrong', () => {
    const sim = buildCafe();
    expect(staticArpIpError(sim, 'alice', IP.router)).toBeUndefined();
    expect(staticArpIpError(sim, 'alice', '192.168.1.99')).toMatch(/No device/);
    // A flipped MAC fails with a good IP, so only the MAC box should turn red.
    const r = checkStaticArp(sim, 'alice', IP.router, '0c:af:e0:00:00:10');
    expect(r.ok).toBe(false);
  });

  it('turning WPA2 on is quiet and idempotent', () => {
    const sim = buildCafe();
    sim.quiet = true;
    enableWpa2(sim);
    const after = sim.events.length;
    enableWpa2(sim);
    expect(sim.events.length).toBe(after);
    expect(sim.dev('wifi').kind).toBe('hub');
    expect(sim.dev('wifi').sublabel).toBe('WPA2 · password on the chalkboard');
  });
});

describe('on-path lab steps', () => {
  it('step 5 starts with an empty capture, and opening a WPA2 frame meets the goal', () => {
    const s = openStep('wpa2');
    expect(s.sim.dev('mallory').capture).toEqual([]);
    playMove(s, { press: 'login' });
    s.sim.runUntilIdle();
    expect(s.goalDone('wpa2', 'quiet')).toBe(true);
    expect(s.goalDone('wpa2', 'sealed')).toBe(false);
    playMove(s, { openFrame: 'mallory', match: (f) => !!f.sealed });
    expect(s.goalDone('wpa2', 'sealed')).toBe(true);
  });

  it('a cleared capture numbers its packets from 1 again', () => {
    const s = openStep('wpa2');
    playMove(s, { press: 'login' });
    s.sim.runUntilIdle();
    const nos = s.sim.dev('mallory').capture.map((c) => c.no);
    expect(nos[0]).toBe(1);
    expect(nos).toEqual(nos.map((_, i) => i + 1));
  });

  it('the password answer must match case, but spaces around it are fine', () => {
    const q = lab.steps[index('sniff')].questions!.find((x) => x.id === 'password')!;
    if (q.kind !== 'text' || !q.expect) throw new Error('expected an auto-checked text question');
    for (const ok of ['pumpkinspice', ' pumpkinspice ']) expect(q.expect.test(ok), ok).toBe(true);
    for (const bad of ['PumpkinSpice', 'PUMPKINSPICE', 'pumpkin spice', 'pass=pumpkinspice']) expect(q.expect.test(bad), bad).toBe(false);
  });

  it('the relay step only counts a password Mallory captured with forwarding on', () => {
    const s = openStep('relay');
    expect(s.sim.dev('mallory').capture).toEqual([]);
    playMove(s, { press: 'login' }); // forwarding is still off: Mallory drops it
    s.sim.runUntilIdle();
    expect(s.goalDone('relay', 'caught')).toBe(false);
    playStep(s, sol.relay);
    s.sim.runUntilIdle();
    expect(s.goalDone('relay', 'caught')).toBe(true);
    expect(s.goalDone('relay', 'loaded')).toBe(true);
  });

  it('after Alice is locked, the router is still poisoned, as the detect question says', () => {
    const s = openStep('detect');
    playStep(s, sol.detect);
    s.sim.runUntilIdle();
    expect(s.sim.dev('alice').arp[IP.router]).toMatchObject({ mac: MAC.router, via: 'static' });
    expect(s.sim.dev('router').arp[IP.alice]?.mac).toBe(MAC.mallory);
    const q = lab.steps[index('detect')].questions![0];
    if (q.kind !== 'choice') throw new Error('expected a choice');
    expect(q.options.find((o) => o.correct)?.id).toBe('mallory');
  });
});
