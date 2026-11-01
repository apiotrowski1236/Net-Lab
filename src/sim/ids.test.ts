import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import { aiAlerts, aiCounts, alertLine, correlate, ipsNote, judge, observe, type AiEvent, type Baseline } from './ids';
import type { Sim } from './sim';
import type { Frame, LogEntry } from './types';

const GW = '10.0.0.1';
const GW_MAC = '02:00:00:00:00:01';
const A = '10.0.0.10';
const B = '10.0.0.11';
const M = '10.0.0.66';
const M_MAC = '0e:00:00:00:00:66';
const OUT = '198.51.100.9';
const BAD = '198.51.100.77';
const HOUR = 3600_000;

/**
 * a, b, and the attacker m on a switch, a sensor s on the switch, and a
 * router with a firewall out to `inet`, which answers on 443 at two addresses.
 * The clock reads 08:00 at sim time 0.
 */
function office(): Sim {
  const sim = new NetBuilder()
    .router('inet', {
      label: 'Internet',
      x: 900,
      y: 300,
      ifaces: [
        { id: 'edge', ip: '203.0.113.1/24' },
        { id: 'site', ip: `${OUT}/32` },
        { id: 'bad', ip: `${BAD}/32` },
      ],
      routes: [{ prefix: '10.0.0.0/24', via: '203.0.113.2', iface: 'edge' }],
    })
    .router('fw', {
      label: 'Firewall',
      x: 700,
      y: 300,
      ifaces: [
        { id: 'wan', ip: '203.0.113.2/24' },
        { id: 'lan', ip: `${GW}/24`, mac: GW_MAC },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '203.0.113.1', iface: 'wan' }],
      firewall: { outside: 'wan', mode: 'stateful', rules: [{ dir: 'out', proto: 'any', src: '10.0.0.0/24', dst: 'any', dport: 'any', action: 'allow' }] },
    })
    .switch('sw', { label: 'Switch', x: 500, y: 300, ports: 6 })
    .host('s', { label: 'Sensor', x: 500, y: 100, ip: '10.0.0.9/24', gateway: GW })
    .host('a', { label: 'A', x: 300, y: 100, ip: `${A}/24`, gateway: GW, services: [{ port: 445, proto: 'tcp', app: 'smb' }] })
    .host('b', { label: 'B', x: 300, y: 500, ip: `${B}/24`, gateway: GW, services: [{ port: 22, proto: 'tcp', app: 'ssh' }] })
    .host('m', { label: 'M', x: 500, y: 500, ip: `${M}/24`, gateway: GW, mac: M_MAC, attacker: true })
    .link(['inet', 'edge'], ['fw', 'wan'])
    .link(['fw', 'lan'], ['sw', 'p1'])
    .link('s', ['sw', 'p2'])
    .link('a', ['sw', 'p3'])
    .link('b', ['sw', 'p4'])
    .link('m', ['sw', 'p5'])
    .build();
  sim.dev('inet').services = [{ port: 443, proto: 'tcp', app: 'https' }];
  sim.configureSwitch('sw', { tableSize: 64 });
  sim.prelearnSwitch('sw');
  sim.prewarmArp(['fw', 's', 'a', 'b', 'm']);
  sim.configureIds('s', {
    taps: [{ device: 'sw' }, { device: 'fw', iface: 'wan' }],
    home: '10.0.0.0/24',
    arpWatch: { [GW]: GW_MAC },
    feed: { [BAD]: 'known-c2' },
    firewall: 'fw',
    clock: '08:00',
  });
  return sim;
}

const BASELINE: Baseline = { hours: [8, 18], peers: { [A]: [B], [B]: [A] }, typical: { [B]: 10_000_000 }, defaultTypical: 1_000_000 };

const alerts = (sim: Sim, signature?: string): LogEntry[] =>
  sim.dev('s').logs.filter((e) => e.level === 'alert' && e.source === 'ids' && (!signature || e.fields?.signature === signature));
