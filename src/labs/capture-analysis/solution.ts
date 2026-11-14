import type { LabSolution } from '../solution';
import type { FwRuleInput } from '../../sim/firewall';
import { payloadLen } from '../../sim/tcp';
import { BREAKROOM_PORT, file, firstNo, IP, isEchoRequest, isFloodFrame, isPoison, isRst, isSynAck, KIOSKS, TELNET_PASSWORD, toC2 } from './scenario';

/** Answer key for "The Story in the Capture". Choice answers come from the lab itself. */

const DENY_C2: FwRuleInput = { dir: 'out', proto: 'any', src: 'any', dst: IP.c2, dport: 'any', action: 'deny' };
const kiosks: string[] = KIOSKS.map((k) => IP[k]);
const nos = (id: Parameters<typeof file>[0], pred: Parameters<typeof firstNo>[1]) => file(id).frames.filter(pred).map((c) => c.no);
const telnetStream = () => file('telnet').frames.find((c) => c.frame.ip?.dstPort === 23)!.frame.ip!.tcp!.stream!;
const c2Stream = () => file('night').frames.find((c) => toC2(c.frame))!.frame.ip!.tcp!.stream!;
const floodFrom = () => firstNo('flood', (c) => isFloodFrame(c.frame));

export const captureAnalysisSolution: LabSolution = {
  ticket: { moves: [{ inspect: 'switch' }, { capfile: 'morning' }, { capfile: 'morning', packet: 1 }] },
  normal: { moves: [{ capfile: 'morning', stats: 'endpoints-ip' }, { capfile: 'morning', stats: 'conversations' }] },
  outage: {
    moves: [{ capfile: 'outage', filter: 'tcp.flags.reset == 1' }],
    get text() {
      return { 'cite-rst': String(firstNo('outage', (c) => isRst(c.frame) && c.frame.ip!.src === IP.fares && kiosks.includes(c.frame.ip!.dst))) };
    },
  },
  smurf: {
    moves: [{ capfile: 'noon', stats: 'io' }, { capfile: 'noon', filter: 'icmp' }],
    get text() {
      const [a, b] = nos('noon', (c) => isEchoRequest(c.frame) && c.frame.ip!.dst === IP.broadcast);
      return { 'cite-smurf': `${a}, ${b}` };
    },
  },
  backup: { moves: [{ capfile: 'noon', stats: 'conversations' }, { capfile: 'noon', filter: `ip.addr == ${IP.fares} && ip.addr == ${IP.backup}` }] },
  arp: {
    moves: [{ capfile: 'arp', filter: 'arp.opcode == 2' }, { inspect: 'gw' }],
    get text() {
      const [a, b] = nos('arp', (c) => isPoison(c.frame));
      return { 'cite-arp': `${a} and ${b}` };
    },
  },
  flood: {
    get moves() {
      return [{ capfile: 'flood', stats: 'endpoints-eth' as const }, { capfile: 'flood', packet: floodFrom() }];
    },
    get text() {
      const a = floodFrom() + 500;
      return { 'cite-flood': `${a}-${a + 40}` };
    },
  },
  scan: {
    moves: [{ capfile: 'scan', stats: 'conversations' }, { capfile: 'scan', filter: 'tcp.flags.syn == 1' }],
    get text() {
      return { 'scanner-ip': IP.scanner, 'cite-open': nos('scan', (c) => isSynAck(c.frame) && c.frame.ip!.dst === IP.scanner).join(', ') };
    },
  },
  c2: {
    get moves() {
      return [{ capfile: 'night', stats: 'conversations' as const }, { capfile: 'night', follow: c2Stream() }];
    },
    get text() {
      const orders = nos('night', (c) => c.frame.ip?.src === IP.c2 && payloadLen(c.frame.ip) > 0);
      return { 'c2-ip': IP.c2, 'cite-orders': orders.slice(0, 3).join(', ') };
    },
  },
  fix: {
    moves: [
      { tool: { type: 'port-security', device: 'switch', port: BREAKROOM_PORT, config: { maxMacs: 1, violation: 'shutdown' } } },
      { press: 'replay-flood' },
      { tool: { type: 'fw-add-rule', device: 'gw', rule: DENY_C2, at: 0 } },
      { press: 'replay-checkin' },
    ],
  },
  reflect: {
    text: {
      writeup:
        'The 13:00 file shows ARP poisoning. Packets 151 and 152 are ARP replies saying the router 198.51.100.1 is at 3c:52:82:17:b6:60, the Break-room PC, not the router’s real MAC. A capture is better evidence than a complaint because it shows exactly which device did what, when, with numbers anyone can check.',
    },
  },
  telnet: {
    get moves() {
      return [{ capfile: 'telnet', filter: 'telnet' }, { capfile: 'telnet', follow: telnetStream() }];
    },
    text: { password: TELNET_PASSWORD },
  },
};
