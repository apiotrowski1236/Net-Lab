import type { LabSolution } from '../solution';

/**
 * Answer key for "Wireshark for Real": one student's real answers. Every
 * student's capture is different, so these are examples that pass the checks,
 * not the only right answers. The summaries are Copy > Summary as Text rows
 * (tabs between columns), in the formats TShark 4.4 writes.
 */

const ME = '10.40.12.87';
const ROUTER = '10.40.0.1';
const row = (...cells: (string | number)[]) => cells.join('\t');

export const wiresharkSolution: LabSolution = {
  install: { text: { version: '4.6.1' } },

  'first-capture': { text: { count: '1203', protocols: 'TCP, DNS, TLSv1.3' } },

  you: { text: { 'my-ip': ME, 'my-mac': '3c:22:fb:91:4e:07' } },

  dns: {
    text: {
      reply: row(17, '2.104883', '10.40.0.10', ME, 'DNS', 89, 'Standard query response 0x0d11 A wikipedia.org A 198.35.26.224'),
      address: '198.35.26.224',
    },
  },

  http: {
    text: {
      get: row(25, '3.882011', ME, '34.223.124.45', 'HTTP', 441, 'GET /online HTTP/1.1 '),
      host: 'coolcalmrelaxedday.neverssl.com',
    },
  },

  handshake: {
    text: {
      syn: row(22, '3.840115', ME, '34.223.124.45', 'TCP', 66, '54036 → 80 [SYN] Seq=0 Win=64240 Len=0 MSS=1460 WS=256 SACK_PERM'),
      'syn-ack': row(23, '3.881020', '34.223.124.45', ME, 'TCP', 66, '80 → 54036 [SYN, ACK] Seq=0 Ack=1 Win=26883 Len=0 MSS=1460 SACK_PERM WS=128'),
    },
  },

  tls: {
    text: {
      hello: row(53, '1.485034', ME, '198.35.26.224', 'TLSv1.3', 1622, 'Client Hello (SNI=www.wikipedia.org)'),
    },
  },

  ping: {
    text: {
      gateway: ROUTER,
      reply: row(6, '1.004381', ROUTER, ME, 'ICMP', 74, 'Echo (ping) reply    id=0x0001, seq=1/256, ttl=64 (request in 5)'),
    },
  },

  'not-mine': { text: { total: '412', mine: '371', others: '41' } },

  reflect: {
    text: {
      advice:
        'HTTPS locks the page, but it does not make you invisible. Someone running the network can see your DNS lookups, the site name in the TLS Client Hello, the IP addresses, and when and how much you sent. They cannot read the pages or anything you type, because that is encrypted Application Data. Plain HTTP pages like neverssl.com have no lock at all.',
    },
  },

  'user-agent': {
    text: {
      agent: 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'agent-says':
        'It says I use Chrome 141 on 64-bit Windows 10 or 11. A site could use that to guess what my computer is, and an attacker could pick an attack that works on that browser.',
    },
  },
};
