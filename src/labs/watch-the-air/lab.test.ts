import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import type { ActionDef } from '../types';
import { signalAt } from '../../sim/wifi';
import { replayRecord } from '../../sim/wids';
import { playStep } from '../solution';
import { watchTheAirLab } from './index';
import { watchTheAirSolution } from './solution';
import { BSSID, buildWatch, isMovieNight, ROGUE_PORT, SSID, STAFF, STAFF_PROFILE } from './scenario';

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

/** A lesson button by id, and the tones of the lines under it right now. */
const action = (id: string): ActionDef => watchTheAirLab.steps.flatMap((x) => x.actions ?? []).find((a) => a.id === id)!;
const tones = (s: LabSession, id: string) => action(id).outcome!(s.sim, s.since).map((l) => l.tone);

/** Enter step `id` from the step before it, and return the events entering it emitted. */
function entering(id: string) {
  const at = watchTheAirLab.steps.findIndex((x) => x.id === id);
  const s = playThrough(watchTheAirLab.steps[at - 1].id);
  const n = s.sim.events.length;
  s.goTo(at);
  return { s, events: s.sim.events.slice(n) };
}

/** Run step `id`'s setup again, as a reload or a skip-ahead would, quietly. */
function rerunSetup(s: LabSession, id: string) {
  s.sim.quiet = true;
  watchTheAirLab.steps.find((x) => x.id === id)!.setup!(s.sim);
  s.sim.quiet = false;
}

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
    // The access point's port shows the devices behind it, so it doesn't look dead next to the box.
    expect(Object.values(s.sim.dev('lansw').macTable).filter((p) => p === 'p1').length).toBeGreaterThan(3);
    expect(s.sim.dev('lansw').switchSec!.ports.p1.framesIn).toBeGreaterThan(0);
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
    // The access point keeps writing its log while jammed, which the lesson points to.
    expect(s.sim.dev('wap').logs.some((e) => e.t >= s.since && e.fields?.action === 'noise')).toBe(true);
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
    // The jam ends right after it starts, so movie night is "half an hour later".
    const quiet = wap.slice(wap.indexOf(jam)).find((e) => e.fields?.action === 'noise' && Number(e.fields?.noise) <= 10)!;
    expect(quiet.t).toBeLessThan(min('19:35'));
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

  it('a copy that changes its security after taking the name leaves staff profiles alone', () => {
    const sim = buildWatch();
    const before = STAFF.map((id) => JSON.stringify(sim.dev(id).wifiClient!.profile));
    expect(before.every((p) => p !== undefined)).toBe(true);
    // The wrong order on purpose: name first, then the sign-in and the encryption.
    sim.setWifiOff('twin', false);
    sim.setWifiSsid('twin', SSID);
    sim.setWifiAuth('twin', 'eap');
    sim.setWifiSecurity('twin', 'wpa3');
    expect(STAFF.map((id) => JSON.stringify(sim.dev(id).wifiClient!.profile))).toEqual(before);
    for (const id of STAFF) expect(sim.dev(id).wifiClient!.joinedAp).toBe('wap');
  });

  it('the real access point changing its security re-saves the profiles of devices on it', () => {
    const sim = buildWatch();
    sim.setWifiSecurity('wap', 'wpa2');
    for (const id of STAFF) {
      expect(sim.dev(id).wifiClient!.profile).toEqual({ ...STAFF_PROFILE, security: 'wpa2' });
      expect(sim.dev(id).wifiClient!.joinedAp).toBe('wap');
    }
  });

  it('the lesson buttons wait until their result is in, then report it', () => {
    const look = enter('lookalike');
    expect(tones(look, 'copy-name')).toEqual(['wait']);
    look.runStepAction('copy-name');
    expect(tones(look, 'copy-name')).toEqual([...STAFF.map(() => 'good'), 'bad']);

    const find = enter('find');
    expect(tones(find, 'unplug')).toEqual(['wait']);
    find.runStepAction('unplug');
    expect(tones(find, 'unplug')).toEqual(['wait']);
    expect(tones(find, 'save-profile')).toEqual(['wait']);
    playStep(find, watchTheAirSolution.find);
    expect(tones(find, 'unplug')).toEqual(['good']);
    expect(action('unplug').outcome!(find.sim, find.since)[0].text).toContain('is back on the real network');
    expect(tones(find, 'save-profile')).toEqual(['good']);

    const crowd = enter('crowd');
    expect(tones(crowd, 'movie-night')).toEqual(['wait']);
    crowd.runStepAction('movie-night');
    expect(tones(crowd, 'movie-night')).toEqual(['good']);
  });

  it('the movie-night scan only counts once movie night has started', () => {
    const s = enter('crowd');
    s.dispatch({ type: 'wifi-scan', device: 'desk' });
    s.runStepAction('movie-night');
    expect(s.goalDone('crowd', 'busy')).toBe(true);
    expect(s.goalDone('crowd', 'scan')).toBe(false);
    s.dispatch({ type: 'wifi-scan', device: 'desk' });
    expect(s.goalDone('crowd', 'scan')).toBe(true);
  });

  it('setups are quiet and give the same network when they run again', () => {
    let seen = 0;
    for (const id of ['sweep', 'lookalike', 'find', 'jam', 'crowd', 'alarms']) {
      const { s, events } = entering(id);
      seen += events.length;
      expect(events.every((e) => e.quiet), id).toBe(true);
      const snap = () => JSON.stringify({ wifi: ['rogue', 'twin', 'wap'].map((d) => s.sim.dev(d).wifi), joined: [...STAFF, 'visitor'].map((d) => joined(s, d)), port: s.sim.dev('lansw').switchSec!.ports, logs: s.sim.dev('lansw').logs.length, heard: s.sim.dev('wap').wids!.heard });
      const before = snap();
      rerunSetup(s, id);
      expect(snap(), id).toBe(before);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("setups keep the student's own moves", () => {
    // Port 7 shut by the student stays shut, and the box's log lines aren't added twice.
    const sweep = playThrough('sweep');
    expect(sweep.sim.dev('lansw').switchSec!.ports[ROGUE_PORT].shutdown).toBeTruthy();
    rerunSetup(sweep, 'sweep');
    expect(sweep.sim.dev('lansw').logs.filter((e) => e.fields?.port === ROGUE_PORT && e.t < 0).length).toBe(2);
    expect(sweep.sim.dev('lansw').switchSec!.ports[ROGUE_PORT].shutdown).toBeTruthy();
    // A copy the student already unplugged doesn't come back on the air.
    const find = playThrough('find');
    rerunSetup(find, 'find');
    rerunSetup(find, 'lookalike');
    expect(find.sim.dev('twin').wifi!.off).toBe(true);
    expect(joined(find, 'visitor')).toBe('wap');
    // A profile the student saved stays as it was.
    const saved = JSON.stringify(find.sim.dev('visitor').wifiClient!.profile);
    rerunSetup(find, 'jam');
    expect(JSON.stringify(find.sim.dev('visitor').wifiClient!.profile)).toBe(saved);
  });

  it('replays the same network and citations after a reload', () => {
    const s = playThrough('evidence');
    const saved = JSON.parse(JSON.stringify(s.progress)) as LabProgress;
    const again = new LabSession(watchTheAirLab, saved);
    expect(again.sim.logCites).toEqual(s.sim.logCites);
    expect(again.sim.dev('wap').wids!.marks).toEqual(s.sim.dev('wap').wids!.marks);
  });
});
