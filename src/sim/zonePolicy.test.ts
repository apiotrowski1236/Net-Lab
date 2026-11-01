import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import { cellValue, policyRules, type PolicyZone } from './zonePolicy';
import type { Conn } from './services';

const ZONES: PolicyZone[] = [
  { id: 'a', label: 'Alpha', port: 'p1', net: '10.0.1.0/24', services: [{ port: 5001, name: 'data' }] },
  { id: 'b', label: 'Bravo', port: 'p2', net: '10.0.2.0/24', services: [] },
];

/** A router with a zone policy between two subnets, and an outside network. */
function net() {
  const sim = new NetBuilder({ linkMs: 100, procMs: 10, l2Ms: 10 })
    .host('a1', { label: 'A1', x: 100, y: 100, ip: '10.0.1.10/24', gateway: '10.0.1.1', services: [{ port: 445, proto: 'tcp', app: 'smb' }] })
    .host('b1', {
      label: 'B1',
      x: 300,
      y: 100,
      ip: '10.0.2.10/24',
      gateway: '10.0.2.1',
      services: [
        { port: 445, proto: 'tcp', app: 'smb' },
        { port: 5001, proto: 'tcp', app: 'data' },
      ],
    })
    .host('out', { label: 'Out', x: 500, y: 100, ip: '198.51.100.2/24', gateway: '198.51.100.1', services: [{ port: 80, proto: 'tcp', app: 'http' }] })
    .router('fw', {
      label: 'FW',
      x: 300,
      y: 300,
      ifaces: [
        { id: 'p1', ip: '10.0.1.1/24' },
        { id: 'p2', ip: '10.0.2.1/24' },
        { id: 'p4', ip: '198.51.100.1/24' },
      ],
      firewall: { outside: 'p4', mode: 'stateful' },
    })
    .link('a1', ['fw', 'p1'])
    .link('b1', ['fw', 'p2'])
    .link('out', ['fw', 'p4'])
    .build();
  sim.setupZonePolicy('fw', ZONES, { label: 'Outside', port: 'p4', net: '198.51.100.0/24' });
  return sim;
}

const result = (sim: ReturnType<typeof net>, dev: string, id: number): Conn => sim.dev(dev).conns!.find((c) => c.id === id)!;

describe('zone policy', () => {
  it('starts as Allow all and writes the firewall rules', () => {
    const sim = net();
    const zp = sim.dev('fw').zonePolicy!;
    expect(cellValue(zp, 'a', 'b')).toBe('allow');
    expect(sim.dev('fw').firewall!.rules.map((r) => `${r.action} ${r.note}`)).toEqual([
      'allow Alpha to Bravo',
      'allow Bravo to Alpha',
      'deny Outside to inside',
      'allow Inside to Outside',
    ]);
    const id = sim.connectService('a1', '10.0.2.10', 445);
    sim.runUntilIdle();
    expect(result(sim, 'a1', id).status).toBe('open');
  });

  it('allows only the chosen port, and logs denies with the pair', () => {
    const sim = net();
    sim.setZonePolicy('fw', 'a', 'b', 'only:5001');
    expect(policyRules(sim.dev('fw').zonePolicy!).filter((r) => r.from === 'a')).toHaveLength(2);
    const ok = sim.connectService('a1', '10.0.2.10', 5001);
    const no = sim.connectService('a1', '10.0.2.10', 445);
    sim.runUntilIdle();
    expect(result(sim, 'a1', ok).status).toBe('open');
    expect(result(sim, 'a1', no)).toMatchObject({ status: 'no-answer', reason: 'firewall', at: 'fw' });
    const deny = sim.dev('fw').logs.find((l) => l.fields?.action === 'deny');
    expect(deny?.fields).toMatchObject({ rule: 'Alpha to Bravo', dport: 445, src: '10.0.1.10' });
    expect(deny?.msg).toContain('zone Alpha -> Bravo');
  });

  it('lets replies back and keeps the outside out', () => {
    const sim = net();
    sim.setZonePolicy('fw', 'b', 'a', 'deny');
    // a1 starts it, so b1's reply is allowed even though Bravo to Alpha is Deny.
    const there = sim.connectService('a1', '10.0.2.10', 445);
    const back = sim.connectService('b1', '10.0.1.10', 445);
    const inbound = sim.connectService('out', '10.0.1.10', 445);
    const outbound = sim.connectService('a1', '198.51.100.2', 80);
    sim.runUntilIdle();
    expect(result(sim, 'a1', there).status).toBe('open');
    expect(result(sim, 'b1', back).status).toBe('no-answer');
    expect(result(sim, 'out', inbound).status).toBe('no-answer');
    expect(result(sim, 'a1', outbound).status).toBe('open');
  });

  it('rejects cells that do not exist', () => {
    const sim = net();
    expect(() => sim.setZonePolicy('fw', 'a', 'a', 'deny')).toThrow();
    expect(() => sim.setZonePolicy('fw', 'a', 'z', 'deny')).toThrow();
  });
});
