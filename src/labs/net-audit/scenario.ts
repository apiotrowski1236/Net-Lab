import { newAudit } from '../../sim/audit';
import { NetBuilder } from '../../sim/build';
import { evaluate } from '../../sim/firewall';
import { loginText, MANAGEMENT_SERVICES, serviceOn } from '../../sim/hardening';
import type { Sim } from '../../sim/sim';
import { portUp } from '../../sim/switchsec';
import type { IpPacket } from '../../sim/types';

/**
 * Harbor Food Bank's office, 09:00 on a weekday. One flat network,
 * 192.168.50.0/24, behind an edge router with a firewall. The student is an
 * outside auditor with a signed scope letter and a laptop on the office
 * switch. A bookkeeper works from home over a VPN with split tunneling on.
 *
 * Map (1000 x 600): the office on the left with the parking lot below it, the
 * internet top right, and the bookkeeper's home bottom right.
 */

export const OFFICE_NET = '192.168.50.0/24';

export const IP = {
  router: '192.168.50.1',
  fileserver: '192.168.50.10',
  pc1: '192.168.50.21',
  pc2: '192.168.50.22',
  auditor: '192.168.50.40',
  routerWan: '198.51.100.2',
  ispOffice: '198.51.100.1',
  ispHome: '203.0.113.1',
  homeWan: '203.0.113.2',
  homeGw: '10.0.0.1',
  bookkeeper: '10.0.0.5',
  homedev: '10.0.0.6',
  vpnRouter: '10.8.0.1',
  vpnClient: '10.8.0.2',
};

/** The router's factory login, printed in its manual. */
export const ADMIN = { user: 'admin', pass: 'foodbank' };

export const SSID = 'HarborFoodBank';
/** The Wi-Fi passphrase: long enough to hold up once the encryption is strong. */
export const WIFI_PASS = 'HarborFoodBank-2019';

export const OFFICE = { x: 50, y: 30, w: 560, h: 390 };
export const LOT = { x: 50, y: 450, w: 560, h: 140 };
export const HOME = { x: 650, y: 200, w: 340, h: 390 };
/** Where the scanner listens for the beacon from (the middle of the lot). */
export const LOT_SPOT = { x: 440, y: 520, label: 'the parking lot' };

/** The office switch's desk ports (a computer on each) and its empty ports. */
export const DESK_PORTS = ['p1', 'p2', 'p3', 'p4'];
export const EMPTY_PORTS = ['p7', 'p8'];

