import type { LabSolution } from '../solution';
import { DEFAULT_PASSWORD, DEFAULT_SSID } from './scenario';

/** Answer key for "Home Network: Switching, DHCP, and NAT". Choice answers come from the lab itself. */
export const homeNetworkSolution: LabSolution = {
  tour: { moves: [{ inspect: 'router' }, { inspect: 'wifi' }, { inspect: 'laptop' }, { press: 'watch-packet' }] },

  cables: {
    moves: [
      { tool: { type: 'cable', a: 'console', b: 'wifi' } },
      { tool: { type: 'cable', a: 'printer', b: 'wifi' } },
      { tool: { type: 'cable', a: 'router', b: 'isp' } },
    ],
  },

  wifi: {
    moves: [
      { tool: { type: 'wifi-ssid', device: 'wifi', ssid: DEFAULT_SSID } },
      { tool: { type: 'wifi-security', device: 'wifi', security: 'wpa3' } },
      { tool: { type: 'wifi-passphrase', device: 'wifi', passphrase: DEFAULT_PASSWORD } },
      { tool: { type: 'wifi-off', device: 'wifi', off: false } },
      { press: 'family-joins' },
      { press: 'neighbor-tries' },
    ],
  },

  addresses: { moves: [{ press: 'tv-restarts' }, { inspect: 'router' }, { inspect: 'phone' }] },

  packets: {
    moves: [{ press: 'print-homework' }, { openFrame: 'laptop', match: (f) => f.ip?.app.kind === 'svc' && f.ip.app.app === 'ipp' }],
  },

  switch: { moves: [{ press: 'print-photo' }, { inspect: 'wifi' }] },

  internet: { moves: [{ inspect: 'phone' }, { press: 'phone-video' }] },

  nat: {
    moves: [
      { press: 'both-browse' },
      { openFrame: 'laptop', match: (f) => f.ip?.app.kind === 'http-res' && !!f.ip.nat },
      { inspect: 'router' },
    ],
  },

  stranger: { moves: [{ press: 'stranger-knocks' }, { openLog: 'router', where: (e) => e.source === 'nat' && e.fields?.action === 'drop' }] },

  reflect: {
    text: {
      'answer-path':
        "When the laptop asks a website for a page, the router swaps the laptop's private address for the home's public address and gives the request a port number. It writes the port number and the laptop's private address in its list. The answer comes back to the public address with that port number, so the router looks it up, puts back the private address, and sends the answer to the laptop.",
    },
  },
};
