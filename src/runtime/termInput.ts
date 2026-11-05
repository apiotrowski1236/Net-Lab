import { isIp, isPrefix, type Ip } from '../sim/addr';
import type { Sim } from '../sim/sim';
import { inScope, networkInScope, parseCommand, TERM_USAGE, type Parsed, type TermCommand } from '../sim/terminal';
import type { ToolSpec } from '../labs/types';
import type { Checked } from './toolInput';

type TerminalSpec = Extract<ToolSpec, { kind: 'terminal' }>;

/** Where a name points, by the records in the network's DNS servers (the first server with the name wins). */
export function nameInZones(sim: Sim, name: string): Ip | undefined {
  const n = name.toLowerCase();
  for (const d of Object.values(sim.devices)) {
    const ip = d.dnsZone?.[n];
    if (ip) return ip;
  }
  return undefined;
}

/**
 * Terminal: one command line, typed on `deviceId`. It must parse, be one of
 * the step's commands, and for nmap, come from the one computer allowed to
 * scan and stay inside the written permission. `help` and `clear` pass (the
 * terminal handles them on screen and records nothing).
 */
export function checkCommand(sim: Sim, spec: TerminalSpec, deviceId: string, raw: string): Checked<{ parsed: Parsed; line: string }> {
  const dev = sim.devices[deviceId];
  if (!dev || !spec.devices.includes(deviceId)) return { ok: false, msg: 'Pick a computer to sit at first.' };
  const r = parseCommand(raw);
  if (!r.ok) return { ok: false, msg: r.msg };
  const c = r.parsed;
  if (c.cmd === 'help' || c.cmd === 'clear') return { ok: true, parsed: c, line: r.line };
  if (c.cmd === 'nmap' && !spec.commands.includes('nmap')) {
    return { ok: false, msg: 'Not yet. nmap knocks on other people’s computers, so it needs the owner’s written permission first. This lab gets to it later.' };
  }
  if (!spec.commands.includes(c.cmd)) {
    return { ok: false, msg: `This step doesn’t use ${c.cmd}. Try ${list(spec.commands)}.` };
  }
  if (c.cmd === 'nmap') {
    const rule = spec.nmap;
    if (!rule) return { ok: false, msg: 'nmap isn’t installed on this computer.' };
    if (deviceId !== rule.from) {
      const from = sim.devices[rule.from]?.label ?? rule.from;
      return { ok: false, msg: `nmap isn’t installed on ${dev.label}. The permission letter covers scans from ${from} only.` };
    }
    const refuse = (what: string) => ({
      ok: false as const,
      msg: `Stopped: ${what} isn’t covered by the permission letter. ${cap(rule.owner)} gave written permission to scan ${list(rule.scope)} only. Scanning a network without its owner’s permission can be a crime.`,
    });
    if (isPrefix(c.target)) {
      if (!networkInScope(rule.scope, c.target)) return refuse(c.target);
    } else {
      const ip = isIp(c.target) ? c.target : nameInZones(sim, c.target);
      if (ip && !inScope(rule.scope, ip)) return refuse(isIp(c.target) ? c.target : `${c.target} (${ip})`);
    }
  }
  if ((c.cmd === 'ping' || c.cmd === 'traceroute') && dev.ifaces.some((i) => i.ip === c.target)) {
    return { ok: false, msg: `${c.target} is ${dev.label}’s own address. Try another computer’s address.` };
  }
  return { ok: true, parsed: c, line: r.line };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/** The usage line for a command, for messages and the terminal's hint row. */
export const usageOf = (c: TermCommand): string => TERM_USAGE[c].usage;
