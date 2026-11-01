import { NetBuilder } from '../../sim/build';
import type { Service } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import { vlanOf } from '../../sim/vlan';
import { cellValue, type PolicyValue, type PolicyZone } from '../../sim/zonePolicy';
import { LEVEL_NAME, type ZoneLevel } from '../../sim/zones';
import type { MapZone } from '../types';

// A navy submarine (CED unit 3 scenario C). Three groups of computers share one
// flat network on one switch: weapons, operations, and crew recreation. A core
// firewall leads to the shore link. The student splits the network into zones
// with VLANs, subnets, and a zone policy, and watches a simulated outbreak stop
// at the walls.

export type ZoneId = 'weapons' | 'operations' | 'crew';
export const ZONES: ZoneId[] = ['weapons', 'operations', 'crew'];
export const ZONE_NAME: Record<ZoneId, string> = { weapons: 'Weapons', operations: 'Operations', crew: 'Crew' };

export const INSIDE = ['fire', 'torpedo', 'command', 'nav', 'chart', 'crew1', 'crew2', 'media'];
export const ZONE_OF: Record<string, ZoneId> = {
  fire: 'weapons',
  torpedo: 'weapons',
  command: 'operations',
  nav: 'operations',
  chart: 'operations',
  crew1: 'crew',
  crew2: 'crew',
  media: 'crew',
};
export const VLAN: Record<ZoneId, number> = { weapons: 10, operations: 20, crew: 30 };
export const SW_PORTS: Record<ZoneId, string[]> = { weapons: ['p1', 'p2', 'p3'], operations: ['p4', 'p5', 'p6'], crew: ['p7', 'p8', 'p9'] };
export const FW_PORT: Record<ZoneId | 'shore', string> = { weapons: 'p1', operations: 'p2', crew: 'p3', shore: 'p4' };
/** The switch port each firewall cable plugs into. */
export const FW_CABLE: Record<ZoneId, string> = { weapons: 'p10', operations: 'p11', crew: 'p12' };
export const NET = { flat: '10.0.0.0/24', weapons: '10.0.10.0/24', operations: '10.0.20.0/24', crew: '10.0.30.0/24', shore: '198.51.100.0/24' };
export const HOST_NUM: Record<string, number> = { fire: 11, torpedo: 12, command: 21, nav: 22, chart: 23, crew1: 31, crew2: 32, media: 33 };
export const PERSONAL_IP = '10.0.10.50';

/** A device's address once its zone has its own subnet: the third number matches the VLAN. */
export const segmentedIp = (id: string): string => `10.0.${VLAN[ZONE_OF[id]]}.${HOST_NUM[id]}`;
/** The firewall's address on a zone's subnet, every zone's gateway. */
export const gatewayOf = (z: ZoneId): string => `10.0.${VLAN[z]}.1`;

/** Levels later setups fill in when the student's plan left one unset. */
export const DEFAULT_LEVEL: Record<ZoneId, ZoneLevel> = { weapons: 'high', operations: 'medium', crew: 'low' };

/** The captain's orders (step 6), as zone policy cells. */
export const ORDERS: { from: ZoneId; to: ZoneId; value: PolicyValue }[] = [
  { from: 'operations', to: 'weapons', value: 'only:5001' },
  { from: 'weapons', to: 'operations', value: 'only:5002' },
  { from: 'weapons', to: 'crew', value: 'deny' },
  { from: 'operations', to: 'crew', value: 'deny' },
  { from: 'crew', to: 'weapons', value: 'deny' },
  { from: 'crew', to: 'operations', value: 'deny' },
];

const SMB: Service = { port: 445, proto: 'tcp', app: 'smb' };

