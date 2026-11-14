import { prefixContains } from '../../sim/addr';
import type { PolicyValue } from '../../sim/zonePolicy';
import type { LabSolution, Move } from '../solution';
import { INSIDE, NET, SW_PORTS, VLAN, ZONE_OF, ZONES, type ZoneId } from './scenario';

const RECOMMEND =
  'Weapons should be High. Keep it in its own VLAN and subnet and let in only target data from Operations, because a hacked weapons console could change or block targeting. ' +
  'Shut unused jacks like port 3 and turn on port security on the ports in use. ' +
  'Operations should be High or Medium. It gets its own VLAN and subnet, with only status reports coming in from Weapons and nothing from Crew, because it runs and steers the ship. ' +
  'Crew recreation should be Low. It gets its own VLAN and subnet with no connections into the other zones, because personal laptops and downloaded games are the most likely way malware gets aboard. ' +
  'Mail from shore should go through a relay in a screened subnet.';

const policy = (from: ZoneId, to: ZoneId, value: PolicyValue): Move => ({ tool: { type: 'set-zone-policy', device: 'fw', from, to, value } });

/** Answer key for "Network Segmentation: Zones, VLANs, and Subnets". Choice answers come from the lab itself. */
export const segmentationSolution: LabSolution = {
  ship: { moves: [{ inspect: 'fire' }, { inspect: 'sw' }, { press: 'ping-fire' }] },
  worm: { moves: [{ press: 'install' }, { inspect: 'fire' }] },
  plan: {
    moves: [
      ...INSIDE.map((d): Move => ({ tool: { type: 'set-zone', device: d, zone: ZONE_OF[d] } })),
      { tool: { type: 'set-zone-level', zone: 'weapons', level: 'high' } },
      { tool: { type: 'set-zone-level', zone: 'operations', level: 'medium' } },
      { tool: { type: 'set-zone-level', zone: 'crew', level: 'low' } },
    ],
  },
  vlans: {
    moves: [
      ...ZONES.flatMap((z) => SW_PORTS[z].map((p): Move => ({ tool: { type: 'set-vlan', device: 'sw', iface: p, vlan: VLAN[z] } }))),
      { press: 'ping-fire' },
      { press: 'ping-media' },
    ],
  },
  subnets: {
    moves: [
      { tool: { type: 'set-vlan', device: 'sw', iface: 'p12', vlan: 30 } },
      { tool: { type: 'set-ip', device: 'fw', iface: 'p3', cidr: '10.0.30.1/24' } },
      { tool: { type: 'set-ip', device: 'crew1', iface: 'eth0', cidr: '10.0.30.31/24' } },
      { tool: { type: 'gateway', device: 'crew1', ip: '10.0.30.1' } },
      { press: 'movies' },
      { press: 'ping-command' },
    ],
  },
  policy: {
    moves: [
      policy('operations', 'weapons', 'only:5001'),
      policy('weapons', 'operations', 'only:5002'),
      policy('weapons', 'crew', 'deny'),
      policy('operations', 'crew', 'deny'),
      policy('crew', 'weapons', 'deny'),
      policy('crew', 'operations', 'deny'),
      { press: 'target' },
      { press: 'share' },
      { press: 'status' },
      { press: 'crew-share' },
    ],
  },
  contain: {
    moves: [
      { press: 'install' },
      { openLog: 'fw', where: (e) => e.fields?.action === 'deny' && e.fields?.dport === 445 && prefixContains(NET.crew, String(e.fields?.src ?? '')) },
    ],
  },
  jack: {
    moves: [{ press: 'plug' }, { tool: { type: 'port-shutdown', device: 'sw', port: 'p3', shut: true } }, { press: 'plug' }],
  },
  dmz: {},
  reflect: { text: { recommend: RECOMMEND } },
};
