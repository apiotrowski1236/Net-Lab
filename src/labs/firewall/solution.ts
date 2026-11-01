import type { LabSolution } from '../solution';
import { ATTACKER, FILES, PATIENTS_IN, REPLIES_IN, SERVER_NET, STAFF_NET, STAFF_OUT } from './scenario';

// Rule ids follow the path below. Firewall A starts with r1 (out to anywhere).
// Step 4 adds r2 (patients in). Step 5's setup adds r3 (clinic SSH) and r4
// (the deny) above it. Step 7 adds r5 (replies from port 443).

/** Answer key for "Firewall Rulebook". Choice answers come from the lab itself. */
export const firewallSolution: LabSolution = {
  hospital: { moves: [{ inspect: 'web' }, { inspect: 'files' }] },
  open: {
    moves: [
      { tool: { type: 'scan', device: 'attacker', target: SERVER_NET } },
      { tool: { type: 'scan', device: 'attacker', target: STAFF_NET } },
      { tool: { type: 'connect', device: 'attacker', to: FILES, port: 445 } },
    ],
  },
  place: {
    moves: [
      { tool: { type: 'fw-place', device: 'fwA', a: 'inet', b: 'serversw', outside: 'inet' } },
      { tool: { type: 'fw-place', device: 'fwB', a: 'serversw', b: 'hrouter', outside: 'serversw' } },
    ],
  },
  'first-rule': {
    moves: [
      { press: 'patient' },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: PATIENTS_IN } },
      { press: 'patient' },
      { press: 'attacker-ssh' },
      { press: 'attacker-ping' },
    ],
  },
  order: {
    moves: [
      { press: 'clinic-ssh' },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r3', to: 2 } },
      { press: 'clinic-ssh' },
      { press: 'attacker-ssh' },
    ],
  },
  inner: {
    moves: [
      { tool: { type: 'fw-add-rule', device: 'fwB', rule: STAFF_OUT } },
      { press: 'nurse-ssh' },
      { press: 'web-files' },
      { press: 'nurse-files' },
    ],
  },
  stateless: {
    moves: [
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateless' } },
      { press: 'portal' },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: REPLIES_IN } },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r5', to: 3 } },
      { press: 'portal' },
    ],
  },
  fake: {
    moves: [
      { press: 'fake' },
      { press: 'sneak' },
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateful' } },
      { press: 'fake' },
      { press: 'sneak' },
      { tool: { type: 'fw-delete-rule', device: 'fwA', id: 'r5' } },
      { press: 'sneak' },
      { press: 'portal' },
    ],
  },
  ngfw: {
    moves: [{ press: 'malware' }, { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } }, { press: 'malware' }, { press: 'portal' }],
  },
  log: {
    moves: [
      { tool: { type: 'scan', device: 'attacker', target: SERVER_NET } },
      { tool: { type: 'scan', device: 'attacker', target: STAFF_NET } },
      { openLog: 'fwA', where: (e) => e.fields?.action === 'deny' && e.fields?.src === ATTACKER },
    ],
  },
  reflect: {
    text: {
      justify:
        'Firewall A sits on the cable between the internet and the server switch, so every packet from the internet crosses it. Firewall B sits between the server network and the staff network, so the web server lands in a screened subnet: patients can reach it, but a hacked web server still cannot reach the patient records. On Firewall A, rule 2 allows HTTPS in to the web server, rule 3 allows SSH only from the clinic network, and rule 4 denies all other inbound TCP. If rules 3 and 4 were swapped, the deny would match the clinic SSH first and block it.',
    },
  },
};
