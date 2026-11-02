import type { Ip } from '../../sim/addr';
import { NetBuilder } from '../../sim/build';
import type { Sim } from '../../sim/sim';
import type { Conn } from '../../sim/services';
import type { SimEvent } from '../../sim/types';

/**
 * The Nguyens' home (see SCRIPT.md): a Wi-Fi router (a router plus a switch
 * with an access point, joined by a built-in cable), five home devices, the
 * neighbor's laptop next door, and the internet provider with three computers
 * out on the internet.
 */

export const FACTORY_SSID = 'HomeRouter-4F2A';
/** What a setup uses when a student skipped ahead without setting up the Wi-Fi. */
export const DEFAULT_SSID = 'Nguyen Home';
export const DEFAULT_PASSWORD = 'sunflower-kitchen-42';

export const IP = {
  router: '192.168.1.1',
  public: '203.0.113.25',
  isp: '203.0.113.1',
  video: '198.51.100.20',
  school: '192.0.2.30',
  stranger: '198.51.100.200',
};
export const POOL = { from: '192.168.1.10', to: '192.168.1.99' };

/** Devices that join the Wi-Fi, and devices that plug in with a cable. */
export const FAMILY = ['laptop', 'phone', 'tv'] as const;
export const WIRED = ['console', 'printer'] as const;

/** Common passwords the neighbor guesses, in order. */
export const NEIGHBOR_GUESSES = ['12345678', 'password', 'password1', 'qwerty123', 'nguyen123', 'nguyenhome'];

export const VIDEO_HOST = 'video.example';
export const PAGES = {
  cats: { path: '/cats', title: 'Funny cats, part 3' },
  fractions: { path: '/fractions', title: 'Fractions, explained' },
};
export const PRINT_PORT = 631;
/** The stranger knocks on a remote-desktop port: the kind of door attackers try. */
export const STRANGER_PORT = 3389;

/** MAC addresses easy to read and tell apart (the lesson shows 02:00:00:00:00:21 as an example: the laptop's). */
const MAC = {
  laptop: '02:00:00:00:00:21',
  phone: '02:00:00:00:00:22',
  tv: '02:00:00:00:00:23',
  console: '02:00:00:00:00:24',
  printer: '02:00:00:00:00:25',
  neighbor: '02:00:00:00:00:31',
  routerHome: '02:00:00:00:00:01',
  routerInternet: '02:00:00:00:00:02',
  bssid: '02:00:00:00:00:0a',
};

/** Where the access point sits, for the Wi-Fi reach circle. */
export const WIFI_POS = { x: 330, y: 290 };

