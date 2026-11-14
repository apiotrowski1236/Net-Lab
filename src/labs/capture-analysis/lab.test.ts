import { describe, expect, it } from 'vitest';
import { conversationStats, endpointStats, followStream, ioGraph, loadCaptureFile } from '../../sim/capfile';
import { matchFilter, parseFilter } from '../../sim/displayFilter';
import type { Sim } from '../../sim/sim';
import { payloadLen } from '../../sim/tcp';
import { happened } from '../helpers';
import type { QuestionDef, TextQuestion } from '../types';
import type { AnyEvent } from '../types';
import { captureAnalysisLab as lab } from '.';
import {
  BREAKROOM_PORT,
  build,
  FILES,
  file,
  firstNo,
  IP,
  isEchoReply,
  isEchoRequest,
  isFloodFrame,
  isPoison,
  isRst,
  isSyn,
  isSynAck,
  MAC,
  replayCheckin,
  replayFlood,
  TELNET_PASSWORD,
  toC2,
} from './scenario';

const step = (id: string) => lab.steps.find((s) => s.id === id)!;
const goal = (stepId: string, id: string) => step(stepId).goals!.find((g) => g.id === id)!;
const question = (stepId: string, id: string) => step(stepId).questions!.find((q: QuestionDef) => q.id === id) as TextQuestion;
/** What a text question tells the student about `v`: undefined when it's accepted. */
const say = (stepId: string, id: string, v: string) => {
  const q = question(stepId, id);
  if (q.expect && !q.expect.test(v)) return q.expectHint ?? 'expect failed';
  return q.verify?.(v, () => undefined as never);
};
const check = (stepId: string, id: string, ev?: AnyEvent, sim: Sim = build(), since = 0) => goal(stepId, id).check({ sim, ev, since });
const filterEv = (f: string, filter: string): AnyEvent => ({ type: 'ui:capfile-filter', file: f, filter });

