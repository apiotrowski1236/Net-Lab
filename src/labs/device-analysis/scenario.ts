import type { Ip } from '../../sim/addr';
import { NetBuilder } from '../../sim/build';
import { addrMatches, newFirewall, type FwRule, type FwRuleInput } from '../../sim/firewall';
import { accessEntry, authEntry, fileRows, httpRequest, sshRequest, type LogFile, type LogLine } from '../../sim/linux';
import type { Conn } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { HostRun } from '../../sim/terminal';
import type { IpPacket, LogEntry } from '../../sim/types';
import { hostVerdict, ufwLogLine, UFW_DEFAULT } from '../../sim/ufw';

/**
 * Harbor Food Co-op's web server (see PLAN.md). One Ubuntu server, web01,
 * with a host firewall (ufw), sshd, nginx, and fail2ban. Around it, one
 * internet router with five networks: the co-op's office (Jo's laptop), the
 * vendor Bayline Farms, a customer, and 203.0.113.0/24, where three unknown
 * computers sit behind a switch: the weekend's password sprayer, the
 * scanner, and a bot that shows up during the lab.
 *
 * The weekend before the lab is in web01's log files from the start
 * (`weekend`): a pure function of nothing, so the row numbers the questions
 * cite are constants here (`ROWS`).
 */

export const WEB = 'web01';

export const IP = {
  web: '198.51.100.10',
  webGw: '198.51.100.1',
  jo: '192.0.2.15',
  officeGw: '192.0.2.1',
  vendor: '198.18.40.12',
  vendorGw: '198.18.40.1',
  customer: '198.19.7.44',
  customerGw: '198.19.7.1',
  sprayer: '203.0.113.77',
  scanner: '203.0.113.140',
  bot: '203.0.113.201',
  badGw: '203.0.113.1',
} as const;

export const NET = {
  office: '192.0.2.0/24',
  vendor: '198.18.40.0/24',
} as const;

/** Monday, November 16, 2026, 9:00 UTC: sim time 0. The weekend is Nov 14 and 15. */
export const EPOCH = Date.UTC(2026, 10, 16, 9, 0, 0);

/** Sim time (ms, negative before the lab starts) for a moment of the weekend. */
const at = (day: number, h: number, m: number, s: number, ms = 0) => Date.UTC(2026, 10, day, h, m, s, ms) - EPOCH;

/** The accounts sshd knows. Jo and the vendor sign in with keys; root exists but has no key. */
export const KEYS = {
  jo: { id: 'jo-laptop', type: 'ED25519' as const, fp: 'k3Vq9xY2mB7nR4tL8wE1cZ6uH0pJ5sA3dF9gK2oQ7iW' },
  bayline: { id: 'bayline-sftp', type: 'RSA' as const, fp: 'Qm8rT2vX5nL9pB4cW7yE1kH6sJ3dF0gA8uZ5oI2qR4t' },
};

const tcp = (dport: number, src = 'any', action: 'allow' | 'deny' = 'allow'): FwRuleInput => ({ dir: 'in', proto: 'tcp', src, dst: 'any', dport, action });

/** web01's ufw rules on Monday morning, in order. Rules 2, 5, and 7 break the co-op's policy. */
export const RULES: FwRuleInput[] = [
  tcp(22, IP.scanner, 'deny'),
  tcp(21),
  tcp(80),
  tcp(443),
  tcp(22),
  tcp(3306, NET.office),
  tcp(3389),
  tcp(5900, IP.jo),
  tcp(445, NET.office),
  { dir: 'in', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'deny' },
];

/** The site's pages and their sizes. */
const PAGES: Record<string, number> = {
  '/': 5120,
  '/menu': 6230,
  '/order': 8412,
  '/about': 3120,
  '/css/site.css': 4410,
  '/js/order.js': 9120,
  '/favicon.ico': 1150,
  '/robots.txt': 68,
};

export const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  curl: 'curl/7.81.0',
} as const;

