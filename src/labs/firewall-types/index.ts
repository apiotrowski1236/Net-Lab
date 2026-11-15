import { evaluate, MODE_NAME, verdictText, type FirewallState, type FwMode } from '../../sim/firewall';
import type { Conn } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { IpPacket, SimEvent } from '../../sim/types';
import { happened, inspected, openedLog, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, ChoiceQuestion, LabDef } from '../types';
import {
  ATTACKER,
  BOOK_PATH,
  BRANCH_LAB_NOTE,
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
  PATIENTS_IN,
  PORTAL_SITE,
  PRICE,
  REPLIES_IN,
  WEB,
  zones,
} from './scenario';

// ---------------------------------------------------------------------------
// Test traffic (the lesson's buttons)
// ---------------------------------------------------------------------------

const nursePortal: ActionDef = {
  id: 'portal',
  label: 'Nurse station opens the clinic portal',
  run: (sim) => sim.browse('nurse', `https://${PORTAL_SITE}/`),
  outcome: (sim, since) => pageOutcome(sim, since, 'nurse', CLINIC, 'the clinic portal'),
};
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
const deskBooks: ActionDef = {
  id: 'desk',
  label: 'Front desk opens the web app',
  run: (sim) => sim.browse('desk', `https://${HOSPITAL_SITE}${BOOK_PATH}`),
  outcome: (sim, since) => pageOutcome(sim, since, 'desk', WEB, 'the web app'),
};
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

/**
 * A page load's fate, settled as soon as a firewall denies the request or its
 * reply (the browser itself would wait for its timeout).
 */
function pageOutcome(sim: Sim, since: number, dev: string, server: string, what: string): ActionLine[] {
  const label = sim.dev(dev).label;
  const b = sim.dev(dev).browser;
  const block = [...sim.events]
    .reverse()
    .find(
      (e): e is FwEvent =>
        e.type === 'firewall' && e.t >= since && e.verdict.action === 'deny' && ((e.pkt.src === sim.dev(dev).ifaces[0].ip && e.pkt.dst === server) || (e.pkt.src === server && e.pkt.dst === sim.dev(dev).ifaces[0].ip)),
    );
  if (b && b.startedAt >= since && b.status === 'loaded') return [{ tone: 'good', text: `${label} opened ${what}.` }];
  if (block) {
    const fw = sim.dev(block.device);
    const which = block.pkt.src === server ? 'the reply' : 'the request';
    return [{ tone: 'bad', text: `${fw.label} blocked ${which}. ${verdictText(block.verdict, fw.firewall?.rules)}. The browser waits, then gives up.` }];
  }
  if (!b || b.startedAt < since || b.status === 'resolving' || b.status === 'loading') return [{ tone: 'wait', text: `${label} is opening ${what}…` }];
  return [{ tone: 'bad', text: `${label} couldn’t open ${what}.` }];
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

/** A server no lab device uses and no network on the map contains, for "any server" checks. */
const ELSEWHERE = '198.18.0.77';
/** A remote-control program's request from the nurse station to `dst` on `port`, for checks that don't send anything. */
function remoteProbe(port: number, dst = ATTACKER): IpPacket {
  return { src: NURSE, dst, ttl: 64, proto: 'tcp', srcPort: 50000, dstPort: port, app: { kind: 'svc', conn: 1, app: 'remote-control', reply: false } };
}
/**
 * Would `fw` stop the remote-control program on a port and a server nobody's
 * rule names, with a rule that names the program? (An address or port rule
 * doesn't count: the step asks for a rule that names the program.)
 */
function stopsRemoteAnywhere(fw: FirewallState): boolean {
  const v = evaluate(fw, remoteProbe(5938, ELSEWHERE), 'out');
  return v.action === 'deny' && v.by === 'rule' && fw.rules.find((r) => r.id === v.ruleId)?.app === 'remote-control';
}
/** The attacker's booking lookup with the attack inside, sent from `src`. */
function attackProbe(src: string): IpPacket {
  return { src, dst: WEB, ttl: 64, proto: 'tcp', srcPort: 50000, dstPort: 443, encrypted: true, app: { kind: 'http-req', method: 'GET', host: HOSPITAL_SITE, path: EXPLOIT_PATH, reqId: 1 } };
}
/** Would `fw` stop the booking attack from an address nobody's rule names, by what's inside it? (Intrusion prevention, not an address or port rule.) */
function stopsAttackAnywhere(fw: FirewallState): boolean {
  const v = evaluate(fw, attackProbe(ELSEWHERE), 'in');
  return v.action === 'deny' && v.by === 'ips';
}
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

/** Does Firewall A still have a rule that lets SSH in from port 443, to the web server or the staff network (the holes step 4 closes)? */
const replyRuleLeft = (sim: Sim) => [WEB, NURSE].some((dst) => evaluate(sim.dev('fwA').firewall!, { ...from443(22, false), dst }, 'in').action === 'allow');

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
    sim.fwAddRule('fwA', { ...REPLIES_IN, note: 'Added by the lab for step 3: the usual reply rule' }, deny < 0 ? undefined : deny);
  }
}

