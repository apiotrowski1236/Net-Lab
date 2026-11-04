import { isIp, isPrefix, normalizePrefix, prefixContains, type Ip } from './addr';
import type { L4 } from './services';
import type { Sim } from './sim';
import type { Device } from './types';

/**
 * The terminal: network commands typed on one computer (built for net-tools,
 * written for later labs too). The student types a line; `parseCommand` reads
 * it the way the real program would; `Sim.runCommand` starts it. Each command
 * leaves a **run** on the computer's `Device.term` (newest last), and the sim
 * fills it in as answers arrive, so the terminal can draw its output live and
 * a reload rebuilds the same output by replaying the same lines.
 *
 *   ping <address or name>          4 echo requests, PING_GAP_MS apart (sim.ping)
 *   traceroute <address or name>    echo requests with TTL 1, 2, 3, ... one hop
 *   (tracert on Windows)            at a time. Each router where the TTL runs out
 *                                   answers "time exceeded" (SimOptions.icmpErrors)
 *   nslookup <name> [server]        one DNS question to the computer's DNS server
 *                                   (or `server`); an address asks for its name
 *   netstat [-a] [-b|-p] [-n]       this computer's connections (Device.sockets);
 *                                   -a adds listening ports, -b the programs
 *   nmap [-sV] [--script vuln] <target>
 *                                   a port scan (sim.scan) of an address, a name,
 *                                   or a network; -sV reads each service's
 *                                   version, --script vuln checks VULNS
 *
 * Simplified on purpose, and the lessons say so once: traceroute sends one probe
 * per hop (the real one sends three) and gives up after two silent hops; nmap
 * knocks on `NMAP_PORTS`, not the 1,000 most common ports; times are made up
 * from each cable's `Link.ms`, since the animation runs far slower than a real
 * network. A probe the network drops counts as timed out once its answer would
 * have been back, instead of after the full wait, so a class isn't kept waiting.
 */

export type TermCommand = 'ping' | 'traceroute' | 'nslookup' | 'netstat' | 'nmap';

export const TERM_COMMANDS: TermCommand[] = ['ping', 'traceroute', 'nslookup', 'netstat', 'nmap'];

/** How each command is typed, and what it does, for help and the line under the prompt. */
export const TERM_USAGE: Record<TermCommand, { usage: string; what: string }> = {
  ping: { usage: 'ping <address or name>', what: 'Ask a computer to answer. Sends 4 pings.' },
  traceroute: { usage: 'traceroute <address or name>', what: 'List each router on the way to a computer. On Windows it is called tracert.' },
  nslookup: { usage: 'nslookup <name>', what: 'Ask the DNS server for the address that goes with a name.' },
  netstat: { usage: 'netstat [-a] [-b]', what: 'List this computer’s connections. -a adds ports waiting for connections. -b adds the program behind each one.' },
  nmap: { usage: 'nmap [-sV] [--script vuln] <address or network>', what: 'Scan for computers and open ports. Needs the owner’s written permission.' },
};

/** A command line, read. `help` and `clear` only change the screen, so they never reach the network. */
export type Parsed =
  | { cmd: 'ping'; target: string }
  | { cmd: 'traceroute'; target: string }
  | { cmd: 'nslookup'; name: string; server?: Ip }
  | { cmd: 'netstat'; all: boolean; programs: boolean }
  | { cmd: 'nmap'; target: string; versions: boolean; vuln: boolean }
  | { cmd: 'help' }
  | { cmd: 'clear' };

export type ParseResult = { ok: true; parsed: Parsed; line: string } | { ok: false; msg: string; cmd?: TermCommand };

const NAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** True for a host name like catalog.lakeside.example (at least one dot). */
export const isHostName = (s: string): boolean => NAME_RE.test(s) && !/^[\d.]+$/.test(s);

/** Looks like someone meant an IP address: only digits and dots. */
const ipLike = (s: string): boolean => /^[\d.]+$/.test(s);

