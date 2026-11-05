import { sameSubnet } from '../sim/addr';
import { scanDone, scanFindings, type Scan } from '../sim/services';
import type { Sim } from '../sim/sim';
import {
  fmtMs,
  NMAP_GAP_MS,
  nmapName,
  PING_COUNT,
  reverseName,
  roundTripMs,
  TERM_USAGE,
  TRACE_MAX_HOPS,
  TRACE_SILENT,
  vulnsFor,
  type LookupRun,
  type NetstatRun,
  type NmapRun,
  type PingRun,
  type TermCommand,
  type TermRun,
  type TraceRun,
} from '../sim/terminal';

/**
 * What the terminal prints for each run (src/ui/tools/Terminal.tsx), close to
 * the real programs' output, and one plain-words line on what it means. The
 * output is drawn again from the run on every change, so a run still waiting
 * for answers prints what it has so far.
 */

export type TermTone = 'good' | 'bad' | 'muted' | 'warn' | 'head';
export interface TermLine {
  text: string;
  tone?: TermTone;
}

const L = (text: string, tone?: TermTone): TermLine => ({ text, tone });
const pad = (s: string, n: number) => s.padEnd(n);

/** A device's name on the map, for the plain-words line. */
function who(sim: Sim, ip: string | undefined): string | undefined {
  return ip ? sim.deviceByIp(ip)?.label : undefined;
}

export function runLines(sim: Sim, devId: string, run: TermRun): TermLine[] {
  switch (run.kind) {
    case 'ping':
      return pingLines(run);
    case 'traceroute':
      return traceLines(run);
    case 'nslookup':
      return lookupLines(run);
    case 'netstat':
      return netstatLines(run);
    case 'nmap':
      return nmapLines(sim, devId, run);
  }
}

function nameFailed(run: PingRun | TraceRun | NmapRun): TermLine[] | undefined {
  const l = run.lookup;
  if (!l || l.status === 'found') return undefined;
  if (l.status === 'pending') return [L(`(asking the DNS server for ${l.name})`, 'muted')];
  const why = l.status === 'timeout' ? 'the DNS server did not answer' : 'the DNS server has no address for it';
  if (run.kind === 'ping') return [L(`Ping request could not find host ${l.name}: ${why}.`, 'bad')];
  if (run.kind === 'traceroute') return [L(`traceroute: unknown host ${l.name} (${why})`, 'bad')];
  return [L(`Failed to resolve "${l.name}": ${why}.`, 'bad'), L('WARNING: No targets were specified, so 0 hosts scanned.', 'bad')];
}

function pingLines(run: PingRun): TermLine[] {
  const failed = nameFailed(run);
  if (failed) return failed;
  const ip = run.ip!;
  const out = [L(`Pinging ${run.target === ip ? ip : `${run.target} [${ip}]`} with ${PING_COUNT} pings:`)];
  for (const p of run.probes) {
    if (p.status === 'reply') out.push(L(`Reply from ${p.from}: time=${fmtMs(p.ms ?? 0)} TTL=${p.ttl ?? 64}`, 'good'));
    else if (p.status === 'unreachable') {
      if (p.why === 'local') out.push(L('PING: transmit failed. General failure.', 'bad'));
      else out.push(L(`Reply from ${p.from}: Destination ${p.why === 'net' ? 'net' : 'host'} unreachable.`, 'bad'));
    } else if (p.status === 'timeout') out.push(L('Request timed out.', 'bad'));
  }
  if (run.doneAt === undefined) return out;
  const got = run.probes.filter((p) => p.status === 'reply');
  const lost = run.probes.length - got.length;
  out.push(L(''), L(`Ping statistics for ${ip}:`), L(`    Sent = ${run.probes.length}, Received = ${got.length}, Lost = ${lost} (${Math.round((100 * lost) / run.probes.length)}% loss)`));
  if (got.length) {
    const ms = got.map((p) => p.ms ?? 0);
    const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
    out.push(L(`    Round trip: min ${fmtMs(Math.min(...ms))}, max ${fmtMs(Math.max(...ms))}, average ${fmtMs(avg)}`));
  }
  return out;
}

