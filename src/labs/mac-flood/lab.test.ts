import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import { checkNewMac, checkPortSecurity } from '../../runtime/switchInput';
import { macsOnPort, macTableUse } from '../../sim/switchsec';
import type { LabProgress } from '../../store/progress';
import { playMove, playStep } from '../solution';
import { macFloodLab as lab } from '.';
import { buildOffice, isAttendance, MAC, PORT, TABLE_SIZE } from './scenario';
import { macFloodSolution as sol } from './solution';

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
    studentId: `mac-flood-${n++}`,
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

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('mac-flood lab', () => {
  it('before the flood, Mallory sees only the ARP broadcast', () => {
    const s = playTo('jack');
    const frames = s.sim.dev('mallory').capture.map((c) => c.frame);
    expect(frames.some((f) => f.arp?.op === 'request')).toBe(true);
    expect(frames.some(isAttendance)).toBe(false);
  });

  it("the step 2 goal needs Mallory to be capturing when the attendance goes by", () => {
    const s = playTo('office');
    playMove(s, { press: 'plug-in' });
    playMove(s, { press: 'ortiz-sends' }); // capture still off
    expect(s.goalDone('jack', 'sent')).toBe(false);
    playMove(s, { tool: { type: 'sniff', device: 'mallory', on: true } });
    playMove(s, { press: 'ortiz-sends' }); // ARP is cached now: no broadcast this time
    expect(s.goalDone('jack', 'sent')).toBe(true);
  });

  it('one burst is not enough: the table fills on the second', () => {
    const s = playTo('jack');
    playMove(s, { tool: { type: 'mac-flood', device: 'mallory', bursts: 1 } });
    expect(macTableUse(s.sim.dev('sw')).used).toBeLessThan(TABLE_SIZE);
    expect(s.goalDone('flood', 'full')).toBe(false);
    playMove(s, { tool: { type: 'mac-flood', device: 'mallory', bursts: 1 } });
    expect(macTableUse(s.sim.dev('sw')).used).toBe(TABLE_SIZE);
    expect(s.sim.dev('sw').macTable[MAC.records]).toBeUndefined();
    expect(s.goalDone('flood', 'gone')).toBe(true);
  });

  it('the flood pushes out real entries and Mallory captures the attendance', () => {
    const s = playTo('overheard');
    expect(s.sim.dev('mallory').capture.some((c) => isAttendance(c.frame))).toBe(true);
    const sw = s.sim.dev('sw');
    expect(macsOnPort(sw, PORT.jack).length).toBeGreaterThan(20);
  });

  it('keeps few frames in flight during a big flood', () => {
    const s = playTo('jack');
    s.dispatch({ type: 'mac-flood', device: 'mallory', bursts: 5 });
    s.dispatch({ type: 'ping', device: 'chen', ip: '192.168.50.10' });
    let most = 0;
    for (let i = 0; i < 400 && (s.sim.inflight.length || i < 5); i++) {
      s.sim.advance(20);
      most = Math.max(most, s.sim.inflight.length);
    }
    // 5 bursts of 20 frames, flooded out 6 ports: 5 x 6 stacks, not 600 frames.
    expect(most).toBeLessThanOrEqual(36);
    expect(s.sim.inflight.length).toBe(0);
  });

  it('rebuilds the same MAC table after a reload mid-flood', () => {
    const s = playTo('flood');
    const again = new LabSession(lab, JSON.parse(JSON.stringify(s.progress)) as LabProgress);
    again.sim.runUntilIdle();
    expect(JSON.stringify(again.sim.dev('sw').macTable)).toBe(JSON.stringify(s.sim.dev('sw').macTable));
  });

  it('a reset network in the eavesdropping step is flooded again', () => {
    const s = playTo('flood');
    expect(s.step.id).toBe('overheard');
    s.resetNetwork();
    s.sim.runUntilIdle();
    expect(s.sim.dev('sw').macTable[MAC.records]).toBeUndefined();
    playStep(s, sol.overheard);
    expect(s.missing()).toEqual([]);
  });

  it('the port answer accepts common formats', () => {
    const q = lab.steps[index('detect')].questions!.find((x) => x.id === 'port')!;
    if (q.kind !== 'text' || !q.expect) throw new Error('expected an auto-checked text question');
    for (const ok of ['7', 'port 7', 'Port 7.', 'p7', ' PORT7 ']) expect(q.expect.test(ok), ok).toBe(true);
    for (const bad of ['17', '5', 'port 5', '']) expect(q.expect.test(bad), bad).toBe(false);
  });

  it('port security shuts port 7 at the first extra MAC and keeps the real entries', () => {
    const s = playTo('detect');
    expect(s.step.id).toBe('portsec');
    playMove(s, sol.portsec.moves![0]);
    playMove(s, { press: 'flood-again' });
    const sw = s.sim.dev('sw');
    expect(sw.switchSec?.ports[PORT.jack]?.shutdown).toBe('violation');
    for (const mac of [MAC.router, MAC.records, MAC.ortiz, MAC.chen, MAC.printer]) expect(sw.macTable[mac], mac).toBeDefined();
    expect(macTableUse(sw).used).toBe(5);
    expect(sw.logs.some((e) => e.source === 'port-security' && e.fields?.port === PORT.jack)).toBe(true);
  });

  it('MAC filtering stops Mallory until she copies the printer’s MAC', () => {
    const s = playTo('portsec');
    expect(s.step.id).toBe('filter');
    const [, filter, spoof, take, ping] = sol.filter.moves!;
    playMove(s, filter);
    playMove(s, take);
    playMove(s, ping);
    s.sim.runUntilIdle();
    expect(s.goalDone('filter', 'in')).toBe(false);
    expect(s.sim.events.some((e) => e.type === 'drop' && e.reason === 'port-security')).toBe(true);
    playMove(s, spoof);
    playMove(s, ping);
    expect(s.goalDone('filter', 'in')).toBe(true);
  });

  it('the close step has the port 5 evidence even after a reset', () => {
    const s = playTo('filter');
    expect(s.step.id).toBe('close');
    s.resetNetwork();
    s.sim.runUntilIdle();
    expect(s.sim.peer('sw', PORT.printer)?.device).toBe('printer');
    expect(s.sim.dev('mallory').ifaces[0].mac).toBe(MAC.mallory);
    playStep(s, sol.close);
    expect(s.missing()).toEqual([]);
  });

  it('shutting only port 7 leaves the close step unfinished', () => {
    const s = playTo('filter');
    playMove(s, sol.close.moves![0]);
    playMove(s, { tool: { type: 'port-shutdown', device: 'sw', port: 'p7', shut: true } });
    expect(s.goalDone('close', 'shut')).toBe(false);
  });
});