/** Firewall A next-generation, with a rule that stops the remote-control program on any port (where step 6 ends). */
function noRemote(sim: Sim): void {
  const fw = sim.dev('fwA').firewall!;
  if (!stopsRemoteAnywhere({ ...fw, mode: 'ngfw' })) sim.fwAddRule('fwA', NO_REMOTE, 0);
}

/** A patient's HTTPS request from the internet to the web server. */
const patientVisit: IpPacket = {
  src: ELSEWHERE,
  dst: WEB,
  ttl: 64,
  proto: 'tcp',
  srcPort: 50000,
  dstPort: 443,
  app: { kind: 'svc', conn: 1, app: 'https', reply: false },
};
/** Can patients on the internet still reach the web server? (Step 4 asks students to delete rules, and the patients' rule must stay.) */
const patientsIn = (sim: Sim) => evaluate(sim.dev('fwA').firewall!, patientVisit, 'in').action === 'allow';

/** Firewall A lets patients reach the web server again, if a student deleted that rule (step 7 needs it). Goes above the first inbound deny. */
function patientsRule(sim: Sim): void {
  if (patientsIn(sim)) return;
  const fw = sim.dev('fwA').firewall!;
  const deny = fw.rules.findIndex((r) => r.dir === 'in' && r.action === 'deny');
  sim.fwAddRule('fwA', { ...PATIENTS_IN, note: 'Put back by the lab: patients reach the web server' }, deny < 0 ? undefined : deny);
}

/** The branch router lets the web app's replies in, so the hospital's tests can reach the front desk. */
function branchReplies(sim: Sim): void {
  if (evaluate(sim.dev('branch').firewall!, deskReply, 'in').action !== 'allow') sim.fwAddRule('branch', { ...BRANCH_REPLIES, note: BRANCH_LAB_NOTE });
}

/** The optional branch step starts where the branch began: the rule the lab added for the tests comes out. */
function branchFresh(sim: Sim): void {
  for (const r of [...sim.dev('branch').firewall!.rules]) if (r.note === BRANCH_LAB_NOTE) sim.fwDeleteRule('branch', r.id);
}

// ---------------------------------------------------------------------------
// Step 8: which firewall would do that?
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
// Step 9: the hospital’s tests
// ---------------------------------------------------------------------------

const hospitalTests: ActionDef = {
  id: 'tests',
  label: 'Run the hospital’s tests',
  run: (sim) => {
    noteAnywhere(sim);
    sim.connectService('nurse', ATTACKER, ODD_PORT, { app: 'remote-control' });
    sim.browse('attacker', `https://${HOSPITAL_SITE}${EXPLOIT_PATH}`);
    sim.browse('nurse', `https://${PORTAL_SITE}/`);
    sim.browse('desk', `https://${HOSPITAL_SITE}${BOOK_PATH}`);
    // From port 443, like a reply: a reply rule on a stateless Firewall B would let this in.
    sim.connectService('web', FILES, 445, { sport: 443 });
    // A fake reply that claims the clinic portal's address: even a reply rule
    // limited to the clinic lets it through a stateless Firewall B.
    sim.sendPacket('web', clinicFake);
  },
  outcome: (sim, since) => testLines(sim, since),
};

/**
 * Would Firewall A stop the remote-control program and the booking attack
 * from anywhere, as it stood when each run of the tests started? Blocking only
 * this run's address or port doesn't pass: the attacker can move. (Read at the
 * run's start, so a later change can't rewrite an old run's results.)
 */
