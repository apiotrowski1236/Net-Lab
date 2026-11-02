import { describe, expect, it } from 'vitest';
import { canGrant, grant, newDhcpServer, offer, pickAddress, poolSize } from './dhcp';
import { NetBuilder } from './build';
import type { Sim } from './sim';

describe('DHCP pool helpers', () => {
  it('offers the lowest free address, skipping leased, offered, and used ones', () => {
    const s = newDhcpServer('lan', '192.168.1.10', '192.168.1.13');
    expect(poolSize(s)).toBe(4);
    expect(pickAddress(s, 'aa', new Set())).toBe('192.168.1.10');
    grant(s, { mac: 'aa', ip: '192.168.1.10', name: 'A', t: 0 });
    offer(s, 'bb', '192.168.1.11');
    expect(pickAddress(s, 'cc', new Set(['192.168.1.12']))).toBe('192.168.1.13');
    expect(pickAddress(s, 'dd', new Set(['192.168.1.12', '192.168.1.13']))).toBeUndefined();
  });

  it('gives a MAC back the address it already holds', () => {
    const s = newDhcpServer('lan', '192.168.1.10', '192.168.1.20');
    grant(s, { mac: 'aa', ip: '192.168.1.15', name: 'A', t: 0 });
    expect(pickAddress(s, 'aa', new Set())).toBe('192.168.1.15');
    expect(canGrant(s, 'aa', '192.168.1.15')).toBe(true);
    expect(canGrant(s, 'bb', '192.168.1.15')).toBe(false);
    expect(canGrant(s, 'bb', '192.168.1.99')).toBe(false);
  });

  it('a new lease replaces the old one for the same MAC and clears its offer', () => {
    const s = newDhcpServer('lan', '192.168.1.10', '192.168.1.20');
    offer(s, 'aa', '192.168.1.12');
    grant(s, { mac: 'aa', ip: '192.168.1.12', name: 'A', t: 0 });
    grant(s, { mac: 'aa', ip: '192.168.1.13', name: 'A', t: 5 });
    expect(s.leases).toEqual([{ mac: 'aa', ip: '192.168.1.13', name: 'A', t: 5 }]);
    expect(s.offered).toEqual([]);
  });
});

/** A router handing out .10 to .20 on its LAN port, a switch, two computers set to DHCP, and one with a fixed address. */
function lan(opts: { fixed?: string } = {}): Sim {
  const net = new NetBuilder({ linkMs: 100, procMs: 20, l2Ms: 10 })
    .router('r', { label: 'Router', x: 0, y: 0, ifaces: [{ id: 'lan', ip: '192.168.1.1/24' }], dhcp: { iface: 'lan', from: '192.168.1.10', to: '192.168.1.20' } })
    .switch('sw', { label: 'Switch', x: 0, y: 0, ports: 4 })
    .host('a', { label: 'Laptop', x: 0, y: 0, dhcp: true })
    .host('b', { label: 'Phone', x: 0, y: 0, dhcp: true })
    .link(['r', 'lan'], 'sw');
  if (opts.fixed) net.host('c', { label: 'Server', x: 0, y: 0, ip: `${opts.fixed}/24`, gateway: '192.168.1.1' }).link('c', 'sw');
  return net.build();
}

const ipOf = (sim: Sim, id: string) => sim.dev(id).ifaces[0].ip;

