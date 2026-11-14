import { NetBuilder } from '../../sim/build';
import type { Sim } from '../../sim/sim';

/**
 * Ridgeview High gym, now an emergency shelter after a storm. A satellite link
 * gives internet; a National Guard technician is standing up Wi-Fi for the
 * families sheltering inside. Mallory sits in a car in the parking lot.
 *
 * The map is a 1000 x 600 canvas. The gym building is on the left; the parking
 * lot is on the right. The access point's reach is a circle that follows its
 * power setting (see the lab's map.zones).
 */

export const SSID = 'Ridgeview-Shelter';

export const BSSID = {
  wap: '02:ca:fe:5e:11:01',
  rogue: '02:17:0e:00:00:07',
};

export const MAC = {
  desk: '0a:de:5c:00:00:01',
  phone1: '0a:21:fa:00:00:11',
  laptop1: '0a:ce:4e:00:00:12',
  phonelot: '0a:9a:7e:00:00:13',
  mallory: '0e:ba:d0:00:00:66',
};

export const IP = {
  gw: '192.168.50.1',
  desk: '192.168.50.5',
  phone1: '192.168.50.21',
  laptop1: '192.168.50.22',
  phonelot: '192.168.50.23',
  mallory: '192.168.50.66',
  portal: '203.0.113.10',
};

/** A short passphrase an attacker can guess. */
export const WEAK_PASS = 'shelter1';
/** A long passphrase that holds up. */
export const STRONG_PASS = 'RidgeviewShelter2024';

/** The shelter's own wireless devices that must stay in range. */
export const FAMILIES = ['desk', 'phone1', 'laptop1', 'phonelot'] as const;

/** The gym building and the parking lot, in map coordinates. */
export const GYM = { x: 80, y: 150, w: 520, h: 400 };
export const LOT = { x: 680, y: 270, w: 290, h: 260 };

/** Where the WAP sits (the center of its signal circle). */
export const WAP_POS = { x: 320, y: 300 };

/** A family signs in to the shelter check-in page over plain HTTP. */
export const LOGIN_BODY = 'user=rivera&pass=welcome123';

export function buildShelter(): Sim {
  const net = new NetBuilder({ linkMs: 700, httpTimeoutMs: 12000 })
    .hub('wap', {
      label: 'Shelter Wi-Fi',
      sublabel: SSID,
      icon: 'wifi',
      x: WAP_POS.x,
      y: WAP_POS.y,
      wifi: {
        ssid: SSID,
        bssid: BSSID.wap,
        security: 'open',
        wps: true,
        auth: 'psk',
        users: ['rivera', 'chen', 'patel', 'desk'],
        beacon: true,
        power: 4,
        channel: 6,
      },
    })
    .host('desk', { label: 'Volunteer desk', sublabel: IP.desk, icon: 'laptop', x: 300, y: 200, ip: `${IP.desk}/24`, gateway: IP.gw, mac: MAC.desk, wifiClient: { ssid: SSID, user: 'desk' } })
    .host('phone1', { label: 'Rivera phone', sublabel: IP.phone1, icon: 'phone', x: 180, y: 220, ip: `${IP.phone1}/24`, gateway: IP.gw, mac: MAC.phone1, wifiClient: { ssid: SSID, user: 'rivera' } })
    .host('laptop1', { label: 'Chen laptop', sublabel: IP.laptop1, icon: 'laptop', x: 430, y: 230, ip: `${IP.laptop1}/24`, gateway: IP.gw, mac: MAC.laptop1, wifiClient: { ssid: SSID, user: 'chen' } })
    .host('phonelot', { label: 'Patel phone', sublabel: IP.phonelot, icon: 'phone', x: 560, y: 430, ip: `${IP.phonelot}/24`, gateway: IP.gw, mac: MAC.phonelot, wifiClient: { ssid: SSID, user: 'patel' } })
    .host('mallory', {
      label: 'Mallory',
      sublabel: 'parking lot',
      icon: 'attacker',
      x: 860,
      y: 360,
      ip: `${IP.mallory}/24`,
      gateway: IP.gw,
      mac: MAC.mallory,
      attacker: true,
      wifiClient: { ssid: SSID },
    })
    .hub('rogue', {
      label: 'Unknown box',
      sublabel: 'hallway jack',
      icon: 'wifi',
      x: 540,
      y: 500,
      wifi: { ssid: 'Shelter-Setup', bssid: BSSID.rogue, security: 'open', wps: false, auth: 'psk', beacon: true, power: 2, channel: 11, off: true, rogue: true },
    })
    .switch('lansw', { label: 'Wiring closet', icon: 'switch', x: 470, y: 110 })
    .router('sat', {
      label: 'Satellite uplink',
      sublabel: IP.gw,
      icon: 'router',
      x: 660,
      y: 110,
      ifaces: [
        { id: 'lan', ip: `${IP.gw}/24` },
        { id: 'wan', ip: '100.64.0.2/30' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '100.64.0.1', iface: 'wan' }],
    })
    .router('net', {
      label: 'The Internet',
      icon: 'cloud',
      x: 820,
      y: 110,
      ifaces: [
        { id: 'wan', ip: '100.64.0.1/30' },
        { id: 'pub', ip: '203.0.113.1/24' },
      ],
      routes: [{ prefix: '192.168.50.0/24', via: '100.64.0.2', iface: 'wan' }],
    })
    .host('portal', {
      label: 'checkin.example',
      sublabel: IP.portal,
      icon: 'server',
      x: 910,
      y: 200,
      ip: `${IP.portal}/24`,
      gateway: '203.0.113.1',
      web: {
        name: 'checkin.example',
        title: 'Shelter Check-In',
        https: false,
        page: 'Sign in with your family name to reach the internet.',
        dashboard: 'The shelter network is online for your family.',
      },
    })
    .link('wap', 'lansw')
    .link('rogue', 'lansw')
    .link(['sat', 'lan'], 'lansw')
    .link(['sat', 'wan'], ['net', 'wan'])
    .link(['net', 'pub'], 'portal')
    .hostsFile({ 'checkin.example': IP.portal });

  const sim = net.build();
  // Families are already connected to the open network when the lab opens.
  sim.recomputeWifi();
  sim.prewarmArp(['desk', 'phone1', 'laptop1', 'phonelot', 'mallory', 'sat', 'net', 'portal']);
  sim.events = [];
  return sim;
}
