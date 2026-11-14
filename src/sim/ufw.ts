import { isIp, isPrefix, normalizePrefix, type Ip } from './addr';
import { firstMatch, type FirewallState, type FwAction, type FwDir, type FwProto, type FwRule, type FwRuleInput, type FwVerdict } from './firewall';
import type { IpPacket, LogEntry } from './types';

/**
 * ufw ("uncomplicated firewall"), the host firewall on Ubuntu (device-analysis).
 *
 * A Linux server's firewall is a `FirewallState` on the server itself
 * (`Device.firewall`, with `Device.linux` set; see linux.ts). Its direction is
 * the server's own: **in** is a packet arriving for the server, **out** is a
 * packet the server starts. Rules are checked from the top, first match wins,
 * like every firewall in NetLab. What no rule matches gets the **default
 * policy**: deny incoming, allow outgoing (`UfwPolicy`).
 *
 * This module is the command and the words:
 *   parseUfw(args)              read `ufw ...` the way ufw 0.36 does
 *   ufwApply(fw, op)            what the command would do to the rule list
 *   ufwStatus(fw, policy, ...)  `ufw status [numbered|verbose]`, as printed
 *   ufwRuleText(rule)           a rule as the command that makes it ("allow 22/tcp")
 *   ufwColumns(rule)            a rule's To / Action / From columns
 *   ufwLogLine(pkt, dir, ...)   "[UFW BLOCK] IN=eth0 OUT= SRC=... DPT=25 ... SYN"
 *   hostVerdict(fw, pkt, dir)   the verdict with the default policy applied
 *
 * Simplified on purpose: no IPv6 copies of rules, no `reject` or `limit`, no
 * port ranges or application profiles, and `ufw delete` doesn't stop to ask
 * "Proceed with operation (y|n)?". ufw writes a log line for every packet it
 * blocks (a real one logs the default policy's blocks, and rules marked `log`).
 */

export interface UfwPolicy {
  in: FwAction;
  out: FwAction;
}

export const UFW_DEFAULT: UfwPolicy = { in: 'deny', out: 'allow' };

export type UfwOp =
  | { op: 'status'; numbered: boolean; verbose: boolean }
  /** Add a rule. `at` is ufw's insert position, counted from 1; without it the rule goes at the bottom. */
  | { op: 'add'; rule: FwRuleInput; at?: number }
  | { op: 'delete-n'; n: number }
  | { op: 'delete-rule'; rule: FwRuleInput };

export type UfwParse = { ok: true; op: UfwOp } | { ok: false; msg: string };

/** Service names ufw reads from /etc/services. */
export const UFW_NAMES: Record<string, { port: number; proto: 'tcp' | 'udp' }> = {
  ftp: { port: 21, proto: 'tcp' },
  ssh: { port: 22, proto: 'tcp' },
  telnet: { port: 23, proto: 'tcp' },
  smtp: { port: 25, proto: 'tcp' },
  http: { port: 80, proto: 'tcp' },
  https: { port: 443, proto: 'tcp' },
  'microsoft-ds': { port: 445, proto: 'tcp' },
  mysql: { port: 3306, proto: 'tcp' },
  'ms-wbt-server': { port: 3389, proto: 'tcp' },
  rfb: { port: 5900, proto: 'tcp' },
};

const SHAPES = 'Type it like this: ufw deny from 203.0.113.9, or ufw allow from 192.0.2.0/24 to any port 22.';

const bad = (msg: string): UfwParse => ({ ok: false, msg });

function port(s: string | undefined): { port: number; proto?: 'tcp' | 'udp' } | undefined {
  if (!s) return undefined;
  const named = UFW_NAMES[s.toLowerCase()];
  if (named) return named;
  const m = /^(\d{1,5})(?:\/(tcp|udp))?$/i.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n < 1 || n > 65535) return undefined;
  return { port: n, proto: m[2]?.toLowerCase() as 'tcp' | 'udp' | undefined };
}

function addr(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (s.toLowerCase() === 'any') return 'any';
  if (isIp(s)) return s;
  if (s.includes('/') && isPrefix(s)) {
    const n = normalizePrefix(s);
    return n.endsWith('/32') ? n.slice(0, -3) : n;
  }
  return undefined;
}

