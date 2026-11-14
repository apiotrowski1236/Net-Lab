import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import { signalAt } from '../../sim/wifi';
import { replayRecord } from '../../sim/wids';
import { playStep } from '../solution';
import { watchTheAirLab } from './index';
import { watchTheAirSolution } from './solution';
import { BSSID, buildWatch, isMovieNight, ROGUE_PORT, SSID, STAFF } from './scenario';

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
function freshProgress(): LabProgress {
  const now = Date.now();
  return {
    labId: watchTheAirLab.id,
    labVersion: watchTheAirLab.version,
    studentId: `watch-${n++}`,
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

/** A session played through step `id` (inclusive) with the answer key. */
function playThrough(id: string): LabSession {
  const s = new LabSession(watchTheAirLab, freshProgress());
  const at = watchTheAirLab.steps.findIndex((x) => x.id === id);
  for (let i = 0; i <= at; i++) {
    playStep(s, watchTheAirSolution[s.step.id]);
    if (i < at) s.goTo(i + 1);
  }
  return s;
}

/** A session that has just entered step `id`, every step before it played. */
function enter(id: string): LabSession {
  const at = watchTheAirLab.steps.findIndex((x) => x.id === id);
  const s = playThrough(watchTheAirLab.steps[at - 1].id);
  s.goTo(at);
  return s;
}

const joined = (s: LabSession, id: string) => s.sim.dev(id).wifiClient?.joinedAp;

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));

