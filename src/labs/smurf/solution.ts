import type { LabSolution } from '../solution';
import { CAMPUS_BCAST, PC1, WEB } from './scenario';

/** Answer key for "Echo Storm". Choice answers come from the lab itself. */
export const smurfSolution: LabSolution = {
  echo: { moves: [{ press: 'fan-ping' }, { inspect: 'web' }, { inspect: 'campus' }] },
  everyone: { moves: [{ tool: { type: 'echo', device: 'mallory', target: CAMPUS_BCAST } }] },
  'return-to-sender': { moves: [{ tool: { type: 'echo', device: 'mallory', target: PC1, source: WEB } }] },
  'the-storm': { moves: [{ press: 'storm' }, { press: 'fan-buy' }] },
  'many-attackers': { moves: [{ press: 'botnet' }, { press: 'fan-buy' }] },
  'read-the-spike': {
    moves: [{ inspect: 'edge' }, { openLog: 'campus', where: (e) => e.fields?.dst === CAMPUS_BCAST && e.fields?.proto === 'icmp' }],
  },
  'silence-the-amplifier': {
    moves: [{ tool: { type: 'directed-broadcast', device: 'campus', on: false } }, { press: 'retry' }],
  },
  'guard-your-edge': {
    moves: [
      // Deny inbound ICMP, placed above the ship-with-open ping rule so it takes effect.
      { tool: { type: 'fw-add-rule', device: 'edge', rule: { dir: 'in', proto: 'icmp', src: 'any', dst: 'any', dport: 'any', action: 'deny' }, at: 0 } },
      { press: 'botnet' },
      { press: 'fan-buy' },
      { press: 'isp-filter' },
      { press: 'fan-buy' },
    ],
  },
  'how-risky': {},
  reflect: {
    text: {
      'explain-smurf':
        "The attacker sends ping requests to a network's broadcast address, so the router hands each one to every " +
        'computer on that network. Thirty computers means thirty replies for one request, which is the ' +
        "amplification. The attacker also forges the source address to be the victim's, so all those replies pour " +
        "onto the victim instead of back to the attacker. Enough forged requests fill the victim's uplink and real " +
        'users cannot get through. The fix at the source is to turn off directed-broadcast forwarding on the ' +
        'amplifying network (the Westfield campus router), so a ping to the broadcast address is dropped instead of ' +
        'copied to every host.',
    },
  },
  submit: {},
};
