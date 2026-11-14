import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import { CAPFILE_TIMING, conversationStats, endpointStats, followStream, ioGraph, loadCaptureFile, parsePacketList, statsFilter, type CaptureFileDef } from './capfile';
import { matchFilter, parseFilter } from './displayFilter';

const DEF: CaptureFileDef = {
  id: 'test',
  name: 'test.pcap',
  record: () => {
    const sim = new NetBuilder(CAPFILE_TIMING)
      .host('a', { label: 'A', x: 0, y: 0, ip: '10.0.0.1/24' })
      .host('b', { label: 'B', x: 0, y: 0, ip: '10.0.0.2/24', services: [{ port: 80, proto: 'tcp', app: 'http' }] })
      .host('m', { label: 'M', x: 0, y: 0, ip: '10.0.0.9/24' })
      .host('tap', { label: 'Tap', x: 0, y: 0 })
      .switch('sw', { label: 'SW', x: 0, y: 0, ports: 4, mirror: 'p4' })
      .link('a', ['sw', 'p1'])
      .link('b', ['sw', 'p2'])
      .link('m', ['sw', 'p3'])
      .link('tap', ['sw', 'p4'])
      .build();
    sim.prewarmArp(['a', 'b', 'm']);
    sim.setSniffing('tap', true);
    const hello = { app: 'http', lines: [{ from: 'client' as const, text: 'GET /\nHost: b' }, { from: 'server' as const, text: 'HTTP/1.1 200 OK' }, { from: 'server' as const, len: 1000, count: 2 }] };
    sim.schedule(100, () => sim.tcpConnect('a', '10.0.0.2', 80, hello));
    sim.schedule(1500, () => sim.tcpConnect('a', '10.0.0.2', 80, hello));
    sim.schedule(2500, () => sim.macFlood('m', 1, 50, 10));
    return { sim, device: 'tap', ms: 4000, burstGapMs: 2 };
  },
};

describe('capture files', () => {
  const f = loadCaptureFile(DEF);

  it('numbers packets from 1 in time order, times from the start of the file', () => {
    expect(f.frames[0].no).toBe(1);
    expect(f.frames[0].t).toBeGreaterThanOrEqual(100);
    expect(f.frames.every((c, i) => c.no === i + 1 && (i === 0 || c.t >= f.frames[i - 1].t))).toBe(true);
    expect(f.frames.every((c) => c.t <= f.ms)).toBe(true);
  });

  it('expands a burst into its frames, each with its own MAC', () => {
    const eth = f.frames.filter((c) => !c.frame.ip && !c.frame.arp);
    expect(eth).toHaveLength(50);
    expect(new Set(eth.map((c) => c.frame.src)).size).toBe(50);
    expect(eth.every((c) => !c.frame.burst)).toBe(true);
    expect(endpointStats(f.frames, 'eth').length).toBeGreaterThanOrEqual(50);
  });

  it('gives each connection its own stream number', () => {
    const streams = new Set(f.frames.filter((c) => c.frame.ip?.tcp).map((c) => c.frame.ip!.tcp!.stream));
    expect([...streams]).toEqual([0, 1]);
  });

  it('follows a stream, joining each side’s run of segments', () => {
    const s = followStream(f, 0)!;
    expect(s.a.ip).toBe('10.0.0.1');
    expect(s.b.port).toBe(80);
    expect(s.parts.map((p) => p.from)).toEqual(['a', 'b', 'b']);
    expect(s.parts[0].text).toBe('GET /\nHost: b');
    expect(s.parts[2].text).toBe('(2,000 bytes of data with no text)');
    expect(followStream(f, 9)).toBeUndefined();
  });

  it('sums endpoints and conversations, and their filters show the same packets', () => {
    const ips = endpointStats(f.frames, 'ip');
    expect(ips.map((r) => r.addr).sort()).toEqual(['10.0.0.1', '10.0.0.2']);
    const conv = conversationStats(f.frames, 'ip')[0];
    expect(conv.packets).toBe(ips[0].packets);
    expect(conv.ports).toBe(2);
    const p = parseFilter(statsFilter('ip', conv.a, conv.b));
    if (!p.ok) throw new Error(p.msg);
    expect(f.frames.filter((c) => matchFilter(p.node, c.frame))).toHaveLength(conv.packets);
  });

  it('counts packets per second, and the filter’s share of them', () => {
    const p = parseFilter('eth && !ip');
    if (!p.ok) throw new Error(p.msg);
    const g = ioGraph(f.frames, f.ms, 1000, p.node);
    expect(g.all).toHaveLength(4);
    expect(g.all.reduce((a, b) => a + b)).toBe(f.frames.length);
    expect(g.match![2]).toBe(50);
  });

  it('reads the packet numbers students type', () => {
    expect(parsePacketList('412, 415')).toEqual({ ok: true, nums: [412, 415] });
    expect(parsePacketList('packets 415 and #412')).toEqual({ ok: true, nums: [412, 415] });
    expect(parsePacketList('10-12; 11')).toEqual({ ok: true, nums: [10, 11, 12] });
    expect(parsePacketList('12 to 10')).toEqual({ ok: true, nums: [10, 11, 12] });
    expect(parsePacketList('No. 7')).toEqual({ ok: true, nums: [7] });
    // A sentence's period, "or", and a slash.
    expect(parsePacketList('412, 415.')).toEqual({ ok: true, nums: [412, 415] });
    expect(parsePacketList('412.')).toEqual({ ok: true, nums: [412] });
    expect(parsePacketList('412 or 415')).toEqual({ ok: true, nums: [412, 415] });
    expect(parsePacketList('412/415')).toEqual({ ok: true, nums: [412, 415] });
    expect(parsePacketList('(412), 415!')).toEqual({ ok: true, nums: [412, 415] });
    expect(parsePacketList('412.5').ok).toBe(false);
    expect(parsePacketList('the first one').ok).toBe(false);
    expect(parsePacketList('').ok).toBe(false);
  });
});