describe('watch-the-air lab', () => {
  it('opens with everyone on the real network and only approved radios on the air', () => {
    const sim = buildWatch();
    for (const id of [...STAFF, 'visitor']) expect(sim.dev(id).wifiClient?.joinedAp).toBe('wap');
    expect(sim.wifiScanRows(sim.dev('desk')).map((r) => r.bssid).sort()).toEqual([BSSID.wap, BSSID.wap2].sort());
  });

  it('the sweep shows the rogue box to the desk, and the switch log has it on port 7', () => {
    const s = enter('sweep');
    expect(s.sim.wifiScanRows(s.sim.dev('desk')).map((r) => r.bssid)).toContain(BSSID.rogue);
    const lines = s.sim.dev('lansw').logs.filter((e) => e.fields?.port === ROGUE_PORT);
    expect(lines.length).toBe(2);
    expect(lines.every((e) => e.t < 0)).toBe(true);
    // The switch's own MAC table agrees with its log line.
    expect(s.sim.dev('lansw').macTable[BSSID.rogue]).toBe(ROGUE_PORT);
  });

  it('a copy with the exact name and security pulls in the visitor but no staff device, even one that hears it louder', () => {
    const s = playThrough('lookalike');
    const sim = s.sim;
    const twin = sim.dev('twin').wifi!;
    // A phone only roams between radios with the same name and security, so the copy matches both.
    expect([twin.ssid, twin.security, twin.auth]).toEqual([SSID, 'wpa3', 'eap']);
    expect(twin.server).not.toBe(sim.dev('wap').wifi!.server);
    expect(joined(s, 'visitor')).toBe('twin');
    for (const id of STAFF) expect(joined(s, id)).toBe('wap');
    // The lesson says some staff devices hear the copy louder. Keep that true.
    const louder = STAFF.filter((id) => signalAt(sim.dev('twin').wifi!, sim.dev('twin'), sim.dev(id)) > signalAt(sim.dev('wap').wifi!, sim.dev('wap'), sim.dev(id)));
    expect(louder.length).toBeGreaterThan(0);
    // The visitor also hears the copy louder, which is why the phone moved.
    expect(signalAt(sim.dev('twin').wifi!, sim.dev('twin'), sim.dev('visitor'))).toBeGreaterThan(signalAt(sim.dev('wap').wifi!, sim.dev('wap'), sim.dev('visitor')));
  });

  it('the radio can only be unplugged once the readings have found it', () => {
    const s = enter('find');
    s.runStepAction('unplug');
    expect(s.sim.dev('twin').wifi!.off).toBeFalsy();
    playStep(s, watchTheAirSolution.find);
    expect(s.sim.dev('twin').wifi!.off).toBe(true);
  });

  it('unplugging the copy and saving a profile brings the visitor back to stay', () => {
    const s = playThrough('find');
    expect(joined(s, 'visitor')).toBe('wap');
    s.sim.setWifiOff('twin', false);
    expect(joined(s, 'visitor')).toBe('wap');
  });

  it('jamming knocks everyone off while the access point stays up on the wire', () => {
    const s = enter('jam');
    for (const id of [...STAFF, 'visitor']) expect(joined(s, id)).toBeUndefined();
    expect(s.sim.dev('lansw').switchSec?.ports.p1?.shutdown).toBeUndefined();
    expect(s.sim.dev('lansw').ifaces.find((i) => i.id === 'p1')?.linkId).toBeTruthy();
    expect(s.sim.channelNoise(6)).toBe(88);
    expect(s.sim.wifiScanRows(s.sim.dev('desk')).map((r) => r.bssid)).toContain(BSSID.wap);
  });

  it("tonight's log times match the story and the 14-day record", () => {
    const s = playThrough('crowd');
    const min = (hhmm: string) => (Number(hhmm.slice(0, 2)) - 18) * 60 * 60 * 1000 + Number(hhmm.slice(3)) * 60 * 1000;
    const wap = s.sim.dev('wap').logs;
    const heard = wap.find((e) => e.fields?.bssid === BSSID.twin && e.fields?.action === 'heard')!;
    const jam = wap.find((e) => e.fields?.action === 'noise' && Number(e.fields?.noise) > 50)!;
    const movie = wap.filter((e) => e.fields?.action === 'noise' && Number(e.fields?.noise) > 10 && Number(e.fields?.noise) <= 50).pop()!;
    // Within a few minutes of the record's day-14 entries.
    expect(Math.abs(heard.t - min('18:05'))).toBeLessThan(5 * 60 * 1000);
    expect(Math.abs(jam.t - min('19:30'))).toBeLessThan(5 * 60 * 1000);
    expect(Math.abs(movie.t - min('20:00'))).toBeLessThan(5 * 60 * 1000);
  });

  it('movie night raises the noise a little and keeps everyone connected', () => {
    const s = playThrough('crowd');
    const noise = s.sim.channelNoise(6);
    expect(noise).toBeGreaterThan(10);
    expect(noise).toBeLessThan(20);
    for (const id of [...STAFF, 'visitor']) expect(joined(s, id)).toBe('wap');
    const line = s.sim.dev('wap').logs.filter((e) => e.fields?.action === 'noise').at(-1)!;
    expect(Number(line.fields?.devices)).toBeGreaterThan(100);
  });

  it('only a noise level between movie night and the jammer catches everything without a movie-night alarm', () => {
    const w = buildWatch().dev('wap').wids!;
    for (const r of Object.keys(w.rules) as (keyof typeof w.rules)[]) w.rules[r] = true;
    const at = (level: number) => {
      w.noiseThreshold = level;
      return replayRecord(w, 0);
    };
    expect(at(10).falseAlarms.some(isMovieNight)).toBe(true);
    expect(at(95).missed).toEqual(['the jammer']);
    for (const level of [20, 40, 60, 80]) {
      const r = at(level);
      expect(r.missed).toEqual([]);
      expect(r.falseAlarms).toEqual(["a volunteer's new laptop"]);
    }
  });

  it('each rule alone misses something, so the alarms work as a set', () => {
    const w = buildWatch().dev('wap').wids!;
    w.noiseThreshold = 40;
    for (const only of Object.keys(w.rules) as (keyof typeof w.rules)[]) {
      for (const r of Object.keys(w.rules) as (keyof typeof w.rules)[]) w.rules[r] = r === only;
      expect(replayRecord(w, 0).missed.length).toBeGreaterThan(0);
    }
  });

  it('replays the same network and citations after a reload', () => {
    const s = playThrough('evidence');
    const saved = JSON.parse(JSON.stringify(s.progress)) as LabProgress;
    const again = new LabSession(watchTheAirLab, saved);
    expect(again.sim.logCites).toEqual(s.sim.logCites);
    expect(again.sim.dev('wap').wids!.marks).toEqual(s.sim.dev('wap').wids!.marks);
  });
});
