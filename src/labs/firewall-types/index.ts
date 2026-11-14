import { evaluate, MODE_NAME, type FirewallState, type FwMode } from '../../sim/firewall';
import type { Conn } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { IpPacket, SimEvent } from '../../sim/types';
import { happened, inspected, openedLog, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, ChoiceQuestion, LabDef } from '../types';
import {
  ATTACKER,
  BOOK_PATH,
  BRANCH_NET,
  BRANCH_REPLIES,
  BUDGET,
  buildHospital2,
  CLINIC,
  DESK,
  EXPLOIT_PATH,
  fakeReply,
  FILES,
  HOSPITAL_SITE,
  NO_REMOTE,
  NURSE,
  ODD_PORT,
  PORTAL_SITE,
  PRICE,
  REPLIES_IN,
  WEB,
  zones,
} from './scenario';

// ---------------------------------------------------------------------------
// Test traffic (the lesson's buttons)
// ---------------------------------------------------------------------------

const nursePortal: ActionDef = { id: 'portal', label: 'Nurse station opens the clinic portal', run: (sim) => sim.browse('nurse', `https://${PORTAL_SITE}/`) };
const attackerSsh: ActionDef = { id: 'attacker-ssh', label: 'Attacker tries SSH on the web server', run: (sim) => void sim.connectService('attacker', WEB, 22) };
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
const callHomeOdd: ActionDef = {
  id: 'malware-odd',
  label: `Remote-control program tries port ${ODD_PORT}`,
  run: (sim) => void sim.connectService('nurse', ATTACKER, ODD_PORT, { app: 'remote-control' }),
};
const deskBooks: ActionDef = { id: 'desk', label: 'Front desk opens the web app', run: (sim) => sim.browse('desk', `https://${HOSPITAL_SITE}${BOOK_PATH}`) };
const deskFake: ActionDef = {
  id: 'desk-fake',
  label: 'Attacker sends the front desk a fake reply',
  run: (sim) => fakeReply(sim, DESK),
  outcome: (sim, since) => fakeOutcome(sim, since, 'desk', 'the attacker’s own address'),
};
const deskForged: ActionDef = {
  id: 'desk-forged',
  label: 'Attacker fakes the web server’s address',
  run: (sim) => fakeReply(sim, DESK, WEB),
  outcome: (sim, since) => fakeOutcome(sim, since, 'desk', `the web server’s address, ${WEB}`),
};

/** The attacker's booking lookup, with database commands hidden in it. */
const exploit: ActionDef = {
  id: 'exploit',
  label: 'Attacker looks up a booking',
  run: (sim) => sim.browse('attacker', `https://${HOSPITAL_SITE}${EXPLOIT_PATH}`),
  outcome: (sim, since) => exploitLines(sim, since),
};

function exploitLines(sim: Sim, since: number): ActionLine[] {
  const b = sim.dev('attacker').browser;
  // Report a block as soon as the firewall decides, not when the attacker's browser gives up waiting.
  if (fwSaw(sim, since, 'fwA', denied((e) => e.pkt.src === ATTACKER && e.verdict.by === 'ips')))
    return [{ tone: 'good', text: 'Firewall A blocked the request: intrusion prevention found SQL injection inside. The attacker’s browser waits, then gives up.' }];
  if (!b || b.startedAt < since || b.status === 'resolving' || b.status === 'loading') return [{ tone: 'wait', text: 'The request is on its way…' }];
  if (b.status === 'loaded') return [{ tone: 'bad', text: `The attack worked. The web server answered with "${b.title}": names, dates of birth, and doctors.` }];
  return [{ tone: 'good', text: 'The request never reached the web server.' }];
}

/** A fake reply's fate: through to `dev`, or blocked by a firewall on the way. */
function fakeOutcome(sim: Sim, since: number, dev: string, from: string): ActionLine[] {
  const through = happened(sim, since, (e) => e.type === 'stray-reply' && e.device === dev && e.t > since);
  const blocked = [...sim.events].reverse().find((e) => e.t > since && e.type === 'firewall' && e.verdict.action === 'deny' && e.pkt.app.kind === 'svc' && e.pkt.app.conn === 0);
  const label = sim.dev(dev).label;
  if (through) return [{ tone: 'bad', text: `${label} received the fake reply from ${from}, port 443.` }];
  if (blocked && blocked.type === 'firewall') {
    const fw = sim.dev(blocked.device);
    const why = blocked.verdict.by === 'implicit' ? 'no rule matched it' : blocked.verdict.by === 'no-state' ? 'it answers no conversation in the connection table' : `rule ${blocked.verdict.ruleNo} denies it`;
    return [{ tone: 'good', text: `${fw.label} blocked the fake reply from ${from}: ${why}.` }];
  }
  return [{ tone: 'wait', text: 'The fake reply is on its way…' }];
}

// ---------------------------------------------------------------------------
// Goal checks
// ---------------------------------------------------------------------------

type FwEvent = Extract<SimEvent, { type: 'firewall' }>;

/** Test results count from the step start, or from the firewall's last change if that's later. */
const afterChange = (sim: Sim, since: number, fw: string) => Math.max(since, sim.dev(fw).firewall?.changedAt ?? 0);
/** A decision by firewall `fw` since `t` that matches. */
const fwSaw = (sim: Sim, t: number, fw: string, pred: (e: FwEvent) => boolean) => happened(sim, t, (e) => e.type === 'firewall' && e.device === fw && pred(e));
const denied = (pred: (e: FwEvent) => boolean) => (e: FwEvent) => e.verdict.action === 'deny' && pred(e);
/** A connection from `device` since `since` that finished and matches. */
const connected = (sim: Sim, device: string, since: number, pred: (c: Conn) => boolean) =>
  (sim.dev(device).conns ?? []).some((c) => c.t >= since && c.status === 'open' && pred(c));
const mode = (sim: Sim, fw: string) => sim.dev(fw).firewall!.mode;
const stray = (sim: Sim, since: number, dev: string, src: string) => happened(sim, since, (e) => e.type === 'stray-reply' && e.device === dev && e.pkt.src === src);