export function buildHome(): Sim {
  const sim = new NetBuilder({ linkMs: 500, procMs: 100, l2Ms: 50, httpTimeoutMs: 15000, arpTimeoutMs: 4000, pingTimeoutMs: 12000 })
    .router('router', {
      label: 'Router',
      icon: 'router',
      x: 545,
      y: 290,
      ifaces: [
        { id: 'home', ip: `${IP.router}/24`, mac: MAC.routerHome },
        { id: 'internet', ip: `${IP.public}/24`, mac: MAC.routerInternet },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: IP.isp, iface: 'internet' }],
      dhcp: { iface: 'home', ...POOL },
      nat: { outside: 'internet' },
    })
    .switch('wifi', {
      label: 'Switch and Wi-Fi',
      icon: 'wifi',
      ...WIFI_POS,
      named: ['inside'],
      ports: 4,
      // Power 1 (the lowest) still reaches next door. Off until the student sets it up.
      wifi: { ssid: FACTORY_SSID, bssid: MAC.bssid, security: 'wpa2', wps: false, auth: 'psk', beacon: true, power: 1, channel: 6, off: true },
    })
    .host('laptop', { label: 'Laptop', icon: 'laptop', x: 420, y: 110, mac: MAC.laptop, dhcp: true, wifiClient: { ssid: '' } })
    .host('phone', { label: 'Phone', icon: 'phone', x: 495, y: 445, mac: MAC.phone, dhcp: true, wifiClient: { ssid: '' } })
    .host('tv', { label: 'Smart TV', icon: 'tv', x: 230, y: 115, mac: MAC.tv, dhcp: true, wifiClient: { ssid: '' } })
    .host('console', { label: 'Game console', icon: 'console', x: 240, y: 440, mac: MAC.console, dhcp: true })
    .host('printer', {
      label: 'Printer',
      icon: 'printer',
      x: 375,
      y: 440,
      mac: MAC.printer,
      dhcp: true,
      services: [{ port: PRINT_PORT, proto: 'tcp', app: 'ipp', banner: 'Printer ready' }],
    })
    .host('neighbor', { label: "Neighbor's laptop", icon: 'laptop', x: 90, y: 300, mac: MAC.neighbor, dhcp: true, wifiClient: { ssid: '', outsider: true } })
    .router('isp', {
      label: 'Internet provider',
      icon: 'isp',
      x: 815,
      y: 290,
      ifaces: [
        { id: 'customer', ip: `${IP.isp}/24` },
        { id: 'p1', ip: '198.51.100.1/25' },
        { id: 'p2', ip: '192.0.2.1/24' },
        { id: 'p3', ip: '198.51.100.129/25' },
      ],
    })
    .host('video', {
      label: 'Video site',
      icon: 'server',
      x: 960,
      y: 130,
      ip: `${IP.video}/25`,
      gateway: '198.51.100.1',
      web: {
        name: VIDEO_HOST,
        title: 'Video site',
        https: false,
        page: 'Pick a video.',
        pages: {
          [PAGES.cats.path]: { title: PAGES.cats.title, page: 'A cat knocks a cup off the table. Then another.' },
          [PAGES.fractions.path]: { title: PAGES.fractions.title, page: 'Half of a half is a quarter. Here is why.' },
        },
      },
    })
    .host('school', {
      label: 'School website',
      icon: 'server',
      x: 960,
      y: 290,
      ip: `${IP.school}/24`,
      gateway: '192.0.2.1',
      web: { name: 'school.example', title: 'Lincoln High School', https: false, page: 'Homework is posted for this week.' },
    })
    .host('stranger', { label: 'Stranger', icon: 'desktop', x: 960, y: 450, ip: `${IP.stranger}/25`, gateway: '198.51.100.129' })
    // The router and the switch are one box: their cable is built in.
    .link(['router', 'home'], ['wifi', 'inside'], { fixed: true })
    // The internet is already wired: students only plug in the home's own cable.
    .link(['isp', 'p1'], 'video', { fixed: true })
    .link(['isp', 'p2'], 'school', { fixed: true })
    .link(['isp', 'p3'], 'stranger', { fixed: true })
    .hostsFile({ [VIDEO_HOST]: IP.video, 'school.example': IP.school })
    .build();
  // The Capture tab shows what the laptop sends and receives, as Wireshark would on it.
  const laptop = sim.dev('laptop');
  laptop.sniffing = true;
  laptop.captureOwn = true;
  sim.events = [];
  return sim;
}

// ---------------------------------------------------------------------------
// Reading the network
// ---------------------------------------------------------------------------

export const wiredIn = (sim: Sim, id: string) => !!sim.linkBetween(id, 'wifi');
export const uplinked = (sim: Sim) => !!sim.linkBetween('router', 'isp');
export const joined = (sim: Sim, id: string) => sim.dev(id).wifiClient?.joinedAp === 'wifi';
export const ipOf = (sim: Sim, id: string): Ip | undefined => sim.dev(id).ifaces[0]?.ip;

/** The access point's settings. */
export const ap = (sim: Sim) => sim.dev('wifi').wifi!;

/** Wi-Fi on, with WPA2 or WPA3 and a password. */
export function secured(sim: Sim): boolean {
  const w = ap(sim);
  return !w.off && (w.security === 'wpa2' || w.security === 'wpa3') && !!w.passphrase;
}

