import type { RiskLevel } from '../../sim/audit';
import { DROP_PINGS_RULE } from '../../ui/inspector/Hardening';
import type { Move, LabSolution } from '../solution';
import { buildOffice, DESK_PORTS, EMPTY_PORTS } from './scenario';

const scan: Move = { tool: { type: 'audit-scan', device: 'auditor' } };

/** The answer key's ratings: likelihood, then impact. The three framework examples land high, moderate, and low. */
const RATINGS: [string, RiskLevel, RiskLevel][] = [
  ['telnet', 'high', 'moderate'],
  ['default-admin', 'high', 'high'],
  ['edge-icmp', 'high', 'low'],
  ['switch-open', 'moderate', 'moderate'],
  ['wifi-weak', 'high', 'high'],
  ['wifi-beacon', 'low', 'low'],
  ['vpn-split', 'moderate', 'high'],
];

/** The MAC address of the computer on each desk port, for MAC filtering. */
const DESK_MACS: Record<string, string> = (() => {
  const sim = buildOffice();
  return Object.fromEntries(
    DESK_PORTS.map((port) => {
      const peer = sim.peer('sw', port)!;
      return [port, sim.dev(peer.device).ifaces.find((i) => i.id === peer.iface)!.mac];
    }),
  );
})();

/** Answer key for "Vulnerability Scan and Risk Assessment". Choice answers come from the lab itself. */
export const netAuditSolution: LabSolution = {
  engagement: { moves: [{ inspect: 'router' }, { inspect: 'fileserver' }, { inspect: 'wap' }] },

  scan: { moves: [scan, { openFinding: 'auditor', id: 'telnet' }] },

  telnet: {
    moves: [
      { tool: { type: 'sniff', device: 'auditor', on: true } },
      { press: 'telnet-login' },
      { openFrame: 'auditor', match: 'telnet' },
      { press: 'ssh-login' },
      { openFrame: 'auditor', match: 'encrypted' },
    ],
    text: {
      'default-pw':
        'Default passwords are printed in manuals and posted online, so anyone can try them. Even over SSH, an attacker who knows the default can log in as admin, so the account needs a unique password or, better, logins through the authentication server.',
    },
  },

  likelihood: {},

  register: {
    moves: RATINGS.map(([finding, likelihood, impact]): Move => ({ tool: { type: 'rate-risk', device: 'auditor', finding, likelihood, impact } })),
  },

  'router-policy': {
    moves: [
      { inspect: 'router' },
      { tool: { type: 'harden', device: 'router', setting: 'telnet', on: false } },
      { tool: { type: 'harden', device: 'router', setting: 'auth-server', on: true } },
      { tool: { type: 'fw-add-rule', device: 'router', rule: DROP_PINGS_RULE, at: 0 } },
      scan,
    ],
  },

  'switch-policy': {
    moves: [
      { inspect: 'sw' },
      ...DESK_PORTS.map((port): Move => ({ tool: { type: 'port-security', device: 'sw', port, config: { maxMacs: 1, violation: 'shutdown', allowed: [DESK_MACS[port]] } } })),
      ...EMPTY_PORTS.map((port): Move => ({ tool: { type: 'port-shutdown', device: 'sw', port, shut: true } })),
      { tool: { type: 'harden', device: 'sw', setting: 'auth-server', on: true } },
      scan,
    ],
  },

  wifi: {
    moves: [{ inspect: 'wap' }, { tool: { type: 'wifi-security', device: 'wap', security: 'wpa3' } }, scan],
  },

  vpn: {
    moves: [
      { press: 'home-probe' },
      { inspect: 'router' },
      { tool: { type: 'vpn-config', device: 'router', splitTunneling: false, auth: 'mfa' } },
      { press: 'home-probe' },
    ],
    text: {
      'split-why':
        'With split tunneling, the bookkeeper’s laptop was connected to both her home network and the office at once, and it did not keep them apart. A possibly infected home device used her tunnel to reach the donor server, so a problem on her home network became a problem for the office. Turning split tunneling off forces all her traffic through the office gateway and stops the home network from piggybacking in.',
    },
  },

  rescan: { moves: [scan] },

  reflect: {
    text: {
      summary:
        'The biggest risk is the office Wi-Fi. It used WEP encryption, which an attacker in the parking lot can crack in seconds, and the whole office sits on one network with the donor records server. I rated it high: the attack is easy, so the likelihood is high, and exposed donor records would be a serious breach of confidentiality, so the impact is high. The fix is to switch the Wi-Fi to WPA3 encryption, which we did. As a longer-term project, splitting the donor server onto its own network segment would lower the risk further.',
    },
  },
};
