import { describe, expect, it } from 'vitest';
import { checkRuleApp } from '../../runtime/firewallInput';
import { LabSession } from '../../runtime/session';
import type { Sim } from '../../sim/sim';
import type { LabProgress } from '../../store/progress';
import { playMove, playStep, type Move } from '../solution';
import { firewallTypesLab as lab } from '.';
import {
  ATTACKER,
  BRANCH_REPLIES,
  buildHospital2,
  DESK,
  FILES,
  HOSPITAL_SITE,
  NO_REMOTE,
  NURSE,
  ODD_PORT,
  PORTAL_SITE,
  REPLIES_IN,
  WEB,
} from './scenario';
import { firewallTypesSolution as sol } from './solution';

let n = 0;
function fresh(): LabSession {
  const now = Date.now();
  const p: LabProgress = {
    labId: lab.id,
    labVersion: lab.version,
    studentId: `fwtypes-${n++}`,
    startedAt: now,
    updatedAt: now,
    activeMs: 0,
    step: 0,
    maxStep: 0,
    stepStart: {},
    goals: {},
    answers: {},
    actions: [],
    log: [],
  };
  return new LabSession(lab, p);
}

const index = (id: string) => lab.steps.findIndex((s) => s.id === id);
const step = (id: string) => lab.steps[index(id)];

/** A session that has finished every step before `id` with the answer key, and now stands on `id`. */
function openAt(id: string): LabSession {
  const s = fresh();
  for (let i = 0; i < index(id); i++) {
    playStep(s, sol[s.step.id]);
    expect(s.missing(), `step "${s.step.id}" left unfinished`).toEqual([]);
    s.goTo(i + 1);
  }
  s.sim.runUntilIdle();
  return s;
}

const play = (s: LabSession, ...moves: Move[]) => moves.forEach((m) => playMove(s, m));
const done = (s: LabSession, goal: string) => s.goalDone(s.step.id, goal);
/** The lines under a lesson button, for its last press. */
function lines(s: LabSession, action: string): string[] {
  const def = s.step.actions!.find((a) => a.id === action)!;
  return def.outcome!(s.sim, s.lastRun.value!.t).map((l) => `${l.tone}: ${l.text}`);
}

function connect(sim: Sim, from: string, to: string, port: number, opts: { app?: string; sport?: number } = {}) {
  const id = sim.connectService(from, to, port, opts);
  sim.runUntilIdle();
  return sim.dev(from).conns!.find((c) => c.id === id)!;
}
function browse(sim: Sim, dev: string, url: string) {
  sim.browse(dev, url);
  sim.runUntilIdle();
  return sim.dev(dev).browser!;
}

describe('firewall-types network', () => {
  it('starts with both hospital firewalls stateful and working, and the branch cut off', () => {
    const sim = buildHospital2();
    expect(sim.dev('fwA').firewall!.mode).toBe('stateful');
    expect(sim.dev('fwB').firewall!.mode).toBe('stateful');
    expect(browse(sim, 'nurse', `https://${PORTAL_SITE}/`).status).toBe('loaded');
    expect(connect(sim, 'attacker', WEB, 22).status).not.toBe('open');
    expect(connect(sim, 'web', FILES, 445).status).not.toBe('open');
    // The branch router is stateless with no reply rule, so the web app's reply is dropped.
    expect(browse(sim, 'desk', `https://${HOSPITAL_SITE}/`).status).not.toBe('loaded');
    expect(sim.dev('branch').firewall!.mode).toBe('stateless');
  });

  it('lets the remote-control program out on 443 until Firewall A is next-generation', () => {
    const sim = buildHospital2();
    expect(connect(sim, 'nurse', ATTACKER, 443, { app: 'remote-control' }).status).toBe('open');
    sim.fwSetMode('fwA', 'ngfw');
    const c = connect(sim, 'nurse', ATTACKER, 443, { app: 'remote-control' });
    expect(c.reason).toBe('firewall');
    expect(c.at).toBe('fwA');
    expect(sim.dev('fwA').logs.at(-1)?.fields).toMatchObject({ action: 'deny', src: NURSE, dst: ATTACKER, app: 'remote-control', expected: 'https' });
    // No program is known for 8443, so there's nothing to compare: it needs a rule.
    expect(connect(sim, 'nurse', ATTACKER, ODD_PORT, { app: 'remote-control' }).status).toBe('open');
    sim.fwAddRule('fwA', NO_REMOTE, 0);
    expect(connect(sim, 'nurse', ATTACKER, ODD_PORT, { app: 'remote-control' }).status).not.toBe('open');
    expect(browse(sim, 'nurse', `https://${PORTAL_SITE}/`).status).toBe('loaded');
  });

  it('skips a program rule on a stateful firewall', () => {
    const sim = buildHospital2();
    sim.fwAddRule('fwA', NO_REMOTE, 0);
    expect(connect(sim, 'nurse', ATTACKER, ODD_PORT, { app: 'remote-control' }).status).toBe('open');
  });
});

