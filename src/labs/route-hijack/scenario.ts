import { NetBuilder } from '../../sim/build';
import type { Sim } from '../../sim/sim';
import type { WebSite } from '../../sim/types';

export const BANK_PREFIX = '203.0.113.0/24';
export const BANK_IP = '203.0.113.10';
export const MORE_SPECIFIC = '203.0.113.0/25';
export const LOGIN_BODY = 'user=alice&pass=correcthorse';

export const FAKE_BANK: WebSite = { name: 'bank.example', title: 'Bank of Example', https: true, fake: true };

export const AS = { home: 100, west: 200, east: 300, bankhost: 400, shady: 666 };

export function buildInternet(): Sim {
  const net = new NetBuilder({ linkMs: 520, procMs: 120, httpTimeoutMs: 20000, autoArp: true })
    .host('alice', {
      label: 'Alice',
      sublabel: '192.0.2.10',
      icon: 'laptop',
      x: 70,
      y: 300,
      ip: '192.0.2.10/24',
      gateway: '192.0.2.1',
    })
    .router('home', {
      label: 'HomeNet ISP',
      sublabel: 'AS100',
      icon: 'isp',
      x: 210,
      y: 300,
      asn: AS.home,
      origins: ['192.0.2.0/24'],
      ifaces: [
        { id: 'lan', ip: '192.0.2.1/24' },
        { id: 'west', ip: '10.0.12.1/30' },
      ],
    })
    .router('west', {
      label: 'Transit West',
      sublabel: 'AS200',
      icon: 'isp',
      x: 400,
      y: 170,
      asn: AS.west,
      ifaces: [
        { id: 'home', ip: '10.0.12.2/30' },
        { id: 'east', ip: '10.0.23.1/30' },
        { id: 'shady', ip: '10.0.26.1/30' },
      ],
    })
    .router('east', {
      label: 'Transit East',
      sublabel: 'AS300',
      icon: 'isp',
      x: 620,
      y: 170,
      asn: AS.east,
      ifaces: [
        { id: 'west', ip: '10.0.23.2/30' },
        { id: 'bankhost', ip: '10.0.34.1/30' },
      ],
    })
    .router('bankhost', {
      label: 'BankHost',
      sublabel: 'AS400',
      icon: 'isp',
      x: 790,
      y: 300,
      asn: AS.bankhost,
      origins: [BANK_PREFIX],
      ifaces: [
        { id: 'east', ip: '10.0.34.2/30' },
        { id: 'lan', ip: '203.0.113.1/24' },
      ],
    })
    .host('bank', {
      label: 'bank.example',
      sublabel: BANK_IP,
      icon: 'server',
      x: 930,
      y: 300,
      ip: `${BANK_IP}/24`,
      gateway: '203.0.113.1',
      web: { name: 'bank.example', title: 'Bank of Example', https: true },
    })
    .router('shady', {
      label: 'Shady Net',
      sublabel: 'AS666',
      icon: 'attacker',
      x: 520,
      y: 460,
      asn: AS.shady,
      origins: ['198.51.100.0/24'],
      attacker: true,
      ifaces: [
        { id: 'west', ip: '10.0.26.2/30' },
        { id: 'lan', ip: '198.51.100.1/24' },
      ],
    })
    .link('alice', ['home', 'lan'])
    .link(['home', 'west'], ['west', 'home'])
    .link(['west', 'east'], ['east', 'west'])
    .link(['east', 'bankhost'], ['bankhost', 'east'])
    .link(['bankhost', 'lan'], 'bank')
    .link(['west', 'shady'], ['shady', 'west'])
    .roa(BANK_PREFIX, AS.bankhost)
    .roa('192.0.2.0/24', AS.home)
    .roa('198.51.100.0/24', AS.shady)
    .hostsFile({ 'bank.example': BANK_IP });
  return net.build();
}

/** Re-send one prefix's announcements from scratch so students can watch them spread. */
export function replayAnnouncements(sim: Sim, prefix: string, origin: string): void {
  for (const d of Object.values(sim.devices)) {
    if (!d.bgp) continue;
    for (const nb of Object.keys(d.bgp.sentTo)) delete d.bgp.sentTo[nb][prefix];
  }
  sim.announce(origin, prefix);
}
