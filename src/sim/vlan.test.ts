import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import { segmentIfaces } from '../runtime/toolInput';
import { sameVlan, vlanOf } from './vlan';
import type { SimEvent } from './types';

/** a and b on p1-p2 (VLAN 10 once set), c and d on p3-p4 (VLAN 30). All on one subnet. */
function ship() {
  const sim = new NetBuilder()
    .switch('sw', { label: 'Switch', x: 300, y: 300, ports: 6 })
    .host('a', { label: 'A', x: 100, y: 100, ip: '10.0.0.1/24' })
    .host('b', { label: 'B', x: 200, y: 100, ip: '10.0.0.2/24' })
    .host('c', { label: 'C', x: 300, y: 100, ip: '10.0.0.3/24' })
    .host('d', { label: 'D', x: 400, y: 100, ip: '10.0.0.4/24' })
    .link('a', ['sw', 'p1'])
    .link('b', ['sw', 'p2'])
    .link('c', ['sw', 'p3'])
    .link('d', ['sw', 'p4'])
    .build();
  sim.configureSwitch('sw');
  return sim;
}

const heard = (events: SimEvent[], device: string) => events.some((e) => (e.type === 'ignored' || e.type === 'arp-update' || e.type === 'captured') && e.device === device);

describe('VLANs', () => {
  it('starts every port in VLAN 1', () => {
    const sim = ship();
    expect(vlanOf(sim.dev('sw'), 'p1')).toBe(1);
    expect(sameVlan(sim.dev('sw'), 'p1', 'p4')).toBe(true);
  });

  it('keeps a broadcast inside its VLAN', () => {
    const sim = ship();
    for (const p of ['p1', 'p2']) sim.setVlan('sw', p, 10);
    for (const p of ['p3', 'p4']) sim.setVlan('sw', p, 30);
    sim.events = [];
    sim.ping('c', '10.0.0.1');
    sim.runUntilIdle();
    // The ARP request reaches d (same VLAN) and nobody in VLAN 10.
    expect(sim.events.some((e) => e.type === 'drop' && e.reason === 'arp-timeout' && e.device === 'c')).toBe(true);
    expect(heard(sim.events, 'a')).toBe(false);
    expect(heard(sim.events, 'b')).toBe(false);
    expect(sim.events.some((e) => e.type === 'ping-reply')).toBe(false);
    sim.ping('c', '10.0.0.4');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'c' && e.from === '10.0.0.4')).toBe(true);
  });

  it('does not deliver unicast to a MAC learned in another VLAN', () => {
    const sim = ship();
    sim.prewarmArp(['a', 'b', 'c', 'd']);
    sim.prelearnSwitch('sw');
    sim.setVlan('sw', 'p1', 10);
    sim.setVlan('sw', 'p2', 10);
    sim.setVlan('sw', 'p3', 30);
    sim.setVlan('sw', 'p4', 30);
    // a speaks, so the switch knows a's MAC is on p1 (VLAN 10).
    sim.ping('a', '10.0.0.2');
    sim.runUntilIdle();
    sim.events = [];
    // c still has a's MAC cached, so it sends straight to it.
    sim.ping('c', '10.0.0.1');
    sim.runUntilIdle();
    expect(heard(sim.events, 'a')).toBe(false);
    expect(sim.events.some((e) => e.type === 'ping-reply')).toBe(false);
  });

  it('flushes the MAC entries of a port that changes VLAN', () => {
    const sim = ship();
    sim.prelearnSwitch('sw');
    const sw = sim.dev('sw');
    expect(Object.values(sw.macTable)).toContain('p3');
    sim.events = [];
    sim.setVlan('sw', 'p3', 30);
    expect(Object.values(sw.macTable)).not.toContain('p3');
    expect(Object.values(sw.macTable)).toContain('p1');
    expect(sim.events).toContainEqual(expect.objectContaining({ type: 'config', device: 'sw', what: 'vlan', detail: 'p3=30' }));
    sim.setVlan('sw', 'p3', 1);
    expect(sw.switchSec!.ports.p3.vlan).toBeUndefined();
  });

  it('still drops everything on a shut port', () => {
    const sim = ship();
    sim.setVlan('sw', 'p1', 10);
    sim.setVlan('sw', 'p2', 10);
    sim.setPortShutdown('sw', 'p2', true);
    sim.ping('a', '10.0.0.2');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply')).toBe(false);
  });

  it('needs switch security first, and a real VLAN number', () => {
    const sim = new NetBuilder().switch('sw', { label: 'S', x: 0, y: 0, ports: 2 }).build();
    expect(() => sim.setVlan('sw', 'p1', 10)).toThrow(/configureSwitch/);
    const s2 = ship();
    expect(() => s2.setVlan('sw', 'p1', 0)).toThrow();
    expect(() => s2.setVlan('sw', 'p9', 10)).toThrow();
  });

  it('makes the local-network check follow VLANs', () => {
    const sim = ship();
    sim.setVlan('sw', 'p1', 10);
    sim.setVlan('sw', 'p3', 30);
    sim.setVlan('sw', 'p4', 30);
    const ids = segmentIfaces(sim, 'c', 'eth0').map((n) => n.dev.id);
    expect(ids).toEqual(['d']);
  });
});
