import { isIp, prefixContains, type Ip } from './addr';
import { appForPort, appName, identifyApp, isReply, portLabel, type L4 } from './services';
import type { IpPacket, LogEntry, LogLevel } from './types';

/**
 * The firewall engine.
 *
 * WHERE A FIREWALL LIVES
 *   `Device.firewall` holds a FirewallState. It works on two kinds of device:
 *   - kind 'firewall': a standalone two-port box that passes frames between its
 *     ports like a cable (a "transparent" firewall: it has no IP addresses and
 *     changes no routes) but checks every IP packet first. Build one with
 *     `NetBuilder.firewall`, and put it into an existing cable with
 *     `sim.placeFirewall` (take it out with `sim.unplaceFirewall`). Like any
 *     bridge, it drops a switch's flooded copy of a frame meant for a device
 *     on the side it came from, without judging it.
 *   - kind 'router': firewall software inside a router. It checks packets the
 *     router forwards. (Packets addressed to the router itself aren't checked.)
 *
 * DIRECTION
 *   Each firewall has one `outside` port: the side it doesn't trust (toward the
 *   internet, or toward a less trusted zone). A packet that arrives on the
 *   outside port is going **in**. Everything else is going **out**.
 *
 * RULES (an access control list)
 *   `rules` are checked from the top. The first rule whose criteria all match
 *   decides (allow or deny), and no later rule is read. A packet that matches
 *   no rule is denied: the **implicit deny**, shown as the last row of every
 *   rulebook. Criteria: direction, protocol (tcp, udp, icmp, or any), source
 *   and destination ('any', an address, or a network like "10.0.2.0/24"),
 *   destination port, and optionally source port ('any' or a number). A rule
 *   with a port never matches ICMP, which has no ports.
 *
 * MODES (firewall types)
 *   - stateless: every packet is checked against the rules by itself,
 *     replies included. A reply needs a rule of its own.
 *   - stateful:  the firewall keeps a connection table. Only the first packet
 *     of a conversation (a request) is checked against the rules; if allowed,
 *     the conversation goes in the table. A reply passes only if it answers a
 *     conversation in the table. A packet that looks like a reply but answers
 *     nothing is denied, whatever the rules say.
 *   - ngfw:      next-generation: stateful, plus deep packet inspection. It
 *     identifies the application inside a request (`identifyApp`) and denies
 *     one that doesn't match its well-known port (a remote-control tool on 443).
 *
 * WHAT IT REPORTS
 *   For every packet it checks, the sim emits a 'firewall' event with the
 *   FwVerdict, and the firewall writes a log line (source 'firewall') for every
 *   deny, and for allows by rules that set `log`. A denied packet is dropped
 *   with reason 'firewall'. `logLine` builds the log line; `verdictText` and
 *   `ruleText` explain decisions to students.
 *
 * API (pure functions here; Sim methods in sim.ts, section "firewall")
 *   newFirewall(outside, mode?, rules?)    a FirewallState, ready for Device.firewall
 *   ruleMatches(rule, pkt, dir)            does one rule's criteria fit this packet?
 *   firstMatch(rules, pkt, dir)            index of the deciding rule, or -1
 *   evaluate(fw, pkt, dir)                 the verdict, without changing anything
 *   track(fw, pkt, dir, verdict, now)      update the connection table after a verdict
 *   dirOf(fw, ingressPort)                 'in' or 'out'
 *   ruleText(rule) / verdictText(v)        one-line explanations
 *   logLine(pkt, dir, verdict)             the log line a firewall writes
 *   Sim: placeFirewall, unplaceFirewall, fwAddRule, fwEditRule, fwDeleteRule,
 *        fwMoveRule, fwSetMode, fwClearConns, sendPacket
 *   FirewallState.changedAt                sim time rules, type, or placement last
 *                                          changed ("test after your change" goals)
 */

export type FwDir = 'in' | 'out';
export type FwAction = 'allow' | 'deny';
export type FwProto = L4 | 'icmp' | 'any';
export type FwMode = 'stateless' | 'stateful' | 'ngfw';

