import { describe, expect, it } from 'vitest';
import { aiCounts, type Tolerance } from '../../sim/ids';
import type { Sim } from '../../sim/sim';
import type { LogEntry } from '../../sim/types';
import { deviationWhy, idsOutcomeLines } from '../../ui/idsText';
import { INCIDENT, logsLab } from '.';
import {
  AI_EVENTS,
  at,
  BACKUP_BYTES,
  BASELINE,
  BROADCAST,
  buildUtility,
  C2,
  EXFIL,
  IP,
  LOG_DEVICES,
  MAC,
  PORT,
  replayArp,
  replayBackup,
  replayFlood,
  replayUpload,
  SCANNER,
  UPLOAD_BYTES,
  VAULT,
} from './scenario';

const step = (id: string) => logsLab.steps.find((s) => s.id === id)!;
const goal = (stepId: string, id: string) => step(stepId).goals!.find((g) => g.id === id)!;

const lines = (sim: Sim, dev: string, pred: (e: LogEntry) => boolean = () => true) => sim.dev(dev).logs.filter(pred);
const alerts = (sim: Sim, since = 0) => lines(sim, 'nids', (e) => e.t >= since && e.level === 'alert');
const anomalyFor = (sim: Sim, host: string) => alerts(sim).some((e) => e.fields?.signature === 'anomaly' && e.fields?.host === host);
const play = (sim: Sim, f: (sim: Sim) => void) => (f(sim), sim.runUntilIdle());

function withAnomaly(tol: Tolerance): Sim {
  const sim = buildUtility();
  sim.idsSetSignatures('nids', true);
  sim.idsRecordBaseline('nids', BASELINE);
  sim.idsSetAnomaly('nids', true, tol);
  return sim;
}

describe('logs lab: the night in the logs', () => {
  it('builds the same history every time, all of it before 08:00', () => {
    const a = buildUtility();
    const b = buildUtility();
    expect(JSON.stringify(a.devices)).toBe(JSON.stringify(b.devices));
    const all = LOG_DEVICES.flatMap((d) => a.dev(d).logs);
    expect(all.length).toBeGreaterThan(250);
    expect(all.length).toBeLessThan(500);
    expect(all.every((e) => e.t < 0)).toBe(true);
    expect(a.events).toEqual([]);
  });

  it('plants every indicator the lesson sends students to find', () => {
    const sim = buildUtility();
    expect(lines(sim, 'files', (e) => e.fields?.action === 'fail' && e.fields?.src === SCANNER)).toHaveLength(14);
    expect(lines(sim, 'fw', (e) => e.fields?.src === SCANNER && e.fields?.action === 'deny' && e.fields?.proto === 'tcp')).toHaveLength(41);
    expect(lines(sim, 'nids', (e) => e.fields?.signature === 'port-scan' && e.fields?.src === SCANNER)).toHaveLength(1);
    expect(lines(sim, 'fw', (e) => e.fields?.proto === 'icmp' && e.fields?.dst === BROADCAST)).toHaveLength(24);
    expect(lines(sim, 'fw', (e) => e.fields?.dst === C2 && e.fields?.threat === 'known-c2')).toHaveLength(1);
    expect(lines(sim, 'fw', (e) => e.fields?.app === 'ssh' && e.fields?.dport === 443)).toHaveLength(1);
    expect(lines(sim, 'pc2', (e) => e.fields?.proc === 'svc-update.exe')).toHaveLength(1);
    const exfil = lines(sim, 'fw', (e) => e.fields?.dst === EXFIL);
    expect(exfil.map((e) => [e.msg, e.t])).toEqual([[`ALLOW out TCP ${IP.pc2}:52110 -> ${EXFIL}:8443 rule 4 bytes=${UPLOAD_BYTES}`, at(3, 12, 20)]]);
    expect(lines(sim, 'fw', (e) => e.fields?.dst === VAULT && e.fields?.bytes === BACKUP_BYTES)).toHaveLength(1);
  });

  it('has incident 1041 from the scanner: denies, the scan alert, and failed sign-ins', () => {
    const sim = buildUtility();
    const q = sim.dev('siem').ids!.siem!;
    expect(q.incidents.map((i) => i.id)).toEqual([INCIDENT]);
    const inc = q.incidents[0];
    expect(inc.src).toBe(SCANNER);
    expect(inc.parts.map((p) => [p.kind, p.device, p.count])).toEqual([
      ['deny', 'fw', 41],
      ['scan', 'nids', 1],
      ['auth-fail', 'files', 14],
    ]);
    const line = lines(sim, 'siem', (e) => e.no === inc.logNo)[0];
    expect(line.fields).toMatchObject({ incident: INCIDENT, triage: 'open', kinds: 'deny,scan,auth-fail' });
  });

  it('times the clock so the lab starts at 08:00', () => {
    expect(at(7, 59)).toBe(-60_000);
    expect(at(0, 0)).toBe(-8 * 3600_000);
    expect(at(16, 0)).toBe(-16 * 3600_000);
  });

  it('keeps every device 130 apart on the 1000 x 600 map', () => {
    const devs = Object.values(buildUtility().devices);
    for (const d of devs) {
      expect(d.x).toBeGreaterThanOrEqual(60);
      expect(d.x).toBeLessThanOrEqual(940);
      expect(d.y).toBeGreaterThanOrEqual(60);
      expect(d.y).toBeLessThanOrEqual(540);
      for (const e of devs) if (d !== e) expect(Math.hypot(d.x - e.x, d.y - e.y), `${d.id} to ${e.id}`).toBeGreaterThanOrEqual(130);
    }
  });
});