describe('capture-analysis: the capture files', () => {
  it('records the same packets every time', () => {
    const a = FILES.scan.record();
    const b = FILES.scan.record();
    expect(a.sim.t).toBe(b.sim.t);
    const f = file('scan');
    expect(loadCaptureFile(FILES.scan)).toBe(f);
    expect(f.frames.map((c) => c.no)).toEqual(f.frames.map((_, i) => i + 1));
    expect(f.frames.every((c, i) => i === 0 || c.t >= f.frames[i - 1].t)).toBe(true);
  });

  it('keeps device names and forged marks out of the files', () => {
    for (const def of Object.values(FILES)) {
      for (const c of loadCaptureFile(def).frames) {
        expect(c.frame.forged).toBeUndefined();
        expect(c.frame.origin).toBe('');
      }
    }
  });

  it('has a 3,000-row file for the scrolling check', () => {
    expect(file('flood').frames.length).toBeGreaterThan(3000);
  });

  it('shows the fare server as the normal top talker, and no camera recorder in the morning', () => {
    const ends = endpointStats(file('morning').frames, 'ip');
    expect(ends[0].addr).toBe(IP.fares);
    expect(ends.some((e) => e.addr === IP.cams)).toBe(false);
  });

  it('08:00: every kiosk SYN to the fare server is answered RST, ACK', () => {
    const f = file('outage').frames;
    const syns = f.filter((c) => isSyn(c.frame) && c.frame.ip!.dst === IP.fares);
    const rsts = f.filter((c) => isRst(c.frame) && c.frame.ip!.src === IP.fares);
    expect(syns.length).toBeGreaterThan(30);
    expect(rsts.length).toBe(syns.length);
    expect(f.some((c) => isSynAck(c.frame) && c.frame.ip!.src === IP.fares)).toBe(false);
  });

  it('12:00: a smurf at 14 s, then a backup spike at 38 s', () => {
    const f = file('noon');
    const reqs = f.frames.filter((c) => isEchoRequest(c.frame) && c.frame.ip!.dst === IP.broadcast);
    expect(reqs).toHaveLength(80);
    expect(reqs.every((c) => c.frame.ip!.src === IP.victim)).toBe(true);
    const replies = f.frames.filter((c) => isEchoReply(c.frame));
    expect(replies.length).toBe(80 * 9);
    expect(replies.every((c) => c.frame.ip!.dst === IP.victim)).toBe(true);
    const io = ioGraph(f.frames, f.ms).all;
    expect(Math.max(...io.slice(14, 24))).toBeGreaterThan(70);
    expect(Math.max(...io.slice(38, 47))).toBeGreaterThan(70);
    expect(Math.max(...io.slice(0, 13))).toBeLessThan(30);
    const top = conversationStats(f.frames, 'ip')[0];
    expect([top.a, top.b].sort()).toEqual([IP.fares, IP.backup].sort());
    expect(top.ports).toBe(1);
  });

  it('13:00: the router really answers once, then the break-room PC claims its IP', () => {
    const arp = file('arp').frames.filter((c) => c.frame.arp?.op === 'reply');
    const real = arp.filter((c) => c.frame.arp!.senderMac === MAC.gw);
    expect(real).toHaveLength(1);
    expect(arp.filter((c) => isPoison(c.frame)).length).toBeGreaterThan(10);
    expect(real[0].no).toBeLessThan(firstNo('arp', (c) => isPoison(c.frame)));
  });

  it('14:00: 3,000 made-up MACs in about ten seconds', () => {
    const f = file('flood');
    expect(endpointStats(f.frames, 'eth').length).toBeGreaterThan(3000);
    const flood = f.frames.filter((c) => isFloodFrame(c.frame));
    expect(flood).toHaveLength(3000);
    expect(flood[0].t).toBeGreaterThanOrEqual(20_000);
    expect(flood[flood.length - 1].t).toBeLessThan(30_500);
  });

  it('15:00: a SYN scan of 1,024 ports finds 443 and 873 open', () => {
    const f = file('scan').frames;
    expect(f.filter((c) => isSyn(c.frame) && c.frame.ip!.src === IP.scanner)).toHaveLength(1024);
    const open = f.filter((c) => isSynAck(c.frame) && c.frame.ip!.dst === IP.scanner).map((c) => c.frame.ip!.srcPort);
    expect(open).toEqual([443, 873]);
    // The scanner hangs up on each open port.
    expect(f.filter((c) => isRst(c.frame) && c.frame.ip!.src === IP.scanner)).toHaveLength(2);
    const top = conversationStats(f, 'ip').sort((a, b) => b.ports - a.ports)[0];
    expect(top.ports).toBe(1024);
  });

  it('02:00: the recorder checks in with 192.0.2.44 over plain HTTP on 4444 and uploads a video', () => {
    const f = file('night');
    const c2 = f.frames.filter((c) => toC2(c.frame));
    expect(c2.every((c) => c.frame.ip!.srcPort === 4444 || c.frame.ip!.dstPort === 4444)).toBe(true);
    const stream = followStream(f, c2[0].frame.ip!.tcp!.stream!)!;
    expect(stream.encrypted).toBe(false);
    expect(stream.parts.map((p) => p.from)).toEqual(['a', 'b']);
    expect(stream.parts[0].text).toContain('POST /checkin');
    const all = new Set(c2.map((c) => c.frame.ip!.tcp!.stream));
    const texts = [...all].map((s) => followStream(f, s!)!.parts.map((p) => p.text).join('\n'));
    expect(texts.some((t) => t.includes('cmd=upload'))).toBe(true);
    expect(texts.some((t) => t.includes('POST /upload'))).toBe(true);
  });

  it('02:00: the filter the lesson gives shows every command from 192.0.2.44', () => {
    const f = file('night');
    const p = parseFilter('ip.addr == 192.0.2.44 && http');
    if (!p.ok) throw new Error(p.msg);
    const shown = f.frames.filter((c) => matchFilter(p.node, c.frame));
    const orders = f.frames.filter((c) => toC2(c.frame) && c.frame.ip!.src === IP.c2 && payloadLen(c.frame.ip!) > 0);
    expect(orders.length).toBeGreaterThanOrEqual(2);
    for (const o of orders) expect(shown).toContain(o);
  });

  it('16:00: the Telnet stream shows the password in plain text', () => {
    const f = file('telnet');
    const s = f.frames.find((c) => c.frame.ip?.dstPort === 23)!.frame.ip!.tcp!.stream!;
    const t = followStream(f, s)!;
    expect(t.parts[0].from).toBe('b');
    expect(t.parts.map((p) => p.text)).toContain(TELNET_PASSWORD);
  });
});

describe('capture-analysis: cited packets', () => {
  it('names the router’s real reply when it is cited as forged', () => {
    const real = firstNo('arp', (c) => c.frame.arp?.op === 'reply' && c.frame.arp.senderMac === MAC.gw);
    const [a] = file('arp').frames.filter((c) => isPoison(c.frame)).map((c) => c.no);
    expect(say('arp', 'cite-arp', `${a}, ${real}`)).toBe(`Packet ${real} is the router’s real reply: ${MAC.gw} is the router’s own MAC.`);
    expect(say('arp', 'cite-arp', `${a}`)).toBe('Type at least two packet numbers.');
  });

  it('accepts a range across the flood, but not one that runs past it', () => {
    const flood = file('flood').frames.filter((c) => isFloodFrame(c.frame));
    const mid = flood[1000].no;
    expect(say('flood', 'cite-flood', `${mid}-${mid + 100}`)).toBeUndefined();
    expect(say('flood', 'cite-flood', `${mid} through ${mid + 100}`)).toBeUndefined();
    const before = flood[0].no - 1;
    expect(say('flood', 'cite-flood', `${before - 20}-${before}`)).toMatch(/is ordinary depot traffic/);
  });

  it('turns away numbers that are not in the file', () => {
    expect(say('outage', 'cite-rst', '99999')).toMatch(/There is no packet 99999 in 08:00 depot\.pcap/);
    expect(say('outage', 'cite-rst', 'the RST one')).toBe('Type packet numbers from the No. column, like 412, 415.');
  });

  it('tells a scanner’s SYN from the open-port answer', () => {
    const syn = firstNo('scan', (c) => isSyn(c.frame) && c.frame.ip!.src === IP.scanner);
    expect(say('scan', 'cite-open', `${syn}, ${syn + 1}`)).toMatch(/is the scanner’s SYN/);
  });

  it('checks the scanner and C2 addresses, with a nudge for the target', () => {
    expect(say('scan', 'scanner-ip', ' 203.0.113.66 ')).toBeUndefined();
    expect(say('scan', 'scanner-ip', IP.fares)).toMatch(/the target/);
    expect(say('c2', 'c2-ip', IP.c2)).toBeUndefined();
    expect(say('c2', 'c2-ip', IP.cams)).toMatch(/recorder itself/);
    expect(say('telnet', 'password', 'bus$top42')).toMatch(/capital letters/);
  });
});