/** The nurse station's portal page loaded, started after Firewall A's last change. */
const portalLoaded = (sim: Sim, since: number, fw = 'fwA') =>
  pageSince(sim, 'nurse', afterChange(sim, since, fw), (b) => b.status === 'loaded' && b.host === PORTAL_SITE);
/** The front desk's web app loaded, started after `fw`'s last change. */
const deskLoaded = (sim: Sim, since: number, fw: string) => pageSince(sim, 'desk', afterChange(sim, since, fw), (b) => b.status === 'loaded' && b.host === HOSPITAL_SITE);

/** A remote-control program's request from the nurse station to the attacker on `port`, for checks that don't send anything. */
function remoteProbe(port: number): IpPacket {
  return { src: NURSE, dst: ATTACKER, ttl: 64, proto: 'tcp', srcPort: 50000, dstPort: port, app: { kind: 'svc', conn: 1, app: 'remote-control', reply: false } };
}
/** Would `fw` stop the remote-control program on a port nobody's rule names? */
const stopsRemoteAnywhere = (fw: FirewallState) => evaluate(fw, remoteProbe(5938), 'out').action === 'deny';
const remoteDenied = (port: number) => (e: FwEvent) => e.pkt.src === NURSE && e.pkt.dst === ATTACKER && e.pkt.dstPort === port;

/** The web server's reply to the front desk, for checks of the branch router's rules. */
const deskReply: IpPacket = { src: WEB, dst: DESK, ttl: 64, proto: 'tcp', srcPort: 443, dstPort: 50000, app: { kind: 'http-res', status: 200, title: '', body: '', reqId: 1, certName: null } };

const cost = (sim: Sim) => PRICE[mode(sim, 'fwA')] + PRICE[mode(sim, 'fwB')];
const money = (n: number) => `$${n.toLocaleString('en-US')}`;

// ---------------------------------------------------------------------------
// Step setups. Each puts the network in the state its step needs if the
// student skipped ahead, and leaves the student's own work alone otherwise.
// ---------------------------------------------------------------------------

/** Packets from the attacker's port 443 to the web server: a fake reply, and an SSH request. */
const from443 = (dport: number, reply: boolean): IpPacket => ({
  src: ATTACKER,
  dst: WEB,
  ttl: 64,
  proto: 'tcp',
  srcPort: 443,
  dstPort: dport,
  app: { kind: 'svc', conn: 0, app: reply ? 'https' : 'ssh', reply },
});

/** Does Firewall A still have a rule that lets SSH in from port 443 (the hole step 4 closes)? */
const replyRuleLeft = (sim: Sim) => evaluate(sim.dev('fwA').firewall!, from443(22, false), 'in').action === 'allow';

/**
 * Firewall A stateless, with a reply rule that lets in anything from port 443
 * above the deny (where step 2 ends). A student whose rule is narrower (only to
 * the staff network, say) keeps it, and gets the usual wide rule too, so the
 * fake packets in step 3 have a hole to use.
 */
function replyHole(sim: Sim): void {
  const fw = sim.dev('fwA').firewall!;
  if (fw.mode !== 'stateless') sim.fwSetMode('fwA', 'stateless');
  const open = [from443(51515, true), from443(22, false)].every((p) => evaluate(fw, p, 'in').action === 'allow');
  if (!open) {
    const deny = fw.rules.findIndex((r) => r.dir === 'in' && r.action === 'deny');
    sim.fwAddRule('fwA', REPLIES_IN, deny < 0 ? undefined : deny);
  }
}

/** Firewall A next-generation, with a rule that stops the remote-control program on any port (where step 6 ends). */
function noRemote(sim: Sim): void {
  const fw = sim.dev('fwA').firewall!;
  if (!stopsRemoteAnywhere({ ...fw, mode: 'ngfw' })) sim.fwAddRule('fwA', NO_REMOTE, 0);
}

/** The branch router lets the web app's replies in (where step 8 ends). */
function branchReplies(sim: Sim): void {
  if (evaluate(sim.dev('branch').firewall!, deskReply, 'in').action !== 'allow') sim.fwAddRule('branch', BRANCH_REPLIES);
}

// ---------------------------------------------------------------------------
// Step 9: which firewall would do that?
// ---------------------------------------------------------------------------

const TYPE_FEEDBACK = {
  overkill: (t: string) => `A ${t} firewall could do it, but so could a cheaper one. Look for the simplest type that can.`,
};

function pick(id: string, prompt: string, answer: FwMode, feedback: Partial<Record<FwMode, string>>, explain: string): ChoiceQuestion {
  const names: Record<FwMode, string> = { stateless: 'Stateless', stateful: 'Stateful', ngfw: 'Next-generation' };
  return {
    id,
    kind: 'choice',
    prompt,
    options: (['stateless', 'stateful', 'ngfw'] as FwMode[]).map((m) =>
      m === answer ? { id: m, text: names[m], correct: true } : { id: m, text: names[m], feedback: feedback[m] ?? TYPE_FEEDBACK.overkill(names[m].toLowerCase()) },
    ),
    explain,
  };
}

// ---------------------------------------------------------------------------
// Step 10: the hospital's tests
// ---------------------------------------------------------------------------

const hospitalTests: ActionDef = {
  id: 'tests',
  label: 'Run the hospital’s tests',
  run: (sim) => {
    sim.connectService('nurse', ATTACKER, ODD_PORT, { app: 'remote-control' });
    sim.browse('attacker', `https://${HOSPITAL_SITE}${EXPLOIT_PATH}`);
    sim.browse('nurse', `https://${PORTAL_SITE}/`);
    sim.browse('desk', `https://${HOSPITAL_SITE}${BOOK_PATH}`);
    sim.connectService('web', FILES, 445);
  },
  outcome: (sim, since) => testLines(sim, since),
};

interface TestResult {
  /** Firewall the test is about. */
  fw: 'fwA' | 'fwB';
  pass: boolean | undefined;
  text: string;
}

