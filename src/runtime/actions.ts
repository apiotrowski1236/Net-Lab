import type { Sim } from '../sim/sim';
import type { LabDef } from '../labs/types';
import type { PortSecurityConfig } from '../sim/switchsec';
import type { FwMode, FwRuleInput } from '../sim/firewall';
import type { ZoneLevel } from '../sim/zones';
import type { PolicyValue } from '../sim/zonePolicy';
import type { RiskLevel } from '../sim/audit';
import type { HardenSetting } from '../sim/hardening';
import type { VpnAuth } from '../sim/vpn';
import type { Tolerance, TriageAction, Verdict } from '../sim/ids';

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
  /** Echo (smurf): send a ping, optionally with a forged `source` so the reply lands there. */
  | { type: 'echo'; device: string; target: string; source?: string }
  /** Turn a router's directed-broadcast forwarding on or off (the smurf fix at the amplifier). */
  | { type: 'directed-broadcast'; device: string; on: boolean }
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
  | { type: 'dns-flush'; device: string }
  // Switch security (mac-flood)
  /** Send `bursts` bursts of 20 frames, each from a made-up MAC. */
  | { type: 'mac-flood'; device: string; bursts: number }
  /** Change a device's MAC, or put back its factory MAC with null. */
  | { type: 'set-mac'; device: string; mac: string | null }
  /** Port security on a switch port, or null to turn it off. */
  | { type: 'port-security'; device: string; port: string; config: PortSecurityConfig | null }
  | { type: 'port-shutdown'; device: string; port: string; shut: boolean }
  // Wi-Fi (wireless lab). The device is the access point unless noted.
  | { type: 'wifi-security'; device: string; security: 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3'; passphrase?: string }
  | { type: 'wifi-passphrase'; device: string; passphrase: string }
  | { type: 'wifi-power'; device: string; power: 1 | 2 | 3 | 4 }
  | { type: 'wifi-beacon'; device: string; on: boolean }
  | { type: 'wifi-wps'; device: string; on: boolean }
  | { type: 'wifi-auth'; device: string; auth: 'psk' | 'eap' }
  | { type: 'wifi-macfilter'; device: string; on: boolean; allow?: string[] }
  | { type: 'wifi-off'; device: string; off: boolean }
  /** Attacker tries to recover an access point's key. */
  | { type: 'wifi-crack'; device: string; ap: string }
  /** Jam a channel so nothing can join an access point on it. */
  | { type: 'wifi-jam'; device: string; on: boolean; channel?: number }
  /** Scan the air from a device's position. */
  | { type: 'wifi-scan'; device: string }
  /** Take one signal reading of an access point from a point, for triangulation. */
  | { type: 'wifi-measure'; device: string; bssid: string; x: number; y: number }
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
  | { type: 'fw-mode'; device: string; mode: FwMode }
  // Segmentation
  /** Put a switch port in a VLAN (1 is the default). */
  | { type: 'set-vlan'; device: string; iface: string; vlan: number }
  /** Zone plan: put a device in a zone, or take it out with null. */
  | { type: 'set-zone'; device: string; zone: string | null }
  /** Zone plan: how closely a zone is guarded, or null to clear it. */
  | { type: 'set-zone-level'; zone: string; level: ZoneLevel | null }
  /** One cell of a firewall's zone policy: what `from` may start toward `to`. */
  | { type: 'set-zone-policy'; device: string; from: string; to: string; value: PolicyValue }
  // Network audit (net-audit)
  /** Run the vulnerability scanner on `device` (the auditor). */
  | { type: 'audit-scan'; device: string }
  /** Rate a finding in the auditor's risk register. A part left out keeps its value. */
  | { type: 'rate-risk'; device: string; finding: string; likelihood?: RiskLevel; impact?: RiskLevel }
  /** Turn a management setting on a router or switch on or off: Telnet, SSH, or logins through the authentication server. */
  | { type: 'harden'; device: string; setting: HardenSetting; on: boolean }
  /** Change a VPN server's policy. */
  | { type: 'vpn-config'; device: string; splitTunneling?: boolean; auth?: VpnAuth }
  /** Detection on an IDS sensor (logs lab): the signature set, anomaly detection and its tolerance, prevention (IPS) mode. */
  | { type: 'ids-signatures'; device: string; on: boolean }
  | { type: 'ids-anomaly'; device: string; on: boolean; tolerance: Tolerance }
  | { type: 'ids-prevention'; device: string; on: boolean }
  /** An analyst's call on a SIEM incident. */
  | { type: 'siem-triage'; device: string; incident: number; verdict: Verdict; action: TriageAction }
  /** The AI model's alert threshold on a SIEM, 0 to 1. */
  | { type: 'ai-threshold'; device: string; value: number };

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
    case 'echo':
      sim.echo(a.device, a.target, { source: a.source });
      return;
    case 'directed-broadcast':
      sim.setDirectedBroadcast(a.device, a.on);
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
    case 'mac-flood':
      sim.macFlood(a.device, a.bursts);
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
    case 'port-security':
      sim.setPortSecurity(a.device, a.port, a.config);
      return;
    case 'port-shutdown':
      sim.setPortShutdown(a.device, a.port, a.shut);
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
    case 'set-vlan':
      sim.setVlan(a.device, a.iface, a.vlan);
      return;
    case 'set-zone':
      sim.setZone(a.device, a.zone);
      return;
    case 'set-zone-level':
      sim.setZoneLevel(a.zone, a.level);
      return;
    case 'set-zone-policy':
      sim.setZonePolicy(a.device, a.from, a.to, a.value);
      return;
    case 'audit-scan':
      sim.auditScan(a.device);
      return;
    case 'rate-risk':
      sim.rateRisk(a.device, a.finding, a.likelihood, a.impact);
      return;
    case 'harden':
      sim.setHardening(a.device, a.setting, a.on);
      return;
    case 'vpn-config':
      sim.setVpn(a.device, { splitTunneling: a.splitTunneling, auth: a.auth });
      return;
    case 'ids-signatures':
      sim.idsSetSignatures(a.device, a.on);
      return;
    case 'ids-anomaly':
      sim.idsSetAnomaly(a.device, a.on, a.tolerance);
      return;
    case 'ids-prevention':
      sim.idsSetPrevention(a.device, a.on);
      return;
    case 'siem-triage':
      sim.siemTriage(a.device, a.incident, a.verdict, a.action);
      return;
    case 'ai-threshold':
      sim.aiSetThreshold(a.device, a.value);
      return;
  }
}