describe('switch tool inputs', () => {
  const sim = buildOffice();

  it('the MAC changer explains bad MACs', () => {
    expect(checkNewMac(sim, 'mallory', '0A-9E-17-00-00-30')).toMatchObject({ ok: true, mac: MAC.printer });
    expect(checkNewMac(sim, 'mallory', 'ff:ff:ff:ff:ff:ff')).toMatchObject({ ok: false });
    expect(checkNewMac(sim, 'mallory', '01:00:5e:00:00:01')).toMatchObject({ ok: false });
    expect(checkNewMac(sim, 'mallory', '0a:9e:17:00:00')).toMatchObject({ ok: false });
    expect(checkNewMac(sim, 'mallory', MAC.mallory)).toMatchObject({ ok: false });
  });

  it('the port security form explains bad settings', () => {
    expect(checkPortSecurity(sim, 'sw', 'p7', '1', 'shutdown', '')).toEqual({ ok: true, config: { maxMacs: 1, violation: 'shutdown' } });
    expect(checkPortSecurity(sim, 'sw', 'p5', '1', 'restrict', '0a9e.1700.0030')).toEqual({
      ok: true,
      config: { maxMacs: 1, violation: 'restrict', allowed: [MAC.printer] },
    });
    expect(checkPortSecurity(sim, 'sw', 'p7', '0', 'shutdown', '')).toMatchObject({ ok: false, field: 'max' });
    expect(checkPortSecurity(sim, 'sw', 'p7', 'one', 'shutdown', '')).toMatchObject({ ok: false, field: 'max' });
    expect(checkPortSecurity(sim, 'sw', 'p5', '1', 'restrict', `${MAC.printer} ${MAC.ortiz}`)).toMatchObject({ ok: false, field: 'max' });
    expect(checkPortSecurity(sim, 'sw', 'p5', '1', 'restrict', 'printer')).toMatchObject({ ok: false, field: 'allowed' });
  });
});