const ADDRESS_FORMAT = 'An IP address is four numbers from 0 to 255 with dots between them, like 10.0.0.1.';

function target(cmd: TermCommand, raw: string | undefined, allowNetwork = false): { ok: true; value: string } | { ok: false; msg: string } {
  const usage = TERM_USAGE[cmd].usage;
  if (!raw) return { ok: false, msg: `${cmd} needs something to look for. Type it like this: ${usage}` };
  if (raw.includes('/')) {
    if (allowNetwork && isPrefix(raw)) return { ok: true, value: normalizePrefix(raw) };
    const bare = raw.split('/')[0];
    if (allowNetwork) return { ok: false, msg: `${raw} isn't a network. Write a network like 10.0.0.0/24.` };
    return { ok: false, msg: `${cmd} takes one address, with no slash${isIp(bare) ? `: ${cmd} ${bare}` : '.'}` };
  }
  if (isIp(raw)) return { ok: true, value: raw };
  if (ipLike(raw)) return { ok: false, msg: ADDRESS_FORMAT };
  if (isHostName(raw)) return { ok: true, value: raw.toLowerCase() };
  return { ok: false, msg: `“${raw}” isn't an address or a name. Type it like this: ${usage}` };
}

/**
 * Read a command line the way the real programs would. Accepts `tracert` for
 * traceroute and the usual flags; anything else gets a message that says what
 * to type instead. The `line` it returns is the tidied command to record.
 */
export function parseCommand(raw: string): ParseResult {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { ok: false, msg: 'Type a command, then press Enter.' };
  const name = words[0].toLowerCase();
  const args = words.slice(1);
  const line = [name, ...args].join(' ');
  switch (name) {
    case 'help':
      return { ok: true, parsed: { cmd: 'help' }, line };
    case 'clear':
    case 'cls':
      return { ok: true, parsed: { cmd: 'clear' }, line };
    case 'ping': {
      // ping -c 4 (Linux) and ping -n 4 (Windows) only set the count, which is always 4 here.
      const rest = dropCount(args);
      if (rest.some((a) => a.startsWith('-'))) return { ok: false, cmd: 'ping', msg: `This ping takes no options. Type it like this: ${TERM_USAGE.ping.usage}` };
      if (rest.length > 1) return { ok: false, cmd: 'ping', msg: `ping takes one address or name. Type it like this: ${TERM_USAGE.ping.usage}` };
      const t = target('ping', rest[0]);
      return t.ok ? { ok: true, parsed: { cmd: 'ping', target: t.value }, line } : { ok: false, cmd: 'ping', msg: t.msg };
    }
    case 'traceroute':
    case 'tracert':
    case 'tracepath': {
      if (args.some((a) => a.startsWith('-'))) return { ok: false, cmd: 'traceroute', msg: `This traceroute takes no options. Type it like this: ${name} <address or name>` };
      if (args.length > 1) return { ok: false, cmd: 'traceroute', msg: `${name} takes one address or name.` };
      const t = target('traceroute', args[0]);
      return t.ok ? { ok: true, parsed: { cmd: 'traceroute', target: t.value }, line } : { ok: false, cmd: 'traceroute', msg: t.msg.replace(/^traceroute/, name) };
    }
    case 'nslookup': {
      if (args.some((a) => a.startsWith('-'))) return { ok: false, cmd: 'nslookup', msg: `This nslookup takes no options. Type it like this: ${TERM_USAGE.nslookup.usage}` };
      if (args.length > 2) return { ok: false, cmd: 'nslookup', msg: 'nslookup takes a name, and after it, if you like, the address of a DNS server to ask.' };
      const t = target('nslookup', args[0]);
      if (!t.ok) return { ok: false, cmd: 'nslookup', msg: t.msg };
      if (args[1] !== undefined && !isIp(args[1])) return { ok: false, cmd: 'nslookup', msg: `The second word is the DNS server to ask. Write its IP address. ${ADDRESS_FORMAT}` };
      return { ok: true, parsed: { cmd: 'nslookup', name: t.value, server: args[1] }, line };
    }
    case 'netstat': {
      let all = false;
      let programs = false;
      for (const a of args) {
        if (!/^-[a-z]+$/i.test(a)) return { ok: false, cmd: 'netstat', msg: `netstat takes options that start with a dash, like netstat -a or netstat -b. “${a}” isn't one.` };
        for (const ch of a.slice(1)) {
          if (ch === 'a') all = true;
          else if (ch === 'b' || ch === 'p') programs = true;
          else if (ch === 'n' || ch === 'o' || ch === 't') continue;
          else return { ok: false, cmd: 'netstat', msg: `This netstat knows -a (also ports waiting for connections) and -b (the program behind each one). It doesn't know -${ch}.` };
        }
      }
      return { ok: true, parsed: { cmd: 'netstat', all, programs }, line };
    }
    case 'nmap': {
      let versions = false;
      let vuln = false;
      const rest: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-sV' || a === '-sv' || a === '-A') versions = true;
        else if (a === '--script=vuln' || (a === '--script' && args[i + 1] === 'vuln')) {
          vuln = versions = true;
          if (a === '--script') i++;
        } else if (a === '--script') return { ok: false, cmd: 'nmap', msg: 'The only script this nmap has is vuln: --script vuln' };
        else if (a.startsWith('-')) return { ok: false, cmd: 'nmap', msg: `This nmap knows -sV (find each service's version) and --script vuln (check for known problems). It doesn't know ${a}.` };
        else rest.push(a);
      }
      if (rest.length > 1) return { ok: false, cmd: 'nmap', msg: 'Scan one thing at a time: an address, a name, or a network like 10.0.0.0/24.' };
      const t = target('nmap', rest[0], true);
      return t.ok ? { ok: true, parsed: { cmd: 'nmap', target: t.value, versions, vuln }, line } : { ok: false, cmd: 'nmap', msg: t.msg };
    }
    default: {
      const close = TERM_COMMANDS.find((c) => near(name, c)) ?? (near(name, 'tracert') ? 'tracert' : undefined);
      return { ok: false, msg: `${name}: command not found.${close ? ` Did you mean ${close}?` : ''}` };
    }
  }
}

