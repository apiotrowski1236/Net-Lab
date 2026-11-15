import { describe, expect, it } from 'vitest';
import { scanFindings } from '../../sim/services';
import { fwDenyText } from '../../ui/firewallText';
import type { Sim } from '../../sim/sim';
import { firewallLab } from '.';
import {
  ISP_ROUTER,
  ATTACKER,
  bothPlaced,
  buildHospital,
  CLINIC_SSH,
  DENY_IN_TCP,
  EDGE,
  FILES,
  INNER,
  PLACEMENT,
  PORTAL_SITE,
  SERVER_NET,
  STAFF_NET,
  STAFF_OUT,
  WEB,
} from './scenario';

function connect(sim: Sim, from: string, to: string, port: number, opts: { app?: string; sport?: number } = {}) {
  const id = sim.connectService(from, to, port, opts);
  sim.runUntilIdle();
  return sim.dev(from).conns!.find((c) => c.id === id)!;
}

function connected(sim: Sim, from: string, to: string, port: number): boolean {
  return !!sim.dev(from).conns?.some((c) => c.to === to && c.port === port && c.status === 'open');
}

function placed(b: [string, string] = INNER[0]): Sim {
  const sim = buildHospital();
  sim.placeFirewall('fwA', ...EDGE, 'inet');
  sim.placeFirewall('fwB', b[0], b[1], b[0]);
  return sim;
}

const step = (id: string) => firewallLab.steps.find((s) => s.id === id)!;

describe('firewall lab network', () => {
  it('has placement feedback for every cable, for both firewalls', () => {
    const sim = buildHospital();
    for (const l of Object.values(sim.links)) {
      const [a, b] = [l.a.device, l.b.device];
      if (sim.dev(a).kind === 'firewall' || sim.dev(b).kind === 'firewall') continue;
      for (const fw of ['fwA', 'fwB']) {
        const fb = PLACEMENT.find((f) => (!f.device || f.device === fw) && f.between.includes(a) && f.between.includes(b));
        expect(fb, `${fw} on ${a}-${b}`).toBeDefined();
      }
    }
  });

  it('is wide open before the firewalls: the attacker reaches the records', () => {
    const sim = buildHospital();
    expect(connect(sim, 'attacker', FILES, 445).status).toBe('open');
    sim.scan('attacker', STAFF_NET);
    sim.runUntilIdle();
    const files = scanFindings(sim.dev('attacker').scans!.at(-1)!).find((h) => h.ip === FILES);
    expect(files?.open).toEqual([22, 445]);
  });

  it('leaves the web server exposed when Firewall A guards only the staff network', () => {
    const sim = buildHospital();
    sim.placeFirewall('fwA', ...INNER[0], INNER[0][0]);
    expect(connect(sim, 'attacker', WEB, 22).status).toBe('open');
    expect(connect(sim, 'attacker', FILES, 445).status).toBe('no-answer');
  });

  it('works with Firewall B on either inside cable', () => {
    for (const b of INNER) {
      const sim = placed(b);
      expect(bothPlaced(sim)).toBe(true);
      sim.fwAddRule('fwB', STAFF_OUT);
      expect(connect(sim, 'nurse', WEB, 443).status, `nurse web app, B on ${b}`).toBe('open');
      expect(connect(sim, 'web', FILES, 445).reason, `web to files, B on ${b}`).toBe('firewall');
      expect(connect(sim, 'nurse', FILES, 445).status).toBe('open');
      sim.browse('nurse', `https://${PORTAL_SITE}/`);
      sim.runUntilIdle();
      expect(sim.dev('nurse').browser?.status, `portal, B on ${b}`).toBe('loaded');
    }
  });

  it('decides SSH by rule order (CED 3.4.D.3)', () => {
    const deny = placed();
    deny.fwAddRule('fwA', DENY_IN_TCP);
    deny.fwAddRule('fwA', CLINIC_SSH);
    expect(connect(deny, 'clinic', WEB, 22).reason).toBe('firewall');
    const allow = placed();
    allow.fwAddRule('fwA', CLINIC_SSH);
    allow.fwAddRule('fwA', DENY_IN_TCP);
    expect(connect(allow, 'clinic', WEB, 22).status).toBe('open');
    expect(connect(allow, 'attacker', WEB, 22).reason).toBe('firewall');
  });

  it('shows the attacker only the web app after the lab', () => {
    const sim = placed();
    for (const id of ['first-rule', 'order', 'inner', 'log']) step(id).setup?.(sim);
    // What the student does: fix the coworker's order in step 5.
    const rules = () => sim.dev('fwA').firewall!.rules;
    sim.fwMoveRule('fwA', rules().find((r) => r.src === CLINIC_SSH.src)!.id, rules().findIndex((r) => r.action === 'deny'));
    sim.scan('attacker', SERVER_NET);
    sim.scan('attacker', STAFF_NET);
    sim.runUntilIdle();
    const [servers, staff] = sim.dev('attacker').scans!.slice(-2).map(scanFindings);
    expect(servers.find((h) => h.ip === WEB)?.open).toEqual([443]);
    expect(staff).toEqual([]);
    expect(sim.dev('fwA').logs.some((l) => l.fields?.action === 'deny' && l.fields?.src === ATTACKER)).toBe(true);
    expect(connect(sim, 'clinic', WEB, 22).status).toBe('open');
    expect(connect(sim, 'attacker', WEB, 22).reason).toBe('firewall');
  });
});

