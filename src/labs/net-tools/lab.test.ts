import { describe, expect, it } from 'vitest';
import { checkCommand } from '../../runtime/termInput';
import type { Sim } from '../../sim/sim';
import type { TermRun } from '../../sim/terminal';
import { runLines } from '../../ui/termText';
import type { ToolSpec } from '../types';
import { netToolsLab } from '.';
import { buildLibrary, dnsFixed, ensureTicketsDone, fixDns, internetFixed, IP, pc2Plugged, riskyClosed } from './scenario';

type Terminal = Extract<ToolSpec, { kind: 'terminal' }>;

const step = (id: string) => netToolsLab.steps.find((s) => s.id === id)!;
const terminalOf = (id: string) => step(id).tools!.find((t): t is Terminal => t.kind === 'terminal')!;
const action = (stepId: string, id: string) => step(stepId).actions!.find((a) => a.id === id)!;

function run(sim: Sim, device: string, line: string): TermRun {
  const id = sim.runCommand(device, line);
  sim.runUntilIdle();
  return sim.dev(device).term!.find((r) => r.id === id)!;
}

const text = (sim: Sim, device: string, r: TermRun) => runLines(sim, device, r).map((l) => l.text);

describe('net-tools network', () => {
  it('starts with the three tickets broken', () => {
    const sim = buildLibrary();
    expect(sim.events).toEqual([]);
    expect(dnsFixed(sim)).toBe(false);
    expect(internetFixed(sim)).toBe(false);
    expect(pc2Plugged(sim)).toBe(true);
  });

  it('ticket 1: the catalog name leads to an address nobody has, until the record is fixed', () => {
    const sim = buildLibrary();
    expect(text(sim, 'pc1', run(sim, 'pc1', 'ping catalog.lakeside.example')).slice(0, 2)).toEqual([
      'Pinging catalog.lakeside.example [10.0.0.21] with 4 pings:',
      'Reply from 10.0.0.31: Destination host unreachable.',
    ]);
    expect(text(sim, 'pc1', run(sim, 'pc1', 'nslookup catalog.lakeside.example'))).toEqual([
      'Server:   10.0.0.1',
      'Address:  10.0.0.1#53',
      '',
      'Name:     catalog.lakeside.example',
      'Address:  10.0.0.21',
    ]);
    fixDns(sim);
    const after = run(sim, 'pc1', 'ping catalog.lakeside.example');
    expect(after.kind === 'ping' && after.probes.every((p) => p.status === 'reply')).toBe(true);
  });

  it('ticket 2: the trace stops after the provider, and reaches the site after the repair', () => {
    const sim = buildLibrary();
    const broken = run(sim, 'pc1', 'traceroute ebooks.example');
    const lines = text(sim, 'pc1', broken);
    expect(lines[0]).toBe('traceroute to ebooks.example (192.0.2.80), 30 hops max');
    expect(lines[1]).toMatch(/^ 1 {2}10\.0\.0\.1 {8}0\.\d ms$/);
    expect(lines[2]).toMatch(/^ 2 {2}198\.51\.100\.1 {4}\d\.\d ms$/);
    expect(lines.slice(3)).toEqual([' 3  *', ' 4  *', 'Trace stopped: 2 hops in a row with no answer.']);
    // The provider's DNS answer is passed on, not the router's own.
    expect(text(sim, 'pc1', run(sim, 'pc1', 'nslookup ebooks.example'))).toContain('Non-authoritative answer:');
    action('traceroute', 'call-isp').run(sim);
    const fixed = run(sim, 'pc1', 'tracert ebooks.example');
    expect(fixed.kind === 'traceroute' && fixed.hops.map((h) => h.from)).toEqual([IP.router, IP.isp, IP.core, IP.ebooks]);
  });

  it('ticket 3: netstat -b shows the remote-control program until the cable comes out', () => {
    const sim = buildLibrary();
    expect(text(sim, 'pc2', run(sim, 'pc2', 'netstat -b'))).toContain('  TCP    10.0.0.32:49733       203.0.113.66:4444     ESTABLISHED  update-helper.exe');
    action('netstat', 'unplug-pc2').run(sim);
    expect(text(sim, 'pc2', run(sim, 'pc2', 'netstat -b'))).toContain('  (none)');
  });

  it('nmap finds the FTP backdoor and the printer’s Telnet, then sees them closed', () => {
    const sim = buildLibrary();
    ensureTicketsDone(sim);
    const vuln = text(sim, 'laptop', run(sim, 'laptop', 'nmap -sV --script vuln 10.0.0.0/24'));
    expect(vuln).toContain('21/tcp   open   ftp           vsftpd 2.3.4');
    expect(vuln).toContain('|     IDs:  CVE:CVE-2011-2523');
    expect(vuln).toContain('23/tcp   open   telnet        printer telnetd');
    // The scanning laptop lists itself too, and every host the library's DNS knows gets its name.
    expect(vuln).toContain('Nmap scan report for catalog.lakeside.example (10.0.0.20)');
    expect(vuln).toContain('Nmap scan report for helpdesk.lakeside.example (10.0.0.5)');
    expect(vuln.find((l) => l.startsWith('Nmap done:'))).toMatch(/^Nmap done: 256 IP addresses \(5 hosts up\) scanned/);
    action('close', 'close-risky').run(sim);
    expect(riskyClosed(sim)).toBe(true);
    const again = text(sim, 'laptop', run(sim, 'laptop', 'nmap 10.0.0.0/24'));
    expect(again.some((l) => l.startsWith('21/tcp') || l.startsWith('23/tcp'))).toBe(false);
  });
});

