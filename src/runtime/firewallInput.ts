import { isIp, isPrefix, normalizePrefix, prefixLen } from '../sim/addr';
import { ruleText, type FwAction, type FwDir, type FwProto, type FwRule, type FwRuleInput } from '../sim/firewall';
import { portForName } from '../sim/services';
import type { Sim } from '../sim/sim';
import type { Checked } from './toolInput';

// Checks for what students type into the firewall rule editor and the port
// scanner. Each returns the cleaned-up value, or a message that says what's
// wrong in the student's terms. The answer key goes through the same checks.

/** A rule as the editor holds it: every field as typed. */
export interface RuleDraft {
  dir: string;
  proto: string;
  src: string;
  dst: string;
  dport: string;
  sport: string;
  action: string;
  note?: string;
}

const ANY = /^(any|all|\*|)$/i;

const ADDR_FORMAT = 'Type any, an IP address like 10.0.1.10, or a network like 198.51.100.0/24.';
const PORT_FORMAT = 'Type a port number from 1 to 65535, a service name like https, or any.';

/** The editor's starting fields for an existing rule (or a blank one). */
export function ruleDraft(r?: FwRule | FwRuleInput): RuleDraft {
  if (!r) return { dir: 'in', proto: 'tcp', src: 'any', dst: '', dport: '', sport: 'any', action: 'allow' };
  return {
    dir: r.dir,
    proto: r.proto,
    src: r.src,
    dst: r.dst,
    dport: String(r.dport),
    sport: String(r.sport ?? 'any'),
    action: r.action,
    note: r.note,
  };
}

/** A source or destination: 'any', an address, or a network. */
export function checkRuleAddress(sim: Sim, raw: string, field: 'src' | 'dst'): Checked<{ value: string }> {
  const side = field === 'src' ? 'source' : 'destination';
  const s = raw.trim().replace(/\s+/g, '');
  if (ANY.test(s)) return { ok: true, value: 'any' };
  if (isIp(s)) return { ok: true, value: s };
  const named = Object.values(sim.devices).find((d) => d.label.toLowerCase() === raw.trim().toLowerCase());
  if (named) {
    const ip = named.ifaces.find((i) => i.ip)?.ip;
    if (ip) return { ok: false, field, msg: `A firewall matches addresses, not names. ${named.label} is ${ip}.`, suggest: ip };
    return { ok: false, field, msg: `A firewall matches addresses, not names, and ${named.label} has no IP address.` };
  }
  const star = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\*$/.exec(s);
  if (star) {
    const net = `${star[1]}.${star[2]}.${star[3]}.0/24`;
    return { ok: false, field, msg: `Write a network with a slash. ${net} means every address that starts with ${star[1]}.${star[2]}.${star[3]}.`, suggest: net };
  }
  if (isPrefix(s)) {
    const len = prefixLen(s);
    if (len === 32) return { ok: true, value: s.split('/')[0] };
    if (len === 0) return { ok: true, value: 'any' };
    const norm = normalizePrefix(s);
    if (norm !== s) return { ok: false, field, msg: `A network starts at its first address. Did you mean ${norm}?`, suggest: norm };
    return { ok: true, value: norm };
  }
  if (/^\d+$/.test(s)) return { ok: false, field, msg: `That looks like a port. The ${side} is an address. ${ADDR_FORMAT}` };
  return { ok: false, field, msg: `That isn't an address the firewall understands. ${ADDR_FORMAT}` };
}

/** A port: 'any', a number, or a well-known service name. */
export function checkRulePort(raw: string, proto: FwProto, field: 'dport' | 'sport'): Checked<{ value: number | 'any' }> {
  const s = raw.trim();
  const which = field === 'sport' ? 'source port' : 'port';
  if (ANY.test(s)) return { ok: true, value: 'any' };
  if (proto === 'icmp') return { ok: false, field, msg: `ICMP (ping) has no ports. Set the ${which} to any.`, suggest: 'any' };
  if (/^\d+\s*[-–:]\s*\d+$/.test(s)) return { ok: false, field, msg: 'One port per rule. Write a rule for each port you need.' };
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= 65535) return { ok: true, value: n };
    return { ok: false, field, msg: `Ports go from 1 to 65535. ${PORT_FORMAT}` };
  }
  const named = portForName(s);
  if (named !== undefined) return { ok: true, value: named };
  if (isIp(s)) return { ok: false, field, msg: `That's an address. The ${which} is a number, like 443 for HTTPS.` };
  return { ok: false, field, msg: `That isn't a port. ${PORT_FORMAT}` };
}

