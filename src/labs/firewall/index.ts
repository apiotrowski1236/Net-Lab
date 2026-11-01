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
  CLINIC,
  CLINIC_SSH,
  DENY_IN_TCP,
  fakeReply,
  FILES,
  hospitalZones,
  HOSPITAL_SITE,
  NURSE,
  PATIENT,
  PATIENTS_IN,
  PLACEMENT,
  PORTAL_SITE,
  probe,
  REPLIES_IN,
  SERVER_NET,
  STAFF_NET,
  STAFF_OUT,
  WEB,
} from './scenario';

// ---------------------------------------------------------------------------
// Test traffic (the lesson's buttons)
// ---------------------------------------------------------------------------

const patientBooks: ActionDef = { id: 'patient', label: 'Patient books an appointment', run: (sim) => sim.browse('patient', `https://${HOSPITAL_SITE}/`) };
const attackerSsh: ActionDef = { id: 'attacker-ssh', label: 'Attacker tries SSH on the web server', run: (sim) => void sim.connectService('attacker', WEB, 22) };
const attackerPing: ActionDef = { id: 'attacker-ping', label: 'Attacker pings the web server', run: (sim) => void sim.ping('attacker', WEB) };
const clinicSsh: ActionDef = { id: 'clinic-ssh', label: 'Clinic admin logs in with SSH', run: (sim) => void sim.connectService('clinic', WEB, 22) };
const nurseSsh: ActionDef = { id: 'nurse-ssh', label: 'Nurse station logs in to the web server', run: (sim) => void sim.connectService('nurse', WEB, 22) };
const webToFiles: ActionDef = {
  id: 'web-files',
  label: 'Hacked web server reaches for the records',
  run: (sim) => void sim.connectService('web', FILES, 445),
};
const nurseFiles: ActionDef = { id: 'nurse-files', label: 'Nurse station opens the records', run: (sim) => void sim.connectService('nurse', FILES, 445) };
const nursePortal: ActionDef = { id: 'portal', label: 'Nurse station opens the clinic portal', run: (sim) => sim.browse('nurse', `https://${PORTAL_SITE}/`) };
const fakeReplies: ActionDef = { id: 'fake', label: 'Attacker sends a fake reply', run: (sim) => fakeReply(sim, WEB) };
const sneakySsh: ActionDef = {
  id: 'sneak',
  label: 'Attacker tries SSH from port 443',
  run: (sim) => void sim.connectService('attacker', WEB, 22, { sport: 443 }),
};
const callHome: ActionDef = {
  id: 'malware',
  label: 'Remote-control program calls the attacker',
  run: (sim) => void sim.connectService('nurse', ATTACKER, 443, { app: 'remote-control' }),
};

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

/** Would Firewall A let a patient's HTTPS request in right now? */
const patientsAllowed = (sim: Sim) => evaluate(sim.dev('fwA').firewall!, probe(PATIENT, WEB, 443), 'in').action === 'allow';
const mode = (sim: Sim, fw: string) => sim.dev(fw).firewall!.mode;

/** The nurse station's page loaded, started after Firewall A's last change. */
const portalLoaded = (sim: Sim, since: number) =>
  pageSince(sim, 'nurse', afterChange(sim, since, 'fwA'), (b) => b.status === 'loaded' && b.host === PORTAL_SITE);

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

function staffOut(sim: Sim): void {
  if (evaluate(sim.dev('fwB').firewall!, probe(NURSE, CLINIC, 443), 'out').action !== 'allow') sim.fwAddRule('fwB', STAFF_OUT);
}

/** Step 8 starts where step 7 ends: Firewall A stateless, with a rule letting in anything from port 443. */
function replyHole(sim: Sim): void {
  const fw = sim.dev('fwA').firewall!;
  if (fw.mode !== 'stateless') sim.fwSetMode('fwA', 'stateless');
  if (!fw.rules.some((r) => r.dir === 'in' && r.action === 'allow' && r.sport === 443)) {
    const deny = fw.rules.findIndex((r) => r.dir === 'in' && r.action === 'deny');
    sim.fwAddRule('fwA', REPLIES_IN, deny < 0 ? undefined : deny);
  }
}

