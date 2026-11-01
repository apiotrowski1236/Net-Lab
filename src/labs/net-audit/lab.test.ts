import { describe, expect, it } from 'vitest';
import { applyAction } from '../../runtime/actions';
import { FINDINGS, latestReport, riskRating } from '../../sim/audit';
import type { Sim } from '../../sim/sim';
import { crack, reach } from '../../sim/wifi';
import { DROP_PINGS_RULE } from '../../ui/inspector/Hardening';
import { layersOf } from '../../ui/describe';
import { isEncrypted, isTelnetLogin } from '../helpers';
import { netAuditLab } from '.';
import { ADMIN, buildOffice, DESK_PORTS, edgePingBlocked, EMPTY_PORTS, homeProbe, IP, LOT_SPOT, OFFICE_NET, routerLogin, switchHardened, vpnHardened } from './scenario';

/** Run the vulnerability scanner and return the ids in its report. */
function scan(sim: Sim): string[] {
  sim.auditScan('auditor');
  sim.runUntilIdle();
  const r = latestReport(sim.dev('auditor').audit);
  expect(r, 'the scan finished with a report').toBeDefined();
  return r!.findings.map((f) => f.id);
}

const ALL = FINDINGS.map((f) => f.id);

/** Each finding's fix, as the student applies it. */
const FIXES: Record<string, (sim: Sim) => void> = {
  telnet: (sim) => sim.setHardening('router', 'telnet', false),
  'default-admin': (sim) => sim.setHardening('router', 'auth-server', true),
  'edge-icmp': (sim) => sim.fwAddRule('router', DROP_PINGS_RULE, 0),
  'switch-open': (sim) => {
    for (const p of DESK_PORTS) sim.setPortSecurity('sw', p, { maxMacs: 1, violation: 'shutdown' });
    for (const p of EMPTY_PORTS) sim.setPortShutdown('sw', p, true);
  },
  'wifi-weak': (sim) => sim.setWifiSecurity('wap', 'wpa3'),
  'wifi-beacon': (sim) => sim.setWifiBeacon('wap', false),
  'vpn-split': (sim) => sim.setVpn('router', { splitTunneling: false, auth: 'mfa' }),
};

describe('net-audit: the office network', () => {
  it('puts the Wi-Fi reach into the parking lot, and WEP falls', () => {
    const sim = buildOffice();
    const wap = sim.dev('wap');
    expect(Math.hypot(LOT_SPOT.x - wap.x, LOT_SPOT.y - wap.y)).toBeLessThan(reach(wap.wifi!));
    expect(crack(wap.wifi!).ok).toBe(true);
    sim.setWifiSecurity('wap', 'wpa3');
    expect(crack(wap.wifi!).ok).toBe(false);
  });

  it('builds quietly: no events, and the auditor sees only its scope', () => {
    const sim = buildOffice();
    expect(sim.events).toEqual([]);
    expect(sim.dev('auditor').audit?.scope).toBe(OFFICE_NET);
  });
});

describe('net-audit: the scanner', () => {
  it('reports all seven findings on the first scan, with high, moderate, and low severities', () => {
    const sim = buildOffice();
    expect(scan(sim)).toEqual(ALL);
    const r = latestReport(sim.dev('auditor').audit)!;
    const sev = Object.fromEntries(r.findings.map((f) => [f.id, f.severity]));
    expect(sev).toEqual({ telnet: 'high', 'default-admin': 'high', 'edge-icmp': 'moderate', 'switch-open': 'moderate', 'wifi-weak': 'high', 'wifi-beacon': 'low', 'vpn-split': 'moderate' });
    for (const f of r.findings) {
      for (const text of [f.title, f.evidence, f.fix]) {
        expect(text.length).toBeGreaterThan(10);
        expect(text).not.toMatch(/undefined|NaN|—/);
      }
    }
    // The report maps the office: every device that answered, with its open ports.
    const server = r.hosts.find((h) => h.ip === IP.fileserver);
    expect(server?.open).toEqual([22, 80, 445]);
    expect(r.hosts.find((h) => h.ip === IP.router)?.open).toEqual([22, 23]);
  });

  it.each(ALL)('fixing %s removes exactly that finding', (id) => {
    const sim = buildOffice();
    scan(sim);
    FIXES[id](sim);
    expect(scan(sim)).toEqual(ALL.filter((x) => x !== id));
  });

  it('clears to the one accepted low finding when every policy is applied', () => {
    const sim = buildOffice();
    for (const id of ALL) if (id !== 'wifi-beacon') FIXES[id](sim);
    expect(scan(sim)).toEqual(['wifi-beacon']);
  });

  it('emits scan-complete with the ids still present, and ignores a second Run scan while busy', () => {
    const sim = buildOffice();
    sim.auditScan('auditor');
    sim.auditScan('auditor');
    sim.runUntilIdle();
    const done = sim.events.filter((e) => e.type === 'scan-complete');
    expect(done).toHaveLength(1);
    expect(done[0].type === 'scan-complete' && done[0].findings).toEqual(ALL);
    expect(sim.dev('auditor').audit!.reports).toHaveLength(1);
  });

  it('drops the internet ping at the edge once the policy rule is in, and the office still reaches the router', () => {
    const sim = buildOffice();
    expect(edgePingBlocked(sim)).toBe(false);
    sim.fwAddRule('router', DROP_PINGS_RULE, 0);
    expect(edgePingBlocked(sim)).toBe(true);
    sim.ping('internet', IP.routerWan);
    sim.ping('pc1', IP.router);
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'internet')).toBe(false);
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'pc1')).toBe(true);
  });
});

