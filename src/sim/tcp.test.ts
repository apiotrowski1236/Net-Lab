import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import type { Sim } from './sim';
import { flagText, scriptTurns, SYN_TRIES, type TcpScript } from './tcp';
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

/**
 * A depot-like edge (capture-analysis): an outside router with a far-off victim
 * and server, and a router with a LAN of two real computers behind a switch
 * whose mirror port feeds a sniffer. `a` thinks its network is a /25, so it
 * sends 10.0.0.255 to its gateway instead of onto the LAN.
 */
function edge(opts: { broadcastEcho?: boolean; directed?: boolean; denyOut?: number } = {}): Sim {
  const sim = new NetBuilder({ broadcastEcho: opts.broadcastEcho ?? false })
    .router('far', {
      label: 'Far',
      x: 0,
      y: 0,
      ifaces: [
        { id: 'wan', ip: '172.16.0.2/30' },
        { id: 'victim', ip: '192.0.2.77/32' },
        { id: 'srv', ip: '192.0.2.44/32' },
      ],
      routes: [{ prefix: '10.0.0.0/24', via: '172.16.0.1', iface: 'wan' }],
      services: [{ port: 4444, proto: 'tcp', app: 'http' }],
    })
    .router('gw', {
      label: 'GW',
      x: 0,
      y: 0,
      ifaces: [
        { id: 'lan', ip: '10.0.0.126/24' },
        { id: 'wan', ip: '172.16.0.1/30' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '172.16.0.2', iface: 'wan' }],
      ...(opts.denyOut
        ? { firewall: { outside: 'wan', mode: 'stateless' as const, rules: [{ dir: 'out' as const, proto: 'tcp' as const, src: 'any', dst: 'any', dport: opts.denyOut, action: 'deny' as const }] } }
        : {}),
    })
    .switch('sw', { label: 'SW', x: 0, y: 0, ports: 4, mirror: 'p4' })
    .host('a', { label: 'A', x: 0, y: 0, ip: '10.0.0.1/25', gateway: '10.0.0.126' })
    .host('b', { label: 'B', x: 0, y: 0, ip: '10.0.0.2/24', gateway: '10.0.0.126' })
    .host('tap', { label: 'Tap', x: 0, y: 0 })
    .link(['far', 'wan'], ['gw', 'wan'])
    .link(['gw', 'lan'], ['sw', 'p1'])
    .link('a', ['sw', 'p2'])
    .link('b', ['sw', 'p3'])
    .link('tap', ['sw', 'p4'])
    .build();
  if (opts.directed) sim.dev('gw').directedBroadcast = true;
  sim.prewarmArp(['a', 'b', 'gw', 'far']);
  sim.setSniffing('tap', true);
  return sim;
}
const smurfPing = (sim: Sim) => sim.sendPacket('far', { src: '192.0.2.77', dst: '10.0.0.255', proto: 'icmp', app: { kind: 'ping', seq: 1, reply: false } });
const icmpSeen = (sim: Sim) => sim.dev('tap').capture.map((c) => c.frame).filter((f) => f.ip?.proto === 'icmp');
const replies = (sim: Sim) => icmpSeen(sim).filter((f) => f.ip!.app.kind === 'ping' && f.ip!.app.reply).map((f) => `${f.ip!.src}>${f.ip!.dst}`).sort();

describe('directed broadcast to a LAN of real computers', () => {
  it('the router relays a ping for the LAN broadcast address as one broadcast frame, and logs it', () => {
    const sim = edge({ directed: true });
    smurfPing(sim);
    sim.runUntilIdle();
    const req = icmpSeen(sim).filter((f) => f.ip!.app.kind === 'ping' && !f.ip!.app.reply);
    expect(req).toHaveLength(1);
    expect(req[0].dst).toBe('ff:ff:ff:ff:ff:ff');
    expect(req[0].ip!.src).toBe('192.0.2.77');
    expect(sim.dev('gw').logs.some((l) => /directed broadcast/.test(l.msg))).toBe(true);
  });

  it('with directed broadcast off, the router drops it and nothing reaches the LAN', () => {
    const sim = edge();
    smurfPing(sim);
    sim.runUntilIdle();
    expect(icmpSeen(sim)).toHaveLength(0);
  });

  it('drops a directed broadcast that came in from the LAN itself', () => {
    const sim = edge({ directed: true, broadcastEcho: true });
    sim.sendPacket('a', { src: '10.0.0.1', dst: '10.0.0.255', proto: 'icmp', app: { kind: 'ping', seq: 1, reply: false } });
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'drop' && e.device === 'gw' && e.reason === 'no-broadcast')).toBe(true);
    // Only a's own request to the router crossed the switch: no broadcast copy, no replies.
    expect(icmpSeen(sim).map((f) => f.dst)).not.toContain('ff:ff:ff:ff:ff:ff');
    expect(replies(sim)).toEqual([]);
  });
});

describe('broadcast pings (SimOptions.broadcastEcho)', () => {
  it('on: every computer on the LAN answers the forged source', () => {
    const sim = edge({ directed: true, broadcastEcho: true });
    smurfPing(sim);
    sim.runUntilIdle();
    // a's /25 holds 10.0.0.127 as its broadcast, so only b counts 10.0.0.255 as its own.
    expect(replies(sim)).toEqual(['10.0.0.2>192.0.2.77']);
  });

  it('off: the broadcast arrives and nobody answers', () => {
    const sim = edge({ directed: true });
    smurfPing(sim);
    sim.runUntilIdle();
    expect(icmpSeen(sim)).toHaveLength(1);
    expect(replies(sim)).toEqual([]);
  });
});

describe('a SYN that never gets an answer', () => {
  it('tries three times, waiting longer each time, then gives up with no-answer', () => {
    const sim = edge({ denyOut: 4444 });
    const t0 = sim.t;
    sim.tcpConnect('b', '192.0.2.44', 4444, HELLO);
    sim.runUntilIdle();
    const denied = sim.events.filter((e) => e.type === 'drop' && e.device === 'gw' && e.reason === 'firewall' && e.pkt?.tcp?.flags.syn);
    expect(denied).toHaveLength(SYN_TRIES);
    // Sent at 0 s, 10 s and 30 s (the timeout doubles each time). Each reaches the firewall the same few hops later.
    const at = denied.map((e) => e.t - denied[0].t);
    expect(at).toEqual([0, 10_000, 30_000]);
    const end = sim.events.find((e) => e.type === 'tcp' && e.what === 'no-answer');
    expect(end).toBeDefined();
    expect(end!.t - t0).toBe(70_000);
    expect(sim.tcpSessions[0]).toMatchObject({ state: 'no-answer', tries: SYN_TRIES });
  });
});
