import { describe, expect, it } from 'vitest';
import { aiCounts, type Tolerance } from '../../sim/ids';
import type { Sim } from '../../sim/sim';
import type { LogEntry } from '../../sim/types';
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
    expect(goal('threshold', 'good-threshold').check({ sim, since: 0 })).toBe(false);
    sim.aiSetThreshold('siem', 0.7);
    expect(goal('threshold', 'good-threshold').check({ sim, since: 0 })).toBe(true);
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