function traceLines(run: TraceRun): TermLine[] {
  const failed = nameFailed(run);
  if (failed) return failed;
  const ip = run.ip!;
  // Windows' tracert announces itself its own way.
  const out = run.line.startsWith('tracert')
    ? [L(`Tracing route to ${run.target === ip ? ip : `${run.target} [${ip}]`}`), L(`over a maximum of ${TRACE_MAX_HOPS} hops:`)]
    : [L(`traceroute to ${run.target === ip ? ip : `${run.target} (${ip})`}, ${TRACE_MAX_HOPS} hops max`)];
  for (const h of run.hops) {
    const n = String(h.ttl).padStart(2);
    if (h.status === 'answer') out.push(L(`${n}  ${pad(h.from ?? '', 16)}${fmtMs(h.ms ?? 0)}`, h.last ? 'good' : undefined));
    else if (h.status === 'timeout') out.push(L(`${n}  *`, 'bad'));
  }
  if (run.end === 'reached') out.push(L('Trace complete.', 'good'));
  else if (run.end === 'silent') out.push(L(`Trace stopped: ${TRACE_SILENT} hops in a row with no answer.`, 'bad'));
  else if (run.end === 'max') out.push(L(`Trace stopped after ${TRACE_MAX_HOPS} hops.`, 'bad'));
  else if (run.end === 'local') out.push(L('traceroute: this computer has no working connection.', 'bad'));
  return out;
}

function lookupLines(run: LookupRun): TermLine[] {
  if (run.status === 'no-server') return [L('nslookup: this computer has no DNS server set.', 'bad')];
  const out = [L(`Server:   ${run.server}`), L(`Address:  ${run.server}#53`), L('')];
  const q = run.reverse ? reverseName(run.name) : run.name;
  if (run.status === 'pending') return out;
  if (run.status === 'timeout') return [...out, L(';; connection timed out; no servers could be reached', 'bad')];
  if (run.status === 'nxdomain') return [...out, L(`** server can't find ${q}: NXDOMAIN`, 'bad')];
  if (!run.authoritative) out.push(L('Non-authoritative answer:', 'muted'));
  if (run.reverse) out.push(L(`${q}    name = ${run.answer}`, 'good'));
  else out.push(L(`Name:     ${run.name}`, 'good'), L(`Address:  ${run.answer}`, 'good'));
  return out;
}

function netstatLines(run: NetstatRun): TermLine[] {
  const out = [L('Active Connections'), L('')];
  const head = `  ${pad('Proto', 7)}${pad('Local Address', 22)}${pad('Foreign Address', 22)}${pad('State', 13)}${run.programs ? 'Program' : ''}`;
  out.push(L(head.trimEnd(), 'head'));
  if (!run.rows.length) out.push(L('  (none)', 'muted'));
  for (const r of run.rows) {
    out.push(L(`  ${pad(r.proto, 7)}${pad(r.local, 22)}${pad(r.foreign, 22)}${pad(r.state, 13)}${run.programs ? (r.program ?? '') : ''}`.trimEnd()));
  }
  return out;
}

/** The name a DNS record gives this address, if any. */
function nameOf(sim: Sim, ip: string): string | undefined {
  for (const d of Object.values(sim.devices)) {
    for (const [name, addr] of Object.entries(d.dnsZone ?? {})) if (addr === ip) return name;
  }
  return undefined;
}

function nmapScan(sim: Sim, devId: string, run: NmapRun): Scan | undefined {
  return run.scan === undefined ? undefined : sim.devices[devId]?.scans?.find((s) => s.id === run.scan);
}

