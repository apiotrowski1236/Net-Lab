import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabSession } from '../../runtime/session';
import { checkCable, checkWifiPassword, checkWifiSsid, checkWifiTurnOn } from '../../runtime/toolInput';
import type { LabProgress } from '../../store/progress';
import { playStep } from '../solution';
import type { ToolSpec } from '../types';
import { homeNetworkLab as lab } from '.';
import {
  ap,
  buildHome,
  DEFAULT_PASSWORD,
  DEFAULT_SSID,
  ensureCables,
  ensureWifi,
  familyJoins,
  IP,
  ipOf,
  joined,
  neighborTries,
  NEIGHBOR_GUESSES,
  PAGES,
  POOL,
  ready,
  STRANGER_PORT,
  tvRestarts,
  videoUrl,
} from './scenario';
import { homeNetworkSolution as sol } from './solution';

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
    studentId: `home-${n++}`,
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

/** Play the answer key through step `id` (inclusive). */
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

/** The home, plugged in and on the Wi-Fi, with every device's DHCP exchange played out (not quiet). */
function homeOnline() {
  const sim = buildHome();
  ensureCables(sim);
  sim.runUntilIdle();
  sim.setWifiSsid('wifi', DEFAULT_SSID);
  sim.setWifiSecurity('wifi', 'wpa3', DEFAULT_PASSWORD);
  sim.setWifiOff('wifi', false);
  familyJoins(sim);
  sim.runUntilIdle();
  return sim;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('DHCP on the home router', () => {
  it('hands each joining device the next address in the pool, in the order they ask', () => {
    const sim = homeOnline();
    expect(ipOf(sim, 'console')).toBe(POOL.from);
    expect(ipOf(sim, 'printer')).toBe('192.168.1.11');
    expect(['laptop', 'phone', 'tv'].map((id) => ipOf(sim, id))).toEqual(['192.168.1.12', '192.168.1.13', '192.168.1.14']);
    expect(sim.dev('phone').gateway).toBe(IP.router);
    expect(sim.dhcpLeases('router').map((l) => l.name)).toEqual(['Game console', 'Printer', 'Laptop', 'Phone', 'Smart TV']);
  });

  it('gives the TV the same address back when it restarts, with all four messages', () => {
    const sim = homeOnline();
    const before = ipOf(sim, 'tv');
    const t = sim.t;
    tvRestarts(sim);
    expect(ipOf(sim, 'tv'), 'leaving drops the address').toBeUndefined();
    sim.runUntilIdle();
    expect(ipOf(sim, 'tv')).toBe(before);
    const ops = sim.events.filter((e) => e.t >= t && e.type === 'dhcp' && e.client === 'tv').map((e) => (e.type === 'dhcp' ? e.what : ''));
    expect(ops).toEqual(['discover', 'offer', 'request', 'ack']);
    // The laptop hears the TV's broadcasts, but not the router's answers to the TV.
    const heard = sim.dev('laptop').capture.filter((c) => c.t >= t && c.frame.dhcp?.client === sim.dev('tv').ifaces[0].mac).map((c) => c.frame.dhcp!.op);
    expect(heard).toEqual(['discover', 'request']);
  });

  it('a setup that skips ahead binds addresses quietly, keeping the order', () => {
    const sim = buildHome();
    // Lesson setups run quiet (see Sim.quiet): addresses bind at once, without messages.
    sim.quiet = true;
    ready(sim);
    sim.quiet = false;
    expect(sim.events.some((e) => e.type === 'dhcp')).toBe(false);
    expect(ipOf(sim, 'console')).toBe(POOL.from);
    expect(ipOf(sim, 'tv')).toBe('192.168.1.14');
    expect(ap(sim).ssid).toBe(DEFAULT_SSID);
    expect(joined(sim, 'neighbor')).toBe(false);
  });
});

describe('NAT: one public address for the home', () => {
  it('two devices browsing the same site at once each get their own answer', () => {
    const sim = homeOnline();
    const t = sim.t;
    sim.browse('phone', videoUrl(PAGES.cats));
    sim.browse('laptop', videoUrl(PAGES.fractions));
    sim.runUntilIdle();
    expect(sim.dev('phone').browser?.title).toBe(PAGES.cats.title);
    expect(sim.dev('laptop').browser?.title).toBe(PAGES.fractions.title);
    const lines = sim.dev('router').nat!.table.filter((e) => e.t >= t && e.proto === 'tcp');
    expect(lines.map((e) => e.inside.ip).sort()).toEqual([ipOf(sim, 'laptop'), ipOf(sim, 'phone')].sort());
    expect(new Set(lines.map((e) => e.public)).size).toBe(2);
    expect(lines.every((e) => e.remote.ip === IP.video)).toBe(true);
    // The video site only ever saw the public address.
    const seen = sim.dev('video').arp;
    expect(Object.keys(seen)).not.toContain(ipOf(sim, 'phone'));
    // The laptop's captured answer says how the router rewrote it.
    const answer = sim.dev('laptop').capture.find((c) => c.frame.ip?.app.kind === 'http-res');
    expect(answer?.frame.ip?.nat?.was.dst).toBe(IP.public);
  });

  it('drops a packet from the internet that nobody in the home asked for, and logs it', () => {
    const sim = homeOnline();
    const t = sim.t;
    sim.connectService('stranger', IP.public, STRANGER_PORT, { tag: 'knock' });
    sim.runUntilIdle();
    const drop = sim.events.find((e) => e.t >= t && e.type === 'drop' && e.device === 'router');
    expect(drop?.type === 'drop' && drop.reason).toBe('unsolicited');
    const line = sim.dev('router').logs.find((l) => l.t >= t && l.source === 'nat');
    expect(line?.msg).toMatch(/^Blocked incoming TCP 198\.51\.100\.200:\d+ -> 203\.0\.113\.25:3389, no matching connection$/);
    expect(line?.fields?.action).toBe('drop');
    // Nothing inside heard it.
    for (const id of ['laptop', 'phone', 'tv', 'console', 'printer']) expect(sim.dev(id).capture.some((c) => c.t >= t && c.frame.ip?.src === IP.stranger)).toBe(false);
  });
});

describe('Wi-Fi setup', () => {
  it('turns the neighbor away from a strong password, and lets them in on a common one', () => {
    const sim = homeOnline();
    const t = sim.t;
    neighborTries(sim);
    expect(joined(sim, 'neighbor')).toBe(false);
    const tries = sim.events.filter((e) => e.t >= t && e.type === 'wifi' && e.what === 'rejected' && e.client === 'neighbor');
    expect(tries.length).toBe(NEIGHBOR_GUESSES.length);

    sim.setWifiPassphrase('wifi', 'password1');
    expect(joined(sim, 'laptop'), 'the family is handed the new password').toBe(true);
    neighborTries(sim);
    expect(joined(sim, 'neighbor')).toBe(true);
    sim.runUntilIdle();
    expect(ipOf(sim, 'neighbor')).toBeDefined();
    // A new password locks the neighbor out again: it was never told.
    sim.setWifiPassphrase('wifi', DEFAULT_PASSWORD);
    expect(joined(sim, 'neighbor')).toBe(false);
  });

  it('renaming the network drops the family until they join the new name', () => {
    const sim = homeOnline();
    sim.setWifiSsid('wifi', 'Nguyen 5G');
    expect(joined(sim, 'laptop')).toBe(false);
    familyJoins(sim);
    expect(joined(sim, 'laptop')).toBe(true);
  });

  it('checks the name, the password, and turning on', () => {
    const sim = buildHome();
    const msg = (r: { ok: boolean; msg?: string }) => (r.ok ? '' : r.msg);
    expect(msg(checkWifiTurnOn(sim, 'wifi'))).toMatch(/Save a password first/);
    expect(msg(checkWifiSsid(sim, 'wifi', ''))).toMatch(/Type a name/);
    expect(msg(checkWifiSsid(sim, 'wifi', 'Nguyen <3'))).toMatch(/letters, numbers/);
    expect(msg(checkWifiSsid(sim, 'wifi', 'x'.repeat(33)))).toMatch(/32/);
    expect(checkWifiSsid(sim, 'wifi', '  Nguyen   Home ')).toMatchObject({ ok: true, ssid: 'Nguyen Home' });
    expect(msg(checkWifiPassword(sim, 'wifi', 'short'))).toMatch(/at least 8/);
    expect(msg(checkWifiPassword(sim, 'wifi', 'two words'))).toMatch(/no spaces/);
    expect(checkWifiPassword(sim, 'wifi', 'kitchen1')).toMatchObject({ ok: true, passphrase: 'kitchen1' });
    const short = checkWifiPassword(sim, 'wifi', 'kitchen1');
    expect(short.ok && short.note).toMatch(/short/);
    sim.setWifiPassphrase('wifi', DEFAULT_PASSWORD);
    expect(checkWifiTurnOn(sim, 'wifi').ok).toBe(true);
  });
});

describe('cables', () => {
  const refuse = (lab.steps[index('cables')].tools?.find((t) => t.kind === 'cable') as Extract<ToolSpec, { kind: 'cable' }>).refuse;
  const msg = (a: string, b: string) => {
    const r = checkCable(buildHome(), a, undefined, b, undefined, refuse);
    return r.ok ? '' : r.msg;
  };

  it("turns away cables the lesson doesn't want, in its own words", () => {
    expect(msg('console', 'router')).toBe("That's the router's internet port. It leads out of the home. Plug the Game console into a home port on the Switch and Wi-Fi.");
    expect(msg('isp', 'printer')).toBe('The internet provider is outside the home. Plug the Printer into a home port on the Switch and Wi-Fi.');
    expect(msg('wifi', 'tv')).toBe('The Smart TV uses Wi-Fi. It connects in the next step.');
    expect(msg('neighbor', 'wifi')).toMatch(/next door/);
    expect(msg('router', 'wifi')).toMatch(/already joined inside the box/);
    expect(msg('isp', 'wifi')).toMatch(/router's internet port/);
    expect(msg('console', 'printer')).toMatch(/not into each other/);
    expect(msg('console', 'video')).toMatch(/out on the internet/);
  });

  it('lets the three cables the lesson asks for through', () => {
    expect(msg('console', 'wifi')).toBe('');
    expect(msg('wifi', 'printer')).toBe('');
    expect(msg('isp', 'router')).toBe('');
  });

  it("the router's built-in cable and the internet's cables can't be unplugged", () => {
    const sim = buildHome();
    const fixed = Object.values(sim.links).filter((l) => l.fixed);
    expect(fixed.length).toBe(4);
  });
});

describe('the lesson', () => {
  it('the answer key finishes every step, and a reload rebuilds the same network', () => {
    const s = playTo('stranger');
    const saved = JSON.parse(JSON.stringify(s.progress)) as LabProgress;
    const again = new LabSession(lab, saved);
    again.sim.runUntilIdle();
    expect(again.replayWarning).toBe('');
    expect(deviceState(again)).toBe(deviceState(s));
  });

  it('the TV restart button writes its own lines', () => {
    const s = playTo('wifi');
    s.goTo(index('addresses'));
    s.runStepAction('tv-restarts');
    const def = lab.steps[index('addresses')].actions!.find((a) => a.id === 'tv-restarts')!;
    const t = s.lastRun.value!.t;
    expect(def.outcome!(s.sim, t)[0].text).toBe('The TV is restarting…');
    s.sim.runUntilIdle();
    expect(def.outcome!(s.sim, t)[0].text).toMatch(/^The TV got the address 192\.168\.1\.14 again\.$/);
  });

  it('ensureWifi keeps the name and password the student chose', () => {
    const sim = buildHome();
    sim.setWifiSsid('wifi', 'Casa Nguyen');
    sim.setWifiPassphrase('wifi', 'my-own-password-77');
    ensureWifi(sim);
    expect(ap(sim)).toMatchObject({ ssid: 'Casa Nguyen', passphrase: 'my-own-password-77', off: false });
  });
});
