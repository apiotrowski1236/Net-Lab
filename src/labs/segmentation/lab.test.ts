import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import { checkAddress } from '../../runtime/toolInput';
import { prefixContains } from '../../sim/addr';
import { infected } from '../../sim/malware';
import type { Conn } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { LabProgress } from '../../store/progress';
import { playMove, playStep } from '../solution';
import { segmentationLab as lab } from '.';
import { INSIDE, NET, ZONE_OF } from './scenario';
import { segmentationSolution as sol } from './solution';

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
    studentId: `segmentation-${n++}`,
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
    s.goTo(i + 1);
  }
  s.sim.runUntilIdle();
  return s;
}

/** Play only the tool moves of a step's answer key (no buttons, no questions). */
function setOnly(s: LabSession, id: string): void {
  for (const m of sol[id].moves ?? []) if ('tool' in m) playMove(s, m);
}

/** Start a connection and run until it ends. */
function conn(sim: Sim, from: string, to: string, port: number): Conn {
  const id = sim.connectService(from, sim.ipOf(to), port);
  sim.runUntilIdle();
  return sim.dev(from).conns!.find((c) => c.id === id)!;
}

const denies = (sim: Sim) => sim.dev('fw').logs.filter((e) => e.fields?.action === 'deny');
const CREW = ['crew1', 'crew2', 'media'];