describe('net-tools typed checks', () => {
  it('keeps nmap locked until the permission letter', () => {
    const sim = buildLibrary();
    const r = checkCommand(sim, terminalOf('traceroute'), 'pc1', 'nmap 10.0.0.0/24');
    expect(r).toEqual({
      ok: false,
      msg: 'Not yet. nmap knocks on other people’s computers, so it needs the owner’s written permission first. This lab gets to it later.',
    });
    expect(checkCommand(sim, terminalOf('ping'), 'pc1', 'nslookup ebooks.example')).toEqual({ ok: false, msg: 'This step doesn’t use nslookup. Try ping.' });
  });

  it('refuses scans outside the letter, by address, network, or name', () => {
    const sim = buildLibrary();
    const t = terminalOf('nmap');
    const outside = (what: string) => ({
      ok: false,
      msg: `Stopped: ${what} isn’t covered by the permission letter. The library director gave written permission to scan 10.0.0.0/24 only. Scanning a network without its owner’s permission can be a crime.`,
    });
    expect(checkCommand(sim, t, 'laptop', 'nmap 192.0.2.80')).toEqual(outside('192.0.2.80'));
    expect(checkCommand(sim, t, 'laptop', 'nmap 10.0.0.0/16')).toEqual(outside('10.0.0.0/16'));
    expect(checkCommand(sim, t, 'laptop', 'nmap ebooks.example')).toEqual(outside('ebooks.example (192.0.2.80)'));
    expect(checkCommand(sim, t, 'laptop', 'nmap 10.0.0.20').ok).toBe(true);
    expect(checkCommand(sim, t, 'laptop', 'nmap catalog.lakeside.example').ok).toBe(true);
  });

  it('turns away a ping of the computer’s own address', () => {
    const sim = buildLibrary();
    expect(checkCommand(sim, terminalOf('ping'), 'pc1', 'ping 10.0.0.31')).toEqual({ ok: false, msg: '10.0.0.31 is Public PC 1’s own address. Try another computer’s address.' });
  });
});