describe('DHCP in the simulator', () => {
  it('a device that plugs in gets the next address, its prefix, and the gateway, in four messages', () => {
    const sim = lan();
    sim.connect({ device: 'a' }, { device: 'sw' });
    sim.runUntilIdle();
    expect(ipOf(sim, 'a')).toBe('192.168.1.10');
    expect(sim.dev('a').ifaces[0].prefix).toBe(24);
    expect(sim.dev('a').gateway).toBe('192.168.1.1');
    const msgs = sim.events.flatMap((e) => (e.type === 'dhcp' ? [`${e.device}:${e.what}:${e.client}:${e.ip ?? ''}`] : []));
    expect(msgs).toEqual(['a:discover:a:', 'r:offer:a:192.168.1.10', 'a:request:a:192.168.1.10', 'r:ack:a:192.168.1.10']);
    expect(sim.dev('r').logs.map((l) => l.msg)).toEqual([
      `DHCPDISCOVER(lan) ${sim.macOf('a')}`,
      `DHCPOFFER(lan) 192.168.1.10 ${sim.macOf('a')}`,
      `DHCPREQUEST(lan) 192.168.1.10 ${sim.macOf('a')}`,
      `DHCPACK(lan) 192.168.1.10 ${sim.macOf('a')} Laptop`,
    ]);
    expect(sim.dhcpLeases('r')).toEqual([expect.objectContaining({ mac: sim.macOf('a'), ip: '192.168.1.10', name: 'Laptop' })]);

    sim.connect({ device: 'b' }, { device: 'sw' });
    sim.runUntilIdle();
    expect(ipOf(sim, 'b')).toBe('192.168.1.11');
  });

  it('a device that rejoins gets the same address back, and loses it while unplugged', () => {
    const sim = lan();
    sim.connect({ device: 'b' }, { device: 'sw' });
    sim.connect({ device: 'a' }, { device: 'sw' });
    sim.runUntilIdle();
    const mine = ipOf(sim, 'a');
    sim.disconnect('a', 'eth0');
    expect(ipOf(sim, 'a')).toBeUndefined();
    expect(sim.dev('a').gateway).toBeUndefined();
    sim.connect({ device: 'a' }, { device: 'sw' });
    sim.runUntilIdle();
    expect(ipOf(sim, 'a')).toBe(mine);
  });

  it('two devices asking at once get different addresses', () => {
    const sim = lan();
    sim.connect({ device: 'a' }, { device: 'sw' });
    sim.connect({ device: 'b' }, { device: 'sw' });
    sim.runUntilIdle();
    expect([ipOf(sim, 'a'), ipOf(sim, 'b')]).toEqual(['192.168.1.10', '192.168.1.11']);
  });

  it('skips an address a device already uses', () => {
    const sim = lan({ fixed: '192.168.1.10' });
    sim.connect({ device: 'a' }, { device: 'sw' });
    sim.runUntilIdle();
    expect(ipOf(sim, 'a')).toBe('192.168.1.11');
  });

  it('during a lesson setup (quiet), a device gets its address at once, with no messages', () => {
    const sim = lan();
    sim.quiet = true;
    sim.connect({ device: 'a' }, { device: 'sw' });
    sim.quiet = false;
    expect(ipOf(sim, 'a')).toBe('192.168.1.10');
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'dhcp')).toBe(false);
  });

  it('a Wi-Fi client asks when it joins and drops its address when it leaves', () => {
    const sim = new NetBuilder({ linkMs: 100, procMs: 20, l2Ms: 10 })
      .router('r', { label: 'Router', x: 0, y: 0, ifaces: [{ id: 'lan', ip: '192.168.1.1/24' }], dhcp: { iface: 'lan', from: '192.168.1.10', to: '192.168.1.20' } })
      .switch('ap', {
        label: 'Wi-Fi',
        x: 100,
        y: 100,
        ports: 1,
        wifi: { ssid: 'Home', bssid: '02:aa:00:00:00:01', security: 'wpa2', passphrase: 'correct-horse', wps: false, auth: 'psk', beacon: true, power: 2, channel: 6 },
      })
      .host('a', { label: 'Laptop', x: 150, y: 150, dhcp: true, wifiClient: { ssid: '' } })
      .link(['r', 'lan'], ['ap', 'p1'])
      .build();
    sim.setWifiClient('a', 'Home', 'correct-horse');
    sim.runUntilIdle();
    expect(ipOf(sim, 'a')).toBe('192.168.1.10');
    sim.setWifiClient('a', '');
    expect(ipOf(sim, 'a')).toBeUndefined();
  });

  it('a network built with DHCP clients already plugged in starts with their addresses', () => {
    const sim = new NetBuilder()
      .router('r', { label: 'Router', x: 0, y: 0, ifaces: [{ id: 'lan', ip: '10.0.0.1/24' }], dhcp: { iface: 'lan', from: '10.0.0.100', to: '10.0.0.110' } })
      .switch('sw', { label: 'Switch', x: 0, y: 0 })
      .host('a', { label: 'A', x: 0, y: 0, dhcp: true })
      .link(['r', 'lan'], 'sw')
      .link('a', 'sw')
      .build();
    expect(ipOf(sim, 'a')).toBe('10.0.0.100');
    expect(sim.events).toEqual([]);
  });
});
