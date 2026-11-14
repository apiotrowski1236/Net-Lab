import type { Sim } from '../sim/sim';
import type { Frame, SimEvent } from '../sim/types';
import { appName, portLabel } from '../sim/services';
import { fwDenyText } from './firewallText';
import { DHCP_OP_LABEL, dhcpIps, dhcpSays, fromClient } from '../sim/dhcp';
import { flagText, isHandshakeOnly, payloadLen } from '../sim/tcp';

export type Proto = 'ARP' | 'HTTP' | 'HTTPS' | 'DNS' | 'PING' | 'ROUTE' | 'SSH' | 'SMB' | 'TCP' | 'ETH' | 'TELNET' | 'DHCP' | 'PRINT' | 'RSYNC';

/** Pill for a connection to a service (services.ts), by the program really inside. */
const SVC_PROTO: Record<string, Proto> = { https: 'HTTPS', http: 'HTTP', ssh: 'SSH', smb: 'SMB', dns: 'DNS', telnet: 'TELNET', ipp: 'PRINT', rsync: 'RSYNC' };

export function protoOf(f: Frame): Proto {
  if (f.arp) return 'ARP';
  if (f.bgp) return 'ROUTE';
  if (f.dhcp) return 'DHCP';
  // A bare Ethernet frame with nothing inside (MAC flooding sends these).
  if (!f.ip) return 'ETH';
  const ip = f.ip;
  if (ip.app.kind === 'ping' || ip.app.kind === 'icmp-error') return 'PING';
  if (ip.app.kind === 'dns-query' || ip.app.kind === 'dns-answer') return 'DNS';
  // A TCP handshake, ACK, reset, or FIN carries no program's data (capture-analysis).
  if (ip.app.kind === 'svc') return isHandshakeOnly(ip) ? 'TCP' : (SVC_PROTO[ip.app.app] ?? 'TCP');
  return ip.encrypted ? 'HTTPS' : 'HTTP';
}

/**
 * Packet pill colors. White text sits on these in both themes, so each one has
 * at least 4.5:1 contrast with #fff.
 */
export const PROTO_COLOR: Record<Proto, string> = {
  ARP: '#b45309',
  HTTP: '#2563eb',
  HTTPS: '#047857',
  DNS: '#7c3aed',
  PING: '#64748b',
  ROUTE: '#be185d',
  ETH: '#0e7490',
  SSH: '#155e75',
  SMB: '#4d7c0f',
  TCP: '#7c2d12',
  TELNET: '#a21caf',
  DHCP: '#4338ca',
  PRINT: '#0f766e',
  RSYNC: '#57534e',
};

/** Fill for forged ("FAKE") packets. White text, 4.8:1. */
export const FORGED_COLOR = '#dc2626';

/**
 * Text and border colors for packet layers in the capture viewer. These sit on
 * the panel, so they change with the theme (see --layer-* in styles.css).
 */
const LAYER_COLOR = {
  ethernet: 'var(--layer-eth)',
  ip: 'var(--layer-ip)',
  transport: 'var(--layer-tcp)',
  ARP: 'var(--layer-arp)',
  HTTP: 'var(--layer-http)',
  HTTPS: 'var(--layer-https)',
  DNS: 'var(--layer-dns)',
  PING: 'var(--layer-ping)',
  ROUTE: 'var(--layer-route)',
  ETH: 'var(--layer-eth)',
  DHCP: 'var(--layer-dhcp)',
} as const;

export const PROTO_BLURB: Record<Proto, string> = {
  ARP: 'ARP: "Who has this IP address?" / "It’s me, at this MAC."',
  HTTP: 'HTTP: web traffic in plain text. Anyone who sees it can read it.',
  HTTPS: 'HTTPS: web traffic inside TLS encryption.',
  DNS: 'DNS: looking up a name like bank.example to get its IP address.',
  PING: 'Ping: "Are you there?" / "Yes!"',
  ROUTE: 'Route announcement: one network telling its neighbor which addresses it can reach.',
  ETH: 'Ethernet frame with nothing inside. A stack marked "×20" stands for 20 frames.',
  SSH: 'SSH: an administrator logging in to a computer from far away (encrypted).',
  SMB: 'SMB: Windows file sharing, for opening shared folders.',
  TCP: 'Other TCP traffic: a program talking to a service on some port.',
  TELNET: 'Telnet: an administrator logging in to a device from far away, in plain text. Anyone who sees it reads the password.',
  DHCP: 'DHCP: a device asking for an IP address, and the router handing one out.',
  PRINT: 'Print: a document on its way to a printer over the network.',
  RSYNC: 'Rsync: one computer copying files to another, like a nightly backup.',
};

