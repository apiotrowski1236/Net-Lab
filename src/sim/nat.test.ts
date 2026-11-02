import { describe, expect, it } from 'vitest';
import { addEntry, allocPort, MAX_NAT_ENTRIES, NAT_FIRST_PORT, newNat } from './nat';
import { NetBuilder } from './build';
import type { Sim } from './sim';

describe('NAT table helpers', () => {
  it('hands out public ports in order, skipping forwarded ones', () => {
    const nat = newNat('wan', [{ proto: 'tcp', port: NAT_FIRST_PORT + 1, to: { ip: '192.168.1.10', port: 80 } }]);
    expect(allocPort(nat)).toBe(NAT_FIRST_PORT);
    expect(allocPort(nat)).toBe(NAT_FIRST_PORT + 2);
  });

  it('keeps at most MAX_NAT_ENTRIES lines, dropping the oldest', () => {
    const nat = newNat('wan');
    for (let i = 0; i < MAX_NAT_ENTRIES + 3; i++) {
      addEntry(nat, { proto: 'tcp', inside: { ip: '192.168.1.10', port: i }, public: i, remote: { ip: '198.51.100.20', port: 80 }, t: i, used: i });
    }
    expect(nat.table.length).toBe(MAX_NAT_ENTRIES);
    expect(nat.table[0].inside.port).toBe(3);
  });
});

/**
 * Two computers behind a NAT router (203.0.113.25 outside), an internet
 * provider, a web site with two pages, and a stranger on the internet.
 */
function home(): Sim {
  return new NetBuilder({ linkMs: 100, procMs: 20, l2Ms: 10 })
    .host('a', { label: 'Laptop', x: 0, y: 0, ip: '192.168.1.10/24', gateway: '192.168.1.1', web: { name: 'a.home', title: 'Laptop page', https: false, page: 'hi' } })
    .host('b', { label: 'Phone', x: 0, y: 0, ip: '192.168.1.11/24', gateway: '192.168.1.1' })
    .switch('sw', { label: 'Switch', x: 0, y: 0 })
    .router('r', {
      label: 'Router',
      x: 0,
      y: 0,
      ifaces: [
        { id: 'home', ip: '192.168.1.1/24' },
        { id: 'internet', ip: '203.0.113.25/24' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '203.0.113.1', iface: 'internet' }],
      nat: { outside: 'internet' },
    })
    .router('isp', {
      label: 'ISP',
      x: 0,
      y: 0,
      ifaces: [
        { id: 'customer', ip: '203.0.113.1/24' },
        { id: 'web', ip: '198.51.100.1/24' },
      ],
    })
    .host('site', {
      label: 'Video site',
      x: 0,
      y: 0,
      ip: '198.51.100.20/24',
      gateway: '198.51.100.1',
      web: { name: 'video.example', title: 'Videos', https: false, pages: { '/cats': { title: 'Cats', page: 'meow' }, '/math': { title: 'Math', page: '1+1' } } },
    })
    .host('stranger', { label: 'Stranger', x: 0, y: 0, ip: '198.51.100.200/24', gateway: '198.51.100.1' })
    .link('a', 'sw')
    .link('b', 'sw')
    .link(['r', 'home'], 'sw')
    .link(['r', 'internet'], ['isp', 'customer'])
    .switch('net', { label: 'Internet', x: 0, y: 0 })
    .link(['isp', 'web'], 'net')
    .link('site', 'net')
    .link('stranger', 'net')
    .build();
}

