import { ruleText, type FwRule, type FwVerdict } from '../sim/firewall';
import { appForPort, appName, isReply, portLabel, type Conn } from '../sim/services';
import type { Sim } from '../sim/sim';
import type { IpPacket, SimEvent } from '../sim/types';
import { cellValue, onlyPort, pairName, verdictPair, zoneLabel } from '../sim/zonePolicy';

// Student-facing words for firewalls, connections, and scans (src/sim/firewall.ts
// and src/sim/services.ts). The map, the lesson's test buttons, and the
// inspector all explain decisions with these, so they say the same thing.

type FwEvent = Extract<SimEvent, { type: 'firewall' }>;

/** Why a firewall decided what it did, in a short clause. */
export function whyText(v: FwVerdict, rules: FwRule[] | undefined): string {
  const rule = v.ruleId ? rules?.find((r) => r.id === v.ruleId) : undefined;
  switch (v.by) {
    case 'rule':
      return rule ? `rule ${v.ruleNo}, ${ruleText(rule)}` : `rule ${v.ruleNo}`;
    case 'implicit':
      return 'no rule matched (the implicit deny)';
    case 'state':
      return 'it answers a conversation in the connection table';
    case 'no-state':
      return 'it looks like a reply, but it answers no conversation in the connection table';
    case 'app':
      return `rule ${v.ruleNo} allows that port, but the program inside is ${appName(v.app ?? '?')}, not ${appName(v.expected ?? '?')}`;
  }
}

/**
 * For a firewall with a zone policy (segmentation): the decision in the
 * policy's words ("its zone policy denies Crew to Weapons"). Undefined when no
 * zone policy rule decided it.
 */
export function zoneWhyText(sim: Sim, fwId: string, v: FwVerdict): string | undefined {
  const zp = sim.devices[fwId]?.zonePolicy;
  const pair = zp && v.by === 'rule' ? verdictPair(zp, v) : undefined;
  if (!zp || !pair) return undefined;
  const outside = zp.outside?.label ?? 'the outside';
  const the = `the ${outside.charAt(0).toLowerCase()}${outside.slice(1)}`;
  if (pair.from === 'outside') return `its zone policy lets nothing from ${the} start a connection inside`;
  if (pair.to === 'outside') return `its zone policy lets inside computers reach ${the}`;
  const cell = cellValue(zp, pair.from, pair.to);
  const port = onlyPort(cell);
  const service = port === undefined ? undefined : zp.zones.find((z) => z.id === pair.to)?.services.find((x) => x.port === port);
  const only = port === undefined ? '' : `port ${port}${service ? ` (${service.name})` : ''} from ${zoneLabel(zp, pair.from)} to ${zoneLabel(zp, pair.to)}`;
  if (v.action === 'allow') return port === undefined ? `its zone policy allows all traffic from ${zoneLabel(zp, pair.from)} to ${zoneLabel(zp, pair.to)}` : `its zone policy allows ${only}`;
  return port === undefined ? `its zone policy denies ${pairName(zp, pair.from, pair.to)}` : `its zone policy allows only ${only}`;
}

/** "Firewall A let the request in: rule 2, ALLOW in TCP ..." */
export function fwEventText(sim: Sim, e: FwEvent): string {
  const label = sim.devices[e.device]?.label ?? e.device;
  const what = isReply(e.pkt) ? 'reply' : 'request';
  const allowed = e.verdict.action === 'allow';
  const zoned = !!sim.devices[e.device]?.zonePolicy;
  const verb = allowed ? `let the ${what} ${zoned ? 'through' : e.dir === 'in' ? 'in' : 'out'}` : `blocked the ${what}`;
  return `${label} ${verb}: ${zoneWhyText(sim, e.device, e.verdict) ?? whyText(e.verdict, sim.devices[e.device]?.firewall?.rules)}.`;
}

/** For a packet a firewall dropped at time `t`: which firewall, and why. */
export function fwDenyText(sim: Sim, fwId: string | undefined, t: number): string {
  const label = fwId ? (sim.devices[fwId]?.label ?? fwId) : 'A firewall';
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t >= t - 1; i--) {
    const e = sim.events[i];
    if (e.type === 'firewall' && e.device === fwId && e.verdict.action === 'deny' && e.t <= t) {
      return `${label} blocked it: ${zoneWhyText(sim, e.device, e.verdict) ?? whyText(e.verdict, sim.devices[e.device]?.firewall?.rules)}.`;
    }
  }
  return `${label} blocked it.`;
}

/** Map marker on the firewall for one decision. */
export function fwMarker(e: FwEvent): { device: string; text: string; tone: 'good' | 'bad' } {
  const v = e.verdict;
  const tag = v.by === 'rule' ? `rule ${v.ruleNo}` : v.by === 'implicit' ? 'implicit deny' : v.by === 'state' ? 'reply' : v.by === 'no-state' ? 'no connection' : 'wrong program';
  return { device: e.device, text: `${v.action === 'allow' ? 'allowed' : 'denied'} (${tag})`, tone: v.action === 'allow' ? 'good' : 'bad' };
}

/** Map markers for connections and stray replies. */
export function connMarker(e: SimEvent): { device: string; text: string; tone: 'good' | 'bad' | 'muted' } | null {
  if (e.type === 'stray-reply') return { device: e.device, text: 'unasked-for reply arrived', tone: 'bad' };
  if (e.type !== 'conn-result') return null;
  const c = e.conn;
  if (c.status === 'open') return { device: e.device, text: 'connected', tone: 'good' };
  if (c.status === 'closed') return { device: e.device, text: 'port closed', tone: 'muted' };
  return c.reason === 'timeout' ? { device: e.device, text: 'no answer', tone: 'bad' } : null;
}