/** Packet colors the legend adds for labs whose hosts run services (services.ts), hand out addresses (dhcp.ts), or print. */
export function extraProtos(sim: Sim): Proto[] {
  const devs = Object.values(sim.devices);
  // A printer alone doesn't bring in the other services' colors.
  const base: Proto[] = devs.some((d) => d.services?.some((x) => x.app !== 'ipp')) ? ['SSH', 'SMB', 'TCP'] : [];
  const out: Proto[] = devs.some((d) => d.services?.some((x) => x.app === 'telnet')) ? [...base, 'TELNET'] : base;
  if (devs.some((d) => d.dhcp)) out.push('DHCP');
  if (devs.some((d) => d.services?.some((x) => x.app === 'ipp'))) out.push('PRINT');
  return out;
}

/** Fake ciphertext so encrypted packets look like gibberish (deterministic per frame). */
export function gibberish(seed: number, len = 48): string {
  let x = seed * 2654435761 >>> 0;
  let out = '';
  for (let i = 0; i < len; i++) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    out += (x & 255).toString(16).padStart(2, '0');
    if (i % 2 === 1) out += ' ';
  }
  return out.trim();
}

export function nameForIp(sim: Sim, ip: string): string | undefined {
  return sim.deviceByIp(ip)?.label;
}

export function nameForMac(sim: Sim, mac: string): string | undefined {
  if (mac === 'ff:ff:ff:ff:ff:ff') return 'broadcast, to everyone';
  return sim.deviceByMac(mac)?.label;
}

/** One-line summary, like Wireshark's Info column. A burst says how many frames it stands for. */
export function infoOf(f: Frame): string {
  const one = infoOfOne(f);
  if (!f.burst) return one;
  const each = f.burst.vary === 'src-mac' ? ', each from a different MAC' : f.burst.vary === 'src-ip' ? ', each from a different IP' : '';
  return `${one}  (×${f.burst.count} frames${each})`;
}

function infoOfOne(f: Frame): string {
  if (f.arp) {
    const a = f.arp;
    return a.op === 'request' ? `Who has ${a.targetIp}? Tell ${a.senderIp}` : `${a.senderIp} is at ${a.senderMac}`;
  }
  if (f.bgp) {
    const b = f.bgp;
    return b.kind === 'announce' ? `I can reach ${b.prefix} via AS path ${b.path.join(' ')}` : `Withdraw ${b.prefix}`;
  }
  if (f.dhcp) return dhcpSays(f.dhcp);
  if (!f.ip) return 'Ethernet frame, no data';
  const ip = f.ip;
  if (ip.tcp && ip.app.kind === 'svc') return tcpInfo(ip);
  if (ip.encrypted && (ip.app.kind === 'http-req' || ip.app.kind === 'http-res')) return 'Application Data (encrypted)';
  switch (ip.app.kind) {
    case 'ping':
      return ip.app.reply ? 'Echo (ping) reply' : 'Echo (ping) request';
    case 'icmp-error':
      return 'Time-to-live exceeded';
    case 'http-req':
      return `${ip.app.method} ${ip.app.path}${ip.app.body ? `  ${ip.app.body}` : ''}`;
    case 'http-res':
      return ip.app.status ? `${ip.app.status} OK  "${ip.app.title}"` : 'Handshake failed';
    case 'dns-query':
      return `Query: ${ip.app.name}`;
    case 'dns-answer':
      return `Answer: ${ip.app.name} = ${ip.app.ip ?? 'not found'}`;
    case 'svc': {
      const port = portLabel((ip.app.reply ? ip.srcPort : ip.dstPort) ?? 0, ip.proto === 'udp' ? 'udp' : 'tcp');
      if (!ip.app.reply) return `Connect to port ${port}${ip.app.text ? `: ${ip.encrypted ? 'encrypted data' : ip.app.text}` : ''}`;
      return ip.app.status === 'closed' ? `Port ${port} closed` : `Port ${port} open${ip.app.text ? `: ${ip.app.text}` : ''}`;
    }
  }
}