function dropCount(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-c' || args[i] === '-n') && /^\d+$/.test(args[i + 1] ?? '')) i++;
    else out.push(args[i]);
  }
  return out;
}

/** One letter off, swapped, or a prefix: "pign", "nslokup", "trace". */
function near(a: string, b: string): boolean {
  if (a.length >= 3 && b.startsWith(a)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i)) return true;
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

// ---------------------------------------------------------------------------
// Runs: what each command did, filled in by the sim as answers arrive
// ---------------------------------------------------------------------------

interface RunBase {
  id: number;
  /** When it was typed. */
  t: number;
  /** The line as recorded. */
  line: string;
  /** When the last answer came in or the last wait ran out. */
  doneAt?: number;
}

/** Looking up a name before a ping, traceroute, or nmap can start. */
export interface NameLookup {
  name: string;
  server: Ip;
  status: 'pending' | 'found' | 'nxdomain' | 'timeout';
}

export type ProbeStatus = 'pending' | 'reply' | 'unreachable' | 'timeout';

export interface PingProbe {
  seq: number;
  sentAt: number;
  status: ProbeStatus;
  /** Who answered: the target, or a router (or this computer) saying it can't get there. */
  from?: Ip;
  /** Round trip, in made-up real-world milliseconds (see pathMs). */
  ms?: number;
  /** The TTL left on the reply. */
  ttl?: number;
  /** For 'unreachable': no route to the network, or nobody at the address. */
  why?: 'host' | 'net' | 'local';
}

export interface PingRun extends RunBase {
  kind: 'ping';
  target: string;
  ip?: Ip;
  lookup?: NameLookup;
  probes: PingProbe[];
}

