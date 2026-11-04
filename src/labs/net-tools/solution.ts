import type { LabSolution, Move } from '../solution';

const at = (device: string, line: string): Move => ({ tool: { type: 'term', device, line } });
const pc1 = (line: string) => at('pc1', line);

/** Answer key for "Clues from the Command Line". Choice answers come from the lab itself. */
export const netToolsSolution: LabSolution = {
  tour: { moves: [{ inspect: 'router' }, { inspect: 'catalog' }] },

  ping: { moves: [pc1('ping 10.0.0.1'), pc1('ping 10.0.0.20')] },

  'ping-name': { moves: [pc1('ping catalog.lakeside.example')] },

  nslookup: {
    moves: [pc1('nslookup catalog.lakeside.example'), { press: 'report-dns' }, pc1('nslookup catalog.lakeside.example'), { press: 'open-catalog' }],
  },

  traceroute: {
    moves: [pc1('ping ebooks.example'), pc1('traceroute ebooks.example'), { press: 'call-isp' }, pc1('tracert ebooks.example')],
  },

  netstat: { moves: [{ press: 'watch-pc2' }, at('pc2', 'netstat -b'), { press: 'unplug-pc2' }, at('pc2', 'netstat -b')] },

  permission: {},

  nmap: { moves: [at('laptop', 'nmap 10.0.0.0/24')] },

  vuln: { moves: [at('laptop', 'nmap -sV --script vuln 10.0.0.0/24')] },

  close: { moves: [{ press: 'close-risky' }, at('laptop', 'nmap 10.0.0.0/24')] },

  reflect: {
    text: {
      advice:
        'I would tell them not to do it. Scanning a network you do not own without written permission can be a crime, even if you mean well, and the school could suspend you. Instead, they could ask the IT staff what they check, or practice nmap on their own home network with their parents’ permission.',
    },
  },

  submit: {},
};