const ipsLines = (sim: Sim) => sim.dev('s').logs.filter((e) => e.source === 'ips');
const run = (sim: Sim, f: () => void) => (f(), sim.runUntilIdle());

/** A connects out to OUT as if it happened at `hour` o'clock last night, moving `bytes`. */
const upload = (sim: Sim, hour: number, bytes: number, to = OUT) =>
  run(sim, () => sim.connectService('a', to, 443, { flow: { bytes, recordedAt: (hour - 8) * HOUR } }));

describe('ids signatures', () => {
  it('sees nothing while the signature set is off', () => {
    const sim = office();
    run(sim, () => sim.arpSpoof('m', 'a', GW));
    expect(alerts(sim)).toEqual([]);
    expect(sim.dev('s').ids!.sensor!.lastSeen).toBeDefined();
  });

  it('flags a forged ARP reply for the gateway, naming the attacker MAC', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    run(sim, () => sim.arpSpoof('m', 'a', GW));
    const [a] = alerts(sim, 'arp-spoof');
    expect(a.fields).toMatchObject({ ip: GW, mac: M_MAC, was: GW_MAC });
    expect(a.msg).toBe(`ALERT arp-spoof: ${GW} now claims MAC ${M_MAC} (was ${GW_MAC})`);
  });

  it('lets an honest ARP reply from the gateway pass', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    delete sim.dev('a').arp[GW];
    run(sim, () => sim.ping('a', OUT));
    expect(sim.events.some((e) => e.type === 'ping-reply')).toBe(true);
    expect(alerts(sim)).toEqual([]);
  });

  it('flags a MAC flood, and in prevention mode shuts the port it came in on', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    sim.idsSetPrevention('s', true);
    run(sim, () => sim.macFlood('m', 3, 30, 300));
    expect(alerts(sim, 'mac-flood')).toHaveLength(1);
    expect(sim.dev('sw').switchSec!.ports.p5?.shutdown).toBe('admin');
    expect(ipsLines(sim).map((e) => e.fields)).toEqual([{ action: 'shut', device: 'sw', port: 'p5', signature: 'mac-flood' }]);
  });

  it('does not count a few new MACs as a flood', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    run(sim, () => sim.macFlood('m', 1, 10, 300));
    expect(alerts(sim, 'mac-flood')).toEqual([]);
  });

  it('flags a port scan', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    run(sim, () => sim.scan('m', B, Array.from({ length: 20 }, (_, i) => 1000 + i)));
    const [a] = alerts(sim, 'port-scan');
    expect(a.fields).toMatchObject({ src: M, window: 60 });
    expect(Number(a.fields!.ports)).toBeGreaterThan(15);
  });

  it('flags traffic to an address on the threat feed', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    run(sim, () => sim.connectService('a', BAD, 443));
    expect(alerts(sim, 'known-bad-ip')[0].fields).toMatchObject({ ip: BAD, threat: 'known-c2', src: A });
  });

  it('flags a ping to the broadcast address', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    const frame: Frame = {
      id: 999,
      src: '0a:bc:00:00:00:01',
      dst: GW_MAC,
      origin: 'inet',
      ip: { src: '203.0.113.66', dst: '10.0.0.255', ttl: 60, proto: 'icmp', app: { kind: 'ping', seq: 1, reply: false } },
    };
    observe(sim, 's', sim.dev('fw'), 'wan', frame);
    expect(alerts(sim, 'icmp-broadcast')[0].fields).toMatchObject({ src: '203.0.113.66', dst: '10.0.0.255' });
  });

  it('logs the same alert once in a short window, and again after a setting changes', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    run(sim, () => sim.arpSpoof('m', 'a', GW));
    run(sim, () => sim.arpSpoof('m', 'b', GW));
    expect(alerts(sim, 'arp-spoof')).toHaveLength(1);
    sim.idsSetPrevention('s', true);
    sim.idsSetPrevention('s', false);
    run(sim, () => sim.arpSpoof('m', 'a', GW));
    expect(alerts(sim, 'arp-spoof')).toHaveLength(2);
  });

  it('ignores frames on a port that is shut', () => {
    const sim = office();
    sim.idsSetSignatures('s', true);
    sim.setPortShutdown('sw', 'p5', true);
    run(sim, () => sim.arpSpoof('m', 'a', GW));
    expect(alerts(sim)).toEqual([]);
  });
});

