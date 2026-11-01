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
  // Wi-Fi (wireless lab). The device is the access point unless noted.
  | { type: 'wifi-security'; device: string; security: 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3'; passphrase?: string }
  | { type: 'wifi-passphrase'; device: string; passphrase: string }
  | { type: 'wifi-power'; device: string; power: 1 | 2 | 3 | 4 }
  | { type: 'wifi-beacon'; device: string; on: boolean }
  | { type: 'wifi-wps'; device: string; on: boolean }
  | { type: 'wifi-auth'; device: string; auth: 'psk' | 'eap' }
  | { type: 'wifi-macfilter'; device: string; on: boolean; allow?: string[] }
  | { type: 'wifi-off'; device: string; off: boolean }
  /** Change a device's own MAC address (MAC spoofing). */
  | { type: 'set-mac'; device: string; mac: string }
  /** Attacker tries to recover an access point's key. */
  | { type: 'wifi-crack'; device: string; ap: string }
  /** Jam a channel so nothing can join an access point on it. */
  | { type: 'wifi-jam'; device: string; on: boolean; channel?: number }
  /** Scan the air from a device's position. */
  | { type: 'wifi-scan'; device: string }
  /** Take one signal reading of an access point from a point, for triangulation. */
  | { type: 'wifi-measure'; device: string; bssid: string; x: number; y: number };

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
    case 'wifi-security':
      sim.setWifiSecurity(a.device, a.security, a.passphrase);
      return;
    case 'wifi-passphrase':
      sim.setWifiPassphrase(a.device, a.passphrase);
      return;
    case 'wifi-power':
      sim.setWifiPower(a.device, a.power);
      return;
    case 'wifi-beacon':
      sim.setWifiBeacon(a.device, a.on);
      return;
    case 'wifi-wps':
      sim.setWifiWps(a.device, a.on);
      return;
    case 'wifi-auth':
      sim.setWifiAuth(a.device, a.auth);
      return;
    case 'wifi-macfilter':
      sim.setWifiMacFilter(a.device, a.on, a.allow);
      return;
    case 'wifi-off':
      sim.setWifiOff(a.device, a.off);
      return;
    case 'set-mac':
      sim.setMac(a.device, a.mac);
      return;
    case 'wifi-crack':
      sim.wifiCrack(a.device, a.ap);
      return;
    case 'wifi-jam':
      sim.setWifiJam(a.device, a.on, a.channel);
      return;
    case 'wifi-scan':
      sim.wifiScan(a.device);
      return;
    case 'wifi-measure':
      sim.wifiMeasure(a.device, a.bssid, a.x, a.y);
      return;
  }
}