const SITE = 'https://shop.harborfood.example';

// ---------------------------------------------------------------------------
// The weekend, in web01's log files
// ---------------------------------------------------------------------------

interface Hist {
  t: number;
  line: LogLine;
}

/** A small seeded random number generator, so the weekend is the same every time and needs no Sim. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The usernames the weekend spray tried, in order. One or two passwords each: a spray, not a brute-force attack. */
export const SPRAY_USERS = ['admin', 'test', 'user', 'ubuntu', 'oracle', 'postgres', 'root', 'ftpuser', 'guest', 'pi', 'deploy', 'support', 'git', 'backup'];

/** Ports the Sunday night scan knocked on (in the order nmap sent them). */
export const SCAN_ORDER = [443, 3306, 23, 80, 8080, 21, 445, 25, 110, 5900, 22, 143, 3389, 53];

/** The paths 203.0.113.140 asked for: first looking for weak spots, then trying to climb out of the web folder. */
export const PROBE_PATHS = ['/.env', '/.git/config', '/wp-login.php', '/phpmyadmin/', '/admin/', '/backup.zip'];
export const TRAVERSAL_PATHS = ['/download?file=../../../../etc/passwd', '/images/../../../../etc/passwd', '/download?file=..%2f..%2f..%2f..%2fetc%2fshadow'];

