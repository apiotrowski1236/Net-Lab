import type { Ip } from '../../sim/addr';
import { NetBuilder } from '../../sim/build';
import { capturedAfter } from '../../sim/capture';
import { protocolsOf } from '../../sim/displayFilter';
import type { Sim } from '../../sim/sim';
import type { Conn } from '../../sim/services';
import type { Captured, Frame, SimEvent } from '../../sim/types';

/**
 * The Nguyens' home from lab 1, already set up (see PLAN.md): the Wi-Fi
 * router (a router plus a switch with an access point, one box), the laptop,
 * phone, and TV on the Wi-Fi, and the internet provider with five servers out
 * on the internet. The laptop runs the packet capture.
 */

export const SSID = 'Nguyen Home';
export const PASSWORD = 'sunflower-kitchen-42';

export const IP = {
  router: '192.168.1.1',
  laptop: '192.168.1.10',
  phone: '192.168.1.11',
  tv: '192.168.1.12',
  public: '203.0.113.25',
  isp: '203.0.113.1',
  dns: '192.0.2.53',
  school: '192.0.2.80',
  weather: '192.0.2.140',
  video: '198.51.100.20',
  chat: '198.51.100.140',
} as const;

export const NAME = {
  school: 'school.example',
  weather: 'weather.example',
  video: 'video.example',
  chat: 'chat.example',
} as const;

export const SCHOOL_URL = `http://${NAME.school}/homework`;
export const VIDEO_URL = `https://${NAME.video}/`;
export const HOMEWORK = { title: 'Homework: week 6', page: 'Read pages 40 to 45. Answer questions 1 to 6.' };
export const WEATHER = { title: 'Weather today', page: 'Today: sunny, high of 72°F.' };

/** The servers out on the internet. */
export const SERVERS = ['dns', 'school', 'weather', 'video', 'chat'] as const;

/** The home devices on the Wi-Fi, in the order they join (so they get .10, .11, .12). */
export const FAMILY = ['laptop', 'phone', 'tv'] as const;

export const MAC = {
  laptop: '02:00:00:00:00:21',
  phone: '02:00:00:00:00:22',
  tv: '02:00:00:00:00:23',
  routerHome: '02:00:00:00:00:01',
  routerInternet: '02:00:00:00:00:02',
  bssid: '02:00:00:00:00:0a',
} as const;

export const POS = {
  wifi: { x: 330, y: 290 },
  router: { x: 545, y: 290 },
} as const;

