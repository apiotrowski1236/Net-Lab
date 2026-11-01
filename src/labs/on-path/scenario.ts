import { NetBuilder } from '../../sim/build';
import type { Sim } from '../../sim/sim';

// Riverside Café: Alice, Sam, and Mallory share the café Wi-Fi.
export const MAC = {
  alice: '0a:11:ce:00:00:10',
  sam: '0c:5a:30:00:00:23',
  mallory: '0e:ba:d0:00:00:66',
  router: '0c:af:e0:00:00:01',
};

export const IP = {
  alice: '192.168.1.10',
  sam: '192.168.1.23',
  mallory: '192.168.1.66',
  router: '192.168.1.1',
  bank: '203.0.113.10',
};

export const PASSWORD = 'pumpkinspice';
export const LOGIN_BODY = `user=alice&pass=${PASSWORD}`;

export function buildCafe(): Sim {
  const net = new NetBuilder({ linkMs: 850, httpTimeoutMs: 12000 })
    .host('alice', {
      label: 'Alice',
      sublabel: IP.alice,
      icon: 'laptop',
      x: 150,
      y: 130,
      ip: `${IP.alice}/24`,
      gateway: IP.router,
      mac: MAC.alice,
    })
    .host('sam', {
      label: 'Sam',
      sublabel: IP.sam,
      icon: 'phone',
      x: 150,
      y: 470,
      ip: `${IP.sam}/24`,
      gateway: IP.router,
      mac: MAC.sam,
    })
    .host('mallory', {
      label: 'Mallory',
      sublabel: IP.mallory,
      icon: 'attacker',
      x: 400,
      y: 500,
      ip: `${IP.mallory}/24`,
      gateway: IP.router,
      mac: MAC.mallory,
      attacker: true,
    })
    .hub('wifi', { label: 'Café Wi-Fi', sublabel: 'open · no password', icon: 'wifi', x: 360, y: 300 })
    .router('router', {
      label: 'Café router',
      sublabel: IP.router,
      icon: 'router',
      x: 580,
      y: 300,
      ifaces: [
        { id: 'lan', ip: `${IP.router}/24`, mac: MAC.router },
        { id: 'wan', ip: '100.64.0.2/30' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '100.64.0.1', iface: 'wan' }],
    })
    .router('internet', {
      label: 'The Internet',
      icon: 'cloud',
      x: 760,
      y: 300,
      ifaces: [
        { id: 'cafe', ip: '100.64.0.1/30' },
        { id: 'bank', ip: '203.0.113.1/24' },
      ],
      routes: [{ prefix: '192.168.1.0/24', via: '100.64.0.2', iface: 'cafe' }],
    })
    .host('bank', {
      label: 'bank.example',
      sublabel: IP.bank,
      icon: 'server',
      x: 910,
      y: 300,
      ip: `${IP.bank}/24`,
      gateway: '203.0.113.1',
      web: { name: 'bank.example', title: 'Bank of Example', https: true },
    })
    .link('alice', 'wifi', { wireless: true })
    .link('sam', 'wifi', { wireless: true })
    .link('mallory', 'wifi', { wireless: true })
    .link(['router', 'lan'], 'wifi')
    .link(['router', 'wan'], ['internet', 'cafe'])
    .link(['internet', 'bank'], 'bank')
    .hostsFile({ 'bank.example': IP.bank });
  const sim = net.build();
  // The café has been open all morning: everyone except Alice (who just sat down) already knows their neighbors.
  sim.prewarmArp(['router', 'internet', 'bank', 'mallory', 'sam']);
  return sim;
}

/** Switch the café Wi-Fi to WPA2: each device only receives its own traffic (plus broadcasts). */
export function enableWpa2(sim: Sim): void {
  if (sim.dev('wifi').kind === 'switch') return;
  sim.setL2Kind('wifi', 'switch', { sublabel: 'WPA2 · password on the chalkboard' });
  sim.prelearnSwitch('wifi');
}