describe('firewall-types steps', () => {
  it('"A firewall with no memory": a reply rule below the deny does nothing', () => {
    const s = openAt('stateless');
    play(s, { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateless' } }, { tool: { type: 'fw-add-rule', device: 'fwA', rule: REPLIES_IN } }, { press: 'portal' });
    expect(s.sim.dev('nurse').browser!.status).not.toBe('loaded');
    expect(done(s, 'portal')).toBe(false);
  });

  it('"A firewall with no memory": a reply rule from any port lets the attacker in', () => {
    const s = openAt('stateless');
    play(
      s,
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateless' } },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: { ...REPLIES_IN, sport: 'any' } } },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r5', to: 3 } },
      { press: 'portal' },
      { press: 'attacker-ssh' },
    );
    expect(done(s, 'portal')).toBe(true);
    expect(done(s, 'ssh')).toBe(false);
  });

  it('"Give it a memory": SSH from port 443 stays open until the port 443 rule is gone', () => {
    const s = openAt('stateful');
    play(s, { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateful' } }, { press: 'portal' }, { press: 'fake' }, { press: 'sneak' });
    expect(done(s, 'table')).toBe(true);
    expect(done(s, 'fake')).toBe(true);
    expect(done(s, 'sneak')).toBe(false);
    // The portal worked, but the hole is still open: that test doesn't count yet.
    expect(done(s, 'portal')).toBe(false);
    play(s, { tool: { type: 'fw-delete-rule', device: 'fwA', id: 'r5' } }, { press: 'sneak' });
    expect(done(s, 'sneak')).toBe(true);
    play(s, { press: 'portal' });
    expect(done(s, 'portal')).toBe(true);
  });

  it('"Fake replies": a step 2 rule narrower than the usual one still leaves a hole to test', () => {
    const s = fresh();
    playStep(s, sol.tour);
    s.goTo(1);
    const narrow = { ...REPLIES_IN, dst: '10.0.2.0/24' };
    playStep(s, { moves: sol.stateless.moves!.map((m) => ('tool' in m && m.tool.type === 'fw-add-rule' ? { tool: { ...m.tool, rule: narrow } } : m)) });
    expect(s.missing()).toEqual([]);
    s.goTo(2);
    play(s, { press: 'fake' }, { press: 'sneak' });
    expect(done(s, 'fake')).toBe(true);
    expect(done(s, 'sneak')).toBe(true);
    // The student's own rule is still there, above the one the lab added.
    expect(s.sim.dev('fwA').firewall!.rules.filter((r) => r.sport === 443).map((r) => r.dst)).toEqual(['10.0.2.0/24', 'any']);
    playStep(s, sol.fake);
    s.goTo(3);
    // Step 4: deleting only the rule the lab added leaves the student's own hole into the staff network.
    const wide = s.sim.dev('fwA').firewall!.rules.find((r) => r.sport === 443 && r.dst === 'any')!;
    const own = s.sim.dev('fwA').firewall!.rules.find((r) => r.sport === 443 && r.dst !== 'any')!;
    play(s, { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateful' } }, { tool: { type: 'fw-delete-rule', device: 'fwA', id: wide.id } }, { press: 'portal' });
    expect(done(s, 'portal')).toBe(false);
    play(s, { tool: { type: 'fw-delete-rule', device: 'fwA', id: own.id } }, { press: 'portal' });
    expect(done(s, 'portal')).toBe(true);
  });

  it('"A firewall with no memory": a blocked reply shows at once, with the rule that blocked it', () => {
    const s = openAt('stateless');
    play(s, { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateless' } });
    const def = s.step.actions!.find((a) => a.id === 'portal')!;
    const t0 = s.sim.t;
    def.run(s.sim);
    s.sim.advance(3000);
    expect(def.outcome!(s.sim, t0).map((l) => `${l.tone}: ${l.text}`)).toEqual([
      'bad: Firewall A blocked the reply. Denied by rule 4: DENY in TCP from any to any. The browser waits, then gives up.',
    ]);
  });

  it('"Name the program": a port 8443 rule blocks the test but not the requirement', () => {
    const s = openAt('ngfw');
    const deny8443 = { dir: 'out', proto: 'tcp', src: 'any', dst: 'any', dport: ODD_PORT, action: 'deny' } as const;
    play(
      s,
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: deny8443 } },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r6', to: 0 } },
      { press: 'malware-odd' },
    );
    expect(s.sim.dev('nurse').conns!.at(-1)!.status).not.toBe('open');
    expect(done(s, 'odd')).toBe(false);
  });

  it('"Name the program": a rule that blocks the attacker\'s address doesn\'t count', () => {
    const s = openAt('ngfw');
    const denyAttacker = { dir: 'out', proto: 'any', src: 'any', dst: ATTACKER, dport: 'any', action: 'deny' } as const;
    const t0 = s.sim.t;
    play(
      s,
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: denyAttacker } },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r6', to: 0 } },
      { press: 'malware-odd' },
      { press: 'malware' },
      { press: 'portal' },
    );
    // Both calls are blocked and the portal loads, but no rule names the program.
    expect(s.sim.dev('nurse').conns!.filter((c) => c.to === ATTACKER && c.t >= t0).every((c) => c.status !== 'open')).toBe(true);
    expect(done(s, 'odd')).toBe(false);
    expect(done(s, 'web')).toBe(false);
    expect(done(s, 'portal')).toBe(false);
    // A program rule limited to the attacker's address doesn't stop the program calling another server.
    const s2 = openAt('ngfw');
    play(
      s2,
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: { ...NO_REMOTE, dst: ATTACKER } } },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r6', to: 0 } },
      { press: 'malware-odd' },
    );
    expect(done(s2, 'odd')).toBe(false);
  });

  it('"Name the program": denying web browsing breaks the portal', () => {
    const s = openAt('ngfw');
    play(
      s,
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } },
      { tool: { type: 'fw-add-rule', device: 'fwA', rule: { ...NO_REMOTE, app: 'web' } } },
      { tool: { type: 'fw-move-rule', device: 'fwA', id: 'r6', to: 0 } },
      { press: 'portal' },
    );
    expect(done(s, 'portal')).toBe(false);
  });

  it('"Look inside": the attack lands, then intrusion prevention stops it with an alert', () => {
    const s = openAt('inspect');
    play(s, { press: 'exploit' });
    expect(lines(s, 'exploit')).toEqual(['bad: The attack worked. The web server answered with "All 18,240 appointments": names, dates of birth, and doctors.']);
    expect(done(s, 'hit')).toBe(true);
    play(s, { tool: { type: 'fw-ips', device: 'fwA', on: true } }, { press: 'exploit' });
    expect(lines(s, 'exploit')).toEqual(['good: Firewall A blocked the request: intrusion prevention found SQL injection inside. The attacker’s browser waits, then gives up.']);
    const alert = s.sim.dev('fwA').logs.at(-1)!;
    expect(alert.level).toBe('alert');
    expect(alert.msg).toContain('ips signature sql-injection (rule 3 allowed the port)');
    expect(alert.fields?.signature).toBe('sql-injection');
    // An ordinary booking still works.
    expect(browse(s.sim, 'clinic', `https://${HOSPITAL_SITE}/appointments?id=7`).status).toBe('loaded');
  });

  it('"Look inside": the button says "on its way" until the page answers', () => {
    const s = openAt('inspect');
    s.runStepAction('exploit');
    expect(lines(s, 'exploit')).toEqual(['wait: The request is on its way…']);
  });

  it('"The router at the branch": a rule that trusts any address fails the fake-reply goal', () => {
    const s = openAt('branch');
    play(s, { tool: { type: 'fw-add-rule', device: 'branch', rule: { ...BRANCH_REPLIES, src: 'any' } } }, { press: 'desk' }, { press: 'desk-fake' });
    expect(done(s, 'desk')).toBe(true);
    expect(lines(s, 'desk-fake')).toEqual(['bad: Front desk received the fake reply from the attacker’s own address, port 443.']);
    expect(done(s, 'fake')).toBe(false);
  });

  it('"The router at the branch": naming the web server stops the attacker but not a forged address', () => {
    const s = openAt('branch');
    play(s, { tool: { type: 'fw-add-rule', device: 'branch', rule: BRANCH_REPLIES } }, { press: 'desk-fake' });
    expect(lines(s, 'desk-fake')).toEqual(['good: Branch router blocked the fake reply from the attacker’s own address: no rule matched it.']);
    play(s, { press: 'desk-forged' });
    expect(lines(s, 'desk-forged')).toEqual([`bad: Front desk received the fake reply from the web server’s address, ${WEB}, port 443.`]);
    expect(done(s, 'forged')).toBe(true);
  });

  it('"Choose A and B": only next-generation A with stateful B passes within the budget', () => {
    const tryPair = (a: 'stateless' | 'stateful' | 'ngfw', b: 'stateless' | 'stateful' | 'ngfw') => {
      const s = openAt('choose');
      play(s, { tool: { type: 'fw-mode', device: 'fwA', mode: a } }, { tool: { type: 'fw-mode', device: 'fwB', mode: b } }, { press: 'tests' });
      return { s, out: lines(s, 'tests'), ok: s.missing().length === 1 /* the reflection */ };
    };
    const start = tryPair('stateful', 'stateful');
    expect(start.out).toEqual([
      'good: Cost: Firewall A stateful ($10,000) + Firewall B stateful ($10,000) = $20,000. Budget: $40,000.',
      `bad: Fail: The remote-control program got out on port ${ODD_PORT}. It should be blocked.`,
      'bad: Fail: The attack hidden in a booking lookup reached the web server. It should be blocked.',
      'good: Pass: The branch front desk opens the web app.',
      'good: Pass: The nurse station opens the clinic portal.',
      'good: Pass: A hacked web server can’t reach the patient records, even from port 443.',
      'good: Pass: A fake reply that claims to come from the clinic portal can’t reach the nurse station.',
    ]);
    expect(start.ok).toBe(false);
    const both = tryPair('ngfw', 'ngfw');
    expect(both.out[0]).toBe('bad: Cost: Firewall A next-generation ($30,000) + Firewall B next-generation ($30,000) = $60,000. Budget: $40,000.');
    expect(both.s.goalDone('choose', 'a')).toBe(true);
    expect(both.s.goalDone('choose', 'b')).toBe(true);
    expect(both.s.goalDone('choose', 'budget')).toBe(false);
    const cheapB = tryPair('ngfw', 'stateless');
    expect(cheapB.out).toContain('bad: Fail: The nurse station couldn’t open the clinic portal.');
    expect(cheapB.s.goalDone('choose', 'b')).toBe(false);
    expect(tryPair('ngfw', 'stateful').ok).toBe(true);
    // A stateless B with a step 2 style reply rule lets the nurse's replies in, and a hacked web server too.
    const holeB = openAt('choose');
    play(
      holeB,
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } },
      { tool: { type: 'fw-mode', device: 'fwB', mode: 'stateless' } },
      { tool: { type: 'fw-add-rule', device: 'fwB', rule: { ...REPLIES_IN, dst: '10.0.2.0/24' } } },
      { press: 'tests' },
    );
    expect(lines(holeB, 'tests')).toContain('good: Pass: The nurse station opens the clinic portal.');
    expect(lines(holeB, 'tests')).toContain('bad: Fail: A hacked web server reached the patient records from port 443. It should be blocked.');
    expect(holeB.goalDone('choose', 'b')).toBe(false);
    // A reply rule limited to the clinic stops that, but not a fake reply that copies the clinic's address.
    const clinicB = openAt('choose');
    const clinicReplies = { dir: 'in', proto: 'tcp', src: '198.51.100.0/24', sport: 443, dst: '10.0.2.0/24', dport: 'any', action: 'allow' } as const;
    play(
      clinicB,
      { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } },
      { tool: { type: 'fw-mode', device: 'fwB', mode: 'stateless' } },
      { tool: { type: 'fw-add-rule', device: 'fwB', rule: clinicReplies } },
      { press: 'tests' },
    );
    expect(lines(clinicB, 'tests')).toEqual([
      'good: Cost: Firewall A next-generation ($30,000) + Firewall B stateless ($4,000) = $34,000. Budget: $40,000.',
      `good: Pass: The remote-control program on port ${ODD_PORT} is blocked.`,
      'good: Pass: The attack hidden in a booking lookup is blocked.',
      'good: Pass: The branch front desk opens the web app.',
      'good: Pass: The nurse station opens the clinic portal.',
      'good: Pass: A hacked web server can’t reach the patient records, even from port 443.',
      'bad: Fail: A hacked web server sent the nurse station a fake reply that claimed to come from the clinic portal, and it got in. It should be blocked.',
    ]);
    expect(clinicB.goalDone('choose', 'b')).toBe(false);
    expect(clinicB.goalDone('choose', 'budget')).toBe(false);
  });

  it('"Choose A and B": a test run from before the last change doesn\'t count', () => {
    const s = openAt('choose');
    play(s, { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } }, { tool: { type: 'fw-mode', device: 'fwB', mode: 'ngfw' } }, { press: 'tests' });
    expect(s.goalDone('choose', 'budget')).toBe(false);
    // Within budget now, but the passing run was with the old, too-expensive types.
    play(s, { tool: { type: 'fw-mode', device: 'fwB', mode: 'stateful' } });
    expect(s.goalDone('choose', 'budget')).toBe(false);
    play(s, { press: 'tests' });
    expect(s.goalDone('choose', 'budget')).toBe(true);
    // Results from before a change say so.
    play(s, { tool: { type: 'fw-mode', device: 'fwA', mode: 'stateful' } });
    expect(lines(s, 'tests')).toContain('wait: You changed a firewall after these tests ran. Run the tests again to see the new results.');
  });

  it('"Choose A and B": a firewall\'s deny settles a test before any timeout', () => {
    const s = openAt('choose');
    play(s, { tool: { type: 'fw-mode', device: 'fwA', mode: 'ngfw' } }, { tool: { type: 'fw-mode', device: 'fwB', mode: 'stateless' } });
    const def = s.step.actions!.find((a) => a.id === 'tests')!;
    const t0 = s.sim.t;
    def.run(s.sim);
    s.sim.advance(4000);
    const out = def.outcome!(s.sim, t0).map((l) => `${l.tone}: ${l.text}`);
    expect(out.filter((l) => l.startsWith('wait'))).toEqual([]);
    expect(out).toContain('bad: Fail: The nurse station couldn’t open the clinic portal.');
    expect(out).toContain(`good: Pass: The remote-control program on port ${ODD_PORT} is blocked.`);
    s.sim.runUntilIdle();
    expect(def.outcome!(s.sim, t0).map((l) => `${l.tone}: ${l.text}`)).toEqual(out);
  });
});

