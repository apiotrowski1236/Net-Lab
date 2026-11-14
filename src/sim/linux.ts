import type { Ip } from './addr';
import type { FwRuleInput } from './firewall';
import type { L4, Service } from './services';
import type { Sim } from './sim';
import type { Device, IpPacket, LogEntry } from './types';
import { parseUfw, sameCriteria, ufwEffect, ufwEffectLines, ufwStatus, UFW_DEFAULT, UFW_NAMES, type UfwOp, type UfwPolicy } from './ufw';

/**
 * A Linux server (device-analysis): an Ubuntu web server with the programs
 * that keep its logs, its host firewall (ufw.ts), and fail2ban.
 *
 * STATE
 *   `Device.linux` holds a LinuxState. The server's firewall is the ordinary
 *   `Device.firewall` (a host firewall: see Sim's "host firewall" section and
 *   ufw.ts). Build one with NetBuilder.host(id, { linux: {...}, firewall: {...} }).
 *
 * LOG FILES
 *   Each line goes through `sim.log` with `fields.file` naming its file:
 *     auth      /var/log/auth.log           sshd sign-ins, cron, sudo
 *     ufw       /var/log/ufw.log            [UFW BLOCK] lines from the kernel
 *     access    /var/log/nginx/access.log   nginx, one line per web request
 *     fail2ban  /var/log/fail2ban.log       fail2ban's finds and bans
 *   `fileRows(dev, file)` lists a file's lines in order: row N is line N of the
 *   file, as `grep -n` numbers it. `fileLine(lx, entry)` prints a line the way
 *   the file holds it, with its date stamp. (Each sign-in attempt writes one
 *   line to auth.log; a real sshd writes two or three.)
 *
 * PROGRAMS
 *   sshd     reads a sign-in from the request (`sshRequest`): who, and with a
 *            password or a key. Nobody signs in with a password here: every
 *            password attempt fails. With passwords turned off
 *            (PasswordAuthentication no), sshd closes the connection before
 *            any password is tried.
 *   nginx    reads a web request (`httpRequest`) and logs it in nginx's
 *            "combined" format. Paths with ".." get 400, unknown paths 404.
 *   fail2ban (off until turned on) counts failed sign-ins per address. At
 *            `maxretry` within `findtime`, it bans the address with
 *            `ufw insert 1 deny from <ip> to any`, the way its ufw action does.
 *
 * COMMANDS (typed in the terminal; see terminal.ts)
 *   ss -tuln                 the ports programs listen on
 *   ufw ...                  see ufw.ts
 *   grep [-n -c -i -v] <pattern> <file>...
 *   tail [-n N] <file>
 *   `sudo` in front is accepted and changes nothing: the student is the admin.
 */

export type LogFile = 'auth' | 'ufw' | 'access' | 'fail2ban';

export const LOG_FILES: LogFile[] = ['auth', 'ufw', 'access', 'fail2ban'];

export const LOG_PATH: Record<LogFile, string> = {
  auth: '/var/log/auth.log',
  ufw: '/var/log/ufw.log',
  access: '/var/log/nginx/access.log',
  fail2ban: '/var/log/fail2ban.log',
};

export interface SshUser {
  uid: number;
  /** The key this account signs in with (an id the client sends), and how ssh prints it. */
  key?: { id: string; type: 'RSA' | 'ED25519'; fp: string };
}

export interface Fail2Ban {
  on: boolean;
  /** Failures from one address that trigger a ban... */
  maxretry: number;
  /** ...counted within this many ms. */
  findtime: number;
  /** How long a ban lasts, in ms (bans don't expire in the simulation; this is for the words). */
  bantime: number;
  pid: number;
  /** Failure times per address, inside the find window. */
  hits: Record<Ip, number[]>;
  banned: Ip[];
}

export interface LinuxState {
  hostname: string;
  /** Who sits at the terminal. */
  user: string;
  /** UTC ms of sim time 0: log stamps are epoch + t. */
  epoch: number;
  nextPid: number;
  ufw: UfwPolicy;
  sshd: { pid: number; passwords: boolean; users: Record<string, SshUser> };
  nginx: { pages: Record<string, number> };
  f2b: Fail2Ban;
  /** Programs listening on this server's own loopback addresses (ss shows them; nothing outside can reach them). */
  local: { proto: L4; addr: string; port: number; program: string }[];
  /** Connections open right now (ss without -l): an admin's SSH session. */
  sessions: { port: number; peer: Ip; pport: number; program: string }[];
  /** Process ids by program name, for ss -p. */
  pids: Record<string, number>;
}