/** Each zone behind its firewall port, with the services a policy may allow on their own. */
export const POLICY_ZONES: PolicyZone[] = [
  {
    id: 'weapons',
    label: 'Weapons',
    port: FW_PORT.weapons,
    net: NET.weapons,
    services: [
      { port: 5001, name: 'target data' },
      { port: 445, name: 'file sharing' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    port: FW_PORT.operations,
    net: NET.operations,
    services: [
      { port: 5002, name: 'status reports' },
      { port: 445, name: 'file sharing' },
      { port: 443, name: 'charts' },
    ],
  },
  {
    id: 'crew',
    label: 'Crew',
    port: FW_PORT.crew,
    net: NET.crew,
    services: [
      { port: 80, name: 'movies' },
      { port: 445, name: 'file sharing' },
    ],
    allowWarning: 'Crew laptops run games and downloads. Allow all lets anything on them reach {to}.',
  },
];

export function buildSub(): Sim {
  const host = (ip: string) => ({ ip: `${ip}/24`, gateway: '10.0.0.1' });
  const sim = new NetBuilder({ linkMs: 500, procMs: 100, l2Ms: 50, httpTimeoutMs: 15000, arpTimeoutMs: 4000, pingTimeoutMs: 12000 })
    .host('fire', {
      label: 'Fire control',
      icon: 'desktop',
      x: 140,
      y: 190,
      ...host('10.0.0.11'),
      services: [SMB, { port: 5001, proto: 'tcp', app: 'target-data', banner: 'Ready for target data' }],
    })
    .host('torpedo', { label: 'Torpedo room', icon: 'desktop', x: 140, y: 370, ...host('10.0.0.12'), services: [SMB] })
    .host('personal', { label: 'Personal laptop', icon: 'laptop', x: 140, y: 540 })
    .host('command', {
      label: 'Command',
      icon: 'desktop',
      x: 360,
      y: 80,
      ...host('10.0.0.21'),
      services: [SMB, { port: 5002, proto: 'tcp', app: 'status-reports', banner: 'Ready for status reports' }],
    })
    .host('nav', { label: 'Navigation', icon: 'desktop', x: 500, y: 80, ...host('10.0.0.22'), services: [SMB] })
    .host('chart', {
      label: 'Chart server',
      icon: 'server',
      x: 640,
      y: 80,
      ...host('10.0.0.23'),
      services: [SMB, { port: 443, proto: 'tcp', app: 'https', banner: 'Navigation charts' }],
    })
    .host('crew1', { label: 'Crew laptop 1', icon: 'laptop', x: 860, y: 190, ...host('10.0.0.31'), services: [SMB] })
    .host('crew2', { label: 'Crew laptop 2', icon: 'laptop', x: 860, y: 370, ...host('10.0.0.32'), services: [SMB] })
    .host('media', {
      label: 'Media server',
      icon: 'server',
      x: 860,
      y: 540,
      ...host('10.0.0.33'),
      services: [SMB],
      web: {
        name: 'Media server',
        title: 'Crew movie list',
        https: false,
        page: 'Tonight in the crew mess: a double feature at 2000. Requests go to the morale officer.',
      },
    })
    .switch('sw', { label: 'Main switch', x: 500, y: 290, ports: 12 })
    .router('fw', {
      label: 'Core firewall',
      icon: 'firewall',
      x: 500,
      y: 460,
      ifaces: [{ id: 'p1', ip: '10.0.0.1/24' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4', ip: '198.51.100.1/24' }],
      firewall: { outside: FW_PORT.shore, mode: 'stateful' },
    })
    .host('shore', { label: 'Shore link', icon: 'cloud', x: 680, y: 540, ip: '198.51.100.2/24', gateway: '198.51.100.1' })
    .link(['fire', 'eth0'], ['sw', 'p1'])
    .link(['torpedo', 'eth0'], ['sw', 'p2'])
    .link(['command', 'eth0'], ['sw', 'p4'])
    .link(['nav', 'eth0'], ['sw', 'p5'])
    .link(['chart', 'eth0'], ['sw', 'p6'])
    .link(['crew1', 'eth0'], ['sw', 'p7'])
    .link(['crew2', 'eth0'], ['sw', 'p8'])
    .link(['media', 'eth0'], ['sw', 'p9'])
    .link(['fw', 'p1'], ['sw', 'p10'])
    .link(['fw', 'p4'], ['shore', 'eth0'])
    .build();
  // VLANs and shutting the spare port both need the switch's per-port settings.
  sim.configureSwitch('sw');
  sim.setupZonePolicy('fw', POLICY_ZONES, { label: 'Shore link', port: FW_PORT.shore, net: NET.shore });
  return sim;
}

// ---------------------------------------------------------------------------
// Reading the network
// ---------------------------------------------------------------------------

/** The switch port a device's cable plugs into, if it plugs into the switch. */
export function swPortOf(sim: Sim, devId: string): string | undefined {
  const dev = sim.devices[devId];
  for (const i of dev?.ifaces ?? []) {
    const peer = i.linkId ? sim.peer(devId, i.id) : undefined;
    if (peer?.device === 'sw') return peer.iface;
  }
  return undefined;
}

export const portVlan = (sim: Sim, port: string): number => vlanOf(sim.dev('sw'), port);
export const portsIn = (sim: Sim, ports: string[], vlan: number): boolean => ports.every((p) => portVlan(sim, p) === vlan);
export const isInfected = (sim: Sim, id: string): boolean => !!sim.devices[id]?.malware;
export const policyIs = (sim: Sim, from: ZoneId, to: ZoneId, value: PolicyValue): boolean => {
  const zp = sim.devices.fw.zonePolicy;
  return !!zp && cellValue(zp, from, to) === value;
};
export const ordersSet = (sim: Sim): boolean => ORDERS.every((o) => policyIs(sim, o.from, o.to, o.value));
export const ifaceIs = (sim: Sim, dev: string, iface: string, cidr: string): boolean => {
  const i = sim.devices[dev]?.ifaces.find((x) => x.id === iface);
  return !!i?.ip && `${i.ip}/${i.prefix}` === cidr;
};

// ---------------------------------------------------------------------------
// The map: one dashed box per zone
// ---------------------------------------------------------------------------

/**
 * The zone a device is drawn in: the zone whose VLAN its switch port is in,
 * or else its zone on the plan. (A laptop plugged into a weapons port lands in
 * Weapons. A device whose port is in another zone's VLAN shows up there.)
 */
function drawnZone(sim: Sim, devId: string): ZoneId | undefined {
  const port = swPortOf(sim, devId);
  const v = port ? portVlan(sim, port) : 1;
  const byVlan = ZONES.find((z) => VLAN[z] === v);
  return byVlan ?? (sim.devices[devId]?.zone as ZoneId | undefined);
}

const PAD = { x: 90, top: 60, bottom: 100 };
const TONE: Record<ZoneLevel, MapZone['tone']> = { high: 'good', medium: 'info', low: 'warn' };

export function subZones(sim: Sim): MapZone[] {
  // Nothing to draw until the student starts the zone plan.
  if (!Object.values(sim.devices).some((d) => d.zone)) return [];
  const out: MapZone[] = [];
  for (const z of ZONES) {
    const members = Object.values(sim.devices).filter((d) => d.kind === 'host' && drawnZone(sim, d.id) === z);
    if (!members.length) continue;
    const xs = members.map((d) => d.x);
    const ys = members.map((d) => d.y);
    const x = Math.min(...xs) - PAD.x;
    const y = Math.min(...ys) - PAD.top;
    const vlanSet = members.every((d) => {
      const p = swPortOf(sim, d.id);
      return p && portVlan(sim, p) === VLAN[z];
    });
    const level = sim.zoneLevels[z] as ZoneLevel | undefined;
    const label = [ZONE_NAME[z], vlanSet ? `VLAN ${VLAN[z]}` : '', level ? LEVEL_NAME[level] : ''].filter(Boolean).join(' · ');
    const tone: MapZone['tone'] = members.some((d) => d.malware) ? 'bad' : level ? TONE[level] : 'neutral';
    out.push({
      id: z,
      shape: { kind: 'rect', x, y, w: Math.max(...xs) + PAD.x - x, h: Math.max(...ys) + PAD.bottom - y },
      label,
      tone,
      dashed: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Setup helpers. Reset network replays only setups, so each one rebuilds what
// earlier steps built. Each is idempotent and keeps the student's valid work.
// ---------------------------------------------------------------------------

/** No device infected, nothing spreading. */
export function ensureClean(sim: Sim): void {
  sim.cleanMalware();
}

/** Every inside computer already knows its neighbors' MACs, so the outbreak's tries don't each start with an ARP broadcast. */
export function warmArp(sim: Sim): void {
  sim.prewarmArp([...INSIDE]);
}

/** The zone plan as the lesson needs it: every computer in its job's zone, every zone with a level. */
export function ensurePlan(sim: Sim): void {
  for (const id of INSIDE) if (sim.devices[id].zone !== ZONE_OF[id]) sim.setZone(id, ZONE_OF[id]);
  for (const z of ZONES) if (!sim.zoneLevels[z]) sim.setZoneLevel(z, DEFAULT_LEVEL[z]);
}

/** Each zone's switch ports in its VLAN. Other ports stay as they are. */
export function ensureVlans(sim: Sim): void {
  for (const z of ZONES) for (const p of SW_PORTS[z]) if (portVlan(sim, p) !== VLAN[z]) sim.setVlan('sw', p, VLAN[z]);
}

function setIpIf(sim: Sim, dev: string, iface: string, cidr: string): void {
  if (ifaceIs(sim, dev, iface, cidr)) return;
  const [ip, len] = cidr.split('/');
  sim.setIp(dev, iface, ip, Number(len));
}

function setGatewayIf(sim: Sim, dev: string, gw: string): void {
  const d = sim.dev(dev);
  // A gateway's route leaves through the port on its network: set it again after the address changes.
  const route = d.routes.find((r) => r.source === 'static' && r.prefix === '0.0.0.0/0');
  if (d.gateway === gw && route?.iface && sim.connectedIface(d, gw) === route.iface) return;
  sim.setGateway(dev, gw);
}

/**
 * A subnet for each zone. The firewall gets a cable into the switch for each
 * zone. Everything but the crew zone's last pieces is set: with `full`, those
 * too (switch port 12's VLAN, the firewall's port 3, and Crew laptop 1).
 */
export function ensureSubnets(sim: Sim, full: boolean): void {
  const fw = sim.dev('fw');
  for (const z of ['operations', 'crew'] as const) {
    if (!fw.ifaces.find((i) => i.id === FW_PORT[z])?.linkId) sim.connect({ device: 'fw', iface: FW_PORT[z] }, { device: 'sw', iface: FW_CABLE[z] });
  }
  const zones: ZoneId[] = full ? ZONES : ['weapons', 'operations'];
  for (const z of zones) {
    if (portVlan(sim, FW_CABLE[z]) !== VLAN[z]) sim.setVlan('sw', FW_CABLE[z], VLAN[z]);
    setIpIf(sim, 'fw', FW_PORT[z], `${gatewayOf(z)}/24`);
  }
  for (const id of INSIDE) {
    if (id === 'crew1' && !full) continue;
    setIpIf(sim, id, 'eth0', `${segmentedIp(id)}/24`);
    setGatewayIf(sim, id, gatewayOf(ZONE_OF[id]));
  }
  // Old ARP entries point at old addresses.
  for (const d of Object.values(sim.devices)) if (d.kind === 'host' && Object.keys(d.arp).length) sim.clearArp(d.id);
}

/** The zone policy follows the captain's orders. */
export function ensurePolicy(sim: Sim): void {
  for (const o of ORDERS) if (!policyIs(sim, o.from, o.to, o.value)) sim.setZonePolicy('fw', o.from, o.to, o.value);
}

/** Step 8's button: the personal laptop plugs into the spare jack, gets an address on the weapons subnet, and opens Fire control's file share. */
export function plugPersonal(sim: Sim): void {
  const p = sim.dev('personal');
  if (!p.ifaces[0].linkId) sim.connect({ device: 'personal', iface: 'eth0' }, { device: 'sw', iface: 'p3' });
  if (!p.ifaces[0].ip) {
    sim.setIp('personal', 'eth0', PERSONAL_IP, 24);
    sim.setGateway('personal', gatewayOf('weapons'));
  }
  sim.connectService('personal', sim.ipOf('fire'), 445);
}