/** Info for a packet with TCP flags (capture-analysis): the ports and flags, or the data a program sent. */
function tcpInfo(ip: NonNullable<Frame['ip']>): string {
  const head = `${ip.srcPort} → ${ip.dstPort} [${flagText(ip.tcp!.flags)}]`;
  const app = ip.app as Extract<NonNullable<Frame['ip']>['app'], { kind: 'svc' }>;
  const len = payloadLen(ip);
  if (!len) return head;
  if (ip.encrypted) return 'Application Data (encrypted)';
  if (app.text) return app.text.split('\n')[0];
  return `${head} Len=${len}`;
}

export function endpoints(f: Frame): { src: string; dst: string } {
  if (f.ip) return { src: f.ip.src, dst: f.ip.dst };
  // The IP addresses a real DHCP message carries (the simulation leaves out its IP and UDP layers).
  if (f.dhcp) return dhcpIps(f.dhcp);
  return { src: f.src, dst: f.dst === 'ff:ff:ff:ff:ff:ff' ? 'Broadcast' : f.dst };
}

export interface Layer {
  title: string;
  color: string;
  rows: [string, string, string?][];
  note?: string;
  locked?: boolean;
  /** Wireshark's name for this layer ("Ethernet II"), shown when the lab asks for it (LabDef.wireshark). */
  ws?: string;
}

const WS = {
  eth: 'Ethernet II',
  ip: 'Internet Protocol Version 4',
  tcp: 'Transmission Control Protocol',
  udp: 'User Datagram Protocol',
  tls: 'Transport Layer Security',
  icmp: 'Internet Control Message Protocol',
  http: 'Hypertext Transfer Protocol',
} as const;

/** Wireshark's name for the program inside a service connection (services.ts). */
const WS_SVC: Record<string, string> = {
  https: WS.tls,
  http: WS.http,
  ssh: 'SSH Protocol',
  telnet: 'Telnet',
  smb: 'SMB2 (Server Message Block Protocol version 2)',
  ipp: 'Internet Printing Protocol',
  dns: 'Domain Name System',
  rsync: 'RSYNC File Synchroniser',
};

