import type { LabSolution } from '../solution';
import { MAC, STRONG_PASS, WEAK_PASS } from './scenario';

/** Answer key for "Wireless Security". Choice answers come from the lab itself. */
export const wirelessSolution: LabSolution = {
  tour: { moves: [{ inspect: 'wap' }] },

  heard: {
    moves: [
      { tool: { type: 'wifi-scan', device: 'mallory' } },
      { tool: { type: 'sniff', device: 'mallory', on: true } },
      { press: 'family-signin' },
    ],
  },

  inside: {
    moves: [{ tool: { type: 'wifi-power', device: 'wap', power: 2 } }, { inspect: 'wap' }],
  },

  hide: {
    moves: [{ tool: { type: 'wifi-beacon', device: 'wap', on: false } }],
  },

  lock: {
    moves: [
      { tool: { type: 'wifi-security', device: 'wap', security: 'wep', passphrase: WEAK_PASS } },
      { tool: { type: 'wifi-crack', device: 'mallory', ap: 'wap' } },
      { tool: { type: 'wifi-security', device: 'wap', security: 'wpa2', passphrase: STRONG_PASS } },
      { tool: { type: 'wifi-wps', device: 'wap', on: false } },
      { tool: { type: 'wifi-crack', device: 'mallory', ap: 'wap' } },
    ],
  },

  who: {
    moves: [
      { tool: { type: 'wifi-macfilter', device: 'wap', on: true, allow: [MAC.desk, MAC.phone1, MAC.laptop1, MAC.phonelot] } },
      { press: 'mallory-copy-mac' },
      { tool: { type: 'wifi-auth', device: 'wap', auth: 'eap' } },
    ],
  },

  rogue: {
    moves: [
      { tool: { type: 'wifi-scan', device: 'desk' } },
      { tool: { type: 'unplug', device: 'rogue', iface: 'p1' } },
    ],
  },

  policy: {},

  reflect: {
    text: {
      summary:
        'The shelter Wi-Fi uses WPA3 encryption with WPS turned off, so no one in range can read the traffic or guess the key, which stops the parking-lot eavesdropping and cracking. Each family signs in with a per-user login (EAP), so a copied MAC address or the shared password is not enough to join, which stops Mallory getting back on. The signal power is turned down to keep the coverage inside the gym, and the beacon is hidden as a small extra. We also cut the rogue access point off the hallway jack.',
    },
  },

  submit: {},
};
