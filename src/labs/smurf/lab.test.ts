import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import { playMove, playStep } from '../solution';
import { smurfLab as lab } from '.';
import { buildEchoStorm, CAMPUS_BCAST, FAN, LAN_HOSTS, PC1, SMURF_RATE, STORM_COUNT, TICKETS, UPLINK_CAP, uplinkId, WEB } from './scenario';
import { smurfSolution as sol } from './solution';

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
    studentId: `smurf-${n++}`,
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

/** Play the answer key through step `id` (inclusive), then open the next step. */
function playTo(id: string, s = fresh()): LabSession {
  for (let i = s.progress.step; i <= index(id); i++) {
    playStep(s, sol[s.step.id]);
    expect(s.missing(), `step "${s.step.id}" left unfinished`).toEqual([]);
    if (i < lab.steps.length - 1) s.goTo(i + 1);
  }
  s.sim.runUntilIdle();
  return s;
}

const deviceState = (s: LabSession) => JSON.stringify({ t: s.sim.t, devices: s.sim.devices });

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('directed broadcasts and forged echoes', () => {
  it('one ping to the broadcast address gets one reply per campus host', () => {
    const sim = buildEchoStorm();
    sim.echo('mallory', CAMPUS_BCAST);
    sim.runUntilIdle();
    const reply = sim.events.find((e) => e.type === 'ping-reply' && e.device === 'mallory');
    expect(reply, 'a reply burst reaches Mallory').toBeDefined();
    expect(reply?.type === 'ping-reply' ? reply.count : undefined).toBe(LAN_HOSTS);
  });

  it('the campus router logs an ICMP-to-broadcast line the moment it amplifies', () => {
    const sim = buildEchoStorm();
    sim.echo('mallory', CAMPUS_BCAST);
    sim.runUntilIdle();
    expect(sim.dev('campus').logs.some((e) => e.fields?.dst === CAMPUS_BCAST && e.fields?.proto === 'icmp')).toBe(true);
  });

  it('a forged source sends the reply to the victim, not the attacker', () => {
    const sim = buildEchoStorm();
    sim.echo('mallory', PC1, { source: WEB });
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'web' && e.from === PC1)).toBe(true);
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'mallory')).toBe(false);
  });

  it('turning off directed-broadcast forwarding drops the request and makes no replies', () => {
    const sim = buildEchoStorm();
    sim.setDirectedBroadcast('campus', false);
    sim.echo('mallory', CAMPUS_BCAST, { source: WEB });
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'drop' && e.device === 'campus' && e.reason === 'no-broadcast')).toBe(true);
    expect(sim.events.some((e) => e.type === 'ping-reply')).toBe(false);
    expect(sim.linkPps(uplinkId(sim))).toBe(0);
  });
});

describe('congestion and the flood', () => {
  it('the storm fills the uplink past its capacity and a fan purchase is dropped', () => {
    const sim = buildEchoStorm();
    sim.setLinkFlood(uplinkId(sim), 'smurf', SMURF_RATE);
    sim.echo('mallory', CAMPUS_BCAST, { source: WEB, burst: { count: STORM_COUNT } });
    sim.browse('fan', `https://${TICKETS}/checkout`);
    sim.runUntilIdle();
    expect(sim.linkPps(uplinkId(sim))).toBeGreaterThan(UPLINK_CAP);
    expect(sim.events.some((e) => e.type === 'drop' && e.reason === 'congestion' && e.pkt?.app.kind === 'http-req' && e.pkt.src === FAN)).toBe(true);
    expect(sim.dev('fan').browser?.status).toBe('failed');
  });

  it('with no flood on the uplink, the same purchase goes through', () => {
    const sim = buildEchoStorm();
    sim.browse('fan', `https://${TICKETS}/checkout`);
    sim.runUntilIdle();
    expect(sim.dev('fan').browser?.status).toBe('loaded');
    expect(sim.dev('fan').browser?.host).toBe(TICKETS);
  });

  it('a burst crosses a full link (the flood stays visible) while a single packet is dropped', () => {
    const sim = buildEchoStorm();
    sim.setLinkFlood(uplinkId(sim), 'botnet', 300);
    // The botnet burst reaches the edge even though the link is "full"; the fan's lone request does not.
    sim.echo('mallory', WEB, { burst: { count: 300, vary: 'src-ip' } });
    sim.browse('fan', `https://${TICKETS}/checkout`);
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-sent' && e.device === 'mallory' && (e.count ?? 1) >= 2)).toBe(true);
    expect(sim.dev('fan').browser?.status).toBe('failed');
  });
});

describe('smurf lab', () => {
  it('plays from the first step to the last with every step complete', () => {
    const s = fresh();
    for (let i = 0; i <= lab.steps.length - 1; i++) {
      playStep(s, sol[s.step.id]);
      expect(s.missing(), `step "${s.step.id}" left unfinished`).toEqual([]);
      if (i < lab.steps.length - 1) s.goTo(i + 1);
    }
  });

  it('the edge firewall drops inbound ICMP yet the uplink stays full until the ISP filters upstream', () => {
    const s = playTo('silence-the-amplifier');
    expect(s.step.id).toBe('guard-your-edge');
    const [addRule, botnet, buy, ispFilter, buyAgain] = sol['guard-your-edge'].moves!;
    playMove(s, addRule);
    playMove(s, botnet);
    playMove(s, buy);
    expect(s.goalDone('guard-your-edge', 'rule')).toBe(true);
    expect(s.goalDone('guard-your-edge', 'still-fails')).toBe(true);
    expect(s.goalDone('guard-your-edge', 'upstream-fixes')).toBe(false);
    playMove(s, ispFilter);
    playMove(s, buyAgain);
    expect(s.goalDone('guard-your-edge', 'upstream-fixes')).toBe(true);
    expect(s.sim.dev('fan').browser?.status).toBe('loaded');
  });

  it('rebuilds identical device state after a reload mid-storm', () => {
    const s = playTo('the-storm');
    const again = new LabSession(lab, JSON.parse(JSON.stringify(s.progress)) as LabProgress);
    again.sim.runUntilIdle();
    expect(deviceState(again)).toBe(deviceState(s));
  });
});
