import type { LabSolution, Move } from '../solution';
import { WEB } from './scenario';

const sh = (line: string): Move => ({ tool: { type: 'term', device: WEB, line } });
const set = (setting: 'fail2ban' | 'passwords', on: boolean): Move => ({ tool: { type: 'linux', device: WEB, setting, on } });

/** Answer key for "Device Security Analysis". Choice answers come from the lab itself. */
export const deviceAnalysisSolution: LabSolution = {
  case: { moves: [{ inspect: WEB }, sh('ss -tuln')] },

  trace: { moves: [{ press: 'customer' }, { press: 'jo' }, { press: 'scan-ssh' }, { press: 'scan-rdp' }] },

  auth: {
    moves: [sh('grep -n "Failed password" /var/log/auth.log')],
    text: { ip: '203.0.113.77', 'spray-rows': 'rows 11 to 24' },
  },

  'ufw-log': { moves: [{ press: 'rescan' }], text: { 'scan-rows': '4-13' } },

  'web-log': { text: { 'traversal-rows': '21–23' } },

  // The new rule lands at the bottom (rule 11), under the SSH rule: the spray gets through. Delete it and insert it at the top.
  command: {
    moves: [sh('sudo ufw deny from 203.0.113.77'), { press: 'spray' }, sh('ufw status numbered'), sh('ufw delete 11'), sh('ufw insert 1 deny from 203.0.113.77'), { press: 'spray' }],
  },

  fail2ban: { moves: [set('fail2ban', true), { press: 'bot' }] },

  keys: { moves: [{ press: 'botnet' }, set('passwords', false), { press: 'botnet' }, { press: 'jo' }] },

  // Rules now: 1 fail2ban's ban, 2 deny .77, 3 deny .140 SSH, 4 FTP, 5 HTTP, 6 HTTPS, 7 SSH from Anywhere, ..., 12 DENY.
  policy: {
    moves: [
      sh('ufw status numbered'),
      sh('ufw delete 7'),
      sh('ufw insert 7 allow from 192.0.2.0/24 to any port 22 proto tcp'),
      sh('ufw delete 4'),
      { press: 'jo' },
      { press: 'vendor' },
      sh('ufw insert 7 allow from 198.18.40.0/24 to any port 22 proto tcp'),
      { press: 'vendor' },
    ],
  },

  'write-up': {
    text: {
      'part-a':
        'Row 11 of ufw.log shows a SYN from 203.0.113.140 to port 22. Rule 1 denies 22/tcp from 203.0.113.140, and it is the first rule that matches, so ufw dropped the packet and logged it. Deleting rule 1 would allow it, because rule 5 allows SSH from anywhere. The impact is that the scanner could then try to sign in with SSH.',
      'part-b':
        'Rows 21 to 23 of access.log show 203.0.113.140 asking for paths with ../ in them, like /download?file=../../../../etc/passwd. That is directory traversal. An intrusion prevention system such as a fail2ban jail on access.log could see the ../ requests and add a firewall rule that bans the address within seconds. A different countermeasure is input validation: the site works out the full location of each file it is asked for and refuses any outside the web folder.',
    },
  },

  submit: {},

  rdp: { moves: [sh('ufw delete allow 3389/tcp'), { press: 'scan-rdp' }] },
};
