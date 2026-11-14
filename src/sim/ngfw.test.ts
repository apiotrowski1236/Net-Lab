import { describe, expect, it } from 'vitest';
import { evaluate, firstMatch, logLine, newFirewall, ruleMatches, ruleText, type FwRuleInput } from './firewall';
import { appMatches, ruleAppName, signatureOf } from './ngfw';
import type { IpPacket } from './types';

const svc = (app: string, dport: number, text?: string): IpPacket => ({
  src: '10.0.2.10',
  dst: '203.0.113.66',
  ttl: 64,
  proto: 'tcp',
  srcPort: 50000,
  dstPort: dport,
  app: { kind: 'svc', conn: 1, app, reply: false, text },
});
const get = (path: string, encrypted = true): IpPacket => ({
  src: '203.0.113.66',
  dst: '10.0.1.10',
  ttl: 64,
  proto: 'tcp',
  srcPort: 50001,
  dstPort: encrypted ? 443 : 80,
  encrypted,
  app: { kind: 'http-req', method: 'GET', host: 'achospital.example', path, reqId: 1 },
});

const OUT_ANY: FwRuleInput = { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'allow' };
const NO_REMOTE: FwRuleInput = { dir: 'out', proto: 'any', src: 'any', dst: 'any', dport: 'any', app: 'remote-control', action: 'deny' };
const HTTPS_IN: FwRuleInput = { dir: 'in', proto: 'tcp', src: 'any', dst: '10.0.1.10', dport: 443, action: 'allow' };

describe('application rules', () => {
  it('match the program on any port, and "web" covers HTTP and HTTPS', () => {
    expect(appMatches('remote-control', svc('remote-control', 8443))).toBe(true);
    expect(appMatches('remote-control', svc('https', 443))).toBe(false);
    expect(appMatches('web', get('/', true))).toBe(true);
    expect(appMatches('web', get('/', false))).toBe(true);
    expect(appMatches('any', svc('ssh', 22))).toBe(true);
    expect(ruleAppName('web')).toBe('Web browsing');
    expect(ruleText({ ...NO_REMOTE })).toContain('(program: Remote-control tool)');
  });

  it('are used only by a next-generation firewall', () => {
    const fw = newFirewall('outside', 'stateful', [NO_REMOTE, OUT_ANY]);
    expect(evaluate(fw, svc('remote-control', 8443), 'out')).toMatchObject({ action: 'allow', ruleNo: 2 });
    fw.mode = 'stateless';
    expect(evaluate(fw, svc('remote-control', 8443), 'out')).toMatchObject({ action: 'allow', ruleNo: 2 });
    fw.mode = 'ngfw';
    expect(evaluate(fw, svc('remote-control', 8443), 'out')).toMatchObject({ action: 'deny', ruleNo: 1 });
    expect(evaluate(fw, svc('https', 443), 'out')).toMatchObject({ action: 'allow', ruleNo: 2 });
  });

  it('are skipped by ruleMatches and firstMatch unless the caller says the firewall sees programs', () => {
    const fw = newFirewall('outside', 'stateful', [NO_REMOTE, OUT_ANY]);
    const p = svc('remote-control', 8443);
    expect(ruleMatches(fw.rules[0], p, 'out')).toBe(false);
    expect(firstMatch(fw.rules, p, 'out')).toBe(1);
    expect(firstMatch(fw.rules, p, 'out')).toBe(evaluate(fw, p, 'out').ruleNo! - 1);
    expect(firstMatch(fw.rules, p, 'out', true)).toBe(0);
  });
});

describe('intrusion prevention', () => {
  it('finds known attack patterns in what a request carries', () => {
    expect(signatureOf(get("/appointments?id=7' OR '1'='1"))?.id).toBe('sql-injection');
    expect(signatureOf(get('/files?name=../../etc/passwd'))?.id).toBe('path-traversal');
    expect(signatureOf(get('/appointments?id=7'))).toBeUndefined();
    expect(signatureOf(svc('telnet', 23, 'ls; cat /etc/passwd'))?.id).toBe('command-injection');
  });

  it('denies an attack a rule allowed, only when on and only on a next-generation firewall', () => {
    const fw = newFirewall('outside', 'ngfw', [HTTPS_IN]);
    const attack = get("/appointments?id=7' OR '1'='1");
    expect(evaluate(fw, attack, 'in').action).toBe('allow');
    fw.ips = true;
    const v = evaluate(fw, attack, 'in');
    expect(v).toMatchObject({ action: 'deny', by: 'ips', signature: 'sql-injection', ruleNo: 1 });
    expect(evaluate(fw, get('/appointments?id=7'), 'in').action).toBe('allow');
    const line = logLine(attack, 'in', v);
    expect(line.level).toBe('alert');
    expect(line.msg).toBe('DENY in TCP 203.0.113.66:50001 -> 10.0.1.10:443 ips signature sql-injection (rule 1 allowed the port)');
    expect(line.fields?.signature).toBe('sql-injection');
    fw.mode = 'stateful';
    expect(evaluate(fw, attack, 'in').action).toBe('allow');
  });
});
