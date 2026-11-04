import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import { fromReverseName, inScope, networkInScope, parseCommand, reverseName, zoneAnswer } from './terminal';

describe('parseCommand', () => {
  const ok = (line: string) => {
    const r = parseCommand(line);
    if (!r.ok) throw new Error(r.msg);
    return r.parsed;
  };
  const msg = (line: string) => {
    const r = parseCommand(line);
    if (r.ok) throw new Error(`parsed: ${line}`);
    return r.msg;
  };

  it('reads each command and its usual spellings', () => {
    expect(ok('ping 10.0.0.1')).toEqual({ cmd: 'ping', target: '10.0.0.1' });
    expect(ok('PING -c 4 Catalog.Lakeside.Example')).toEqual({ cmd: 'ping', target: 'catalog.lakeside.example' });
    expect(ok('ping -n 4 10.0.0.1')).toEqual({ cmd: 'ping', target: '10.0.0.1' });
    expect(ok('tracert ebooks.example')).toEqual({ cmd: 'traceroute', target: 'ebooks.example' });
    expect(ok('nslookup ebooks.example 10.0.0.1')).toEqual({ cmd: 'nslookup', name: 'ebooks.example', server: '10.0.0.1' });
    expect(ok('netstat -ano')).toEqual({ cmd: 'netstat', all: true, programs: false });
    expect(ok('netstat -b')).toEqual({ cmd: 'netstat', all: false, programs: true });
    expect(ok('nmap 10.0.0.7/24')).toEqual({ cmd: 'nmap', target: '10.0.0.0/24', versions: false, vuln: false });
    expect(ok('nmap -sV --script vuln 10.0.0.0/24')).toEqual({ cmd: 'nmap', target: '10.0.0.0/24', versions: true, vuln: true });
    expect(ok('nmap --script=vuln 10.0.0.20')).toEqual({ cmd: 'nmap', target: '10.0.0.20', versions: true, vuln: true });
    expect(ok('cls')).toEqual({ cmd: 'clear' });
  });

  it('explains mistakes in words a student can act on', () => {
    expect(msg('')).toBe('Type a command, then press Enter.');
    expect(msg('pign 10.0.0.1')).toBe('pign: command not found. Did you mean ping?');
    expect(msg('ping')).toBe('ping needs something to look for. Type it like this: ping <address or name>');
    expect(msg('ping 10.0.0.300')).toBe('An IP address is four numbers from 0 to 255 with dots between them, like 10.0.0.1.');
    expect(msg('ping 10.0.0.1/24')).toBe('ping takes one address, with no slash: ping 10.0.0.1');
    expect(msg('netstat -z')).toBe("This netstat knows -a (also ports waiting for connections) and -b (the program behind each one). It doesn't know -z.");
    expect(msg('nmap -p 22 10.0.0.1')).toBe("This nmap knows -sV (find each service's version) and --script vuln (check for known problems). It doesn't know -p.");
    expect(msg('nmap -sv 10.0.0.0/24')).toBe("nmap's options care about capital letters. Type -sV, with a capital V.");
    expect(msg('nmap -script vuln 10.0.0.0/24')).toBe('Long options start with two dashes: --script vuln');
    expect(msg('nmap 10.0.0.0/33')).toBe("10.0.0.0/33 isn't a network. Write a network like 10.0.0.0/24.");
  });
});

describe('scope and DNS helpers', () => {
  it('checks addresses and networks against the permitted scope', () => {
    expect(inScope(['10.0.0.0/24'], '10.0.0.20')).toBe(true);
    expect(inScope(['10.0.0.0/24'], '10.0.1.20')).toBe(false);
    expect(networkInScope(['10.0.0.0/24'], '10.0.0.0/25')).toBe(true);
    expect(networkInScope(['10.0.0.0/24'], '10.0.0.0/16')).toBe(false);
  });

  it('turns addresses into reverse-lookup names and back', () => {
    expect(reverseName('203.0.113.66')).toBe('66.113.0.203.in-addr.arpa');
    expect(fromReverseName('66.113.0.203.in-addr.arpa')).toBe('203.0.113.66');
    expect(zoneAnswer({ 'a.example': '10.0.0.1' }, '1.0.0.10.in-addr.arpa')).toEqual({ ptr: 'a.example' });
  });
});