describe('logs lab: the replays', () => {
  it('the ARP replay trips the arp-spoof signature, naming the intruder MAC', () => {
    const sim = buildUtility();
    play(sim, replayArp);
    expect(alerts(sim)).toEqual([]);
    sim.idsSetSignatures('nids', true);
    play(sim, replayArp);
    expect(alerts(sim).map((e) => e.fields)).toEqual([expect.objectContaining({ signature: 'arp-spoof', ip: IP.gateway, mac: MAC.mal })]);
  });

  it('no signature matches the upload: it goes out and the sensor stays quiet', () => {
    const sim = buildUtility();
    sim.idsSetSignatures('nids', true);
    const t = sim.t;
    play(sim, replayUpload);
    expect(lines(sim, 'fw', (e) => e.t >= t && e.fields?.dst === EXFIL && e.fields?.bytes === UPLOAD_BYTES)).toHaveLength(1);
    expect(alerts(sim, t)).toEqual([]);
    expect(sim.dev('pc2').conns!.at(-1)!.status).toBe('open');
  });

  it('follows the deviation table: Loose misses both, Medium and Strict catch the upload and the backup', () => {
    const want: Record<Tolerance, boolean> = { loose: false, medium: true, strict: true };
    for (const tol of ['loose', 'medium', 'strict'] as Tolerance[]) {
      const sim = withAnomaly(tol);
      play(sim, replayUpload);
      play(sim, replayBackup);
      expect(anomalyFor(sim, IP.pc2), `upload at ${tol}`).toBe(want[tol]);
      expect(anomalyFor(sim, IP.backup), `backup at ${tol}`).toBe(want[tol]);
      const [up, bk] = sim.dev('nids').ids!.sensor!.judged.slice(-2);
      expect([up.deviation, bk.deviation]).toEqual([3, 2]);
    }
  });

  it('daytime work that is a little odd only alerts at Strict', () => {
    for (const [tol, alerted] of [
      ['medium', false],
      ['strict', true],
    ] as const) {
      const sim = withAnomaly(tol);
      play(sim, (s) => s.connectService('pc1', IP.backup, 873));
      expect(anomalyFor(sim, IP.pc1), tol).toBe(alerted);
    }
  });

  it('in prevention mode shuts port 9 on the flood, and blocks the backup server on a false alert', () => {
    const sim = withAnomaly('medium');
    sim.idsSetPrevention('nids', true);
    play(sim, replayFlood);
    expect(sim.dev('sw').switchSec!.ports[PORT.mal]?.shutdown).toBe('admin');
    expect(lines(sim, 'nids', (e) => e.source === 'ips' && e.fields?.port === PORT.mal)).toHaveLength(1);
    const t = sim.t;
    play(sim, replayBackup);
    expect(lines(sim, 'nids', (e) => e.source === 'ips' && e.fields?.blocked === IP.backup)).toHaveLength(1);
    expect(sim.dev('backup').conns!.at(-1)!.status).toBe('no-answer');
    expect(lines(sim, 'fw', (e) => e.t >= t && e.fields?.action === 'deny' && e.fields?.src === IP.backup)).not.toHaveLength(0);
  });

  it('lets the known-c2 and SSH-on-443 connections out through rule 3, the HTTPS rule (step 9 says so)', () => {
    const sim = buildUtility();
    const c2 = lines(sim, 'fw', (e) => e.fields?.dst === C2 && e.fields?.threat === 'known-c2');
    const ssh = lines(sim, 'fw', (e) => e.fields?.app === 'ssh' && e.fields?.dport === 443);
    expect(c2).toHaveLength(1);
    expect(ssh).toHaveLength(1);
    for (const e of [...c2, ...ssh]) expect(e.msg).toMatch(/ALLOW out .* rule 3\b/);
    expect(sim.dev('fw').firewall!.rules[2]).toMatchObject({ dir: 'out', dport: 443, action: 'allow' });
  });

  it('puts the prevention block at the top of the firewall list, as rule 1 (step 6 says so)', () => {
    const sim = withAnomaly('medium');
    sim.idsSetPrevention('nids', true);
    play(sim, replayBackup);
    const top = sim.dev('fw').firewall!.rules[0];
    expect(top.action).toBe('deny');
    expect(top.src).toContain(IP.backup);
  });

  it('without prevention, the flood fills the switch table and nothing is shut', () => {
    const sim = buildUtility();
    sim.idsSetSignatures('nids', true);
    play(sim, replayFlood);
    expect(alerts(sim).some((e) => e.fields?.signature === 'mac-flood')).toBe(true);
    expect(sim.dev('sw').switchSec!.ports[PORT.mal]?.shutdown).toBeUndefined();
  });
});