export interface FwRule {
  /** Stable id ("r3"), kept when the rule moves. Rule *numbers* are positions, counted from 1. */
  id: string;
  dir: FwDir;
  proto: FwProto;
  /** 'any', an address ("203.0.113.66"), or a network ("198.51.100.0/24"). */
  src: string;
  dst: string;
  /** Destination port, or 'any'. */
  dport: number | 'any';
  /** Source port. Left out means any. */
  sport?: number | 'any';
  action: FwAction;
  /** Also log packets this rule allows. (Denies are always logged.) */
  log?: boolean;
  /** What the rule is for, shown in the rule editor. */
  note?: string;
}

export type FwRuleInput = Omit<FwRule, 'id'>;

/** One conversation a stateful firewall is tracking, written from the side that started it. */
export interface FwConn {
  key: string;
  proto: IpPacket['proto'];
  src: Ip;
  sport?: number;
  dst: Ip;
  dport?: number;
  /** Direction of the first packet. */
  dir: FwDir;
  /** The application a next-generation firewall found inside. */
  app?: string;
  /** When it started, and when a packet last used it. */
  t: number;
  last: number;
  /** Packets that matched this entry after the first one. */
  replies: number;
}

/** Where a standalone firewall was put, so it can be taken out again. */
export interface FwPlacement {
  a: { device: string; iface: string };
  b: { device: string; iface: string };
  /** Where it sat on the map before. */
  home: { x: number; y: number };
}

export interface FirewallState {
  /** The port facing the untrusted side. Packets arriving here are inbound. */
  outside: string;
  mode: FwMode;
  rules: FwRule[];
  /** Stateful and next-gen only: tracked conversations, oldest first. */
  conns: FwConn[];
  /** Next rule id number. */
  nextId: number;
  placed?: FwPlacement;
  /** Sim time of the last change to its rules, type, or placement. Goals use it for "tested since your last change". */
  changedAt?: number;
}

export type FwDecidedBy =
  /** A rule matched. */
  | 'rule'
  /** No rule matched. */
  | 'implicit'
  /** Stateful: a reply to a conversation in the connection table. */
  | 'state'
  /** Stateful: looked like a reply, but answers no conversation in the table. */
  | 'no-state'
  /** Next-gen: a rule allowed it, but the application inside doesn't match the port. */
  | 'app';

export interface FwVerdict {
  action: FwAction;
  by: FwDecidedBy;
  /** Position (1 = top) of the rule that matched, when one did. */
  ruleNo?: number;
  ruleId?: string;
  /** Next-gen: the application found inside, and the one the port promises. */
  app?: string;
  expected?: string;
}

/** Conversations a stateful firewall remembers. Entries don't time out in the simulation; the oldest go first. */
export const MAX_FW_CONNS = 64;

export function newFirewall(outside: string, mode: FwMode = 'stateful', rules: FwRuleInput[] = []): FirewallState {
  const fw: FirewallState = { outside, mode, rules: [], conns: [], nextId: 1 };
  for (const r of rules) fw.rules.push({ ...r, id: `r${fw.nextId++}` });
  return fw;
}

export function dirOf(fw: FirewallState, ingress: string): FwDir {
  return ingress === fw.outside ? 'in' : 'out';
}

/** 'any', an exact address, or a network that contains the address. */
export function addrMatches(spec: string, ip: Ip): boolean {
  if (spec === 'any') return true;
  if (isIp(spec)) return spec === ip;
  return prefixContains(spec, ip);
}

function portMatches(spec: number | 'any' | undefined, port: number | undefined): boolean {
  if (spec === undefined || spec === 'any') return true;
  return port === spec;
}

export function ruleMatches(rule: FwRule | FwRuleInput, pkt: IpPacket, dir: FwDir): boolean {
  if (rule.dir !== dir) return false;
  if (rule.proto !== 'any' && rule.proto !== pkt.proto) return false;
  if (!addrMatches(rule.src, pkt.src) || !addrMatches(rule.dst, pkt.dst)) return false;
  if (!portMatches(rule.dport, pkt.dstPort)) return false;
  if (!portMatches(rule.sport, pkt.srcPort)) return false;
  return true;
}

