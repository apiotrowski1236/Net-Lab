import { sameSubnet } from '../../sim/addr';
import { evaluate, type FwRuleInput } from '../../sim/firewall';
import { scanFindings, type Conn } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { SimEvent } from '../../sim/types';
import { happened, inspected, openedLog, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import {
  aAtEdge,
  ATTACKER,
  bInside,
  buildHospital,
  CLINIC_SSH,
  DENY_IN_TCP,
  FILES,
  hospitalZones,
  HOSPITAL_SITE,
  PATIENT,
  PATIENTS_IN,
  PLACEMENT,
  probe,
  SERVER_NET,
  STAFF_NET,
  WEB,
  ISP_ROUTER,
} from './scenario';

// ---------------------------------------------------------------------------
// Test traffic (the lesson's buttons)
// ---------------------------------------------------------------------------

const patientBooks: ActionDef = { id: 'patient', label: 'Patient books an appointment', run: (sim) => sim.browse('patient', `https://${HOSPITAL_SITE}/`) };
const attackerSsh: ActionDef = { id: 'attacker-ssh', label: 'Attacker tries SSH on the web server', run: (sim) => void sim.connectService('attacker', WEB, 22) };
const attackerPing: ActionDef = { id: 'attacker-ping', label: 'Attacker pings the web server', run: (sim) => void sim.ping('attacker', WEB) };
const clinicSsh: ActionDef = { id: 'clinic-ssh', label: 'Clinic admin logs in with SSH', run: (sim) => void sim.connectService('clinic', WEB, 22) };
const nurseWeb: ActionDef = { id: 'nurse-web', label: 'Nurse station opens the web app', run: (sim) => void sim.connectService('nurse', WEB, 443) };
const nursePing: ActionDef = { id: 'nurse-ping', label: 'Nurse station pings the internet (10.0.1.1)', run: (sim) => void sim.ping('nurse', ISP_ROUTER) };
const webToFiles: ActionDef = {
  id: 'web-files',
  label: 'Hacked web server reaches for the records',
  run: (sim) => void sim.connectService('web', FILES, 445),
};
const nurseFiles: ActionDef = { id: 'nurse-files', label: 'Nurse station opens the records', run: (sim) => void sim.connectService('nurse', FILES, 445) };

// ---------------------------------------------------------------------------
// Goal checks
// ---------------------------------------------------------------------------

type FwEvent = Extract<SimEvent, { type: 'firewall' }>;

/** When the student last changed this firewall's rules, type, or place. */
const changedAt = (sim: Sim, fw: string) => sim.dev(fw).firewall?.changedAt ?? 0;
/** Test results count from the step start, or from the firewall's last change if that's later. */
const afterChange = (sim: Sim, since: number, fw: string) => Math.max(since, changedAt(sim, fw));

/** A decision by firewall `fw` since `t` that matches. */
const fwSaw = (sim: Sim, t: number, fw: string, pred: (e: FwEvent) => boolean) =>
  happened(sim, t, (e) => e.type === 'firewall' && e.device === fw && pred(e));
const denied = (pred: (e: FwEvent) => boolean) => (e: FwEvent) => e.verdict.action === 'deny' && pred(e);

/** A connection from `device` since `since` that finished and matches. */
const connected = (sim: Sim, device: string, since: number, pred: (c: Conn) => boolean) =>
  (sim.dev(device).conns ?? []).some((c) => c.t >= since && c.status === 'open' && pred(c));

/** The attacker finished a scan since `since` that covered the /24 network `ip` is on. */
const scannedNet = (sim: Sim, since: number, ip: string) =>
  happened(sim, since, (e) => e.type === 'scan-done' && e.device === 'attacker' && e.scan.hosts.some((h) => sameSubnet(h.ip, ip, 24)));

/** Firewall A still has this rule (the student fixed the order instead of deleting it). */
const hasRule = (sim: Sim, rule: FwRuleInput) => sim.dev('fwA').firewall!.rules.some((r) => sameRule(r, rule));

/** Would Firewall A let a patient's HTTPS request in right now? */
const patientsAllowed = (sim: Sim) => evaluate(sim.dev('fwA').firewall!, probe(PATIENT, WEB, 443), 'in').action === 'allow';

// ---------------------------------------------------------------------------
// Step setups. Each puts the network in the state its step needs if the
// student skipped ahead or took something apart, and leaves it alone otherwise.
// ---------------------------------------------------------------------------

const sameRule = (a: FwRuleInput, b: FwRuleInput) =>
  a.dir === b.dir && a.proto === b.proto && a.src === b.src && a.dst === b.dst && a.dport === b.dport && (a.sport ?? 'any') === (b.sport ?? 'any') && a.action === b.action;

function placeBoth(sim: Sim): void {
  if (!aAtEdge(sim)) sim.unplaceFirewall('fwA');
  if (!bInside(sim)) sim.unplaceFirewall('fwB');
  if (!aAtEdge(sim)) sim.placeFirewall('fwA', 'inet', 'serversw', 'inet');
  if (!bInside(sim)) sim.placeFirewall('fwB', 'serversw', 'hrouter', 'serversw');
}

function patientsIn(sim: Sim): void {
  if (!patientsAllowed(sim)) sim.fwAddRule('fwA', PATIENTS_IN, 0);
}

/** A coworker's two new rules at the bottom of Firewall A, in the wrong order. */
function coworkerRules(sim: Sim): void {
  const rules = () => sim.dev('fwA').firewall!.rules;
  if (!rules().some((r) => sameRule(r, CLINIC_SSH))) sim.fwAddRule('fwA', CLINIC_SSH);
  if (!rules().some((r) => sameRule(r, DENY_IN_TCP))) {
    sim.fwAddRule('fwA', DENY_IN_TCP, rules().findIndex((r) => sameRule(r, CLINIC_SSH)));
  }
}

export const firewallLab: LabDef = {
  id: 'firewall',
  version: 3,
  title: 'Firewall Rules and Placement',
  tagline: 'Place two firewalls in a hospital network and write the rules that let patients in and keep attackers out.',
  unit: 3,
  codehs: ['3.10 The Rules of the Firewall', '3.12 Writing the Rulebooks'],
  ced: ['3.1.B', '3.1.C', '3.3.A', '3.4.A', '3.4.B', '3.4.C', '3.4.D'],
  minutes: 50,
  objectives: [
    'Explain what ports are, and how a scan maps a network that has no firewall.',
    'Place firewalls at the internet edge and between parts of the network to build a screened subnet (DMZ).',
    'Write an ordered rulebook, and predict how first match and the implicit deny decide each packet.',
    'Read a firewall log for signs of attack, and explain what the firewalls still let through.',
  ],
  build: buildHospital,
  map: { zones: hospitalZones },
  clock: '07:30',
  steps: [
    {
      id: 'hospital',
      title: 'Adams County Hospital',
      body: md`
        Adams County Hospital runs a web app where patients book appointments and pay bills. It lives on [[web]]. Patient records live on [[files]]. Staff work at computers like [[nurse]].

        A **server** is a computer that runs programs other computers connect to. Each program waits on a numbered **port**, like an apartment number on a building. 10.0.1.10 port 443 means "the web app on the web server."

        Click [[web]] and [[files]]. Read each one's **Open ports**. (The **Addresses** table uses "port" for the network plug, like eth0. This lab is about the numbered ports.)

        Two new firewalls have arrived: [[fwA]] and [[fwB]]. They aren't plugged in yet.
      `,
      focus: ['web', 'files'],
      goals: [
        { id: 'web', label: 'Open [[web]] and read its open ports', check: inspected('web') },
        { id: 'files', label: 'Open [[files]] and read its open ports', check: inspected('files') },
      ],
      questions: [
        {
          id: 'admin-port',
          kind: 'choice',
          prompt: 'An IT worker logs in to the web server to manage it. Which port does that connection go to?',
          options: [
            { id: '22', text: '22', correct: true },
            { id: '443', text: '443', feedback: 'Port 443 is HTTPS: the web app that patients use.' },
            { id: '445', text: '445', feedback: 'Port 445 is SMB, file sharing. It’s open on the file server, where the patient records are.' },
            { id: '80', text: '80', feedback: 'Port 80 is HTTP, web pages without encryption. Look at the web server’s Open ports for the administrator login.' },
          ],
          explain: 'SSH waits on port 22 and HTTPS on 443. Each program gets its own port, so one server can run several at once.',
        },
      ],
    },

    {
      id: 'open',
      title: 'Wide open',
      body: md`
        With no firewall, anyone on the internet can reach every computer in the hospital. You'll play [[attacker]] to see what that means.

        > Everything in this lab happens inside a simulation. Scanning or breaking into a network you don't own without permission is illegal.

        A **port scan** sends a **ping** (a short "are you there?" message) to each address in a network. It also tries common ports at each address to see which programs answer.

        1. In the **Port scanner**, scan the server network: \`${SERVER_NET}\`. The **/24** means every address from 10.0.1.1 to 10.0.1.254.
        2. Scan the staff network: \`${STAFF_NET}\`.
        3. The file server has port 445 open for file sharing. Press **Connect** next to it.

        The scan also finds routers. 10.0.1.1 belongs to the hospital's **ISP** (internet service provider), the company that connects it to the internet. 10.0.1.2 and 10.0.2.1 are both the hospital's own router: a router has an address on each network it joins. (The scanner skips addresses no computer uses. A real hospital would also hide these addresses from the internet, which this lab skips.)
      `,
      focus: ['attacker'],
      open: 'tools',
      tools: [{ kind: 'port-scan', device: 'attacker' }],
      goals: [
        {
          id: 'servers',
          label: `Scan the server network, ${SERVER_NET}`,
          hint: `Type ${SERVER_NET} in the port scanner and press **Scan**.`,
          check: ({ sim, since }) =>
            happened(sim, since, (e) => e.type === 'scan-done' && e.device === 'attacker' && scanFindings(e.scan).some((h) => h.ip === WEB && h.open.length > 0)),
        },
        {
          id: 'staff',
          label: `Scan the staff network, ${STAFF_NET}`,
          hint: `Type ${STAFF_NET} and press **Scan**.`,
          check: ({ sim, since }) =>
            happened(sim, since, (e) => e.type === 'scan-done' && e.device === 'attacker' && scanFindings(e.scan).some((h) => h.ip === FILES && h.open.includes(445))),
        },
        {
          id: 'records',
          label: 'Connect to the file server’s file sharing port',
          hint: `In the scan results, find ${FILES} and press **Connect** next to 445.`,
          check: ({ sim, since }) => connected(sim, 'attacker', since, (c) => c.to === FILES && c.port === 445),
        },
      ],
      questions: [
        {
          id: 'icmp',
          kind: 'choice',
          prompt: 'Security teams usually rate answering pings from the internet as a moderate (medium) risk, not a high one. Why?',
          options: [
            { id: 'map', text: 'It helps attackers map the network, but it doesn’t let them in.', correct: true },
            { id: 'virus', text: 'Ping packets can carry viruses, but only small ones.', feedback: 'A ping carries no program. The risk is what the reply tells the attacker: a computer is here.' },
            { id: 'harmless', text: 'It’s not really a risk, because ping only says hello.', feedback: 'Your scan used those hellos to find every computer in the hospital. That’s useful to an attacker.' },
            { id: 'encrypted', text: 'Ping is encrypted, so attackers can’t read the replies.', feedback: 'Ping isn’t encrypted. Anyone can read a reply, and the reply itself is the clue.' },
          ],
          explain: 'Attackers often ping every address first, to find where the computers are. Blocking pings from the internet makes that map harder to draw.',
        },
        {
          id: 'cia',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The attacker reached the PatientRecords folder from the internet. Which security goal does that break?',
          options: [
            { id: 'c', text: 'Confidentiality: only allowed people can see the data', correct: true },
            { id: 'i', text: 'Integrity: nobody changes the data without permission', feedback: 'Reading the records doesn’t change them, so integrity is still fine.' },
            { id: 'a', text: 'Availability: people can get the data when they need it', feedback: 'Staff can still open the records, so availability is still fine.' },
          ],
          explain: 'The attacker saw data only staff are allowed to see. Patient records are some of the most private data there is.',
        },
      ],
    },

    {
      id: 'place',
      title: 'Where do the firewalls go?',
      body: md`
        A **firewall** checks every packet that crosses it and decides, by its rules, whether to let it through. It only sees packets that cross its cable, so where you put it matters.

        The hospital's plan:

        - [[fwA]] goes at the **internet edge**, where every packet between the internet and the hospital passes.
        - [[fwB]] goes between the web server's network and the staff network.

        Use **Place firewalls** in the Toolkit to put each one into a cable. After each try, the tool says what that spot protects. Try a few.

        Each firewall has two sides. Its **outside** faces the internet. A packet arriving from outside is going **in**. A packet from the other side is going **out**.
      `,
      focus: ['fwA', 'fwB'],
      open: 'tools',
      tools: [{ kind: 'firewall-place', devices: ['fwA', 'fwB'], internet: 'inet', feedback: PLACEMENT }],
      goals: [
        {
          id: 'a',
          label: 'Put [[fwA]] where the internet meets the hospital',
          hint: 'Which cable does every packet from the internet cross? Follow the path from [[inet]] into the hospital.',
          check: ({ sim }) => aAtEdge(sim),
        },
        {
          id: 'b',
          label: 'Put [[fwB]] in front of the staff network',
          hint: 'Find a cable that every packet between [[serversw]] and [[staffsw]] crosses.',
          check: ({ sim }) => bInside(sim),
        },
      ],
      questions: [
        {
          id: 'dmz',
          kind: 'choice',
          afterGoals: true,
          prompt:
            'The web server now sits between the two firewalls, in a **screened subnet**: a small network of its own for the servers the public must reach. It’s also called a DMZ (demilitarized zone). Why not put it on the staff network, behind both?',
          options: [
            { id: 'risk', text: 'Anyone can reach it, so it’s the most exposed. Keep it apart.', correct: true },
            { id: 'speed', text: 'Each firewall slows packets down, so the server runs faster.', feedback: 'Speed isn’t the reason. Patients’ packets still cross Firewall A either way.' },
            { id: 'https', text: 'Firewall B would block HTTPS, so patients couldn’t reach it.', feedback: 'A firewall blocks what its rules say. Firewall B could allow HTTPS, but then the internet could reach the staff network.' },
            { id: 'rule', text: 'Servers and staff computers can’t share one network.', feedback: 'They can, and in many offices they do. The question is which computers you trust.' },
          ],
          explain:
            'A screened subnet holds the servers the public must reach. If one is hacked, Firewall B still stands between it and the patient records.',
        },
      ],
    },

    {
      id: 'first-rule',
      title: 'The first rule',
      body: md`
        Click [[fwA]] and read its rulebook. Rule 1 lets hospital computers start conversations going out. No rule lets anything in. Press **Patient books an appointment** and watch it stop at Firewall A.

        The firewall reads its rules from the top. The **first rule that matches** a packet decides. A packet that matches no rule is denied. That's the **implicit deny**: an unwritten last rule at the bottom of every rulebook. A list of rules like this is an **access control list** (ACL).

        Press **Add a rule** and make it: **ALLOW**, **in**, **TCP**, from **any**, to **${WEB}**, port **443**. Put 443 in the port box after "to", and leave the port after "from" as **any**. Then test all three buttons.

        Firewall A is **stateful**: it remembers each conversation it lets through, and lets that conversation's replies back.
      `,
      focus: ['fwA'],
      open: { inspect: 'fwA' },
      tools: [{ kind: 'firewall-rules', devices: ['fwA'] }],
      actions: [patientBooks, attackerSsh, attackerPing],
      goals: [
        {
          id: 'patient',
          label: '[[patient]] books an appointment',
          hint: `Add a rule on [[fwA]]: ALLOW in TCP from any to ${WEB} port 443.`,
          check: ({ sim, since }) => pageSince(sim, 'patient', since, (b) => b.status === 'loaded'),
        },
        {
          id: 'ssh',
          label: 'The attacker’s SSH is blocked (test after your last change)',
          hint: 'Press **Attacker tries SSH on the web server** after you add your rule.',
          check: ({ sim, since }) =>
            patientsAllowed(sim) && fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.pkt.dstPort === 22)),
        },
        {
          id: 'ping',
          label: 'The attacker’s ping is blocked (test after your last change)',
          hint: 'Press **Attacker pings the web server** after you add your rule.',
          check: ({ sim, since }) =>
            patientsAllowed(sim) && fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.pkt.proto === 'icmp')),
        },
      ],
      questions: [
        {
          id: 'implicit',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Why was the attacker’s ping blocked?',
          options: [
            { id: 'implicit', text: 'No rule matched it, so the implicit deny blocked it.', correct: true },
            { id: 'rule2', text: 'Your rule allows only TCP, so it denies everything else.', feedback: 'A rule decides only the packets it matches. Your rule didn’t match the ping, so the firewall kept reading.' },
            { id: 'server', text: 'The web server stopped answering pings.', feedback: 'The web server answered pings in the scan. Look where the ping stopped on the map.' },
            { id: 'icmp', text: 'Firewalls always block ping, whatever the rules say.', feedback: 'A rule can allow ping (protocol ICMP). Nothing on Firewall A allows it coming in.' },
          ],
          explain: 'Allow what you need, and let the implicit deny block the rest. You don’t need a rule for every attack.',
        },
      ],
    },

    {
      id: 'order',
      title: 'Order matters',
      body: md`
        The hospital's web server is managed by IT staff at [[clinic]]. They log in with **SSH** (port 22), and only from the clinic's network, \`198.51.100.0/24\`.

        Overnight, a coworker added two rules to [[fwA]], at the bottom:

        - DENY in TCP from any to any: block every other TCP connection coming in.
        - ALLOW in TCP from 198.51.100.0/24 to ${WEB} port 22: the clinic's SSH.

        Press **Clinic admin logs in with SSH**. It fails. The line under the buttons says which rule blocked it.

        Fix the rulebook by moving a rule with the arrows. Keep both of the coworker's rules. Then test the clinic and the attacker again.
      `,
      setup: (sim) => {
        placeBoth(sim);
        patientsIn(sim);
        coworkerRules(sim);
      },
      focus: ['fwA', 'clinic'],
      open: { inspect: 'fwA' },
      tools: [{ kind: 'firewall-rules', devices: ['fwA'] }],
      actions: [clinicSsh, attackerSsh, patientBooks],
      goals: [
        {
          id: 'clinic',
          label: '[[clinic]]’s admin logs in to the web server with SSH',
          hint: 'The first rule that matches decides. Keep the coworker’s deny rule, and move the clinic’s SSH rule above it.',
          check: ({ sim, since }) => hasRule(sim, DENY_IN_TCP) && connected(sim, 'clinic', since, (c) => c.to === WEB && c.port === 22),
        },
        {
          id: 'attacker',
          label: 'The attacker’s SSH is still blocked (test after your last change)',
          hint: 'Press **Attacker tries SSH on the web server**.',
          check: ({ sim, since }) => fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.pkt.dstPort === 22)),
        },
      ],
      questions: [
        {
          id: 'reversed',
          kind: 'choice',
          prompt:
            'A firewall has two rules. 1: DENY in TCP from any to any. 2: ALLOW in TCP from any to 10.0.1.10 port 22. An SSH connection arrives from the internet. What happens?',
          options: [
            { id: 'deny', text: 'Rule 1 denies it.', correct: true },
            { id: 'specific', text: 'Rule 2 allows it, because it’s more specific.', feedback: 'Routers pick the most specific route. Firewalls don’t: the first rule that matches wins.' },
            { id: 'allow-wins', text: 'Rule 2 allows it, because allow beats deny.', feedback: 'Neither action outranks the other. Only the order counts.' },
            { id: 'implicit', text: 'The implicit deny blocks it.', feedback: 'The implicit deny applies only when no rule matches. Rule 1 matches first.' },
          ],
          explain: 'Swap the two rules and SSH gets in. Put narrow allow rules above broad deny rules.',
        },
      ],
    },

    {
      id: 'inner',
      title: 'Firewall B',
      body: md`
        [[fwB]] starts with no rules, only the implicit deny. Staff computers can't reach the web server or the internet.

        The hospital's requirements for Firewall B:

        1. Staff computers (\`${STAFF_NET}\`) may start conversations going out, with any protocol.
        2. Nothing may start a conversation into the staff network. Not the internet, and not the web server.

        Firewall B's outside is the side toward the web server and the internet. So a packet from the nurse station crosses it going **out**. Write the rule for requirement 1. Requirement 2 needs no rule: the implicit deny covers it. Firewall B is stateful too, so replies come back in. Then test the buttons.
      `,
      setup: (sim) => placeBoth(sim),
      focus: ['fwB', 'nurse', 'files'],
      open: { inspect: 'fwB' },
      tools: [{ kind: 'firewall-rules', devices: ['fwB'] }],
      actions: [nurseWeb, nursePing, webToFiles, nurseFiles],
      goals: [
        {
          id: 'nurse',
          label: '[[nurse]] opens the web app',
          hint: `The nurse station’s packets cross Firewall B going out. On [[fwB]], add: ALLOW out, any protocol, from ${STAFF_NET} to any.`,
          check: ({ sim, since }) => connected(sim, 'nurse', since, (c) => c.to === WEB && c.port === 443),
        },
        {
          id: 'nurse-ping',
          label: '[[nurse]] pings the internet (10.0.1.1)',
          hint: 'Requirement 1 says any protocol. A ping isn’t TCP: check the protocol in your Firewall B rule.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'nurse' && e.from === ISP_ROUTER),
        },
        {
          id: 'web',
          label: 'The web server can’t reach the records (test after your last change)',
          hint: 'Press **Hacked web server reaches for the records** after you add your rule.',
          check: ({ sim, since }) =>
            sim.dev('fwB').firewall!.rules.length > 0 &&
            fwSaw(sim, afterChange(sim, since, 'fwB'), 'fwB', denied((e) => e.pkt.src === WEB && e.pkt.dstPort === 445)),
        },
      ],
      questions: [
        {
          id: 'lateral',
          kind: 'choice',
          prompt: 'The hospital owns the web server too. Why keep it away from the file server?',
          options: [
            { id: 'hacked', text: 'So a hacked web server can’t be used to reach the records.', correct: true },
            { id: 'bandwidth', text: 'Web traffic would fill the staff network and slow the nurses down.', feedback: 'The block is about trust, not traffic. The web server is the part of the hospital the internet can reach.' },
            { id: 'patients', text: 'Patients would see other patients’ records in the web app.', feedback: 'The web app shows what it was built to show. The danger is an attacker who takes over the server and goes looking.' },
          ],
          explain:
            'Moving from one hacked computer to the next is called **lateral movement**. Firewall B stops it at the edge of the staff network.',
        },
        {
          id: 'same-switch',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Press **Nurse station opens the records**. It works, and Firewall B never sees it. Why?',
          options: [
            { id: 'switch', text: 'Both are on the staff switch, so the traffic never crosses Firewall B.', correct: true },
            { id: 'rule', text: 'Your rule allows staff computers to go out.', feedback: 'Your rule is for packets that cross Firewall B. Look at the map: these packets never reached it.' },
            { id: 'port', text: 'Firewalls don’t check port 445.', feedback: 'Firewall B checked port 445 when the web server tried it, and blocked it.' },
          ],
          explain: 'A firewall only protects traffic that crosses it. To guard the file server from staff computers too, it would need a firewall in front of it, or a firewall program running on the file server itself.',
        },
      ],
    },

    {
      id: 'log',
      title: 'The firewall’s log',
      body: md`
        These firewalls write a **log**: a line for each packet they deny. Defenders read logs to spot attacks.

        Use [[attacker]]'s **Port scanner** again. Scan \`${SERVER_NET}\` and \`${STAFF_NET}\` again. In step 2 these scans found every computer, and port 445 on the file server. See what they find now. (10.0.1.1 still answers. It's the ISP's router, outside Firewall A.)

        Then open the **Logs** tab and click a DENY line from the attacker, ${ATTACKER}, in Firewall A's log. In a line's details, **src** is where the packet came from and **dst** is where it was going. **sport** and **dport** are the ports at each end. In \`${ATTACKER}:49236 -> ${FILES}:445\`, the packet came from port 49236 and was going to port 445.
      `,
      setup: (sim) => placeBoth(sim),
      focus: ['attacker', 'fwA'],
      open: 'tools',
      tools: [{ kind: 'logs', devices: ['fwA', 'fwB'] }, { kind: 'port-scan', device: 'attacker' }],
      goals: [
        {
          id: 'rescan',
          label: 'The attacker scans both networks again',
          hint: `In the port scanner, scan ${SERVER_NET}, then ${STAFF_NET}.`,
          check: ({ sim, since }) => scannedNet(sim, since, WEB) && scannedNet(sim, since, FILES),
        },
        {
          id: 'line',
          label: 'Open a DENY line from the attacker in Firewall A’s log',
          hint: `In the **Logs** tab, click a line that starts with DENY and shows ${ATTACKER}.`,
          check: openedLog((e) => e.device === 'fwA' && e.fields?.action === 'deny' && e.fields?.src === ATTACKER),
        },
      ],
      questions: [
        {
          id: 'scan-sign',
          kind: 'choice',
          prompt: 'Which pattern in a firewall log is a sign of a port scan?',
          options: [
            { id: 'many', text: 'One address denied on many ports, a moment apart.', correct: true },
            { id: 'one', text: 'One denied ping from a patient’s home address.', feedback: 'A single stray ping happens all the time. A scan is many attempts in a row.' },
            { id: 'https', text: 'Many addresses allowed in on port 443.', feedback: 'That’s patients using the web app. It’s what rule 2 is for.' },
            { id: 'daily', text: 'The nurse station opening the web app each morning.', feedback: 'That’s normal work. Defenders learn what normal looks like so the unusual stands out.' },
          ],
          explain: 'A scan shows up as one address trying port after port. It’s a warning sign that someone is looking for a way in, even when every try was blocked.',
        },
        {
          id: 'what-left',
          kind: 'choice',
          prompt: 'What could the attacker’s new scan still find?',
          options: [
            { id: '443', text: 'Port 443 on the web server, and nothing on the staff network.', correct: true },
            { id: 'nothing', text: 'Nothing at all. The firewall hides every port.', feedback: 'Patients need port 443, so your rule allows it. A scanner sees it too.' },
            { id: 'closed', text: 'Every computer, but with all their ports closed.', feedback: '"Closed" means a computer answered "nothing here." A firewall that denies a probe sends no answer at all.' },
            { id: 'same', text: 'The same results as the scan before the firewalls.', feedback: 'Compare the two scans in the port scanner. The staff network went silent.' },
          ],
          explain: 'The firewalls didn’t make the hospital invisible. They shrank what the internet can reach to the one service patients need.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Defend your design',
      body: md`
        The hospital's **board**, the group of leaders who run it, wants to know why the network is set up this way. You built it, so you explain.
      `,
      questions: [
        {
          id: 'visitors',
          kind: 'choice',
          prompt: 'The hospital adds Wi-Fi for visitors in the waiting room. It plugs into the hospital router, next to the staff network. Following the same plan, what does the visitor network need?',
          options: [
            { id: 'own', text: 'A firewall between it and the rest of the hospital.', correct: true },
            { id: 'none', text: 'Nothing new. Firewall A already guards the edge.', feedback: 'Visitors would be inside the edge. A firewall only checks traffic that crosses it, like the nurse station and file server showed.' },
            { id: 'dmz', text: 'Put visitors in the screened subnet, with the web server.', feedback: 'Then any visitor’s laptop could try the web server’s SSH port. The screened subnet holds public servers, not guests.' },
            { id: 'rule', text: 'A rule on Firewall A that denies visitors.', feedback: 'Visitor traffic to the staff network wouldn’t cross Firewall A, so its rules never see it.' },
          ],
          explain: 'Put a firewall wherever two parts of the network that need different protection meet, plus one where the network meets the internet.',
        },
        {
          id: 'justify',
          kind: 'text',
          prompt:
            'Write to the board in two parts.\n\n1. Where did you put Firewall A and Firewall B, and what does each one protect?\n2. Click Firewall A on the map and find the coworker’s two rules from step 5. Name them by number. Say what would go wrong if the deny rule were above the clinic’s rule.',
          minWords: 30,
          lines: 6,
        },
      ],
    },

    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.

        Next lab: *Firewall Types: Stateless, Stateful, and Next-Gen*, where you decide what kind of firewall A and B should be.
      `,
    },
  ],
};