function weekend(): Hist[] {
  const r = prng(20261116);
  const between = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const out: Hist[] = [];
  const add = (t: number, line: LogLine) => out.push({ t, line });
  let pid = 14205;

  // --- auth.log ---
  const sshd = (t: number, p: number, msg: string, facts: Record<string, string | number> = {}) => add(t, authEntry('sshd', p, msg, facts));
  const upload = (day: number) => {
    const t = at(day, 2, 10, between(1, 9));
    const p = pid++;
    const port = between(40000, 60999);
    const who = { ip: IP.vendor, src: IP.vendor, user: 'bayline', sport: port };
    sshd(t, p, `Accepted publickey for bayline from ${IP.vendor} port ${port} ssh2: RSA SHA256:${KEYS.bayline.fp}`, { ...who, result: 'accepted', method: 'publickey' });
    sshd(t, p, 'pam_unix(sshd:session): session opened for user bayline(uid=1001) by (uid=0)', { ...who, result: 'session' });
    sshd(t + 400, pid++, 'subsystem request for sftp by user bayline', { ...who, result: 'sftp' });
    sshd(t + between(5000, 9000), p, 'pam_unix(sshd:session): session closed for user bayline', { ...who, result: 'closed' });
  };
  const cron = (day: number) => {
    const t = at(day, 6, 25, 1);
    const p = pid++;
    add(t, authEntry('CRON', p, 'pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)', { user: 'root', result: 'cron' }));
    add(t + 2000, authEntry('CRON', p, 'pam_unix(cron:session): session closed for user root', { user: 'root', result: 'cron' }));
  };
  upload(14);
  cron(14);
  upload(15);
  let t = at(15, 3, 20, 14);
  for (const u of SPRAY_USERS) {
    const port = between(32768, 60999);
    const invalid = u !== 'root';
    sshd(t, pid++, `Failed password for ${invalid ? 'invalid user ' : ''}${u} from ${IP.sprayer} port ${port} ssh2`, {
      ip: IP.sprayer,
      src: IP.sprayer,
      user: u,
      sport: port,
      result: invalid ? 'invalid' : 'failed',
      method: 'password',
    });
    t += between(24_000, 41_000);
  }
  cron(15);
  upload(16);
  cron(16);
  {
    const t = at(16, 8, 41, 12);
    const p = pid++;
    const who = { ip: IP.jo, src: IP.jo, user: 'jo', sport: 50122 };
    sshd(t, p, `Accepted publickey for jo from ${IP.jo} port 50122 ssh2: ED25519 SHA256:${KEYS.jo.fp}`, { ...who, result: 'accepted', method: 'publickey' });
    sshd(t, p, 'pam_unix(sshd:session): session opened for user jo(uid=1000) by (uid=0)', { ...who, result: 'session' });
    add(t + 30, authEntry('systemd-logind', 701, 'New session 57 of user jo.', { user: 'jo', result: 'session' }));
  }

  // --- ufw.log: what the firewall blocked ---
  const fw = newFirewall('eth0', 'stateful', RULES);
  const block = (t: number, src: Ip, dport: number, sport: number, ttl: number, scan = false) => {
    const pkt: IpPacket = { src, dst: IP.web, ttl, proto: 'tcp', srcPort: sport, dstPort: dport, app: { kind: 'svc', conn: 0, app: 'tcp', reply: false } };
    const v = hostVerdict(fw, pkt, 'in', UFW_DEFAULT);
    if (v.action === 'deny') add(t, ufwLogLine('eth0', pkt, 'in', v, scan));
  };
  block(at(14, 4, 12, 33), '203.0.113.9', 23, between(32768, 60999), 47);
  block(at(14, 13, 40, 2), '203.0.113.58', 445, between(32768, 60999), 51);
  block(at(15, 19, 5, 41), '203.0.113.233', 1433, between(32768, 60999), 50);
  {
    // nmap sends every probe from one source port, a few milliseconds apart.
    let t = at(15, 22, 47, 10, 120);
    const sport = 48211;
    for (const p of SCAN_ORDER) {
      block(t, IP.scanner, p, sport, 52, true);
      t += between(40, 180);
    }
  }
  block(at(16, 5, 31, 18), '203.0.113.9', 23, between(32768, 60999), 47);

  // --- access.log: nginx ---
  const get = (t: number, ip: Ip, path: string, ua: string, method = 'GET', referer?: string) => {
    const status = path.includes('..') ? 400 : method === 'POST' ? 302 : PAGES[path.split('?')[0]] !== undefined ? 200 : 404;
    const bytes = status === 200 ? PAGES[path.split('?')[0]] : status === 302 ? 0 : status === 400 ? 166 : 162;
    add(t, accessEntry({ ip, method, path, status, bytes, ua, referer }));
  };
  const shop = (day: number, h: number, m: number, ip: Ip, ua: string, buys: boolean) => {
    const t = at(day, h, m, between(0, 59));
    get(t, ip, '/menu', ua);
    if (buys) {
      get(t + between(20_000, 90_000), ip, '/order', ua, 'GET', `${SITE}/menu`);
      get(t + between(100_000, 200_000), ip, '/order', ua, 'POST', `${SITE}/order`);
    }
  };
  get(at(14, 3, 2, 44), '66.249.66.1', '/robots.txt', UA.google);
  shop(14, 9, 15, '198.19.22.8', UA.iphone, true);
  shop(14, 12, 48, '198.19.130.71', UA.chrome, false);
  shop(14, 17, 3, IP.customer, UA.mac, true);
  shop(15, 10, 21, '198.19.64.15', UA.iphone, true);
  shop(15, 16, 37, '198.19.201.9', UA.chrome, true);
  {
    let t = at(15, 22, 51, 3);
    for (const p of PROBE_PATHS) {
      get(t, IP.scanner, p, UA.curl);
      t += between(300, 1400);
    }
    t = at(15, 22, 53, 40);
    for (const p of TRAVERSAL_PATHS) {
      get(t, IP.scanner, p, UA.curl);
      t += between(900, 2600);
    }
  }
  shop(16, 7, 52, '198.19.22.8', UA.iphone, true);
  get(at(16, 8, 30, 9), '66.249.66.1', '/', UA.google);

  return out.sort((a, b) => a.t - b.t);
}

/** The weekend, built once. */
const HISTORY = weekend();