export interface TraceHop {
  ttl: number;
  seq: number;
  sentAt: number;
  status: 'pending' | 'answer' | 'timeout';
  from?: Ip;
  ms?: number;
  /** The target itself answered: the trace is over. */
  last?: boolean;
}

export interface TraceRun extends RunBase {
  kind: 'traceroute';
  target: string;
  ip?: Ip;
  lookup?: NameLookup;
  hops: TraceHop[];
  /** Why it stopped. */
  end?: 'reached' | 'silent' | 'max' | 'no-name' | 'local';
}

export interface LookupRun extends RunBase {
  kind: 'nslookup';
  name: string;
  /** Asking for the name that goes with an address (a reverse lookup). */
  reverse: boolean;
  /** The DNS server asked. Missing: this computer has none. */
  server?: Ip;
  qid?: number;
  status: 'pending' | 'found' | 'nxdomain' | 'timeout' | 'no-server';
  /** The answer: an address, or for a reverse lookup, a name. */
  answer?: string;
  /** The server holds this name's record itself (its own zone), instead of passing on another server's answer. */
  authoritative?: boolean;
}

/** One line of netstat's table. */
export interface NetstatRow {
  proto: 'TCP' | 'UDP';
  local: string;
  foreign: string;
  state: 'ESTABLISHED' | 'LISTENING' | '';
  program?: string;
}

export interface NetstatRun extends RunBase {
  kind: 'netstat';
  all: boolean;
  programs: boolean;
  /** What the table showed when it ran: netstat is a snapshot. */
  rows: NetstatRow[];
}

export interface NmapRun extends RunBase {
  kind: 'nmap';
  target: string;
  versions: boolean;
  vuln: boolean;
  lookup?: NameLookup;
  /** The scan on Device.scans, once it starts. */
  scan?: number;
}

export type TermRun = PingRun | TraceRun | LookupRun | NetstatRun | NmapRun;

/** Runs each computer keeps (oldest dropped first). */
export const MAX_RUNS = 40;

export const PING_COUNT = 4;
/** Sim time between ping's echo requests: about a second on screen at 1x (the animation runs at a third of real time). */
export const PING_GAP_MS = 400;
/** traceroute gives up after this many hops in a row with no answer (a real one keeps going to 30 hops). */
export const TRACE_SILENT = 2;
export const TRACE_MAX_HOPS = 12;

/** Ports this nmap knocks on: a short list of common ones. */
export const NMAP_PORTS = [21, 22, 23, 25, 53, 80, 443, 445, 631, 3389];

/** nmap's own names for services (from its nmap-services file). */
const NMAP_NAMES: Record<number, string> = {
  20: 'ftp-data',
  21: 'ftp',
  22: 'ssh',
  23: 'telnet',
  25: 'smtp',
  53: 'domain',
  80: 'http',
  110: 'pop3',
  143: 'imap',
  443: 'https',
  445: 'microsoft-ds',
  631: 'ipp',
  3389: 'ms-wbt-server',
  4444: 'krb524',
};

export const nmapName = (port: number): string => NMAP_NAMES[port] ?? 'unknown';

/**
 * Known problems `nmap --script vuln` finds, by the version a service
 * reports. Real nmap runs a script per problem; the output imitates theirs.
 */
export interface Vuln {
  /** The script's name, as nmap prints it. */
  script: string;
  match: RegExp;
  title: string;
  /** Public ID for the flaw. */
  cve?: string;
  /** One line on what the flaw lets an attacker do. */
  risk: string;
}

export const VULNS: Vuln[] = [
  {
    script: 'ftp-vsftpd-backdoor',
    match: /^vsftpd 2\.3\.4$/i,
    title: 'vsFTPd version 2.3.4 backdoor',
    cve: 'CVE-2011-2523',
    risk: 'A hidden backdoor in this version lets anyone run commands on the server.',
  },
];

export const vulnsFor = (version: string | undefined): Vuln[] => (version ? VULNS.filter((v) => v.match.test(version)) : []);

