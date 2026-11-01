import { describe, expect, it } from 'vitest';
import { burstCopy, burstIp, burstMac, burstMacs, burstSize } from './burst';
import { NetBuilder } from './build';
import { macsOnPort, macTableUse, portUp } from './switchsec';
import type { Frame, SimEvent } from './types';

const MAC = {
  a: '0a:00:00:00:00:0a',
  b: '0a:00:00:00:00:0b',
  c: '0a:00:00:00:00:0c',
  m: '0e:00:00:00:00:66',
};

/** a, b, c on p1-p3 of a 6-port switch; m (the attacker) on p4. */
function office(opts: { tableSize?: number; secure?: boolean } = {}) {
  const sim = new NetBuilder()
    .switch('sw', { label: 'Switch', x: 300, y: 300, ports: 6 })
    .host('a', { label: 'A', x: 100, y: 100, ip: '10.0.0.1/24', mac: MAC.a })
    .host('b', { label: 'B', x: 200, y: 100, ip: '10.0.0.2/24', mac: MAC.b })
    .host('c', { label: 'C', x: 300, y: 100, ip: '10.0.0.3/24', mac: MAC.c })
    .host('m', { label: 'M', x: 400, y: 100, ip: '10.0.0.66/24', mac: MAC.m, attacker: true })
    .link('a', ['sw', 'p1'])
    .link('b', ['sw', 'p2'])
    .link('c', ['sw', 'p3'])
    .link('m', ['sw', 'p4'])
    .build();
  if (opts.secure !== false && opts.tableSize !== undefined) sim.configureSwitch('sw', { tableSize: opts.tableSize });
  sim.prelearnSwitch('sw');
  sim.prewarmArp(['a', 'b', 'c', 'm']);
  return sim;
}

const captured = (events: SimEvent[], device: string, pred: (f: Frame) => boolean) =>
  events.some((e) => e.type === 'captured' && e.device === device && pred(e.frame));

const pingFrom = (ip: string) => (f: Frame) => f.ip?.src === ip && f.ip.app.kind === 'ping';

describe('bursts', () => {
  it('makes the same locally administered MACs from the same seed', () => {
    const one = Array.from({ length: 50 }, (_, i) => burstMac(1234, i));
    const two = Array.from({ length: 50 }, (_, i) => burstMac(1234, i));
    expect(one).toEqual(two);
    expect(new Set(one).size).toBe(50);
    for (const m of one) {
      expect(m).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
      const first = parseInt(m.slice(0, 2), 16);
      expect(first & 0x02).toBe(2); // locally administered
      expect(first & 0x01).toBe(0); // unicast
    }
    expect(burstMac(1235, 0)).not.toBe(burstMac(1234, 0));
  });

  it('makes public-looking source IPs', () => {
    for (let i = 0; i < 200; i++) {
      const ip = burstIp(99, i);
      const [a, b] = ip.split('.').map(Number);
      expect(a).toBeGreaterThan(10);
      expect(a).toBeLessThan(224);
      expect(a).not.toBe(127);
      expect(a === 192 && b === 168).toBe(false);
    }
  });

  it('expands a burst into its copies', () => {
    const f: Frame = { id: 1, src: burstMac(7, 0), dst: MAC.a, origin: 'm', burst: { count: 5, vary: 'src-mac', seed: 7 } };
    expect(burstSize(f)).toBe(5);
    expect(burstSize({ ...f, burst: undefined })).toBe(1);
    const macs = burstMacs(f);
    expect(macs).toHaveLength(5);
    expect(macs[0]).toBe(f.src);
    expect(burstCopy(f, 3).src).toBe(macs[3]);
    expect(burstCopy(f, 3).burst).toBeUndefined();

    const ping: Frame = {
      id: 2,
      src: MAC.m,
      dst: MAC.a,
      origin: 'm',
      ip: { src: '10.0.0.66', dst: '10.0.0.1', ttl: 64, proto: 'icmp', app: { kind: 'ping', seq: 1, reply: false } },
      burst: { count: 3, vary: 'src-ip', seed: 9 },
    };
    expect(burstMacs(ping)).toEqual([MAC.m]);
    expect(burstCopy(ping, 0).ip?.src).toBe('10.0.0.66');
    expect(burstCopy(ping, 2).ip?.src).toBe(burstIp(9, 2));
    expect(burstCopy(ping, 2).src).toBe(MAC.m);
  });

  it('carries any frame type through a switch, and a sniffer sees the count', () => {
    const sim = office({ tableSize: 32 });
    sim.setSniffing('c', true);
    const f = sim.sendBurst(
      'm',
      {
        dst: 'ff:ff:ff:ff:ff:ff',
        ip: { src: '10.0.0.66', dst: '10.0.0.255', ttl: 64, proto: 'icmp', app: { kind: 'ping', seq: 1, reply: false } },
      },
      { count: 40, vary: 'none' },
    );
    expect(f?.burst?.count).toBe(40);
    sim.runUntilIdle();
    const got = sim.events.find((e) => e.type === 'captured' && e.device === 'c');
    expect(got?.type === 'captured' && got.frame.burst?.count).toBe(40);
    // Identical copies teach the switch one MAC.
    expect(macsOnPort(sim.dev('sw'), 'p4')).toEqual([MAC.m]);
    expect(sim.dev('sw').switchSec?.ports.p4.framesIn).toBe(40);
  });
});

