import { NetBuilder } from '../../sim/build';
import { firstMatch, type FwRuleInput } from '../../sim/firewall';
import type { Sim } from '../../sim/sim';
import type { IpPacket } from '../../sim/types';
import type { MapZone, PlacementFeedback } from '../types';

// Adams County Hospital (CED unit 3 scenario A). A public web app for patients
// on a web server, patient records on a file server, staff computers on the
// internal network. Two firewalls arrive unplugged; the student places them.

export const PATIENT = '192.0.2.25';
export const CLINIC = '198.51.100.40';
export const ATTACKER = '203.0.113.66';
export const WEB = '10.0.1.10';
export const NURSE = '10.0.2.21';
export const FILES = '10.0.2.50';
export const SERVER_NET = '10.0.1.0/24';
export const STAFF_NET = '10.0.2.0/24';
export const CLINIC_NET = '198.51.100.0/24';

export const HOSPITAL_SITE = 'achospital.example';
export const PORTAL_SITE = 'portal.lakeside.example';

/** Firewall A's rule from the box: the hospital's own computers may start conversations going out. */
export const OUT_ANY: FwRuleInput = {
  dir: 'out',
  proto: 'any',
  src: 'any',
  dst: 'any',
  dport: 'any',
  action: 'allow',
  note: 'Hospital computers may start conversations going out',
};
/** What step 4 asks for: patients reach the web app. */
export const PATIENTS_IN: FwRuleInput = { dir: 'in', proto: 'tcp', src: 'any', dst: WEB, dport: 443, action: 'allow' };
/** Step 5: a coworker's rule that blocks every other inbound TCP connection. */
export const DENY_IN_TCP: FwRuleInput = {
  dir: 'in',
  proto: 'tcp',
  src: 'any',
  dst: 'any',
  dport: 'any',
  action: 'deny',
  note: 'Added by IT: block all other inbound TCP',
};
/** Step 5: the clinic's IT staff may log in to the web server with SSH. */
export const CLINIC_SSH: FwRuleInput = {
  dir: 'in',
  proto: 'tcp',
  src: CLINIC_NET,
  dst: WEB,
  dport: 22,
  action: 'allow',
  note: 'Added by IT: Lakeside Clinic admins manage the web server',
};

/** Step 6, Firewall B: staff computers may start conversations going out. */
export const STAFF_OUT: FwRuleInput = { dir: 'out', proto: 'any', src: STAFF_NET, dst: 'any', dport: 'any', action: 'allow' };

/** The cable Firewall A belongs in, and the two that work for Firewall B. */
export const EDGE: [string, string] = ['inet', 'serversw'];
export const INNER: [string, string][] = [
  ['serversw', 'hrouter'],
  ['hrouter', 'staffsw'],
];