export function buildOffice(): Sim {
  const net = new NetBuilder({ linkMs: 500, pingTimeoutMs: 20000 })
    .host('pc1', { label: 'Intake PC', sublabel: IP.pc1, icon: 'desktop', x: 130, y: 100, ip: `${IP.pc1}/24`, gateway: IP.router, services: [] })
    .host('pc2', { label: 'Manager PC', sublabel: IP.pc2, icon: 'desktop', x: 130, y: 370, ip: `${IP.pc2}/24`, gateway: IP.router, services: [] })
    .host('fileserver', {
      label: 'Donor records server',
      sublabel: IP.fileserver,
      icon: 'server',
      x: 340,
      y: 100,
      ip: `${IP.fileserver}/24`,
      gateway: IP.router,
      services: [
        { port: 22, proto: 'tcp', app: 'ssh', banner: 'Remote login for the IT volunteer' },
        { port: 80, proto: 'tcp', app: 'http', banner: 'Donor database web page (no encryption)' },
        { port: 445, proto: 'tcp', app: 'smb', banner: 'Shared folders: Donors, Grants' },
      ],
      notes: ['Holds the donor records: names, addresses, and gift history.'],
    })
    .host('auditor', {
      label: 'Audit laptop',
      sublabel: IP.auditor,
      icon: 'laptop',
      x: 130,
      y: 240,
      ip: `${IP.auditor}/24`,
      gateway: IP.router,
      notes: ['Your laptop. The scope letter lets you test the office network and the VPN today, 09:00 to 17:00.'],
    })
    .switch('sw', { label: 'Office switch', icon: 'switch', x: 340, y: 240, ports: 8, notes: ['Port 7 is the wall jack in the lobby. Nothing is plugged into it.'] })
    .switch('wap', {
      label: 'Office Wi-Fi',
      sublabel: SSID,
      icon: 'wifi',
      x: 440,
      y: 370,
      wifi: { ssid: SSID, bssid: '02:4f:0b:00:00:05', security: 'wep', passphrase: WIFI_PASS, wps: false, auth: 'psk', beacon: true, power: 1, boost: -10, channel: 6 },
    })
    .router('router', {
      label: 'Edge router',
      sublabel: 'firewall + VPN',
      x: 540,
      y: 240,
      ifaces: [
        { id: 'lan', ip: `${IP.router}/24` },
        { id: 'wan', ip: `${IP.routerWan}/30` },
        { id: 'vpn', ip: `${IP.vpnRouter}/24` },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: IP.ispOffice, iface: 'wan' }],
      services: [MANAGEMENT_SERVICES.ssh, MANAGEMENT_SERVICES.telnet],
      firewall: {
        outside: 'wan',
        mode: 'stateful',
        guardSelf: true,
        rules: [
          { dir: 'in', proto: 'icmp', src: 'any', dst: IP.routerWan, dport: 'any', action: 'allow', note: 'Answer pings from the internet (left on at install)' },
          { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow', note: 'Office and VPN traffic out' },
        ],
      },
    })
    .router('internet', {
      label: 'The Internet',
      icon: 'cloud',
      x: 780,
      y: 95,
      ifaces: [
        { id: 'office', ip: `${IP.ispOffice}/30` },
        { id: 'home', ip: `${IP.ispHome}/30` },
      ],
    })
    .router('homenet', {
      label: 'Home router',
      x: 900,
      y: 270,
      ifaces: [
        { id: 'lan', ip: `${IP.homeGw}/24` },
        { id: 'wan', ip: `${IP.homeWan}/30` },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: IP.ispHome, iface: 'wan' }],
    })
    .switch('homesw', { label: 'Home switch', icon: 'switch', x: 900, y: 400 })
    .host('bookkeeper', {
      label: 'Bookkeeper laptop',
      sublabel: 'works from home',
      icon: 'laptop',
      x: 750,
      y: 400,
      ip: `${IP.bookkeeper}/24`,
      gateway: IP.homeGw,
      notes: ['Connected to the office over the VPN, and to the home network at the same time.'],
    })
    .host('homedev', {
      label: 'Shared home laptop',
      sublabel: IP.homedev,
      icon: 'desktop',
      x: 900,
      y: 525,
      ip: `${IP.homedev}/24`,
      gateway: IP.homeGw,
      notes: ['The family shares this laptop. It may be infected.'],
    });

  // The bookkeeper's laptop has a second, virtual port: its end of the VPN tunnel.
  net.sim.dev('bookkeeper').ifaces.push({ id: 'vpn', mac: '02:b0:0c:00:00:02', ip: IP.vpnClient, prefix: 24 });

  net
    .link('pc1', 'sw')
    .link('pc2', 'sw')
    .link('fileserver', 'sw')
    .link('auditor', 'sw')
    .link('wap', ['sw', 'p5'])
    .link(['router', 'lan'], ['sw', 'p6'])
    .link(['router', 'wan'], ['internet', 'office'])
    .link(['homenet', 'wan'], ['internet', 'home'])
    .link(['homenet', 'lan'], 'homesw')
    .link('bookkeeper', 'homesw')
    .link('homedev', 'homesw')
    .link(['bookkeeper', 'vpn'], ['router', 'vpn'], { tunnel: true });

  const sim = net.build();

  // Office traffic from the bookkeeper's laptop goes through the tunnel.
  sim.dev('bookkeeper').routes.push({ prefix: OFFICE_NET, via: IP.vpnRouter, iface: 'vpn', source: 'static' });
  // Something on the shared laptop sends office-bound traffic to the bookkeeper's laptop.
  sim.dev('homedev').routes.push({ prefix: OFFICE_NET, via: IP.bookkeeper, iface: 'eth0', source: 'static' });

  sim.configureSwitch('sw');
  sim.dev('sw').hardening = { authServer: false, account: { user: 'admin', pass: 'Sw1tch-closet', factory: false }, portNames: { p7: 'lobby wall jack', p8: 'spare' } };
  sim.dev('router').hardening = { authServer: false, account: { ...ADMIN, factory: true } };
  sim.dev('router').vpn = { server: { splitTunneling: true, auth: 'password', roles: ['Bookkeeper'], iface: 'vpn' } };
  sim.dev('bookkeeper').vpn = { client: { server: 'router', iface: 'vpn', homeGateway: IP.homeGw, nat: {} } };

  const auditor = sim.dev('auditor');
  auditor.audit = newAudit({ scope: OFFICE_NET, outside: { from: 'internet', target: IP.routerWan }, listenAt: LOT_SPOT });
  auditor.captureOwn = true;

  sim.events = [];
  return sim;
}

