import { NetBuilder } from '../../sim/build';
import { evaluate, type FwMode, type FwRuleInput } from '../../sim/firewall';
import type { Sim } from '../../sim/sim';
import {
  ATTACKER,
  CLINIC,
  CLINIC_SSH,
  DENY_IN_TCP,
  FILES,
  HOSPITAL_SITE,
  NURSE,
  OUT_ANY,
  PATIENTS_IN,
  PORTAL_SITE,
  probe,
  STAFF_NET,
  STAFF_OUT,
  WEB,
} from '../firewall/scenario';
import type { MapZone } from '../types';

// Adams County Hospital a week after Firewall Rulebook: Firewalls A and B are
// in place with the rulebooks students wrote. New here: a branch office whose
// router has a firewall built in. The patient at home is gone (the branch's
// front desk uses the web app instead), which keeps the map short.

export { ATTACKER, CLINIC, FILES, HOSPITAL_SITE, NURSE, PORTAL_SITE, STAFF_NET, WEB };

export const BRANCH_NET = '10.0.3.0/24';
export const DESK = '10.0.3.10';
export const BRANCH_WAN = '192.0.2.2';

/** The port the remote-control program moves to in step 6: a random high port no well-known program uses. (Not 8443, the usual second HTTPS port.) */
export const ODD_PORT = 47001;

/** The web app's booking page, and the attacker's booking lookup with database commands hidden in it. */
export const BOOK_PATH = '/appointments?id=7';
export const EXPLOIT_PATH = "/appointments?id=7' OR '1'='1";

/** Firewall A's rulebook as Firewall Rulebook left it. */
export const A_RULES: FwRuleInput[] = [OUT_ANY, PATIENTS_IN, CLINIC_SSH, DENY_IN_TCP];
/** Firewall B's. */
export const B_RULES: FwRuleInput[] = [STAFF_OUT];

/** The branch router's one rule from the box: branch computers may start conversations going out. */
export const BRANCH_OUT: FwRuleInput = {
  dir: 'out',
  proto: 'any',
  src: 'any',
  dst: 'any',
  dport: 'any',
  action: 'allow',
  note: 'Branch computers may start conversations going out',
};

