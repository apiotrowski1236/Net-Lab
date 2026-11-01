import { describe, expect, it } from 'vitest';
import { scanFindings } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import { firewallLab } from '.';
import {
  ATTACKER,
  bothPlaced,
  buildHospital,
  CLINIC_SSH,
  DENY_IN_TCP,
  EDGE,
  fakeReply,
  FILES,
  INNER,
  NURSE,
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
      expect(connect(sim, 'nurse', WEB, 22).status, `nurse SSH, B on ${b}`).toBe('open');
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

  it('lets a port-443 trick through a stateless rulebook, and stops it once stateful with no reply rule', () => {
    const sim = placed();
    sim.fwAddRule('fwB', STAFF_OUT);
    step('fake').setup!(sim);
    const strays = () => sim.events.filter((e) => e.type === 'stray-reply' && e.device === 'web').length;
    fakeReply(sim, WEB);
    sim.runUntilIdle();
    expect(strays()).toBe(1);
    expect(connect(sim, 'attacker', WEB, 22, { sport: 443 }).status).toBe('open');
    sim.fwSetMode('fwA', 'stateful');
    fakeReply(sim, WEB);
    sim.runUntilIdle();
    expect(strays()).toBe(1);
    expect(connect(sim, 'attacker', WEB, 22, { sport: 443 }).status).toBe('open');
    const hole = sim.dev('fwA').firewall!.rules.find((r) => r.sport === 443)!;
    sim.fwDeleteRule('fwA', hole.id);
    expect(connect(sim, 'attacker', WEB, 22, { sport: 443 }).reason).toBe('firewall');
    sim.browse('nurse', `https://${PORTAL_SITE}/`);
    sim.runUntilIdle();
    expect(sim.dev('nurse').browser?.status).toBe('loaded');
  });

  it('catches the remote-control program only as a next-generation firewall', () => {
    const sim = placed();
    sim.fwAddRule('fwB', STAFF_OUT);
    expect(connect(sim, 'nurse', ATTACKER, 443, { app: 'remote-control' }).status).toBe('open');
    sim.fwSetMode('fwA', 'ngfw');
    const c = connect(sim, 'nurse', ATTACKER, 443, { app: 'remote-control' });
    expect(c.reason).toBe('firewall');
    expect(c.at).toBe('fwA');
    expect(sim.dev('fwA').logs.at(-1)?.fields).toMatchObject({ action: 'deny', src: NURSE, dst: ATTACKER, app: 'remote-control', expected: 'https' });
  });

  it('shows the attacker only the web app after the lab', () => {
    const sim = placed();
    for (const id of ['first-rule', 'order', 'inner', 'stateless', 'fake', 'ngfw', 'log']) step(id).setup?.(sim);
    // What the student does: fix the coworker's order in step 5, close the reply hole in step 8.
    const rules = () => sim.dev('fwA').firewall!.rules;
    sim.fwMoveRule('fwA', rules().find((r) => r.src === CLINIC_SSH.src)!.id, rules().findIndex((r) => r.action === 'deny'));
    const hole = rules().find((r) => r.sport === 443);
    if (hole) sim.fwDeleteRule('fwA', hole.id);
    sim.fwSetMode('fwA', 'stateful');
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