// ---------------------------------------------------------------------------
// Moves the lesson's buttons make
// ---------------------------------------------------------------------------

/** The auditor signs in to the router over Telnet (plain text) or SSH (encrypted). */
export function routerLogin(sim: Sim, service: 'telnet' | 'ssh'): void {
  const port = MANAGEMENT_SERVICES[service].port;
  sim.connectService('auditor', IP.router, port, { data: loginText(ADMIN.user, ADMIN.pass), tag: `${service}-login` });
}

/** The shared home laptop tries to reach the donor records server. */
export function homeProbe(sim: Sim): void {
  sim.ping('homedev', IP.fileserver);
}

// ---------------------------------------------------------------------------
// State checks for goals and tests
// ---------------------------------------------------------------------------

/** A ping from the internet to the router's public address, as the outside probe sends it. */
export function edgePing(): IpPacket {
  return { src: IP.ispOffice, dst: IP.routerWan, ttl: 64, proto: 'icmp', app: { kind: 'ping', seq: 0, reply: false } };
}

/** The router's firewall drops pings from the internet. */
export function edgePingBlocked(sim: Sim): boolean {
  const fw = sim.dev('router').firewall;
  return !!fw && evaluate(fw, edgePing(), 'in').action === 'deny';
}

/** Router policy: Telnet off, SSH on, logins through the authentication server, and pings from the internet dropped. */
export function routerHardened(sim: Sim): boolean {
  const r = sim.dev('router');
  return !serviceOn(r, 'telnet') && serviceOn(r, 'ssh') && !!r.hardening?.authServer && edgePingBlocked(sim);
}

/** Port security on every desk port. */
export function deskPortsSecured(sim: Sim): boolean {
  const sw = sim.dev('sw');
  return DESK_PORTS.every((p) => !!sw.switchSec?.ports[p]?.security);
}

/** Switch policy: port security on the desk ports, the empty ports shut, and logins through the authentication server. */
export function switchHardened(sim: Sim): boolean {
  const sw = sim.dev('sw');
  return deskPortsSecured(sim) && EMPTY_PORTS.every((p) => !portUp(sw, p)) && !!sw.hardening?.authServer;
}

/** The access point uses strong encryption. */
export function wifiStrong(sim: Sim): boolean {
  const s = sim.dev('wap').wifi?.security;
  return s === 'wpa2' || s === 'wpa3';
}

/** VPN policy: no split tunneling, and keys or MFA. */
export function vpnHardened(sim: Sim): boolean {
  const v = sim.dev('router').vpn?.server;
  return !!v && !v.splitTunneling && v.auth !== 'password';
}
