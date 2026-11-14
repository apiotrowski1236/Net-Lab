import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import { crack } from '../../sim/wifi';
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