const anywhere = new WeakMap<Sim, Map<number, { remote: boolean; attack: boolean }>>();
function noteAnywhere(sim: Sim): void {
  const fw = sim.dev('fwA').firewall!;
  const runs = anywhere.get(sim) ?? new Map();
  runs.set(sim.t, { remote: stopsRemoteAnywhere(fw), attack: stopsAttackAnywhere(fw) });
  anywhere.set(sim, runs);
}
function anywhereAt(sim: Sim, t: number): { remote: boolean; attack: boolean } {
  const fw = sim.dev('fwA').firewall!;
  return anywhere.get(sim)?.get(t) ?? { remote: stopsRemoteAnywhere(fw), attack: stopsAttackAnywhere(fw) };
}

/** Step 9: a hacked web server's fake reply to the nurse station, claiming to come from the clinic portal. */
const clinicFake: Omit<IpPacket, 'ttl'> = {
  src: CLINIC,
  dst: NURSE,
  proto: 'tcp',
  srcPort: 443,
  dstPort: 51515,
  app: { kind: 'svc', conn: 0, app: 'https', reply: true, text: 'fake reply' },
};

interface TestResult {
  /** Firewall the test is about. */
  fw: 'fwA' | 'fwB';
  pass: boolean | undefined;
  /** What should happen. */
  text: string;
  /** What happened instead, when it fails. */
  fail: string;
  /** The device that made it fail, when that's not `fw` (shown on the line instead of `fw`). */
  blame?: Blame;
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
  const isClinicFake = (e: FwEvent) => e.pkt.src === CLINIC && e.pkt.dst === NURSE && e.pkt.app.kind === 'svc' && e.pkt.app.conn === 0;
  const fakeArrived = sim.events.some((e) => e.type === 'stray-reply' && e.device === 'nurse' && e.pkt.src === CLINIC && e.t >= since && e.t <= until);
  const decided = (fw: string, pred: (e: FwEvent) => boolean) =>
    sim.events.find((e): e is FwEvent => e.type === 'firewall' && e.device === fw && e.t >= since && e.t <= until && pred(e))?.verdict.action;
  // Firewall A's own decision on the program's request. (A stateless Firewall B
  // drops the attacker's reply too, but that's no pass for Firewall A.)
  const remoteAtA = decided('fwA', (e) => e.pkt.src === NURSE && e.pkt.dst === ATTACKER && e.pkt.dstPort === ODD_PORT);
  // The portal's packets, blocked at Firewall A (a stateless A drops the reply before Firewall B sees it).
  const nurseClinic = (e: FwEvent) => between(NURSE, CLINIC)(e) && !isClinicFake(e);
  const portalAtA = decided('fwA', denied(nurseClinic)) === 'deny';
  // A block that only works on this run's address or port isn't a pass.
  const far = anywhereAt(sim, since);
  const remoteStopped = remoteAtA ? remoteAtA === 'deny' : not(done(conn('nurse', ODD_PORT)));
  const attackStopped = blocked(page('attacker'), (e) => e.pkt.src === ATTACKER && e.pkt.dst === WEB);
  // The optional branch step takes out the branch router's rule for these tests: that's no fault of Firewall A's.
  const deskAtBranch = deny((e) => e.device === 'branch' && between(DESK, WEB)(e));
  return [
    {
      fw: 'fwA',
      pass: remoteStopped && !far.remote ? false : remoteStopped,
      text: `The remote-control program on port ${ODD_PORT} is blocked`,
      fail: remoteStopped
        ? remoteAtA === 'deny'
          ? 'Firewall A blocked the remote-control program by its header (address or port), not by naming the program. The program can switch to a new address or port, so Firewall A has to block the program itself'
          : 'The remote-control program was stopped before it reached Firewall A, so this test can’t check Firewall A. Firewall A has to block the program itself, whatever address or port it uses'
        : `Firewall A let the remote-control program out on port ${ODD_PORT}. It should be blocked there`,
    },
    {
      fw: 'fwA',
      pass: attackStopped && !far.attack ? false : attackStopped,
      text: 'The attack hidden in a booking lookup is blocked',
      fail: attackStopped
        ? 'Firewall A blocked the booking lookup by its header (address or port), not by the attack inside it. The attacker can switch to a new address, so Firewall A has to spot the attack itself'
        : 'The attack hidden in a booking lookup reached the web server. It should be blocked',
    },
    {
      fw: 'fwA',
      pass: reaches(page('desk'), between(DESK, WEB)),
      text: 'The branch front desk opens the web app',
      ...(deskAtBranch
        ? {
            blame: 'branch' as const,
            fail: 'The branch front desk couldn’t open the web app. The branch router blocked its traffic, so this test can’t check Firewall A. To fix the branch router, check its rules in the optional step at the end of the lab',
          }
        : { fail: 'The branch front desk couldn’t open the web app' }),
    },
    {
      fw: 'fwB',
      // Not the fake reply that claims the clinic's address: its deny is the next test's pass.
      pass: reaches(page('nurse'), nurseClinic),
      text: 'The nurse station opens the clinic portal',
      ...(portalAtA
        ? { blame: 'fwA' as const, fail: 'The nurse station couldn’t open the clinic portal. Firewall A blocked the reply, so this test can’t check Firewall B yet' }
        : { fail: 'The nurse station couldn’t open the clinic portal. Firewall B blocked the reply' }),
    },
    {
      fw: 'fwB',
      pass: blocked(done(conn('web', 445)), (e) => e.pkt.src === WEB && e.pkt.dst === FILES && e.pkt.dstPort === 445),
      text: 'A hacked web server can’t reach the patient records, even from port 443',
      fail: 'A hacked web server reached the patient records from port 443. It should be blocked',
    },
    {
      fw: 'fwB',
      pass: deny(isClinicFake) ? true : fakeArrived ? false : undefined,
      text: 'A fake reply that claims to come from the clinic portal can’t reach the nurse station',
      fail: 'A hacked web server sent the nurse station a fake reply that claimed to come from the clinic portal, and it got in. It should be blocked',
    },
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
  const results = testResults(sim, since);
  for (const t of results) {
    const fw = FW_NAME[t.pass === false ? (t.blame ?? t.fw) : t.fw];
    lines.push({ tone: t.pass === undefined ? 'wait' : t.pass ? 'good' : 'bad', text: t.pass === false ? `Fail (${fw}): ${t.fail}.` : `${t.pass ? 'Pass' : 'Testing'} (${fw}): ${t.text}.` });
  }
  notePasses(sim, since, results);
  // The goals stay checked once a run passes, so say when a later try is worse.
  const earlier = (key: PassKey) => (goodRuns.get(sim)?.[key] ?? []).some((t) => t < since);
  const worse = (['fwA', 'fwB'] as const).filter((fw) => earlier(fw) && results.some((t) => t.pass === false && (t.blame ?? t.fw) === fw));
  // A fail the branch router caused isn't the firewalls' types.
  const typesFail = results.some((t) => t.pass === false && t.blame !== 'branch');
  for (const fw of worse) {
    lines.push({ tone: 'bad', text: `An earlier run passed all of ${FW_NAME[fw]}’s tests. Before you continue, set ${FW_NAME[fw]} back to a type that passed them.` });
  }
  const finished = results.every((t) => t.pass !== undefined);
  if (!worse.length && earlier('all') && finished && (typesFail || total > BUDGET)) {
    lines.push({ tone: 'bad', text: 'An earlier run passed every test within the budget. Before you continue, set the firewalls back to types that did.' });
  }
  return lines;
}

const FW_NAME = { fwA: 'Firewall A', fwB: 'Firewall B', branch: 'Branch router' } as const;
type Blame = keyof typeof FW_NAME;

/**
 * Start times of runs that passed all of one firewall's tests, or every test
 * within the budget ('all'). A run's results can't be read again once a later
 * run reuses the browsers, so they're noted when seen: by the goal checks
 * (which run on every event, in replays too) and by the result lines. A run
 * noted here started after both firewalls last changed, so its types and cost
 * are the ones in effect when it was seen.
 */
type PassKey = 'fwA' | 'fwB' | 'all';
const goodRuns = new WeakMap<Sim, Partial<Record<PassKey, number[]>>>();
function notePasses(sim: Sim, t: number, results: TestResult[]): void {
  if (t < Math.max(sim.dev('fwA').firewall!.changedAt ?? 0, sim.dev('fwB').firewall!.changedAt ?? 0)) return;
  const runs = goodRuns.get(sim) ?? {};
  const note = (key: PassKey, ok: boolean) => {
    if (ok && !(runs[key] ?? []).includes(t)) runs[key] = [...(runs[key] ?? []), t];
  };
  note('fwA', results.filter((x) => x.fw === 'fwA').every((x) => x.pass === true));
  note('fwB', results.filter((x) => x.fw === 'fwB').every((x) => x.pass === true));
  note('all', results.every((x) => x.pass === true) && cost(sim) <= BUDGET);
  goodRuns.set(sim, runs);
}

/** When each run of the hospital's tests started (every run makes one web server connection to the file server). */
const runStarts = (sim: Sim) => [...new Set((sim.dev('web').conns ?? []).filter((c) => c.port === 445 && c.to === FILES).map((c) => c.t))];

/** Every test for the firewalls in `fws` passed in one run that started after both firewalls last changed. */
function passed(sim: Sim, since: number, fws: ('fwA' | 'fwB')[]): boolean {
  const from = Math.max(afterChange(sim, since, 'fwA'), afterChange(sim, since, 'fwB'));
  for (const t of runStarts(sim).filter((t) => t >= from)) {
    const all = testResults(sim, t);
    notePasses(sim, t, all);
    if (all.filter((x) => fws.includes(x.fw)).every((x) => x.pass === true)) return true;
  }
  return false;
}

export const firewallTypesLab: LabDef = {
  id: 'firewall-types',
  version: 2,
  title: 'Firewall Types: Stateless, Stateful, and Next-Gen',
  tagline: "Fool a stateless firewall with fake replies, add a connection table, block programs by name and attacks by what's inside the packets, then choose a firewall type for each job at the hospital.",
  unit: 3,
  codehs: ['3.9 Guarding the Gate'],
  ced: ['3.4.A', '3.4.B', '3.4.D', '3.5.A'],
  minutes: 50,
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
        A week has passed at Adams County Hospital. [[fwA]] and [[fwB]] are in place. Each one has a **rulebook**: its list of rules, written in the last lab, *Firewall Rules and Placement*. The hospital also opened a small **branch office**.

        The IT director has a question for you: "Which kind of firewall should each of these be? A next-generation box costs three times as much as the others." Today you test each kind and then make the call.

        Click [[fwA]], [[fwB]], and [[branch]]. In each one, scroll to **Firewall rules** and read its **Type**.

        A reminder: a firewall reads its rules from the top, the first rule that matches decides, and the **implicit deny** blocks anything no rule allowed.

        > Everything in this lab happens inside a simulation. Sending fake packets or attacks to a network you don't own, without permission, is illegal.
      `,
      focus: ['fwA', 'fwB', 'branch'],
      goals: [
        { id: 'a', label: 'Open [[fwA]] and read its rules', check: inspected('fwA') },
        { id: 'b', label: 'Open [[fwB]] and read its rules', check: inspected('fwB') },
        { id: 'branch', label: 'Open [[branch]] and read its firewall rules', check: inspected('branch') },
      ],
      questions: [
        {
          id: 'where',
          kind: 'choice',
          prompt: 'Firewall A is a box of its own. Where does the branch office’s firewall run?',
          options: [
            { id: 'router', text: 'As software inside the branch router', correct: true },
            { id: 'desk', text: 'On the front desk computer at the branch', feedback: 'Click the front desk computer: it has no firewall rules. Look at the router.' },
            { id: 'isp', text: 'At the internet provider, before packets reach the branch', feedback: 'The internet provider’s router passes the branch’s packets along, but its rules aren’t the branch’s. Click the branch router.' },
            { id: 'none', text: 'Nowhere. The branch has no firewall.', feedback: 'Click the branch router and look for **Firewall rules**.' },
          ],
          explain:
            'A firewall is mostly software. It can run on a box of its own, like Firewalls A and B (some boxes add special chips for speed), or inside another device, like a router. Small offices often use the one in their router.',
        },
      ],
    },

    {
      id: 'stateless',
      title: 'A firewall with no memory',
      body: md`
        Both of the hospital's firewalls are **stateful**: they remember conversations. A **stateless** firewall remembers nothing. It checks each packet by itself, using only the packet's **header**: the protocol, addresses, and ports written on the outside of the packet.

        1. Click [[fwA]]. Under **Firewall rules**, switch **Type** to **Stateless**.
        2. Press **Nurse station opens the clinic portal**. The request goes out. Read what happens to the reply.
        3. The hospital's requirement: *staff must be able to open web sites.* A reply from a web site comes **from** port 443. Add a rule that lets those replies in. Put 443 in the port box on the **from** line, not the **to** line.
        4. A new rule goes to the bottom, below the DENY rule. Use the arrows to move it above the DENY rule. Then test again.
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
            { id: 'each', text: 'The reply was a separate packet, and no rule allowed it.', correct: true },
            { id: 'clinic', text: 'The clinic portal was down and didn’t answer until you added the rule.', feedback: 'The portal answered. Its reply stopped at Firewall A: read the result under the button.' },
            {
              id: 'blocks',
              text: 'Rule 1 denies any packet that answers a request, so it stopped the reply.',
              feedback: 'Not quite. Rule 1 allows everything going **out**, and it never checks whether a packet is a reply. The reply was going **in**, and no **in** rule allowed it.',
            },
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
        The usual reply rule lets in anything that comes **from port 443**, to any address. (If your rule was narrower, the lab added the usual one for this step.) But the sender writes the source port, and an attacker can write anything.

        Now you act as the [[attacker]]. Press **Attacker sends a fake reply**: a packet from port 443 that answers nothing anyone asked. Then press **Attacker tries SSH from port 443**. SSH isn't a reply at all, but it comes from port 443.

        (Some stateless firewalls also check a TCP **flag**: a marker in the header that says whether a packet starts a new connection. A new connection has to say it's new, so a flag check would stop this SSH. Firewall A doesn't check flags, so the SSH gets in here. A flag check still wouldn't stop the fake reply: the attacker can mark it as a reply.)
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
            {
              id: 'table',
              text: 'It checked its connection table, and the fake matched an old conversation.',
              feedback: 'A stateless firewall has no connection table. The fake packets matched your reply rule because they came from port 443.',
            },
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
        A **stateful** firewall keeps a **connection table**: a list of the conversations it has allowed. A packet that looks like a reply gets in only if it matches a conversation in the table: the same addresses and ports. (A home router does this too.)

        1. Switch [[fwA]] back to **Stateful**.
        2. Press **Nurse station opens the clinic portal**, and find the conversation in Firewall A's **Connection table**.
        3. Press **Attacker sends a fake reply** and **Attacker tries SSH from port 443** again.

        One attack still gets in. Delete every rule that lets in packets **from** port 443: its **Source** column says "from port 443". Keep the rule that lets patients reach the web server: its **To port** is 443. Then test again, and check that the clinic portal still works.
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
          label: 'With the "from port 443" rules gone and the patients’ rule kept, [[nurse]] still opens the clinic portal (test after your last change)',
          hint: `Delete every rule whose **Source** says "from port 443", then press **Nurse station opens the clinic portal**. If you deleted the rule that lets patients reach the web server, add it back: allow **in**, **TCP**, from any address to ${WEB}, port **443**.`,
          check: ({ sim, since }) => mode(sim, 'fwA') !== 'stateless' && !replyRuleLeft(sim) && patientsIn(sim) && portalLoaded(sim, since),
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
          prompt: 'You deleted the "from port 443" rule. What changed?',
          options: [
            { id: 'ssh', text: 'SSH from port 443 is denied, and real replies still get in.', correct: true },
            { id: 'replies', text: 'Replies from web sites are denied now, so staff can’t browse.', feedback: 'The portal still loaded. The connection table lets real replies in without a rule.' },
            { id: 'nothing', text: 'Nothing. A stateful firewall checks its table, so the rule did nothing.', feedback: 'It did something: the SSH request was a new conversation, and that rule allowed it.' },
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
          id: 'ports',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Firewall A saw a TCP request going out to port 443. Why couldn’t it tell this program from a web browser?',
          options: [
            { id: 'number', text: 'A port is a number the program picks. Any program can use 443.', correct: true },
            { id: 'encrypted', text: 'Port 443 is encrypted, so firewalls can’t see its port number.', feedback: 'Encryption hides what’s inside, not the header. The firewall read the port: 443.' },
            { id: 'outbound', text: 'Firewalls never check traffic going out, only traffic coming in.', feedback: 'Rule 1 is an out rule, and Firewall A checked this request against it.' },
            { id: 'stateful', text: 'Stateful firewalls only look at replies.', feedback: 'A stateful firewall checks every new request against the rules too. Rule 1 allowed this one.' },
          ],
          explain: 'A port tells a firewall which program a packet should be for. Nothing stops another program from using the same number. Attackers pick 443 because nearly every firewall lets it out.',
        },
      ],
    },

