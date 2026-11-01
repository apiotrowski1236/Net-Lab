import type { Sim } from '../sim/sim';
import type { Frame, SimEvent } from '../sim/types';
import { appName, portLabel } from '../sim/services';
import { fwDenyText } from './firewallText';

export type Proto = 'ARP' | 'HTTP' | 'HTTPS' | 'DNS' | 'PING' | 'ROUTE' | 'SSH' | 'SMB' | 'TCP' | 'ETH';

/** Pill for a connection to a service (services.ts), by the program really inside. */
const SVC_PROTO: Record<string, Proto> = { https: 'HTTPS', http: 'HTTP', ssh: 'SSH', smb: 'SMB', dns: 'DNS' };

export function protoOf(f: Frame): Proto {
  if (f.arp) return 'ARP';
  if (f.bgp) return 'ROUTE';
  // A bare Ethernet frame with nothing inside (MAC flooding sends these).
  if (!f.ip) return 'ETH';
  const ip = f.ip;
  if (ip.app.kind === 'ping') return 'PING';
  if (ip.app.kind === 'dns-query' || ip.app.kind === 'dns-answer') return 'DNS';
  if (ip.app.kind === 'svc') return SVC_PROTO[ip.app.app] ?? 'TCP';
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
};

/** Packet colors the legend adds for labs whose hosts run services (services.ts). */
export function extraProtos(sim: Sim): Proto[] {
  return Object.values(sim.devices).some((d) => d.services?.length) ? ['SSH', 'SMB', 'TCP'] : [];
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
  if (mac === 'ff:ff:ff:ff:ff:ff') return 'everyone (broadcast)';
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
  if (!f.ip) return 'Ethernet frame, no data';
  const ip = f.ip;
  if (ip.encrypted && (ip.app.kind === 'http-req' || ip.app.kind === 'http-res')) return 'Application Data (encrypted)';
  switch (ip.app.kind) {
    case 'ping':
      return ip.app.reply ? 'Echo (ping) reply' : 'Echo (ping) request';
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
      if (!ip.app.reply) return `Connect to port ${port}${ip.app.text ? `: ${ip.app.text}` : ''}`;
      return ip.app.status === 'closed' ? `Port ${port} closed` : `Port ${port} open${ip.app.text ? `: ${ip.app.text}` : ''}`;
    }
  }
}

export function endpoints(f: Frame): { src: string; dst: string } {
  if (f.ip) return { src: f.ip.src, dst: f.ip.dst };
  return { src: f.src, dst: f.dst === 'ff:ff:ff:ff:ff:ff' ? 'Broadcast' : f.dst };
}

export interface Layer {
  title: string;
  color: string;
  rows: [string, string, string?][];
  note?: string;
  locked?: boolean;
}

/** Packet details, layer by layer, for the capture viewer and packet inspector. */
export function layersOf(sim: Sim, f: Frame): Layer[] {
  const tag = (s?: string) => (s ? `(${s})` : undefined);
  const layers: Layer[] = [
    {
      title: 'Ethernet frame (delivery on this local network)',
      color: LAYER_COLOR.ethernet,
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
  if (!f.ip && !f.arp && !f.bgp) {
    layers[0].note = `${layers[0].note ? `${layers[0].note} ` : ''}There is nothing inside: no IP packet, no data. A frame like this exists only to make switches learn its From MAC.`;
    return layers;
  }
  if (f.arp) {
    const a = f.arp;
    layers.push({
      title: `ARP ${a.op}`,
      color: LAYER_COLOR.ARP,
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
    rows: [
      ['From IP', ip.src, tag(nameForIp(sim, ip.src))],
      ['To IP', ip.dst, tag(nameForIp(sim, ip.dst))],
      ['TTL', String(ip.ttl), '(hops left before it’s thrown away)'],
    ],
  });
  if (ip.proto !== 'icmp') {
    layers.push({
      title: ip.proto === 'tcp' ? 'TCP' : 'UDP',
      color: LAYER_COLOR.transport,
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
      rows: [['Data', gibberish(f.id)]],
      locked: true,
      note: 'Only Alice’s browser and the real server have the keys to read this.',
    });
    return layers;
  }
  switch (app.kind) {
    case 'ping':
      layers.push({ title: 'Ping', color: LAYER_COLOR.PING, rows: [['Type', app.reply ? 'Echo reply' : 'Echo request']] });
      break;
    case 'http-req':
      layers.push({
        title: 'HTTP request',
        color: LAYER_COLOR.HTTP,
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
        rows: [
          ['Status', String(app.status)],
          ['Page title', app.title],
          ['Page text', app.body],
        ],
      });
      break;
    case 'dns-query':
      layers.push({ title: 'DNS query', color: LAYER_COLOR.DNS, rows: [['Name', app.name]] });
      break;
    case 'dns-answer':
      layers.push({ title: 'DNS answer', color: LAYER_COLOR.DNS, rows: [['Name', app.name], ['IP address', app.ip ?? 'not found']] });
      break;
    case 'svc':
      layers.push({
        title: `${appName(app.app)} ${app.reply ? 'reply' : 'request'}`,
        color: LAYER_COLOR.transport,
        rows: [
          ['Program', appName(app.app)],
          ...(app.reply ? ([['Answer', app.status === 'closed' ? 'Nothing listens on this port' : 'Service answered']] as [string, string][]) : []),
          ...(ip.encrypted ? ([['Data', 'encrypted']] as [string, string][]) : app.text ? ([['Data', app.text]] as [string, string][]) : []),
        ],
        note: app.reply && !app.conn ? 'A reply that answers nothing anyone asked for.' : undefined,
      });
      break;
  }
  return layers;
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
    case 'congestion':
      return `The link out of ${at} is full, so the ping was dropped. A flood is using up the link.`;
    case 'no-broadcast':
      return `${at} would not forward a ping to a whole network's broadcast address, so it dropped the request.`;
    default:
      return `Dropped at ${at}.`;
  }
}