export interface LinuxOpts {
  hostname?: string;
  user: string;
  epoch: number;
  users: Record<string, SshUser>;
  pages?: Record<string, number>;
  local?: LinuxState['local'];
  sessions?: LinuxState['sessions'];
  pids?: Record<string, number>;
}

export function newLinux(id: string, o: LinuxOpts): LinuxState {
  return {
    hostname: o.hostname ?? id,
    user: o.user,
    epoch: o.epoch,
    nextPid: 21000,
    ufw: { ...UFW_DEFAULT },
    sshd: { pid: o.pids?.sshd ?? 812, passwords: true, users: o.users },
    nginx: { pages: o.pages ?? { '/': 5120 } },
    f2b: { on: false, maxretry: 5, findtime: 600_000, bantime: 600_000, pid: 0, hits: {}, banned: [] },
    local: o.local ?? [],
    sessions: o.sessions ?? [],
    pids: { ...o.pids },
  };
}

// ---------------------------------------------------------------------------
// Time stamps
// ---------------------------------------------------------------------------

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** "Nov 15 03:41:07" (syslog: auth.log, ufw.log). */
export function syslogStamp(ms: number): string {
  const d = new Date(Math.floor(ms));
  return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/** "15/Nov/2026:03:41:07 +0000" (nginx). */
export function nginxStamp(ms: number): string {
  const d = new Date(Math.floor(ms));
  return `${p2(d.getUTCDate())}/${MON[d.getUTCMonth()]}/${d.getUTCFullYear()}:${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`;
}

/** "2026-11-16 09:12:03,412" (fail2ban). */
export function isoStamp(ms: number): string {
  const d = new Date(Math.floor(ms));
  const date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  return `${date} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())},${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Log files
// ---------------------------------------------------------------------------

export type LogLine = Omit<LogEntry, 'no' | 't' | 'device'>;

/** A syslog line for auth.log: `prog[pid]: msg`. */
export function authEntry(prog: string, pid: number | undefined, msg: string, facts: Record<string, string | number> = {}): LogLine {
  const fields: Record<string, string | number> = { file: 'auth', prog, ...facts };
  if (pid !== undefined) fields.pid = pid;
  return { source: prog, level: facts.result === 'failed' || facts.result === 'invalid' ? 'warn' : 'info', msg, fields };
}

/** An nginx access line. `msg` is the part after the time stamp. */
export function accessEntry(r: { ip: Ip; method: string; path: string; status: number; bytes: number; ua: string; referer?: string }): LogLine {
  return {
    source: 'nginx',
    level: r.status >= 400 ? 'notice' : 'info',
    msg: `"${r.method} ${r.path} HTTP/1.1" ${r.status} ${r.bytes} "${r.referer ?? '-'}" "${r.ua}"`,
    fields: { file: 'access', prog: 'nginx', ip: r.ip, src: r.ip, method: r.method, path: r.path, status: r.status, bytes: r.bytes, ua: r.ua },
  };
}

/** A fail2ban.log line. */
export function f2bEntry(prog: string, pid: number, lvl: 'INFO' | 'NOTICE' | 'WARNING', msg: string, facts: Record<string, string | number> = {}): LogLine {
  return { source: 'fail2ban', level: lvl === 'NOTICE' ? 'notice' : 'info', msg, fields: { file: 'fail2ban', prog, pid, lvl, ...facts } };
}

export const fileOf = (e: LogEntry): LogFile | undefined => e.fields?.file as LogFile | undefined;

/** A file's lines, in order. Row N (from 1) is `fileRows(...)[N - 1]`. */
export function fileRows(dev: Device, file: LogFile): LogEntry[] {
  return dev.logs.filter((e) => e.fields?.file === file);
}

/** One line exactly as the file holds it. */
export function fileLine(lx: LinuxState, e: LogEntry): string {
  const ms = lx.epoch + e.t;
  const f = e.fields ?? {};
  switch (f.file) {
    case 'access':
      return `${f.ip} - - [${nginxStamp(ms)}] ${e.msg}`;
    case 'fail2ban':
      return `${isoStamp(ms)} ${String(f.prog).padEnd(24)}[${f.pid}]: ${String(f.lvl).padEnd(7)} ${e.msg}`;
    default:
      return `${syslogStamp(ms)} ${lx.hostname} ${f.prog ?? e.source}${f.pid !== undefined ? `[${f.pid}]` : ''}: ${e.msg}`;
  }
}

// ---------------------------------------------------------------------------
// What clients send: a sign-in, a web request
// ---------------------------------------------------------------------------

export interface SshRequest {
  user: string;
  auth: 'password' | 'publickey';
  /** The key the client offers (publickey). */
  key?: string;
  /** Asks for the SFTP subsystem (file transfer) once signed in. */
  sftp?: boolean;
}

/** The text an SSH client sends, for Sim.connectService's `data`. */
export const sshRequest = (r: SshRequest): string => `ssh user=${r.user} auth=${r.auth}${r.key ? ` key=${r.key}` : ''}${r.sftp ? ' subsystem=sftp' : ''}`;

export function readSsh(text: string | undefined): SshRequest | undefined {
  if (!text?.startsWith('ssh ')) return undefined;
  const kv = Object.fromEntries(
    text
      .slice(4)
      .split(' ')
      .map((p) => p.split('=') as [string, string]),
  );
  if (!kv.user) return undefined;
  return { user: kv.user, auth: kv.auth === 'publickey' ? 'publickey' : 'password', key: kv.key, sftp: kv.subsystem === 'sftp' };
}

export interface HttpRequest {
  method: string;
  path: string;
  ua: string;
}

/** The text a web client sends, for Sim.connectService's `data`. */
export const httpRequest = (r: HttpRequest): string => `http ${r.method} ${r.path} ${r.ua}`;

export function readHttp(text: string | undefined): HttpRequest | undefined {
  const m = /^http (\S+) (\S+) (.*)$/.exec(text ?? '');
  return m ? { method: m[1], path: m[2], ua: m[3] } : undefined;
}

const REASON: Record<number, string> = { 200: 'OK', 302: 'Found', 400: 'Bad Request', 404: 'Not Found' };

/** nginx's answer to one request: status and body size. */
export function nginxAnswer(lx: LinuxState, method: string, path: string): { status: number; bytes: number } {
  if (path.includes('..')) return { status: 400, bytes: 166 };
  if (method === 'POST' && path.startsWith('/order')) return { status: 302, bytes: 0 };
  const page = lx.nginx.pages[path.split('?')[0]];
  return page !== undefined ? { status: 200, bytes: page } : { status: 404, bytes: 162 };
}

// ---------------------------------------------------------------------------
// The programs answering requests (called from Sim.onSvc)
// ---------------------------------------------------------------------------

/**
 * A request reached a program on a Linux server. sshd and nginx write their
 * log lines here (and fail2ban counts sshd's failures). Returns what the
 * program answers, or undefined to send the service's usual banner.
 */
export function linuxServe(sim: Sim, dev: Device, pkt: IpPacket, svc: Service): string | undefined {
  const lx = dev.linux!;
  const a = pkt.app.kind === 'svc' ? pkt.app : undefined;
  if (!a) return undefined;
  if (svc.app === 'ssh') {
    const req = readSsh(a.text);
    if (!req) return undefined;
    return sshdLogin(sim, dev, lx, pkt.src, pkt.srcPort ?? 0, req);
  }
  if (svc.app === 'http' || svc.app === 'https') {
    const req = readHttp(a.text);
    if (!req) return undefined;
    const ans = nginxAnswer(lx, req.method, req.path);
    sim.log(dev.id, accessEntry({ ip: pkt.src, method: req.method, path: req.path, status: ans.status, bytes: ans.bytes, ua: req.ua }));
    return `HTTP/1.1 ${ans.status} ${REASON[ans.status] ?? ''}`.trim();
  }
  return undefined;
}

function sshdLogin(sim: Sim, dev: Device, lx: LinuxState, ip: Ip, port: number, req: SshRequest): string {
  const pid = lx.nextPid++;
  const user = lx.sshd.users[req.user];
  const log = (msg: string, facts: Record<string, string | number>, p = pid) => sim.log(dev.id, authEntry('sshd', p, msg, { ip, src: ip, user: req.user, sport: port, ...facts }));
  if (req.auth === 'publickey' && user?.key && req.key === user.key.id) {
    log(`Accepted publickey for ${req.user} from ${ip} port ${port} ssh2: ${user.key.type} SHA256:${user.key.fp}`, { result: 'accepted', method: 'publickey' });
    log(`pam_unix(sshd:session): session opened for user ${req.user}(uid=${user.uid}) by (uid=0)`, { result: 'session' });
    if (req.sftp) log(`subsystem request for sftp by user ${req.user}`, { result: 'sftp' }, lx.nextPid++);
    return 'Welcome to Ubuntu 22.04.5 LTS (GNU/Linux 5.15.0-125-generic x86_64)';
  }
  if (req.auth === 'password' && lx.sshd.passwords) {
    const invalid = !user;
    log(`Failed password for ${invalid ? 'invalid user ' : ''}${req.user} from ${ip} port ${port} ssh2`, { result: invalid ? 'invalid' : 'failed', method: 'password' });
    f2bFailure(sim, dev, lx, ip);
    return 'Permission denied, please try again.';
  }
  // No password allowed (or a key the account doesn't have): sshd closes the connection before any password.
  log(`Connection closed by ${user ? 'authenticating user' : 'invalid user'} ${req.user} ${ip} port ${port} [preauth]`, { result: 'preauth', method: req.auth });
  f2bFailure(sim, dev, lx, ip);
  return 'Permission denied (publickey).';
}

// ---------------------------------------------------------------------------
// fail2ban
// ---------------------------------------------------------------------------

/** The rule fail2ban's ufw action inserts at the top: deny everything from the address. */
export const banRule = (ip: Ip): FwRuleInput => ({ dir: 'in', proto: 'any', src: ip, dst: 'any', dport: 'any', action: 'deny', note: 'fail2ban' });

function f2bFailure(sim: Sim, dev: Device, lx: LinuxState, ip: Ip, at = sim.t): void {
  const f = lx.f2b;
  if (!f.on || f.banned.includes(ip)) return;
  const t = at;
  const hits = (f.hits[ip] = (f.hits[ip] ?? []).filter((x) => t - x < f.findtime));
  hits.push(t);
  sim.log(dev.id, f2bEntry('fail2ban.filter', f.pid, 'INFO', `[sshd] Found ${ip} - ${isoStamp(lx.epoch + t).slice(0, 19)}`, { ip, src: ip, count: hits.length }));
  if (hits.length < f.maxretry) return;
  f.banned.push(ip);
  delete f.hits[ip];
  const fw = dev.firewall;
  if (fw && !fw.rules.some((r) => sameCriteria(r, banRule(ip)) && r.action === 'deny')) sim.fwAddRule(dev.id, banRule(ip), 0);
  sim.log(dev.id, f2bEntry('fail2ban.actions', f.pid, 'NOTICE', `[sshd] Ban ${ip}`, { ip, src: ip, action: 'ban' }));
  sim.emit({ t: sim.t, type: 'config', device: dev.id, what: 'fail2ban-ban', detail: ip });
}

/** Turn fail2ban on or off. Starting it writes its startup lines. */
export function setFail2ban(sim: Sim, dev: Device, on: boolean): void {
  const f = dev.linux!.f2b;
  if (f.on === on) return;
  f.on = on;
  if (on) {
    f.pid = dev.linux!.nextPid++;
    sim.log(dev.id, f2bEntry('fail2ban.server', f.pid, 'INFO', '--------------------------------------------------'));
    sim.log(dev.id, f2bEntry('fail2ban.server', f.pid, 'INFO', 'Starting Fail2ban v0.11.2'));
    sim.log(dev.id, f2bEntry('fail2ban.jail', f.pid, 'INFO', "Creating new jail 'sshd'"));
    sim.log(dev.id, f2bEntry('fail2ban.filter', f.pid, 'INFO', `  maxRetry: ${f.maxretry}`));
    sim.log(dev.id, f2bEntry('fail2ban.filter', f.pid, 'INFO', `  findtime: ${f.findtime / 1000}`));
    sim.log(dev.id, f2bEntry('fail2ban.actions', f.pid, 'INFO', `  banTime: ${f.bantime / 1000}`));
    sim.log(dev.id, f2bEntry('fail2ban.jail', f.pid, 'INFO', "Jail 'sshd' started"));
    // Like the real fail2ban, a new jail reads back through auth.log for failures still inside findtime.
    for (const e of [...dev.logs]) {
      const ip = e.fields?.src;
      if (e.fields?.file !== 'auth' || typeof ip !== 'string' || sim.t - e.t >= f.findtime) continue;
      if (['invalid', 'failed', 'preauth'].includes(String(e.fields.result))) f2bFailure(sim, dev, dev.linux!, ip, e.t);
    }
  } else {
    sim.log(dev.id, f2bEntry('fail2ban.jail', f.pid, 'INFO', "Jail 'sshd' stopped"));
    sim.log(dev.id, f2bEntry('fail2ban.server', f.pid, 'INFO', 'Exiting Fail2ban'));
    f.hits = {};
  }
  sim.emit({ t: sim.t, type: 'config', device: dev.id, what: 'fail2ban', on });
}

/** PasswordAuthentication yes/no in /etc/ssh/sshd_config, then a reload. */
export function setSshPasswords(sim: Sim, dev: Device, on: boolean): void {
  const lx = dev.linux!;
  if (lx.sshd.passwords === on) return;
  lx.sshd.passwords = on;
  sim.log(dev.id, authEntry('sshd', lx.sshd.pid, 'Received SIGHUP; restarting.'));
  sim.log(dev.id, authEntry('sshd', lx.sshd.pid, 'Server listening on 0.0.0.0 port 22.'));
  sim.emit({ t: sim.t, type: 'config', device: dev.id, what: 'ssh-passwords', on });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type HostCommand = 'ss' | 'ufw' | 'grep' | 'tail';

export type HostCmd =
  | { cmd: 'ss'; tcp: boolean; udp: boolean; listening: boolean; all: boolean; numeric: boolean; procs: boolean }
  | { cmd: 'ufw'; op: UfwOp }
  | { cmd: 'grep'; pattern: string; files: string[]; ignoreCase: boolean; count: boolean; number: boolean; invert: boolean }
  | { cmd: 'tail'; n: number; file: string };

export type HostParse = { ok: true; host: HostCmd } | { ok: false; msg: string };

/** Split a command line the way a shell does: spaces separate words, quotes keep them together. */
export function shellWords(raw: string): string[] | undefined {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (quote) return undefined;
  if (cur || has) out.push(cur);
  return out;
}

const SS_HELP = 'This ss knows -t (TCP), -u (UDP), -l (listening ports), -n (numbers instead of names), -p (the program), and -a (all).';

/** Read one host command. `words` are the shell words after the command's name. */
export function parseHost(cmd: HostCommand, words: string[]): HostParse {
  switch (cmd) {
    case 'ss': {
      const f = { tcp: false, udp: false, listening: false, all: false, numeric: false, procs: false };
      for (const w of words) {
        if (!/^-[a-z]+$/i.test(w)) return { ok: false, msg: `ss: “${w}” isn't an option. Options start with a dash: ss -tuln. ${SS_HELP}` };
        for (const ch of w.slice(1)) {
          if (ch === 't') f.tcp = true;
          else if (ch === 'u') f.udp = true;
          else if (ch === 'l') f.listening = true;
          else if (ch === 'a') f.all = true;
          else if (ch === 'n') f.numeric = true;
          else if (ch === 'p') f.procs = true;
          else return { ok: false, msg: `ss: invalid option -- '${ch}'. ${SS_HELP}` };
        }
      }
      return { ok: true, host: { cmd: 'ss', ...f } };
    }
    case 'ufw': {
      const r = parseUfw(words);
      return r.ok ? { ok: true, host: { cmd: 'ufw', op: r.op } } : { ok: false, msg: r.msg };
    }
    case 'grep': {
      const o = { ignoreCase: false, count: false, number: false, invert: false };
      const rest: string[] = [];
      for (const w of words) {
        if (/^-[a-z]+$/i.test(w) && !rest.length) {
          for (const ch of w.slice(1)) {
            if (ch === 'i') o.ignoreCase = true;
            else if (ch === 'c') o.count = true;
            else if (ch === 'n') o.number = true;
            else if (ch === 'v') o.invert = true;
            else return { ok: false, msg: `grep: invalid option -- '${ch}'. This grep knows -n (line numbers), -c (count), -i (ignore capitals), and -v (lines without the text).` };
          }
        } else rest.push(w);
      }
      if (!rest.length) return { ok: false, msg: 'Usage: grep [OPTION]... PATTERN [FILE]... Give the text to look for, then the file: grep "Failed password" /var/log/auth.log' };
      if (rest.length === 1) return { ok: false, msg: `grep needs a file after the text. Type it like this: grep ${quoteIfNeeded(rest[0])} /var/log/auth.log` };
      return { ok: true, host: { cmd: 'grep', pattern: rest[0], files: rest.slice(1), ...o } };
    }
    case 'tail': {
      let n = 10;
      const rest: string[] = [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w === '-n') {
          if (!/^\d+$/.test(words[i + 1] ?? '')) return { ok: false, msg: `tail: invalid number of lines: ‘${words[i + 1] ?? ''}’. Type it like this: tail -n 20 /var/log/auth.log` };
          n = Number(words[++i]);
        } else if (/^-n\d+$/.test(w) || /^-\d+$/.test(w)) n = Number(w.replace(/^-n?/, ''));
        else if (w === '-f' || w === '-F') return { ok: false, msg: 'tail -f keeps watching a file, and this terminal runs one command at a time. Run tail again to see new lines, or watch the Log files card.' };
        else if (w.startsWith('-')) return { ok: false, msg: `tail: invalid option -- '${w.slice(1)}'. This tail knows -n: tail -n 20 /var/log/auth.log` };
        else rest.push(w);
      }
      if (!rest.length) return { ok: false, msg: 'tail needs a file. Type it like this: tail /var/log/auth.log' };
      if (rest.length > 1) return { ok: false, msg: 'Give tail one file at a time.' };
      if (n > 500) n = 500;
      return { ok: true, host: { cmd: 'tail', n, file: rest[0] } };
    }
  }
}

