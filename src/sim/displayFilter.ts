import { ipToInt, isIp } from './addr';
import { dhcpIps, fromClient } from './dhcp';
import type { Frame } from './types';

/**
 * Display filters (packet-capture): a small part of Wireshark's filter
 * language, so what students type here works in Wireshark too.
 *
 *   dns                         a protocol name: packets that contain it
 *   ip.addr == 192.168.1.10     either end (ip.src, ip.dst for one end)
 *   ip.addr == 192.168.1.0/24   anything on that network
 *   tcp.port == 443             either port (tcp.srcport, tcp.dstport; udp.* too)
 *   dns.qry.name contains "school"
 *   !arp    dns || http    dns && ip.addr == 192.0.2.53    (dns || http) && !tls
 *
 * Words work too: and, or, not, eq, ne, gt, lt, ge, le. As in Wireshark,
 * names are lowercase, a test on a field the packet doesn't have is false
 * (so `ip.addr != X` skips ARP), and `!=` means "no value equals".
 *
 * Mistakes come back as a message in plain words, written for students who
 * know NetLab's names: "ping" points to icmp, "https" to tls.
 */

export type FilterOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains';

type Value = { kind: 'ip'; net: number; bits: number } | { kind: 'mac'; mac: string } | { kind: 'num'; n: number } | { kind: 'str'; s: string };

export type FilterNode =
  | { kind: 'and' | 'or'; a: FilterNode; b: FilterNode }
  | { kind: 'not'; a: FilterNode }
  /** A protocol name or field on its own: the packet has it. */
  | { kind: 'has'; name: string }
  | { kind: 'cmp'; field: string; op: FilterOp; value: Value };

export type FilterResult = { ok: true; node: FilterNode | null } | { ok: false; msg: string };

// ---------------------------------------------------------------------------
// What a frame contains, in Wireshark's names
// ---------------------------------------------------------------------------

/** Wireshark's protocol name for the program inside a service connection (services.ts). */
const SVC_PROTO: Record<string, string[]> = {
  https: ['tls'],
  http: ['http'],
  ssh: ['ssh'],
  telnet: ['telnet'],
  smb: ['smb2'],
  // Printing (IPP) travels inside HTTP; Wireshark lists both.
  ipp: ['http', 'ipp'],
  dns: ['dns'],
};

/** The protocols in a frame, outermost first, by the names Wireshark's filters use. */
export function protocolsOf(f: Frame): string[] {
  const out = ['eth'];
  if (f.arp) return [...out, 'arp'];
  if (f.bgp) return [...out, 'bgp'];
  if (f.dhcp) return [...out, 'ip', 'udp', 'dhcp'];
  const ip = f.ip;
  if (!ip) return out;
  out.push('ip', ip.proto);
  const app = ip.app;
  switch (app.kind) {
    case 'ping':
      break;
    case 'dns-query':
    case 'dns-answer':
      out.push('dns');
      break;
    case 'http-req':
    case 'http-res':
      out.push(ip.encrypted ? 'tls' : 'http');
      break;
    case 'svc':
      if (!(app.reply && app.status === 'closed')) out.push(...(SVC_PROTO[app.app] ?? (ip.encrypted ? ['tls'] : [])));
      break;
  }
  return out;
}

/** Other names Wireshark accepts for the same protocol. */
const ALIAS: Record<string, string> = { bootp: 'dhcp', ssl: 'tls', smb: 'smb2' };

const PROTOCOLS = new Set(['eth', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'dns', 'dhcp', 'http', 'tls', 'ipp', 'ssh', 'smb2', 'telnet', 'bgp']);

type FieldType = 'ip' | 'mac' | 'num' | 'str' | 'flag';

interface FieldDef {
  type: FieldType;
  /** Every value the field has in this frame (none: the frame doesn't have the field). */
  get: (f: Frame) => (string | number)[];
}

function ips(f: Frame): { src: string; dst: string } | undefined {
  if (f.ip) return { src: f.ip.src, dst: f.ip.dst };
  if (f.dhcp) return dhcpIps(f.dhcp);
  return undefined;
}