describe('net-tools buttons', () => {
  it('ask for the evidence before acting on it', () => {
    const sim = buildLibrary();
    const report = action('nslookup', 'report-dns');
    report.run(sim);
    expect(dnsFixed(sim)).toBe(false);
    expect(report.outcome!(sim, 0)).toEqual([{ tone: 'bad', text: 'The IT contractor asks: what does the record say right now? Look it up with nslookup first.' }]);
    run(sim, 'pc1', 'nslookup catalog.lakeside.example');
    expect(report.outcome!(sim, 0)).toEqual([{ tone: 'bad', text: 'You have the lookup now. Press the button again to send it.' }]);
    report.run(sim);
    expect(report.outcome!(sim, 0)).toEqual([{ tone: 'good', text: 'The IT contractor says the record is fixed. Check their work with nslookup.' }]);

    // The catalog opens only once the fix is checked.
    const open = action('nslookup', 'open-catalog');
    open.run(sim);
    sim.runUntilIdle();
    expect(open.outcome!(sim, 0)).toEqual([{ tone: 'bad', text: 'Check the IT contractor’s fix with nslookup first.' }]);
    run(sim, 'pc1', 'nslookup catalog.lakeside.example');
    open.run(sim);
    expect(open.outcome!(sim, 0)).toEqual([{ tone: 'wait', text: 'Public PC 1 is opening the catalog…' }]);
    sim.runUntilIdle();
    expect(open.outcome!(sim, 0)).toEqual([{ tone: 'good', text: 'The catalog loads on Public PC 1. Ticket 1 is solved.' }]);

    const call = action('traceroute', 'call-isp');
    call.run(sim);
    expect(internetFixed(sim)).toBe(false);
    expect(call.outcome!(sim, 0)[0].tone).toBe('bad');
    run(sim, 'pc1', 'traceroute ebooks.example');
    expect(call.outcome!(sim, 0)).toEqual([{ tone: 'bad', text: 'You have the trace now. Press the button again to call.' }]);
    call.run(sim);
    expect(internetFixed(sim)).toBe(true);

    const unplug = action('netstat', 'unplug-pc2');
    unplug.run(sim);
    expect(pc2Plugged(sim)).toBe(true);
    expect(unplug.outcome!(sim, 0)).toEqual([{ tone: 'bad', text: 'Find the connection with netstat -b first, so you can tell IT what you cut off.' }]);
    run(sim, 'pc2', 'netstat -b');
    expect(unplug.outcome!(sim, 0)).toEqual([{ tone: 'bad', text: 'You found the connection. Press the button again to unplug Public PC 2.' }]);
    unplug.run(sim);
    expect(pc2Plugged(sim)).toBe(false);
  });

  it('Watch Public PC 2 shows its traffic to the unknown server', () => {
    const sim = buildLibrary();
    step('netstat').setup!(sim);
    const watch = action('netstat', 'watch-pc2');
    watch.run(sim);
    expect(watch.outcome!(sim, 0)).toEqual([{ tone: 'wait', text: 'Public PC 2 is sending something…' }]);
    sim.runUntilIdle();
    expect(watch.outcome!(sim, 0)).toEqual([{ tone: 'good', text: 'Nobody is sitting at Public PC 2, but it traded packets with 203.0.113.66, out on the internet.' }]);
  });
});

describe('net-tools setups', () => {
  it('finish the earlier tickets quietly, keeping fixes already made', () => {
    const sim = buildLibrary();
    run(sim, 'pc1', 'traceroute ebooks.example');
    action('traceroute', 'call-isp').run(sim);
    const link = sim.dev('isp').ifaces.find((i) => i.id === 'core')!.linkId;
    sim.events = [];
    sim.quiet = true;
    step('nmap').setup!(sim);
    sim.quiet = false;
    expect(sim.dev('isp').ifaces.find((i) => i.id === 'core')!.linkId).toBe(link);
    expect(dnsFixed(sim)).toBe(true);
    expect(pc2Plugged(sim)).toBe(false);
    expect(sim.events.filter((e) => !e.quiet)).toEqual([]);
    // A second time changes nothing.
    step('vuln').setup!(sim);
    expect(sim.dev('isp').ifaces.find((i) => i.id === 'core')!.linkId).toBe(link);
  });
});