describe('logs lab: goals', () => {
  it('step 4 needs the signature set on: with it off, silence proves nothing', () => {
    const sim = buildUtility();
    play(sim, replayUpload);
    expect(goal('something-new', 'missed').check({ sim, since: 0 })).toBe(false);
    sim.idsSetSignatures('nids', true);
    const since = sim.t;
    play(sim, replayUpload);
    expect(goal('something-new', 'missed').check({ sim, since })).toBe(true);
  });

  it('step 5 does not accept Loose', () => {
    const sim = withAnomaly('loose');
    expect(goal('baseline', 'anomaly-on').check({ sim, since: 0 })).toBe(false);
    sim.idsSetAnomaly('nids', true, 'medium');
    expect(goal('baseline', 'anomaly-on').check({ sim, since: 0 })).toBe(true);
  });

  it('step 6 setup turns on what step 5 left off, and leaves Strict alone', () => {
    const sim = buildUtility();
    step('nips').setup!(sim);
    const s = sim.dev('nids').ids!.sensor!;
    expect([s.signatures, s.anomaly, s.tolerance, !!s.baseline, s.prevention]).toEqual([true, true, 'medium', true, false]);
    sim.idsSetAnomaly('nids', true, 'strict');
    step('nips').setup!(sim);
    expect(s.tolerance).toBe('strict');
  });

  it('a threshold of 0.70 or 0.75 catches all three attacks with at most one false alert; nothing else does', () => {
    const sim = buildUtility();
    sim.aiScore('siem', AI_EVENTS);
    const q = sim.dev('siem').ids!.siem!;
    const good = (th: number) => {
      const c = aiCounts(q, th);
      return c.caught === 3 && c.falseAlerts <= 1;
    };
    const passing = Array.from({ length: 21 }, (_, i) => i / 20).filter(good);
    expect(passing).toEqual([0.7, 0.75]);
  });

  it('the threshold goal needs both ends tried after scoring, then a good setting left in place', () => {
    const sim = buildUtility();
    const good = goal('threshold', 'good-threshold');
    const check = () => good.check({ sim, since: 0 });
    // Tries before the events are scored do not count.
    sim.aiSetThreshold('siem', 1);
    sim.aiSetThreshold('siem', 0);
    sim.t += 1000;
    sim.aiScore('siem', AI_EVENTS);
    sim.t += 1000;
    // A good setting straight away is not enough: the student has not seen either end.
    sim.aiSetThreshold('siem', 0.7);
    expect(check()).toBe(false);
    // 0.95 still alerts on the ARP spoof, so it is not the "1.00" the questions ask about.
    sim.t += 1000;
    sim.aiSetThreshold('siem', 0.95);
    sim.aiSetThreshold('siem', 0.05);
    expect(goal('threshold', 'tried-high').check({ sim, since: 0 })).toBe(false);
    expect(goal('threshold', 'tried-low').check({ sim, since: 0 })).toBe(false);
    sim.t += 1000;
    sim.aiSetThreshold('siem', 1);
    expect(goal('threshold', 'tried-high').check({ sim, since: 0 })).toBe(true);
    expect(goal('threshold', 'tried-low').check({ sim, since: 0 })).toBe(false);
    sim.t += 1000;
    sim.aiSetThreshold('siem', 0);
    expect(goal('threshold', 'tried-low').check({ sim, since: 0 })).toBe(true);
    // Sliding past a good value and stopping at 0.80 misses the scan.
    sim.t += 1000;
    sim.aiSetThreshold('siem', 0.8);
    expect(check()).toBe(false);
    sim.t += 1000;
    sim.aiSetThreshold('siem', 0.75);
    expect(check()).toBe(true);
  });

  it('tries from before the step started do not count', () => {
    const sim = buildUtility();
    sim.aiScore('siem', AI_EVENTS);
    sim.aiSetThreshold('siem', 1);
    sim.aiSetThreshold('siem', 0);
    sim.aiSetThreshold('siem', 0.75);
    sim.t += 1000;
    expect(goal('threshold', 'good-threshold').check({ sim, since: sim.t })).toBe(false);
  });

  it('the scan IoC goal takes a scan line, not the broadcast pings or the incident', () => {
    const sim = buildUtility();
    const g = goal('ioc-hunt', 'ioc-scan');
    const open = (e: LogEntry) => g.check({ sim, since: 0, ev: { type: 'ui:open-log', device: e.device, entry: e } });
    expect(open(lines(sim, 'fw', (e) => e.fields?.proto === 'icmp' && e.fields?.src === SCANNER)[0])).toBe(false);
    expect(open(lines(sim, 'siem', (e) => e.fields?.incident === INCIDENT)[0])).toBe(false);
    expect(open(lines(sim, 'nids', (e) => e.fields?.signature === 'port-scan')[0])).toBe(true);
    expect(open(lines(sim, 'fw', (e) => e.fields?.src === SCANNER && e.fields?.proto === 'tcp')[0])).toBe(true);
  });
});

