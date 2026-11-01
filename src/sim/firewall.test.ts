import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import { evaluate, firstMatch, logLine, newFirewall, ruleMatches, ruleText, type FwRuleInput } from './firewall';
import { identifyApp, scanFindings } from './services';
import type { Sim } from './sim';
import type { IpPacket, SimEvent } from './types';

const ATTACKER = '203.0.113.66';
const CLINIC = '198.51.100.40';
const VENDOR = '192.0.2.80';
const WEB = '10.0.1.10';

const allowIn443: FwRuleInput = { dir: 'in', proto: 'tcp', src: 'any', dst: WEB, dport: 443, action: 'allow' };
const denyInTcp: FwRuleInput = { dir: 'in', proto: 'tcp', src: 'any', dst: 'any', dport: 'any', action: 'deny' };
const clinicSsh: FwRuleInput = { dir: 'in', proto: 'tcp', src: '198.51.100.0/24', dst: WEB, dport: 22, action: 'allow' };
const outAny: FwRuleInput = { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow' };

/**
 * attacker, clinic, vendor -- inet router -- [fw] -- switch -- web server
 * The firewall starts unplugged; `placed` puts it into the inet-switch cable.
 */
function net(opts: { placed?: boolean; mode?: 'stateless' | 'stateful' | 'ngfw'; rules?: FwRuleInput[] } = {}): Sim {
  const sim = new NetBuilder({ autoArp: true, linkMs: 100, procMs: 10, l2Ms: 5, pingTimeoutMs: 5000 })
    .host('attacker', { label: 'Attacker', x: 0, y: 0, ip: `${ATTACKER}/24`, gateway: '203.0.113.1', attacker: true, services: [{ port: 443, proto: 'tcp', app: 'remote-control', banner: 'session ready' }] })
    .host('clinic', { label: 'Clinic', x: 0, y: 0, ip: `${CLINIC}/24`, gateway: '198.51.100.1' })
    .host('vendor', { label: 'Vendor', x: 0, y: 0, ip: `${VENDOR}/24`, gateway: '192.0.2.1', web: { name: 'updates.example', title: 'Updates', https: true } })
    .router('inet', {
      label: 'Internet',
      x: 0,
      y: 0,
      ifaces: [
        { id: 'a', ip: '203.0.113.1/24' },
        { id: 'c', ip: '198.51.100.1/24' },
        { id: 'v', ip: '192.0.2.1/24' },
        { id: 'h', ip: '10.0.1.1/24' },
      ],
    })
    .switch('sw', { label: 'Switch', x: 0, y: 0 })
    .host('web', {
      label: 'Web server',
      x: 0,
      y: 0,
      ip: `${WEB}/24`,
      gateway: '10.0.1.1',
      web: { name: 'achospital.example', title: 'Book', https: true },
      services: [{ port: 22, proto: 'tcp', app: 'ssh', banner: 'SSH-2.0' }],
    })
    .firewall('fw', { label: 'Firewall A', x: 500, y: 500, mode: opts.mode ?? 'stateful', rules: opts.rules ?? [] })
    .link('attacker', ['inet', 'a'])
    .link('clinic', ['inet', 'c'])
    .link('vendor', ['inet', 'v'])
    .link(['inet', 'h'], 'sw')
    .link('sw', 'web')
    .build();
  if (opts.placed !== false) sim.placeFirewall('fw', 'inet', 'sw', 'inet');
  return sim;
}

function conn(sim: Sim, from: string, to: string, port: number, app?: string) {
  const id = sim.connectService(from, to, port, { app });
  sim.runUntilIdle();
  return sim.dev(from).conns!.find((c) => c.id === id)!;
}

function fwEvents(sim: Sim): Extract<SimEvent, { type: 'firewall' }>[] {
  return sim.events.filter((e): e is Extract<SimEvent, { type: 'firewall' }> => e.type === 'firewall');
}

const pkt = (p: Partial<IpPacket>): IpPacket => ({
  src: ATTACKER,
  dst: WEB,
  ttl: 64,
  proto: 'tcp',
  srcPort: 50000,
  dstPort: 443,
  app: { kind: 'svc', conn: 1, app: 'https', reply: false },
  ...p,
});

describe('rule matching (pure)', () => {
  it('matches every criterion, and a port rule never matches ICMP', () => {
    const r = { ...allowIn443, id: 'r1' };
    expect(ruleMatches(r, pkt({}), 'in')).toBe(true);
    expect(ruleMatches(r, pkt({}), 'out')).toBe(false);
    expect(ruleMatches(r, pkt({ dstPort: 22 }), 'in')).toBe(false);
    expect(ruleMatches(r, pkt({ dst: '10.0.1.11' }), 'in')).toBe(false);
    expect(ruleMatches({ ...r, proto: 'any' }, pkt({ proto: 'icmp', srcPort: undefined, dstPort: undefined, app: { kind: 'ping', seq: 1, reply: false } }), 'in')).toBe(false);
    expect(ruleMatches({ ...clinicSsh, id: 'r2' }, pkt({ src: CLINIC, dstPort: 22 }), 'in')).toBe(true);
    expect(ruleMatches({ ...clinicSsh, id: 'r2' }, pkt({ src: ATTACKER, dstPort: 22 }), 'in')).toBe(false);
  });

  it('first match wins, and no match means the implicit deny', () => {
    const fw = newFirewall('outside', 'stateless', [allowIn443, denyInTcp]);
    expect(firstMatch(fw.rules, pkt({}), 'in')).toBe(0);
    expect(evaluate(fw, pkt({}), 'in')).toMatchObject({ action: 'allow', by: 'rule', ruleNo: 1 });
    expect(evaluate(fw, pkt({ dstPort: 22 }), 'in')).toMatchObject({ action: 'deny', by: 'rule', ruleNo: 2 });
    expect(evaluate(fw, pkt({ proto: 'udp', dstPort: 53 }), 'in')).toMatchObject({ action: 'deny', by: 'implicit' });
    expect(ruleText(allowIn443)).toBe('ALLOW in TCP from any to 10.0.1.10 port 443 (HTTPS)');
  });

  it('writes log lines like a real firewall, with the facts in fields', () => {
    const line = logLine(pkt({ dstPort: 22 }), 'in', { action: 'deny', by: 'rule', ruleNo: 3, ruleId: 'r3' });
    expect(line.msg).toBe('DENY in TCP 203.0.113.66:50000 -> 10.0.1.10:22 rule 3');
    expect(line.fields).toMatchObject({ action: 'deny', dir: 'in', src: ATTACKER, dport: 22, rule: 3 });
    expect(logLine(pkt({}), 'in', { action: 'deny', by: 'implicit' }).fields?.rule).toBe('implicit');
  });
});

describe('firewall in the network', () => {
  it('passes everything through like a cable, and only allows what a rule allows', () => {
    const open = net({ placed: false });
    expect(conn(open, 'attacker', WEB, 22).status).toBe('open');

    const sim = net({ rules: [allowIn443] });
    expect(sim.linkBetween('inet', 'sw')).toBeUndefined();
    expect(sim.linkBetween('inet', 'fw')).toBeDefined();
    const https = conn(sim, 'attacker', WEB, 443);
    expect(https.status).toBe('open');
    const ssh = conn(sim, 'attacker', WEB, 22);
    expect(ssh).toMatchObject({ status: 'no-answer', at: 'fw', reason: 'firewall' });
    const deny = sim.dev('fw').logs.find((l) => l.fields?.dport === 22)!;
    expect(deny.msg).toMatch(/^DENY in TCP 203\.0\.113\.66:\d+ -> 10\.0\.1\.10:22 implicit deny$/);
  });

  it('blocks pings with the implicit deny and says so in the ping result', () => {
    const sim = net({ rules: [allowIn443] });
    sim.ping('attacker', WEB);
    sim.runUntilIdle();
    expect(sim.events.find((e) => e.type === 'ping-fail')).toMatchObject({ reason: 'firewall', at: 'fw' });
  });

  it('rule order changes the result', () => {
    const sim = net({ rules: [denyInTcp, clinicSsh] });
    expect(conn(sim, 'clinic', WEB, 22).status).toBe('no-answer');
    expect(fwEvents(sim).at(-1)!.verdict).toMatchObject({ by: 'rule', ruleNo: 1, action: 'deny' });
    const id = sim.dev('fw').firewall!.rules[1].id;
    sim.fwMoveRule('fw', id, 0);
    expect(conn(sim, 'clinic', WEB, 22).status).toBe('open');
    expect(conn(sim, 'attacker', WEB, 22).status).toBe('no-answer');
  });

  it('stateless needs a rule for replies; stateful lets replies to its own conversations back', () => {
    const stateless = net({ mode: 'stateless', rules: [outAny, denyInTcp] });
    expect(conn(stateless, 'web', VENDOR, 443).status).toBe('no-answer');
    const reply = fwEvents(stateless).find((e) => e.dir === 'in')!;
    expect(reply.verdict).toMatchObject({ action: 'deny', ruleNo: 2 });

    const stateful = net({ mode: 'stateful', rules: [outAny, denyInTcp] });
    expect(conn(stateful, 'web', VENDOR, 443).status).toBe('open');
    expect(fwEvents(stateful).find((e) => e.dir === 'in')!.verdict.by).toBe('state');
    expect(stateful.dev('fw').firewall!.conns).toHaveLength(1);
  });

  it('a stateless reply rule lets forged replies in; stateful blocks them', () => {
    const replyRule: FwRuleInput = { dir: 'in', proto: 'tcp', src: 'any', sport: 443, dst: 'any', dport: 'any', action: 'allow' };
    const forge = (sim: Sim) => {
      sim.sendPacket('attacker', { src: VENDOR, dst: WEB, proto: 'tcp', srcPort: 443, dstPort: 51515, app: { kind: 'svc', conn: 0, app: 'https', reply: true, status: 'open' } });
      sim.runUntilIdle();
    };
    const stateless = net({ mode: 'stateless', rules: [outAny, replyRule] });
    forge(stateless);
    expect(stateless.events.some((e) => e.type === 'stray-reply' && e.device === 'web')).toBe(true);

    const stateful = net({ mode: 'stateful', rules: [outAny, replyRule] });
    expect(conn(stateful, 'web', VENDOR, 443).status).toBe('open');
    forge(stateful);
    expect(stateful.events.some((e) => e.type === 'stray-reply')).toBe(false);
    expect(fwEvents(stateful).at(-1)!.verdict).toMatchObject({ action: 'deny', by: 'no-state' });
    expect(stateful.dev('fw').logs.at(-1)!.msg).toMatch(/no matching connection$/);
  });

  it('next-gen catches a program that does not match its port', () => {
    const stateful = net({ mode: 'stateful', rules: [outAny] });
    expect(conn(stateful, 'web', ATTACKER, 443, 'remote-control')).toMatchObject({ status: 'open', banner: 'session ready' });

    const ngfw = net({ mode: 'ngfw', rules: [outAny] });
    const rc = conn(ngfw, 'web', ATTACKER, 443, 'remote-control');
    expect(rc).toMatchObject({ status: 'no-answer', reason: 'firewall' });
    expect(fwEvents(ngfw).at(-1)!.verdict).toMatchObject({ by: 'app', app: 'remote-control', expected: 'https' });
    expect(ngfw.dev('fw').logs.at(-1)!.level).toBe('warn');
    expect(conn(ngfw, 'web', VENDOR, 443).status).toBe('open');
    expect(identifyApp(pkt({ app: { kind: 'svc', conn: 1, app: 'remote-control', reply: false } }))).toBe('remote-control');
  });

  it('a firewall inside a router checks what the router forwards', () => {
    const sim = net({ placed: false });
    sim.dev('inet').firewall = newFirewall('a', 'stateful', [{ dir: 'in', proto: 'tcp', src: 'any', dst: WEB, dport: 443, action: 'allow' }, outAny]);
    expect(conn(sim, 'attacker', WEB, 443).status).toBe('open');
    expect(conn(sim, 'attacker', WEB, 22)).toMatchObject({ status: 'no-answer', at: 'inet' });
    // Traffic that doesn't arrive on the outside port counts as outbound.
    expect(conn(sim, 'clinic', WEB, 22).status).toBe('open');
  });

  it('NetBuilder gives a router a firewall', () => {
    const sim = new NetBuilder({ autoArp: true, linkMs: 100, procMs: 10, l2Ms: 5, pingTimeoutMs: 5000 })
      .host('out', { label: 'Out', x: 0, y: 0, ip: '203.0.113.9/24', gateway: '203.0.113.1' })
      .router('edge', {
        label: 'Edge',
        x: 0,
        y: 0,
        ifaces: [{ id: 'wan', ip: '203.0.113.1/24' }, { id: 'lan', ip: '10.0.0.1/24' }],
        firewall: { outside: 'wan', rules: [{ dir: 'in', proto: 'icmp', src: 'any', dst: 'any', dport: 'any', action: 'deny' }, { dir: 'in', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow' }, outAny] },
      })
      .host('in', { label: 'In', x: 0, y: 0, ip: '10.0.0.5/24', gateway: '10.0.0.1' })
      .link('out', ['edge', 'wan'])
      .link('in', ['edge', 'lan'])
      .build();
    expect(sim.dev('edge').firewall).toMatchObject({ outside: 'wan', mode: 'stateful' });
    const events: SimEvent[] = [];
    sim.on((e) => events.push(e));
    sim.ping('out', '10.0.0.5');
    sim.runUntilIdle();
    expect(events.some((e) => e.type === 'drop' && e.reason === 'firewall')).toBe(true);
  });

  it('can be taken out again, leaving the original cable', () => {
    const sim = net({});
    sim.unplaceFirewall('fw');
    expect(sim.linkBetween('inet', 'sw')).toBeDefined();
    expect(sim.dev('fw').ifaces.every((i) => !i.linkId)).toBe(true);
    expect(sim.dev('fw')).toMatchObject({ x: 500, y: 500 });
    expect(conn(sim, 'attacker', WEB, 22).status).toBe('open');
  });

  it('replay gives the same connection table', () => {
    const play = () => {
      const sim = net({ mode: 'stateful', rules: [allowIn443, clinicSsh, outAny] });
      sim.connectService('clinic', WEB, 22);
      sim.advance(50);
      sim.connectService('attacker', WEB, 443);
      sim.connectService('web', VENDOR, 443);
      sim.runUntilIdle();
      return sim;
    };
    const a = play();
    const b = play();
    expect(a.dev('fw').firewall!.conns.length).toBe(3);
    expect(JSON.stringify(a.dev('fw').firewall)).toBe(JSON.stringify(b.dev('fw').firewall));
    expect(JSON.stringify(a.devices)).toBe(JSON.stringify(b.devices));
  });
});

describe('services and scans', () => {
  it('answers open, closed, and lists implied web ports', () => {
    const sim = net({ placed: false });
    expect(conn(sim, 'attacker', WEB, 22)).toMatchObject({ status: 'open', banner: 'SSH-2.0' });
    expect(conn(sim, 'attacker', WEB, 3389).status).toBe('closed');
  });

  it('a scan finds hosts and open ports; behind a firewall it finds only what the rules allow', () => {
    const open = net({ placed: false });
    open.scan('attacker', '10.0.1.0/24');
    open.runUntilIdle();
    const s = open.dev('attacker').scans![0];
    expect(s.doneAt).toBeDefined();
    expect(s.size).toBe(254);
    const web = scanFindings(s).find((h) => h.ip === WEB)!;
    expect(web).toMatchObject({ ping: true, open: [22, 80, 443] });
    expect(open.events.filter((e) => e.type === 'scan-done')).toHaveLength(1);
    // Scan pings don't look like ping-tool pings.
    expect(open.events.some((e) => e.type === 'ping-sent' || e.type === 'ping-reply')).toBe(false);

    const guarded = net({ rules: [allowIn443] });
    guarded.scan('attacker', '10.0.1.0/24');
    guarded.runUntilIdle();
    const g = scanFindings(guarded.dev('attacker').scans![0]);
    expect(g.find((h) => h.ip === WEB)).toMatchObject({ ping: false, open: [443] });
    expect(guarded.dev('fw').logs.filter((l) => l.fields?.action === 'deny').length).toBeGreaterThan(5);
  });
});

describe('a firewall on a switch port', () => {
  it("ignores flooded copies of frames that aren't going through it", () => {
    // inet -- sw -- web, and sw -- [fw] -- lab. The switch hasn't learned the
    // web server's MAC yet, so it floods the attacker's first packet, a copy
    // toward the firewall too. That copy is for the web server, on the near side.
    const sim = new NetBuilder({ autoArp: true, linkMs: 100, procMs: 10, l2Ms: 5, pingTimeoutMs: 5000 })
      .host('attacker', { label: 'Attacker', x: 0, y: 0, ip: `${ATTACKER}/24`, gateway: '203.0.113.1' })
      .router('inet', { label: 'Internet', x: 0, y: 0, ifaces: [{ id: 'a', ip: '203.0.113.1/24' }, { id: 'h', ip: '10.0.1.1/24' }] })
      .switch('sw', { label: 'Switch', x: 0, y: 0 })
      .host('web', { label: 'Web', x: 0, y: 0, ip: `${WEB}/24`, gateway: '10.0.1.1', services: [{ port: 22, proto: 'tcp', app: 'ssh' }] })
      .host('lab', { label: 'Lab', x: 0, y: 0, ip: '10.0.1.20/24', gateway: '10.0.1.1', services: [{ port: 22, proto: 'tcp', app: 'ssh' }] })
      .firewall('fw', { label: 'Firewall', x: 0, y: 0 })
      .link('attacker', ['inet', 'a'])
      .link(['inet', 'h'], 'sw')
      .link('sw', 'web')
      .link('sw', 'lab')
      .build();
    sim.placeFirewall('fw', 'sw', 'lab', 'sw');
    expect(conn(sim, 'attacker', WEB, 22).status).toBe('open');
    expect(sim.events.some((e) => e.type === 'firewall')).toBe(false);
    expect(sim.dev('fw').logs).toHaveLength(0);
    // Traffic that does cross it is still checked.
    expect(conn(sim, 'attacker', '10.0.1.20', 22)).toMatchObject({ status: 'no-answer', reason: 'firewall', at: 'fw' });
  });
});