/** Index of the first rule that matches, or -1 (the implicit deny). */
export function firstMatch(rules: (FwRule | FwRuleInput)[], pkt: IpPacket, dir: FwDir): number {
  return rules.findIndex((r) => ruleMatches(r, pkt, dir));
}

/** The conversation a packet starts, or would answer, as a table key. */
function convKey(proto: IpPacket['proto'], src: Ip, sport: number | string | undefined, dst: Ip, dport: number | string | undefined): string {
  return `${proto} ${src}:${sport ?? ''} > ${dst}:${dport ?? ''}`;
}

function pingId(pkt: IpPacket): string | undefined {
  return pkt.app.kind === 'ping' ? `#${pkt.app.seq}` : undefined;
}

/** Key for the conversation this packet starts. */
export function connKey(pkt: IpPacket): string {
  const id = pingId(pkt);
  return id ? convKey(pkt.proto, pkt.src, id, pkt.dst, id) : convKey(pkt.proto, pkt.src, pkt.srcPort, pkt.dst, pkt.dstPort);
}

/** Key for the conversation this packet (a reply) answers. */
export function replyKey(pkt: IpPacket): string {
  const id = pingId(pkt);
  return id ? convKey(pkt.proto, pkt.dst, id, pkt.src, id) : convKey(pkt.proto, pkt.dst, pkt.dstPort, pkt.src, pkt.srcPort);
}

/** The verdict for one packet. Pure: reads the rules and connection table, changes nothing. */
export function evaluate(fw: FirewallState, pkt: IpPacket, dir: FwDir): FwVerdict {
  if (fw.mode !== 'stateless' && isReply(pkt)) {
    const key = replyKey(pkt);
    return fw.conns.some((c) => c.key === key) ? { action: 'allow', by: 'state' } : { action: 'deny', by: 'no-state' };
  }
  const i = firstMatch(fw.rules, pkt, dir);
  if (i < 0) return { action: 'deny', by: 'implicit' };
  const rule = fw.rules[i];
  const v: FwVerdict = { action: rule.action, by: 'rule', ruleNo: i + 1, ruleId: rule.id };
  if (fw.mode === 'ngfw' && v.action === 'allow' && pkt.proto !== 'icmp') {
    const app = identifyApp(pkt);
    const expected = appForPort(pkt.proto, pkt.dstPort);
    if (app && expected && app !== expected) return { ...v, action: 'deny', by: 'app', app, expected };
  }
  return v;
}

/** After a verdict: remember a newly allowed conversation, or note a reply that used one. */
export function track(fw: FirewallState, pkt: IpPacket, dir: FwDir, v: FwVerdict, now: number): void {
  if (fw.mode === 'stateless' || v.action !== 'allow') return;
  if (v.by === 'state') {
    const c = fw.conns.find((x) => x.key === replyKey(pkt));
    if (c) {
      c.last = now;
      c.replies++;
    }
    return;
  }
  const key = connKey(pkt);
  const old = fw.conns.find((c) => c.key === key);
  if (old) {
    old.last = now;
    return;
  }
  fw.conns.push({
    key,
    proto: pkt.proto,
    src: pkt.src,
    sport: pkt.srcPort,
    dst: pkt.dst,
    dport: pkt.dstPort,
    dir,
    app: fw.mode === 'ngfw' ? identifyApp(pkt) : undefined,
    t: now,
    last: now,
    replies: 0,
  });
  if (fw.conns.length > MAX_FW_CONNS) fw.conns.splice(0, fw.conns.length - MAX_FW_CONNS);
}

// ---------------------------------------------------------------------------
// Words: rules, verdicts, and log lines
// ---------------------------------------------------------------------------

export const MODE_NAME: Record<FwMode, string> = {
  stateless: 'Stateless',
  stateful: 'Stateful',
  ngfw: 'Next-generation',
};

const PROTO_TEXT: Record<FwProto, string> = { tcp: 'TCP', udp: 'UDP', icmp: 'ICMP', any: 'any' };