const quoteIfNeeded = (s: string): string => (/\s/.test(s) ? `"${s}"` : s);

export interface HostOutLine {
  text: string;
  tone?: 'good' | 'bad' | 'muted' | 'warn' | 'head';
}

export interface HostResult {
  out: HostOutLine[];
  /** One sentence on what it means, for the line under the terminal. */
  meaning?: string;
}

/** A path the student typed, as one of the log files. */
function fileByPath(path: string): LogFile | undefined {
  return LOG_FILES.find((f) => LOG_PATH[f] === path);
}

/** For a path that isn't there: the full path of the file they likely meant. */
function pathHint(path: string): string | undefined {
  const base = path.split('/').pop() ?? '';
  const f = LOG_FILES.find((x) => LOG_PATH[x].endsWith(`/${base}`) || (base && LOG_PATH[x].includes(base)));
  return f ? `The file is ${LOG_PATH[f]}. Type the whole path, starting with /.` : undefined;
}

/** Run one host command on `dev`. Changes the firewall for ufw's add and delete. */
export function runHost(sim: Sim, dev: Device, c: HostCmd): HostResult {
  const lx = dev.linux;
  if (!lx) return { out: [{ text: `${c.cmd}: command not found`, tone: 'bad' }] };
  switch (c.cmd) {
    case 'ss':
      return ssRun(dev, lx, c);
    case 'ufw':
      return ufwRun(sim, dev, lx, c.op);
    case 'grep':
      return grepRun(dev, lx, c);
    case 'tail':
      return tailRun(dev, lx, c);
  }
}

