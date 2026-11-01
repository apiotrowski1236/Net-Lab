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
  | { type: 'ping'; device: string; ip: string };

export function applyAction(lab: LabDef, sim: Sim, a: SimAction): void {
  switch (a.type) {
    case 'setup':
      lab.steps.find((s) => s.id === a.step)?.setup?.(sim);
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
  }
}