describe('ids anomaly detection', () => {
  it('scores off-hours, new peers, and big uploads, one point each', () => {
    const sim = office();
    sim.idsRecordBaseline('s', BASELINE);
    const s = sim.dev('s').ids!.sensor!;
    const pkt = (dst: string, bytes: number, hour: number) =>
      ({ src: A, dst, ttl: 64, proto: 'tcp', app: { kind: 'svc', conn: 1, app: 'https', reply: false }, flow: { bytes, recordedAt: (hour - 8) * HOUR } }) as const;
    expect(judge(s, { ...pkt(OUT, 90_000_000, 3) }, 0)).toMatchObject({ offHours: true, newPeer: true, big: true, deviation: 3, time: '03:00', hour: 3 });
    expect(judge(s, { ...pkt(B, 50_000_000, 2) }, 0)).toMatchObject({ offHours: true, newPeer: false, big: true, deviation: 2 });
    expect(judge(s, { ...pkt(OUT, 1000, 10) }, 0)).toMatchObject({ offHours: false, newPeer: true, big: false, deviation: 1 });
    expect(judge(s, { ...pkt(B, 1000, 17) }, 0).deviation).toBe(0);
  });

  it('alerts by tolerance: Loose misses a deviation of 3, Medium catches 2, Strict catches 1', () => {
    const cases: [string, number, number, boolean][] = [
      ['loose', 3, 90_000_000, false],
      ['medium', 3, 90_000_000, true],
      ['medium', 10, 1000, false],
      ['strict', 10, 1000, true],
    ];
    for (const [tol, hour, bytes, alerted] of cases) {
      const sim = office();
      sim.idsRecordBaseline('s', BASELINE);
      sim.idsSetAnomaly('s', true, tol as 'loose' | 'medium' | 'strict');
      upload(sim, hour, bytes);
      expect(alerts(sim, 'anomaly').length > 0, `${tol} at ${hour}:00, ${bytes} bytes`).toBe(alerted);
      expect(sim.dev('s').ids!.sensor!.judged.at(-1)?.alerted).toBe(alerted);
    }
  });

  it('names the host, the peer, and why in the alert', () => {
    const sim = office();
    sim.idsRecordBaseline('s', BASELINE);
    sim.idsSetAnomaly('s', true, 'medium');
    upload(sim, 3, 94371840);
    const [a] = alerts(sim, 'anomaly');
    expect(a.msg).toBe(`ALERT anomaly: ${A} off-baseline (03:00, new peer ${OUT}, 90 MB)`);
    expect(a.fields).toMatchObject({ host: A, peer: OUT, hour: 3, bytes: 94371840, deviation: 3 });
  });

  it('needs a baseline', () => {
    const sim = office();
    sim.idsSetAnomaly('s', true, 'strict');
    upload(sim, 3, 90_000_000);
    expect(alerts(sim)).toEqual([]);
  });

  it('in prevention mode blocks the flagged host at the firewall, once', () => {
    const sim = office();
    sim.idsRecordBaseline('s', BASELINE);
    sim.idsSetAnomaly('s', true, 'medium');
    sim.idsSetPrevention('s', true);
    upload(sim, 3, 90_000_000);
    const fw = sim.dev('fw').firewall!;
    expect(fw.rules.filter((r) => r.note === ipsNote(A)).map((r) => [r.dir, r.src, r.dst])).toEqual([
      ['out', A, 'any'],
      ['in', 'any', A],
    ]);
    expect(ipsLines(sim).map((e) => e.fields?.blocked)).toEqual([A]);
    const conn = sim.dev('a').conns!.at(-1)!;
    expect(conn.status).toBe('no-answer');
    // A second alert for the same host adds no more rules.
    sim.idsSetAnomaly('s', true, 'strict');
    upload(sim, 3, 90_000_000);
    expect(fw.rules.filter((r) => r.note === ipsNote(A))).toHaveLength(2);
  });
});