describe('MAC table limit (mac-flood)', () => {
  it('leaves switches without switch security unchanged', () => {
    const sim = office();
    expect(sim.dev('sw').switchSec).toBeUndefined();
    sim.macFlood('m', 3, 20);
    sim.runUntilIdle();
    expect(macTableUse(sim.dev('sw'))).toEqual({ used: 64, size: undefined });
    expect(sim.dev('sw').macTable[MAC.a]).toBe('p1');
    expect(sim.dev('sw').logs).toEqual([]);
  });

  it('a flood pushes real devices out, and their traffic goes out every port', () => {
    const sim = office({ tableSize: 8 });
    sim.setSniffing('m', true);
    const before = sim.events.length;

    // Before the flood the switch sends a's traffic for b only to b.
    sim.ping('a', '10.0.0.2');
    sim.runUntilIdle();
    expect(captured(sim.events.slice(before), 'm', pingFrom('10.0.0.1'))).toBe(false);

    sim.macFlood('m', 1, 20);
    sim.runUntilIdle();
    const sw = sim.dev('sw');
    expect(macTableUse(sw)).toEqual({ used: 8, size: 8 });
    expect(sw.macTable[MAC.a]).toBeUndefined();
    expect(sw.macTable[MAC.b]).toBeUndefined();
    expect(macsOnPort(sw, 'p4').length).toBe(8);

    const overflow = sim.events.find((e) => e.type === 'mac-overflow');
    expect(overflow?.type === 'mac-overflow' && overflow.evicted).toContain(MAC.a);
    const learn = sim.events.find((e) => e.type === 'mac-learn' && e.count);
    expect(learn?.type === 'mac-learn' && learn.count).toBe(20);
    const log = sim.dev('sw').logs.find((l) => l.source === 'mac-table');
    expect(log?.msg).toContain('MAC address table full (8/8)');
    expect(log?.msg).toContain('port 4');
    expect(log?.fields?.port).toBe('p4');

    // Now b's MAC is unknown, so a's next frame for b goes out every port.
    const mark = sim.events.length;
    sim.ping('a', '10.0.0.2');
    sim.runUntilIdle();
    expect(captured(sim.events.slice(mark), 'm', pingFrom('10.0.0.1'))).toBe(true);
  });

  it('replays the same flood into the same table', () => {
    const run = () => {
      const sim = office({ tableSize: 8 });
      sim.macFlood('m', 2, 20);
      sim.runUntilIdle();
      return JSON.stringify(sim.dev('sw').macTable);
    };
    expect(run()).toBe(run());
  });
});