const fileOfLine = (l: LogLine) => l.fields?.file as LogFile;
/** The weekend's lines in one file, oldest first: row n is [n - 1]. */
const histRows = (file: LogFile) => HISTORY.filter((h) => fileOfLine(h.line) === file).map((h) => h.line);
const rowsWhere = (file: LogFile, pred: (f: Record<string, string | number>) => boolean) =>
  histRows(file).flatMap((l, i) => (pred(l.fields ?? {}) ? [i + 1] : []));

/** Rows the questions cite, counted from 1 like the Log files card. */
export const ROWS = {
  spray: rowsWhere('auth', (f) => f.src === IP.sprayer),
  scan: rowsWhere('ufw', (f) => f.src === IP.scanner),
  scan22: rowsWhere('ufw', (f) => f.src === IP.scanner && f.dport === 22)[0],
  scan25: rowsWhere('ufw', (f) => f.src === IP.scanner && f.dport === 25)[0],
  probes: rowsWhere('access', (f) => f.src === IP.scanner && f.status === 404),
  traversal: rowsWhere('access', (f) => String(f.path).includes('..')),
  /** How many rows each file had before the lab began. */
  count: { auth: histRows('auth').length, ufw: histRows('ufw').length, access: histRows('access').length, fail2ban: 0 } as Record<LogFile, number>,
};

/** What a weekend row is, for feedback on a wrong citation. */
export function describeRow(file: LogFile, n: number): string | undefined {
  const l = histRows(file)[n - 1];
  if (!l) return n > ROWS.count[file] ? 'that row was written today, during this lab, not over the weekend' : undefined;
  const f = l.fields ?? {};
  if (file === 'auth') {
    if (f.prog === 'CRON') return 'it is a scheduled job (CRON) the server runs every morning';
    if (f.user === 'bayline') return "it is Bayline Farms' nightly upload, signing in with its key";
    if (f.user === 'jo') return 'it is Jo signing in with a key on Monday morning';
    return `it is a sign-in from ${f.src}`;
  }
  if (file === 'ufw') return f.src === IP.scanner ? `it is from ${IP.scanner}, but this question asks about another address` : `it is a single packet from ${f.src}, a different address`;
  if (f.src === IP.scanner) return f.status === 404 ? `it asks for ${f.path}, a file that isn't there (404), with no ../ in it` : `it is from ${IP.scanner}, but asks for something else`;
  return f.ua === UA.google ? "it is Google's search robot reading the site" : `it is a customer at ${f.src} using the site`;
}

// ---------------------------------------------------------------------------
// The network
// ---------------------------------------------------------------------------

