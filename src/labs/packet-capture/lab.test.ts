import { beforeEach, describe, expect, it, vi } from 'vitest';
import { protocolsOf } from '../../sim/displayFilter';
import { LabSession } from '../../runtime/session';
import type { Sim } from '../../sim/sim';
import type { Frame } from '../../sim/types';
import type { LabProgress } from '../../store/progress';
import { playStep } from '../solution';
import { packetCaptureLab as lab } from '.';
import {
  buildCapture,
  busyMinute,
  ensureBusyCapture,
  ensurePageCapture,
  IP,
  ipOf,
  joined,
  NAME,
  openSchool,
  openVideo,
  phoneRejoins,
  readyToStart,
  tvShow,
} from './scenario';
import { packetCaptureSolution as sol } from './solution';

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
    studentId: `capture-${n++}`,
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

/** One word per captured packet, in order: Wireshark's top protocol, plus who sent it when that matters. */
function story(frames: Frame[]): string[] {
  return frames.map((f) => {
    const p = protocolsOf(f);
    return p[p.length - 1];
  });
}
const cap = (sim: Sim) => sim.dev('laptop').capture.map((c) => c.frame);

/** Start a capture, do `what`, let the network go quiet, stop. */
function captureOf(sim: Sim, what: (sim: Sim) => void): Frame[] {
  sim.startCapture('laptop');
  what(sim);
  sim.runUntilIdle();
  sim.stopCapture('laptop');
  return cap(sim);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('the network', () => {
  it('starts with the family on the Wi-Fi at .10, .11, .12, and the capture off', () => {
    const sim = buildCapture();
    expect(['laptop', 'phone', 'tv'].map((id) => ipOf(sim, id))).toEqual([IP.laptop, IP.phone, IP.tv]);
    expect(['laptop', 'phone', 'tv'].every((id) => joined(sim, id))).toBe(true);
    expect(sim.dev('laptop').sniffing).toBe(false);
    expect(sim.events).toEqual([]);
    expect(sim.dev('laptop').arp, 'the laptop still has to ask for the router').toEqual({});
  });

  it('a capture numbers from 1 and times from Start, and Start again clears the list', () => {
    const sim = buildCapture();
    sim.runUntilIdle();
    sim.startCapture('laptop');
    const t0 = sim.t;
    openSchool(sim);
    sim.runUntilIdle();
    const list = sim.dev('laptop').capture;
    expect(list.map((c) => c.no)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(list[0].t).toBeGreaterThanOrEqual(t0);
    expect(sim.dev('laptop').captureRun?.start).toBe(t0);
    sim.startCapture('laptop');
    expect(sim.dev('laptop').capture).toEqual([]);
  });
});

describe('what the laptop captures', () => {
  it('one page load is ARP, then DNS, then HTTP', () => {
    const frames = captureOf(buildCapture(), openSchool);
    expect(story(frames)).toEqual(['arp', 'arp', 'dns', 'dns', 'http', 'http']);
    expect(frames[0].arp?.op).toBe('request');
    expect(frames[0].dst).toBe('ff:ff:ff:ff:ff:ff');
    expect(frames[1].arp?.senderIp).toBe(IP.router);
    expect(frames[3].ip?.app).toMatchObject({ kind: 'dns-answer', name: NAME.school, ip: IP.school });
    expect(frames[4].ip).toMatchObject({ dst: IP.school, dstPort: 80 });
    expect(frames[4].dst, 'the GET goes to the router, the next hop').toBe('02:00:00:00:00:01');
  });

  it('the same again for a second load: the laptop forgets the router each time', () => {
    const sim = buildCapture();
    captureOf(sim, openSchool);
    expect(story(captureOf(sim, openSchool))).toEqual(['arp', 'arp', 'dns', 'dns', 'http', 'http']);
  });

  it('the video site is TLS on port 443 after a readable DNS lookup', () => {
    const frames = captureOf(buildCapture(), openVideo);
    expect(story(frames)).toEqual(['arp', 'arp', 'dns', 'dns', 'tls', 'tls']);
    expect(frames[2].ip?.app).toMatchObject({ kind: 'dns-query', name: NAME.video });
    expect(frames[4].ip).toMatchObject({ dst: IP.video, dstPort: 443, encrypted: true });
  });

  it("the phone's rejoin shows its two broadcasts, not the router's answers", () => {
    const sim = buildCapture();
    const frames = captureOf(sim, phoneRejoins);
    expect(frames.map((f) => f.dhcp?.op)).toEqual(['discover', 'request']);
    expect(ipOf(sim, 'phone')).toBe(IP.phone);
  });

  it('the busy minute is the same every time: about 45 packets of every kind', () => {
    const a = story(captureOf(buildCapture(), busyMinute));
    const b = story(captureOf(buildCapture(), busyMinute));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a.length).toBeLessThanOrEqual(50);
    const count = (p: string) => a.filter((x) => x === p).length;
    expect({ arp: count('arp'), dns: count('dns'), http: count('http'), tls: count('tls') }).toEqual({ arp: 4, dns: 8, http: 4, tls: 28 });
  });

  it('in the busy minute, each app looks up its server before it talks to it', () => {
    const frames = captureOf(buildCapture(), busyMinute);
    for (const [name, ip] of [
      [NAME.chat, IP.chat],
      [NAME.weather, IP.weather],
      [NAME.video, IP.video],
      [NAME.school, IP.school],
    ]) {
      const answer = frames.findIndex((f) => f.ip?.app.kind === 'dns-answer' && f.ip.app.name === name && f.ip.dst === IP.laptop);
      const first = frames.findIndex((f) => f.ip?.dst === ip);
      expect(answer, name).toBeGreaterThanOrEqual(0);
      expect(first, name).toBeGreaterThan(answer);
    }
  });

  it("the TV's show leaves only its ARP request in the laptop's capture", () => {
    const sim = buildCapture();
    const t = sim.t;
    const frames = captureOf(sim, tvShow);
    expect(frames).toHaveLength(1);
    expect(frames[0].arp).toMatchObject({ op: 'request', senderIp: IP.tv, targetIp: IP.router });
    // The TV did a lot more than that.
    const tvConns = (sim.dev('tv').conns ?? []).filter((c) => c.t >= t && c.tag === 'show');
    expect(tvConns.map((c) => c.status)).toEqual(['open', 'open', 'open']);
  });
});

describe('lesson buttons', () => {
  const press = (s: LabSession, id: string) => {
    s.runStepAction(id);
    const run = s.lastRun.value!;
    const def = s.step.actions!.find((a) => a.id === id)!;
    return () => def.outcome!(s.sim, run.t);
  };

  it('Open the school website: loading, then the packet count, or a warning when the capture is off', () => {
    const s = playTo('tour');
    s.goTo(index('first-capture'));
    let lines = press(s, 'open-school');
    expect(lines()).toEqual([
      { tone: 'bad', text: 'The capture was off, so it recorded none of this. Press Start, then press Open the school website again.' },
      { tone: 'wait', text: 'Loading the homework page…' },
    ]);
    s.sim.runUntilIdle();
    expect(lines()).toEqual([
      { tone: 'good', text: 'The homework page loaded.' },
      { tone: 'bad', text: 'The capture was off, so it recorded none of this. Press Start, then press Open the school website again.' },
    ]);
    s.dispatch({ type: 'capture', device: 'laptop', on: true });
    lines = press(s, 'open-school');
    s.sim.runUntilIdle();
    expect(lines()).toEqual([{ tone: 'good', text: 'The homework page loaded. The capture recorded 6 packets for it.' }]);
  });

  it('Open the school website: a second press while it loads does nothing, and a capture started late says so and does not count', () => {
    const s = playTo('tour');
    s.goTo(index('first-capture'));
    const t1 = s.sim.t;
    press(s, 'open-school');
    s.sim.advance(2500);
    s.dispatch({ type: 'capture', device: 'laptop', on: true });
    const lines = press(s, 'open-school');
    const late = {
      tone: 'bad',
      text: 'The capture started after you pressed Open the school website, so it missed the first packets. When this finishes, press Restart, then press Open the school website again.',
    };
    expect(lines()).toEqual([late, { tone: 'wait', text: 'Loading the homework page…' }]);
    s.sim.runUntilIdle();
    // One load only: the second press didn't start another.
    expect(s.sim.dev('laptop').browser?.startedAt).toBe(t1);
    expect(lines()).toEqual([{ tone: 'good', text: 'The homework page loaded.' }, late]);
    expect(s.goalDone('first-capture', 'page')).toBe(false);

    // A whole load after the leftovers: the list isn't one page load yet.
    const again = press(s, 'open-school');
    s.sim.runUntilIdle();
    const before = s.sim.dev('laptop').capture.length - 6;
    expect(before).toBeGreaterThan(0);
    expect(again()).toEqual([
      { tone: 'good', text: 'The homework page loaded. The capture recorded 6 packets for it.' },
      {
        tone: 'bad',
        text: `Your list also has ${before} packet${before === 1 ? '' : 's'} from before you pressed Open the school website. For a list of this page alone, press Restart, then press Open the school website again.`,
      },
    ]);
    expect(s.goalDone('first-capture', 'page')).toBe(false);

    s.dispatch({ type: 'capture', device: 'laptop', on: true });
    const clean = press(s, 'open-school');
    s.sim.runUntilIdle();
    expect(clean()).toEqual([{ tone: 'good', text: 'The homework page loaded. The capture recorded 6 packets for it.' }]);
    expect(s.goalDone('first-capture', 'page')).toBe(true);
  });

  it('Leave the laptop alone: a second press while the minute runs does nothing', () => {
    const s = playTo('https');
    s.goTo(index('busy'));
    s.dispatch({ type: 'capture', device: 'laptop', on: true });
    press(s, 'busy-minute');
    s.sim.advance(3000);
    const lines = press(s, 'busy-minute');
    s.sim.runUntilIdle();
    expect(s.sim.dev('laptop').capture).toHaveLength(44);
    expect(lines()).toEqual([{ tone: 'good', text: 'The minute is over. The capture recorded 44 packets.' }]);
  });

  it('Leave the laptop alone: a running count, then the total', () => {
    const s = playTo('https');
    s.goTo(index('busy'));
    s.dispatch({ type: 'capture', device: 'laptop', on: true });
    const lines = press(s, 'busy-minute');
    expect(lines()).toEqual([{ tone: 'wait', text: "The laptop's apps are at work: 0 packets so far…" }]);
    s.sim.runUntilIdle();
    const total = s.sim.dev('laptop').capture.length;
    expect(lines()).toEqual([{ tone: 'good', text: `The minute is over. The capture recorded ${total} packets.` }]);
  });

  it('The TV plays a show, and The phone rejoins the Wi-Fi', () => {
    const s = playTo('address-filter');
    expect(s.step.id).toBe('cant-see');
    s.dispatch({ type: 'capture', device: 'laptop', on: true });
    const tv = press(s, 'tv-show');
    expect(tv()).toEqual([{ tone: 'wait', text: 'The TV is loading the show…' }]);
    s.sim.runUntilIdle();
    expect(tv()).toEqual([{ tone: 'good', text: 'The TV is playing the show.' }]);

    const p = fresh();
    playTo('page-story', p);
    p.goTo(index('more-kinds'));
    p.dispatch({ type: 'capture', device: 'laptop', on: true });
    const phone = press(p, 'phone-rejoins');
    expect(phone()).toEqual([{ tone: 'wait', text: 'The phone left the Wi-Fi…' }]);
    p.sim.runUntilIdle();
    expect(phone()).toEqual([{ tone: 'good', text: `The phone got its address, ${IP.phone}, again.` }]);
  });
});

describe('setups', () => {
  const quietly = (sim: Sim, fn: (sim: Sim) => void) => {
    sim.quiet = true;
    try {
      fn(sim);
    } finally {
      sim.quiet = false;
    }
  };

  it("fill in a finished capture for a student who skipped ahead, quietly", () => {
    const sim = buildCapture();
    quietly(sim, ensurePageCapture);
    expect(story(cap(sim))).toEqual(['arp', 'arp', 'dns', 'dns', 'http', 'http']);
    expect(sim.dev('laptop').sniffing).toBe(false);
    expect(sim.events.every((e) => e.quiet)).toBe(true);

    const busy = buildCapture();
    quietly(busy, ensureBusyCapture);
    expect(cap(busy).length).toBeGreaterThanOrEqual(40);
  });

  it("keep the student's own capture", () => {
    const sim = buildCapture();
    const mine = captureOf(sim, (x) => {
      openSchool(x);
      x.runUntilIdle();
      openSchool(x);
    });
    expect(mine).toHaveLength(12);
    quietly(sim, ensurePageCapture);
    expect(cap(sim)).toEqual(mine);

    const busy = buildCapture();
    const own = captureOf(busy, busyMinute);
    quietly(busy, ensureBusyCapture);
    expect(cap(busy)).toEqual(own);
  });

  it('replace a capture that starts in the middle of a page load', () => {
    const sim = buildCapture();
    openSchool(sim);
    sim.advance(2500);
    const late = captureOf(sim, () => {});
    expect(story(late)[0]).not.toBe('arp');
    quietly(sim, ensurePageCapture);
    expect(story(cap(sim))).toEqual(['arp', 'arp', 'dns', 'dns', 'http', 'http']);
  });

  it('readyToStart stops the capture and keeps its list, and brings the phone back', () => {
    const sim = buildCapture();
    sim.startCapture('laptop');
    openSchool(sim);
    sim.runUntilIdle();
    sim.setWifiClient('phone', '');
    quietly(sim, readyToStart);
    expect(sim.dev('laptop').sniffing).toBe(false);
    expect(cap(sim)).toHaveLength(6);
    expect(ipOf(sim, 'phone')).toBe(IP.phone);
  });
});

describe('goals', () => {
  it("a filter for the TV's address counts whichever way it's written", () => {
    const s = playTo('address-filter');
    expect(s.step.id).toBe('cant-see');
    s.dispatch({ type: 'capture', device: 'laptop', on: true });
    s.runStepAction('tv-show');
    s.sim.runUntilIdle();
    const done = () => s.goalDone('cant-see', 'tv-filter');
    for (const wrong of ['!arp', 'ip.addr == 192.168.1.10', 'tls']) {
      s.ui({ type: 'ui:filter', device: 'laptop', filter: wrong });
      expect(done(), wrong).toBe(false);
    }
    s.ui({ type: 'ui:filter', device: 'laptop', filter: 'ip.src == 192.168.1.12' });
    expect(done()).toBe(true);
  });

  it('a filter that also shows other packets does not count', () => {
    const s = playTo('busy');
    expect(s.step.id).toBe('filter');
    s.ui({ type: 'ui:filter', device: 'laptop', filter: 'dns || arp' });
    s.ui({ type: 'ui:filter', device: 'laptop', filter: 'tcp' });
    expect(s.goalDone('filter', 'dns')).toBe(false);
    expect(s.goalDone('filter', 'http')).toBe(false);
    s.ui({ type: 'ui:filter', device: 'laptop', filter: 'udp.port == 53' });
    expect(s.goalDone('filter', 'dns')).toBe(true);
  });
});