describe('firewall-types step setups', () => {
  it('are quiet and safe to repeat, from a fresh network', () => {
    for (const st of lab.steps) {
      if (!st.setup) continue;
      const once = buildHospital2();
      const before = once.events.length;
      once.quiet = true;
      st.setup(once);
      once.runUntilIdle();
      expect(once.events.slice(before).filter((e) => !e.quiet), `${st.id} setup is quiet`).toEqual([]);
      const twice = buildHospital2();
      twice.quiet = true;
      st.setup(twice);
      st.setup(twice);
      twice.runUntilIdle();
      expect(JSON.stringify(twice.devices), `${st.id} setup twice`).toBe(JSON.stringify(once.devices));
    }
  });

  it('give a student who skipped ahead a network that passes the earlier tests', () => {
    const sim = buildHospital2();
    step('choose').setup!(sim);
    sim.runUntilIdle();
    sim.fwSetMode('fwA', 'ngfw');
    expect(connect(sim, 'nurse', ATTACKER, ODD_PORT, { app: 'remote-control' }).status).not.toBe('open');
    expect(browse(sim, 'attacker', `https://${HOSPITAL_SITE}/appointments?id=7' OR '1'='1`).status).not.toBe('loaded');
    expect(browse(sim, 'desk', `https://${HOSPITAL_SITE}/`).status).toBe('loaded');
    expect(browse(sim, 'nurse', `https://${PORTAL_SITE}/`).status).toBe('loaded');
  });

  it('keep the student\'s own working rules instead of adding copies', () => {
    const sim = buildHospital2();
    sim.fwSetMode('fwA', 'stateless');
    sim.fwAddRule('fwA', { ...REPLIES_IN, dst: '10.0.0.0/8' }, 3);
    sim.fwSetMode('fwA', 'ngfw');
    sim.fwAddRule('fwA', { ...NO_REMOTE, proto: 'tcp' }, 0);
    sim.fwAddRule('branch', { ...BRANCH_REPLIES, dst: DESK });
    const before = JSON.stringify([sim.dev('fwA').firewall!.rules, sim.dev('branch').firewall!.rules]);
    step('fake').setup!(sim);
    step('choose').setup!(sim);
    expect(JSON.stringify([sim.dev('fwA').firewall!.rules, sim.dev('branch').firewall!.rules])).toBe(before);
  });
});

describe('firewall rule program checks', () => {
  it('refuses a program on a firewall that can\'t see programs', () => {
    const sim = buildHospital2();
    expect(checkRuleApp(sim, 'fwA', 'remote-control')).toEqual({
      ok: false,
      field: 'app',
      msg: 'Only a next-generation firewall can tell which program is talking. Firewall A is stateful, so set the program to any.',
      suggest: 'any',
    });
    expect(checkRuleApp(sim, 'fwA', 'any')).toEqual({ ok: true, value: undefined });
  });

  it('points HTTPS at Web browsing on a next-generation firewall', () => {
    const sim = buildHospital2();
    sim.fwSetMode('fwA', 'ngfw');
    expect(checkRuleApp(sim, 'fwA', 'Remote-control tool')).toEqual({ ok: true, value: 'remote-control' });
    expect(checkRuleApp(sim, 'fwA', 'https')).toMatchObject({ ok: false, field: 'app', suggest: 'web', msg: 'Pick Web browsing: it covers both HTTP and HTTPS.' });
  });
});