export const firewallLab: LabDef = {
  id: 'firewall',
  version: 1,
  title: 'Firewall Rulebook',
  tagline: 'Place two firewalls in a hospital network and write the rules that let patients in and keep attackers out.',
  unit: 3,
  codehs: ['3.10 The Rules of the Firewall', '3.12 Writing the Rulebooks'],
  ced: ['3.1.B', '3.1.C', '3.3.A', '3.4.A', '3.4.B', '3.4.C', '3.4.D'],
  minutes: 45,
  objectives: [
    'Explain what ports are, and how a scan maps a network that has no firewall.',
    'Place firewalls at the internet edge and between segments to build a screened subnet (DMZ).',
    'Write an ordered rulebook, and predict how first match and the implicit deny decide each packet.',
    'Compare stateless, stateful, and next-generation firewalls, and read a firewall log for signs of attack.',
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

        A server is a computer that runs programs other computers connect to. Each program waits on a numbered **port**, like an apartment number on a building. A connection names an address and a port: 10.0.1.10 port 443 means "the web app on the web server."

        Click [[web]] and [[files]]. Read each one's **Open ports**.

        Two new firewalls have arrived: [[fwA]] and [[fwB]]. They aren't plugged in yet.
      `,
      focus: ['web', 'files'],
      goals: [
        { id: 'web', label: 'Open [[web]] and read its open ports', check: inspected('web') },
        { id: 'files', label: 'Open [[files]] and read its open ports', check: inspected('files') },
      ],
      questions: [
        {
          id: 'which-port',
          kind: 'choice',
          prompt: 'A patient books an appointment on the hospital web app, which uses HTTPS. Which port does the patient’s browser connect to?',
          options: [
            { id: '443', text: '443', correct: true },
            { id: '22', text: '22', feedback: 'Port 22 is SSH: administrators logging in to manage the server.' },
            { id: '445', text: '445', feedback: 'Port 445 is SMB, Windows file sharing. That’s where the patient records are.' },
            { id: '80', text: '80', feedback: 'Port 80 is HTTP, without encryption. The web app uses HTTPS.' },
          ],
          explain: 'HTTPS waits on port 443. Each service gets its own port, so one server can run several at once.',
        },
      ],
    },

    {
      id: 'open',
      title: 'Wide open',
      body: md`
        With no firewall, anyone on the internet can reach every computer in the hospital. You'll play [[attacker]] to see what that means.

        > Everything in this lab happens inside a simulation. Scanning or breaking into a network you don't own without permission is illegal.

        A **port scan** pings every address in a network to find computers, then knocks on common ports at each one to see which programs answer.

        1. In the **Port scanner**, scan the server network: \`${SERVER_NET}\`.
        2. Scan the staff network: \`${STAFF_NET}\`.
        3. The file server has a port open for file sharing. Press **Connect** next to it.

        To keep things simple, the internet in this lab reaches the hospital's addresses directly. Real networks hide inside addresses behind their router (NAT), but servers patients use still face the internet.
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
          id: 'cia',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The attacker reached the PatientRecords folder from the internet. Which security goal does that break?',
          options: [
            { id: 'c', text: 'Confidentiality', correct: true },
            { id: 'i', text: 'Integrity', feedback: 'Integrity means data isn’t changed without permission. Reading the records doesn’t change them.' },
            { id: 'a', text: 'Availability', feedback: 'Availability means people who need the data can get it. Staff can still open the records.' },
          ],
          explain: 'Confidentiality means only the people allowed to see data can see it. Patient records are some of the most private data there is.',
        },
        {
          id: 'icmp',
          kind: 'choice',
          prompt: 'Security teams usually rate answering pings from the internet as a moderate risk, not a high one. Why?',
          options: [
            { id: 'map', text: 'It helps attackers map the network, but it doesn’t let them in.', correct: true },
            { id: 'virus', text: 'Ping packets can carry viruses, but only small ones.', feedback: 'A ping carries no program. The risk is what the reply tells the attacker: a computer is here.' },
            { id: 'harmless', text: 'It’s not really a risk, because ping only says hello.', feedback: 'Your scan used those hellos to find every computer in the hospital. That’s useful to an attacker.' },
            { id: 'encrypted', text: 'Ping is encrypted, so attackers can’t read the replies.', feedback: 'Ping isn’t encrypted. Anyone can read a reply, and the reply itself is the clue.' },
          ],
          explain: 'A ping sweep is often an attacker’s first step. Blocking pings from outside at the internet edge takes that map away.',
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

        Use **Place firewalls** to put each one into a cable. The tool says what each choice protects. Try a few.

        Each firewall has an **outside** port, facing the internet. A packet arriving there is going **in**. A packet from the other side is going **out**.
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
            'The web server now sits between the two firewalls, in a **screened subnet** (also called a DMZ). Why not put it on the staff network, behind both?',
          options: [
            { id: 'risk', text: 'Anyone can reach it, so it’s likely to be hacked. Keep it apart.', correct: true },
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
        A firewall's rules are an **access control list** (ACL). Each rule has a **direction** (in or out), **criteria** (protocol, source, destination, port), and an **action** (allow or deny).

        The firewall reads its rules from the top. The **first rule that matches** a packet decides, and it stops reading. A packet that matches no rule is denied. That's the **implicit deny**, the last row of every rulebook.

        Click [[fwA]] and read its rulebook. Rule 1 lets hospital computers start conversations going out. Nothing lets anything in, so patients can't book appointments.

        Press **Patient books an appointment** and watch it stop at Firewall A.

        Then press **Add a rule** and write one: allow **in**, **TCP**, from **any** to the web server's address, port **443**. Test all three buttons.
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
          prompt: 'No rule on Firewall A mentions ping. Why was the attacker’s ping blocked?',
          options: [
            { id: 'implicit', text: 'No rule matched it, so the implicit deny blocked it.', correct: true },
            { id: 'rule2', text: 'Your rule allows only TCP, so it denies everything else.', feedback: 'A rule decides only the packets it matches. Your rule didn’t match the ping, so the firewall kept reading.' },
            { id: 'server', text: 'The web server stopped answering pings.', feedback: 'The web server answered pings in the scan. Look where the ping stopped on the map.' },
            { id: 'icmp', text: 'Firewalls always block ping, whatever the rules say.', feedback: 'A rule can allow ping (protocol ICMP). Nothing on Firewall A does.' },
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

        - DENY in TCP from any to any: block every other inbound TCP connection.
        - ALLOW in TCP from 198.51.100.0/24 to ${WEB} port 22: the clinic's SSH.

        Press **Clinic admin logs in with SSH**. It fails. Read why under the buttons.

        Fix the rulebook with the arrows. Then test the clinic and the attacker again.
      `,
      setup: (sim) => {
        placeBoth(sim);
        patientsIn(sim);
        coworkerRules(sim);
      },
      focus: ['fwA', 'clinic'],
      open: { inspect: 'fwA' },
      actions: [clinicSsh, attackerSsh, patientBooks],
      goals: [
        {
          id: 'clinic',
          label: '[[clinic]]’s admin logs in to the web server with SSH',
          hint: 'The first rule that matches decides. Move the clinic’s SSH rule above the deny rule.',
          check: ({ sim, since }) => connected(sim, 'clinic', since, (c) => c.to === WEB && c.port === 22),
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
        [[fwB]] has no rules yet, only the implicit deny. Staff computers can't reach the web server or the internet.

        The hospital's requirements for Firewall B:

        1. Staff computers (\`${STAFF_NET}\`) may start conversations going out.
        2. Nothing may start a conversation into the staff network. Not the internet, and not the web server.

        Write the rule for requirement 1. Requirement 2 needs no rule: the implicit deny already covers it.

        Firewall B is **stateful**: it remembers each conversation it allowed out, and lets that conversation's replies back in.
      `,
      setup: (sim) => placeBoth(sim),
      focus: ['fwB', 'nurse', 'files'],
      open: { inspect: 'fwB' },
      tools: [{ kind: 'firewall-rules', devices: ['fwB'] }],
      actions: [nurseSsh, webToFiles, nurseFiles],
      goals: [
        {
          id: 'nurse',
          label: '[[nurse]] logs in to the web server',
          hint: `On [[fwB]], add: ALLOW out, any protocol, from ${STAFF_NET} to any.`,
          check: ({ sim, since }) => connected(sim, 'nurse', since, (c) => c.to === WEB && c.port === 22),
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
            { id: 'hacked', text: 'An attacker who takes over the web server can’t use it to reach the records.', correct: true },
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
            { id: 'rule', text: 'Your rule allows staff computers to go out.', feedback: 'Your rule would allow it, but look at the map. The packets never reached Firewall B at all.' },
            { id: 'port', text: 'Firewalls don’t check port 445.', feedback: 'Firewall B checked port 445 when the web server tried it, and blocked it.' },
          ],
          explain: 'A firewall only protects traffic that crosses it. To guard the file server from staff computers too, it would need a firewall of its own.',
        },
      ],
    },

    {
      id: 'stateless',
      title: 'A firewall with no memory',
      body: md`
        Both firewalls are stateful. A **stateless** firewall remembers nothing. It checks every packet against the rules by itself, replies too. Some routers can only filter this way.

        On [[fwA]], switch **Type** to **Stateless**. Press **Nurse station opens the clinic portal**. The request goes out, but read what happens to the reply.

        A stateless firewall needs a rule for replies. Replies from a web server come **from port 443**. Add a rule: allow **in**, **TCP**, from **any**, from port **443**, to **any**, any port. Make sure it sits above the deny rule. Test again.
      `,
      setup: (sim) => {
        placeBoth(sim);
        staffOut(sim);
      },
      focus: ['fwA', 'nurse', 'clinic'],
      open: { inspect: 'fwA' },
      tools: [{ kind: 'firewall-rules', devices: ['fwA'], modes: ['stateless', 'stateful'] }],
      actions: [nursePortal, patientBooks],
      goals: [
        {
          id: 'stateless',
          label: '[[fwA]] is stateless',
          check: ({ sim }) => mode(sim, 'fwA') === 'stateless',
        },
        {
          id: 'portal',
          label: 'With Firewall A stateless, [[nurse]] opens the clinic portal (test after your last change)',
          hint: 'Add ALLOW in TCP from any, from port 443, to any. Then move it above the DENY rule with the arrows.',
          check: ({ sim, since }) => mode(sim, 'fwA') === 'stateless' && portalLoaded(sim, since),
        },
      ],
      questions: [
        {
          id: 'why-patient',
          kind: 'choice',
          afterGoals: true,
          prompt: 'With Firewall A stateless and no reply rule, patients could still book. Only the nurse’s page broke. Why?',
          options: [
            { id: 'direction', text: 'The patient’s replies go out, and rule 1 allows that. The nurse’s come in.', correct: true },
            { id: 'outbound', text: 'Stateless firewalls check only packets coming in, never going out.', feedback: 'Rule 1 is an out rule, and the firewall checks it for every packet going out.' },
            { id: 'port', text: 'The clinic portal uses a different port than the hospital’s site.', feedback: 'Both sites use HTTPS on port 443. What differs is who starts the conversation.' },
            { id: 'b', text: 'Firewall B blocked the nurse’s reply.', feedback: 'Firewall B is still stateful. The result under the buttons names the firewall that blocked it.' },
          ],
          explain: 'A stateless firewall needs rules for both halves of every conversation. That rule for replies lets in anything that claims to come from port 443.',
        },
      ],
    },

    {
      id: 'fake',
      title: 'Fake replies',
      body: md`
        Your reply rule trusts the source port. The sender writes the source port, and an attacker can write anything.

        Press **Attacker sends a fake reply** and **Attacker tries SSH from port 443**. Both get in. The SSH connection isn't a reply at all, but it comes from port 443.

        Switch [[fwA]] back to **Stateful** and test both again. A stateful firewall keeps a **connection table** of the conversations it allowed. A reply that answers nothing in the table is denied.

        One attack still gets in. Find the rule that lets it in and delete it. Then check that the clinic portal still works.
      `,
      setup: (sim) => {
        placeBoth(sim);
        staffOut(sim);
        replyHole(sim);
      },
      focus: ['fwA', 'attacker'],
      open: { inspect: 'fwA' },
      actions: [fakeReplies, sneakySsh, nursePortal],
      goals: [
        {
          id: 'fake',
          label: 'Firewall A blocks the fake reply',
          hint: 'Switch Firewall A to **Stateful**, then press **Attacker sends a fake reply**.',
          check: ({ sim, since }) => fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.verdict.by === 'no-state')),
        },
        {
          id: 'sneak',
          label: 'Firewall A blocks SSH from port 443 (test after your last change)',
          hint: 'A stateful firewall doesn’t need the port 443 reply rule. Delete it, then test again.',
          check: ({ sim, since }) =>
            mode(sim, 'fwA') !== 'stateless' &&
            fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.pkt.dstPort === 22 && e.pkt.srcPort === 443)),
        },
        {
          id: 'portal',
          label: '[[nurse]] still opens the clinic portal (test after your last change)',
          hint: 'Press **Nurse station opens the clinic portal**.',
          check: ({ sim, since }) => mode(sim, 'fwA') !== 'stateless' && portalLoaded(sim, since),
        },
      ],
      questions: [
        {
          id: 'which-blocked',
          kind: 'choice',
          afterGoals: true,
          prompt: 'After you switched to Stateful, why did the fake reply stop while SSH from port 443 still got in, until you deleted the rule?',
          options: [
            { id: 'new', text: 'The SSH connection was a new request, and the port 443 rule allowed it.', correct: true },
            { id: 'ssh', text: 'Stateful firewalls don’t check SSH, only web traffic.', feedback: 'A stateful firewall checks every new conversation against the rules, whatever the port.' },
            { id: 'encrypted', text: 'The fake reply was encrypted, and stateful firewalls block encryption.', feedback: 'Firewalls allow encrypted traffic all the time. HTTPS is encrypted.' },
            { id: 'trusted', text: 'SSH came from a trusted address, and the fake reply didn’t.', feedback: 'Both came from 203.0.113.66, the attacker.' },
          ],
          explain: 'A stateful firewall checks the first packet of each conversation against the rules, and replies against its table. A loose rule still lets in whatever matches it.',
        },
      ],
    },

    {
      id: 'ngfw',
      title: 'Not really web traffic',
      body: md`
        A nurse opened an email attachment. It installed a **remote-control program** on [[nurse]]. It calls the attacker's computer on port 443, so its traffic looks like a web page.

        Press **Remote-control program calls the attacker**. Both firewalls let it out. Rule 1 on Firewall A allows anything going out, and even a rule allowing only port 443 out would let it through.

        A **next-generation firewall** (NGFW) is stateful and adds **deep packet inspection**: it looks inside each new conversation to see which program is talking. Many also block known attacks (intrusion prevention).

        Switch [[fwA]] to **Next-generation** and test again. Make sure the clinic portal still works.

        In the simulation, each packet names the program that sent it. A real NGFW recognizes programs from patterns in their traffic.
      `,
      setup: (sim) => {
        placeBoth(sim);
        staffOut(sim);
        if (mode(sim, 'fwA') === 'stateless') sim.fwSetMode('fwA', 'stateful');
      },
      focus: ['nurse', 'fwA', 'attacker'],
      open: { inspect: 'fwA' },
      tools: [{ kind: 'firewall-rules', devices: ['fwA'], modes: ['stateless', 'stateful', 'ngfw'] }],
      actions: [callHome, nursePortal],
      goals: [
        {
          id: 'blocked',
          label: 'Firewall A blocks the remote-control program',
          hint: 'Switch Firewall A to **Next-generation**, then press **Remote-control program calls the attacker**.',
          check: ({ sim, since }) => fwSaw(sim, since, 'fwA', denied((e) => e.pkt.src === NURSE && e.pkt.dst === ATTACKER && e.verdict.by === 'app')),
        },
        {
          id: 'portal',
          label: 'With Firewall A next-generation, [[nurse]] opens the clinic portal',
          hint: 'Press **Nurse station opens the clinic portal**.',
          check: ({ sim, since }) => mode(sim, 'fwA') === 'ngfw' && portalLoaded(sim, since),
        },
      ],
      questions: [
        {
          id: 'giveaway',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The remote-control program used port 443, like every web page. What gave it away?',
          options: [
            { id: 'mismatch', text: 'The program inside didn’t match the port.', correct: true },
            { id: 'port', text: 'It used an unusual port.', feedback: 'Port 443 is one of the most common ports there is. That’s why attackers pick it.' },
            { id: 'inside', text: 'It came from outside the hospital.', feedback: 'It started on the nurse station, inside, and went out.' },
            { id: 'size', text: 'Its packets were too big for web traffic.', feedback: 'Look at the result under the buttons: the firewall names the program, not the size.' },
          ],
          explain: 'A program that doesn’t match its port is an **indicator of compromise**: a sign a computer may be infected. The nurse station needs cleaning up.',
        },
      ],
    },

    {
      id: 'log',
      title: 'The firewall’s log',
      body: md`
        Firewalls write a **log**: a line for each packet they deny. Defenders read logs to spot attacks.

        Play [[attacker]] one more time. Scan \`${SERVER_NET}\` and \`${STAFF_NET}\` again, and compare with the scans from the start of the lab.

        Then open the **Logs** tab and click a DENY line from the attacker, ${ATTACKER}, in Firewall A's log.
      `,
      setup: (sim) => placeBoth(sim),
      focus: ['attacker', 'fwA'],
      open: 'logs',
      tools: [{ kind: 'logs', devices: ['fwA', 'fwB'] }],
      goals: [
        {
          id: 'rescan',
          label: 'The attacker scans the hospital again',
          hint: `In the port scanner, scan ${SERVER_NET}.`,
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'scan-done' && e.device === 'attacker'),
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
            { id: 'daily', text: 'The nurse station opening the portal each morning.', feedback: 'That’s normal work. Defenders learn what normal looks like so the unusual stands out.' },
          ],
          explain: 'Unauthorized scans, known bad addresses, and a program that doesn’t match its port are all indicators of compromise a log can show.',
        },
        {
          id: 'what-left',
          kind: 'choice',
          afterGoals: true,
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
        The hospital's board wants to know why the network is set up this way. You built it, so you explain.
      `,
      questions: [
        {
          id: 'visitors',
          kind: 'choice',
          prompt: 'The hospital adds Wi-Fi for visitors in the waiting room. Following the same plan, what does the visitor network need?',
          options: [
            { id: 'own', text: 'A firewall between it and the rest of the hospital.', correct: true },
            { id: 'none', text: 'Nothing new. Firewall A already guards the edge.', feedback: 'Visitors would be inside the edge. A firewall only checks traffic that crosses it, like the nurse station and file server showed.' },
            { id: 'dmz', text: 'Put visitors in the screened subnet, with the web server.', feedback: 'Then any visitor’s laptop could try the web server’s SSH port. The screened subnet holds public servers, not guests.' },
            { id: 'rule', text: 'A rule on Firewall A that denies visitors.', feedback: 'Visitor traffic to the staff network wouldn’t cross Firewall A, so its rules never see it.' },
          ],
          explain: 'Give every segment its own firewall, plus one at each place the network meets the internet.',
        },
        {
          id: 'justify',
          kind: 'text',
          prompt:
            'Explain to the board where you put Firewall A and Firewall B, and what each one protects. Then explain the order of Firewall A’s rules: name two rules by number, and say what would go wrong if they were swapped.',
          minWords: 40,
          lines: 6,
        },
      ],
    },

    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary on the right. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
  ],
};
