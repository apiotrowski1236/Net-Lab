import { NetBuilder } from '../../sim/build';
import type { Sim } from '../../sim/sim';
import type { WifiProfile } from '../../sim/wifi';
import type { AirRecord, ApprovedAp } from '../../sim/wids';

/**
 * The Ridgeview High gym shelter from Signals Past the Walls, two weeks
 * later. The Wi-Fi is locked down (WPA3, a login per person checked by the
 * shelter's sign-in server, beacons off, power lowered). The technician now
 * keeps watch: the access point runs a small wireless watch (src/sim/wids.ts)
 * with the list of approved access points, and the wiring closet switch logs
 * its ports.
 *
 * The map is a 1000 x 600 canvas. The gym is the big room; the office access
 * point, the wiring closet, and the satellite uplink sit along the top.
 */

export const SSID = 'Shelter-WiFi';
export const LOOKALIKE = 'Shelter_WiFi';
export const ROGUE_SSID = 'Setup-4F2A';
/** The sign-in server's name, on its certificate. Saved in every staff device's profile. */
export const SERVER = 'radius.shelter';

export const BSSID = {
  wap: '02:ca:fe:5e:11:01',
  wap2: '02:ca:fe:5e:11:02',
  rogue: '02:17:0e:00:00:07',
  twin: '02:ba:d0:00:00:08',
};

export const MAC = {
  desk: '0a:de:5c:00:00:01',
  phone1: '0a:21:fa:00:00:11',
  laptop1: '0a:ce:4e:00:00:12',
  visitor: '0a:0c:af:00:00:31',
  /** A volunteer's new laptop, plugged in on day 5 (harmless). */
  volunteer: '0a:70:1e:00:00:41',
};

export const IP = {
  gw: '192.168.50.1',
  desk: '192.168.50.5',
  phone1: '192.168.50.21',
  laptop1: '192.168.50.22',
  visitor: '192.168.50.31',
};

/** What every staff device has saved for the shelter network. */
export const STAFF_PROFILE: WifiProfile = { security: 'wpa3', auth: 'eap', server: SERVER };

/** Shelter logins. The lookalike radio's own sign-in server says yes to any of them. */
const USERS = ['desk', 'rivera', 'chen', 'okafor'];

/** Devices with the saved profile: they never join a copy of the network. */
export const STAFF = ['desk', 'phone1', 'laptop1'] as const;

/** The gym, in map coordinates. */
export const GYM = { x: 60, y: 170, w: 600, h: 390 };

/** Where the lookalike radio is hidden (behind the stacked bleachers). */
export const TWIN_POS = { x: 600, y: 410 };

/** Three spots to take a signal reading from (for triangulation). */
export const SPOTS = [
  { label: 'the north wall', x: 100, y: 200 },
  { label: 'the south wall', x: 100, y: 530 },
  { label: 'the east door', x: 640, y: 260 },
];

/** The wiring closet port the rogue box is plugged into. */
export const ROGUE_PORT = 'p7';

/** The lab's clock: the evening of day 14. */
export const CLOCK = '18:00';

/** When tonight's events start (the clock opens at 18:00): the lookalike, the jammer, movie night. */
export const TONIGHT = { lookalike: '18:05', jam: '19:30', movie: '20:00' } as const;

/** Phones and laptops online on a usual evening, and on movie night. */
export const USUAL_CROWD = 20;
export const MOVIE_CROWD = 140;

export const APPROVED: ApprovedAp[] = [
  { ssid: SSID, bssid: BSSID.wap, channel: 6, where: 'Gym, on the ceiling at center court' },
  { ssid: 'Shelter-Staff', bssid: BSSID.wap2, channel: 1, where: 'Main office, above the door' },
];