describe('siem', () => {
  const OUTSIDER = '203.0.113.66';
  const seed = (sim: Sim, kinds: ('deny' | 'scan' | 'fail')[], start = -60 * 60_000) => {
    kinds.forEach((k, i) => {
      const t = start + i * 60_000;
      if (k === 'deny') sim.log('fw', { source: 'firewall', level: 'notice', msg: 'DENY', fields: { action: 'deny', src: OUTSIDER, dst: A } }, t);
      if (k === 'scan') sim.log('s', alertLine('port-scan', { src: OUTSIDER, ports: 30, window: 60 }), t);
      if (k === 'fail') sim.log('a', { source: 'auth', level: 'warn', msg: 'sign-in FAILED', fields: { action: 'fail', user: 'admin', src: OUTSIDER } }, t);
    });
  };
  const withSiem = () => {
    const sim = office();
    sim.configureSiem('b', { sources: ['fw', 's', 'a'], home: '10.0.0.0/24', firstIncident: 7 });
    return sim;
  };

  it('opens one incident when one outside address shows up in three kinds of event', () => {
    const sim = withSiem();
    seed(sim, ['deny', 'deny', 'scan', 'fail', 'fail']);
    const [inc] = correlate(sim, 'b');
    expect(inc).toMatchObject({ id: 7, src: OUTSIDER, start: -60 * 60_000 });
    expect(inc.parts.map((p) => [p.kind, p.count])).toEqual([
      ['deny', 2],
      ['scan', 1],
      ['auth-fail', 2],
    ]);
    const line = sim.dev('b').logs.find((e) => e.no === inc.logNo)!;
    expect(line.msg).toBe(`INCIDENT 7 open: 3 event types from ${OUTSIDER}`);
    expect(line.t).toBe(-57 * 60_000);
    expect(correlate(sim, 'b')).toEqual([]);
    expect(sim.dev('b').ids!.siem!.incidents).toHaveLength(1);
  });

  it('needs three kinds inside the window', () => {
    const sim = withSiem();
    seed(sim, ['deny', 'scan']);
    seed(sim, ['fail'], 0);
    expect(correlate(sim, 'b')).toEqual([]);
  });

  it('records the analyst’s triage', () => {
    const sim = withSiem();
    seed(sim, ['deny', 'scan', 'fail']);
    correlate(sim, 'b');
    sim.siemTriage('b', 7, 'real', 'escalate');
    expect(sim.dev('b').ids!.siem!.incidents[0]).toMatchObject({ verdict: 'real', action: 'escalate' });
    expect(sim.dev('b').logs.at(-1)!.msg).toBe('INCIDENT 7 escalated: real attack');
  });

  it('counts what an AI threshold catches', () => {
    const sim = withSiem();
    const ev = (id: string, score: number, truth: AiEvent['truth']): AiEvent => ({ id, label: id, when: '00:00', score, truth });
    sim.aiScore('b', [ev('a1', 0.95, 'attack'), ev('a2', 0.75, 'attack'), ev('f1', 0.7, 'false-alarm'), ev('n1', 0.3, 'normal')]);
    const q = sim.dev('b').ids!.siem!;
    expect(aiCounts(q, 0.7)).toEqual({ attacks: 2, caught: 2, falseAlerts: 1, alerts: 3 });
    expect(aiCounts(q, 0.8)).toMatchObject({ caught: 1, falseAlerts: 0 });
    expect(aiAlerts(q.ai!.events, 0.3)).toHaveLength(4);
    sim.aiSetThreshold('b', 0.731);
    expect(q.threshold).toBe(0.75);
    sim.aiSetThreshold('b', 4);
    expect(q.threshold).toBe(1);
  });
});