/** "203.0.113" is missing a number; "203.0.113.300" has one too big. */
function addrHint(s: string): string {
  if (/^[\d.]+$/.test(s)) {
    const parts = s.split('.');
    if (parts.length !== 4) return `“${s}” isn't a whole address: write four numbers with dots between them, like 203.0.113.9.`;
    return `“${s}” isn't an address: each of the four numbers goes from 0 to 255.`;
  }
  if (s.includes('/')) return `“${s}” isn't a network. Write one like 192.0.2.0/24.`;
  return `“${s}” isn't an address. Write an address like 203.0.113.9, a network like 192.0.2.0/24, or any.`;
}

/** The rule part of `ufw allow ...` / `ufw deny ...` (after the action). */
function parseRule(action: FwAction, words: string[]): { ok: true; rule: FwRuleInput } | { ok: false; msg: string } {
  let dir: FwDir = 'in';
  let i = 0;
  if (words[i] === 'in' || words[i] === 'out') dir = words[i++] as FwDir;
  // "on eth0": this server has one interface, so it changes nothing.
  if (words[i] === 'on') i += 2;
  const rest = words.slice(i);
  if (!rest.length) return { ok: false, msg: `ERROR: Wrong number of arguments. Say what to ${action}. ${SHAPES}` };
  // The short form: ufw allow 22/tcp, ufw deny ssh.
  if (rest.length === 1 && !['from', 'to', 'proto'].includes(rest[0])) {
    const p = port(rest[0]);
    if (p) return { ok: true, rule: { dir, proto: p.proto ?? 'any', src: 'any', dst: 'any', dport: p.port, action } };
    const a = addr(rest[0]);
    if (a) return { ok: false, msg: `ERROR: Invalid syntax. To ${action} a computer, write from before its address: ufw ${action} from ${rest[0]}` };
    return { ok: false, msg: `ERROR: Bad port. “${rest[0]}” isn't a port. Write a number like 22, or 22/tcp.` };
  }
  let src = 'any';
  let dst = 'any';
  let sport: number | undefined;
  let dport: number | undefined;
  let proto: FwProto = 'any';
  let note: string | undefined;
  let saw = false;
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k];
    if (w === 'from' || w === 'to') {
      saw = true;
      const raw = rest[k + 1];
      const a = addr(raw);
      if (!raw) return { ok: false, msg: `ERROR: Wrong number of arguments. Put an address after ${w}, or any.` };
      if (!a) return { ok: false, msg: `ERROR: Bad ${w === 'from' ? 'source' : 'destination'} address. ${addrHint(raw)}` };
      if (w === 'from') src = a;
      else dst = a;
      k++;
      if (rest[k + 1] === 'port') {
        const p = port(rest[k + 2]);
        if (!p) return { ok: false, msg: `ERROR: Bad port. ${rest[k + 2] ? `“${rest[k + 2]}” isn't a port.` : 'Put a port number after port.'} Write a number like 22.` };
        if (p.proto) proto = p.proto;
        if (w === 'from') sport = p.port;
        else dport = p.port;
        k += 2;
      }
    } else if (w === 'proto') {
      const p = rest[k + 1];
      if (p !== 'tcp' && p !== 'udp' && p !== 'icmp') return { ok: false, msg: `ERROR: Unsupported protocol '${p ?? ''}'. Write proto tcp or proto udp.` };
      proto = p;
      k++;
    } else if (w === 'comment') {
      note = rest
        .slice(k + 1)
        .join(' ')
        .replace(/^['"]|['"]$/g, '');
      break;
    } else if (w === 'port') {
      return { ok: false, msg: `ERROR: Invalid syntax. A port goes after an address: to any port ${rest[k + 1] ?? '22'}.` };
    } else {
      return { ok: false, msg: `ERROR: Invalid syntax. ufw didn't expect “${w}” there. ${SHAPES}` };
    }
  }
  if (!saw) return { ok: false, msg: `ERROR: Invalid syntax. ${SHAPES}` };
  const rule: FwRuleInput = { dir, proto, src, dst, dport: dport ?? 'any', action };
  if (sport !== undefined) rule.sport = sport;
  if (note) rule.note = note;
  return { ok: true, rule };
}

/** Read the words after `ufw` (already split on spaces, lower case except a comment). */
export function parseUfw(args: string[]): UfwParse {
  const w = args.map((a, i) => (args.slice(0, i).includes('comment') ? a : a.toLowerCase()));
  if (!w.length) return bad('Usage: ufw COMMAND. Try ufw status numbered.');
  switch (w[0]) {
    case 'status': {
      if (w.length > 2 || (w[1] && w[1] !== 'numbered' && w[1] !== 'verbose')) return bad(`ERROR: Invalid syntax. Type ufw status, ufw status numbered, or ufw status verbose.`);
      return { ok: true, op: { op: 'status', numbered: w[1] === 'numbered', verbose: w[1] === 'verbose' } };
    }
    case 'allow':
    case 'deny': {
      const r = parseRule(w[0], w.slice(1));
      return r.ok ? { ok: true, op: { op: 'add', rule: r.rule } } : bad(r.msg);
    }
    case 'insert':
    case 'prepend': {
      const pre = w[0] === 'prepend';
      const n = pre ? 1 : Number(w[1]);
      if (!pre && !/^\d+$/.test(w[1] ?? '')) return bad(`ERROR: Insert position must be a number. Type it like this: ufw insert 1 deny from 203.0.113.9`);
      const verb = w[pre ? 1 : 2];
      if (verb === 'reject' || verb === 'limit') return bad(unsupported(verb));
      if (verb !== 'allow' && verb !== 'deny') return bad(`ERROR: Invalid syntax. After ufw insert ${n}, write allow or deny, then the rule.`);
      if (n < 1) return bad(`ERROR: Invalid position '${w[1]}'. Rule numbers start at 1.`);
      const r = parseRule(verb, w.slice(pre ? 2 : 3));
      return r.ok ? { ok: true, op: { op: 'add', rule: r.rule, at: n } } : bad(r.msg);
    }
    case 'delete': {
      if (/^\d+$/.test(w[1] ?? '')) {
        if (w.length > 2) return bad('ERROR: Wrong number of arguments. Delete one rule at a time: ufw delete 3');
        return { ok: true, op: { op: 'delete-n', n: Number(w[1]) } };
      }
      if (w[1] === 'allow' || w[1] === 'deny') {
        const r = parseRule(w[1], w.slice(2));
        return r.ok ? { ok: true, op: { op: 'delete-rule', rule: r.rule } } : bad(r.msg);
      }
      return bad('ERROR: Invalid syntax. Delete by number, like ufw delete 3. Run ufw status numbered to see the numbers.');
    }
    case 'reject':
    case 'limit':
      return bad(unsupported(w[0]));
    case 'enable':
    case 'disable':
    case 'reset':
      return bad(`This lab keeps the firewall on and its rules in place. Change one rule at a time with allow, deny, insert, and delete.`);
    case 'reload':
      return bad('ufw applies each change as soon as you type it here, so there is nothing to reload.');
    case 'default':
    case 'logging':
    case 'app':
    case 'show':
    case 'route':
      return bad(`This ufw doesn't do ufw ${w[0]} in this lab. It shows rules (ufw status numbered) and changes them (allow, deny, insert, delete).`);
    default:
      return bad(`ERROR: Invalid syntax. ufw doesn't know “${args[0]}”. Try ufw status numbered, ufw deny from <address>, ufw insert <number> ..., or ufw delete <number>.`);
  }
}

function unsupported(verb: string): string {
  return verb === 'limit'
    ? 'This ufw has no limit rules in this lab. Use allow and deny.'
    : 'This ufw has no reject rules in this lab. Use deny: it drops the packet without an answer.';
}

// ---------------------------------------------------------------------------
// Changing the rules
// ---------------------------------------------------------------------------

export const sameCriteria = (a: FwRuleInput, b: FwRuleInput): boolean =>
  a.dir === b.dir && a.proto === b.proto && a.src === b.src && a.dst === b.dst && a.dport === b.dport && (a.sport ?? 'any') === (b.sport ?? 'any');

/** What a command does to the rules, before it happens. `index` counts from 0. */
export type UfwEffect =
  | { kind: 'added'; index: number }
  | { kind: 'inserted'; index: number }
  | { kind: 'updated'; id: string; index: number }
  | { kind: 'skipped'; index: number; inserting: boolean }
  | { kind: 'deleted'; id: string; index: number; rule: FwRule }
  | { kind: 'error'; msg: string };

/** Decide what an add or delete does to `fw`'s rules (pure: changes nothing). */
export function ufwEffect(fw: FirewallState, op: Exclude<UfwOp, { op: 'status' }>): UfwEffect {
  const rules = fw.rules;
  switch (op.op) {
    case 'add': {
      const same = rules.findIndex((r) => sameCriteria(r, op.rule));
      if (op.at !== undefined && op.at > rules.length) return { kind: 'error', msg: `ERROR: Invalid position '${op.at}'` };
      if (same >= 0 && rules[same].action === op.rule.action) return { kind: 'skipped', index: same, inserting: op.at !== undefined };
      if (same >= 0) return { kind: 'updated', id: rules[same].id, index: same };
      return op.at !== undefined ? { kind: 'inserted', index: op.at - 1 } : { kind: 'added', index: rules.length };
    }
    case 'delete-n': {
      const r = rules[op.n - 1];
      if (!r) return { kind: 'error', msg: `ERROR: Could not find rule '${op.n}'` };
      return { kind: 'deleted', id: r.id, index: op.n - 1, rule: r };
    }
    case 'delete-rule': {
      const i = rules.findIndex((r) => sameCriteria(r, op.rule) && r.action === op.rule.action);
      if (i < 0) return { kind: 'error', msg: 'Could not delete non-existent rule' };
      return { kind: 'deleted', id: rules[i].id, index: i, rule: rules[i] };
    }
  }
}

/** What ufw prints for an effect. */
export function ufwEffectLines(e: UfwEffect): string[] {
  switch (e.kind) {
    case 'added':
      return ['Rule added'];
    case 'inserted':
      return ['Rule inserted'];
    case 'updated':
      return ['Rule updated'];
    case 'skipped':
      return [e.inserting ? 'Skipping inserting existing rule' : 'Skipping adding existing rule'];
    case 'deleted':
      return ['Deleting:', ` ${ufwRuleText(e.rule)}`, 'Rule deleted'];
    case 'error':
      return [e.msg];
  }
}

// ---------------------------------------------------------------------------
// Words: rules as ufw prints them
// ---------------------------------------------------------------------------

function portPart(p: number | 'any' | undefined, proto: FwProto): string {
  if (p === undefined || p === 'any') return '';
  return proto === 'tcp' || proto === 'udp' ? `${p}/${proto}` : `${p}`;
}

/** A rule as the command that makes it: "allow 22/tcp", "deny from 203.0.113.140 to any port 22 proto tcp". */
export function ufwRuleText(r: FwRuleInput): string {
  const out = r.dir === 'out' ? ' out' : '';
  const note = r.note ? ` comment '${r.note}'` : '';
  const sport = r.sport !== undefined && r.sport !== 'any';
  if (r.src === 'any' && r.dst === 'any' && r.dport !== 'any' && !sport) return `${r.action}${out} ${portPart(r.dport, r.proto)}${note}`;
  const from = `from ${r.src}${sport ? ` port ${r.sport}` : ''}`;
  const to = `to ${r.dst}${r.dport !== 'any' ? ` port ${r.dport}` : ''}`;
  const proto = r.proto !== 'any' ? ` proto ${r.proto}` : '';
  return `${r.action}${out} ${from} ${to}${proto}${note}`;
}

const where = (a: string): string => (a === 'any' ? 'Anywhere' : a);

/** The To, Action, and From columns of `ufw status`. `numbered` writes "ALLOW IN" where plain status writes "ALLOW". */
export function ufwColumns(r: FwRuleInput, numbered = true): { to: string; action: string; from: string; tail: string } {
  const p = portPart(r.dport, r.proto);
  const sp = r.sport !== undefined && r.sport !== 'any' ? portPart(r.sport, r.proto) : '';
  const to = r.dst === 'any' ? p || (r.proto !== 'any' ? `Anywhere/${r.proto}` : 'Anywhere') : p ? `${r.dst} ${p}` : r.dst;
  const from = sp ? `${where(r.src)} ${sp}` : where(r.src);
  const action = `${r.action.toUpperCase()}${r.dir === 'out' ? ' OUT' : numbered ? ' IN' : ''}`;
  const tail = `${r.dir === 'out' ? '(out)' : ''}${r.note ? `${r.dir === 'out' ? ' ' : ''}# ${r.note}` : ''}`;
  return { to, action, from, tail };
}

/** `ufw status`, `ufw status numbered`, `ufw status verbose`, line by line. */
export function ufwStatus(fw: FirewallState, policy: UfwPolicy, how: { numbered?: boolean; verbose?: boolean } = {}): string[] {
  const out = ['Status: active'];
  if (how.verbose) {
    out.push('Logging: on (low)', `Default: ${policy.in} (incoming), ${policy.out} (outgoing), disabled (routed)`, 'New profiles: skip');
  }
  out.push('');
  const lead = how.numbered ? '     ' : '';
  out.push(`${lead}${'To'.padEnd(27)}${'Action'.padEnd(12)}From`, `${lead}${'--'.padEnd(27)}${'------'.padEnd(12)}----`);
  fw.rules.forEach((r, i) => {
    const c = ufwColumns(r, !!how.numbered);
    const num = how.numbered ? `[${String(i + 1).padStart(2)}] ` : '';
    const line = `${num}${c.to.padEnd(27)}${c.action.padEnd(12)}${c.tail ? c.from.padEnd(27) : c.from}${c.tail}`;
    out.push(line.trimEnd());
  });
  out.push('');
  return out;
}

/** The verdict, with the default policy deciding what no rule matches. Pure. */
export function hostVerdict(fw: FirewallState, pkt: IpPacket, dir: FwDir, policy: UfwPolicy): FwVerdict {
  const i = firstMatch(fw.rules, pkt, dir);
  if (i < 0) return { action: policy[dir], by: 'implicit' };
  const r = fw.rules[i];
  return { action: r.action, by: 'rule', ruleNo: i + 1, ruleId: r.id };
}

// ---------------------------------------------------------------------------
// The log line
// ---------------------------------------------------------------------------

/**
 * The kernel's line for a packet ufw blocked, as Ubuntu writes it to
 * /var/log/ufw.log (without the MAC addresses and a few header fields):
 *   [UFW BLOCK] IN=eth0 OUT= SRC=203.0.113.140 DST=198.51.100.10 LEN=44 TTL=49 PROTO=TCP SPT=48211 DPT=25 WINDOW=1024 SYN URGP=0
 * `scan` marks an nmap probe: its packets are 44 bytes with a 1024-byte window.
 */
export function ufwBlockText(p: { iface: string; dir: FwDir; src: Ip; dst: Ip; proto: string; ttl: number; sport?: number; dport?: number; scan?: boolean; icmp?: { type: number; seq: number } }): string {
  const io = p.dir === 'in' ? `IN=${p.iface} OUT=` : `IN= OUT=${p.iface}`;
  const head = `[UFW BLOCK] ${io} SRC=${p.src} DST=${p.dst}`;
  if (p.proto === 'icmp') return `${head} LEN=84 TTL=${p.ttl} PROTO=ICMP TYPE=${p.icmp?.type ?? 8} CODE=0 ID=${1000 + (p.icmp?.seq ?? 0)} SEQ=${p.icmp?.seq ?? 1}`;
  if (p.proto === 'udp') return `${head} LEN=76 TTL=${p.ttl} PROTO=UDP SPT=${p.sport ?? 0} DPT=${p.dport ?? 0} LEN=56`;
  const len = p.scan ? 44 : 60;
  const win = p.scan ? 1024 : 64240;
  return `${head} LEN=${len} TTL=${p.ttl} PROTO=TCP SPT=${p.sport ?? 0} DPT=${p.dport ?? 0} WINDOW=${win} SYN URGP=0`;
}

/** The log entry for one blocked packet (file 'ufw', program 'kernel'). Fields carry the facts. */
export function ufwLogLine(iface: string, pkt: IpPacket, dir: FwDir, v: FwVerdict, scan = false): Omit<LogEntry, 'no' | 't' | 'device'> {
  const icmp = pkt.app.kind === 'ping' ? { type: pkt.app.reply ? 0 : 8, seq: pkt.app.seq } : undefined;
  const msg = ufwBlockText({ iface, dir, src: pkt.src, dst: pkt.dst, proto: pkt.proto, ttl: pkt.ttl, sport: pkt.srcPort, dport: pkt.dstPort, scan, icmp });
  const fields: Record<string, string | number> = { file: 'ufw', prog: 'kernel', action: 'deny', dir, proto: pkt.proto, src: pkt.src, dst: pkt.dst, rule: v.by === 'rule' ? (v.ruleNo ?? 0) : 'policy' };
  if (pkt.srcPort !== undefined) fields.sport = pkt.srcPort;
  if (pkt.dstPort !== undefined) fields.dport = pkt.dstPort;
  if (v.ruleId) fields.ruleId = v.ruleId;
  return { source: 'ufw', level: 'notice', msg, fields };
}