    {
      id: 'ngfw',
      title: 'Name the program',
      body: md`
        A **next-generation firewall** (NGFW) does everything a stateful firewall does. It also uses **deep packet inspection**: it looks inside each new conversation to see which program is talking. Its rules can name a program instead of a port.

        1. Switch [[fwA]] to **Next-generation**. Press **Remote-control program calls the attacker**. The hospital set its NGFW to block a program that uses another program's port, so this call on 443 is blocked.
        2. The attacker updates the program. Press **Remote-control program tries port ${ODD_PORT}**. No program is known for that port, so there's nothing to compare. It gets out.

        The requirement: *the remote-control program may not leave the hospital, on any port. Staff still need the clinic portal.* Add an **out** rule that denies it. In the **Program** menu it's called **Remote-control tool**. Move the rule above rule 1, then test all three buttons.

        (In the simulation, each packet names its program. A real NGFW recognizes programs from clues like the server's name and the pattern of the traffic, often without decrypting anything.)
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
          label: `A rule that names the program blocks it on port ${ODD_PORT}, and would on any port and any server (test after your last change)`,
          hint: 'Add a rule: **deny**, **out**, any protocol, from any to any, any port, program **Remote-control tool**. Put it above rule 1, which allows everything out. A rule that blocks only the attacker’s address doesn’t count: the program could call any server.',
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
          explain: 'Of the three types, only a next-generation firewall can block a program by name. An attacker can change the port in seconds. Making the program look like a different one takes more work.',
        },
        {
          id: 'mismatch',
          kind: 'choice',
          afterGoals: true,
          prompt: `Without your rule, the NGFW blocked the program on 443 but not on ${ODD_PORT}. Why?`,
          options: [
            { id: 'known', text: `It compares the program with the one a port is known for. ${ODD_PORT} has none.`, correct: true },
            { id: 'trusted', text: `${ODD_PORT} is on the firewall’s list of trusted ports, so it skips the check.`, feedback: `No list trusts ${ODD_PORT}. Rule 1 allows everything going out, and the NGFW had nothing to compare the program with.` },
            { id: 'hidden', text: `The program hides itself better on ${ODD_PORT}, so the NGFW couldn’t recognize it.`, feedback: 'The NGFW saw the same program both times. What changed is the port’s known program: 443 is HTTPS, and nothing is known for the other.' },
          ],
          explain: 'A program on another program’s port is an **indicator of compromise**: a clue that a computer may have been hacked. A rule that names the program doesn’t need the clue.',
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

        The extra \`' OR '1'='1\` changes the question the web app asks its database to "booking 7, or 1 equals 1". 1 always equals 1, so the database shows every booking. Hiding database commands in a request is called **SQL injection**.

        3. Turn on **Intrusion prevention** on [[fwA]] (**IPS** in the log). It compares what each allowed request carries with **signatures**: patterns of known attacks. A match is blocked as it arrives. Send the attack again.
        4. Click Firewall A's alert line in the **Logs** tab.

        (HTTPS is encrypted. A real NGFW can read inside only because the hospital gives it the key.)
      `,
      setup: (sim) => {
        if (mode(sim, 'fwA') !== 'ngfw') sim.fwSetMode('fwA', 'ngfw');
        noRemote(sim);
        patientsRule(sim);
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
            { id: 'allowed', text: 'The HTTPS rule allows the request, and nothing checks what it carries.', correct: true },
            { id: 'reply', text: 'It looked like a reply to a patient’s visit, so the connection table let it in.', feedback: 'It’s a new request, not a reply. The rule for patients’ HTTPS allowed it.' },
            { id: 'port', text: 'It used a port the firewall doesn’t know, so no rule applied to it.', feedback: 'It used 443, the port the firewall allows for patients.' },
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
          'exploit',
          'Block an attack hidden inside a web request that the rules allow.',
          'ngfw',
          {
            stateless: 'The attack is inside the request, not in its header. A stateless firewall never looks there.',
            stateful: 'The rules allow the request, and the connection table only tracks conversations. Neither looks inside.',
          },
          'Intrusion prevention reads what a request carries and blocks known attacks.',
        ),
        {
          id: 'office',
          kind: 'choice',
          prompt: 'A small dentist’s office has one router with a stateful firewall built in. Nobody on the internet needs to reach anything inside the office. Does it need a separate firewall box?',
          options: [
            { id: 'no', text: 'No. The router’s firewall can do what this office needs.', correct: true },
            {
              id: 'weaker',
              text: 'Yes. A firewall inside a router is always weaker than a box.',
              feedback: 'The software decides what a firewall can do, not the box. Many routers run stateful firewalls, and some run next-generation ones.',
            },
            { id: 'ngfw', text: 'Yes. Every office needs a next-generation firewall.', feedback: 'A next-generation firewall costs three times as much. This office runs nothing the public uses, so the stateful firewall in its router can do the job.' },
            { id: 'antivirus', text: 'No. Each computer has antivirus, so no firewall is needed.', feedback: 'Antivirus checks files on one computer. It doesn’t decide which packets get into the network.' },
          ],
          explain:
            'Where a firewall runs matters less than what it can do. A small office with nothing for the public may only need its router’s firewall. A hospital with a public web app needs more.',
        },
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

        Choose a type for [[fwA]] and for [[fwB]]. Your rules stay the same. Then press **Run the hospital's tests**. Each test says which firewall it checks. Try cheaper types too: the tests show what each one misses. Finish with types that pass every test within the budget.
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
          label: 'Find a type for [[fwA]] that passes all of Firewall A’s tests in one run',
          hint: 'Firewall A has to stop the remote-control program and the hidden attack. Which type can look inside?',
          check: ({ sim, since }) => passed(sim, since, ['fwA']),
        },
        {
          id: 'b',
          label: 'Find a type for [[fwB]] that passes all of Firewall B’s tests in one run',
          hint: 'Firewall B has to let the clinic portal’s real replies in and keep fake ones out, even fakes that copy the clinic’s address. Which type can tell them apart?',
          check: ({ sim, since }) => passed(sim, since, ['fwB']),
        },
        {
          id: 'budget',
          label: `Find types that pass every test and cost no more than ${money(BUDGET)} together`,
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
            'Write to the IT director. Which type did you choose for Firewall A and for Firewall B, and why? Name one thing Firewall A must stop that a stateful firewall can’t. Then explain why Firewall B can’t be stateless but doesn’t need to be next-generation.',
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
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
    {
      id: 'branch',
      title: 'Optional extra challenge: The router at the branch',
      extra: true,
      body: md`
        The branch office is small: one router and [[desk]]. It has no firewall box. The firewall is software built into [[branch]]. Many routers have a stateful firewall built in, but this older one can only be **stateless**. (In step 9 the lab gave the branch router a rule, so the hospital's tests could reach the front desk. That rule is gone now, so you write your own.)

        Since the branch opened, the front desk can't open the hospital's web app. Press **Front desk opens the web app** and find where the reply stops.

        The requirement: *the front desk uses the hospital web app at ${WEB}. Nothing else from the internet gets in.* Write the rule on [[branch]]. Then test the attacker's fake reply too.

        (A real branch would reach the hospital through a **VPN**, a protected tunnel across the internet. The map leaves it out.)
      `,
      setup: branchFresh,
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
          label: 'Once your rule works, try a fake reply that claims to come from the web server',
          hint: 'After the front desk opens the web app, press **Attacker fakes the web server’s address**.',
          // The fake got through. (The router blocks it only before the student's rule lets the real replies in.)
          check: ({ sim, since }) => stray(sim, since, 'desk', WEB),
        },
      ],
      questions: [
        {
          id: 'forged-why',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The fake reply that claimed the web server’s address got through. Why?',
          options: [
            { id: 'header', text: 'It matched your rule, and a stateless firewall checks only the header.', correct: true },
            { id: 'rule', text: 'Your rule is wrong. A better rule on the branch router would have stopped it.', feedback: 'Any rule that lets the real replies in also matches a fake one with the same header. Only a connection table tells them apart.' },
            { id: 'router', text: 'Routers can’t run firewall rules, so the packet went straight through.', feedback: 'The branch router ran your rules: it blocked the fake reply from the attacker’s own address.' },
          ],
          explain: 'Naming the web server made the rule much tighter: fakes from random addresses stop. A stateless firewall still can’t catch a fake that copies a real reply’s header.',
        },
      ],
    },
  ],
};