// ss ------------------------------------------------------------------------

const SS_NAMES: Record<number, string> = {
  ...Object.fromEntries(Object.entries(UFW_NAMES).map(([name, v]) => [v.port, name])),
  53: 'domain',
};

interface SsRow {
  netid: L4;
  state: 'LISTEN' | 'UNCONN' | 'ESTAB';
  sendq: number;
  local: string;
  lport: number;
  peer: string;
  pport?: number;
  program: string;
}

const BACKLOG: Record<string, number> = { sshd: 128, nginx: 511, vsftpd: 32, smbd: 50, mysqld: 151, xrdp: 2, x11vnc: 5, master: 100, 'systemd-resolve': 4096 };

export function ssRows(dev: Device, lx: LinuxState): SsRow[] {
  const rows: SsRow[] = [];
  for (const l of lx.local) {
    rows.push({ netid: l.proto, state: l.proto === 'udp' ? 'UNCONN' : 'LISTEN', sendq: l.proto === 'udp' ? 0 : (BACKLOG[l.program] ?? 128), local: l.addr, lport: l.port, peer: '0.0.0.0', program: l.program });
  }
  for (const s of dev.services ?? []) {
    const program = s.program ?? s.app;
    rows.push({ netid: s.proto, state: s.proto === 'udp' ? 'UNCONN' : 'LISTEN', sendq: s.proto === 'udp' ? 0 : (BACKLOG[program] ?? 128), local: '0.0.0.0', lport: s.port, peer: '0.0.0.0', program });
  }
  const own = dev.ifaces.find((i) => i.ip)?.ip ?? '0.0.0.0';
  for (const s of lx.sessions) rows.push({ netid: 'tcp', state: 'ESTAB', sendq: 0, local: own, lport: s.port, peer: s.peer, pport: s.pport, program: s.program });
  return rows.sort((a, b) => (a.netid === b.netid ? 0 : a.netid === 'udp' ? -1 : 1) || (a.state === b.state ? 0 : a.state === 'ESTAB' ? 1 : -1) || a.lport - b.lport);
}

