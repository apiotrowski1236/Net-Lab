import type { Ip } from '../../sim/addr';
import { NetBuilder } from '../../sim/build';
import { newResolver } from '../../sim/dns';
import { scanFindings, type Scan } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { LookupRun, NetstatRun, NmapRun, PingRun, TermRun, TraceRun } from '../../sim/terminal';

/**
 * The Lakeside Public Library (see PLAN.md): a help desk laptop, two public
 * PCs, the catalog server, and a printer on one switch, behind the library
 * router (gateway, NAT, and the library's DNS server). Out on the internet:
 * the library's provider, an internet router, the e-book site, and an
 * unknown server that Public PC 2 is secretly connected to.
 *
 * Three problems are built in: the catalog's DNS record points at the wrong
 * address, the cable between the provider and the internet router is cut,
 * and Public PC 2 runs a remote-control program. The catalog server and the
 * printer also run two risky services for the nmap steps.
 */

export const IP = {
  router: '10.0.0.1',
  laptop: '10.0.0.5',
  catalog: '10.0.0.20',
  /** Where the catalog's DNS record points before the fix: nobody has it. */
  wrongCatalog: '10.0.0.21',
  pc1: '10.0.0.31',
  pc2: '10.0.0.32',
  printer: '10.0.0.40',
  public: '198.51.100.10',
  isp: '198.51.100.1',
  ispCore: '100.64.0.1',
  core: '100.64.0.2',
  coreWeb: '192.0.2.1',
  ebooks: '192.0.2.80',
  coreFar: '203.0.113.1',
  remote: '203.0.113.66',
} as const;

export const NAME = {
  catalog: 'catalog.lakeside.example',
  printer: 'printer.lakeside.example',
  router: 'router.lakeside.example',
  laptop: 'helpdesk.lakeside.example',
  pc1: 'pc1.lakeside.example',
  pc2: 'pc2.lakeside.example',
  ebooks: 'ebooks.example',
} as const;

export const CATALOG_URL = `https://${NAME.catalog}/`;
export const LIBRARY_NET = '10.0.0.0/24';
/** Who signed the permission letter. */
export const OWNER = 'the library director';
/** The remote-control program on Public PC 2, and where it connects. */
export const RAT = { program: 'update-helper.exe', port: 4444, sport: 49733 } as const;

/** The two risky services the scan finds: FTP with a known backdoor, and the printer's unencrypted Telnet login. */
export const RISKY = [
  { device: 'catalog', port: 21 },
  { device: 'printer', port: 23 },
] as const;

/** One-way times across the internet links, in real-world ms (see terminal.ts). */
const MS = { wan: 4, core: 6, web: 2, far: 38 };