describe('net-audit: the risk register', () => {
  it('rates the three framework examples high, moderate, and low', () => {
    expect(riskRating('high', 'high')).toBe('high');
    expect(riskRating('high', 'low')).toBe('moderate');
    expect(riskRating('low', 'low')).toBe('low');
  });

  it('keeps a part left out when only one dropdown changes', () => {
    const sim = buildOffice();
    sim.rateRisk('auditor', 'telnet', 'high');
    sim.rateRisk('auditor', 'telnet', undefined, 'moderate');
    expect(sim.dev('auditor').audit!.register.telnet).toEqual({ likelihood: 'high', impact: 'moderate' });
  });
});

describe('net-audit: Telnet and SSH', () => {
  it('shows the Telnet password in the capture, and only scrambled text for SSH', () => {
    const sim = buildOffice();
    sim.dev('auditor').sniffing = true;
    routerLogin(sim, 'telnet');
    routerLogin(sim, 'ssh');
    sim.runUntilIdle();
    const cap = sim.dev('auditor').capture.map((c) => c.frame);
    const telnet = cap.find(isTelnetLogin);
    const ssh = cap.find((f) => isEncrypted(f) && f.ip?.app.kind === 'svc' && !f.ip.app.reply);
    expect(telnet).toBeDefined();
    expect(ssh).toBeDefined();
    const text = (f: NonNullable<typeof telnet>) => JSON.stringify(layersOf(sim, f));
    expect(text(telnet!)).toContain(ADMIN.pass);
    expect(text(ssh!)).not.toContain(ADMIN.pass);
  });

  it('refuses a Telnet login once Telnet is off', () => {
    const sim = buildOffice();
    sim.setHardening('router', 'telnet', false);
    routerLogin(sim, 'telnet');
    sim.runUntilIdle();
    expect(sim.dev('auditor').conns!.at(-1)!.status).not.toBe('open');
  });
});

describe('net-audit: the VPN', () => {
  it('lets a home device ride the tunnel to the file server while split tunneling is on', () => {
    const sim = buildOffice();
    homeProbe(sim);
    sim.runUntilIdle();
    expect(sim.events.filter((e) => e.type === 'ping-reply' && e.device === 'homedev' && e.from === IP.fileserver)).toHaveLength(1);
    expect(sim.events.some((e) => e.type === 'ping-fail')).toBe(false);
  });

  it('drops it at the laptop with split tunneling off, and the laptop still reaches the office', () => {
    const sim = buildOffice();
    sim.setVpn('router', { splitTunneling: false, auth: 'mfa' });
    expect(vpnHardened(sim)).toBe(true);
    expect(sim.dev('bookkeeper').gateway).toBe(IP.vpnRouter);
    homeProbe(sim);
    sim.ping('bookkeeper', IP.fileserver);
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-fail' && e.device === 'homedev' && e.reason === 'vpn-split-off')).toBe(true);
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'homedev')).toBe(false);
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'bookkeeper' && e.from === IP.fileserver)).toBe(true);
  });
});

describe('net-audit: the switch policy', () => {
  it('counts the switch as hardened only with port security, the empty ports shut, and the authentication server', () => {
    const sim = buildOffice();
    FIXES['switch-open'](sim);
    expect(switchHardened(sim)).toBe(false);
    sim.setHardening('sw', 'auth-server', true);
    expect(switchHardened(sim)).toBe(true);
    // The office still works through the secured ports.
    sim.ping('pc1', IP.fileserver);
    sim.runUntilIdle();
    expect(sim.events.some((e) => e.type === 'ping-reply' && e.device === 'pc1')).toBe(true);
  });
});

describe('net-audit: replay', () => {
  it('rebuilds the same network, reports, and register from the same actions', () => {
    const play = () => {
      const sim = buildOffice();
      const acts = [
        { type: 'audit-scan', device: 'auditor' },
        { type: 'rate-risk', device: 'auditor', finding: 'wifi-weak', likelihood: 'high', impact: 'high' },
        { type: 'harden', device: 'router', setting: 'telnet', on: false },
        { type: 'vpn-config', device: 'router', splitTunneling: false, auth: 'key' },
        { type: 'audit-scan', device: 'auditor' },
      ] as const;
      for (const a of acts) {
        applyAction(netAuditLab, sim, a);
        sim.runUntilIdle();
      }
      return JSON.stringify({ t: sim.t, devices: sim.devices });
    };
    expect(play()).toBe(play());
  });

  it('has a goal or question in every step but the last', () => {
    for (const s of netAuditLab.steps.slice(0, -1)) expect((s.goals?.length ?? 0) + (s.questions?.length ?? 0), s.id).toBeGreaterThan(0);
  });
});
