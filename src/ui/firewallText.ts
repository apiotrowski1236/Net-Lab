import { ruleText, type FwRule, type FwVerdict } from '../sim/firewall';
import { appForPort, appName, isReply, portLabel, type Conn } from '../sim/services';
import type { Sim } from '../sim/sim';
import type { IpPacket, SimEvent } from '../sim/types';

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

/** "Firewall A let the request in: rule 2, ALLOW in TCP ..." */
export function fwEventText(sim: Sim, e: FwEvent): string {
  const label = sim.devices[e.device]?.label ?? e.device;
  const what = isReply(e.pkt) ? 'reply' : 'request';
  const allowed = e.verdict.action === 'allow';
  const verb = allowed ? `let the ${what} ${e.dir === 'in' ? 'in' : 'out'}` : `blocked the ${what}`;
  return `${label} ${verb}: ${whyText(e.verdict, sim.devices[e.device]?.firewall?.rules)}.`;
}

/** For a packet a firewall dropped at time `t`: which firewall, and why. */
export function fwDenyText(sim: Sim, fwId: string | undefined, t: number): string {
  const label = fwId ? (sim.devices[fwId]?.label ?? fwId) : 'A firewall';
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t >= t - 1; i--) {
    const e = sim.events[i];
    if (e.type === 'firewall' && e.device === fwId && e.verdict.action === 'deny' && e.t <= t) {
      return `${label} blocked it: ${whyText(e.verdict, sim.devices[e.device]?.firewall?.rules)}.`;
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
  for (const d of Object.values(sim.devices)) {
    if (d.browser && d.browser.startedAt === since) reqs.add(d.browser.reqId);
    for (const c of d.conns ?? []) {
      if (c.t !== since) continue;
      conns.add(c.id);
      lines.push({ tone: c.status === 'pending' ? 'wait' : c.status === 'open' ? 'good' : 'bad', text: `${connTitle(sim, d.id, c)}: ${connResultText(sim, c)}` });
    }
  }
  const seen = new Set<string>();
  for (const e of sim.events) {
    if (e.t < since) continue;
    if (e.type === 'stray-reply' && e.pkt.app.kind === 'svc' && e.pkt.app.conn === 0) {
      const k = `stray ${e.device}`;
      if (!seen.has(k)) {
        seen.add(k);
        lines.push({ tone: 'bad', text: `The fake reply reached ${sim.devices[e.device]?.label ?? e.device}.` });
      }
      continue;
    }
    if (e.type !== 'firewall' || !startedBy(e.pkt, seqs, reqs, conns)) continue;
    // A ping's own line already says which firewall blocked it.
    if (e.pkt.app.kind === 'ping' && e.verdict.action === 'deny') continue;
    const k = `${e.device} ${e.dir} ${isReply(e.pkt)} ${e.verdict.by} ${e.verdict.ruleNo ?? ''} ${e.verdict.action}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push({ tone: e.verdict.action === 'allow' ? 'good' : 'bad', text: fwEventText(sim, e) });
  }
  return lines;
}