export function buildCoop(): Sim {
  const sim = new NetBuilder({ linkMs: 130, procMs: 40, l2Ms: 30, arpTimeoutMs: 1200, pingTimeoutMs: 1600, httpTimeoutMs: 8000 })
    .host(WEB, {
      label: 'web01',
      icon: 'server',
      x: 170,
      y: 380,
      ip: `${IP.web}/24`,
      gateway: IP.webGw,
      services: [
        { port: 21, proto: 'tcp', app: 'ftp', banner: 'vsftpd 3.0.5', program: 'vsftpd' },
        { port: 22, proto: 'tcp', app: 'ssh', banner: 'OpenSSH 8.9p1 Ubuntu 3ubuntu0.10', program: 'sshd' },
        { port: 80, proto: 'tcp', app: 'http', banner: 'nginx 1.18.0 (Ubuntu)', program: 'nginx' },
        { port: 443, proto: 'tcp', app: 'https', banner: 'nginx 1.18.0 (Ubuntu)', program: 'nginx' },
        { port: 445, proto: 'tcp', app: 'smb', banner: 'Samba smbd 4.15.13-Ubuntu', program: 'smbd' },
        { port: 3306, proto: 'tcp', app: 'mysql', banner: 'MySQL 8.0.40-0ubuntu0.22.04.1', program: 'mysqld' },
        { port: 3389, proto: 'tcp', app: 'rdp', banner: 'xrdp 0.9.17', program: 'xrdp' },
        { port: 5900, proto: 'tcp', app: 'vnc', banner: 'x11vnc (VNC protocol 3.8)', program: 'x11vnc' },
      ],
      firewall: { mode: 'stateful', rules: RULES },
      linux: {
        hostname: 'web01',
        user: 'jo',
        epoch: EPOCH,
        users: { root: { uid: 0 }, jo: { uid: 1000, key: KEYS.jo }, bayline: { uid: 1001, key: KEYS.bayline } },
        pages: PAGES,
        local: [
          { proto: 'tcp', addr: '127.0.0.1', port: 25, program: 'master' },
          { proto: 'tcp', addr: '127.0.0.53', port: 53, program: 'systemd-resolve' },
          { proto: 'udp', addr: '127.0.0.53', port: 53, program: 'systemd-resolve' },
        ],
        sessions: [{ port: 22, peer: IP.jo, pport: 50122, program: 'sshd' }],
        pids: { sshd: 812, nginx: 1043, vsftpd: 905, smbd: 1120, mysqld: 1201, xrdp: 1288, x11vnc: 1390, master: 1502, 'systemd-resolve': 640 },
      },
    })
    .router('net', {
      label: 'Internet',
      icon: 'cloud',
      x: 520,
      y: 380,
      ifaces: [
        { id: 'web', ip: `${IP.webGw}/24` },
        { id: 'office', ip: `${IP.officeGw}/24` },
        { id: 'vendor', ip: `${IP.vendorGw}/24` },
        { id: 'cust', ip: `${IP.customerGw}/24` },
        { id: 'far', ip: `${IP.badGw}/24` },
      ],
    })
    .host('jo', { label: "Jo's laptop", icon: 'laptop', x: 330, y: 150, ip: `${IP.jo}/24`, gateway: IP.officeGw })
    .host('vendor', { label: 'Bayline Farms', icon: 'server', x: 720, y: 150, ip: `${IP.vendor}/24`, gateway: IP.vendorGw })
    .host('customer', { label: 'Customer', icon: 'phone', x: 900, y: 270, ip: `${IP.customer}/24`, gateway: IP.customerGw })
    .switch('badsw', { label: 'Switch', icon: 'switch', x: 980, y: 510, ports: 4 })
    .host('sprayer', { label: 'Unknown A', icon: 'attacker', x: 830, y: 640, ip: `${IP.sprayer}/24`, gateway: IP.badGw, attacker: true })
    .host('scanner', { label: 'Unknown B', icon: 'attacker', x: 980, y: 640, ip: `${IP.scanner}/24`, gateway: IP.badGw, attacker: true })
    .host('bot', { label: 'Unknown C', icon: 'attacker', x: 1130, y: 640, ip: `${IP.bot}/24`, gateway: IP.badGw, attacker: true })
    .link(WEB, ['net', 'web'])
    .link('jo', ['net', 'office'])
    .link('vendor', ['net', 'vendor'])
    .link('customer', ['net', 'cust'])
    .link(['net', 'far'], 'badsw')
    .link('sprayer', 'badsw')
    .link('scanner', 'badsw')
    .link('bot', 'badsw')
    .build();

  for (const h of HISTORY) sim.log(WEB, h.line, h.t);

  // The network has been running a while: ARP tables and the switch are full.
  sim.quiet = true;
  sim.prelearnSwitch('badsw');
  const gw: Record<string, Ip> = { [WEB]: IP.webGw, jo: IP.officeGw, vendor: IP.vendorGw, customer: IP.customerGw, sprayer: IP.badGw, scanner: IP.badGw, bot: IP.badGw };
  for (const [id, ip] of Object.entries(gw)) sim.ping(id, ip);
  sim.runUntilIdle();
  sim.quiet = false;
  // The history is in the logs. Nothing on the live network has happened yet.
  sim.events = [];
  return sim;
}

// ---------------------------------------------------------------------------
// Who does what (lesson buttons call these)
// ---------------------------------------------------------------------------