/** Step 7's result: the malware stays in the crew zone. */
function expectContained(s: LabSession): void {
  const sim = s.sim;
  const since = s.since;
  s.runStepAction('install');
  sim.runUntilIdle();
  expect(infected(sim).sort()).toEqual([...CREW].sort());
  for (const id of CREW) {
    expect(
      denies(sim).some((e) => e.t >= since && e.fields?.src === sim.ipOf(id) && e.fields?.dport === 445),
      `a deny line from ${id}`,
    ).toBe(true);
  }
  expect(sim.events.some((e) => e.t >= since && e.type === 'malware-done')).toBe(true);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('segmentation lab', () => {
  it('on the flat network, the game infects all eight, and the firewall sees none of it', () => {
    const s = playTo('ship');
    expect(s.step.id).toBe('worm');
    s.runStepAction('install');
    s.sim.runUntilIdle();
    expect(infected(s.sim).sort()).toEqual([...INSIDE].sort());
    expect(s.sim.dev('fire').malware).toMatchObject({ via: 'file-share', from: 'crew1' });
    expect(s.sim.dev('crew1').malware).toMatchObject({ via: 'install' });
    expect(s.sim.dev('fw').logs).toEqual([]);
  });

  it('with VLANs, Crew laptop 1’s ARP request stays in VLAN 30', () => {
    const s = playTo('plan');
    expect(s.step.id).toBe('vlans');
    setOnly(s, 'vlans');
    const sim = s.sim;
    for (const d of Object.values(sim.devices)) if (d.id !== 'sw' && d.id !== 'crew1') sim.setSniffing(d.id, true);
    const asks = (id: string) => sim.dev(id).capture.some((c) => c.frame.arp?.op === 'request' && c.frame.src === sim.dev('crew1').ifaces[0].mac);
    s.runStepAction('ping-fire');
    sim.runUntilIdle();
    expect(asks('crew2')).toBe(true);
    expect(asks('media')).toBe(true);
    for (const id of ['fire', 'torpedo', 'command', 'nav', 'chart', 'fw']) expect(asks(id), id).toBe(false);
    expect(sim.events.some((e) => e.type === 'ping-fail' && e.device === 'crew1' && e.reason === 'arp-timeout')).toBe(true);
    s.runStepAction('ping-media');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'crew1' && e.from === sim.ipOf('media'))).toBe(true);
  });

  it('with subnets but Allow all, the malware crosses the firewall into Weapons and Operations', () => {
    const s = playTo('vlans');
    expect(s.step.id).toBe('subnets');
    setOnly(s, 'subnets');
    const sim = s.sim;
    sim.infect('crew1');
    sim.runUntilIdle();
    const far = infected(sim).filter((id) => ZONE_OF[id] === 'weapons' || ZONE_OF[id] === 'operations');
    expect(far.some((id) => ZONE_OF[id] === 'weapons')).toBe(true);
    expect(far.some((id) => ZONE_OF[id] === 'operations')).toBe(true);
    // Every one of those copies came from another zone, through the firewall.
    for (const id of far) {
      const from = sim.dev(id).malware!.from!;
      expect(ZONE_OF[from], `${id}'s copy`).not.toBe(ZONE_OF[id]);
      expect(
        sim.events.some(
          (e) =>
            e.type === 'firewall' &&
            e.device === 'fw' &&
            e.verdict.action === 'allow' &&
            e.pkt.src === sim.ipOf(from) &&
            e.pkt.dst === sim.ipOf(id) &&
            e.pkt.dstPort === 445,
        ),
        `${id}'s copy passed the firewall`,
      ).toBe(true);
    }
  });

  it('the zone policy allows only what the orders list, and replies come back', () => {
    const s = playTo('subnets');
    expect(s.step.id).toBe('policy');
    setOnly(s, 'policy');
    const sim = s.sim;
    expect(conn(sim, 'command', 'fire', 5001).status).toBe('open');
    expect(conn(sim, 'command', 'fire', 445)).toMatchObject({ status: 'no-answer', reason: 'firewall', at: 'fw' });
    expect(conn(sim, 'fire', 'command', 5002).status).toBe('open');
    expect(conn(sim, 'crew1', 'fire', 445)).toMatchObject({ status: 'no-answer', reason: 'firewall', at: 'fw' });
    const lines = denies(sim);
    expect(lines.some((e) => e.fields?.src === sim.ipOf('command') && e.fields?.dport === 445 && e.fields?.rule === 'Operations to Weapons')).toBe(true);
    expect(lines.some((e) => e.fields?.src === sim.ipOf('crew1') && e.fields?.dport === 445 && e.fields?.rule === 'Crew to Weapons')).toBe(true);
    // Allowed traffic is never logged as a deny.
    expect(lines.some((e) => e.fields?.dport === 5001 || e.fields?.dport === 5002)).toBe(false);
  });

  it('after segmentation, the game infects only the crew zone', () => {
    const s = playTo('policy');
    expect(s.step.id).toBe('contain');
    expectContained(s);
  });

  it('the spare jack lets a laptop into Weapons until the port is shut', () => {
    const s = playTo('contain');
    expect(s.step.id).toBe('jack');
    const sim = s.sim;
    s.runStepAction('plug');
    sim.runUntilIdle();
    const first = sim.dev('personal').conns!.at(-1)!;
    expect(first).toMatchObject({ status: 'open', port: 445, to: sim.ipOf('fire') });
    expect(prefixContains(NET.weapons, sim.ipOf('personal'))).toBe(true);
    s.dispatch({ type: 'port-shutdown', device: 'sw', port: 'p3', shut: true });
    s.runStepAction('plug');
    sim.runUntilIdle();
    const second = sim.dev('personal').conns!.at(-1)!;
    expect(second.id).not.toBe(first.id);
    expect(second.status).not.toBe('open');
  });

  it('the address checks follow the VLANs and the port pins', () => {
    const fixed = lab.steps[index('subnets')].tools!.flatMap((t) => (t.kind === 'ip-config' ? (t.fixed ?? []) : []));
    // Step 4 state: everyone still on 10.0.0.0/24, ports in their VLANs.
    const s4 = playTo('plan');
    setOnly(s4, 'vlans');
    const p1 = checkAddress(s4.sim, 'fw', 'p1', '10.0.10.1/24', fixed);
    expect(p1).toMatchObject({ ok: true, cidr: '10.0.10.1/24' });
    // Step 5 state: Weapons on 10.0.10.0/24, Crew laptop 1 still on 10.0.0.0/24.
    const s5 = playTo('vlans');
    const sim = s5.sim;
    expect(prefixContains(NET.weapons, sim.ipOf('fire'))).toBe(true);
    expect(checkAddress(sim, 'fw', 'p3', '10.0.30.5/24', fixed)).toMatchObject({ ok: false, suggest: '10.0.30.1/24' });
    const p3 = checkAddress(sim, 'fw', 'p3', '10.0.30.1/24', fixed);
    expect(p3.ok).toBe(true);
    s5.dispatch({ type: 'set-ip', device: 'fw', iface: 'p3', cidr: '10.0.30.1/24' });
    const crew1 = checkAddress(sim, 'crew1', 'eth0', '10.0.30.31/24', fixed);
    expect(crew1.ok).toBe(true);
    expect(crew1.ok && crew1.note).toBeFalsy();
  });

  it('Reset network in step 7 still contains the malware', () => {
    const s = playTo('policy');
    s.runStepAction('install');
    s.sim.runUntilIdle();
    s.resetNetwork();
    expect(infected(s.sim)).toEqual([]);
    expectContained(s);
  });

  it('step 6’s tests answer quickly, so one finishes before the next is pressed', () => {
    const s = playTo('subnets');
    setOnly(s, 'policy');
    for (const [id, port, status] of [['target', 5001, 'open'], ['share', 445, 'no-answer'], ['status', 5002, 'open'], ['crew-share', 445, 'no-answer']] as const) {
      const t0 = s.sim.t;
      s.runStepAction(id);
      s.sim.runUntilIdle();
      const end = s.sim.events.find((e) => e.t >= t0 && e.type === 'conn-result' && e.conn.port === port);
      expect(end && end.type === 'conn-result' && end.conn.status, id).toBe(status);
      // No ARP wait in front: one round trip through the firewall, about 15 seconds at 1×.
      expect(end!.t - t0, id).toBeLessThanOrEqual(5000);
    }
  });

  it('step 7: a step 6 test pressed just before Continue does not count as the malware’s probe', () => {
    const s = fresh();
    for (let i = 0; i < index('policy'); i++) {
      playStep(s, sol[s.step.id]);
      s.goTo(i + 1);
    }
    playStep(s, sol[s.step.id]);
    expect(s.step.id).toBe('policy');
    // Press the file-share test and continue before its deny lands.
    s.runStepAction('crew-share');
    s.goTo(index('policy') + 1);
    expect(s.step.id).toBe('contain');
    s.sim.runUntilIdle();
    const late = s.sim.dev('fw').logs.find((e) => e.t >= s.since && e.fields?.action === 'deny' && e.fields?.dport === 445);
    expect(late, 'the test’s deny lands in step 7').toBeTruthy();
    s.ui({ type: 'ui:open-log', device: 'fw', entry: late! });
    s.missing();
    expect(s.goalDone('contain', 'blocked')).toBe(false);
    expect(s.goalDone('contain', 'log')).toBe(false);
    s.runStepAction('install');
    s.sim.runUntilIdle();
    playStep(s, sol.contain);
    s.missing();
    expect(s.goalDone('contain', 'blocked')).toBe(true);
    expect(s.goalDone('contain', 'log')).toBe(true);
  });

  it('step 7’s log goal takes only a probe from this step, not a step 6 test line', () => {
    const s = playTo('policy');
    expect(s.step.id).toBe('contain');
    const crewDeny = (e: { fields?: Record<string, unknown> }) =>
      e.fields?.action === 'deny' && e.fields?.dport === 445 && prefixContains(NET.crew, String(e.fields?.src ?? ''));
    // Crew laptop 1's file-share test from step 6 is still in the log.
    const old = s.sim.dev('fw').logs.find(crewDeny)!;
    expect(old.t).toBeLessThan(s.since);
    s.ui({ type: 'ui:open-log', device: 'fw', entry: old });
    expect(s.goalDone('contain', 'log')).toBe(false);
    s.runStepAction('install');
    s.sim.runUntilIdle();
    playMove(s, { openLog: 'fw', where: crewDeny });
    expect(s.goalDone('contain', 'log')).toBe(true);
  });
});