/** Packet details, layer by layer, for the capture viewer and packet inspector. */
export function layersOf(sim: Sim, f: Frame): Layer[] {
  const tag = (s?: string) => (s ? `(${s})` : undefined);
  const layers: Layer[] = [
    {
      title: 'Ethernet frame (delivery on this local network)',
      color: LAYER_COLOR.ethernet,
      ws: WS.eth,
      rows: [
        ['From MAC', f.src, tag(nameForMac(sim, f.src))],
        ['To MAC', f.dst, tag(nameForMac(sim, f.dst))],
      ],
    },
  ];
  if (f.burst) {
    const b = f.burst;
    const each = b.vary === 'src-mac' ? 'Each one has a different made-up From MAC.' : b.vary === 'src-ip' ? 'Each one has a different made-up From IP.' : 'They are all the same.';
    layers[0].rows.push(['Copies', `${b.count} frames`, '(shown as one)']);
    layers[0].note = `This is ${b.count} frames sent back to back. ${each}`;
  }
  if (f.dhcp) {
    const m = f.dhcp;
    const asks = fromClient(m);
    const ips = dhcpIps(m);
    layers.push(
      {
        title: 'IP packet (delivery across networks)',
        color: LAYER_COLOR.ip,
        ws: WS.ip,
        rows: [
          ['From IP', ips.src, asks ? '(no address yet)' : tag(nameForIp(sim, ips.src))],
          ['To IP', ips.dst, ips.dst === '255.255.255.255' ? '(everyone on this network)' : '(the address being handed out)'],
        ],
        note: asks ? 'The device has no IP address yet, so it sends from 0.0.0.0 to everyone.' : undefined,
      },
      {
        title: 'UDP',
        color: LAYER_COLOR.transport,
        ws: WS.udp,
        rows: [
          ['From port', asks ? '68' : '67', asks ? '(DHCP client)' : '(DHCP server)'],
          ['To port', asks ? '67' : '68', asks ? '(DHCP server)' : '(DHCP client)'],
        ],
      },
      {
        title: `DHCP ${DHCP_OP_LABEL[m.op]}`,
        color: LAYER_COLOR.DHCP,
        ws: `Dynamic Host Configuration Protocol (${DHCP_OP_LABEL[m.op]})`,
        rows: [
          ['Message', dhcpSays(m)],
          ['Device name', m.name ?? '-'],
          ['Device MAC', m.client, tag(nameForMac(sim, m.client))],
          ...(m.ip ? ([[m.op === 'offer' ? 'Address offered' : 'Address', `${m.ip}${m.prefix !== undefined ? `/${m.prefix}` : ''}`]] as [string, string][]) : []),
          ...(m.gateway ? ([['Default gateway', m.gateway, tag(nameForIp(sim, m.gateway))]] as [string, string, string?][]) : []),
        ],
      },
    );
    return layers;
  }
  if (!f.ip && !f.arp && !f.bgp) {
    layers[0].note = `${layers[0].note ? `${layers[0].note} ` : ''}There is nothing inside: no IP packet, no data. A frame like this exists only to make switches learn its From MAC.`;
    return layers;
  }
  if (f.arp) {
    const a = f.arp;
    layers.push({
      title: `ARP ${a.op}`,
      color: LAYER_COLOR.ARP,
      ws: `Address Resolution Protocol (${a.op})`,
      rows:
        a.op === 'request'
          ? [
              ['Question', `Who has ${a.targetIp}?`],
              ['Asked by', `${a.senderIp} at ${a.senderMac}`],
            ]
          : [
              ['Claim', `${a.senderIp} is at ${a.senderMac}`],
              ['Sent to', `${a.targetIp}`],
            ],
      note: f.forged ? 'This reply is a lie: nobody asked for it, and the MAC is not the real owner’s.' : undefined,
    });
    return layers;
  }
  if (f.bgp) {
    layers.push({
      title: `Route ${f.bgp.kind}`,
      color: LAYER_COLOR.ROUTE,
      ws: 'Border Gateway Protocol',
      rows: [
        ['Prefix', f.bgp.prefix],
        ['AS path', f.bgp.path.join(' → ') || '(withdrawn)'],
        ['Origin AS', f.bgp.path.length ? `AS${f.bgp.path[f.bgp.path.length - 1]}` : '-'],
      ],
      note: f.forged ? 'This announcement claims addresses that belong to someone else.' : undefined,
    });
    return layers;
  }
  const ip = f.ip!;
  layers.push({
    title: 'IP packet (delivery across networks)',
    color: LAYER_COLOR.ip,
    ws: WS.ip,
    rows: [
      ['From IP', ip.src, tag(nameForIp(sim, ip.src))],
      ['To IP', ip.dst, tag(nameForIp(sim, ip.dst))],
      ['TTL', String(ip.ttl), '(hops left before it’s thrown away)'],
    ],
    note: ip.nat ? natNote(sim, ip) : undefined,
  });
  if (ip.tcp && ip.app.kind === 'svc') return [...layers, ...tcpLayers(f, ip)];
  if (ip.proto !== 'icmp') {
    layers.push({
      title: ip.proto === 'tcp' ? 'TCP' : 'UDP',
      color: LAYER_COLOR.transport,
      ws: ip.proto === 'tcp' ? WS.tcp : WS.udp,
      rows: [
        ['From port', String(ip.srcPort)],
        ['To port', String(ip.dstPort), ip.dstPort === 443 ? '(HTTPS)' : ip.dstPort === 80 ? '(HTTP)' : ip.dstPort === 53 ? '(DNS)' : undefined],
      ],
    });
  }
  const app = ip.app;
  if (ip.encrypted && (app.kind === 'http-req' || app.kind === 'http-res')) {
    layers.push({
      title: 'TLS (encrypted)',
      color: LAYER_COLOR.HTTPS,
      ws: WS.tls,
      rows: [['Data', gibberish(f.id)]],
      locked: true,
      note: 'Only the browser and the real server have the keys to read this.',
    });
    return layers;
  }
  switch (app.kind) {
    case 'ping':
      layers.push({ title: 'Ping', color: LAYER_COLOR.PING, ws: WS.icmp, rows: [['Type', app.reply ? 'Echo reply' : 'Echo request']] });
      break;
    case 'icmp-error':
      layers.push({
        title: 'ICMP error',
        color: LAYER_COLOR.PING,
        ws: WS.icmp,
        rows: [
          ['Type', 'Time exceeded (TTL ran out here)'],
          ['About the ping', `from ${app.orig.src} to ${app.orig.dst}`],
        ],
      });
      break;
    case 'http-req':
      layers.push({
        title: 'HTTP request',
        color: LAYER_COLOR.HTTP,
        ws: WS.http,
        rows: [
          ['Method', app.method],
          ['Host', app.host],
          ['Path', app.path],
          ...(app.body ? ([['Form data', app.body]] as [string, string][]) : []),
        ],
      });
      break;
    case 'http-res':
      layers.push({
        title: 'HTTP response',
        color: LAYER_COLOR.HTTP,
        ws: WS.http,
        rows: [
          ['Status', String(app.status)],
          ['Page title', app.title],
          ['Page text', app.body],
        ],
      });
      break;
    case 'dns-query':
      layers.push({ title: 'DNS query', color: LAYER_COLOR.DNS, ws: 'Domain Name System (query)', rows: [['Name', app.name]] });
      break;
    case 'dns-answer':
      layers.push({ title: 'DNS answer', color: LAYER_COLOR.DNS, ws: 'Domain Name System (response)', rows: [['Name', app.name], ['IP address', app.ip ?? 'not found']] });
      break;
    case 'svc':
      layers.push({
        title: `${appName(app.app)} ${app.reply ? 'reply' : 'request'}`,
        color: LAYER_COLOR.transport,
        ws: app.reply && app.status === 'closed' ? undefined : WS_SVC[app.app],
        rows: [
          ['Program', appName(app.app)],
          ...(app.reply ? ([['Answer', app.status === 'closed' ? 'Nothing listens on this port' : 'Service answered']] as [string, string][]) : []),
          ...(ip.encrypted
            ? ([['Data', !app.reply && app.text ? gibberish(f.id) : 'encrypted']] as [string, string][])
            : app.text
              ? ([['Data', app.text]] as [string, string][])
              : []),
        ],
        // A login typed into an encrypted session shows as gibberish; one typed into Telnet is readable.
        locked: ip.encrypted && !app.reply && !!app.text ? true : undefined,
        note:
          app.reply && !app.conn
            ? 'A reply that answers nothing anyone asked for.'
            : ip.encrypted && !app.reply && app.text
              ? 'Only the two ends of this session hold the keys to read it.'
              : app.app === 'telnet' && !app.reply && app.text
                ? 'Telnet sends what you type as plain text, password included.'
                : undefined,
      });
      break;
  }
  return layers;
}