export function buildCapture(): Sim {
  // A fresh object each time: devices must not share Wi-Fi state.
  const home = () => ({ dhcp: true, dns: IP.dns, wifiClient: { ssid: '' } });
  const sim = new NetBuilder({ linkMs: 400, procMs: 100, l2Ms: 50, httpTimeoutMs: 15000, arpTimeoutMs: 4000, pingTimeoutMs: 12000 })
    // The laptop first: it's the Ping tool's first choice.
    .host('laptop', { label: 'Laptop', icon: 'laptop', x: 420, y: 110, mac: MAC.laptop, ...home() })
    .host('phone', { label: 'Phone', icon: 'phone', x: 495, y: 445, mac: MAC.phone, ...home() })
    .host('tv', { label: 'Smart TV', icon: 'tv', x: 210, y: 130, mac: MAC.tv, ...home() })
    .switch('wifi', {
      label: 'Switch and Wi-Fi',
      icon: 'wifi',
      ...POS.wifi,
      named: ['inside'],
      ports: 4,
      wifi: { ssid: SSID, bssid: MAC.bssid, security: 'wpa3', passphrase: PASSWORD, wps: false, auth: 'psk', beacon: true, power: 1, channel: 6 },
    })
    .router('router', {
      label: 'Router',
      icon: 'router',
      ...POS.router,
      ifaces: [
        { id: 'home', ip: `${IP.router}/24`, mac: MAC.routerHome },
        { id: 'internet', ip: `${IP.public}/24`, mac: MAC.routerInternet },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: IP.isp, iface: 'internet' }],
      dhcp: { iface: 'home', from: '192.168.1.10', to: '192.168.1.99' },
      nat: { outside: 'internet' },
    })
    .router('isp', {
      label: 'Internet provider',
      icon: 'isp',
      x: 815,
      y: 290,
      ifaces: [
        { id: 'customer', ip: `${IP.isp}/24` },
        { id: 'p1', ip: '192.0.2.1/26' },
        { id: 'p2', ip: '192.0.2.65/26' },
        { id: 'p3', ip: '192.0.2.129/26' },
        { id: 'p4', ip: '198.51.100.1/25' },
        { id: 'p5', ip: '198.51.100.129/25' },
      ],
    })
    .host('dns', {
      label: 'Name server',
      icon: 'server',
      x: 965,
      y: 110,
      ip: `${IP.dns}/26`,
      gateway: '192.0.2.1',
      dnsZone: { [NAME.school]: IP.school, [NAME.weather]: IP.weather, [NAME.video]: IP.video, [NAME.chat]: IP.chat },
    })
    .host('school', {
      label: 'School website',
      icon: 'server',
      x: 965,
      y: 290,
      ip: `${IP.school}/26`,
      gateway: '192.0.2.65',
      web: { name: NAME.school, title: 'Lincoln High School', https: false, page: 'Homework is posted for this week.', pages: { '/homework': HOMEWORK } },
    })
    .host('weather', {
      label: 'Weather service',
      icon: 'server',
      x: 965,
      y: 450,
      ip: `${IP.weather}/26`,
      gateway: '192.0.2.129',
      web: { name: NAME.weather, title: 'Weather', https: false, page: 'Pick a city.', pages: { '/today': WEATHER } },
    })
    .host('video', {
      label: 'Video site',
      icon: 'server',
      x: 1120,
      y: 200,
      ip: `${IP.video}/25`,
      gateway: '198.51.100.1',
      web: { name: NAME.video, title: 'Video site', https: true, page: 'Pick a video.' },
      services: [{ port: 443, proto: 'tcp', app: 'https' }],
    })
    .host('chat', {
      label: 'Chat service',
      icon: 'server',
      x: 1120,
      y: 380,
      ip: `${IP.chat}/25`,
      gateway: '198.51.100.129',
      web: { name: NAME.chat, title: 'Chat', https: true, page: 'No new messages.' },
    })
    // The router and the switch are one box: their cable is built in.
    .link(['router', 'home'], ['wifi', 'inside'], { fixed: true })
    .link(['router', 'internet'], ['isp', 'customer'], { fixed: true })
    .link(['isp', 'p1'], 'dns', { fixed: true })
    .link(['isp', 'p2'], 'school', { fixed: true })
    .link(['isp', 'p3'], 'weather', { fixed: true })
    .link(['isp', 'p4'], 'video', { fixed: true })
    .link(['isp', 'p5'], 'chat', { fixed: true })
    .build();
  // Lab 1 set all this up. The family joins in order, so the addresses come out .10, .11, .12.
  sim.quiet = true;
  for (const id of FAMILY) sim.setWifiClient(id, SSID, PASSWORD);
  sim.quiet = false;
  // The switch has been running a while: it knows where every device is, so it floods nothing.
  sim.prelearnSwitch('wifi');
  // Out on the internet, the routers and servers already know each other's MAC
  // addresses, so a page loads without lookups the laptop can't see. Only the
  // home devices start fresh: their ARP requests are part of the lesson.
  sim.ping('router', IP.isp);
  for (const id of SERVERS) sim.ping(id, sim.dev(id).gateway!);
  sim.runUntilIdle();
  // Wireshark isn't running until the student presses Start.
  const laptop = sim.dev('laptop');
  laptop.sniffing = false;
  laptop.captureOwn = true;
  sim.events = [];
  return sim;
}

// ---------------------------------------------------------------------------
// Reading the network
// ---------------------------------------------------------------------------

export const ipOf = (sim: Sim, id: string): Ip | undefined => sim.dev(id).ifaces[0]?.ip;
export const joined = (sim: Sim, id: string) => sim.dev(id).wifiClient?.joinedAp === 'wifi';

/** The laptop's capture run, if Start was ever pressed. */
export const run = (sim: Sim) => sim.dev('laptop').captureRun;
export const capturing = (sim: Sim) => sim.dev('laptop').sniffing;
/** The laptop's capture list. */
export const captured = (sim: Sim): Captured[] => sim.dev('laptop').capture;

/** A capture started at or after `since`. */
export const startedSince = (sim: Sim, since: number) => (run(sim)?.start ?? -1) >= since;

/** Wireshark's protocol names for a frame include `proto` ("dns", "tls", "icmp"...). */
export const is = (proto: string) => (f: Frame) => protocolsOf(f).includes(proto);

const fromTo = (f: Frame, ip: Ip) => f.ip?.src === ip || f.ip?.dst === ip;

