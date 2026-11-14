import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import type { Sim } from './sim';
import { flagText, scriptTurns, type TcpScript } from './tcp';
import type { Frame } from './types';
import { matchFilter, parseFilter } from './displayFilter';

/** Two hosts and a switch whose mirror port feeds a sniffer. */
function lan(): Sim {
  const sim = new NetBuilder()
    .host('a', { label: 'A', x: 0, y: 0, ip: '10.0.0.1/24' })
    .host('b', { label: 'B', x: 0, y: 0, ip: '10.0.0.2/24', services: [{ port: 80, proto: 'tcp', app: 'http' }] })
    .host('tap', { label: 'Tap', x: 0, y: 0 })
    .switch('sw', { label: 'SW', x: 0, y: 0, ports: 3, mirror: 'p3' })
    .link('a', ['sw', 'p1'])
    .link('b', ['sw', 'p2'])
    .link('tap', ['sw', 'p3'])
    .build();
  sim.prewarmArp(['a', 'b']);
  sim.setSniffing('tap', true);
  return sim;
}
const seen = (sim: Sim) => sim.dev('tap').capture.map((c) => c.frame).filter((f) => f.ip?.tcp);
const flags = (fs: Frame[]) => fs.map((f) => `${f.ip!.src === '10.0.0.1' ? '>' : '<'} ${flagText(f.ip!.tcp!.flags)}`);

const HELLO: TcpScript = { app: 'http', lines: [{ from: 'client', text: 'GET / HTTP/1.1' }, { from: 'server', text: 'HTTP/1.1 200 OK' }] };

describe('tcp sessions', () => {
  it('flag text follows Wireshark’s order', () => {
    expect(flagText({ ack: true, syn: true })).toBe('SYN, ACK');
    expect(flagText({ ack: true, fin: true })).toBe('FIN, ACK');
    expect(flagText({ ack: true, rst: true })).toBe('RST, ACK');
  });

  it('groups lines into turns and bulk lines into segments', () => {
    const t = scriptTurns({ app: 'x', lines: [{ from: 'client', text: 'hi' }, { from: 'client', len: 10, count: 3 }, { from: 'server', text: 'ok' }] });
    expect(t.map((x) => [x.from, x.segments.length])).toEqual([['client', 4], ['server', 1]]);
  });

  it('plays the handshake, the data, and the close', () => {
    const sim = lan();
    sim.tcpConnect('a', '10.0.0.2', 80, HELLO);
    sim.runUntilIdle();
    expect(flags(seen(sim))).toEqual(['> SYN', '< SYN, ACK', '> ACK', '> PSH, ACK', '< ACK', '< PSH, ACK', '> ACK', '> FIN, ACK', '< FIN, ACK', '> ACK']);
    expect(sim.tcpSessions[0].state).toBe('done');
    expect(sim.events.some((e) => e.type === 'tcp' && e.what === 'done')).toBe(true);
  });

  it('a server that speaks first starts once the handshake is done', () => {
    const sim = lan();
    sim.tcpConnect('a', '10.0.0.2', 80, { app: 'http', lines: [{ from: 'server', text: 'login: ' }, { from: 'client', text: 'me' }] });
    sim.runUntilIdle();
    const data = seen(sim).filter((f) => f.ip!.tcp!.flags.psh);
    expect(data.map((f) => (f.ip!.app.kind === 'svc' ? f.ip!.app.text : ''))).toEqual(['login: ', 'me']);
  });

  it('a closed port answers RST, ACK and the session is refused', () => {
    const sim = lan();
    sim.tcpConnect('a', '10.0.0.2', 443, HELLO);
    sim.runUntilIdle();
    expect(flags(seen(sim))).toEqual(['> SYN', '< RST, ACK']);
    expect(sim.tcpSessions[0].state).toBe('refused');
  });

  it('a SYN scan gets RST from closed ports, SYN, ACK from open ones, and hangs up on those', () => {
    const sim = lan();
    sim.tcpSynScan('a', '10.0.0.2', [79, 80, 81], { gapMs: 20_000 });
    sim.runUntilIdle();
    expect(flags(seen(sim))).toEqual(['> SYN', '< RST, ACK', '> SYN', '< SYN, ACK', '> RST', '> SYN', '< RST, ACK']);
  });

  it('display filters read the flags', () => {
    const sim = lan();
    sim.tcpSynScan('a', '10.0.0.2', [79, 80], { gapMs: 5 });
    sim.runUntilIdle();
    const count = (q: string) => {
      const p = parseFilter(q);
      if (!p.ok) throw new Error(p.msg);
      return seen(sim).filter((f) => matchFilter(p.node, f)).length;
    };
    expect(count('tcp.flags.syn == 1')).toBe(3);
    expect(count('tcp.flags.syn == 1 && tcp.flags.ack == 1')).toBe(1);
    expect(count('tcp.flags.reset == 1')).toBe(2);
    expect(count('http')).toBe(0);
  });

  it('the mirror port gets a copy of traffic between other ports', () => {
    const sim = lan();
    sim.tcpConnect('a', '10.0.0.2', 80, HELLO);
    sim.runUntilIdle();
    expect(seen(sim).length).toBeGreaterThan(0);
    sim.setMirror('sw', null);
    sim.dev('tap').capture = [];
    sim.tcpConnect('a', '10.0.0.2', 80, HELLO);
    sim.runUntilIdle();
    expect(seen(sim)).toHaveLength(0);
  });
});