// ---------------------------------------------------------------------------
// Connections a computer holds open, for netstat
// ---------------------------------------------------------------------------

/**
 * A connection that stays open: a browser tab on a site, or a program that
 * keeps a line to a server. netstat lists them; nothing else uses them yet.
 * They drop when the computer loses its cable.
 */
export interface Socket {
  proto: L4;
  /** This computer's own port. */
  port: number;
  remote: Ip;
  rport: number;
  /** The program that owns it, as netstat -b names it ("browser.exe"). */
  program: string;
}

/** The address a computer writes as its own in netstat: its first address. */
export const ownIp = (d: Device): Ip | undefined => d.ifaces.find((i) => i.ip)?.ip;

/** Is `ip` in any of these networks? */
export const inScope = (prefixes: string[], ip: Ip): boolean => prefixes.some((p) => prefixContains(p, ip));

/** True when every address in network `prefix` falls inside one of `prefixes`. */
export function networkInScope(prefixes: string[], prefix: string): boolean {
  const [ip, len] = prefix.split('/');
  return prefixes.some((p) => {
    const [, plen] = p.split('/');
    return Number(len) >= Number(plen) && prefixContains(p, ip);
  });
}

// ---------------------------------------------------------------------------
// DNS: reverse names and a zone's answer
// ---------------------------------------------------------------------------

/** The name a reverse lookup asks about: 203.0.113.66 -> 66.113.0.203.in-addr.arpa. */
export const reverseName = (ip: Ip): string => `${ip.split('.').reverse().join('.')}.in-addr.arpa`;

/** The address in a reverse-lookup name, or undefined for an ordinary name. */
export function fromReverseName(name: string): Ip | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\.in-addr\.arpa$/i.exec(name);
  return m ? [m[4], m[3], m[2], m[1]].join('.') : undefined;
}

/** What a DNS server's own records say about `name`: an address, or for a reverse name, the name that has that address. */
export function zoneAnswer(zone: Record<string, Ip>, name: string): { ip?: Ip; ptr?: string } | undefined {
  if (zone[name]) return { ip: zone[name] };
  const ip = fromReverseName(name);
  const hit = ip ? Object.entries(zone).find(([, v]) => v === ip) : undefined;
  return hit ? { ptr: hit[0] } : undefined;
}

// ---------------------------------------------------------------------------
// Times: what a real network would take
// ---------------------------------------------------------------------------

/** A short local cable, when a link has no `ms`. */
export const LAN_MS = 0.15;

/**
 * How long a packet from `fromId` takes to reach `dst` on a real network, in
 * ms: the `Link.ms` of each link it leaves through, hop by hop along the
 * routes. The animation runs far slower, so ping and traceroute print these.
 */
export function oneWayMs(sim: Sim, fromId: string, dst: Ip): number {
  let dev: Device | undefined = sim.devices[fromId];
  let ms = 0;
  for (let hop = 0; hop < 32 && dev; hop++) {
    if (dev.ifaces.some((i) => i.ip === dst)) return ms;
    const r = sim.lookup(dev, dst);
    if (!r) return ms;
    const out = r.via && r.source === 'static' ? sim.connectedIface(dev, r.via) : r.iface;
    const linkId = dev.ifaces.find((i) => i.id === out)?.linkId;
    ms += (linkId ? sim.links[linkId]?.ms : undefined) ?? LAN_MS;
    dev = sim.deviceByIp(r.via ?? dst);
  }
  return ms;
}

/** A round trip from `fromId` to `dst` and back, with a little made-up jitter that depends only on `seq`. */
export function roundTripMs(sim: Sim, fromId: string, dst: Ip, seq: number): number {
  const jitter = 0.9 + (((seq * 2654435761) >>> 0) % 1000) / 4000;
  return Math.max(0.2, 2 * oneWayMs(sim, fromId, dst) * jitter + 0.05);
}

/** "0.4 ms", "12 ms": one decimal under 10. */
export const fmtMs = (ms: number): string => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