export function buildLibrary(): Sim {
  const lan = { gateway: IP.router, dns: IP.router };
  const sim = new NetBuilder({ linkMs: 130, procMs: 40, l2Ms: 30, arpTimeoutMs: 1200, pingTimeoutMs: 2000, httpTimeoutMs: 8000, icmpErrors: true })
    .host('laptop', { label: 'Help desk laptop', icon: 'laptop', x: 110, y: 165, ip: `${IP.laptop}/24`, ...lan })
    .host('pc2', { label: 'Public PC 2', icon: 'desktop', x: 110, y: 335, ip: `${IP.pc2}/24`, ...lan })
    .host('pc1', { label: 'Public PC 1', icon: 'desktop', x: 110, y: 505, ip: `${IP.pc1}/24`, ...lan })
    .host('catalog', {
      label: 'Catalog server',
      icon: 'server',
      x: 330,
      y: 165,
      ip: `${IP.catalog}/24`,
      ...lan,
      web: { name: NAME.catalog, title: 'Lakeside Library catalog', https: true, page: 'Search 48,000 books, movies, and games. Type a title or an author.' },
      services: [
        { port: 21, proto: 'tcp', app: 'ftp', banner: 'vsftpd 2.3.4', program: 'vsftpd' },
        { port: 22, proto: 'tcp', app: 'ssh', banner: 'OpenSSH 9.6p1', program: 'sshd' },
        { port: 80, proto: 'tcp', app: 'http', banner: 'nginx 1.24.0', program: 'nginx' },
        { port: 443, proto: 'tcp', app: 'https', banner: 'nginx 1.24.0', program: 'nginx' },
      ],
    })
    .host('printer', {
      label: 'Printer',
      icon: 'printer',
      x: 540,
      y: 165,
      ip: `${IP.printer}/24`,
      ...lan,
      services: [
        { port: 23, proto: 'tcp', app: 'telnet', banner: 'printer telnetd', program: 'telnetd' },
        { port: 80, proto: 'tcp', app: 'http', banner: 'printer httpd 2.1', program: 'httpd' },
        { port: 631, proto: 'tcp', app: 'ipp', banner: 'CUPS 2.4', program: 'cupsd' },
      ],
    })
    .switch('sw', { label: 'Switch', icon: 'switch', x: 330, y: 335, ports: 6 })
    .router('router', {
      label: 'Library router',
      icon: 'router',
      x: 540,
      y: 400,
      ifaces: [
        { id: 'lan', ip: `${IP.router}/24` },
        { id: 'wan', ip: `${IP.public}/24` },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: IP.isp, iface: 'wan' }],
      nat: { outside: 'wan' },
      // The library's DNS server answers on port 53; its settings page on 443.
      services: [
        { port: 53, proto: 'udp', app: 'dns', banner: 'dnsmasq 2.90', program: 'dnsmasq' },
        { port: 53, proto: 'tcp', app: 'dns', banner: 'dnsmasq 2.90', program: 'dnsmasq' },
        { port: 443, proto: 'tcp', app: 'https', banner: 'lighttpd 1.4.76', program: 'lighttpd' },
      ],
    })
    .router('isp', {
      label: 'Internet provider',
      icon: 'isp',
      x: 760,
      y: 400,
      ifaces: [
        { id: 'lib', ip: `${IP.isp}/24` },
        { id: 'core', ip: `${IP.ispCore}/30` },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: IP.core, iface: 'core' }],
    })
    .router('core', {
      label: 'Internet router',
      icon: 'router',
      x: 960,
      y: 335,
      ifaces: [
        { id: 'isp', ip: `${IP.core}/30` },
        { id: 'web', ip: `${IP.coreWeb}/24` },
        { id: 'far', ip: `${IP.coreFar}/24` },
      ],
      routes: [{ prefix: '198.51.100.0/24', via: IP.ispCore, iface: 'isp' }],
    })
    .host('ebooks', {
      label: 'E-book site',
      icon: 'server',
      x: 1160,
      y: 200,
      ip: `${IP.ebooks}/24`,
      gateway: IP.coreWeb,
      web: { name: NAME.ebooks, title: 'Library e-books', https: true, page: 'Borrow e-books with your library card.' },
      services: [{ port: 443, proto: 'tcp', app: 'https', banner: 'nginx 1.25.3', program: 'nginx' }],
    })
    .host('remote', {
      label: 'Unknown server',
      icon: 'server',
      x: 1160,
      y: 470,
      ip: `${IP.remote}/24`,
      gateway: IP.coreFar,
      services: [{ port: RAT.port, proto: 'tcp', app: 'remote-control', program: 'rc-server' }],
    })
    .link('laptop', 'sw')
    .link('pc2', 'sw')
    .link('pc1', 'sw')
    .link('catalog', 'sw')
    .link('printer', 'sw')
    .link(['router', 'lan'], 'sw')
    .link(['router', 'wan'], ['isp', 'lib'], { ms: MS.wan })
    .link(['isp', 'core'], ['core', 'isp'], { ms: MS.core })
    .link(['core', 'web'], 'ebooks', { ms: MS.web })
    .link(['core', 'far'], 'remote', { ms: MS.far })
    .build();

  // The library router is the library's DNS server: it holds the library's own
  // names, and asks the provider's DNS server about everything else.
  const router = sim.dev('router');
  router.dnsZone = {
    [NAME.catalog]: IP.wrongCatalog,
    [NAME.printer]: IP.printer,
    [NAME.router]: IP.router,
    [NAME.laptop]: IP.laptop,
    [NAME.pc1]: IP.pc1,
    [NAME.pc2]: IP.pc2,
  };
  router.resolver = newResolver(IP.isp, 60_000);
  sim.dev('isp').dnsZone = { [NAME.ebooks]: IP.ebooks };

  // Open connections, for netstat: each public PC has the browser open, and
  // Public PC 2 also has the remote-control program's line to the unknown server.
  sim.dev('pc1').sockets = [{ proto: 'tcp', port: 49702, remote: IP.catalog, rport: 443, program: 'browser.exe' }];
  sim.dev('pc2').sockets = [
    { proto: 'tcp', port: 49688, remote: IP.ebooks, rport: 443, program: 'browser.exe' },
    { proto: 'tcp', port: RAT.sport, remote: IP.remote, rport: RAT.port, program: RAT.program },
    { proto: 'tcp', port: 49712, remote: IP.catalog, rport: 443, program: 'browser.exe' },
  ];

  // The network has been running a while: switches and ARP tables are full,
  // so the first ping isn't slowed by lookups the lesson isn't about.
  sim.quiet = true;
  sim.prelearnSwitch('sw');
  for (const id of ['laptop', 'pc1', 'pc2', 'catalog', 'printer']) sim.ping(id, IP.router);
  sim.ping('router', IP.isp);
  sim.ping('isp', IP.core);
  sim.ping('ebooks', IP.coreWeb);
  sim.ping('remote', IP.coreFar);
  sim.runUntilIdle();
  // Ticket 2: the cable between the provider and the internet router is cut.
  sim.disconnect('isp', 'core');
  sim.quiet = false;
  sim.events = [];
  return sim;
}

