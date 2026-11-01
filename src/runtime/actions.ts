import type { Sim } from '../sim/sim';
import type { LabDef } from '../labs/types';
import type { FwMode, FwRuleInput } from '../sim/firewall';

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
  /** Port scan from `device`: an address or a network. */
  | { type: 'scan'; device: string; target: string; ports?: number[] }
  /** Connect from `device` to a service. `app` is the program it speaks (default: the port's own). */
  | { type: 'connect'; device: string; to: string; port: number; app?: string }
  /** Put a standalone firewall into the cable between `a` and `b`, its outside port toward `outside`. */
  | { type: 'fw-place'; device: string; a: string; b: string; outside: string }
  | { type: 'fw-unplace'; device: string }
  /** Firewall rules. `at` and `to` are positions counted from 0 (the top). */
  | { type: 'fw-add-rule'; device: string; rule: FwRuleInput; at?: number }
  | { type: 'fw-edit-rule'; device: string; id: string; rule: FwRuleInput }
  | { type: 'fw-delete-rule'; device: string; id: string }
  | { type: 'fw-move-rule'; device: string; id: string; to: number }
  | { type: 'fw-mode'; device: string; mode: FwMode };

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
    case 'scan':
      sim.scan(a.device, a.target, a.ports);
      return;
    case 'connect':
      sim.connectService(a.device, a.to, a.port, { app: a.app });
      return;
    case 'fw-place':
      sim.placeFirewall(a.device, a.a, a.b, a.outside);
      return;
    case 'fw-unplace':
      sim.unplaceFirewall(a.device);
      return;
    case 'fw-add-rule':
      sim.fwAddRule(a.device, a.rule, a.at);
      return;
    case 'fw-edit-rule':
      sim.fwEditRule(a.device, a.id, a.rule);
      return;
    case 'fw-delete-rule':
      sim.fwDeleteRule(a.device, a.id);
      return;
    case 'fw-move-rule':
      sim.fwMoveRule(a.device, a.id, a.to);
      return;
    case 'fw-mode':
      sim.fwSetMode(a.device, a.mode);
      return;
  }
}