export function protoText(p: FwProto): string {
  return PROTO_TEXT[p];
}

/** "443 (HTTPS)", "any". */
export function portText(p: number | 'any' | undefined, proto: FwProto = 'tcp'): string {
  if (p === undefined || p === 'any') return 'any';
  return portLabel(p, proto === 'udp' ? 'udp' : 'tcp');
}

/** "ALLOW in TCP from any to 10.0.1.10 port 443 (HTTPS)". */
export function ruleText(r: FwRule | FwRuleInput): string {
  const from = r.sport !== undefined && r.sport !== 'any' ? `${r.src} port ${portText(r.sport, r.proto)}` : r.src;
  const to = r.proto === 'icmp' || r.dport === 'any' ? r.dst : `${r.dst} port ${portText(r.dport, r.proto)}`;
  return `${r.action.toUpperCase()} ${r.dir} ${r.proto === 'any' ? 'any protocol' : protoText(r.proto)} from ${from} to ${to}`;
}

/** Why a packet was allowed or denied, for students. Pass the rulebook to quote the rule. */
export function verdictText(v: FwVerdict, rules?: FwRule[]): string {
  const rule = v.ruleId ? rules?.find((r) => r.id === v.ruleId) : undefined;
  const quoted = rule ? `: ${ruleText(rule)}` : '';
  switch (v.by) {
    case 'rule':
      return `${v.action === 'allow' ? 'Allowed' : 'Denied'} by rule ${v.ruleNo}${quoted}`;
    case 'implicit':
      return 'Denied: no rule matched, so the implicit deny blocked it';
    case 'state':
      return 'Allowed: it answers a conversation in the connection table';
    case 'no-state':
      return 'Denied: it looks like a reply, but it answers no conversation in the connection table';
    case 'app':
      return `Denied: rule ${v.ruleNo} allows port ${v.expected ? appName(v.expected) : ''}, but the program inside is ${appName(v.app ?? '?')}`;
  }
}

function endpoint(ip: Ip, port: number | undefined): string {
  return port === undefined ? ip : `${ip}:${port}`;
}

/**
 * The line a firewall writes to its log, in the style of a real one:
 * "DENY in TCP 203.0.113.66:49200 -> 10.0.1.10:22 rule 3".
 * Fields: action, dir, proto, src, dst, sport, dport, rule (number, or
 * 'implicit', 'state', 'no-state'), and app/expected for next-gen denies.
 */
export function logLine(pkt: IpPacket, dir: FwDir, v: FwVerdict): Omit<LogEntry, 'no' | 't' | 'device'> {
  const proto = pkt.proto.toUpperCase();
  const what = pkt.app.kind === 'ping' ? (pkt.app.reply ? ' echo-reply' : ' echo-request') : '';
  const why =
    v.by === 'rule'
      ? `rule ${v.ruleNo}`
      : v.by === 'implicit'
        ? 'implicit deny'
        : v.by === 'state'
          ? 'established'
          : v.by === 'no-state'
            ? 'no matching connection'
            : `app ${v.app} on port ${pkt.dstPort} (expected ${v.expected}) rule ${v.ruleNo}`;
  const level: LogLevel = v.by === 'app' ? 'warn' : v.action === 'deny' ? 'notice' : 'info';
  const fields: Record<string, string | number> = {
    action: v.action,
    dir,
    proto: pkt.proto,
    src: pkt.src,
    dst: pkt.dst,
    rule: v.by === 'rule' || v.by === 'app' ? (v.ruleNo ?? 0) : v.by,
  };
  if (pkt.srcPort !== undefined) fields.sport = pkt.srcPort;
  if (pkt.dstPort !== undefined) fields.dport = pkt.dstPort;
  if (v.app) fields.app = v.app;
  if (v.expected) fields.expected = v.expected;
  return {
    source: 'firewall',
    level,
    msg: `${v.action.toUpperCase()} ${dir} ${proto} ${endpoint(pkt.src, pkt.srcPort)} -> ${endpoint(pkt.dst, pkt.dstPort)}${what} ${why}`,
    fields,
  };
}