describe('capture-analysis: goals', () => {
  it('needs a filter that shows only resets, not every TCP packet', () => {
    expect(check('outage', 'filter-rst', filterEv('outage', 'tcp.flags.reset == 1'))).toBe(true);
    expect(check('outage', 'filter-rst', filterEv('outage', 'tcp'))).toBe(false);
    expect(check('outage', 'filter-rst', filterEv('morning', 'tcp.flags.reset == 1'))).toBe(false);
  });

  it('counts the Conversations filter button for the backup', () => {
    expect(check('backup', 'filter-backup', filterEv('noon', `ip.addr==${IP.fares} && ip.addr==${IP.backup}`))).toBe(true);
    expect(check('backup', 'filter-backup', filterEv('noon', 'tcp.port == 873'))).toBe(true);
    expect(check('backup', 'filter-backup', filterEv('noon', `ip.addr == ${IP.fares}`))).toBe(false);
  });

  it('counts following the recorder’s stream, not the backup’s', () => {
    const f = file('night').frames;
    const c2 = f.find((c) => toC2(c.frame))!.frame.ip!.tcp!.stream!;
    const backup = f.find((c) => c.frame.ip?.dstPort === 873)!.frame.ip!.tcp!.stream!;
    expect(check('c2', 'follow', { type: 'ui:follow-stream', file: 'night', stream: c2 })).toBe(true);
    expect(check('c2', 'follow', { type: 'ui:follow-stream', file: 'night', stream: backup })).toBe(false);
  });
});

describe('capture-analysis: fixing the live network', () => {
  const play = (sim: Sim, f: (sim: Sim) => void) => (f(sim), sim.runUntilIdle());

  it('lets the flood in until port security is on, then shuts p7', () => {
    const sim = build();
    play(sim, replayFlood);
    expect(check('fix', 'flood-blocked', undefined, sim)).toBe(false);
    sim.setPortSecurity('switch', BREAKROOM_PORT, { maxMacs: 1, violation: 'shutdown' });
    const since = sim.t;
    play(sim, replayFlood);
    expect(check('fix', 'port-sec', undefined, sim, since)).toBe(true);
    expect(check('fix', 'flood-blocked', undefined, sim, since)).toBe(true);
  });

  it('a deny rule below allow out does nothing; above it, the check-in is blocked', () => {
    const sim = build();
    const rule = { dir: 'out', proto: 'any', src: 'any', dst: IP.c2, dport: 'any', action: 'deny' } as const;
    sim.fwAddRule('gw', rule);
    expect(check('fix', 'deny-c2', undefined, sim)).toBe(false);
    let since = sim.t;
    play(sim, replayCheckin);
    expect(check('fix', 'c2-blocked', undefined, sim, since)).toBe(false);
    const id = sim.dev('gw').firewall!.rules.at(-1)!.id;
    sim.fwMoveRule('gw', id, 0);
    expect(check('fix', 'deny-c2', undefined, sim)).toBe(true);
    since = sim.t;
    play(sim, replayCheckin);
    expect(check('fix', 'c2-blocked', undefined, sim, since)).toBe(true);
  });

  it('does not count a check-in that got through, even if the rule moves up partway', () => {
    const sim = build();
    sim.fwAddRule('gw', { dir: 'out', proto: 'any', src: 'any', dst: IP.c2, dport: 'any', action: 'deny' });
    const since = sim.t;
    replayCheckin(sim);
    // Let the handshake finish, then move the rule up while the check-in is still talking.
    for (let i = 0; i < 400 && !happened(sim, since, (e) => e.type === 'tcp' && e.what === 'open'); i++) sim.advance(5);
    sim.fwMoveRule('gw', sim.dev('gw').firewall!.rules.at(-1)!.id, 0);
    sim.runUntilIdle();
    expect(check('fix', 'c2-blocked', undefined, sim, since)).toBe(false);
  });

  it('does not count a rule that blocks everything going out', () => {
    const sim = build();
    sim.fwAddRule('gw', { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'deny' }, 0);
    expect(check('fix', 'deny-c2', undefined, sim)).toBe(false);
  });
});