const FLAG_WORDS: [keyof NonNullable<NonNullable<Frame['ip']>['tcp']>['flags'], string][] = [
  ['syn', 'SYN: "Let\u2019s start a connection."'],
  ['ack', 'ACK: "Got it."'],
  ['psh', 'PSH: "Here is data, pass it on now."'],
  ['fin', 'FIN: "I\u2019m done. Let\u2019s close."'],
  ['rst', 'RST: "No. Stop." (nothing listens on that port, or the connection is cut off)'],
];

/** The TCP layer and the data inside, for a packet with TCP flags (capture-analysis). */
function tcpLayers(f: Frame, ip: NonNullable<Frame['ip']>): Layer[] {
  const t = ip.tcp!;
  const app = ip.app as Extract<NonNullable<Frame['ip']>['app'], { kind: 'svc' }>;
  const len = payloadLen(ip);
  const set = FLAG_WORDS.filter(([k]) => t.flags[k]);
  const rows: [string, string, string?][] = [
    ['From port', String(ip.srcPort)],
    ['To port', String(ip.dstPort), ip.dstPort === 443 ? '(HTTPS)' : ip.dstPort === 80 ? '(HTTP)' : ip.dstPort === 23 ? '(Telnet)' : undefined],
    ['Flags', `[${flagText(t.flags)}]`],
    ...set.map(([, words]): [string, string] => ['', words]),
    ['Data length', `${len} bytes`],
  ];
  if (t.stream !== undefined) rows.push(['Stream', String(t.stream), '(which conversation in this file)']);
  const out: Layer[] = [{ title: 'TCP', color: LAYER_COLOR.transport, ws: WS.tcp, rows }];
  if (!len) return out;
  if (ip.encrypted) {
    out.push({ title: 'TLS (encrypted)', color: LAYER_COLOR.HTTPS, ws: WS.tls, rows: [['Data', gibberish(f.id)]], locked: true, note: 'Only the two ends of this connection hold the keys to read this.' });
    return out;
  }
  out.push({
    title: `${appName(app.app)} data`,
    color: LAYER_COLOR.transport,
    ws: WS_SVC[app.app],
    rows: [['Data', app.text ?? `(${len} bytes of file data)`]],
    note: app.app === 'telnet' && app.text ? 'Telnet sends what you type as plain text, password included.' : undefined,
  });
  return out;
}