describe('port security (mac-flood)', () => {
  it("'shutdown' turns the port off at the first extra MAC", () => {
    const sim = office({ tableSize: 32 });
    sim.setPortSecurity('sw', 'p4', { maxMacs: 1, violation: 'shutdown' });
    expect(sim.dev('sw').switchSec?.ports.p4.security?.learned).toEqual([MAC.m]);

    sim.macFlood('m', 1, 20);
    sim.runUntilIdle();
    const sw = sim.dev('sw');
    expect(portUp(sw, 'p4')).toBe(false);
    expect(sw.switchSec?.ports.p4.shutdown).toBe('violation');
    expect(macsOnPort(sw, 'p4')).toEqual([]);
    expect(macTableUse(sw).used).toBe(3);
    expect(sim.events.some((e) => e.type === 'port-security' && e.action === 'shutdown')).toBe(true);
    expect(sim.events.some((e) => e.type === 'drop' && e.reason === 'port-security')).toBe(true);
    const msgs = sim.dev('sw').logs.map((l) => l.msg);
    expect(msgs.some((m) => m.includes('PSECURE_VIOLATION') && m.includes('port 4'))).toBe(true);
    expect(msgs.some((m) => m.includes('err-disable'))).toBe(true);

    // The port stays off: even m's real MAC gets nowhere.
    sim.ping('m', '10.0.0.1');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'drop' && e.reason === 'port-shutdown')).toBe(true);
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'm')).toBe(false);

    // An admin turns it back on.
    sim.setPortShutdown('sw', 'p4', false);
    sim.ping('m', '10.0.0.1');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'm')).toBe(true);
  });

  it("'restrict' drops only the extra MACs and keeps the port on", () => {
    const sim = office({ tableSize: 32 });
    sim.setPortSecurity('sw', 'p4', { maxMacs: 3, violation: 'restrict' });
    sim.macFlood('m', 1, 20);
    sim.runUntilIdle();
    const sw = sim.dev('sw');
    expect(portUp(sw, 'p4')).toBe(true);
    expect(macsOnPort(sw, 'p4')).toHaveLength(3);
    expect(sw.switchSec?.ports.p4.security?.violations).toBe(18);
    const ev = sim.events.find((e) => e.type === 'port-security');
    expect(ev?.type === 'port-security' && ev.action === 'restrict' && ev.count).toBe(18);
  });

  it('MAC filtering lets only listed MACs in, and a copied MAC gets through', () => {
    const sim = office({ tableSize: 32 });
    sim.setPortSecurity('sw', 'p4', { maxMacs: 1, violation: 'restrict', allowed: [MAC.c] });
    expect(macsOnPort(sim.dev('sw'), 'p4')).toEqual([]);

    sim.ping('m', '10.0.0.1');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'm')).toBe(false);

    // Take c off the switch so its MAC is free, then copy it. (a has never
    // talked to m, so a asks with ARP and learns m's new MAC from the answer.)
    sim.disconnect('c', 'eth0');
    delete sim.dev('a').arp['10.0.0.66'];
    sim.setMac('m', MAC.c);
    expect(sim.dev('m').ifaces[0].mac).toBe(MAC.c);
    expect(sim.dev('m').ifaces[0].factoryMac).toBe(MAC.m);
    const mark = sim.events.length;
    sim.ping('m', '10.0.0.1');
    sim.runUntilIdle();
    expect(sim.events.slice(mark).some((e) => e.type === 'ping-reply' && e.device === 'm')).toBe(true);
    expect(sim.dev('sw').macTable[MAC.c]).toBe('p4');

    sim.setMac('m', null);
    expect(sim.dev('m').ifaces[0].mac).toBe(MAC.m);
    expect(sim.dev('m').ifaces[0].factoryMac).toBeUndefined();
    const changes = sim.events.filter((e) => e.type === 'config' && e.what === 'mac');
    expect(changes).toHaveLength(2);
  });

  it('forgets learned MACs when the cable comes out, unless sticky', () => {
    const sim = office({ tableSize: 32 });
    sim.setPortSecurity('sw', 'p1', { maxMacs: 1, violation: 'shutdown' });
    sim.setPortSecurity('sw', 'p2', { maxMacs: 1, violation: 'shutdown', sticky: true });
    sim.disconnect('a', 'eth0');
    sim.disconnect('b', 'eth0');
    const ports = sim.dev('sw').switchSec!.ports;
    expect(ports.p1.security?.learned).toEqual([]);
    expect(ports.p2.security?.learned).toEqual([MAC.b]);
  });
});

describe('port shutdown and link logs (mac-flood)', () => {
  it('a shut port carries nothing and logs like a switch', () => {
    const sim = office({ tableSize: 32 });
    sim.setPortShutdown('sw', 'p4', true);
    const sw = sim.dev('sw');
    expect(portUp(sw, 'p4')).toBe(false);
    expect(sw.macTable[MAC.m]).toBeUndefined();

    // Nothing in, and nothing flooded out to it.
    sim.setSniffing('m', true);
    sim.ping('m', '10.0.0.1');
    sim.ping('a', '10.0.0.2');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'drop' && e.reason === 'port-shutdown')).toBe(true);
    expect(sim.events.some((e) => e.type === 'captured' && e.device === 'm' && e.frame.origin !== 'm')).toBe(false);

    const msgs = sim.dev('sw').logs.map((l) => l.msg);
    expect(msgs).toContain('%LINK-5-CHANGED: Interface port 4, changed state to administratively down');

    // Unplugging and plugging into a shut port logs nothing new.
    sim.disconnect('m', 'eth0');
    sim.connect({ device: 'm', iface: 'eth0' }, { device: 'sw', iface: 'p4' });
    expect(sim.dev('sw').logs.length).toBe(1);
  });

  it('logs cables going in and out', () => {
    const sim = office({ tableSize: 32 });
    sim.disconnect('c', 'eth0');
    sim.connect({ device: 'c', iface: 'eth0' }, { device: 'sw', iface: 'p6' });
    const msgs = sim.dev('sw').logs.map((l) => l.msg);
    expect(msgs).toEqual([
      '%LINK-3-UPDOWN: Interface port 3, changed state to down',
      '%LINK-3-UPDOWN: Interface port 6, changed state to up',
    ]);
  });
});