/** What the access point and the closet switch recorded over two weeks, for replaying through the alarms. */
export const RECORD: AirRecord[] = [
  { day: 1, time: '17:55', kind: 'ap', ssid: SSID, bssid: BSSID.wap, channel: 6, what: 'the shelter network', attack: false },
  { day: 1, time: '17:55', kind: 'ap', ssid: 'Shelter-Staff', bssid: BSSID.wap2, channel: 1, what: 'the office network', attack: false },
  { day: 2, time: '20:00', kind: 'noise', channel: 6, level: 6, what: 'a quiet evening', attack: false },
  { day: 3, time: '19:45', kind: 'noise', channel: 6, level: 14, what: 'movie night (day 3)', attack: false },
  { day: 5, time: '09:12', kind: 'port-mac', port: 'port 4', mac: MAC.volunteer, what: "a volunteer's new laptop", attack: false },
  { day: 7, time: '21:30', kind: 'noise', channel: 6, level: 7, what: 'a quiet evening', attack: false },
  { day: 10, time: '19:50', kind: 'noise', channel: 6, level: 17, what: 'movie night (day 10)', attack: false },
  { day: 13, time: '23:41', kind: 'port-mac', port: 'port 7', mac: BSSID.rogue, what: 'the rogue box', attack: true },
  { day: 13, time: '23:43', kind: 'ap', ssid: ROGUE_SSID, bssid: BSSID.rogue, channel: 11, what: 'the rogue box', attack: true },
  // Tonight, at the times the step setups move the clock to (see TONIGHT).
  { day: 14, time: '18:05', kind: 'ap', ssid: LOOKALIKE, bssid: BSSID.twin, channel: 6, what: 'the lookalike radio', attack: true },
  { day: 14, time: '18:06', kind: 'ap', ssid: SSID, bssid: BSSID.twin, channel: 6, what: 'the lookalike radio', attack: true },
  { day: 14, time: '19:30', kind: 'noise', channel: 6, level: 88, what: 'the jammer', attack: true },
  { day: 14, time: '20:00', kind: 'noise', channel: 6, level: 17, what: 'movie night (day 14)', attack: false },
];

export const isMovieNight = (what: string) => what.startsWith('movie night');

export function buildWatch(): Sim {
  const host = (id: keyof typeof MAC & keyof typeof IP, label: string, icon: 'laptop' | 'phone', x: number, y: number, user: string, profile?: WifiProfile) => ({
    id,
    o: { label, sublabel: IP[id], icon, x, y, ip: `${IP[id]}/24`, gateway: IP.gw, mac: MAC[id], wifiClient: { ssid: SSID, user, profile: profile && { ...profile } } },
  });
  const hosts = [
    host('desk', 'Volunteer desk', 'laptop', 200, 250, 'desk', STAFF_PROFILE),
    host('phone1', 'Rivera phone', 'phone', 150, 480, 'rivera', STAFF_PROFILE),
    host('laptop1', 'Chen laptop', 'laptop', 430, 250, 'chen', STAFF_PROFILE),
    host('visitor', 'Okafor phone', 'phone', 450, 500, 'okafor'),
  ];
  const net = new NetBuilder({ linkMs: 700 })
    .switch('wap', {
      label: 'Shelter Wi-Fi',
      sublabel: SSID,
      icon: 'wifi',
      x: 330,
      y: 360,
      wifi: {
        ssid: SSID,
        bssid: BSSID.wap,
        security: 'wpa3',
        wps: false,
        auth: 'eap',
        users: USERS,
        server: SERVER,
        beacon: false,
        power: 2,
        channel: 6,
      },
    })
    .switch('wap2', {
      label: 'Office access point',
      sublabel: 'Shelter-Staff',
      icon: 'wifi',
      x: 120,
      y: 100,
      wifi: { ssid: 'Shelter-Staff', bssid: BSSID.wap2, security: 'wpa3', wps: false, auth: 'eap', users: ['desk'], server: SERVER, beacon: false, power: 1, channel: 1 },
    })
    .switch('lansw', { label: 'Wiring closet', icon: 'switch', x: 420, y: 100, ports: 8 })
    .router('sat', {
      label: 'Satellite uplink',
      sublabel: IP.gw,
      icon: 'router',
      x: 640,
      y: 100,
      ifaces: [{ id: 'lan', ip: `${IP.gw}/24` }],
    })
    .hub('rogue', {
      // Named for the wall jack, the way a switch port's description would read: nothing on the wire says what it is.
      label: 'Hallway jack',
      icon: 'wifi',
      x: 560,
      y: 215,
      wifi: { ssid: ROGUE_SSID, bssid: BSSID.rogue, security: 'open', wps: false, auth: 'psk', beacon: true, power: 2, channel: 11, off: true },
    })
    .hub('twin', {
      label: 'Lookalike radio',
      icon: 'wifi',
      x: TWIN_POS.x,
      y: TWIN_POS.y,
      // Open at first. When it copies the network (copy-name in index.ts) it switches to WPA3 with a per-person
      // login, checked by its own sign-in server, which accepts any login and has no certificate for radius.shelter.
      wifi: { ssid: LOOKALIKE, bssid: BSSID.twin, security: 'open', wps: false, auth: 'psk', users: USERS, beacon: true, power: 2, boost: 45, channel: 6, off: true },
    });
  for (const h of hosts) net.host(h.id, h.o);
  net
    .link('wap', ['lansw', 'p1'])
    .link('wap2', ['lansw', 'p2'])
    .link('rogue', ['lansw', ROGUE_PORT])
    .link(['sat', 'lan'], ['lansw', 'p8']);

  const sim = net.build();
  sim.configureSwitch('lansw');
  // Two weeks of traffic taught the switch who is behind each port. The box on port 7 isn't plugged in yet.
  sim.prelearnSwitch('lansw');
  for (const [mac, port] of Object.entries(sim.dev('lansw').macTable)) if (port === ROGUE_PORT) delete sim.dev('lansw').macTable[mac];
  // Staff and families are already connected when the lab opens.
  sim.recomputeWifi();
  sim.configureWids('wap', { approved: APPROVED, record: RECORD, usualCrowd: USUAL_CROWD });
  sim.events = [];
  return sim;
}