function ssRun(dev: Device, lx: LinuxState, c: Extract<HostCmd, { cmd: 'ss' }>): HostResult {
  const both = !c.tcp && !c.udp;
  const rows = ssRows(dev, lx).filter((r) => (both || (r.netid === 'tcp' ? c.tcp : c.udp)) && (c.all ? true : c.listening ? r.state !== 'ESTAB' : r.state === 'ESTAB'));
  const name = (p: number) => (c.numeric ? String(p) : (SS_NAMES[p] ?? String(p)));
  const lo = (a: string) => (a.startsWith('127.0.0.53') ? '127.0.0.53%lo' : a);
  const out: HostOutLine[] = [
    { text: `${'Netid'.padEnd(6)}${'State'.padEnd(8)}${'Recv-Q'.padEnd(7)}${'Send-Q'.padEnd(7)}${'Local Address:Port'.padStart(22)} ${'Peer Address:Port'.padStart(22)}${c.procs ? ' Process' : ''}`, tone: 'head' },
  ];
  for (const r of rows) {
    const local = `${lo(r.local)}:${name(r.lport)}`;
    const peer = `${r.peer}:${r.pport ?? '*'}`;
    const proc = c.procs ? ` users:(("${r.program}",pid=${lx.pids[r.program] ?? 1},fd=${r.state === 'ESTAB' ? 4 : 3}))` : '';
    out.push({ text: `${r.netid.padEnd(6)}${r.state.padEnd(8)}${'0'.padEnd(7)}${String(r.sendq).padEnd(7)}${local.padStart(22)} ${peer.padStart(22)}${proc}` });
  }
  const listening = rows.filter((r) => r.state !== 'ESTAB');
  const open = listening.filter((r) => r.local === '0.0.0.0');
  let meaning: string;
  if (!listening.length && !c.all) {
    meaning = rows.length
      ? 'These are connections open right now. Add -l to list the ports where programs wait for new connections: ss -tuln.'
      : 'No connections open right now. Add -l to list the ports where programs wait for connections: ss -tuln.';
  } else {
    meaning = `${listening.length} sockets are listening (UDP ones show UNCONN). ${open.length} of them use 0.0.0.0, which means "every address this server has": anyone the firewall lets through can connect. 127.0.0.1 and 127.0.0.53 accept connections only from programs on this server.`;
    if (!c.numeric) meaning += ' Add -n to see port numbers instead of names.';
  }
  return { out, meaning };
}