// ---------------------------------------------------------------------------
// Reading the network
// ---------------------------------------------------------------------------

export const catalogRecord = (sim: Sim): Ip | undefined => sim.dev('router').dnsZone?.[NAME.catalog];
export const dnsFixed = (sim: Sim) => catalogRecord(sim) === IP.catalog;
export const internetFixed = (sim: Sim) => !!sim.dev('isp').ifaces.find((i) => i.id === 'core')?.linkId;
export const pc2Plugged = (sim: Sim) => !!sim.dev('pc2').ifaces[0].linkId;
export const serviceOn = (sim: Sim, device: string, port: number) => !!sim.dev(device).services?.some((s) => s.port === port);
export const riskyClosed = (sim: Sim) => RISKY.every((r) => !serviceOn(sim, r.device, r.port));

/** Finished terminal runs on `device` since `since`. */
export function runsSince(sim: Sim, device: string, since: number): TermRun[] {
  return (sim.dev(device).term ?? []).filter((r) => r.t >= since && r.doneAt !== undefined);
}

const kind =
  <K extends TermRun['kind']>(k: K) =>
  (r: TermRun): r is Extract<TermRun, { kind: K }> =>
    r.kind === k;

export const pings = (sim: Sim, device: string, since: number): PingRun[] => runsSince(sim, device, since).filter(kind('ping'));
export const traces = (sim: Sim, device: string, since: number): TraceRun[] => runsSince(sim, device, since).filter(kind('traceroute'));
export const lookups = (sim: Sim, device: string, since: number): LookupRun[] => runsSince(sim, device, since).filter(kind('nslookup'));
export const netstats = (sim: Sim, device: string, since: number): NetstatRun[] => runsSince(sim, device, since).filter(kind('netstat'));
export const nmaps = (sim: Sim, device: string, since: number): NmapRun[] => runsSince(sim, device, since).filter(kind('nmap'));

/** A ping that got at least one reply from `ip`. */
export const pingAnswered = (r: PingRun, ip: Ip) => r.ip === ip && r.probes.some((p) => p.status === 'reply' && p.from === ip);

export function nmapScan(sim: Sim, r: NmapRun): Scan | undefined {
  return sim.dev('laptop').scans?.find((s) => s.id === r.scan);
}

/** The ports a finished nmap run found open on `ip`. */
export function openPorts(sim: Sim, r: NmapRun, ip: Ip): number[] {
  const scan = nmapScan(sim, r);
  return scan ? (scanFindings(scan).find((h) => h.ip === ip)?.open ?? []) : [];
}

/** A finished nmap run that covered the whole library network. */
export const wholeNetwork = (r: NmapRun) => r.target === LIBRARY_NET;

// ---------------------------------------------------------------------------
// What the lesson buttons do (each one is recorded and replayed)
// ---------------------------------------------------------------------------

/** The IT contractor corrects the catalog's DNS record. */
export function fixDns(sim: Sim): void {
  const zone = sim.dev('router').dnsZone!;
  zone[NAME.catalog] = IP.catalog;
}

export function openCatalog(sim: Sim): void {
  sim.browse('pc1', CATALOG_URL);
}

/** The provider replaces the cut cable. */
export function fixInternet(sim: Sim): void {
  if (internetFixed(sim)) return;
  const id = sim.connect({ device: 'isp', iface: 'core' }, { device: 'core', iface: 'isp' });
  sim.links[id].ms = MS.core;
}

/** The remote-control program on Public PC 2 talks to its server. */
export function watchPc2(sim: Sim): void {
  sim.connectService('pc2', IP.remote, RAT.port, { app: 'remote-control', sport: RAT.sport });
}

export function unplugPc2(sim: Sim): void {
  sim.disconnect('pc2', 'eth0');
}

/** The IT contractor turns off FTP on the catalog server and Telnet on the printer. */
export function closeRisky(sim: Sim): void {
  for (const r of RISKY) {
    const d = sim.dev(r.device);
    d.services = (d.services ?? []).filter((s) => s.port !== r.port);
  }
}

/**
 * Before the scans: everything from the first tickets is done, whatever the
 * student skipped (the earlier fixes stay as they are when already made).
 */
export function ensureTicketsDone(sim: Sim): void {
  ensureRepairs(sim);
  if (pc2Plugged(sim)) unplugPc2(sim);
}

/** Before ticket 3: the catalog record and the internet cable are fixed (Public PC 2's remote control talks across that cable). */
export function ensureRepairs(sim: Sim): void {
  if (!dnsFixed(sim)) fixDns(sim);
  fixInternet(sim);
}