const connect = (sim: Sim, from: string, port: number, data: string | undefined, tag: string) => sim.connectService(from, IP.web, port, { data, tag });

export const customerVisit = (sim: Sim) => connect(sim, 'customer', 443, httpRequest({ method: 'GET', path: '/order', ua: UA.mac }), 'customer');
export const joSignIn = (sim: Sim) => connect(sim, 'jo', 22, sshRequest({ user: 'jo', auth: 'publickey', key: KEYS.jo.id }), 'jo');
export const vendorUpload = (sim: Sim) => connect(sim, 'vendor', 22, sshRequest({ user: 'bayline', auth: 'publickey', key: KEYS.bayline.id, sftp: true }), 'vendor');
export const scannerSsh = (sim: Sim) => connect(sim, 'scanner', 22, sshRequest({ user: 'root', auth: 'password' }), 'scanner-ssh');
export const scannerRdp = (sim: Sim) => connect(sim, 'scanner', 3389, undefined, 'scanner-rdp');

/** Password guesses from `from`, one username each, `gap` ms apart. */
function guess(sim: Sim, from: string, users: string[], gap: number, tag: string): void {
  users.forEach((u, i) => sim.schedule(i * gap, () => connect(sim, from, 22, sshRequest({ user: u, auth: 'password' }), tag)));
}

/** The weekend's spray, again: four of its usernames from 203.0.113.77. */
export const SPRAY_AGAIN = ['admin', 'ubuntu', 'oracle', 'root'];
export const replaySpray = (sim: Sim) => guess(sim, 'sprayer', SPRAY_AGAIN, 250, 'spray');

/** The bot's run of guesses: more than fail2ban's limit of 5. */
export const BOT_USERS = ['admin', 'root', 'test', 'ubuntu', 'user', 'administrator', 'support', 'guest'];
export const botAttack = (sim: Sim) => guess(sim, 'bot', BOT_USERS, 300, 'bot');

/**
 * Step 8: the bot is one of many. Each press comes from the next address,
 * with 3 guesses: fewer than fail2ban's 5, so fail2ban never bans it.
 */
export const BOTNET_USERS = ['admin', 'root', 'deploy'];
export function botnetAttack(sim: Sim): void {
  const n = Number(botIp(sim).split('.')[3]);
  sim.setIp('bot', 'eth0', `203.0.113.${n + 1}`, 24);
  guess(sim, 'bot', BOTNET_USERS, 300, 'botnet');
}
export const botIp = (sim: Sim): Ip => sim.dev('bot').ifaces[0].ip ?? IP.bot;

/** The replay knocks on the same ports as Sunday night's scan. */
export const RESCAN_PORTS = SCAN_ORDER;
export const replayScan = (sim: Sim) => sim.scan('scanner', IP.web, RESCAN_PORTS);

// ---------------------------------------------------------------------------
// Reading the network
// ---------------------------------------------------------------------------

export const fw = (sim: Sim) => sim.dev(WEB).firewall!;
export const lx = (sim: Sim) => sim.dev(WEB).linux!;

/** What web01's firewall would do with a new TCP connection from `src` to `port`, right now. */
export function verdictFor(sim: Sim, src: Ip, port: number) {
  const pkt: IpPacket = { src, dst: IP.web, ttl: 64, proto: 'tcp', srcPort: 40000, dstPort: port, app: { kind: 'svc', conn: 0, app: 'tcp', reply: false } };
  return hostVerdict(fw(sim), pkt, 'in', lx(sim).ufw);
}
export const allows = (sim: Sim, src: Ip, port: number) => verdictFor(sim, src, port).action === 'allow';

/** An address out on the internet that no rule names. */
export const STRANGER = '203.0.113.50';