function ports(f: Frame, proto: 'tcp' | 'udp'): { src: number; dst: number } | undefined {
  if (f.dhcp) return proto === 'udp' ? (fromClient(f.dhcp) ? { src: 68, dst: 67 } : { src: 67, dst: 68 }) : undefined;
  const ip = f.ip;
  if (!ip || ip.proto !== proto || ip.srcPort === undefined || ip.dstPort === undefined) return undefined;
  return { src: ip.srcPort, dst: ip.dstPort };
}

const both = <T,>(x: { src: T; dst: T } | undefined): T[] => (x ? [x.src, x.dst] : []);
const one = <T,>(x: T | undefined | null): T[] => (x === undefined || x === null ? [] : [x]);

function httpReq(f: Frame) {
  const a = f.ip?.app;
  return a?.kind === 'http-req' && !f.ip!.encrypted ? a : undefined;
}
function httpRes(f: Frame) {
  const a = f.ip?.app;
  return a?.kind === 'http-res' && !f.ip!.encrypted ? a : undefined;
}

const FIELDS: Record<string, FieldDef> = {
  'ip.addr': { type: 'ip', get: (f) => both(ips(f)) },
  'ip.src': { type: 'ip', get: (f) => one(ips(f)?.src) },
  'ip.dst': { type: 'ip', get: (f) => one(ips(f)?.dst) },
  'ip.ttl': { type: 'num', get: (f) => one(f.ip?.ttl) },
  'eth.addr': { type: 'mac', get: (f) => [f.src, f.dst] },
  'eth.src': { type: 'mac', get: (f) => [f.src] },
  'eth.dst': { type: 'mac', get: (f) => [f.dst] },
  'tcp.port': { type: 'num', get: (f) => both(ports(f, 'tcp')) },
  'tcp.srcport': { type: 'num', get: (f) => one(ports(f, 'tcp')?.src) },
  'tcp.dstport': { type: 'num', get: (f) => one(ports(f, 'tcp')?.dst) },
  'udp.port': { type: 'num', get: (f) => both(ports(f, 'udp')) },
  'udp.srcport': { type: 'num', get: (f) => one(ports(f, 'udp')?.src) },
  'udp.dstport': { type: 'num', get: (f) => one(ports(f, 'udp')?.dst) },
  'arp.opcode': { type: 'num', get: (f) => one(f.arp ? (f.arp.op === 'request' ? 1 : 2) : undefined) },
  'icmp.type': { type: 'num', get: (f) => one(f.ip?.app.kind === 'ping' ? (f.ip.app.reply ? 0 : 8) : undefined) },
  'dns.qry.name': { type: 'str', get: (f) => one(f.ip?.app.kind === 'dns-query' || f.ip?.app.kind === 'dns-answer' ? f.ip.app.name : undefined) },
  'dns.a': { type: 'ip', get: (f) => one(f.ip?.app.kind === 'dns-answer' ? f.ip.app.ip : undefined) },
  'http.host': { type: 'str', get: (f) => one(httpReq(f)?.host) },
  'http.request': { type: 'flag', get: (f) => (httpReq(f) ? [1] : []) },
  'http.request.method': { type: 'str', get: (f) => one(httpReq(f)?.method) },
  'http.request.uri': { type: 'str', get: (f) => one(httpReq(f)?.path) },
  'http.response': { type: 'flag', get: (f) => (httpRes(f) ? [1] : []) },
  'http.response.code': { type: 'num', get: (f) => one(httpRes(f)?.status || undefined) },
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Whether a frame passes the filter. No filter (null) passes everything. */
export function matchFilter(node: FilterNode | null, f: Frame): boolean {
  if (!node) return true;
  switch (node.kind) {
    case 'and':
      return matchFilter(node.a, f) && matchFilter(node.b, f);
    case 'or':
      return matchFilter(node.a, f) || matchFilter(node.b, f);
    case 'not':
      return !matchFilter(node.a, f);
    case 'has':
      return PROTOCOLS.has(node.name) ? protocolsOf(f).includes(node.name) : (FIELDS[node.name]?.get(f).length ?? 0) > 0;
    case 'cmp': {
      const vals = FIELDS[node.field].get(f);
      if (!vals.length) return false;
      if (node.op === '!=') return vals.every((v) => !equal(v, node.value));
      return vals.some((v) => test(v, node.op, node.value));
    }
  }
}

function equal(v: string | number, want: Value): boolean {
  switch (want.kind) {
    case 'ip': {
      if (typeof v !== 'string' || !isIp(v)) return false;
      if (want.bits === 0) return true;
      const mask = want.bits === 32 ? 0xffffffff : (0xffffffff << (32 - want.bits)) >>> 0;
      return ((ipToInt(v) & mask) >>> 0) === ((want.net & mask) >>> 0);
    }
    case 'mac':
      return typeof v === 'string' && v.toLowerCase() === want.mac;
    case 'num':
      return v === want.n;
    case 'str':
      return v === want.s;
  }
}

function test(v: string | number, op: FilterOp, want: Value): boolean {
  if (op === '==') return equal(v, want);
  if (op === 'contains') return typeof v === 'string' && want.kind === 'str' && v.includes(want.s);
  if (typeof v !== 'number' || want.kind !== 'num') return false;
  return op === '>' ? v > want.n : op === '<' ? v < want.n : op === '>=' ? v >= want.n : v <= want.n;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Tok = { t: 'word'; v: string } | { t: 'str'; v: string } | { t: 'op'; v: string } | { t: '(' } | { t: ')' } | { t: 'not' } | { t: 'and' } | { t: 'or' };

const WORD_OPS: Record<string, FilterOp> = { eq: '==', ne: '!=', gt: '>', lt: '<', ge: '>=', le: '<=', contains: 'contains' };

class FilterError extends Error {}
const fail = (msg: string): never => {
  throw new FilterError(msg);
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '>=', '<='].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
    } else if (two === '&&' || two === '||') {
      out.push({ t: two === '&&' ? 'and' : 'or' });
      i += 2;
    } else if (c === '=') {
      fail('Use two equals signs (==) to compare.');
    } else if (c === '&' || c === '|') {
      fail('Use && for "and", or || for "or".');
    } else if (c === '!') {
      out.push({ t: 'not' });
      i++;
    } else if (c === '>' || c === '<') {
      out.push({ t: 'op', v: c });
      i++;
    } else if (c === '(' || c === ')') {
      out.push({ t: c });
      i++;
    } else if (c === '"' || c === '“' || c === '”') {
      const end = src.slice(i + 1).search(/["“”]/);
      if (end < 0) fail('A quote mark is missing its partner.');
      out.push({ t: 'str', v: src.slice(i + 1, i + 1 + end) });
      i += end + 2;
    } else {
      const m = /^[A-Za-z0-9_.:/-]+/.exec(src.slice(i));
      if (!m) fail(`Wireshark can't read “${c}” in a filter.`);
      const w = m![0];
      const lw = w.toLowerCase();
      if (lw === 'and' || lw === 'or' || lw === 'not') out.push({ t: lw });
      else if (WORD_OPS[lw]) out.push({ t: 'op', v: WORD_OPS[lw] });
      else out.push({ t: 'word', v: w });
      i += w.length;
    }
  }
  return out;
}

/** What to say about a word that is neither a protocol nor a field. */
const HINT: Record<string, string> = {
  ping: 'Wireshark calls ping packets icmp. Try: icmp',
  pings: 'Wireshark calls ping packets icmp. Try: icmp',
  https: 'Wireshark calls encrypted web traffic tls. Try: tls',
  print: 'Wireshark calls print jobs ipp. Try: ipp',
  printing: 'Wireshark calls print jobs ipp. Try: ipp',
  web: 'For web pages, try http (plain) or tls (encrypted).',
  ethernet: 'Wireshark calls Ethernet eth. Try: eth',
  ipv4: 'Wireshark calls IPv4 ip. Try: ip',
  name: 'Name lookups are dns. Try: dns',
  lookup: 'Name lookups are dns. Try: dns',
  port: 'Say which kind of port: tcp.port or udp.port, like tcp.port == 443',
  src: 'Say what kind of address: ip.src for the sender’s IP address.',
  source: 'Say what kind of address: ip.src for the sender’s IP address.',
  dst: 'Say what kind of address: ip.dst for the receiver’s IP address.',
  destination: 'Say what kind of address: ip.dst for the receiver’s IP address.',
  addr: 'Say what kind of address: ip.addr for an IP address at either end.',
  'ip.address': 'Wireshark shortens it: ip.addr',
  'ip.source': 'Wireshark shortens it: ip.src',
  'ip.destination': 'Wireshark shortens it: ip.dst',
  'ip.from': 'For the sender, Wireshark says ip.src',
  'ip.to': 'For the receiver, Wireshark says ip.dst',
};

const KNOWN = (w: string) => PROTOCOLS.has(w) || !!ALIAS[w] || !!FIELDS[w];
const canon = (w: string) => ALIAS[w] ?? w;

function unknownWord(w: string): string {
  const lw = w.toLowerCase();
  if (lw !== w && KNOWN(lw)) return `Filters are lowercase. Try: ${lw}`;
  if (HINT[lw]) return HINT[lw];
  if (isIp(w) || /^\d+(\.\d+)+$/.test(w)) return `Say what to compare the address with. Try: ip.addr == ${w}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(w) && /[a-z]/i.test(w.split('.').pop()!) && !w.includes('/')) {
    return `To find lookups of a name, try: dns.qry.name == "${w}"`;
  }
  return `“${w}” isn't a protocol or field Wireshark knows. Try a protocol, like dns, or an address, like ip.addr == 192.168.1.10.`;
}

/** What to say when a protocol name is compared with something ("ip == 1.2.3.4"). */
function protocolCompared(name: string, raw: string): string {
  switch (name) {
    case 'ip':
      return `Say which address: ip.addr (either end), ip.src (from), or ip.dst (to). Try: ip.addr == ${raw}`;
    case 'tcp':
    case 'udp':
      return `Say which port: ${name}.port (either end). Try: ${name}.port == ${raw}`;
    case 'eth':
      return `Say which MAC address: eth.addr (either end), eth.src, or eth.dst. Try: eth.addr == ${raw}`;
    case 'dns':
      return `To find lookups of a name, try: dns.qry.name == "${raw}"`;
    case 'http':
      return `To find requests to a site, try: http.host == "${raw}"`;
    default:
      return `${name} is a protocol name. Use it alone, like ${name}, or compare one of its fields.`;
  }
}

function parseValue(field: string, type: FieldType, op: FilterOp, tok: Tok | undefined): Value {
  if (!tok || (tok.t !== 'word' && tok.t !== 'str')) return fail(`Type a value after ${op}.`);
  const raw = tok.v;
  if (op === 'contains' && type !== 'str') return fail(`contains works with words, like dns.qry.name contains "school".`);
  if ((op === '>' || op === '<' || op === '>=' || op === '<=') && type !== 'num') return fail(`${op} works only with numbers, like tcp.port > 1000.`);
  switch (type) {
    case 'ip': {
      const m = /^([^/]+)(?:\/(\d{1,2}))?$/.exec(raw);
      const bits = m?.[2] === undefined ? 32 : Number(m[2]);
      if (m && isIp(m[1]) && bits <= 32) return { kind: 'ip', net: ipToInt(m[1]), bits };
      // Real Wireshark looks a name up here. This lesson's filter doesn't, so say so instead of calling names wrong.
      if (/[a-z]/i.test(raw)) return fail(`Use the IP address here, like 192.0.2.80. Wireshark can look up a name, but this lesson's filter can't. A DNS answer tells you a name's address.`);
      return fail(`“${raw}” isn't a full IP address. An IP address is four numbers with dots between, like 192.168.1.10.`);
    }
    case 'mac': {
      const mac = raw.toLowerCase().replace(/-/g, ':');
      if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return { kind: 'mac', mac };
      return fail(`${field} needs a MAC address, like 02:00:00:00:00:21.`);
    }
    case 'num':
      if (/^\d+$/.test(raw)) return { kind: 'num', n: Number(raw) };
      return fail(`${field} needs a number, like 443.`);
    case 'str':
      return { kind: 'str', s: raw };
    case 'flag':
      return fail(`${field} is a yes-or-no field. Use it alone, like ${field}.`);
  }
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  parse(): FilterNode {
    const n = this.or();
    const t = this.peek();
    if (t) {
      if (t.t === ')') fail('There\'s a “)” with no “(” before it.');
      if (t.t === 'word' || t.t === 'not' || t.t === '(') fail('Join two tests with && (and) or || (or), like dns || http.');
      fail(`The filter stops making sense at “${show(t)}”.`);
    }
    return n;
  }

  private or(): FilterNode {
    let a = this.and();
    while (this.peek()?.t === 'or') {
      this.i++;
      if (!this.peek()) fail('Something is missing after ||.');
      a = { kind: 'or', a, b: this.and() };
    }
    return a;
  }

  private and(): FilterNode {
    let a = this.unary();
    while (this.peek()?.t === 'and') {
      this.i++;
      if (!this.peek()) fail('Something is missing after &&.');
      a = { kind: 'and', a, b: this.unary() };
    }
    return a;
  }

  private unary(): FilterNode {
    if (this.peek()?.t === 'not') {
      this.i++;
      if (!this.peek()) fail('Something is missing after !.');
      return { kind: 'not', a: this.unary() };
    }
    return this.primary();
  }

  private primary(): FilterNode {
    const t = this.toks[this.i++];
    if (!t) return fail('Something is missing at the end.');
    if (t.t === '(') {
      const n = this.or();
      if (this.toks[this.i++]?.t !== ')') fail('A “(” is missing its “)”.');
      return n;
    }
    if (t.t === 'and' || t.t === 'or') return fail(`Something is missing before ${t.t === 'and' ? '&&' : '||'}.`);
    if (t.t === 'op') return fail(`Something is missing before ${t.v}. Start with a field, like ip.addr ${t.v} ...`);
    if (t.t !== 'word') return fail(`The filter stops making sense at “${show(t)}”.`);
    const w = t.v;
    const next = this.peek();
    const op = next?.t === 'op' ? (next.v as FilterOp) : undefined;
    if (!KNOWN(w)) return fail(unknownWord(w));
    const name = canon(w);
    if (!op) return { kind: 'has', name };
    this.i++;
    const valTok = this.toks[this.i++];
    if (PROTOCOLS.has(name)) {
      const raw = valTok && (valTok.t === 'word' || valTok.t === 'str') ? valTok.v : '...';
      return fail(protocolCompared(name, raw));
    }
    const field = FIELDS[name];
    return { kind: 'cmp', field: name, op, value: parseValue(name, field.type, op, valTok) };
  }
}

function show(t: Tok): string {
  switch (t.t) {
    case 'word':
    case 'op':
      return t.v;
    case 'str':
      return `"${t.v}"`;
    case 'not':
      return '!';
    case 'and':
      return '&&';
    case 'or':
      return '||';
    default:
      return t.t;
  }
}

/** Read a display filter. An empty one shows every packet. */
export function parseFilter(text: string): FilterResult {
  const src = text.trim();
  if (!src) return { ok: true, node: null };
  try {
    return { ok: true, node: new Parser(tokenize(src)).parse() };
  } catch (e) {
    if (e instanceof FilterError) return { ok: false, msg: e.message };
    throw e;
  }
}

/** The frames a filter shows, in order. An invalid filter shows none. */
export function applyFilter<T extends { frame: Frame }>(rows: T[], text: string): T[] {
  const p = parseFilter(text);
  return p.ok ? rows.filter((r) => matchFilter(p.node, r.frame)) : [];
}