export const isHomeworkGet = (f: Frame) => f.ip?.app.kind === 'http-req' && !f.ip.encrypted && f.ip.app.path === '/homework';
export const isHomeworkPage = (f: Frame) => f.ip?.app.kind === 'http-res' && !f.ip.encrypted && f.ip.src === IP.school && f.ip.app.title === HOMEWORK.title;
export const isWeatherPage = (f: Frame) => f.ip?.app.kind === 'http-res' && !f.ip.encrypted && f.ip.src === IP.weather;
export const isVideoTls = (f: Frame) => !!f.ip?.encrypted && f.ip.app.kind === 'http-res' && f.ip.src === IP.video;
export const isRouterArpReply = (f: Frame) => f.arp?.op === 'reply' && f.arp.senderIp === IP.router;
export const isSchoolDnsAnswer = (f: Frame) => f.ip?.app.kind === 'dns-answer' && f.ip.app.name === NAME.school;
export const isPhoneDhcp = (f: Frame) => f.dhcp?.client === MAC.phone;
export const isRouterPingReply = (f: Frame) => f.ip?.app.kind === 'ping' && f.ip.app.reply && f.ip.src === IP.router;
export const isTvArp = (f: Frame) => f.arp?.op === 'request' && f.arp.senderIp === IP.tv;
export const isChat = (f: Frame) => fromTo(f, IP.chat);

/** The newest event since `since` that matches, if any. */
export function lastSince<T extends SimEvent['type']>(sim: Sim, since: number, type: T, pred: (e: Extract<SimEvent, { type: T }>) => boolean = () => true) {
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t >= since; i--) {
    const e = sim.events[i];
    if (e.type === type && pred(e as Extract<SimEvent, { type: T }>)) return e as Extract<SimEvent, { type: T }>;
  }
  return undefined;
}

/** The TV's newest "show" connection since `since`. */
export function showSince(sim: Sim, since: number): Conn | undefined {
  return [...(sim.dev('tv').conns ?? [])].reverse().find((c) => c.t >= since && c.tag === 'show');
}

/** The laptop's capture was running the whole time from `from` to `to`. */
export function capturedThrough(sim: Sim, from: number, to: number): boolean {
  const r = run(sim);
  return !!r && r.start <= from && (r.stoppedAt === undefined || r.stoppedAt >= to);
}

// ---------------------------------------------------------------------------
// Background apps: packets nobody asked for by hand
// ---------------------------------------------------------------------------

/**
 * Apps pick their own ports and message numbers. These start far from the
 * ones the browser uses (49152 up), so the two never collide.
 */
const counters = new WeakMap<Sim, { port: number; id: number }>();
function next(sim: Sim) {
  let c = counters.get(sim);
  if (!c) counters.set(sim, (c = { port: 61000, id: 900000 }));
  return { port: c.port++, id: c.id++ };
}

/** An app on `dev` looks up a name. Nobody uses the answer except to show it. */
function lookup(sim: Sim, dev: string, name: string): void {
  const src = ipOf(sim, dev);
  if (!src) return;
  const n = next(sim);
  sim.sendPacket(dev, { src, dst: IP.dns, proto: 'udp', srcPort: n.port, dstPort: 53, app: { kind: 'dns-query', name, qid: n.id } });
}

/** An app on `dev` fetches `path` from a web server: HTTPS (encrypted) or plain HTTP. */
function fetch(sim: Sim, dev: string, to: Ip, host: string, path: string, secure: boolean): void {
  const src = ipOf(sim, dev);
  if (!src) return;
  const n = next(sim);
  sim.sendPacket(dev, {
    src,
    dst: to,
    proto: 'tcp',
    srcPort: n.port,
    dstPort: secure ? 443 : 80,
    encrypted: secure || undefined,
    app: { kind: 'http-req', method: 'GET', host, path, reqId: n.id },
  });
}

/** How the busy minute's chat and video traffic is spaced (ms). */
const GAP = 400;
/** The chat app checks for messages this many times; the video app loads this many pieces. */
export const CHAT_CHECKS = 8;
export const VIDEO_PIECES = 6;

/**
 * A minute on the family laptop with nobody touching it, squeezed into about
 * 15 seconds: it has forgotten the router's MAC address, so it asks again
 * (ARP); its apps look up four names (DNS); the chat app checks for messages
 * and the video app loads the next video (HTTPS); the weather app gets today's
 * weather and the school page refreshes (HTTP). Meanwhile the TV and phone
 * each ask for the router's MAC address (ARP, sent to everyone).
 */