function nmapLines(sim: Sim, devId: string, run: NmapRun): TermLine[] {
  const out = [L('Starting Nmap ( https://nmap.org )', 'muted')];
  const failed = nameFailed(run);
  if (failed) return [...out, ...failed];
  const scan = nmapScan(sim, devId, run);
  if (!scan) return out;
  const done = run.doneAt !== undefined || scanDone(scan);
  if (!done) {
    const total = scan.hosts.length * (scan.ports.length + 1) || 1;
    const answered = scan.hosts.reduce((n, h) => n + (h.ping !== 'pending' ? 1 : 0) + scan.ports.filter((p) => h.ports[p] !== 'pending').length, 0);
    // Answers arrive in bursts (an empty address waits out its ARP timeout), so count probes sent too: the number keeps moving.
    const sent = Math.min(total, Math.floor((sim.t - scan.t) / NMAP_GAP_MS) + 1);
    const pct = Math.min(99, Math.round((100 * (answered + sent)) / (2 * total)));
    return [...out, L(`Stats: about ${pct}% done`, 'muted')];
  }
  const found = scanFindings(scan);
  for (const h of found) {
    const host = scan.hosts.find((x) => x.ip === h.ip);
    // Like real nmap, look up each address's name (here, straight from the network's DNS records).
    const name = (found.length === 1 && run.lookup?.name) || nameOf(sim, h.ip);
    out.push(L(''), L(`Nmap scan report for ${name ? `${name} (${h.ip})` : h.ip}`, 'head'));
    const lat = roundTripMs(sim, devId, h.ip, Number(h.ip.split('.')[3] ?? 0)) / 1000;
    out.push(L(`Host is up (${lat.toFixed(5)}s latency).`));
    if (!h.open.length) {
      out.push(L(`All ${scan.ports.length} scanned ports on ${h.ip} are closed`, 'muted'));
      continue;
    }
    const hidden = scan.ports.length - h.open.length;
    if (hidden) out.push(L(`Not shown: ${hidden} closed tcp ports`, 'muted'));
    out.push(L(`${pad('PORT', 9)}${pad('STATE', 7)}${pad('SERVICE', 14)}${run.versions ? 'VERSION' : ''}`.trimEnd(), 'head'));
    for (const p of h.open) {
      const version = host?.banners?.[p];
      out.push(L(`${pad(`${p}/tcp`, 9)}${pad('open', 7)}${pad(nmapName(p), 14)}${run.versions ? (version ?? '') : ''}`.trimEnd(), 'good'));
      if (!run.vuln) continue;
      for (const v of vulnsFor(version)) {
        out.push(
          L(`| ${v.script}:`, 'bad'),
          L('|   VULNERABLE:', 'bad'),
          L(`|   ${v.title}`, 'bad'),
          L('|     State: VULNERABLE (Exploitable)', 'bad'),
          ...(v.cve ? [L(`|     IDs:  CVE:${v.cve}`, 'bad')] : []),
          L(`|_    ${v.risk}`, 'bad'),
        );
      }
    }
  }
  const up = found.length;
  // nmap counts every address in a network, the network and broadcast addresses too.
  const len = Number(scan.target.split('/')[1] ?? 32);
  const size = 2 ** (32 - len);
  out.push(L(''), L(`Nmap done: ${size} IP address${size === 1 ? '' : 'es'} (${up} host${up === 1 ? '' : 's'} up) scanned`));
  return out;
}