/** Results of the tests started at `since` (undefined pass: still running). */
function testResults(sim: Sim, since: number): TestResult[] {
  const conn = (dev: string, port: number) => (sim.dev(dev).conns ?? []).find((c) => c.t === since && c.port === port);
  const page = (dev: string) => {
    const b = sim.dev(dev).browser;
    if (!b || b.startedAt !== since || b.status === 'resolving' || b.status === 'loading') return undefined;
    return b.status === 'loaded';
  };
  const done = (c: Conn | undefined) => (c && c.status !== 'pending' ? c.status === 'open' : undefined);
  const not = (v: boolean | undefined) => (v === undefined ? undefined : !v);
  // A firewall's deny settles a test at once, so nobody waits for a timeout. (Only this run's
  // packets: a run lasts less than the timeout, and runs start at different times.)
  const until = since + sim.opts.httpTimeoutMs;
  const deny = (pred: (e: FwEvent) => boolean) =>
    sim.events.some((e) => e.type === 'firewall' && e.t >= since && e.t <= until && e.verdict.action === 'deny' && pred(e));
  const between = (a: string, b: string) => (e: FwEvent) => (e.pkt.src === a && e.pkt.dst === b) || (e.pkt.src === b && e.pkt.dst === a);
  const blocked = (v: boolean | undefined, pred: (e: FwEvent) => boolean) => (deny(pred) ? true : not(v));
  const reaches = (v: boolean | undefined, pred: (e: FwEvent) => boolean) => (v === undefined && deny(pred) ? false : v);
  return [
    {
      fw: 'fwA',
      pass: blocked(done(conn('nurse', ODD_PORT)), (e) => e.pkt.src === NURSE && e.pkt.dst === ATTACKER && e.pkt.dstPort === ODD_PORT),
      text: `The remote-control program on port ${ODD_PORT} is blocked`,
    },
    { fw: 'fwA', pass: blocked(page('attacker'), (e) => e.pkt.src === ATTACKER && e.pkt.dst === WEB), text: 'The attack hidden in a booking lookup is blocked' },
    { fw: 'fwA', pass: reaches(page('desk'), between(DESK, WEB)), text: 'The branch front desk opens the web app' },
    { fw: 'fwB', pass: reaches(page('nurse'), between(NURSE, CLINIC)), text: 'The nurse station opens the clinic portal' },
    { fw: 'fwB', pass: blocked(done(conn('web', 445)), (e) => e.pkt.src === WEB && e.pkt.dst === FILES && e.pkt.dstPort === 445), text: 'A hacked web server can’t reach the patient records' },
  ];
}

function testLines(sim: Sim, since: number): ActionLine[] {
  const a = mode(sim, 'fwA');
  const b = mode(sim, 'fwB');
  const total = cost(sim);
  const lines: ActionLine[] = [
    {
      tone: total <= BUDGET ? 'good' : 'bad',
      text: `Cost: Firewall A ${MODE_NAME[a].toLowerCase()} (${money(PRICE[a])}) + Firewall B ${MODE_NAME[b].toLowerCase()} (${money(PRICE[b])}) = ${money(total)}. Budget: ${money(BUDGET)}.`,
    },
  ];
  if (Math.max(sim.dev('fwA').firewall!.changedAt ?? 0, sim.dev('fwB').firewall!.changedAt ?? 0) > since) {
    lines.push({ tone: 'wait', text: 'You changed a firewall after these tests ran. Run the tests again to see the new results.' });
  }
  for (const t of testResults(sim, since)) {
    lines.push({ tone: t.pass === undefined ? 'wait' : t.pass ? 'good' : 'bad', text: `${t.pass === undefined ? 'Testing' : t.pass ? 'Pass' : 'Fail'}: ${t.text}.` });
  }
  return lines;
}

/**
 * Every test for the firewalls in `fws` passed in one run that started after
 * both firewalls last changed. (A type change counts as a change, so the
 * current types are the ones that ran, and `cost` is that run's cost.)
 */
function passed(sim: Sim, since: number, fws: ('fwA' | 'fwB')[]): boolean {
  const from = Math.max(afterChange(sim, since, 'fwA'), afterChange(sim, since, 'fwB'));
  const runs = new Set<number>();
  for (const c of sim.dev('web').conns ?? []) if (c.t >= from && c.port === 445 && c.to === FILES) runs.add(c.t);
  for (const t of runs) {
    const r = testResults(sim, t).filter((x) => fws.includes(x.fw));
    if (r.every((x) => x.pass === true)) return true;
  }
  return false;
}