/** The policy's SSH rule: the office gets in, the internet doesn't. */
export const sshOfficeOnly = (sim: Sim) => allows(sim, IP.jo, 22) && !allows(sim, STRANGER, 22) && !allows(sim, IP.customer, 22);
export const ftpClosed = (sim: Sim) => !allows(sim, STRANGER, 21) && !allows(sim, IP.customer, 21) && !allows(sim, IP.jo, 21);
export const rdpClosed = (sim: Sim) => !allows(sim, STRANGER, 3389) && !allows(sim, IP.customer, 3389);
export const websiteOpen = (sim: Sim) => allows(sim, IP.customer, 443) && allows(sim, STRANGER, 443);

/** The newest connection `from` started since `since` with `tag`. */
export function lastConn(sim: Sim, from: string, since: number, tag?: string): Conn | undefined {
  return (sim.dev(from).conns ?? []).filter((c) => c.t >= since && (!tag || c.tag === tag)).pop();
}

/** The firewall's verdict on a connection (from the 'firewall' event for its first packet). */
export function connVerdict(sim: Sim, c: Conn) {
  for (const e of sim.events) {
    if (e.t < c.t) continue;
    if (e.type === 'firewall' && e.device === WEB && e.dir === 'in' && e.pkt.app.kind === 'svc' && e.pkt.app.conn === c.id && !e.pkt.app.reply) return e.verdict;
  }
  return undefined;
}

/** A rule as students read it in the table: "ALLOW 22/tcp from Anywhere". */
export function ruleWords(r: FwRule | FwRuleInput): string {
  const port = r.dport === 'any' ? '' : ` ${r.dport}${r.proto === 'any' ? '' : `/${r.proto}`}`;
  return `${r.action.toUpperCase()}${port || ' everything'} from ${r.src === 'any' ? 'Anywhere' : r.src}`;
}

/** "Allowed by rule 4 (ALLOW 443/tcp from Anywhere)" for a connection's first packet. */
export function verdictWords(sim: Sim, c: Conn): string | undefined {
  const v = connVerdict(sim, c);
  if (!v) return undefined;
  const verb = v.action === 'allow' ? 'Allowed' : 'Blocked';
  if (v.by !== 'rule') return `${verb} by the default policy`;
  const r = fw(sim).rules.find((x) => x.id === v.ruleId);
  return `${verb} by rule ${v.ruleNo}${r ? ` (${ruleWords(r)})` : ''}`;
}

/** web01's log rows in one file since `since`. */
export const rowsSince = (sim: Sim, file: LogFile, since: number): LogEntry[] => fileRows(sim.dev(WEB), file).filter((e) => e.t >= since);

/** Terminal commands run on web01 since `since`. */
export function hostRuns(sim: Sim, since: number): HostRun[] {
  return (sim.dev(WEB).term ?? []).filter((r): r is HostRun => r.kind === 'host' && r.t >= since && r.doneAt !== undefined);
}

/** A deny rule that names 203.0.113.77 (alone or in a network) and covers SSH. */
export const sprayRule = (r: FwRule) => r.action === 'deny' && r.dir === 'in' && r.src !== 'any' && addrMatches(r.src, IP.sprayer) && (r.dport === 'any' || r.dport === 22);

// ---------------------------------------------------------------------------
// Setups (quiet, idempotent: keep the student's work, fill in what's missing)
// ---------------------------------------------------------------------------

/** From the fail2ban step on: 203.0.113.77 is blocked, whatever the student typed. */
export function ensureSprayBlocked(sim: Sim): void {
  if (!allows(sim, IP.sprayer, 22)) return;
  for (const r of fw(sim).rules.filter(sprayRule)) sim.fwDeleteRule(WEB, r.id);
  sim.fwAddRule(WEB, { dir: 'in', proto: 'any', src: IP.sprayer, dst: 'any', dport: 'any', action: 'deny' }, 0);
}

/** From the keys-only step on: fail2ban is running. */
export function ensureFail2ban(sim: Sim): void {
  if (!lx(sim).f2b.on) sim.linuxSet(WEB, 'fail2ban', true);
}