// --- Setup helpers (idempotent) ---

/** Milliseconds back from the lab's 18:00 start to `hh:mm` yesterday. */
export function lastNight(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return -((18 * 60 - (h * 60 + m - 24 * 60)) * 60 * 1000);
}

/**
 * Sweep: the rogue box went in last night. The switch logged the jack coming
 * up and a new device on it; the access point heard a new network. Seeded once.
 */
export function seedRogue(sim: Sim): void {
  const w = sim.dev('wap').wids!;
  if (!w.heard[BSSID.rogue]) {
    sim.log('lansw', { source: 'link', level: 'notice', msg: '%LINK-3-UPDOWN: Interface port 7, changed state to up', fields: { port: ROGUE_PORT, state: 'up' } }, lastNight('23:41'));
    sim.log(
      'lansw',
      { source: 'mac-table', level: 'notice', msg: `%SW_MATM-6-MAC_NEW: New MAC ${BSSID.rogue} learned on port 7 (no device on this port before)`, fields: { port: ROGUE_PORT, mac: BSSID.rogue, action: 'new-mac' } },
      lastNight('23:41') + 2000,
    );
    sim.log(
      'wap',
      { source: 'wids', level: 'warn', msg: `new network heard: "${ROGUE_SSID}" ${BSSID.rogue}, channel 11, open`, fields: { ssid: ROGUE_SSID, bssid: BSSID.rogue, channel: 11, security: 'open', action: 'heard' } },
      lastNight('23:43'),
    );
    w.heard[BSSID.rogue] = { t: lastNight('23:43'), ssid: ROGUE_SSID };
    // The switch learned the box's address, so its MAC table agrees with the log.
    sim.dev('lansw').macTable[BSSID.rogue] = ROGUE_PORT;
  }
  // Its radio is on until the port is shut and a volunteer takes it down (removeRogue).
  if (sim.dev('rogue').wifi!.off && !sim.dev('lansw').switchSec?.ports[ROGUE_PORT]?.shutdown) sim.setWifiOff('rogue', false);
}

/**
 * Move the clock forward to `hhmm` tonight, if it isn't there yet, so the log's
 * times match the story (a student works through the steps in minutes of lab time).
 */
export function catchUp(sim: Sim, hhmm: string): void {
  const [h, m] = hhmm.split(':').map(Number);
  const at = ((h - 18) * 60 + m) * 60 * 1000;
  if (sim.t < at) sim.advanceTo(at);
}

/** The box comes off the wall (a volunteer unplugs it), and the port stays shut. */
export function removeRogue(sim: Sim): void {
  if (!sim.dev('lansw').switchSec?.ports[ROGUE_PORT]?.shutdown) sim.setPortShutdown('lansw', ROGUE_PORT, true);
  if (!sim.dev('rogue').wifi!.off) sim.setWifiOff('rogue', true);
}

/** Jam channel 6 (a radio in a van in the parking lot), or stop. Nothing on the map marks it. */
export function setJam(sim: Sim, on: boolean): void {
  if (sim.jam.on === on) return;
  sim.jam = on ? { on: true, channel: 6 } : { on: false, channel: 0 };
  sim.recomputeWifi();
}

/** Whether a device is on the real shelter network. */
export const onReal = (sim: Sim, id: string) => sim.dev(id).wifiClient?.joinedAp === 'wap';