/** a -- r1 -- r2 (NAT) -- r3 -- b: a traceroute crosses a NAT router and still sees every hop. */
function chain(icmpErrors = true) {
  return new NetBuilder({ linkMs: 10, procMs: 1, arpTimeoutMs: 200, pingTimeoutMs: 1000, icmpErrors })
    .host('a', { label: 'A', x: 0, y: 0, ip: '10.0.0.5/24', gateway: '10.0.0.1' })
    .router('r1', { label: 'R1', x: 0, y: 0, ifaces: [{ id: 'in', ip: '10.0.0.1/24' }, { id: 'out', ip: '198.51.100.10/24' }], routes: [{ prefix: '0.0.0.0/0', via: '198.51.100.1', iface: 'out' }], nat: { outside: 'out' } })
    .router('r2', { label: 'R2', x: 0, y: 0, ifaces: [{ id: 'in', ip: '198.51.100.1/24' }, { id: 'out', ip: '192.0.2.1/24' }] })
    .host('b', { label: 'B', x: 0, y: 0, ip: '192.0.2.80/24', gateway: '192.0.2.1' })
    .link(['a', 'eth0'], ['r1', 'in'], { ms: 0.1 })
    .link(['r1', 'out'], ['r2', 'in'], { ms: 5 })
    .link(['r2', 'out'], ['b', 'eth0'], { ms: 2 })
    .build();
}

describe('Sim.runCommand', () => {
  it('traceroute lists each router through NAT, then the target', () => {
    const sim = chain();
    sim.runCommand('a', 'traceroute 192.0.2.80');
    sim.runUntilIdle();
    const run = sim.dev('a').term![0];
    if (run.kind !== 'traceroute') throw new Error();
    expect(run.end).toBe('reached');
    expect(run.hops.map((h) => h.from)).toEqual(['10.0.0.1', '198.51.100.1', '192.0.2.80']);
    expect(run.hops[2].last).toBe(true);
    // Round trips grow with each cable's real-world time.
    expect(run.hops[0].ms!).toBeLessThan(1);
    expect(run.hops[2].ms!).toBeGreaterThan(10);
    const done = sim.events.filter((e) => e.type === 'term-done');
    expect(done).toHaveLength(1);
  });

  it('without icmpErrors, routers stay silent and the trace gives up', () => {
    const sim = chain(false);
    sim.runCommand('a', 'traceroute 192.0.2.80');
    sim.runUntilIdle();
    const run = sim.dev('a').term![0];
    if (run.kind !== 'traceroute') throw new Error();
    expect(run.end).toBe('silent');
    expect(run.hops.map((h) => h.status)).toEqual(['timeout', 'timeout']);
  });

  it('ping reports each probe, and an address nobody has is unreachable', () => {
    const sim = chain();
    sim.runCommand('a', 'ping 192.0.2.80');
    sim.runCommand('a', 'ping 10.0.0.99');
    sim.runUntilIdle();
    const [ok, none] = sim.dev('a').term!;
    if (ok.kind !== 'ping' || none.kind !== 'ping') throw new Error();
    expect(ok.probes.map((p) => p.status)).toEqual(['reply', 'reply', 'reply', 'reply']);
    expect(ok.probes[0].ttl).toBe(62);
    expect(none.probes.map((p) => [p.status, p.why, p.from])).toEqual(Array(4).fill(['unreachable', 'host', '10.0.0.5']));
  });

  it('netstat is a snapshot of open connections, gone once the cable is out', () => {
    const sim = chain();
    sim.dev('a').sockets = [{ proto: 'tcp', port: 50000, remote: '192.0.2.80', rport: 443, program: 'browser.exe' }];
    sim.runCommand('a', 'netstat -b');
    sim.disconnect('a', 'eth0');
    sim.runCommand('a', 'netstat -b');
    const [before, after] = sim.dev('a').term!;
    if (before.kind !== 'netstat' || after.kind !== 'netstat') throw new Error();
    expect(before.rows).toEqual([{ proto: 'TCP', local: '10.0.0.5:50000', foreign: '192.0.2.80:443', state: 'ESTABLISHED', program: 'browser.exe' }]);
    expect(after.rows).toEqual([]);
  });

  it('refuses help and clear: they never reach the network', () => {
    const sim = chain();
    expect(() => sim.runCommand('a', 'help')).toThrow('help only changes the screen');
  });
});