/** The newest event since `since` that matches, if any. */
export function lastSince<T extends SimEvent['type']>(sim: Sim, since: number, type: T, pred: (e: Extract<SimEvent, { type: T }>) => boolean = () => true) {
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t >= since; i--) {
    const e = sim.events[i];
    if (e.type === type && pred(e as Extract<SimEvent, { type: T }>)) return e as Extract<SimEvent, { type: T }>;
  }
  return undefined;
}

/** The newest connection `devId` started since `since` with this tag. */
export function connSince(sim: Sim, devId: string, since: number, tag: string): Conn | undefined {
  return [...(sim.dev(devId).conns ?? [])].reverse().find((c) => c.t >= since && c.tag === tag);
}

/** Both browsers loaded their own video since `since` (step 8). */
export function bothLoaded(sim: Sim, since: number): boolean {
  const ok = (id: string, title: string) => {
    const b = sim.dev(id).browser;
    return !!b && b.startedAt >= since && b.status === 'loaded' && b.title === title;
  };
  return ok('phone', PAGES.cats.title) && ok('laptop', PAGES.fractions.title);
}

// ---------------------------------------------------------------------------
// What the lesson buttons do
// ---------------------------------------------------------------------------

/** The family types the current name and password on the laptop, phone, and TV. */
export function familyJoins(sim: Sim): void {
  const w = ap(sim);
  for (const id of FAMILY) sim.setWifiClient(id, w.ssid, w.passphrase);
}

/** The neighbor tries common passwords on the family's network, one after another, until one works. */
export function neighborTries(sim: Sim): void {
  const w = ap(sim);
  for (const guess of NEIGHBOR_GUESSES) {
    sim.setWifiClient('neighbor', w.ssid, guess);
    if (joined(sim, 'neighbor')) return;
    // Give up on this guess, so the next one counts as a fresh try.
    sim.setWifiClient('neighbor', '');
  }
}

/** The TV leaves the Wi-Fi (dropping its address) and joins again 2 seconds later. */
export function tvRestarts(sim: Sim): void {
  sim.setWifiClient('tv', '');
  sim.schedule(2000, () => {
    const w = ap(sim);
    sim.setWifiClient('tv', w.ssid, w.passphrase);
  });
}

/** `from` sends a file to the printer's print service. */
export function print(sim: Sim, from: string, file: string, tag: string): void {
  const to = ipOf(sim, 'printer');
  if (to) sim.connectService(from, to, PRINT_PORT, { app: 'ipp', data: file, tag });
}

export const videoUrl = (page: { path: string }) => `http://${VIDEO_HOST}${page.path}`;

// ---------------------------------------------------------------------------
// Setups: put the network where a step needs it, keeping what the student did
// ---------------------------------------------------------------------------

/** The game console and printer in home ports, and the router's internet port in the provider. */
export function ensureCables(sim: Sim): void {
  for (const id of WIRED) if (!wiredIn(sim, id)) sim.connect({ device: id }, { device: 'wifi' });
  if (!uplinked(sim)) sim.connect({ device: 'router', iface: 'internet' }, { device: 'isp', iface: 'customer' });
}

/** The Wi-Fi on and locked (the student's own name and password if they set them), the family on it, the neighbor off it. */
export function ensureWifi(sim: Sim): void {
  const w = ap(sim);
  if (w.ssid === FACTORY_SSID) sim.setWifiSsid('wifi', DEFAULT_SSID);
  if (w.security !== 'wpa2' && w.security !== 'wpa3') sim.setWifiSecurity('wifi', 'wpa3');
  if (!w.passphrase) sim.setWifiPassphrase('wifi', DEFAULT_PASSWORD);
  if (w.off) sim.setWifiOff('wifi', false);
  for (const id of FAMILY) if (!joined(sim, id)) sim.setWifiClient(id, w.ssid, w.passphrase);
  if (joined(sim, 'neighbor')) sim.setWifiClient('neighbor', '');
}

/** Everything plugged in and joined (steps 4 to 9). */
export function ready(sim: Sim): void {
  ensureCables(sim);
  ensureWifi(sim);
}
