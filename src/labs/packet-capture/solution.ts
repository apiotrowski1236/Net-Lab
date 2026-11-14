import type { LabSolution } from '../solution';
import {
  IP,
  isHomeworkGet,
  isHomeworkPage,
  isPhoneDhcp,
  isRouterArpReply,
  isRouterPingReply,
  isSchoolDnsAnswer,
  isWeatherPage,
} from './scenario';

const start = { tool: { type: 'capture', device: 'laptop', on: true } } as const;
const stop = { tool: { type: 'capture', device: 'laptop', on: false } } as const;
const pingRouter = { tool: { type: 'ping', device: 'laptop', ip: IP.router } } as const;
const filter = (text: string) => ({ filter: 'laptop', text });

/** Answer key for "Packet Capture Basics". Choice answers come from the lab itself. */
export const packetCaptureSolution: LabSolution = {
  tour: { moves: [{ inspect: 'laptop' }, { inspect: 'dns' }] },

  'first-capture': { moves: [start, { press: 'open-school' }, stop] },

  layers: { moves: [{ openFrame: 'laptop', match: isHomeworkGet }, { openFrame: 'laptop', match: isHomeworkPage }] },

  'page-story': {
    moves: [{ openFrame: 'laptop', match: isRouterArpReply }, { openFrame: 'laptop', match: isSchoolDnsAnswer }],
    text: { address: '192.0.2.80' },
  },

  'more-kinds': {
    moves: [start, { press: 'phone-rejoins' }, pingRouter, { openFrame: 'laptop', match: isPhoneDhcp }, { openFrame: 'laptop', match: isRouterPingReply }],
  },

  https: { moves: [start, { press: 'open-video' }, { openFrame: 'laptop', match: 'encrypted' }], text: { port: '443' } },

  busy: { moves: [start, { press: 'busy-minute' }, stop] },

  filter: {
    moves: [filter('dns'), filter('http'), { openFrame: 'laptop', match: isWeatherPage }],
    text: { weather: 'Sunny, with a high of 72°F.' },
  },

  'address-filter': { moves: [filter(`ip.addr == ${IP.chat}`), filter('!arp')] },

  'cant-see': { moves: [start, { press: 'tv-show' }, filter(`ip.addr == ${IP.tv}`), filter('arp')] },

  wireshark: { moves: [start, pingRouter, { press: 'open-video' }, filter('icmp'), filter('tls')] },

  reflect: {
    text: {
      advice:
        'Expect a long list that keeps growing, even when you are not doing anything, because apps work in the background. You will see ARP packets asking for MAC addresses, DNS lookups, and TLS packets you cannot read. Stop the capture first, then type a filter like dns or ip.addr == your address so only the packets you care about show.',
    },
  },
};