/** Step 2: what a stateless Firewall A needs so replies from web sites get back in. */
export const REPLIES_IN: FwRuleInput = { dir: 'in', proto: 'tcp', src: 'any', sport: 443, dst: 'any', dport: 'any', action: 'allow' };
/** Step 6: no remote-control program leaves the hospital, on any port. */
export const NO_REMOTE: FwRuleInput = { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', app: 'remote-control', action: 'deny' };
/** Step 8: the branch router lets in replies from the hospital web app, and nothing else. */
export const BRANCH_REPLIES: FwRuleInput = { dir: 'in', proto: 'tcp', src: WEB, sport: 443, dst: BRANCH_NET, dport: 'any', action: 'allow' };

/** What each type of firewall costs the hospital (step 10). A next-generation box costs three times a stateful one. */
export const PRICE: Record<FwMode, number> = { stateless: 4000, stateful: 10000, ngfw: 30000 };
export const BUDGET = 40000;

export function buildHospital2(): Sim {
  const sim = new NetBuilder({ linkMs: 200, procMs: 60, httpTimeoutMs: 7000, pingTimeoutMs: 5000, autoArp: true })
    .host('attacker', {
      label: 'Attacker',
      sublabel: ATTACKER,
      x: 75,
      y: 130,
      ip: `${ATTACKER}/24`,
      gateway: '203.0.113.1',
      attacker: true,
      services: [
        { port: 443, proto: 'tcp', app: 'remote-control', banner: 'Remote-control server: waiting for victims to call in' },
        { port: ODD_PORT, proto: 'tcp', app: 'remote-control', banner: 'Remote-control server: waiting for victims to call in' },
      ],
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
    .router('inet', {
      label: 'Internet',
      sublabel: 'the hospital’s ISP',
      icon: 'isp',
      x: 220,
      y: 300,
      ifaces: [
        { id: 'clinic', ip: '198.51.100.1/24' },
        { id: 'att', ip: '203.0.113.1/24' },
        { id: 'hosp', ip: '10.0.1.1/24' },
        { id: 'branch', ip: '192.0.2.1/24' },
      ],
      routes: [
        { prefix: STAFF_NET, via: '10.0.1.2', iface: 'hosp' },
        { prefix: BRANCH_NET, via: BRANCH_WAN, iface: 'branch' },
      ],
    })
    .router('branch', {
      label: 'Branch router',
      icon: 'router',
      x: 220,
      y: 500,
      ifaces: [
        { id: 'wan', ip: `${BRANCH_WAN}/24` },
        { id: 'lan', ip: '10.0.3.1/24' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '192.0.2.1', iface: 'wan' }],
      firewall: { outside: 'wan', mode: 'stateless', rules: [BRANCH_OUT] },
    })
    .host('desk', {
      label: 'Front desk',
      sublabel: DESK,
      icon: 'desktop',
      x: 370,
      y: 500,
      ip: `${DESK}/24`,
      gateway: '10.0.3.1',
      services: [],
    })
    .firewall('fwA', { label: 'Firewall A', x: 345, y: 300, mode: 'stateful', rules: A_RULES })
    .switch('serversw', { label: 'Server switch', x: 470, y: 300 })
    .host('web', {
      label: 'Web server',
      sublabel: WEB,
      icon: 'server',
      x: 470,
      y: 130,
      ip: `${WEB}/24`,
      gateway: '10.0.1.1',
      web: {
        name: HOSPITAL_SITE,
        title: 'Adams County Hospital: book an appointment or pay a bill',
        https: true,
        pages: {
          [BOOK_PATH]: { title: 'Appointment 7', page: 'Tuesday at 9:30 with Dr. Okafor.' },
          // What the hidden database commands get back: every patient's appointments.
          [EXPLOIT_PATH]: { title: 'All 18,240 appointments', page: 'Every patient: names, dates of birth, doctors, and visit reasons.' },
        },
      },
      services: [{ port: 22, proto: 'tcp', app: 'ssh', banner: 'SSH-2.0-OpenSSH_9.6: administrator login' }],
    })
    .firewall('fwB', { label: 'Firewall B', x: 585, y: 300, mode: 'stateful', rules: B_RULES })
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
    .link('attacker', ['inet', 'att'])
    .link('clinic', ['inet', 'clinic'])
    .link(['inet', 'branch'], ['branch', 'wan'])
    .link(['branch', 'lan'], 'desk')
    .link(['inet', 'hosp'], ['fwA', 'outside'])
    .link(['fwA', 'inside'], 'serversw')
    .link('serversw', 'web')
    .link('serversw', ['fwB', 'outside'])
    .link(['fwB', 'inside'], ['hrouter', 'servers'])
    .link(['hrouter', 'staff'], 'staffsw')
    .link('staffsw', 'nurse')
    .link('staffsw', 'files')
    .hostsFile({ [HOSPITAL_SITE]: WEB, [PORTAL_SITE]: CLINIC })
    .build();
  // The web server reaches the staff network through the hospital router (see firewall/scenario.ts).
  sim.dev('web').routes.push({ prefix: STAFF_NET, via: '10.0.1.2', iface: 'eth0', source: 'static' });
  return sim;
}

/** Map zones: the internet, the branch office, the screened subnet, and the internal network. */
export function zones(): MapZone[] {
  return [
    { id: 'internet', shape: { kind: 'rect', x: 12, y: 40, w: 290, h: 380 }, label: 'Internet', tone: 'bad' },
    { id: 'branch', shape: { kind: 'rect', x: 100, y: 440, w: 350, h: 145 }, label: 'Branch office' },
    { id: 'dmz', shape: { kind: 'rect', x: 375, y: 40, w: 180, h: 380 }, label: 'Screened subnet (DMZ)', tone: 'warn' },
    { id: 'lan', shape: { kind: 'rect', x: 615, y: 40, w: 373, h: 545 }, label: 'Internal network', tone: 'good' },
  ];
}

// ---------------------------------------------------------------------------
// Test traffic
// ---------------------------------------------------------------------------

/** The attacker sends a reply that answers nothing anyone asked, from port 443. `from` forges the source address. */
export function fakeReply(sim: Sim, to: string, from = ATTACKER): void {
  sim.sendPacket('attacker', {
    src: from,
    dst: to,
    proto: 'tcp',
    srcPort: 443,
    dstPort: 51515,
    app: { kind: 'svc', conn: 0, app: 'https', reply: true, text: 'fake reply' },
  });
}

/** Would Firewall A let staff out to the clinic portal right now? (A request packet, not a test.) */
export const staffOutAllowed = (sim: Sim) => evaluate(sim.dev('fwA').firewall!, probe(NURSE, CLINIC, 443), 'out').action === 'allow';