export const firewallTypesLab: LabDef = {
  id: 'firewall-types',
  version: 1,
  title: 'Smarter Firewalls',
  tagline: 'Watch a stateless firewall get fooled, give it a memory, then teach it to recognize programs and attacks. Then pick the right firewall for each job at the hospital.',
  unit: 3,
  codehs: ['3.9 Guarding the Gate'],
  ced: ['3.4.A', '3.4.B', '3.4.D', '3.5.A'],
  minutes: 45,
  objectives: [
    'Explain that a firewall is software, on a box of its own or built into a router.',
    'Show what a stateless firewall checks, and how fake replies get past it.',
    'Explain how a stateful firewall’s connection table stops replies nobody asked for.',
    'Use a next-generation firewall’s program rules and intrusion prevention, and choose the right type for each job.',
  ],
  build: buildHospital2,
  map: { zones },
  clock: '08:00',
  steps: [
    {
      id: 'tour',
      title: 'Back at the hospital',
      body: md`
        A week has passed at Adams County Hospital. [[fwA]] and [[fwB]] are in place. Each one has a **rulebook**: its list of rules, written in the last lab, *Firewall Rulebook*. The hospital also opened a small **branch office**.

        The IT director has a question for you: "Which kind of firewall should each of these be? A next-generation box costs three times as much as the others." Today you test each kind and then make the call.

        Click [[fwA]], [[fwB]], and [[branch]]. Read each one's **Firewall rules** and its **Type**.

        A quick reminder: a firewall reads its rules from the top, the first rule that matches decides, and the **implicit deny** blocks anything no rule allowed.

        > Everything in this lab happens inside a simulation. Sending fake packets or attacks to a network you don't own, without permission, is illegal.
      `,
      focus: ['fwA', 'fwB', 'branch'],
      goals: [
        { id: 'a', label: 'Open [[fwA]] and read its rules', check: inspected('fwA') },
        { id: 'b', label: 'Open [[fwB]] and read its rules', check: inspected('fwB') },
        { id: 'branch', label: 'Open [[branch]] and find its firewall rules', check: inspected('branch') },
      ],
      questions: [
        {
          id: 'where',
          kind: 'choice',
          prompt: 'Firewall A is a box of its own. Where does the branch office’s firewall run?',
          options: [
            { id: 'router', text: 'As software inside the branch router', correct: true },
            { id: 'desk', text: 'On the front desk computer', feedback: 'Click the front desk computer: it has no firewall rules. Look at the router.' },
            { id: 'isp', text: 'At the internet provider', feedback: 'The internet provider’s router passes the branch’s packets along, but its rules aren’t the branch’s. Click the branch router.' },
            { id: 'none', text: 'Nowhere. The branch has no firewall.', feedback: 'Click the branch router and look for **Firewall rules**.' },
          ],
          explain:
            'A firewall is software. It can run on a box of its own, like Firewalls A and B, or inside another device, like a router. Small offices often use the one in their router.',
        },
      ],
    },

    {
      id: 'stateless',
      title: 'A firewall with no memory',
      body: md`
        Both of the hospital's firewalls are **stateful**: they remember conversations. A **stateless** firewall remembers nothing. It checks each packet by itself, using only what the packet's header says: protocol, addresses, and ports. Replies need rules too.

        Click [[fwA]]. Under **Firewall rules**, switch **Type** to **Stateless**. Then press **Nurse station opens the clinic portal**. The request goes out. Read what happens to the reply.

        The hospital's requirement: *staff must be able to open web sites on the internet.* A reply from a web site comes **from** port 443 and goes back to whatever port the browser picked. Write the rule that lets those replies in. A new rule goes to the bottom of the list, and the first rule that matches decides, so use the arrows to move yours above any rule that would deny the reply.
      `,
      focus: ['fwA', 'nurse', 'clinic'],
      open: { inspect: 'fwA' },
      tools: [{ kind: 'firewall-rules', devices: ['fwA'], modes: ['stateless', 'stateful'] }],
      actions: [nursePortal, attackerSsh],
      goals: [
        { id: 'stateless', label: '[[fwA]] is stateless', check: ({ sim }) => mode(sim, 'fwA') === 'stateless' },
        {
          id: 'portal',
          label: 'With Firewall A stateless, [[nurse]] opens the clinic portal (test after your last change)',
          hint: 'Add a rule: allow **in**, **TCP**, from any address, from port **443**, to any address and any port. A new rule goes to the bottom, below the DENY rule, so move it up with the arrows.',
          check: ({ sim, since }) => mode(sim, 'fwA') === 'stateless' && portalLoaded(sim, since),
        },
        {
          id: 'ssh',
          label: 'The attacker’s SSH is still blocked (test after your last change)',
          hint: 'Press **Attacker tries SSH on the web server**. If it gets in, your rule lets in too much: make it match only packets from port 443.',
          check: ({ sim, since }) =>
            mode(sim, 'fwA') === 'stateless' && fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.pkt.dstPort === 22)),
        },
      ],
      questions: [
        {
          id: 'why-reply',
          kind: 'choice',
          afterGoals: ['portal'],
          prompt: 'Before your rule, the nurse’s request got out but the reply was denied. Why?',
          options: [
            { id: 'each', text: 'The reply came in as a packet of its own, and no rule allowed it.', correct: true },
            { id: 'clinic', text: 'The clinic portal was down until you added the rule.', feedback: 'The portal answered. Its reply stopped at Firewall A: read the result under the button.' },
            { id: 'out', text: 'Rule 1 allows only requests out, not replies.', feedback: 'Rule 1 is an **out** rule. The reply was going **in**, so rule 1 never matched it.' },
            { id: 'b', text: 'Firewall B blocked it on the way back.', feedback: 'Firewall B is still stateful, so it let the reply through. The result under the button names the firewall that blocked it.' },
          ],
          explain: 'A stateless firewall checks each packet by itself. It doesn’t know the reply answers the nurse’s request, so the reply needs a rule of its own.',
        },
      ],
    },

    {
      id: 'fake',
      title: 'Fake replies',
      body: md`
        The usual reply rule lets in anything that comes **from port 443**, to any address. (If your rule was narrower, the lab added the usual one for this step. Look at Firewall A's rules.) But the sender writes the source port, and an attacker can write anything.

        Now you act as the [[attacker]]. Press **Attacker sends a fake reply**: a packet from port 443 that answers nothing anyone asked. Then press **Attacker tries SSH from port 443**. SSH isn't a reply at all, but it comes from port 443.

        (Real stateless firewalls can also check a TCP flag that replies carry. The attacker can set that flag too, so it doesn't stop a fake.)
      `,
      setup: replyHole,
      focus: ['attacker', 'fwA', 'web'],
      open: { inspect: 'fwA' },
      actions: [fakeReplies, sneakySsh],
      goals: [
        {
          id: 'fake',
          label: 'The fake reply reaches [[web]]',
          hint: 'Press **Attacker sends a fake reply**.',
          check: ({ sim, since }) => stray(sim, since, 'web', ATTACKER),
        },
        {
          id: 'sneak',
          label: 'The attacker’s SSH from port 443 gets in',
          hint: 'Press **Attacker tries SSH from port 443**.',
          check: ({ sim, since }) => connected(sim, 'attacker', since, (c) => c.to === WEB && c.port === 22 && c.sport === 443),
        },
      ],
      questions: [
        {
          id: 'what-checked',
          kind: 'choice',
          afterGoals: true,
          prompt: 'What did the stateless firewall check, and what couldn’t it know?',
          options: [
            { id: 'header', text: 'It checked addresses, ports, and protocol. It couldn’t know if anyone asked.', correct: true },
            { id: 'content', text: 'It checked what was inside. It couldn’t read the addresses.', feedback: 'It’s the other way around. A stateless firewall reads only the header: addresses, ports, protocol.' },
            { id: 'sender', text: 'It checked who sent each packet, and the attacker was on its trusted list.', feedback: 'No rule trusts 203.0.113.66. The packets matched your rule because they came from port 443.' },
            { id: 'nothing', text: 'It checked nothing, because stateless firewalls allow everything.', feedback: 'It checked every packet against the rules. The fake packets matched your reply rule.' },
          ],
          explain:
            'A stateless firewall filters on header information: addresses, ports, and protocol. It has no memory of what went out, so it can’t tell a real reply from a fake one.',
        },
      ],
    },

    {
      id: 'stateful',
      title: 'Give it a memory',
      body: md`
        A **stateful** firewall keeps a **connection table**: a list of the conversations it allowed out. A packet that looks like a reply (its TCP flags say it answers something) gets in only if it also matches a conversation in the table: the same addresses and ports. Your home router did the same thing in an earlier lab, *Who Gets the Packet?*: it let in only the replies to what someone inside asked for.

        1. Switch [[fwA]] back to **Stateful**.
        2. Press **Nurse station opens the clinic portal**, and find the conversation in Firewall A's **Connection table**.
        3. Press **Attacker sends a fake reply** and **Attacker tries SSH from port 443** again.

        One attack still gets in. Find the rule that lets it in and delete it. Then test it again, and check that the clinic portal still works.
      `,
      setup: replyHole,
      focus: ['fwA'],
      open: { inspect: 'fwA' },
      tools: [{ kind: 'firewall-rules', devices: ['fwA'], modes: ['stateless', 'stateful'] }],
      actions: [nursePortal, fakeReplies, sneakySsh],
      goals: [
        {
          id: 'table',
          label: 'The nurse’s conversation with the portal is in Firewall A’s connection table',
          hint: 'Switch Firewall A to **Stateful**, then press **Nurse station opens the clinic portal**.',
          check: ({ sim }) => mode(sim, 'fwA') !== 'stateless' && sim.dev('fwA').firewall!.conns.some((c) => c.src === NURSE && c.dst === CLINIC),
        },
        {
          id: 'fake',
          label: 'Firewall A blocks the fake reply',
          hint: 'With Firewall A stateful, press **Attacker sends a fake reply**.',
          check: ({ sim, since }) => fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.verdict.by === 'no-state')),
        },
        {
          id: 'sneak',
          label: 'Firewall A blocks SSH from port 443 (test after your last change)',
          hint: 'The SSH request is a new conversation, so the rules decide it. Which rule lets in anything from port 443? A stateful firewall doesn’t need it. Delete it, then test again.',
          check: ({ sim, since }) =>
            mode(sim, 'fwA') !== 'stateless' &&
            fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.pkt.dstPort === 22 && e.pkt.srcPort === 443)),
        },
        {
          id: 'portal',
          label: 'With the port 443 rule gone, [[nurse]] still opens the clinic portal (test after your last change)',
          hint: 'Delete the rule that lets in anything from port 443, then press **Nurse station opens the clinic portal**.',
          check: ({ sim, since }) => mode(sim, 'fwA') !== 'stateless' && !replyRuleLeft(sim) && portalLoaded(sim, since),
        },
      ],
      questions: [
        {
          id: 'predict',
          kind: 'choice',
          prompt:
            'Predict before you test. Firewall A is stateful, and your port 443 rule is still there. The fake reply arrives: **in**, TCP, from 203.0.113.66 port 443 to 10.0.1.10 port 51515. What happens?',
          options: [
            { id: 'no-state', text: 'Denied: it answers no conversation in the table.', correct: true },
            { id: 'rule', text: 'Allowed by your port 443 rule.', feedback: 'That’s what the stateless firewall did. A stateful firewall checks a reply against its connection table, not the rules.' },
            { id: 'deny', text: 'Denied by the DENY rule.', feedback: 'Close, but the rules never see it. Replies are checked against the connection table.' },
            { id: 'trusted', text: 'Allowed, because port 443 is web traffic.', feedback: 'A port number proves nothing. The sender picks it.' },
          ],
          explain: 'A stateful firewall checks the first packet of each conversation against the rules. Everything that looks like a reply is checked against the connection table instead.',
        },
        {
          id: 'impact',
          kind: 'choice',
          afterGoals: true,
          prompt: 'You deleted the port 443 rule. What changed?',
          options: [
            { id: 'ssh', text: 'SSH from port 443 is denied. Real replies still get in through the table.', correct: true },
            { id: 'replies', text: 'Replies from web sites are denied now, so staff can’t browse.', feedback: 'The portal still loaded. The connection table lets real replies in without a rule.' },
            { id: 'nothing', text: 'Nothing. The rule did nothing on a stateful firewall.', feedback: 'It did something: the SSH request was a new conversation, and that rule allowed it.' },
            { id: 'all', text: 'All SSH is denied now, even the clinic’s.', feedback: 'The clinic’s SSH rule is still there. Only SSH that matched the port 443 rule changed.' },
          ],
          explain:
            'Deleting the rule closed a hole without breaking anything. A stateful firewall needs fewer rules, and every rule it doesn’t need is one less way in.',
        },
      ],
    },

    {
      id: 'same-port',
      title: 'Same port, different program',
      body: md`
        A nurse opened an email attachment. It installed a **remote-control program** on [[nurse]]. The program calls the attacker's computer on port 443, so on the outside it looks like a web page.

        Press **Remote-control program calls the attacker**. Watch it cross both firewalls.
      `,
      setup: (sim) => {
        if (mode(sim, 'fwA') !== 'stateful') sim.fwSetMode('fwA', 'stateful');
      },
      focus: ['nurse', 'fwA', 'attacker'],
      open: { inspect: 'fwA' },
      actions: [callHome],
      goals: [
        {
          id: 'out',
          label: 'The remote-control program reaches [[attacker]]',
          hint: 'Press **Remote-control program calls the attacker**.',
          check: ({ sim, since }) => connected(sim, 'nurse', since, (c) => c.to === ATTACKER && c.app === 'remote-control'),
        },
      ],
      questions: [
        {
          id: 'only-443',
          kind: 'choice',
          prompt: 'Suppose rule 1 allowed only TCP to port 443 going out, instead of anything. What would happen to the remote-control program?',
          options: [
            { id: 'allowed', text: 'It still gets out: it uses port 443.', correct: true },
            { id: 'denied', text: 'It gets blocked, because it isn’t really web traffic.', feedback: 'The rule matches the port, and the program uses 443. The firewall can’t see that it isn’t web traffic.' },
            { id: 'implicit', text: 'The implicit deny blocks it.', feedback: 'The implicit deny only blocks packets no rule matched. This one matches the port 443 rule.' },
          ],
          explain: 'Attackers pick 443 because nearly every firewall lets it out. Stopping this program takes a firewall that can tell programs apart.',
        },
        {
          id: 'ports',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Firewall A saw a TCP request going out to port 443. Why couldn’t it tell this program from a web browser?',
          options: [
            { id: 'number', text: 'A port is a number the program picks. Any program can use 443.', correct: true },
            { id: 'encrypted', text: 'Port 443 is encrypted, so firewalls can’t see its port number.', feedback: 'Encryption hides what’s inside, not the header. The firewall read the port: 443.' },
            { id: 'outbound', text: 'Firewalls never check traffic going out.', feedback: 'Rule 1 is an out rule, and Firewall A checked this request against it.' },
            { id: 'stateful', text: 'Stateful firewalls only look at replies.', feedback: 'A stateful firewall checks every new request against the rules too. Rule 1 allowed this one.' },
          ],
          explain: 'A port tells a firewall which program a packet should be for. Nothing stops another program from using the same number.',
        },
      ],
    },

    {
      id: 'ngfw',
      title: 'Name the program',
      body: md`
        A **next-generation firewall** (NGFW) does everything a stateful firewall does. It also uses **deep packet inspection**: it looks inside each new conversation to see which program is talking, whatever port it uses. Its rules can name a program instead of a port.

        1. Switch [[fwA]] to **Next-generation**. Press **Remote-control program calls the attacker**. It's blocked, because the program inside doesn't match the program port 443 is known for.
        2. The attacker updates the program. Press **Remote-control program tries port ${ODD_PORT}**. The firewall doesn't expect any program on port ${ODD_PORT}, so there's nothing to compare. It gets out.

        The hospital's requirement: *no remote-control program may leave the hospital, on any port. Staff still need the clinic portal.* Write a rule that names the program. The program is leaving the hospital, so it's an **out** rule, and it has to sit above rule 1. Then test all three buttons.

        (In the simulation, each packet names its program. A real NGFW recognizes programs from patterns in their traffic, even when it's encrypted. Step 7 shows how it can look inside.)
      `,
      setup: (sim) => {
        if (mode(sim, 'fwA') === 'stateless') sim.fwSetMode('fwA', 'stateful');
      },
      focus: ['fwA', 'nurse'],
      open: { inspect: 'fwA' },
      tools: [{ kind: 'firewall-rules', devices: ['fwA'], modes: ['stateful', 'ngfw'] }],
      actions: [callHome, callHomeOdd, nursePortal],
      goals: [
        { id: 'ngfw', label: '[[fwA]] is next-generation', check: ({ sim }) => mode(sim, 'fwA') === 'ngfw' },
        {
          id: 'odd',
          label: `Firewall A blocks the program on port ${ODD_PORT}, and would on any port (test after your last change)`,
          hint: 'Add a rule: **deny**, **out**, any protocol, from any to any, any port, program **Remote-control tool**. Put it above rule 1, which allows everything out.',
          check: ({ sim, since }) =>
            mode(sim, 'fwA') === 'ngfw' && stopsRemoteAnywhere(sim.dev('fwA').firewall!) && fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied(remoteDenied(ODD_PORT))),
        },
        {
          id: 'web',
          label: 'With your rule in place, Firewall A blocks it on port 443 too (test after your last change)',
          hint: 'Press **Remote-control program calls the attacker**.',
          check: ({ sim, since }) =>
            mode(sim, 'fwA') === 'ngfw' && stopsRemoteAnywhere(sim.dev('fwA').firewall!) && fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied(remoteDenied(443))),
        },
        {
          id: 'portal',
          label: 'With your rule in place, [[nurse]] still opens the clinic portal (test after your last change)',
          hint: 'Press **Nurse station opens the clinic portal**. If it’s blocked, your rule matches web traffic too: make it name only the remote-control program.',
          check: ({ sim, since }) => mode(sim, 'fwA') === 'ngfw' && stopsRemoteAnywhere(sim.dev('fwA').firewall!) && portalLoaded(sim, since),
        },
      ],
      questions: [
        {
          id: 'port-80',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The attacker moves the program to port 80 next. What happens at Firewall A?',
          options: [
            { id: 'blocked', text: 'Blocked: your rule names the program, not a port.', correct: true },
            { id: 'allowed', text: 'Allowed: port 80 is ordinary web traffic.', feedback: 'Your rule doesn’t look at the port. It matches the remote-control program on any port.' },
            { id: 'new-rule', text: 'Blocked, but only after you add a rule for port 80.', feedback: 'You wrote the rule once, for the program. It covers every port.' },
          ],
          explain: 'Filtering by application is what sets a next-generation firewall apart. An attacker can change the port in seconds. Making the program look like a different one takes far more work.',
        },
        {
          id: 'mismatch',
          kind: 'choice',
          afterGoals: true,
          prompt: `Without your rule, the NGFW blocked the program on 443 but not on ${ODD_PORT}. Why?`,
          options: [
            { id: 'known', text: `It compares the program with the one a port is known for. ${ODD_PORT} has none.`, correct: true },
            { id: 'trusted', text: `${ODD_PORT} is on a list of trusted ports.`, feedback: `No list trusts ${ODD_PORT}. Rule 1 allows everything going out, and the NGFW had nothing to compare the program with.` },
            { id: 'hidden', text: `The program hides itself better on ${ODD_PORT}.`, feedback: 'The NGFW saw the same program both times. What changed is the port’s known program: 443 is HTTPS, and nothing is known for the other.' },
          ],
          explain: 'A program on the wrong port is an **indicator of compromise**: a clue that a computer may have been hacked. A rule that names the program doesn’t need the clue.',
        },
      ],
    },

    {
      id: 'inspect',
      title: 'Look inside',
      body: md`
        [[fwA]] has a rule that lets anyone on the internet send HTTPS to [[web]], so patients can look up their appointments. An attacker can hide an attack inside a request that this rule allows.

        1. Press **Attacker looks up a booking**.
        2. Open the **Logs** tab and click the web server's line for the attacker's request. Look at what comes after \`id=7\`.

        The extra \`' OR '1'='1\` is a command for the web app's database: "show every booking, not only number 7." Hiding database commands in a request is called **SQL injection**.

        A next-generation firewall can stop it with **intrusion prevention**. It compares what each allowed request carries with **signatures**: patterns of known attacks. A match is blocked as it arrives.

        3. Turn on **Intrusion prevention** on [[fwA]]. Send the attack again.
        4. Click Firewall A's alert line in the **Logs** tab.

        (HTTPS is encrypted. A real NGFW can read inside only because the hospital gives it the key to decrypt it.)
      `,
      setup: (sim) => {
        if (mode(sim, 'fwA') !== 'ngfw') sim.fwSetMode('fwA', 'ngfw');
        noRemote(sim);
      },
      focus: ['attacker', 'web', 'fwA'],
      open: { inspect: 'fwA' },
      tools: [
        { kind: 'firewall-rules', devices: ['fwA'], ips: true },
        { kind: 'logs', devices: ['web', 'fwA'] },
      ],
      actions: [exploit],
      goals: [
        {
          id: 'hit',
          label: 'The attack reaches the web server',
          hint: 'Press **Attacker looks up a booking** before you turn on intrusion prevention.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'http-request' && e.device === 'web' && e.frame.ip?.src === ATTACKER),
        },
        {
          id: 'evidence',
          label: 'Click the web server’s log line for the attack',
          hint: 'In the **Logs** tab, click the line from [[web]] that starts with GET and ends with the attacker’s address, 203.0.113.66.',
          check: openedLog((e) => e.device === 'web' && e.fields?.src === ATTACKER),
        },
        {
          id: 'blocked',
          label: 'Firewall A blocks the attack (test after your last change)',
          hint: 'In [[fwA]], turn on **Intrusion prevention**, then press **Attacker looks up a booking**.',
          check: ({ sim, since }) => fwSaw(sim, afterChange(sim, since, 'fwA'), 'fwA', denied((e) => e.pkt.src === ATTACKER && e.verdict.by === 'ips')),
        },
        {
          id: 'alert',
          label: 'Click Firewall A’s alert line about the attack',
          hint: 'In the **Logs** tab, click Firewall A’s line that says **ips signature**.',
          check: openedLog((e) => e.device === 'fwA' && !!e.fields?.signature),
        },
      ],
      questions: [
        {
          id: 'stateful-miss',
          kind: 'choice',
          prompt: 'A stateful firewall would have let this attack in. Why?',
          options: [
            { id: 'allowed', text: 'It’s a new request that the HTTPS rule allows. Nothing checks what it carries.', correct: true },
            { id: 'reply', text: 'It looked like a reply to the patient portal.', feedback: 'It’s a new request, not a reply. The rule for patients’ HTTPS allowed it.' },
            { id: 'port', text: 'It used a port the firewall doesn’t know.', feedback: 'It used 443, the port the firewall allows for patients.' },
          ],
          explain: 'Rules and the connection table only look at headers. To catch an attack inside allowed traffic, a firewall has to read the contents.',
        },
        {
          id: 'real-time',
          kind: 'text',
          afterGoals: true,
          prompt:
            'Explain how intrusion prevention stopped this attack while it was happening. Say what it compared the request with, what it did with the request, and what it wrote in the log.',
          minWords: 30,
          lines: 4,
        },
      ],
    },

    {
      id: 'branch',
      title: 'The router at the branch',
      body: md`
        The branch office is small: one router and [[desk]]. It has no firewall box. The firewall is software built into [[branch]].

        Many routers have a stateful firewall built in. Your home router's address sharing remembered who asked, too. This older branch router can only be **stateless**.

        Since the branch opened, the front desk can't open the hospital's web app. Press **Front desk opens the web app** and find where the reply stops.

        The requirement: *the front desk uses the hospital web app at ${WEB}. Nothing else from the internet gets in.* Write the rule on [[branch]]. Then test the attacker's fake reply too.

        (A real branch would reach the hospital's 10.0 addresses through a **VPN**, a protected tunnel across the internet, since those private addresses don't travel on the internet by themselves. The map leaves the tunnel out.)
      `,
      focus: ['branch', 'desk'],
      open: { inspect: 'branch' },
      tools: [{ kind: 'firewall-rules', devices: ['branch'] }],
      actions: [deskBooks, deskFake, deskForged],
      goals: [
        {
          id: 'desk',
          label: '[[desk]] opens the hospital web app (test after your last change)',
          hint: `On [[branch]], add a rule that allows **in** TCP replies **from port 443** of the web server, ${WEB}, to the branch network, ${BRANCH_NET}.`,
          check: ({ sim, since }) => deskLoaded(sim, since, 'branch'),
        },
        {
          id: 'fake',
          label: 'The branch router blocks the attacker’s fake reply (test after your last change)',
          hint: `Press **Attacker sends the front desk a fake reply**. If it gets through, your rule trusts any address. Make it name the web server, ${WEB}, as the source.`,
          check: ({ sim, since }) =>
            fwSaw(sim, afterChange(sim, since, 'branch'), 'branch', denied((e) => e.pkt.src === ATTACKER && e.pkt.app.kind === 'svc' && e.pkt.app.conn === 0)) &&
            evaluate(sim.dev('branch').firewall!, deskReply, 'in').action === 'allow',
        },
        {
          id: 'forged',
          label: 'Try a fake reply that claims to come from the web server',
          hint: 'Press **Attacker fakes the web server’s address**.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'firewall' && e.device === 'branch' && e.pkt.src === WEB && e.pkt.app.kind === 'svc' && e.pkt.app.conn === 0),
        },
      ],
      questions: [
        {
          id: 'forged-why',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The fake reply that claimed the web server’s address got through. Why?',
          options: [
            { id: 'header', text: 'Its header matched your rule, and a stateless firewall checks only the header.', correct: true },
            { id: 'rule', text: 'Your rule is wrong. A better rule would stop it.', feedback: 'Any rule that lets the real replies in also matches a fake one with the same header. Only a connection table tells them apart.' },
            { id: 'router', text: 'Routers can’t run firewall rules.', feedback: 'The branch router ran your rules: it blocked the fake reply from the attacker’s own address.' },
          ],
          explain: 'Naming the web server made the rule much tighter: fakes from random addresses stop. A stateless firewall still can’t catch a fake that copies a real reply’s header.',
        },
        {
          id: 'enough',
          kind: 'choice',
          afterGoals: true,
          prompt: 'When is a firewall built into a router enough?',
          options: [
            { id: 'small', text: 'At a small site with no public servers, if it can do what the site needs.', correct: true },
            {
              id: 'never',
              text: 'Never. A firewall inside a router is always weaker than a separate box.',
              feedback: 'The software decides what a firewall can do, not the box. Many routers run stateful firewalls, and some run next-generation ones.',
            },
            { id: 'always', text: 'Always. The router sees every packet, so a separate firewall is a waste.', feedback: 'The hospital needs to filter by program and stop attacks inside web requests. A small router may not have those features.' },
            { id: 'internal', text: 'Only for traffic between computers inside the branch.', feedback: 'The branch router’s rules check traffic between the branch and the internet. Traffic between two branch computers never crosses it.' },
          ],
          explain:
            'Where a firewall runs matters less than what it can do. A small office with nothing for the public may only need its router’s firewall. A hospital with a public web app needs more.',
        },
      ],
    },

    {
      id: 'which',
      title: 'Which firewall would do that?',
      body: md`
        You've seen all three types work. For each job below, pick the **simplest** type of firewall that can do it. A simpler firewall costs less and has fewer settings to get wrong.

        - **Stateless:** checks each packet's header (protocol, addresses, ports) against the rules.
        - **Stateful:** adds a connection table, so only real replies get back in.
        - **Next-generation:** adds deep packet inspection: rules that name programs, and intrusion prevention.
      `,
      questions: [
        pick(
          'block-ip',
          'Block every packet from 203.0.113.66, an address known for attacks.',
          'stateless',
          {},
          'The source address is in every packet’s header. A stateless rule can deny it.',
        ),
        pick(
          'browse',
          'Let staff browse any web site, and let in only the replies to pages they asked for.',
          'stateful',
          {
            stateless: 'A stateless firewall needs a reply rule, and a reply rule lets in any fake that comes from the right port. You saw that.',
          },
          'Knowing what was asked for takes a connection table.',
        ),
        pick(
          'game',
          'Stop a game app on staff computers, whatever port it picks.',
          'ngfw',
          {
            stateless: 'The app can pick any port, and a stateless firewall only sees ports.',
            stateful: 'A connection table tracks conversations, but it can’t tell which program is talking.',
          },
          'Of these three, only a next-generation firewall can name a program in a rule.',
        ),
        pick(
          'fake',
          'Deny a packet that claims to be a reply but answers nothing anyone sent.',
          'stateful',
          { stateless: 'A stateless firewall has no memory of what went out, so a fake reply looks real to it.' },
          'The connection table knows which conversations exist. A reply to none of them is denied.',
        ),
        pick(
          'exploit',
          'Block an attack hidden inside a web request that the rules allow.',
          'ngfw',
          {
            stateless: 'The attack is inside the request, not in its header. A stateless firewall never looks there.',
            stateful: 'The rules allow the request, and the connection table only tracks conversations. Neither looks inside.',
          },
          'Intrusion prevention reads what a request carries and blocks known attacks.',
        ),
      ],
    },

    {
      id: 'choose',
      title: 'Choose A and B',
      body: md`
        The next-generation features you tested ran on a free trial, and the trial is over. Both firewalls are back to **Stateful** until the hospital buys.

        | Type | Price |
        |---|---|
        | Stateless | ${money(PRICE.stateless)} |
        | Stateful | ${money(PRICE.stateful)} |
        | Next-generation | ${money(PRICE.ngfw)} |

        The budget for both firewalls together is **${money(BUDGET)}**.

        Choose a type for [[fwA]] and for [[fwB]]. Your rules stay the same. Then press **Run the hospital's tests**. Try cheaper types too: the tests show what each one misses. Change your choice until every test passes within the budget.
      `,
      setup: (sim) => {
        if (mode(sim, 'fwA') !== 'stateful') sim.fwSetMode('fwA', 'stateful');
        if (mode(sim, 'fwB') !== 'stateful') sim.fwSetMode('fwB', 'stateful');
        noRemote(sim);
        if (!sim.dev('fwA').firewall!.ips) sim.fwSetIps('fwA', true);
        branchReplies(sim);
      },
      focus: ['fwA', 'fwB'],
      open: { inspect: 'fwA' },
      tools: [{ kind: 'firewall-rules', devices: ['fwA', 'fwB'], modes: ['stateless', 'stateful', 'ngfw'] }],
      actions: [hospitalTests],
      goals: [
        {
          id: 'a',
          label: 'Firewall A passes its tests (test after your last change)',
          hint: 'Firewall A has to stop the remote-control program and the hidden attack. Which type can look inside?',
          check: ({ sim, since }) => passed(sim, since, ['fwA']),
        },
        {
          id: 'b',
          label: 'Firewall B passes its tests (test after your last change)',
          hint: 'Firewall B has no reply rules. Which type lets replies back in without them?',
          check: ({ sim, since }) => passed(sim, since, ['fwB']),
        },
        {
          id: 'budget',
          label: `Every test passes, and both firewalls together cost no more than ${money(BUDGET)}`,
          hint: 'Two next-generation firewalls cost more than the budget. Which firewall needs one most?',
          check: ({ sim, since }) => cost(sim) <= BUDGET && passed(sim, since, ['fwA', 'fwB']),
        },
      ],
      questions: [
        {
          id: 'justify',
          kind: 'text',
          afterGoals: true,
          prompt:
            'Write to the IT director. Which type did you choose for Firewall A and for Firewall B, and why? Name one thing Firewall A must stop that a stateful firewall can’t. Then explain why Firewall B doesn’t need to be next-generation.',
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
