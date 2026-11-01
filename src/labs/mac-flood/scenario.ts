import { NetBuilder } from '../../sim/build';
import type { Sim } from '../../sim/sim';
import type { Frame } from '../../sim/types';
import type { MapZone } from '../types';

// Lincoln High front office: one switch, two staff PCs, the records server,
// a lobby printer, and an empty wall jack in the lobby (switch port 7).

export const MAC = {
  router: '0a:d1:57:00:00:01',
  records: '0a:5e:c0:00:00:10',
  ortiz: '0a:0e:71:00:00:21',
  chen: '0a:c4:e0:00:00:22',
  printer: '0a:9e:17:00:00:30',
  mallory: '0e:ba:d0:00:00:66',
};

export const IP = {
  router: '192.168.50.1',
  records: '192.168.50.10',
  ortiz: '192.168.50.21',
  chen: '192.168.50.22',
  printer: '192.168.50.30',
  mallory: '192.168.50.66',
};

/** Switch ports. p6 and p8 are spare ports in the office; p7 runs to the lobby wall jack. */
export const PORT = { router: 'p1', records: 'p2', ortiz: 'p3', chen: 'p4', printer: 'p5', spare: 'p6', jack: 'p7', spare2: 'p8' } as const;

/** Ports with nothing plugged in at the start: the ones to shut down. */
export const UNUSED = ['p6', 'p7', 'p8'];

/** Real switches hold thousands of entries. This one holds 32 so students can watch it fill. */
export const TABLE_SIZE = 32;

export const SITE = 'records.lhs';
export const ATTENDANCE_URL = `http://${SITE}/attendance?period=3&absent=Jordan+Lee+(doctor),Ava+Patel`;

/** Ms. Ortiz's attendance upload. */
export const isAttendance = (f: Frame): boolean => f.ip?.app.kind === 'http-req' && f.ip.app.path.startsWith('/attendance');

export function buildOffice(): Sim {
  const sim = new NetBuilder({ linkMs: 850 })
    .router('router', {
      label: 'District router',
      sublabel: IP.router,
      icon: 'router',
      x: 330,
      y: 95,
      ifaces: [
        { id: 'lan', ip: `${IP.router}/24`, mac: MAC.router },
        { id: 'wan', ip: '10.50.0.2/30' },
      ],
    })
    .host('records', {
      label: 'Records server',
      sublabel: IP.records,
      icon: 'server',
      x: 120,
      y: 210,
      ip: `${IP.records}/24`,
      gateway: IP.router,
      mac: MAC.records,
      web: { name: SITE, title: 'Lincoln High Records', https: false, page: 'Attendance saved. Thank you!' },
      notes: ['Student records: attendance, grades, and health notes. The office reaches it over plain HTTP.'],
    })
    .host('ortiz', {
      label: 'Ms. Ortiz',
      sublabel: 'attendance clerk',
      icon: 'desktop',
      x: 130,
      y: 440,
      ip: `${IP.ortiz}/24`,
      gateway: IP.router,
      mac: MAC.ortiz,
    })
    .host('chen', {
      label: 'Mr. Chen',
      sublabel: 'counselor',
      icon: 'desktop',
      x: 330,
      y: 510,
      ip: `${IP.chen}/24`,
      gateway: IP.router,
      mac: MAC.chen,
    })
    .switch('sw', { label: 'Office switch', sublabel: '8 ports', icon: 'switch', x: 400, y: 300, ports: 8 })
    .host('printer', {
      label: 'Lobby printer',
      sublabel: IP.printer,
      icon: 'printer',
      x: 760,
      y: 500,
      ip: `${IP.printer}/24`,
      gateway: IP.router,
      mac: MAC.printer,
      notes: [`A sticker on the back reads: MAC ${MAC.printer.toUpperCase()}.`],
    })
    .host('mallory', {
      label: 'Mallory',
      sublabel: 'visitor',
      icon: 'attacker',
      x: 880,
      y: 330,
      ip: `${IP.mallory}/24`,
      gateway: IP.router,
      mac: MAC.mallory,
      attacker: true,
    })
    .link('router', ['sw', PORT.router])
    .link('records', ['sw', PORT.records])
    .link('ortiz', ['sw', PORT.ortiz])
    .link('chen', ['sw', PORT.chen])
    .link('printer', ['sw', PORT.printer])
    .hostsFile({ [SITE]: IP.records })
    .build();
  sim.configureSwitch('sw', { tableSize: TABLE_SIZE });
  sim.prelearnSwitch('sw');
  // Ms. Ortiz's PC just woke up, so step 2 starts with her ARP request.
  // Nobody in the office has ever talked to the visitor's laptop.
  sim.prewarmArp(['router', 'records', 'chen', 'printer']);
  for (const id of ['router', 'records', 'chen', 'printer']) delete sim.dev(id).arp[IP.mallory];
  seedHistory(sim);
  return sim;
}

/** The switch's log from this morning, before the lab starts at 10:15. */
function seedHistory(sim: Sim): void {
  const min = 60 * 1000;
  const at = (minutesBefore: number) => -minutesBefore * min;
  const link = (port: string, n: number, up: boolean, when: number) =>
    sim.log(
      'sw',
      {
        source: 'link',
        level: up ? 'notice' : 'warn',
        msg: `%LINK-3-UPDOWN: Interface port ${n}, changed state to ${up ? 'up' : 'down'}`,
        fields: { port, state: up ? 'up' : 'down' },
      },
      at(when),
    );
  sim.log('sw', { source: 'system', level: 'notice', msg: '%SYS-5-RESTART: System restarted after scheduled maintenance', fields: {} }, at(170));
  link('p1', 1, true, 169);
  link('p2', 2, true, 169);
  link('p5', 5, true, 168);
  link('p4', 4, true, 152);
  link('p3', 3, true, 141);
  link('p3', 3, false, 52);
  link('p3', 3, true, 51);
}

/** The building and the lobby on the map. The wall jack is a plaque: it turns red when port 7 is shut. */
export function zones(sim: Sim): MapZone[] {
  const jack = sim.dev('sw').switchSec?.ports[PORT.jack]?.shutdown;
  return [
    { id: 'office', shape: { kind: 'rect', x: 30, y: 30, w: 590, h: 545 }, label: 'Front office (staff only)', tone: 'neutral' },
    { id: 'lobby', shape: { kind: 'rect', x: 650, y: 200, w: 330, h: 375 }, label: 'Lobby (open to visitors)', tone: 'warn' },
    {
      id: 'jack',
      shape: { kind: 'rect', x: 664, y: 236, w: 176, h: 30 },
      label: jack ? 'Wall jack, port 7: off' : 'Wall jack, port 7',
      tone: jack ? 'good' : 'bad',
    },
  ];
}
