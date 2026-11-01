import type { LabSolution } from '../solution';
import { BANK_PREFIX, MORE_SPECIFIC } from './scenario';

/** Answer key for "Advertise a Bad Route". Choice answers come from the lab itself. */
export const routeHijackSolution: LabSolution = {
  map: { moves: [{ inspect: 'home' }] },
  path: { moves: [{ press: 'open' }] },
  learn: { moves: [{ press: 'replay' }, { inspect: 'west' }], text: { 'west-path': '300 400' } },
  hijack: { moves: [{ tool: { type: 'announce', device: 'shady', prefix: BANK_PREFIX } }, { inspect: 'home' }] },
  blackhole: { moves: [{ press: 'open' }, { inspect: 'east' }] },
  specific: {
    moves: [{ tool: { type: 'announce', device: 'shady', prefix: MORE_SPECIFIC } }, { inspect: 'east' }],
    text: {
      'why-specific':
        'Routers pick the most specific route before they compare path length. 203.0.113.0/25 is more specific than 203.0.113.0/24 and still contains the bank, so East uses it even though the path is longer.',
    },
  },
  impersonate: { moves: [{ press: 'http' }, { press: 'https' }] },
  rov: {
    moves: [{ tool: { type: 'validate', device: 'west', on: true } }, { press: 'open-https' }],
    text: {
      'which-network':
        'Transit West. Shady Net is connected only to Transit West, so every fake announcement has to pass through it. When West rejects them, HomeNet and Transit East never hear the fake routes at all.',
    },
  },
  reflect: {
    text: {
      compare:
        'Both put the attacker on the path so traffic goes to them instead of where it should. The café attack only fools devices on one Wi-Fi network, but a BGP hijack can pull in traffic from whole networks and every customer behind them.',
    },
  },
};
