import type { LabSolution } from '../solution';
import { ATTACKER, BRANCH_REPLIES, NO_REMOTE, REPLIES_IN } from './scenario';

// Rule ids follow the path below. Firewall A starts with r1 to r4 (out to
// anywhere, patients in, clinic SSH, deny inbound TCP). Step 2 adds r5
// (replies from port 443), and step 4 deletes it. Step 6 adds r6 (no
// remote-control). The branch router starts with r1 and step 8 adds r2.

/** Answer key for "Smarter Firewalls". Choice answers come from the lab itself. */
export const firewallTypesSolution: LabSolution = {
  tour: { moves: [{ inspect: 'fwA' }, { inspect: 'fwB' }, { inspect: 'branch' }] },
  stateless: {
    moves: [
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateless' } },
      { press: 'portal' },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: REPLIES_IN } },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r5', to: 3 } },
      { press: 'portal' },
      { press: 'attacker-ssh' },
    ],
  },
  fake: { moves: [{ press: 'fake' }, { press: 'sneak' }] },
  stateful: {
    moves: [
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateful' } },
      { press: 'portal' },
      { press: 'fake' },
      { press: 'sneak' },
      { tool: { type: 'fw-delete-rule', device: 'fwA', id: 'r5' } },
      { press: 'sneak' },
      { press: 'portal' },
    ],
  },
  'same-port': { moves: [{ press: 'malware' }] },
  ngfw: {
    moves: [
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } },
      { press: 'malware' },
      { press: 'malware-odd' },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: NO_REMOTE } },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r6', to: 0 } },
      { press: 'malware-odd' },
      { press: 'malware' },
      { press: 'portal' },
    ],
  },
  inspect: {
    moves: [
      { press: 'exploit' },
      { openLog: 'web', where: (e) => e.fields?.src === ATTACKER },
      { tool: { type: 'fw-ips', device: 'fwA', on: true } },
      { press: 'exploit' },
      { openLog: 'fwA', where: (e) => !!e.fields?.signature },
    ],
    text: {
      'real-time':
        'Intrusion prevention read the booking lookup that the HTTPS rule allowed and compared it with signatures, patterns of known attacks. The request matched the SQL injection signature, so Firewall A denied it before it reached the web server and wrote an alert line in its log naming the signature.',
    },
  },
  branch: {
    moves: [
      { press: 'desk' },
      { tool: { type: 'fw-add-rule', device: 'branch', rule: BRANCH_REPLIES } },
      { press: 'desk' },
      { press: 'desk-fake' },
      { press: 'desk-forged' },
    ],
  },
  choose: {
    moves: [{ tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } }, { press: 'tests' }],
    text: {
      justify:
        'Firewall A should be next-generation and Firewall B should be stateful, which costs $40,000. Firewall A faces the internet, so it must stop the remote-control program on any port and the SQL injection hidden inside a booking request that the HTTPS rule allows. A stateful firewall only checks headers and its connection table, so it cannot see either one. Firewall B only has to let staff start conversations out and keep the screened subnet out of the staff network, and its connection table lets the replies back in. A stateless Firewall B would need a reply rule, and a hacked web server could send the nurse station a fake reply that copies the clinic’s address and matches it.',
    },
  },
};