describe('firewall lab step setups', () => {
  it('build what each step needs from a fresh network, and are safe to repeat', () => {
    for (const s of firewallLab.steps) {
      if (!s.setup) continue;
      const once = buildHospital();
      s.setup(once);
      once.runUntilIdle();
      const twice = buildHospital();
      s.setup(twice);
      s.setup(twice);
      twice.runUntilIdle();
      expect(JSON.stringify(twice.devices), `${s.id} setup twice`).toBe(JSON.stringify(once.devices));
      expect(bothPlaced(once), `${s.id} places both firewalls`).toBe(true);
    }
  });

  it('starts "Order matters" with the deny rule above the clinic rule', () => {
    const sim = buildHospital();
    step('order').setup!(sim);
    const rules = sim.dev('fwA').firewall!.rules;
    const deny = rules.findIndex((r) => r.action === 'deny');
    const clinic = rules.findIndex((r) => r.src === CLINIC_SSH.src);
    expect(deny).toBeGreaterThan(-1);
    expect(clinic).toBe(deny + 1);
    expect(connect(sim, 'clinic', WEB, 22).reason).toBe('firewall');
    sim.browse('patient', 'https://achospital.example/');
    sim.runUntilIdle();
    expect(sim.dev('patient').browser?.status).toBe('loaded');
  });
});

describe('firewall lab feedback', () => {
  it('says when a rule on Firewall B points the wrong way', () => {
    const sim = placed();
    sim.fwAddRule('fwB', { ...STAFF_OUT, dir: 'in', proto: 'tcp' });
    const t = sim.t;
    expect(connect(sim, 'nurse', WEB, 443).reason).toBe('firewall');
    expect(fwDenyText(sim, 'fwB', sim.events.find((e) => e.type === 'firewall' && e.t >= t)!.t)).toBe(
      'Firewall B blocked it: no rule matched (the implicit deny). Rule 1 would match it, but rule 1 is for packets going in, and this one is going out.',
    );
  });

  it('says when a TCP-only rule on Firewall B is all that stops a ping', () => {
    const sim = placed();
    sim.fwAddRule('fwB', { ...STAFF_OUT, proto: 'tcp' });
    const t = sim.t;
    sim.ping('nurse', ISP_ROUTER);
    sim.runUntilIdle();
    expect(fwDenyText(sim, 'fwB', sim.events.find((e) => e.type === 'firewall' && e.t >= t)!.t)).toBe(
      'Firewall B blocked it: no rule matched (the implicit deny). Rule 1 would match it, but rule 1 is only for TCP, and this packet is a ping (ICMP).',
    );
  });

  it('says nothing extra for an implicit deny that no rule would turn around', () => {
    const sim = placed();
    const t = sim.t;
    sim.ping('attacker', WEB);
    sim.runUntilIdle();
    expect(fwDenyText(sim, 'fwA', sim.events.find((e) => e.type === 'firewall' && e.t >= t)!.t)).toBe(
      'Firewall A blocked it: no rule matched (the implicit deny).',
    );
  });

  it('tags the firewall, not every cable end, when it is placed', () => {
    const sim = buildHospital();
    const n = sim.events.length;
    sim.placeFirewall('fwA', ...EDGE, 'inet');
    const loud = sim.events.slice(n).filter((e) => !e.quiet);
    expect(loud.map((e) => e.type === 'config' && e.what)).toEqual(['firewall-placed']);
  });
});

describe('firewall lab goals', () => {
  it('counts the clinic in step 5 only while the coworker’s deny rule is still there', () => {
    const goal = step('order').goals!.find((g) => g.id === 'clinic')!;
    const sim = buildHospital();
    step('order').setup!(sim);
    const since = sim.t;
    const deny = sim.dev('fwA').firewall!.rules.find((r) => r.action === 'deny')!;
    sim.fwDeleteRule('fwA', deny.id);
    expect(connect(sim, 'clinic', WEB, 22).status).toBe('open');
    expect(goal.check({ sim, since })).toBe(false);
  });

  it('needs scans of both networks for the rescan in step 7', () => {
    const rescan = step('log').goals!.find((g) => g.id === 'rescan')!;
    const sim = buildHospital();
    step('log').setup!(sim);
    const since = sim.t;
    sim.scan('attacker', SERVER_NET);
    sim.runUntilIdle();
    expect(rescan.check({ sim, since })).toBe(false);
    sim.scan('attacker', STAFF_NET);
    sim.runUntilIdle();
    expect(rescan.check({ sim, since })).toBe(true);
  });

  it('needs Firewall B to allow every protocol out, not only TCP, for the nurse ping in step 6', () => {
    const ping = step('inner').goals!.find((g) => g.id === 'nurse-ping')!;
    const press = (sim: Sim, id: string) => step('inner').actions!.find((a) => a.id === id)!.run(sim);
    for (const [proto, want] of [['tcp', false], ['any', true]] as const) {
      const sim = buildHospital();
      step('inner').setup!(sim);
      const since = sim.t;
      sim.fwAddRule('fwB', { ...STAFF_OUT, proto });
      press(sim, 'nurse-web');
      press(sim, 'nurse-ping');
      sim.runUntilIdle();
      expect(connected(sim, 'nurse', WEB, 443), proto).toBe(true);
      expect(ping.check({ sim, since }), proto).toBe(want);
      // The nurse's ping crosses both firewalls, the slowest round trip in the
      // lab. A working rule must get its reply before the ping gives up.
      if (want) expect(sim.events.some((e) => e.t >= since && e.type === 'ping-fail' && e.device === 'nurse'), 'timed out').toBe(false);
    }
  });
});