export function buildHospital(): Sim {
  const sim = new NetBuilder({ linkMs: 260, procMs: 80, httpTimeoutMs: 10000, pingTimeoutMs: 7000, autoArp: true })
    .host('patient', {
      label: 'Patient at home',
      sublabel: PATIENT,
      icon: 'laptop',
      x: 75,
      y: 120,
      ip: `${PATIENT}/24`,
      gateway: '192.0.2.1',
    })
    .host('clinic', {
      label: 'Lakeside Clinic',
      sublabel: CLINIC,
      icon: 'desktop',
      x: 75,
      y: 300,
      ip: `${CLINIC}/24`,
      gateway: '198.51.100.1',
      web: { name: PORTAL_SITE, title: 'Lakeside Clinic staff portal', https: true },
      services: [],
    })
    .host('attacker', {
      label: 'Attacker',
      sublabel: ATTACKER,
      x: 75,
      y: 480,
      ip: `${ATTACKER}/24`,
      gateway: '203.0.113.1',
      attacker: true,
      services: [{ port: 443, proto: 'tcp', app: 'remote-control', banner: 'Remote-control server: waiting for victims to call in' }],
    })
    .router('inet', {
      label: 'Internet',
      sublabel: 'the hospital’s ISP',
      icon: 'isp',
      x: 220,
      y: 300,
      ifaces: [
        { id: 'home', ip: '192.0.2.1/24' },
        { id: 'clinic', ip: '198.51.100.1/24' },
        { id: 'att', ip: '203.0.113.1/24' },
        { id: 'hosp', ip: '10.0.1.1/24' },
      ],
      routes: [{ prefix: STAFF_NET, via: '10.0.1.2', iface: 'hosp' }],
    })
    .switch('serversw', { label: 'Server switch', x: 470, y: 300 })
    .host('web', {
      label: 'Web server',
      sublabel: WEB,
      icon: 'server',
      x: 470,
      y: 130,
      ip: `${WEB}/24`,
      gateway: '10.0.1.1',
      web: { name: HOSPITAL_SITE, title: 'Adams County Hospital: book an appointment or pay a bill', https: true },
      services: [{ port: 22, proto: 'tcp', app: 'ssh', banner: 'SSH-2.0-OpenSSH_9.6: administrator login' }],
    })
    .router('hrouter', {
      label: 'Hospital router',
      icon: 'router',
      x: 700,
      y: 300,
      ifaces: [
        { id: 'servers', ip: '10.0.1.2/24' },
        { id: 'staff', ip: '10.0.2.1/24' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '10.0.1.1', iface: 'servers' }],
    })
    .switch('staffsw', { label: 'Staff switch', x: 915, y: 300 })
    .host('nurse', {
      label: 'Nurse station',
      sublabel: NURSE,
      icon: 'desktop',
      x: 915,
      y: 130,
      ip: `${NURSE}/24`,
      gateway: '10.0.2.1',
      services: [],
    })
    .host('files', {
      label: 'File server',
      sublabel: FILES,
      icon: 'server',
      x: 915,
      y: 470,
      ip: `${FILES}/24`,
      gateway: '10.0.2.1',
      services: [
        { port: 22, proto: 'tcp', app: 'ssh', banner: 'SSH-2.0-OpenSSH_9.6: administrator login' },
        { port: 445, proto: 'tcp', app: 'smb', banner: 'Shared folder PatientRecords: 18,240 patient files' },
      ],
    })
    .firewall('fwA', { label: 'Firewall A', x: 560, y: 520, mode: 'stateful', rules: [OUT_ANY] })
    .firewall('fwB', { label: 'Firewall B', x: 720, y: 520, mode: 'stateful' })
    .link('patient', ['inet', 'home'])
    .link('clinic', ['inet', 'clinic'])
    .link('attacker', ['inet', 'att'])
    .link(['inet', 'hosp'], 'serversw')
    .link('serversw', 'web')
    .link('serversw', ['hrouter', 'servers'])
    .link(['hrouter', 'staff'], 'staffsw')
    .link('staffsw', 'nurse')
    .link('staffsw', 'files')
    .hostsFile({ [HOSPITAL_SITE]: WEB, [PORTAL_SITE]: CLINIC })
    .build();
  // The web server reaches the staff network through the hospital router, and
  // everything else through the internet router. (Without this route, its
  // packets for the staff network would bounce off the internet router and
  // cross Firewall A twice.)
  sim.dev('web').routes.push({ prefix: STAFF_NET, via: '10.0.1.2', iface: 'eth0', source: 'static' });
  return sim;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const same = (c: [string, string], a: string, b: string) => (c[0] === a && c[1] === b) || (c[0] === b && c[1] === a);

/** The two devices the firewall's cable joined, or undefined if it isn't placed. */
export function placedOn(sim: Sim, fwId: string): [string, string] | undefined {
  const p = sim.dev(fwId).firewall?.placed;
  return p ? [p.a.device, p.b.device] : undefined;
}

export const aAtEdge = (sim: Sim) => {
  const c = placedOn(sim, 'fwA');
  return !!c && same(EDGE, ...c);
};
export const bInside = (sim: Sim) => {
  const c = placedOn(sim, 'fwB');
  return !!c && INNER.some((i) => same(i, ...c));
};
export const bothPlaced = (sim: Sim) => aAtEdge(sim) && bInside(sim);

/** Feedback for every cable a firewall could go into. */
export const PLACEMENT: PlacementFeedback[] = [
  {
    device: 'fwA',
    between: EDGE,
    good: true,
    text: 'Right. Every packet between the internet and the hospital crosses this cable, so Firewall A sees all of it.',
  },
  {
    device: 'fwB',
    between: EDGE,
    good: false,
    text: 'This is the internet edge: the plan puts Firewall A here. Firewall B is the inside wall, between the web server’s network and the staff network.',
  },
  {
    device: 'fwB',
    between: INNER[0],
    good: true,
    text: 'Right. Nothing reaches the staff network without crossing Firewall B, not even the web server.',
  },
  {
    device: 'fwB',
    between: INNER[1],
    good: true,
    text: 'Right. Nothing reaches the staff network without crossing Firewall B, not even the web server.',
  },
  {
    device: 'fwA',
    between: INNER[0],
    good: false,
    text: 'This protects the staff network, but the internet can still reach the web server with nothing in the way. Firewall A goes at the internet edge.',
  },
  {
    device: 'fwA',
    between: INNER[1],
    good: false,
    text: 'This protects the staff network, but the internet can still reach the web server with nothing in the way. Firewall A goes at the internet edge.',
  },
  {
    between: ['serversw', 'web'],
    good: false,
    text: 'This guards only the web server. The internet can still reach the staff network through the hospital router.',
  },
  { between: ['patient', 'inet'], good: false, text: 'That cable belongs to the patient’s home network. The hospital can only put firewalls on its own cables.' },
  { between: ['clinic', 'inet'], good: false, text: 'That cable belongs to the clinic. The hospital can only put firewalls on its own cables.' },
  { between: ['attacker', 'inet'], good: false, text: 'The hospital doesn’t own the attacker’s cable. Put the firewall where the internet meets the hospital.' },
  {
    between: ['staffsw', 'nurse'],
    good: false,
    text: 'This guards one computer. The file server and the rest of the network stay open.',
  },
  {
    between: ['staffsw', 'files'],
    good: false,
    text: 'This guards the file server, but nothing else. Put the firewalls where whole networks meet.',
  },
];

/** Map zones: the internet, and once both firewalls are in place, the screened subnet and the internal network. */
export function hospitalZones(sim: Sim): MapZone[] {
  const zones: MapZone[] = [{ id: 'internet', shape: { kind: 'rect', x: 12, y: 40, w: 290, h: 540 }, label: 'Internet', tone: 'bad' }];
  const a = sim.dev('fwA');
  const b = sim.dev('fwB');
  if (bothPlaced(sim)) {
    const left = a.x + 30;
    const mid = b.x - 30;
    zones.push({
      id: 'dmz',
      shape: { kind: 'rect', x: left, y: 40, w: mid - left, h: 400 },
      label: 'Screened subnet (DMZ)',
      tone: 'warn',
    });
    zones.push({ id: 'lan', shape: { kind: 'rect', x: b.x + 30, y: 40, w: 988 - (b.x + 30), h: 540 }, label: 'Internal network', tone: 'good' });
  } else if (!a.firewall?.placed || !b.firewall?.placed) {
    zones.push({ id: 'new', shape: { kind: 'rect', x: 480, y: 455, w: 320, h: 130 }, label: 'New firewalls', dashed: true });
  }
  return zones;
}

// ---------------------------------------------------------------------------
// Test traffic
// ---------------------------------------------------------------------------

/** A packet a firewall could be asked about, for setups that look at rules. */
export function probe(src: string, dst: string, dport: number, sport = 50000): IpPacket {
  return { src, dst, ttl: 64, proto: 'tcp', srcPort: sport, dstPort: dport, app: { kind: 'svc', conn: 1, app: 'probe', reply: false } };
}

/** Index of the rule on Firewall A that decides this inbound packet, or -1. */
export function ruleFor(sim: Sim, pkt: IpPacket): number {
  return firstMatch(sim.dev('fwA').firewall!.rules, pkt, 'in');
}
