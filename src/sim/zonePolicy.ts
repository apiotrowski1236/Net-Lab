import { logLine, type FwDir, type FwRuleInput, type FwVerdict } from './firewall';
import type { IpPacket, LogEntry } from './types';

/**
 * A zone policy (built for `segmentation`): a table on a firewall of which
 * zone may start a connection to which other zone, and for what. It writes the
 * firewall's rules (firewall.ts); there is no second filter. Run the firewall
 * stateful, so replies to allowed connections get back.
 *
 * Each zone sits behind one of the firewall's ports and has its own subnet.
 * The firewall engine matches addresses, not ports, so each zone's rules match
 * its subnet (`PolicyZone.net`).
 *
 * VALUES, for each ordered pair of inside zones (From, To)
 *   'allow'      ALLOW any protocol from From to To
 *   'deny'       DENY all
 *   'only:5001'  ALLOW TCP to port 5001, then DENY all
 * Same-zone traffic never reaches the firewall, so there is no same-zone cell.
 *
 * THE OUTSIDE (optional): nothing from it may start a connection inside
 * (DENY in), and every inside zone may reach it (ALLOW out).
 *
 * Every rule carries a note naming its pair ("Crew to Weapons"). Deny lines in
 * the firewall's log name the pair too: `fields.rule` is the note, and
 * `fields.ruleNo` the rule's number (see zoneLogLine).
 *
 * Sim methods: setupZonePolicy (from the scenario), setZonePolicy (the student).
 * State: `Device.zonePolicy` on the firewall.
 */

export interface PolicyService {
  port: number;
  /** "target data": shown as "Only target data (port 5001)". */
  name: string;
}

export interface PolicyZone {
  id: string;
  label: string;
  /** The firewall port this zone sits behind. */
  port: string;
  /** The zone's subnet ("10.0.10.0/24"). Its rules match it. */
  net: string;
  /** Services in this zone a policy may allow on their own. */
  services: PolicyService[];
  /** Said when a cell in this zone's row is set to Allow all. `{to}` is the other zone's label. */
  allowWarning?: string;
}

export type PolicyValue = 'allow' | 'deny' | `only:${number}`;

export interface ZonePolicy {
  zones: PolicyZone[];
  /** The untrusted side (the internet, a shore link): its firewall port and network. */
  outside?: { label: string; port: string; net: string };
  /** `${from}>${to}` -> value. Missing: 'allow'. */
  cells: Record<string, PolicyValue>;
  /** Firewall rule id -> the pair that rule belongs to ('outside' and 'inside' for the outside's rules). */
  written: Record<string, { from: string; to: string }>;
}

export const cellKey = (from: string, to: string): string => `${from}>${to}`;

export function newZonePolicy(zones: PolicyZone[], outside?: ZonePolicy['outside']): ZonePolicy {
  return { zones: zones.map((z) => ({ ...z, services: [...z.services] })), outside: outside && { ...outside }, cells: {}, written: {} };
}

export function cellValue(zp: ZonePolicy, from: string, to: string): PolicyValue {
  return zp.cells[cellKey(from, to)] ?? 'allow';
}

/** The port an 'only:' value allows. */
export function onlyPort(v: PolicyValue): number | undefined {
  return v.startsWith('only:') ? Number(v.slice(5)) : undefined;
}

export function isPolicyValue(v: string): v is PolicyValue {
  return v === 'allow' || v === 'deny' || /^only:\d{1,5}$/.test(v);
}

export function zoneLabel(zp: ZonePolicy, id: string): string {
  if (id === 'outside') return zp.outside?.label ?? 'Outside';
  if (id === 'inside') return 'inside';
  return zp.zones.find((z) => z.id === id)?.label ?? id;
}

/** "Crew to Weapons". */
export function pairName(zp: ZonePolicy, from: string, to: string): string {
  return `${zoneLabel(zp, from)} to ${zoneLabel(zp, to)}`;
}

/** The rules a zone policy writes, in order, each with the pair it belongs to. */
export function policyRules(zp: ZonePolicy): { rule: FwRuleInput; from: string; to: string }[] {
  const out: { rule: FwRuleInput; from: string; to: string }[] = [];
  for (const a of zp.zones) {
    for (const b of zp.zones) {
      if (a.id === b.id) continue;
      const v = cellValue(zp, a.id, b.id);
      const note = pairName(zp, a.id, b.id);
      const base = { dir: 'out' as FwDir, src: a.net, dst: b.net, note };
      const port = onlyPort(v);
      if (port !== undefined) out.push({ rule: { ...base, proto: 'tcp', dport: port, action: 'allow' }, from: a.id, to: b.id });
      out.push({ rule: { ...base, proto: 'any', dport: 'any', action: v === 'allow' ? 'allow' : 'deny' }, from: a.id, to: b.id });
    }
  }
  const o = zp.outside;
  if (o) {
    out.push({
      rule: { dir: 'in', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'deny', note: `${o.label} to inside` },
      from: 'outside',
      to: 'inside',
    });
    out.push({
      rule: { dir: 'out', proto: 'any', src: 'any', dst: o.net, dport: 'any', action: 'allow', note: `Inside to ${o.label}` },
      from: 'inside',
      to: 'outside',
    });
  }
  return out;
}

/** The pair whose rule decided a verdict, if a zone policy rule did. */
export function verdictPair(zp: ZonePolicy, v: FwVerdict): { from: string; to: string } | undefined {
  return v.ruleId ? zp.written[v.ruleId] : undefined;
}

/**
 * A zone-policy firewall's log line: like logLine, but it names the zones.
 * "DENY TCP 10.0.30.31:49153 -> 10.0.10.11:445 zone Crew -> Weapons (rule 7)".
 */
export function zoneLogLine(zp: ZonePolicy, pkt: IpPacket, dir: FwDir, v: FwVerdict): Omit<LogEntry, 'no' | 't' | 'device'> {
  const line = logLine(pkt, dir, v);
  const pair = verdictPair(zp, v);
  if (!pair || v.by !== 'rule') return line;
  const fields = { ...line.fields, rule: pairName(zp, pair.from, pair.to), ruleNo: v.ruleNo ?? 0 };
  const end = (ip: string, port?: number) => (port === undefined ? ip : `${ip}:${port}`);
  const what = pkt.app.kind === 'ping' ? (pkt.app.reply ? ' echo-reply' : ' echo-request') : '';
  const msg = `${v.action.toUpperCase()} ${pkt.proto.toUpperCase()} ${end(pkt.src, pkt.srcPort)} -> ${end(pkt.dst, pkt.dstPort)}${what} zone ${zoneLabel(zp, pair.from)} -> ${zoneLabel(zp, pair.to)} (rule ${v.ruleNo})`;
  return { ...line, msg, fields };
}