const DIRS: FwDir[] = ['in', 'out'];
const PROTOS: FwProto[] = ['tcp', 'udp', 'icmp', 'any'];
const ACTIONS: FwAction[] = ['allow', 'deny'];

function sameRule(a: FwRuleInput, b: FwRuleInput): boolean {
  return (
    a.dir === b.dir &&
    a.proto === b.proto &&
    a.src === b.src &&
    a.dst === b.dst &&
    a.dport === b.dport &&
    (a.sport ?? 'any') === (b.sport ?? 'any') &&
    a.action === b.action
  );
}

/** A whole rule. `editing` is the id of the rule being changed, so it doesn't count as a duplicate of itself. */
export function checkRule(sim: Sim, fwId: string, d: RuleDraft, editing?: string): Checked<{ rule: FwRuleInput }> {
  const dir = d.dir.trim().toLowerCase() as FwDir;
  const proto = d.proto.trim().toLowerCase() as FwProto;
  const action = d.action.trim().toLowerCase() as FwAction;
  if (!DIRS.includes(dir)) return { ok: false, field: 'dir', msg: 'Pick a direction: in (arriving from outside) or out.' };
  if (!PROTOS.includes(proto)) return { ok: false, field: 'proto', msg: 'Pick a protocol: TCP, UDP, ICMP, or any.' };
  if (!ACTIONS.includes(action)) return { ok: false, field: 'action', msg: 'Pick an action: allow or deny.' };
  const src = checkRuleAddress(sim, d.src, 'src');
  if (!src.ok) return src;
  const dst = checkRuleAddress(sim, d.dst, 'dst');
  if (!dst.ok) return dst;
  const dport = checkRulePort(d.dport, proto, 'dport');
  if (!dport.ok) return dport;
  const sport = checkRulePort(d.sport, proto, 'sport');
  if (!sport.ok) return sport;
  const rule: FwRuleInput = { dir, proto, src: src.value, dst: dst.value, dport: dport.value, action };
  if (sport.value !== 'any') rule.sport = sport.value;
  if (d.note?.trim()) rule.note = d.note.trim();
  const fw = sim.devices[fwId]?.firewall;
  const twin = fw?.rules.findIndex((r) => r.id !== editing && sameRule(r, rule)) ?? -1;
  if (twin >= 0) return { ok: false, msg: `Rule ${twin + 1} already says exactly that: ${ruleText(rule)}.` };
  return { ok: true, rule };
}

/** Port scanner target: one address, or a network. */
export function checkScanTarget(sim: Sim, devId: string, raw: string): Checked<{ target: string }> {
  const s = raw.trim().replace(/\s+/g, '');
  if (!s) return { ok: false, msg: 'Type an address or a network to scan, like 10.0.1.0/24.' };
  if (isIp(s)) {
    if (sim.dev(devId).ifaces.some((i) => i.ip === s)) return { ok: false, msg: `${s} is ${sim.dev(devId).label}'s own address. Scan someone else.` };
    return { ok: true, target: s };
  }
  const named = Object.values(sim.devices).find((d) => d.label.toLowerCase() === raw.trim().toLowerCase());
  if (named) {
    const ip = named.ifaces.find((i) => i.ip)?.ip;
    return ip
      ? { ok: false, msg: `A scanner needs addresses, not names. ${named.label} is ${ip}.`, suggest: ip }
      : { ok: false, msg: `A scanner needs addresses, and ${named.label} has none.` };
  }
  const star = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\*$/.exec(s);
  if (star) {
    const net = `${star[1]}.${star[2]}.${star[3]}.0/24`;
    return { ok: false, msg: `Write a network with a slash: ${net}.`, suggest: net };
  }
  if (!isPrefix(s)) return { ok: false, msg: 'Type an IP address like 10.0.1.10, or a network like 10.0.1.0/24.' };
  if (prefixLen(s) < 16) return { ok: false, msg: 'That is more than 65,000 addresses. Scan one network at a time, like 10.0.1.0/24.' };
  const norm = normalizePrefix(s);
  if (norm !== s) return { ok: false, msg: `A network starts at its first address. Did you mean ${norm}?`, suggest: norm };
  return { ok: true, target: norm };
}