/** "Patient → Web server (10.0.1.10) port 443 (HTTPS)", plus the program when it isn't the port's own. */
export function connTitle(sim: Sim, devId: string, c: Conn): string {
  const who = sim.devices[devId]?.label ?? devId;
  const owner = sim.deviceByIp(c.to);
  const to = owner ? `${owner.label} (${c.to})` : c.to;
  const expected = appForPort(c.proto, c.port);
  const odd = c.app !== expected && c.app !== c.proto;
  return `${who} → ${to} port ${portLabel(c.port, c.proto)}${odd ? ` using a ${appName(c.app).toLowerCase()}` : ''}`;
}

/** How a connection ended, in a sentence. */
export function connResultText(sim: Sim, c: Conn): string {
  switch (c.status) {
    case 'pending':
      return 'waiting for an answer…';
    case 'open':
      return c.banner ? `connected. It answered: "${c.banner}"` : 'connected.';
    case 'closed':
      return 'the computer answered, but nothing listens on that port.';
    case 'no-answer':
      if (c.reason === 'firewall') return `no answer. ${fwDenyText(sim, c.at, c.doneAt ?? 0)}`;
      if (c.reason === 'timeout') return 'no answer. Nothing came back.';
      return `no answer. ${c.at ? (sim.devices[c.at]?.label ?? c.at) : 'The network'} dropped it.`;
  }
}

export interface OutcomeLine {
  tone: 'good' | 'bad' | 'wait';
  text: string;
}

/** Does this packet belong to something started at `since` (a lesson button's moment)? */
function startedBy(pkt: IpPacket, seqs: Set<number>, reqs: Set<number>, conns: Set<number>): boolean {
  const a = pkt.app;
  switch (a.kind) {
    case 'ping':
      return seqs.has(a.seq);
    case 'http-req':
    case 'http-res':
      return reqs.has(a.reqId);
    case 'svc':
      return a.conn === 0 || conns.has(a.conn);
    default:
      return false;
  }
}

/**
 * Lines for the lesson's "what happened" list after a test button: each
 * connection the button started, any unasked-for replies that arrived, and
 * every firewall decision on those packets (which rule matched).
 */
export function connOutcomeLines(sim: Sim, since: number): OutcomeLine[] {
  const lines: OutcomeLine[] = [];
  const seqs = new Set<number>();
  const reqs = new Set<number>();
  const conns = new Set<number>();
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t >= since; i--) {
    const e = sim.events[i];
    if (e.type === 'ping-sent' && e.t === since) seqs.add(e.seq);
  }
  // Traffic to or from an attacker: getting through is the bad outcome, being blocked the good one.
  const hostile = new Set(Object.values(sim.devices).flatMap((d) => (d.attacker ? d.ifaces.flatMap((i) => (i.ip ? [i.ip] : [])) : [])));
  const tone = (ok: boolean, pkt: { src: string; dst: string }): OutcomeLine['tone'] =>
    ok !== (hostile.has(pkt.src) || hostile.has(pkt.dst)) ? 'good' : 'bad';
  /** Connections that ended with a firewall's deny: their own line already says why. */
  const explained = new Set<number>();
  for (const d of Object.values(sim.devices)) {
    if (d.browser && d.browser.startedAt === since) reqs.add(d.browser.reqId);
    for (const c of d.conns ?? []) {
      if (c.t !== since) continue;
      conns.add(c.id);
      if (c.reason === 'firewall') explained.add(c.id);
      const ends = { src: d.ifaces.find((i) => i.ip)?.ip ?? '', dst: c.to };
      lines.push({ tone: c.status === 'pending' ? 'wait' : tone(c.status === 'open', ends), text: `${connTitle(sim, d.id, c)}: ${connResultText(sim, c)}` });
    }
  }
  const seen = new Set<string>();
  // A forged packet (conn 0) belongs to no connection, so the only clue that this
  // button sent it is time: it arrives after the press, never at the same moment.
  const forged = (pkt: IpPacket) => pkt.app.kind === 'svc' && pkt.app.conn === 0;
  for (const e of sim.events) {
    if (e.t < since) continue;
    if ((e.type === 'stray-reply' || e.type === 'firewall') && forged(e.pkt) && e.t === since) continue;
    if (e.type === 'stray-reply' && forged(e.pkt)) {
      const k = `stray ${e.device}`;
      if (!seen.has(k)) {
        seen.add(k);
        lines.push({ tone: 'bad', text: `The fake reply got through to ${sim.devices[e.device]?.label ?? e.device}.` });
      }
      continue;
    }
    if (e.type !== 'firewall' || !startedBy(e.pkt, seqs, reqs, conns)) continue;
    // A ping's or a browser's own line already says which firewall blocked it.
    const kind = e.pkt.app.kind;
    if (e.verdict.action === 'deny' && (kind === 'ping' || kind === 'http-req' || kind === 'http-res')) continue;
    if (e.verdict.action === 'deny' && kind === 'svc' && explained.has(e.pkt.app.conn)) continue;
    const k = `${e.device} ${e.dir} ${isReply(e.pkt)} ${e.verdict.by} ${e.verdict.ruleNo ?? ''} ${e.verdict.action}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push({ tone: tone(e.verdict.action === 'allow', e.pkt), text: fwEventText(sim, e) });
  }
  return lines;
}