// ufw -----------------------------------------------------------------------

function ufwRun(sim: Sim, dev: Device, lx: LinuxState, op: UfwOp): HostResult {
  const fw = dev.firewall;
  if (!fw) return { out: [{ text: 'Status: inactive' }], meaning: 'This computer has no firewall turned on.' };
  if (op.op === 'status') {
    const out = ufwStatus(fw, lx.ufw, op).map((text, i): HostOutLine => ({ text, tone: i === 0 ? 'good' : undefined }));
    const last = fw.rules.length;
    return {
      out,
      meaning: op.numbered
        ? `Each numbered line is one rule. ufw checks them from [ 1] down and stops at the first rule that matches. What no rule matches gets the default policy: ${lx.ufw.in} incoming, ${lx.ufw.out} outgoing.${last ? ` Rule numbers change when you insert or delete, so look again before the next change.` : ''}`
        : op.verbose
          ? 'The Default line is what happens to traffic no rule matches. Add numbered to see each rule’s number: ufw status numbered.'
          : 'ufw checks these rules from the top and stops at the first one that matches. Add numbered to see each rule’s number: ufw status numbered.',
    };
  }
  const e = ufwEffect(fw, op);
  const lines = ufwEffectLines(e).map((text): HostOutLine => ({ text, tone: e.kind === 'error' ? 'bad' : e.kind === 'skipped' ? 'warn' : undefined }));
  switch (e.kind) {
    case 'added':
    case 'inserted': {
      const rule = (op as Extract<UfwOp, { op: 'add' }>).rule;
      sim.fwAddRule(dev.id, rule, e.index);
      const n = e.index + 1;
      // A rule above it that matches every packet in its direction: ufw never reaches the new rule.
      const cover = fw.rules.findIndex((r, i) => i < e.index && r.dir === rule.dir && r.src === 'any' && r.dst === 'any' && r.dport === 'any' && r.proto === 'any' && (r.sport ?? 'any') === 'any');
      const meaning =
        cover >= 0
          ? `ufw put it at the bottom, as rule ${n}. Rule ${cover + 1} above it matches every ${rule.dir === 'in' ? 'incoming' : 'outgoing'} packet, and ufw stops at the first match, so it never gets to rule ${n}.`
          : e.kind === 'inserted'
            ? `The new rule is rule ${n}. Every rule that was at ${n} or below moved down one number.`
            : `ufw put it at the bottom, as rule ${n}. Rules above it are checked first.`;
      return { out: lines, meaning };
    }
    case 'updated': {
      const old = fw.rules[e.index];
      const rule = (op as Extract<UfwOp, { op: 'add' }>).rule;
      sim.fwEditRule(dev.id, e.id, { ...old, action: rule.action, note: rule.note ?? old.note });
      return { out: lines, meaning: `ufw already had a rule for this traffic (rule ${e.index + 1}), so it changed that rule to ${rule.action.toUpperCase()} instead of adding a new one.` };
    }
    case 'skipped':
      return {
        out: lines,
        meaning: e.inserting
          ? `ufw already has this exact rule (rule ${e.index + 1}), so nothing changed. To move it, delete rule ${e.index + 1} first, then insert it where you want it.`
          : `ufw already has this exact rule (rule ${e.index + 1}), so nothing changed.`,
      };
    case 'deleted':
      sim.fwDeleteRule(dev.id, e.id);
      if (e.rule.note === 'fail2ban' && lx.f2b.banned.includes(e.rule.src)) lx.f2b.banned = lx.f2b.banned.filter((x) => x !== e.rule.src);
      return {
        out: lines,
        meaning: `Rule ${e.index + 1} is gone, and every rule below it moved up one number. (A real ufw asks "Proceed with operation (y|n)?" first.) Run ufw status numbered before the next delete.`,
      };
    case 'error':
      return {
        out: lines,
        meaning: e.msg.startsWith('ERROR: Invalid position')
          ? `There are ${fw.rules.length} rules, so insert takes a number from 1 to ${fw.rules.length}. To add a rule at the very bottom, leave out insert.`
          : e.msg.startsWith('ERROR: Could not find')
            ? `There are ${fw.rules.length} rules. Run ufw status numbered to see their numbers.`
            : 'No rule matches that exactly. Delete by number instead: run ufw status numbered, then ufw delete <number>.',
      };
  }
}

