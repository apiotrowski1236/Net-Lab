import type { LabSolution } from '../solution';
import { IP, SITE } from './scenario';

/** Answer key for "DNS Cache Poisoning". Choice answers come from the lab itself. */
export const dnsSpoofSolution: LabSolution = {
  names: { moves: [{ inspect: 'resolver' }, { inspect: 'ns' }] },
  lookup: { moves: [{ press: 'alice-open' }] },
  cache: { moves: [{ press: 'ben-open' }] },
  impostor: { moves: [{ press: 'alice-open-ip' }] },
  poison: {
    moves: [{ tool: { type: 'dns-forge', device: 'evil', resolver: 'resolver', name: SITE, ip: IP.evil } }],
  },
  harvest: { moves: [{ press: 'alice-login' }, { press: 'teacher-login' }] },
  https: { moves: [{ press: 'alice-https' }] },
  detect: {
    moves: [{ openLog: 'resolver', where: (e) => e.source === 'dns' && e.msg.includes(SITE) && e.msg.includes('(was ') }],
    text: {
      'drop-meaning':
        'The students still typed grades.example and their browsers still loaded a working page, but the poisoned resolver sent them to Mallory\'s server instead, so the real gradebook simply stopped receiving their requests.',
    },
  },
  fix: {
    moves: [
      { tool: { type: 'dns-flush', device: 'resolver' } },
      { tool: { type: 'resolver-harden', device: 'resolver', on: true } },
      { press: 'forge-again' },
      { press: 'alice-https' },
    ],
    text: {
      dnssec:
        'A hard-to-guess number only makes forging unlikely: an attacker who guesses the ticket still wins. A signature is checked, not guessed. The name server signs each record with a key only it holds, so the resolver can verify the signature and reject any answer that is not genuinely signed, no matter how the number was guessed.',
    },
  },
  reflect: {
    text: {
      compare:
        'ARP poisoning changes a MAC-address table so a device on the same local network sends its traffic to the attacker. It only reaches machines on that one LAN. DNS cache poisoning changes a name-to-address record in a shared resolver, so every computer that uses that resolver gets the wrong address until the record expires. Both plant a false record to redirect traffic, but DNS poisoning reaches everyone behind the resolver, not just one network segment.',
    },
  },
};
