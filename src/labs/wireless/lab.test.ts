import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import { crack, passphraseStrength } from '../../sim/wifi';
import { cableRefusal, checkWifiPassphrase, checkWifiPassword } from '../../runtime/toolInput';
import { playStep } from '../solution';
import { wirelessLab } from './index';
import { wirelessSolution } from './solution';
import { buildShelter, FAMILIES, MAC, STRONG_PASS, WEAK_PASS } from './scenario';

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
    labId: wirelessLab.id,
    labVersion: wirelessLab.version,
    studentId: `wifi-${n++}`,
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

const joined = (sim: ReturnType<typeof buildShelter>, id: string) => sim.dev(id).wifiClient?.joinedAp;

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));

describe('wireless lab', () => {
  it('signal strength decides who is in range', () => {
    const sim = buildShelter();
    // Highest power: the lot is covered, so Mallory is on.
    expect(joined(sim, 'mallory')).toBe('wap');
    sim.setWifiPower('wap', 2);
    expect(joined(sim, 'mallory')).toBeUndefined();
    expect(FAMILIES.every((f) => joined(sim, f) === 'wap')).toBe(true);
  });

  it('WEP cracks in no time and WPA3 does not', () => {
    const sim = buildShelter();
    sim.setWifiSecurity('wap', 'wep', WEAK_PASS);
    expect(crack(sim.dev('wap').wifi!)).toMatchObject({ ok: true });
    sim.setWifiSecurity('wap', 'wpa3', STRONG_PASS);
    sim.setWifiWps('wap', false);
    expect(crack(sim.dev('wap').wifi!)).toMatchObject({ ok: false });
  });

  it('WPS undoes a strong WPA2 passphrase', () => {
    const sim = buildShelter();
    sim.setWifiSecurity('wap', 'wpa2', STRONG_PASS);
    expect(crack(sim.dev('wap').wifi!).ok).toBe(true); // WPS still on from the scenario
    sim.setWifiWps('wap', false);
    expect(crack(sim.dev('wap').wifi!).ok).toBe(false);
  });

  it('a cracked WPS PIN leaks the passphrase, so only a new one locks Mallory out', () => {
    const s = new LabSession(wirelessLab, freshProgress());
    const at = wirelessLab.steps.findIndex((st) => st.id === 'lock');
    for (let i = 0; i < at; i++) {
      playStep(s, wirelessSolution[s.step.id]);
      s.goTo(i + 1);
    }
    const step = wirelessLab.steps[at];
    const holds = () => step.goals!.find((g) => g.id === 'holds')!.check({ sim: s.sim, ev: s.sim.events, since: 0 } as never);
    const press = step.actions!.find((a) => a.id === 'mallory-crack')!;
    s.sim.setWifiSecurity('wap', 'wpa2', STRONG_PASS);
    const t0 = s.sim.t;
    press.run(s.sim);
    expect(press.outcome!(s.sim, t0)).toEqual([{ tone: 'bad', text: 'Broken: a few hours (the WPS PIN).' }]);
    expect(joined(s.sim, 'mallory')).toBe('wap');
    s.sim.setWifiWps('wap', false);
    expect(crack(s.sim.dev('wap').wifi!, s.sim.dev('mallory').wifiClient?.passphrase)).toMatchObject({ ok: true, method: 'known' });
    expect(holds()).toBe(false);
    s.sim.setWifiPassphrase('wap', 'harbor-violet-tin-meadow');
    expect(joined(s.sim, 'mallory')).toBeUndefined();
    expect(holds()).toBe(true);
    const t1 = s.sim.t;
    press.run(s.sim);
    expect(press.outcome!(s.sim, t1)[0]).toMatchObject({ tone: 'good', text: 'Held: centuries (long and hard to guess).' });
  });

  it('a copied MAC passes the filter but EAP still stops the attacker', () => {
    const sim = buildShelter();
    sim.setWifiPower('wap', 2);
    sim.setWifiSecurity('wap', 'wpa2', STRONG_PASS);
    sim.setWifiWps('wap', false);
    sim.dev('mallory').wifiClient!.passphrase = STRONG_PASS;
    sim.dev('mallory').wifiClient!.antennaBoost = 50;
    sim.recomputeWifi();
    expect(joined(sim, 'mallory')).toBe('wap');

    sim.setWifiMacFilter('wap', true, FAMILIES.map((f) => sim.dev(f).ifaces[0].mac));
    expect(joined(sim, 'mallory')).toBeUndefined();
    sim.setMac('mallory', MAC.phone1); // copy an allowed address
    expect(joined(sim, 'mallory')).toBe('wap');
    sim.setWifiAuth('wap', 'eap');
    expect(joined(sim, 'mallory')).toBeUndefined();
    expect(FAMILIES.every((f) => joined(sim, f) === 'wap')).toBe(true);
  });

  it('a weak passphrase falls to guessing first, so turning WPS off never makes the time drop', () => {
    const sim = buildShelter();
    sim.setWifiSecurity('wap', 'wpa2', WEAK_PASS);
    expect(crack(sim.dev('wap').wifi!)).toEqual({ ok: true, method: 'guess', estimate: 'a few minutes (guessing short passwords)' });
    sim.setWifiWps('wap', false);
    expect(crack(sim.dev('wap').wifi!).estimate).toBe('a few minutes (guessing short passwords)');
    sim.setWifiPassphrase('wap', STRONG_PASS);
    sim.setWifiWps('wap', true);
    expect(crack(sim.dev('wap').wifi!)).toMatchObject({ ok: true, method: 'wps' });
  });

  it('a common password with numbers added is weak at any length', () => {
    expect(passphraseStrength('password1234')).toBe('weak');
    expect(passphraseStrength('Welcome!2024!')).toBe('weak');
    expect(passphraseStrength('111111111111')).toBe('weak');
    expect(passphraseStrength(STRONG_PASS)).toBe('strong');
    const sim = buildShelter();
    sim.setWifiSecurity('wap', 'wpa2', 'password1234');
    sim.setWifiWps('wap', false);
    expect(crack(sim.dev('wap').wifi!)).toEqual({ ok: true, method: 'guess', estimate: 'a few minutes (guessing common passwords with numbers added)' });
  });

  it('passphrase checks: spaces are fine, WEP ignores length, the home router keeps its rule', () => {
    const sim = buildShelter();
    sim.setWifiSecurity('wap', 'wpa2', STRONG_PASS);
    expect(checkWifiPassphrase(sim, 'wap', 'blue river shelter 2026')).toEqual({ ok: true, passphrase: 'blue river shelter 2026', note: undefined });
    expect(checkWifiPassphrase(sim, 'wap', 'password1234')).toMatchObject({ ok: true, note: 'Saved, but that is a common password with a few characters added. Guessing tools try those first, so it falls fast at any length.' });
    expect(checkWifiPassphrase(sim, 'wap', 'shelter1')).toMatchObject({
      ok: true,
      note: 'Saved, but 8 characters is short. An attacker who records a device joining can test guesses against it. 12 or more holds up.',
    });
    sim.setWifiSecurity('wap', 'wep', WEAK_PASS);
    expect(checkWifiPassphrase(sim, 'wap', STRONG_PASS)).toMatchObject({ ok: true, note: 'Saved. On WEP the length of the key does not help: WEP itself is broken.' });
    expect(checkWifiPassword(sim, 'wap', 'two words here')).toMatchObject({ ok: false, msg: 'A Wi-Fi password has no spaces. Join the words together or use dashes.' });
  });

  it('a scan marks a hidden network but still names it', () => {
    const sim = buildShelter();
    sim.setWifiBeacon('wap', false);
    const row = sim.wifiScan('mallory').find((r) => r.device === 'wap');
    expect(row).toMatchObject({ ssid: 'Ridgeview-Shelter', hidden: true });
  });

  it('who gets in: the copy-MAC goal needs the filter, and the last goal needs EAP', () => {
    const s = new LabSession(wirelessLab, freshProgress());
    const at = wirelessLab.steps.findIndex((st) => st.id === 'who');
    for (let i = 0; i < at; i++) {
      playStep(s, wirelessSolution[s.step.id]);
      s.goTo(i + 1);
    }
    const step = wirelessLab.steps[at];
    const met = (id: string) => step.goals!.find((g) => g.id === id)!.check({ sim: s.sim, ev: s.sim.events, since: 0 } as never);
    expect(met('out')).toBe(false);
    const copy = step.actions!.find((a) => a.id === 'mallory-copy-mac')!;
    // Before the filter is on, she has nothing to get past, so the button asks for the filter first.
    copy.run(s.sim);
    expect(s.sim.dev('mallory').ifaces[0].mac).not.toBe(MAC.phone1);
    expect(copy.outcome!(s.sim, 0)[0].text).toMatch(/Turn on the MAC filter first/);
    s.sim.setWifiMacFilter('wap', true, FAMILIES.map((f) => s.sim.dev(f).ifaces[0].mac));
    expect(joined(s.sim, 'mallory')).toBeUndefined();
    expect(met('out')).toBe(false); // the filter alone doesn't finish the step
    copy.run(s.sim);
    expect(met('copied')).toBe(true);
    expect(copy.outcome!(s.sim, 0)).toEqual([{ tone: 'good', text: "Mallory is back on. The filter sees the Rivera phone's MAC and lets her in." }]);
    s.sim.setWifiAuth('wap', 'eap');
    expect(met('out')).toBe(true);
    expect(copy.outcome!(s.sim, 0)[0].tone).toBe('good');
  });

  it('step 4: a name hidden in step 3 still lets the scan goal finish', () => {
    const s = new LabSession(wirelessLab, freshProgress());
    const at = wirelessLab.steps.findIndex((st) => st.id === 'hide');
    for (let i = 0; i < at - 1; i++) {
      playStep(s, wirelessSolution[s.step.id]);
      s.goTo(i + 1);
    }
    playStep(s, wirelessSolution[s.step.id]);
    s.dispatch({ type: 'wifi-beacon', device: 'wap', on: false });
    s.sim.advance(5000);
    s.goTo(at);
    s.sim.advance(5000);
    s.dispatch({ type: 'wifi-scan', device: 'mallory' });
    s.sim.runUntilIdle();
    s.missing();
    expect(s.goalDone('hide', 'hidden')).toBe(true);
    expect(s.goalDone('hide', 'rescan')).toBe(true);
  });

  it('step 5: the first WPA with a long passphrase and WPS off does not count as a lock Mallory cannot break', () => {
    const s = new LabSession(wirelessLab, freshProgress());
    const at = wirelessLab.steps.findIndex((st) => st.id === 'lock');
    for (let i = 0; i < at; i++) {
      playStep(s, wirelessSolution[s.step.id]);
      s.goTo(i + 1);
    }
    s.dispatch({ type: 'wifi-security', device: 'wap', security: 'wpa', passphrase: STRONG_PASS });
    s.dispatch({ type: 'wifi-wps', device: 'wap', on: false });
    s.sim.runUntilIdle();
    s.missing();
    expect(s.goalDone('lock', 'holds')).toBe(false);
    s.dispatch({ type: 'wifi-security', device: 'wap', security: 'wpa2', passphrase: STRONG_PASS });
    s.sim.runUntilIdle();
    s.missing();
    expect(s.goalDone('lock', 'holds')).toBe(true);
  });

  it('family sign-in: capture turned on after the login went by says it missed', () => {
    const s = new LabSession(wirelessLab, freshProgress());
    const at = wirelessLab.steps.findIndex((st) => st.id === 'heard');
    for (let i = 0; i < at; i++) {
      playStep(s, wirelessSolution[s.step.id]);
      s.goTo(i + 1);
    }
    const signin = wirelessLab.steps[at].actions!.find((a) => a.id === 'family-signin')!;
    const since = s.sim.t;
    signin.run(s.sim);
    expect(signin.outcome!(s.sim, since)[0].text).toMatch(/isn't on/);
    s.sim.runUntilIdle();
    s.sim.setSniffing('mallory', true);
    expect(signin.outcome!(s.sim, since)[0].text).toMatch(/after the login went by/);
  });

    it('WPA3 with a common password falls to a few tries, and the lock goal stays open', () => {
    const sim = buildShelter();
    const ap = sim.dev('wap').wifi!;
    sim.setWifiSecurity('wap', 'wpa3', 'password');
    sim.setWifiWps('wap', false);
    expect(crack(ap)).toMatchObject({ ok: true, method: 'guess' });
    expect(checkWifiPassphrase(sim, 'wap', 'password')).toMatchObject({ ok: true, note: expect.stringMatching(/common password/) });
    sim.setWifiSecurity('wap', 'wpa3', STRONG_PASS);
    expect(crack(ap).ok).toBe(false);
  });

  it('the cable tool refuses to plug Mallory in: she is in the parking lot', () => {
    const sim = buildShelter();
    const rogue = wirelessLab.steps.find((st) => st.id === 'rogue')!;
    const tool = rogue.tools!.find((t) => t.kind === 'cable') as { refuse?: Parameters<typeof cableRefusal>[3] };
    expect(cableRefusal(sim, 'mallory', 'lansw', tool.refuse)).toMatch(/parking lot/);
    expect(cableRefusal(sim, 'rogue', 'lansw', tool.refuse)).toBeUndefined();
  });

  it('student text keeps the house style', () => {
    const text = JSON.stringify(wirelessLab.steps);
    expect(text).not.toMatch(/—|\bjust\b|\bsimply\b|\beasy\b|\beasier\b|\bobviously\b|\bCED\b/i);
  });

  it('replay rebuilds the same associations', () => {
    const s = new LabSession(wirelessLab, freshProgress());
    for (let i = 0; i < wirelessLab.steps.length; i++) {
      playStep(s, wirelessSolution[s.step.id]);
      if (i < wirelessLab.steps.length - 1) s.goTo(i + 1);
    }
    const live = Object.fromEntries(Object.values(s.sim.devices).filter((d) => d.wifiClient).map((d) => [d.id, d.wifiClient!.joinedAp]));
    const saved = JSON.parse(JSON.stringify(s.progress)) as LabProgress;
    const again = new LabSession(wirelessLab, saved);
    const replayed = Object.fromEntries(Object.values(again.sim.devices).filter((d) => d.wifiClient).map((d) => [d.id, d.wifiClient!.joinedAp]));
    expect(replayed).toEqual(live);
  });
});