// grep and tail -------------------------------------------------------------

/** grep's basic regular expressions: . * ^ $ [ ] work; + ? | ( ) { } are plain characters. */
function grepRegex(pattern: string, ignoreCase: boolean): RegExp | undefined {
  const src = pattern.replace(/\\(.)/g, '\u0000$1').replace(/[+?|(){}]/g, '\\$&').replace(/\u0000(.)/g, (_, c) => (/[+?|(){}]/.test(c) ? c : `\\${c}`));
  try {
    return new RegExp(src, ignoreCase ? 'i' : '');
  } catch {
    return undefined;
  }
}

function missing(cmd: string, path: string): HostOutLine[] {
  if (path === '/var/log' || path === '/var/log/' || path === '/var/log/nginx') return [{ text: `${cmd}: ${path}: Is a directory`, tone: 'bad' }];
  const hint = pathHint(path);
  const out: HostOutLine[] = [{ text: `${cmd}: ${path}: No such file or directory`, tone: 'bad' }];
  if (hint) out.push({ text: hint, tone: 'muted' });
  return out;
}

function grepRun(dev: Device, lx: LinuxState, c: Extract<HostCmd, { cmd: 'grep' }>): HostResult {
  const re = grepRegex(c.pattern, c.ignoreCase);
  if (!re) return { out: [{ text: 'grep: Unmatched [, [^, [:, [., or [=', tone: 'bad' }], meaning: 'grep reads [ as the start of a list of characters. Put a backslash before it to look for a plain [: \\[' };
  const out: HostOutLine[] = [];
  const many = c.files.length > 1;
  let total = 0;
  let found = 0;
  let readable = 0;
  const MAX = 300;
  for (const path of c.files) {
    const file = fileByPath(path);
    if (!file) {
      out.push(...missing('grep', path));
      continue;
    }
    readable++;
    const rows = fileRows(dev, file);
    let count = 0;
    rows.forEach((e, i) => {
      const line = fileLine(lx, e);
      if (re.test(line) === c.invert) return;
      count++;
      if (c.count || out.length >= MAX) return;
      out.push({ text: `${many ? `${path}:` : ''}${c.number ? `${i + 1}:` : ''}${line}` });
    });
    total += rows.length;
    found += count;
    if (c.count) out.push({ text: `${many ? `${path}:` : ''}${count}` });
  }
  if (found > MAX && !c.count) out.push({ text: `(${found - MAX} more lines not shown)`, tone: 'muted' });
  if (!readable) return { out };
  const what = c.invert ? `don't contain` : 'contain';
  let meaning = c.count
    ? `${found} of ${total} lines ${what} “${c.pattern}”.`
    : found
      ? `${found} line${found === 1 ? '' : 's'} ${what} “${c.pattern}”.${c.number ? ' The number before each line is its line number in the file.' : ' Add -n to see each line’s number in the file.'}`
      : `No line ${c.invert ? 'is missing' : 'contains'} “${c.pattern}”.`;
  if (!found && !c.ignoreCase && /[A-Za-z]/.test(c.pattern)) meaning += ' grep matches capital letters exactly. Add -i to ignore them.';
  return { out, meaning };
}

function tailRun(dev: Device, lx: LinuxState, c: Extract<HostCmd, { cmd: 'tail' }>): HostResult {
  const file = fileByPath(c.file);
  if (!file) return { out: missing('tail', c.file) };
  const rows = fileRows(dev, file);
  const shown = rows.slice(Math.max(0, rows.length - c.n));
  const out: HostOutLine[] = shown.map((e) => ({ text: fileLine(lx, e) }));
  const first = rows.length - shown.length + 1;
  return {
    out,
    meaning: shown.length ? `Lines ${first} to ${rows.length} of ${c.file}, the newest at the bottom.` : `${c.file} is empty.`,
  };
}
