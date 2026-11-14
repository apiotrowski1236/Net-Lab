import type { LabSolution } from '../solution';
import { ADDR, NET, WEB_IP } from './scenario';

/** Answer key for "Build a Network: Addresses, Gateways, and Routes". Choice answers come from the lab itself. */
export const buildNetworkSolution: LabSolution = {
  parts: { moves: [{ inspect: 'alice' }, { inspect: 'office' }] },
  cables: {
    moves: [{ tool: { type: 'cable', a: 'alice', b: 'sw' } }, { tool: { type: 'cable', a: 'ben', b: 'sw' } }, { press: 'ping-ben' }],
  },
  addresses: {
    moves: [
      { tool: { type: 'set-ip', device: 'alice', iface: 'eth0', cidr: `${ADDR.alice}/24` } },
      { tool: { type: 'set-ip', device: 'ben', iface: 'eth0', cidr: `${ADDR.ben}/24` } },
      { tool: { type: 'ping', device: 'alice', ip: ADDR.ben } },
    ],
  },
  mac: { moves: [{ press: 'ping-ben' }, { inspect: 'sw' }] },
  router: {
    moves: [
      { tool: { type: 'cable', a: 'office', aPort: 'p1', b: 'sw' } },
      { tool: { type: 'set-ip', device: 'office', iface: 'p1', cidr: `${ADDR.officeLan}/24` } },
      { tool: { type: 'ping', device: 'alice', ip: ADDR.officeLan } },
    ],
  },
  gateway: {
    moves: [
      { tool: { type: 'gateway', device: 'alice', ip: ADDR.officeLan } },
      { tool: { type: 'gateway', device: 'ben', ip: ADDR.officeLan } },
      { press: 'open' },
    ],
  },
  datacenter: {
    moves: [
      { tool: { type: 'cable', a: 'web', b: 'dc', bPort: 'p2' } },
      { tool: { type: 'set-ip', device: 'dc', iface: 'p2', cidr: `${ADDR.dcServers}/24` } },
      { tool: { type: 'set-ip', device: 'web', iface: 'eth0', cidr: `${WEB_IP}/24` } },
      { tool: { type: 'gateway', device: 'web', ip: ADDR.dcServers } },
      { tool: { type: 'ping', device: 'web', ip: ADDR.dcServers } },
    ],
  },
  link: {
    moves: [
      { tool: { type: 'cable', a: 'office', aPort: 'p2', b: 'dc', bPort: 'p1' } },
      { tool: { type: 'set-ip', device: 'office', iface: 'p2', cidr: `${ADDR.officeLink}/24` } },
      { tool: { type: 'set-ip', device: 'dc', iface: 'p1', cidr: `${ADDR.dcLink}/24` } },
      { tool: { type: 'ping', device: 'office', ip: ADDR.dcLink } },
      { inspect: 'office' },
    ],
  },
  route: {
    moves: [{ tool: { type: 'add-route', device: 'office', prefix: NET.servers, via: ADDR.dcLink } }, { press: 'open' }],
  },
  return: {
    moves: [{ tool: { type: 'add-route', device: 'dc', prefix: NET.office, via: ADDR.officeLink } }, { press: 'open' }, { press: 'open-ben' }],
    text: {
      'both-ways':
        'A ping needs a reply. The request could reach the web server, but the reply goes to 192.168.10.11, and the data center router had no route to 192.168.10.0/24, so it dropped the reply.',
    },
  },
  fix: {
    moves: [
      { press: 'open-ben' },
      { tool: { type: 'cable', a: 'ben', b: 'sw' } },
      { tool: { type: 'set-ip', device: 'ben', iface: 'eth0', cidr: `${ADDR.ben}/24` } },
      { tool: { type: 'gateway', device: 'ben', ip: ADDR.officeLan } },
      { press: 'open-ben' },
    ],
  },
  reflect: {
    text: {
      trace:
        "Alice's laptop sends the request to its default gateway, the office router, through the office switch. The office router uses the static route I added for 203.0.113.0/24 and sends it to the data center router at 10.0.0.2. The data center router is plugged into 203.0.113.0/24, so it uses its connected route and delivers it to the web server.",
    },
  },
};