describe('logs lab: result lines', () => {
  it('anomaly detection with no baseline says it could not score the upload', () => {
    const sim = buildUtility();
    sim.idsSetSignatures('nids', true);
    sim.idsSetAnomaly('nids', true, 'medium');
    const t = sim.t;
    play(sim, replayUpload);
    expect(idsOutcomeLines(sim, t).map((l) => l.text)).toEqual([
      'NIDS sensor saw the traffic. No signature matched it, so no alert.',
      'NIDS sensor: anomaly detection has no baseline yet, so it could not score this.',
    ]);
  });

  it('the alert and the score table name a new address, not a "peer"', () => {
    const sim = withAnomaly('medium');
    const t = sim.t;
    play(sim, replayUpload);
    expect(idsOutcomeLines(sim, t)[0].text).toContain(`new address ${EXFIL}`);
    const j = sim.dev('nids').ids!.sensor!.judged.find((x) => x.host === IP.pc2)!;
    expect(deviationWhy(j)).toBe(`outside office hours (03:12), never-used address ${EXFIL}, 90 MB, over 10x usual`);
  });

  it('a signature set turned on after the replay went past says detection was off, not that nothing matched', () => {
    const sim = buildUtility();
    const t = sim.t;
    play(sim, replayArp);
    sim.idsSetSignatures('nids', true);
    expect(idsOutcomeLines(sim, t).map((l) => l.text)).toEqual(['NIDS sensor saw the traffic while its detection was off. No alert. Replay it to check it with detection on.']);
    // With the set on from the start, the same replay alerts.
    const t2 = sim.t;
    play(sim, replayArp);
    expect(idsOutcomeLines(sim, t2)[0].text).toContain('arp-spoof');
  });

  it('says anomaly detection is off when the baseline is recorded but the switch is not on', () => {
    const sim = withAnomaly('medium');
    sim.idsSetAnomaly('nids', false, 'medium');
    const t = sim.t;
    play(sim, replayUpload);
    expect(idsOutcomeLines(sim, t).map((l) => l.text)).toEqual([
      'NIDS sensor saw the traffic. No signature matched it, so no alert.',
      'NIDS sensor: anomaly detection is off, so it did not score this.',
    ]);
  });

  it('names the tolerance the upload was scored at, even if the student changes it afterward', () => {
    const sim = withAnomaly('loose');
    const t = sim.t;
    play(sim, replayUpload);
    const quiet = () => idsOutcomeLines(sim, t).map((l) => l.text).find((x) => x.includes('deviation 3'));
    expect(quiet()).toContain('Loose alerts at a deviation of 4 or more, so no alert.');
    sim.idsSetAnomaly('nids', true, 'medium');
    expect(quiet()).toContain('Loose alerts at a deviation of 4 or more (the tolerance when this was scored; replay it to score it at Medium), so no alert.');
    expect(quiet()).not.toContain('Medium alerts at a deviation of 2');
  });
});