/** What a NAT router changed on this packet (nat.ts), in plain words. */
function natNote(sim: Sim, ip: NonNullable<Frame['ip']>): string {
  const n = ip.nat!;
  const by = sim.devices[n.by]?.label ?? 'The router';
  const at = (addr: string, port?: number) => (port === undefined || ip.proto === 'icmp' ? addr : `${addr} port ${port}`);
  if (n.was.dst !== undefined) {
    return `${by} changed the To address. On the internet, this packet went to ${at(n.was.dst, n.was.dstPort)}. ${by}’s address-sharing list said that’s ${at(ip.dst, ip.dstPort)}.`;
  }
  return `${by} changed the From address. Inside the home, this packet came from ${at(n.was.src ?? '?', n.was.srcPort)}. Out here it carries the shared public address, ${at(ip.src, ip.srcPort)}.`;
}

export function fmtTime(ms: number): string {
  return (ms / 1000).toFixed(2) + 's';
}

/** Why a ping failed, in one sentence, for the ping tool. */
export function pingFailText(sim: Sim, e: Extract<SimEvent, { type: 'ping-fail' }>): string {
  const at = e.at ? sim.devices[e.at]?.label ?? e.at : '';
  switch (e.reason) {
    case 'timeout':
      return 'No reply. Nothing came back before the ping gave up.';
    case 'no-ip':
      return `${at} has no IP address, so it can't send a ping.`;
    case 'no-link':
      return `${at} has no cable on the port the ping needed.`;
    case 'no-gateway':
      return `${at} has no default gateway, and ${e.ip} is not on its own network.`;
    case 'gateway-off-net': {
      const me = e.at ? sim.devices[e.at]?.ifaces.find((i) => i.ip && i.prefix !== undefined) : undefined;
      return `${at}'s IP address${me ? ` (${me.ip}/${me.prefix})` : ''} and its default gateway (${e.ip}) aren't on the same network.`;
    }
    case 'no-route':
      return `${at} has no route to ${e.ip}, so it dropped the packet.`;
    case 'arp-timeout': {
      // The address is set, but on a port with no cable: the commonest reason nobody answers while building a network.
      for (const d of Object.values(sim.devices)) {
        const i = d.ifaces.find((x) => x.ip === e.ip);
        if (i && !i.linkId) {
          const port = d.ifaces.length > 1 ? ` on ${i.id.replace(/^p(\d+)$/, 'port $1')}` : '';
          return `${at} asked "Who has ${e.ip}?" and nobody answered. ${d.label} has that address${port}, but that port has no cable.`;
        }
      }
      return `${at} asked "Who has ${e.ip}?" and nobody answered.`;
    }
    case 'ttl':
      return `The packet went around in a loop until its TTL ran out at ${at}.`;
    case 'port-shutdown':
      return `${at} has the port this computer is plugged into shut down, so it dropped the packet.`;
    case 'port-security':
      return `${at}'s port security does not allow this computer's MAC address on that port, so it dropped the packet.`;
    case 'firewall':
      return fwDenyText(sim, e.at, e.t);
    case 'vpn-split-off':
      return `${at}'s VPN has split tunneling off, so it won't carry traffic from other devices on its home network into the office.`;
    case 'congestion':
      return `The link out of ${at} is full, so the ping was dropped. A flood is using up the link.`;
    case 'no-broadcast':
      return `${at} would not forward a ping to a whole network's broadcast address, so it dropped the request.`;
    case 'unsolicited':
      return `${at} dropped the ping: nobody behind it asked for it.`;
    default:
      return `Dropped at ${at}.`;
  }
}
