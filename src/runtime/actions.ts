import type { Sim } from '../sim/sim';
import type { LabDef } from '../labs/types';

/**
 * Every change a student makes to the network is one of these. They are
 * saved in order with the simulated time they happened, and replayed to
 * rebuild the exact same network after a reload.
 */
export type SimAction =
  | { type: 'setup'; step: string }
  | { type: 'step-action'; step: string; action: string }
  | { type: 'sniff'; device: string; on: boolean }
  | { type: 'forward'; device: string; on: boolean }
  | { type: 'arp-spoof'; device: string; victim: string; claimIp: string }
  | { type: 'static-arp'; device: string; ip: string; mac: string }
  | { type: 'announce'; device: string; prefix: string }
  | { type: 'withdraw'; device: string; prefix: string }
  | { type: 'validate'; device: string; on: boolean }
  | { type: 'browse'; device: string; url: string; body?: string }
  | { type: 'ping'; device: string; ip: string }
  /** Plug a cable in. A missing port means the device's first free port. */
  | { type: 'cable'; a: string; aPort?: string; b: string; bPort?: string }
  | { type: 'unplug'; device: string; iface: string }
  /** Set a port's address ("192.168.10.11/24"), or remove it with null. */
  | { type: 'set-ip'; device: string; iface: string; cidr: string | null }
  | { type: 'gateway'; device: string; ip: string | null }
  | { type: 'add-route'; device: string; prefix: string; via: string }
  | { type: 'remove-route'; device: string; prefix: string }
  /** DNS cache poisoning: `device` (the attacker) forges answers for `name` pointing at `ip`, aimed at `resolver`. */
  | { type: 'dns-forge'; device: string; resolver: string; name: string; ip: string }
  /** Turn a resolver's defense (random query IDs and source ports) on or off. */
  | { type: 'resolver-harden'; device: string; on: boolean }
  /** Empty a resolver's cache. */
  | { type: 'dns-flush'; device: string };

export function applyAction(lab: LabDef, sim: Sim, a: SimAction): void {
  switch (a.type) {
    case 'setup':
      sim.quiet = true;
      try {
        lab.steps.find((s) => s.id === a.step)?.setup?.(sim);
      } finally {
        sim.quiet = false;
      }
      return;
    case 'step-action':
      lab.steps.find((s) => s.id === a.step)?.actions?.find((x) => x.id === a.action)?.run(sim);
      return;
    case 'sniff':
      sim.setSniffing(a.device, a.on);
      return;
    case 'forward':
      sim.setForwarding(a.device, a.on);
      return;
    case 'arp-spoof':
      sim.arpSpoof(a.device, a.victim, a.claimIp);
      return;
    case 'static-arp':
      sim.setStaticArp(a.device, a.ip, a.mac);
      return;
    case 'announce':
      sim.announce(a.device, a.prefix);
      return;
    case 'withdraw':
      sim.withdraw(a.device, a.prefix);
      return;
    case 'validate':
      sim.setValidation(a.device, a.on);
      return;
    case 'browse':
      sim.browse(a.device, a.url, a.body);
      return;
    case 'ping':
      sim.ping(a.device, a.ip);
      return;
    case 'cable':
      sim.connect({ device: a.a, iface: a.aPort }, { device: a.b, iface: a.bPort });
      return;
    case 'unplug':
      sim.disconnect(a.device, a.iface);
      return;
    case 'set-ip': {
      const [ip, len] = a.cidr ? a.cidr.split('/') : [null, '24'];
      sim.setIp(a.device, a.iface, ip, Number(len));
      return;
    }
    case 'gateway':
      sim.setGateway(a.device, a.ip);
      return;
    case 'add-route':
      sim.addRoute(a.device, a.prefix, a.via);
      return;
    case 'remove-route':
      sim.removeRoute(a.device, a.prefix);
      return;
    case 'dns-forge':
      sim.forgeDnsAnswer(a.device, a.resolver, a.name, a.ip);
      return;
    case 'resolver-harden':
      sim.setResolverHardened(a.device, a.on);
      return;
    case 'dns-flush':
      sim.flushResolverCache(a.device);
      return;
  }
}
