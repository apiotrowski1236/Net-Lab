import { describe, expect, it } from 'vitest';
import { checkRows, parseRows, rowsText } from '../../runtime/citeRows';
import { checkCommand } from '../../runtime/termInput';
import { fileLine, fileRows } from '../../sim/linux';
import type { Sim } from '../../sim/sim';
import { runLines, runMeaning } from '../../ui/termText';
import type { TextQuestion, ToolSpec } from '../types';
import { deviceAnalysisLab } from '.';
import {
  allows,
  botAttack,
  botIp,
  botnetAttack,
  buildCoop,
  describeRow,
  ensureSprayBlocked,
  ftpClosed,
  fw,
  IP,
  joSignIn,
  lastConn,
  lx,
  replayScan,
  replaySpray,
  ROWS,
  rowsSince,
  scannerRdp,
  scannerSsh,
  customerVisit,
  sshOfficeOnly,
  vendorUpload,
  verdictWords,
  WEB,
} from './scenario';

type Terminal = Extract<ToolSpec, { kind: 'terminal' }>;
const step = (id: string) => deviceAnalysisLab.steps.find((s) => s.id === id)!;

function sh(sim: Sim, line: string) {
  const id = sim.runCommand(WEB, line);
  sim.runUntilIdle();
  const r = sim.dev(WEB).term!.find((x) => x.id === id)!;
  return { out: runLines(sim, WEB, r).map((l) => l.text), meaning: runMeaning(sim, WEB, r) };
}

/** Run `fn`, let the network settle, and return the newest connection `from` made with `tag`. */
function test(sim: Sim, from: string, tag: string, fn: (sim: Sim) => void) {
  const t = sim.t;
  fn(sim);
  sim.runUntilIdle();
  return lastConn(sim, from, t, tag)!;
}

const lines = (sim: Sim, file: 'auth' | 'ufw' | 'access' | 'fail2ban') => fileRows(sim.dev(WEB), file).map((e) => fileLine(lx(sim), e));