/** One sentence under the newest result: what it means, in plain words. Undefined while it's still running. */
export function runMeaning(sim: Sim, devId: string, run: TermRun): string | undefined {
  if (run.doneAt === undefined && run.kind !== 'netstat') return undefined;
  const me = sim.devices[devId]?.label ?? devId;
  if (run.kind !== 'nslookup' && run.kind !== 'netstat' && run.lookup && run.lookup.status !== 'found') {
    return run.lookup.status === 'timeout'
      ? `The DNS server didn't answer, so ${me} never learned the address for ${run.lookup.name}.`
      : `The DNS server has no address for ${run.lookup.name}, so nothing was sent. Check the spelling.`;
  }
  const named = run.kind !== 'nslookup' && run.kind !== 'netstat' && run.lookup ? `DNS says ${run.lookup.name} is at ${run.kind === 'nmap' ? run.target : run.ip}. ` : '';
  switch (run.kind) {
    case 'ping': {
      const ip = run.ip!;
      const got = run.probes.filter((p) => p.status === 'reply');
      const label = who(sim, ip);
      if (got.length === run.probes.length) {
        const avg = got.reduce((a, p) => a + (p.ms ?? 0), 0) / got.length;
        // On this computer's own network there's no router on the way, only cables and a switch.
        const local = sim.devices[devId]?.ifaces.some((i) => i.ip && i.prefix !== undefined && sameSubnet(i.ip, ip, i.prefix));
        const path = local ? 'cable and switch' : 'cable and router';
        return `${named}${label ?? ip} answered all ${got.length} pings: it's on, and every ${path} between here and there works, both ways. A round trip took about ${fmtMs(avg)}.`;
      }
      if (got.length) return `${named}Only ${got.length} of ${run.probes.length} pings came back. Something on the way is losing packets.`;
      const u = run.probes.find((p) => p.status === 'unreachable');
      if (u?.why === 'local') return `${me} couldn't send anything. Check its cable and its address.`;
      if (u?.why === 'host' && u.from && sim.deviceByIp(u.from)?.id === devId) {
        return `${named}No device has the address ${ip}. ${me} asked its local network "who has ${ip}?" and nobody answered. The "Reply from" lines come from ${me} itself, reporting that it gave up.`;
      }
      if (u?.why === 'host') return `${named}${who(sim, u.from) ?? u.from} reached ${ip}'s network, but no device there has that address.`;
      if (u?.why === 'net') return `${named}${who(sim, u.from) ?? u.from} has no route to ${ip}'s network.`;
      return `${named}No answer to any ping. The pings were lost on the way, or ${label ?? ip} is off or set to ignore pings.`;
    }
    case 'traceroute': {
      const answered = run.hops.filter((h) => h.status === 'answer');
      const names = answered.map((h) => `${h.ttl}: ${who(sim, h.from) ?? h.from}`).join(', ');
      if (run.end === 'reached') {
        return `${named}Each line is one hop on the way (${names}). Every line before the last is a router; the last line is the destination itself.`;
      }
      if (run.end === 'local') return `${me} couldn't send anything. Check its cable and its address.`;
      const last = answered[answered.length - 1];
      if (!last) return `${named}Not even the first router answered.`;
      return `${named}The last hop to answer was ${who(sim, last.from) ?? last.from} (line ${last.ttl}). After it, nothing answered. (A real traceroute keeps trying up to 30 hops. This one stops after 2 silent hops to save time.)`;
    }
    case 'nslookup': {
      const server = who(sim, run.server) ?? run.server;
      if (run.status === 'no-server') return `${me} has no DNS server set, so it can't look up names.`;
      if (run.status === 'timeout') return `The DNS server (${server}) didn't answer.`;
      if (run.status === 'nxdomain') return `The DNS server (${server}) has no record for ${run.reverse ? `the address ${run.name}` : run.name}.`;
      const from = run.authoritative ? `${server} keeps this record itself.` : `${server} asked another DNS server and passed the answer on.`;
      return run.reverse ? `The DNS server says ${run.name} is named ${run.answer}. ${from}` : `The DNS server says ${run.name} is at ${run.answer}. ${from}`;
    }
    case 'netstat': {
      const dev = sim.devices[devId];
      const est = run.rows.filter((r) => r.state === 'ESTABLISHED').length;
      const listen = run.rows.length - est;
      if (!est && dev && !dev.ifaces.some((i) => i.linkId)) return `No connections: ${me} has no cable plugged in.`;
      const parts = [`${est} open connection${est === 1 ? '' : 's'}`];
      if (run.all) parts.push(`${listen} port${listen === 1 ? '' : 's'} waiting for connections`);
      return `${parts.join(' and ')}. Foreign Address is the computer on the other end, then a colon and its port.${run.programs ? ' Program is what on this computer opened it.' : ''}`;
    }
    case 'nmap': {
      const scan = nmapScan(sim, devId, run);
      if (!scan) return undefined;
      const found = scanFindings(scan);
      const open = found.reduce((n, h) => n + h.open.length, 0);
      const bad = run.vuln ? found.reduce((n, h) => n + h.open.filter((p) => vulnsFor(scan.hosts.find((x) => x.ip === h.ip)?.banners?.[p]).length).length, 0) : 0;
      // "nmap 10.0.0.0": one address, not the network.
      if (!found.length && !run.target.includes('/')) {
        return `${named}No device answered at ${run.target}. To scan a whole network, add a slash and its size, like ${run.target}/24.`;
      }
      const tail = run.vuln ? ` The vuln check matched ${bad} known problem${bad === 1 ? '' : 's'}.` : '';
      return `${named}${found.length} device${found.length === 1 ? '' : 's'} answered, with ${open} open port${open === 1 ? '' : 's'} between them. Each open port is a program that accepts connections from anyone who can reach it.${tail}`;
    }
  }
}

/** What `help` prints: the commands this step allows. */
export function helpLines(commands: TermCommand[]): TermLine[] {
  const w = Math.max(...commands.map((c) => TERM_USAGE[c].usage.length)) + 3;
  return [
    ...commands.map((c) => L(`${pad(TERM_USAGE[c].usage, w)}${TERM_USAGE[c].what}`)),
    L(`${pad('clear', w)}Clear the screen.`),
    L('Press the up arrow to bring back a command you typed before.', 'muted'),
  ];
}

/** "nslookup catalog.lakeside.example" → "nslookup": which command a half-typed line is. */
export function commandOf(line: string): TermCommand | undefined {
  const w = line.trim().split(/\s+/)[0]?.toLowerCase();
  if (w === 'tracert' || w === 'tracepath') return 'traceroute';
  return (['ping', 'traceroute', 'nslookup', 'netstat', 'nmap'] as TermCommand[]).find((c) => c === w);
}