describe('NAT in the simulator', () => {
  it('two devices browsing the same site at once each get their own page, through two table lines', () => {
    const sim = home();
    sim.setSniffing('a', true);
    sim.browse('a', 'http://198.51.100.20/math');
    sim.browse('b', 'http://198.51.100.20/cats');
    sim.runUntilIdle();
    expect(sim.dev('a').browser).toMatchObject({ status: 'loaded', title: 'Math' });
    expect(sim.dev('b').browser).toMatchObject({ status: 'loaded', title: 'Cats' });

    const table = sim.dev('r').nat!.table;
    expect(table.map((e) => [e.inside.ip, e.public, e.remote.ip, e.remote.port])).toEqual([
      ['192.168.1.10', 50001, '198.51.100.20', 80],
      ['192.168.1.11', 50002, '198.51.100.20', 80],
    ]);
    // The site only ever saw the shared address.
    expect(sim.dev('site').logs.map((l) => l.fields?.src)).toEqual(['203.0.113.25', '203.0.113.25']);
    // The answer the laptop captured carries a note of what the router changed.
    const answer = sim.dev('a').capture.find((c) => c.frame.ip?.app.kind === 'http-res')!;
    expect(answer.frame.ip!.nat).toEqual({ by: 'r', was: { dst: '203.0.113.25', dstPort: 50001 } });
    expect(answer.frame.ip!.dst).toBe('192.168.1.10');
    const nats = sim.events.flatMap((e) => (e.type === 'nat' ? [`${e.what}:${e.who}:${e.entry.public}`] : []));
    expect(nats).toEqual(['out:a:50001', 'out:b:50002', 'in:a:50001', 'in:b:50002']);
  });

  it('a ping keeps its ID as the public number and its reply comes back in', () => {
    const sim = home();
    const seq = sim.ping('b', '198.51.100.20');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'b' && e.seq === seq)).toBe(true);
    expect(sim.dev('r').nat!.table).toEqual([expect.objectContaining({ proto: 'icmp', public: seq, inside: { ip: '192.168.1.11', port: seq } })]);
  });

  it('drops an inbound packet nobody inside asked for, and logs it', () => {
    const sim = home();
    const id = sim.connectService('stranger', '203.0.113.25', 3389);
    sim.runUntilIdle();
    const drop = sim.events.find((e) => e.type === 'drop' && e.reason === 'unsolicited');
    expect(drop).toMatchObject({ device: 'r' });
    const conn = sim.dev('stranger').conns!.find((c) => c.id === id)!;
    expect(conn).toMatchObject({ status: 'no-answer', at: 'r', reason: 'unsolicited' });
    const line = sim.dev('r').logs.find((l) => l.source === 'nat')!;
    expect(line.msg).toBe(`Blocked incoming TCP 198.51.100.200:${conn.sport} -> 203.0.113.25:3389, no matching connection`);
    expect(line.fields).toEqual({ src: '198.51.100.200', dst: '203.0.113.25', proto: 'tcp', sport: conn.sport, dport: 3389, action: 'drop' });
    expect(sim.events.some((e) => e.type === 'nat')).toBe(false);
  });

  it("delivers answers to the router's own traffic", () => {
    const sim = home();
    const seq = sim.ping('r', '198.51.100.20');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'r' && e.seq === seq)).toBe(true);
    expect(sim.dev('r').nat!.table).toEqual([]);
  });

  it('port forwarding lets a packet in on purpose, and its answer goes back out the same port', () => {
    const sim = home();
    sim.addNatForward('r', { proto: 'tcp', port: 8080, to: { ip: '192.168.1.10', port: 80 } });
    const id = sim.connectService('stranger', '203.0.113.25', 8080, { app: 'http' });
    sim.runUntilIdle();
    expect(sim.dev('stranger').conns!.find((c) => c.id === id)).toMatchObject({ status: 'open' });
    expect(sim.dev('r').nat!.table).toEqual([expect.objectContaining({ forwarded: true, public: 8080, inside: { ip: '192.168.1.10', port: 80 } })]);
    sim.removeNatForward('r', 'tcp', 8080);
    sim.clearNat('r');
    const again = sim.connectService('stranger', '203.0.113.25', 8080, { app: 'http' });
    sim.runUntilIdle();
    expect(sim.dev('stranger').conns!.find((c) => c.id === again)).toMatchObject({ status: 'no-answer', reason: 'unsolicited' });
  });

  it('runs the same way every time', () => {
    const run = () => {
      const sim = home();
      sim.browse('a', 'http://198.51.100.20/math');
      sim.browse('b', 'http://198.51.100.20/cats');
      sim.connectService('stranger', '203.0.113.25', 3389);
      sim.runUntilIdle();
      return JSON.stringify(sim.events);
    };
    expect(run()).toBe(run());
  });
});
