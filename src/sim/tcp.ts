import type { Ip } from './addr';
import type { IpPacket } from './types';

/**
 * TCP flags and scripted TCP sessions (built for capture-analysis).
 *
 * Most of the simulator moves a service connection as one request and one
 * reply (services.ts), which is all a map animation needs. A packet capture
 * needs more: an analyst reads a closed port from a SYN answered by RST, a
 * port scan from a wall of SYNs, and a conversation from its handshake, data,
 * and FIN. So a packet can carry `IpPacket.tcp`, the flags a capture shows.
 * Packets without it (everything older labs send) behave exactly as before.
 *
 * WHAT A FLAGGED PACKET DOES
 *   A TCP packet with `tcp` set is an AppData 'svc' packet (app = the program
 *   inside, reply = sent by the server side). When one arrives (Sim.deliver):
 *   - SYN to a port nothing listens on: the host answers RST, ACK.
 *   - SYN to a listening port (services.ts `serviceAt`): SYN, ACK.
 *   - SYN, ACK with no session waiting for it: RST (what a SYN scanner sends).
 *   - Everything else follows the session's script (below), or is ignored.
 *   Sequence numbers are not modeled: flags and payload lengths only.
 *
 * SESSIONS
 *   Sim.tcpConnect(client, ip, port, script) opens a connection and plays a
 *   script: who says what, in order (`TcpLine`). The client sends SYN (and
 *   tries twice more if nothing answers), both sides take turns sending data
 *   (PSH, ACK) and acknowledging it (ACK), and the client closes with FIN, ACK.
 *   A line with `count` sends that many segments of `len` bytes, for a bulk
 *   transfer such as a backup. `encrypted` hides the text (TLS). A 'tcp' event
 *   fires when the session opens, is refused (RST), gets no answer, or ends.
 *
 *   Sim.tcpSynScan(device, ip, ports, opts) sends a bare SYN to each port, the
 *   way a SYN scan does: closed ports answer RST, open ones SYN, ACK (and the
 *   scanner hangs up with RST).
 *
 * API
 *   flagText(flags)                 "SYN, ACK", the way Wireshark's Info column writes it
 *   payloadLen(pkt)                 bytes of data a packet carries
 *   isHandshakeOnly(pkt)            flags only, no data (a capture shows it as TCP, not TLS or HTTP)
 *   tcpKey(srcIp, sport, dstIp, dport)
 *   Sim: tcpConnect, tcpSynScan, tcpSessions (read only)
 */

export interface TcpFlags {
  syn?: true;
  ack?: true;
  rst?: true;
  fin?: true;
  psh?: true;
}

export interface TcpInfo {
  flags: TcpFlags;
  /** Bytes of data this segment carries. Missing: the length of the packet's text, or 0. */
  len?: number;
  /**
   * Wireshark's stream index: which conversation in a capture file this
   * packet belongs to, counted from 0. Capture files set it (capfile.ts); the
   * network never does.
   */
  stream?: number;
}

/** One thing one side says in a scripted session. */
export interface TcpLine {
  from: 'client' | 'server';
  /** What it says. Shown in the capture and by Follow TCP Stream (unless the session is encrypted). */
  text?: string;
  /** Bytes per segment. Default: the text's length. */
  len?: number;
  /** Send this many segments (a bulk transfer). Default 1. */
  count?: number;
}

export interface TcpScript {
  /** The program inside, as services.ts names it: 'https', 'http', 'telnet', 'rsync', ... */
  app: string;
  /** TLS: a capture shows the data as encrypted. */
  encrypted?: boolean;
  lines?: TcpLine[];
  /** Time between segments of one turn, in ms. Default 20. */
  gapMs?: number;
}

export type TcpState = 'syn-sent' | 'open' | 'closing' | 'done' | 'refused' | 'no-answer';

export interface TcpSession {
  id: number;
  /** The device that opened it. */
  client: string;
  clientIp: Ip;
  sport: number;
  serverIp: Ip;
  dport: number;
  script: TcpScript;
  state: TcpState;
  /** Which turn the conversation is on (a turn is one side's run of lines). */
  turn: number;
  /** Segments of the current turn the listener has received. */
  got: number;
  /** SYNs sent so far. */
  tries: number;
  /** The server has seen the handshake finish (a server that speaks first, like Telnet's login prompt, starts then). */
  greeted?: boolean;
  t: number;
  doneAt?: number;
}

/** One side's run of lines: every segment it sends before the other side speaks. */
export interface TcpTurn {
  from: 'client' | 'server';
  segments: { text?: string; len: number }[];
}

const FLAG_ORDER: (keyof TcpFlags)[] = ['syn', 'fin', 'rst', 'psh', 'ack'];

/** "SYN, ACK", the way Wireshark's Info column lists flags. */
export function flagText(flags: TcpFlags): string {
  return FLAG_ORDER.filter((k) => flags[k])
    .map((k) => k.toUpperCase())
    .join(', ');
}

/** Bytes of data a packet carries. */
export function payloadLen(pkt: IpPacket): number {
  if (pkt.tcp?.len !== undefined) return pkt.tcp.len;
  const a = pkt.app;
  return a.kind === 'svc' && a.text ? a.text.length : 0;
}

/** A packet with TCP flags and no data: a handshake, an ACK, a reset, or a FIN. */
export function isHandshakeOnly(pkt: IpPacket): boolean {
  return !!pkt.tcp && payloadLen(pkt) === 0;
}

export function tcpKey(srcIp: Ip, sport: number | undefined, dstIp: Ip, dport: number | undefined): string {
  return `${srcIp}:${sport ?? ''}>${dstIp}:${dport ?? ''}`;
}

/** Group a script's lines into turns, and each line into its segments. */
export function scriptTurns(script: TcpScript): TcpTurn[] {
  const out: TcpTurn[] = [];
  for (const l of script.lines ?? []) {
    const n = Math.max(1, Math.floor(l.count ?? 1));
    const len = l.len ?? l.text?.length ?? 0;
    const segs = Array.from({ length: n }, () => ({ text: l.text, len }));
    const last = out[out.length - 1];
    if (last && last.from === l.from) last.segments.push(...segs);
    else out.push({ from: l.from, segments: segs });
  }
  return out;
}

/** How many SYNs a client sends before it gives up. */
export const SYN_TRIES = 3;