export function busyMinute(sim: Sim): void {
  sim.clearArp('laptop');
  const at = (ms: number, fn: () => void) => sim.schedule(ms, fn);
  at(0, () => lookup(sim, 'laptop', NAME.chat));
  at(300, () => lookup(sim, 'laptop', NAME.weather));
  at(600, () => lookup(sim, 'laptop', NAME.video));
  at(900, () => lookup(sim, 'laptop', NAME.school));
  at(2500, () => {
    sim.clearArp('tv');
    lookup(sim, 'tv', NAME.video);
  });
  at(4000, () => {
    sim.clearArp('phone');
    lookup(sim, 'phone', NAME.chat);
  });
  // The answers are back by about 6 seconds. Then the apps talk to their servers.
  const t0 = 6200;
  at(t0 + GAP, () => fetch(sim, 'laptop', IP.weather, NAME.weather, '/today', false));
  at(t0 + 3 * GAP, () => fetch(sim, 'laptop', IP.school, NAME.school, '/homework', false));
  for (let i = 0; i < CHAT_CHECKS; i++) at(t0 + 2 * i * GAP, () => fetch(sim, 'laptop', IP.chat, NAME.chat, '/messages', true));
  for (let i = 0; i < VIDEO_PIECES; i++) at(t0 + (2 * i + 1) * GAP + 200, () => fetch(sim, 'laptop', IP.video, NAME.video, `/next/${i + 1}`, true));
}

// ---------------------------------------------------------------------------
// What the lesson buttons do
// ---------------------------------------------------------------------------

/** The laptop opens the school's homework page. It forgets the router's MAC first, so each load shows ARP, DNS, and HTTP. */
export function openSchool(sim: Sim): void {
  sim.clearArp('laptop');
  sim.browse('laptop', SCHOOL_URL);
}

/** The laptop opens the video site over HTTPS. */
export function openVideo(sim: Sim): void {
  sim.clearArp('laptop');
  sim.browse('laptop', VIDEO_URL);
}

/** The phone leaves the Wi-Fi (dropping its address) and joins again 2 seconds later. */
export function phoneRejoins(sim: Sim): void {
  sim.setWifiClient('phone', '');
  sim.schedule(2000, () => sim.setWifiClient('phone', SSID, PASSWORD));
}

/** How many pieces of the show the TV loads. */
export const SHOW_PIECES = 3;

/**
 * The TV plays a show: it asks for the router's MAC (ARP, to everyone), looks
 * up the video site (DNS), then loads the show in pieces (HTTPS). Only the ARP
 * request reaches the laptop: the switch sends the rest to the TV alone.
 */
export function tvShow(sim: Sim): void {
  sim.clearArp('tv');
  lookup(sim, 'tv', NAME.video);
  for (let i = 0; i < SHOW_PIECES; i++) {
    sim.schedule(6200 + i * 500, () => {
      if (ipOf(sim, 'tv')) sim.connectService('tv', IP.video, 443, { app: 'https', tag: 'show' });
    });
  }
}

// ---------------------------------------------------------------------------
// Setups: put the capture where a step needs it, keeping what the student did
// ---------------------------------------------------------------------------

/** Everyone on the Wi-Fi with an address (the phone may have left in step 5). */
export function ensureFamily(sim: Sim): void {
  for (const id of FAMILY) if (!joined(sim, id) || !ipOf(sim, id)) sim.setWifiClient(id, SSID, PASSWORD);
}

/** Stop the capture so "Press Start" is the right first move. The old list stays to read. */
export function readyToStart(sim: Sim): void {
  ensureFamily(sim);
  sim.stopCapture('laptop');
}

/** A finished capture of one homework page load (steps 3 and 4). Keeps the student's own capture if it has one. */
export function ensurePageCapture(sim: Sim): void {
  ensureFamily(sim);
  const cap = captured(sim);
  if (cap.some((c) => isHomeworkGet(c.frame)) && cap.some((c) => isHomeworkPage(c.frame))) return;
  sim.startCapture('laptop');
  openSchool(sim);
  sim.runUntilIdle();
  sim.stopCapture('laptop');
}

/** A finished capture of the busy minute (steps 8 and 9). Keeps the student's own capture if it has one. */
export function ensureBusyCapture(sim: Sim): void {
  ensureFamily(sim);
  const cap = captured(sim);
  if (cap.some((c) => isWeatherPage(c.frame)) && cap.some((c) => isChat(c.frame))) return;
  sim.startCapture('laptop');
  busyMinute(sim);
  sim.runUntilIdle();
  sim.stopCapture('laptop');
}

/** How many packets the laptop captured since `since`. */
export const countSince = (sim: Sim, since: number) => capturedAfter(sim.dev('laptop'), since).length;