describe('device-analysis: the weekend in the logs', () => {
  it('starts quiet, with the weekend already written', () => {
    const sim = buildCoop();
    expect(sim.events).toEqual([]);
    expect(ROWS.count).toEqual({ auth: 35, ufw: 14, access: 27, fail2ban: 0 });
    expect(rowsText(ROWS.spray)).toBe('11-24');
    expect(rowsText(ROWS.scan)).toBe('4-13');
    expect(rowsText(ROWS.probes)).toBe('15-20');
    expect(rowsText(ROWS.traversal)).toBe('21-23');
    expect([ROWS.scan22, ROWS.scan25]).toEqual([11, 8]);
  });

  it('writes lines the way Ubuntu does', () => {
    const sim = buildCoop();
    const auth = lines(sim, 'auth');
    expect(auth[0]).toBe(
      'Nov 14 02:10:03 web01 sshd[14205]: Accepted publickey for bayline from 198.18.40.12 port 42165 ssh2: RSA SHA256:Qm8rT2vX5nL9pB4cW7yE1kH6sJ3dF0gA8uZ5oI2qR4t',
    );
    expect(auth[10]).toBe('Nov 15 03:20:14 web01 sshd[14210]: Failed password for invalid user admin from 203.0.113.77 port 35506 ssh2');
    expect(auth[16]).toBe('Nov 15 03:23:33 web01 sshd[14216]: Failed password for root from 203.0.113.77 port 36539 ssh2');
    expect(lines(sim, 'ufw')[7]).toBe(
      'Nov 15 22:47:10 web01 kernel: [UFW BLOCK] IN=eth0 OUT= SRC=203.0.113.140 DST=198.51.100.10 LEN=44 TTL=52 PROTO=TCP SPT=48211 DPT=25 WINDOW=1024 SYN URGP=0',
    );
    expect(lines(sim, 'access')[20]).toBe('203.0.113.140 - - [15/Nov/2026:22:53:40 +0000] "GET /download?file=../../../../etc/passwd HTTP/1.1" 400 166 "-" "curl/7.81.0"');
  });

  it('says what a wrongly cited row is', () => {
    expect(describeRow('auth', 10)).toMatch(/Bayline Farms' nightly upload/);
    expect(describeRow('auth', 25)).toMatch(/CRON/);
    expect(describeRow('auth', 40)).toMatch(/written today/);
    expect(describeRow('ufw', 14)).toMatch(/203\.0\.113\.9, a different address/);
    expect(describeRow('access', 15)).toMatch(/\/\.env.*404.*no \.\.\//);
    expect(describeRow('access', 24)).toMatch(/customer/);
  });
});

describe('device-analysis: citing rows', () => {
  it('reads ranges and lists however they are written', () => {
    for (const v of ['11-24', 'rows 11 to 24', '11–24', 'Rows 11 through 24', '11, 12-24', '11 - 24']) expect(parseRows(v)).toEqual(ROWS.spray);
    expect(parseRows('4, 5 and 9')).toEqual([4, 5, 9]);
    expect(parseRows('24-11')).toEqual({ msg: '“24-11” runs backward. Write the smaller row first, like 11-24.' });
    expect(parseRows('the spray')).toEqual({ msg: 'Write the row numbers, like 4-9 or 4, 5, 6.' });
  });

  it('checks a citation against the rows that show it', () => {
    const q = step('auth').questions!.find((x) => x.id === 'spray-rows') as TextQuestion;
    const verify = (v: string) => q.verify!(v, () => '');
    expect(verify('11-24')).toBeUndefined();
    expect(verify('10-24')).toBe("Row 10 isn't part of the spray: it is Bayline Farms' nightly upload, signing in with its key.");
    expect(verify('11-20')).toBe('You cited 10 of the 14 spray rows. Look above and below the rows you found for more.');
    expect(checkRows('4-13', ROWS.scan, 'scan', () => undefined)).toBeUndefined();
  });
});

describe('device-analysis: the firewall table', () => {
  it('decides each step 2 connection with the rule the questions name', () => {
    const sim = buildCoop();
    const c1 = test(sim, 'customer', 'customer', customerVisit);
    expect([c1.status, verdictWords(sim, c1)]).toEqual(['open', 'Allowed by rule 4 (ALLOW 443/tcp from Anywhere)']);
    const c2 = test(sim, 'jo', 'jo', joSignIn);
    expect([c2.status, c2.banner, verdictWords(sim, c2)]).toEqual(['open', 'Welcome to Ubuntu 22.04.5 LTS (GNU/Linux 5.15.0-125-generic x86_64)', 'Allowed by rule 5 (ALLOW 22/tcp from Anywhere)']);
    const c3 = test(sim, 'scanner', 'scanner-ssh', scannerSsh);
    expect([c3.status, verdictWords(sim, c3)]).toEqual(['no-answer', 'Blocked by rule 1 (DENY 22/tcp from 203.0.113.140)']);
    const c4 = test(sim, 'scanner', 'scanner-rdp', scannerRdp);
    expect([c4.status, verdictWords(sim, c4)]).toEqual(['open', 'Allowed by rule 7 (ALLOW 3389/tcp from Anywhere)']);
    // Each test wrote its line: the customer's request, Jo's sign-in, and the blocked SSH attempt.
    expect(lines(sim, 'access').at(-1)).toMatch(/^198\.19\.7\.44 - - \[16\/Nov\/2026:09:00:0\d \+0000\] "GET \/order HTTP\/1\.1" 200 8412/);
    expect(lines(sim, 'auth').slice(-2)[0]).toMatch(/Accepted publickey for jo from 192\.0\.2\.15/);
    expect(lines(sim, 'ufw').at(-1)).toMatch(/SRC=203\.0\.113\.140 .* LEN=60 .*DPT=22 WINDOW=64240 SYN/);
  });

  it('logs a live scan only where it is blocked', () => {
    const sim = buildCoop();
    const t = sim.t;
    replayScan(sim);
    sim.runUntilIdle();
    const blocked = rowsSince(sim, 'ufw', t).map((e) => e.fields?.dport ?? 'icmp');
    expect(blocked.sort()).toEqual([22, 23, 25, 445, 53, 'icmp'].sort());
  });
});

describe('device-analysis: blocking the spray', () => {
  it('a rule added at the bottom does nothing; at the top it blocks', () => {
    const sim = buildCoop();
    expect(sh(sim, 'sudo ufw deny from 203.0.113.77')).toEqual({
      out: ['Rule added'],
      meaning: 'ufw put it at the bottom, as rule 11. Rule 10 above it matches every incoming packet, and ufw stops at the first match, so it never gets to rule 11.',
    });
    const through = test(sim, 'sprayer', 'spray', replaySpray);
    expect([through.status, through.banner]).toEqual(['open', 'Permission denied, please try again.']);
    expect(sh(sim, 'ufw insert 1 deny from 203.0.113.77').out).toEqual(['Skipping inserting existing rule']);
    expect(sh(sim, 'ufw delete 11').out).toEqual(['Deleting:', ' deny from 203.0.113.77 to any', 'Rule deleted']);
    expect(sh(sim, 'ufw insert 1 deny from 203.0.113.77').out).toEqual(['Rule inserted']);
    const blocked = test(sim, 'sprayer', 'spray', replaySpray);
    expect([blocked.status, verdictWords(sim, blocked)]).toEqual(['no-answer', 'Blocked by rule 1 (DENY everything from 203.0.113.77)']);
  });

  it('the fail2ban step blocks 203.0.113.77 for a student who skipped ahead, and keeps a working rule', () => {
    const sim = buildCoop();
    ensureSprayBlocked(sim);
    expect(allows(sim, IP.sprayer, 22)).toBe(false);
    const n = fw(sim).rules.length;
    ensureSprayBlocked(sim);
    expect(fw(sim).rules.length).toBe(n);
  });
});

describe('device-analysis: fail2ban and keys', () => {
  it('fail2ban bans the bot after 5 failures and the rest are blocked', () => {
    const sim = buildCoop();
    sim.linuxSet(WEB, 'fail2ban', true);
    const t = sim.t;
    botAttack(sim);
    sim.runUntilIdle();
    const cs = (sim.dev('bot').conns ?? []).filter((c) => c.t >= t);
    expect(cs.map((c) => c.status)).toEqual(['open', 'open', 'open', 'open', 'open', 'no-answer', 'no-answer', 'no-answer']);
    expect(fw(sim).rules[0]).toMatchObject({ src: IP.bot, action: 'deny', note: 'fail2ban' });
    expect(lines(sim, 'fail2ban').at(-1)).toMatch(/^2026-11-16 09:00:0\d,\d{3} fail2ban\.actions {8}\[\d+\]: NOTICE  \[sshd\] Ban 203\.0\.113\.201$/);
  });

  it('the botnet moves address each time, under the limit; with passwords off, it never gets to guess', () => {
    const sim = buildCoop();
    sim.linuxSet(WEB, 'fail2ban', true);
    botnetAttack(sim);
    sim.runUntilIdle();
    expect(botIp(sim)).toBe('203.0.113.202');
    expect(lx(sim).f2b.banned).toEqual([]);
    sim.linuxSet(WEB, 'passwords', false);
    botnetAttack(sim);
    sim.runUntilIdle();
    expect(botIp(sim)).toBe('203.0.113.203');
    expect(lines(sim, 'auth').at(-1)).toMatch(/Connection closed by invalid user deploy 203\.0\.113\.203 port \d+ \[preauth\]$/);
    const j = test(sim, 'jo', 'jo', joSignIn);
    expect(j.status).toBe('open');
    expect(lines(sim, 'auth').at(-2)).toMatch(/Accepted publickey for jo/);
  });
});

describe('device-analysis: the policy change', () => {
  it('SSH office-only breaks the vendor until their network is allowed', () => {
    const sim = buildCoop();
    sh(sim, 'ufw delete 5');
    sh(sim, 'ufw insert 5 allow from 192.0.2.0/24 to any port 22 proto tcp');
    sh(sim, 'ufw delete 2');
    expect(sshOfficeOnly(sim)).toBe(true);
    expect(ftpClosed(sim)).toBe(true);
    expect(test(sim, 'jo', 'jo', joSignIn).status).toBe('open');
    const v1 = test(sim, 'vendor', 'vendor', vendorUpload);
    expect([v1.status, verdictWords(sim, v1)]).toEqual(['no-answer', 'Blocked by rule 9 (DENY everything from Anywhere)']);
    sh(sim, 'ufw insert 5 allow from 198.18.40.0/24 to any port 22 proto tcp');
    const v2 = test(sim, 'vendor', 'vendor', vendorUpload);
    expect(v2.status).toBe('open');
    expect(lines(sim, 'auth').at(-1)).toBe(`Nov 16 ${lines(sim, 'auth').at(-1)!.slice(7, 15)} web01 sshd[${/sshd\[(\d+)\]/.exec(lines(sim, 'auth').at(-1)!)![1]}]: subsystem request for sftp by user bayline`);
  });
});

describe('device-analysis: typed commands', () => {
  const tools = (id: string) => step(id).tools!.find((t): t is Terminal => t.kind === 'terminal')!;
  it('explains mistakes in this lab’s terms', () => {
    const sim = buildCoop();
    const bad = (id: string, line: string) => {
      const r = checkCommand(sim, tools(id), WEB, line);
      return r.ok ? 'ok' : r.msg;
    };
    expect(bad('command', 'ufw deny 203.0.113.77')).toBe('ERROR: Invalid syntax. To deny a computer, write from before its address: ufw deny from 203.0.113.77');
    expect(bad('command', 'ufw deny from 203.0.113')).toMatch(/^ERROR: Bad source address\./);
    expect(bad('command', 'ufw deny from 198.51.100.10 to 203.0.113.77')).toMatch(/“to 203\.0\.113\.77” matches packets going to 203\.0\.113\.77/);
    expect(bad('case', 'ufw disable')).toMatch(/This lab keeps the firewall on/);
    expect(bad('case', 'grep x /var/log/auth.log')).toMatch(/grep/);
    expect(bad('command', 'sudo ufw status numbered')).toBe('ok');
  });
});
