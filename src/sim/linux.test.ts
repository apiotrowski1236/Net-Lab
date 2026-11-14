import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import { fileLine, fileRows, httpRequest, isoStamp, nginxStamp, shellWords, sshRequest, syslogStamp } from './linux';
import { parseCommand } from './terminal';
import { hostVerdict, parseUfw, ufwColumns, ufwRuleText, ufwStatus, UFW_DEFAULT } from './ufw';
import { checkCommand } from '../runtime/termInput';
import { newFirewall, type FwRuleInput } from './firewall';
import type { IpPacket } from './types';
import type { HostRun } from './terminal';

const EPOCH = Date.UTC(2026, 10, 16, 9, 0, 0);
const SERVER = '198.51.100.10';

const RULES: FwRuleInput[] = [
  { dir: 'in', proto: 'tcp', src: '203.0.113.140', dst: 'any', dport: 22, action: 'deny' },
  { dir: 'in', proto: 'tcp', src: 'any', dst: 'any', dport: 443, action: 'allow' },
  { dir: 'in', proto: 'tcp', src: 'any', dst: 'any', dport: 22, action: 'allow' },
  { dir: 'in', proto: 'any', src: 'any', dst: 'any', dport: 'any', action: 'deny' },
];

function net() {
  return new NetBuilder({ autoArp: true })
    .host('srv', {
      label: 'web01',
      icon: 'server',
      x: 100,
      y: 100,
      ip: `${SERVER}/24`,
      gateway: '198.51.100.1',
      services: [
        { port: 22, proto: 'tcp', app: 'ssh', program: 'sshd', banner: 'SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.10' },
        { port: 443, proto: 'tcp', app: 'https', program: 'nginx' },
      ],
      firewall: { mode: 'stateful', rules: RULES },
      linux: {
        hostname: 'web01',
        user: 'jo',
        epoch: EPOCH,
        users: { root: { uid: 0 }, jo: { uid: 1000, key: { id: 'jo-key', type: 'ED25519', fp: 'abc' } } },
        pages: { '/': 5120 },
        local: [{ proto: 'tcp', addr: '127.0.0.1', port: 25, program: 'master' }],
        sessions: [{ port: 22, peer: '192.0.2.15', pport: 50122, program: 'sshd' }],
        pids: { sshd: 812, nginx: 1044, master: 1290 },
      },
    })
    .router('r', {
      label: 'Internet',
      x: 300,
      y: 100,
      ifaces: [
        { id: 'a', ip: '198.51.100.1/24' },
        { id: 'b', ip: '203.0.113.1/24' },
      ],
    })
    .host('bad', { label: 'Bad', x: 500, y: 100, ip: '203.0.113.77/24', gateway: '203.0.113.1', attacker: true })
    .host('scan', { label: 'Scanner', x: 500, y: 200, ip: '203.0.113.140/24', gateway: '203.0.113.1', attacker: true })
    .switch('sw', { label: 'sw', x: 400, y: 100 })
    .link('srv', 'r')
    .link(['r', 'b'], 'sw')
    .link('bad', 'sw')
    .link('scan', 'sw')
    .build();
}

const lines = (sim: ReturnType<typeof net>, file: 'auth' | 'ufw' | 'access' | 'fail2ban') => fileRows(sim.dev('srv'), file).map((e) => fileLine(sim.dev('srv').linux!, e));
const run = (sim: ReturnType<typeof net>, line: string): HostRun => {
  const id = sim.runCommand('srv', line);
  sim.runUntilIdle();
  const r = sim.dev('srv').term!.find((x) => x.id === id)!;
  if (r.kind !== 'host') throw new Error('not a host run');
  return r;
};
const out = (r: HostRun) => r.out.map((l) => l.text);
const msg = (line: string) => {
  const r = parseCommand(line);
  if (r.ok) throw new Error(`parsed: ${line}`);
  return r.msg;
};

describe('stamps', () => {
  it('prints the three date formats', () => {
    const t = Date.UTC(2026, 10, 5, 3, 4, 7, 12);
    expect(syslogStamp(t)).toBe('Nov  5 03:04:07');
    expect(nginxStamp(t)).toBe('05/Nov/2026:03:04:07 +0000');
    expect(isoStamp(t)).toBe('2026-11-05 03:04:07,012');
  });
});

describe('host firewall', () => {
  it('checks requests for the computer from the top, and logs blocks in ufw format', () => {
    const sim = net();
    sim.connectService('bad', SERVER, 443, { data: httpRequest({ method: 'GET', path: '/', ua: 'curl/7.81.0' }) });
    sim.connectService('scan', SERVER, 22, { sport: 48211 });
    sim.connectService('bad', SERVER, 25, { sport: 51000 });
    sim.runUntilIdle();
    const conns = sim.dev('bad').conns!;
    expect(conns[0].status).toBe('open');
    expect(conns[0].banner).toBe('HTTP/1.1 200 OK');
    expect(conns[1].status).toBe('no-answer');
    expect(sim.dev('scan').conns![0]).toMatchObject({ status: 'no-answer', reason: 'firewall', at: 'srv' });
    const ufw = lines(sim, 'ufw');
    expect(ufw).toHaveLength(2);
    expect(ufw[0].replace(/:\d\d web01/, ':00 web01')).toBe('Nov 16 09:00:00 web01 kernel: [UFW BLOCK] IN=eth0 OUT= SRC=203.0.113.140 DST=198.51.100.10 LEN=60 TTL=63 PROTO=TCP SPT=48211 DPT=22 WINDOW=64240 SYN URGP=0');
    expect(fileRows(sim.dev('srv'), 'ufw')[0].fields).toMatchObject({ rule: 1, src: '203.0.113.140', dport: 22 });
    expect(fileRows(sim.dev('srv'), 'ufw')[1].fields).toMatchObject({ rule: 4, dport: 25 });
    expect(lines(sim, 'access')[0].replace(/09:00:\d\d/, '09:00:00')).toBe('203.0.113.77 - - [16/Nov/2026:09:00:00 +0000] "GET / HTTP/1.1" 200 5120 "-" "curl/7.81.0"');
  });

  it('checks what the computer sends: the default policy allows it, a rule can deny it', () => {
    const sim = net();
    sim.connectService('srv', '203.0.113.77', 80);
    sim.runUntilIdle();
    expect(sim.dev('srv').conns![0].status).toBe('closed');
    sim.runCommand('srv', 'ufw deny out to 203.0.113.0/24');
    sim.connectService('srv', '203.0.113.77', 80);
    sim.runUntilIdle();
    expect(sim.dev('srv').conns![1]).toMatchObject({ status: 'no-answer', reason: 'firewall' });
    expect(lines(sim, 'ufw').at(-1)).toContain('[UFW BLOCK] IN= OUT=eth0 SRC=198.51.100.10 DST=203.0.113.77');
  });

  it('decides by port even if the firewall is set to next-gen mode, has intrusion prevention, or a rule names a program', () => {
    const fw = newFirewall('eth0', 'ngfw', [
      { dir: 'in', proto: 'tcp', src: 'any', dst: 'any', dport: 443, action: 'deny', app: 'remote-control' },
      { dir: 'in', proto: 'tcp', src: 'any', dst: 'any', dport: 443, action: 'allow' },
    ]);
    fw.ips = true;
    const pkt: IpPacket = { src: '203.0.113.77', dst: SERVER, ttl: 64, proto: 'tcp', srcPort: 50000, dstPort: 443, app: { kind: 'svc', conn: 1, app: 'HTTPS', reply: false, text: "GET /?q=' OR 1=1 HTTP/1.1" } };
    expect(hostVerdict(fw, pkt, 'in', UFW_DEFAULT)).toMatchObject({ action: 'allow', by: 'rule', ruleNo: 2 });
    expect(hostVerdict(fw, { ...pkt, dstPort: 25 }, 'in', UFW_DEFAULT)).toMatchObject({ action: 'deny', by: 'implicit' });
  });

  it('marks a port scan probe with nmap’s packet size and window', () => {
    const sim = net();
    sim.scan('scan', SERVER, [25], 10);
    sim.runUntilIdle();
    expect(lines(sim, 'ufw').some((l) => l.includes('LEN=44') && l.includes('WINDOW=1024') && l.includes('DPT=25'))).toBe(true);
  });
});

describe('sshd and fail2ban', () => {
  it('writes one auth.log line per sign-in attempt', () => {
    const sim = net();
    sim.connectService('bad', SERVER, 22, { sport: 40001, data: sshRequest({ user: 'admin', auth: 'password' }) });
    sim.connectService('bad', SERVER, 22, { sport: 40002, data: sshRequest({ user: 'root', auth: 'password' }) });
    sim.runUntilIdle();
    const auth = lines(sim, 'auth');
    expect(auth[0]).toMatch(/^Nov 16 09:00:\d\d web01 sshd\[\d+\]: Failed password for invalid user admin from 203\.0\.113\.77 port 40001 ssh2$/);
    expect(auth[1]).toMatch(/sshd\[\d+\]: Failed password for root from 203\.0\.113\.77 port 40002 ssh2$/);
    expect(sim.dev('bad').conns![0].banner).toBe('Permission denied, please try again.');
  });

  it('fail2ban doesn’t count a [preauth] close, as in its default mode', () => {
    const sim = net();
    sim.linuxSet('srv', 'fail2ban', true);
    sim.linuxSet('srv', 'passwords', false);
    for (let i = 0; i < 6; i++) sim.connectService('bad', SERVER, 22, { sport: 40100 + i, data: sshRequest({ user: 'admin', auth: 'password' }) });
    sim.runUntilIdle();
    expect(lines(sim, 'auth').filter((l) => l.endsWith('[preauth]'))).toHaveLength(6);
    expect(lines(sim, 'fail2ban').some((l) => l.includes('Found'))).toBe(false);
    expect(sim.dev('srv').linux!.f2b.banned).toEqual([]);
  });

  it('accepts the right key and logs the session', () => {
    const sim = net();
    sim.linuxSet('srv', 'passwords', false);
    sim.connectService('bad', SERVER, 22, { sport: 40003, data: sshRequest({ user: 'jo', auth: 'publickey', key: 'jo-key', sftp: true }) });
    sim.connectService('bad', SERVER, 22, { sport: 40004, data: sshRequest({ user: 'ghost', auth: 'password' }) });
    sim.runUntilIdle();
    const auth = lines(sim, 'auth').map((l) => l.replace(/^.*?\]: /, ''));
    expect(auth).toEqual([
      'Received SIGHUP; restarting.',
      'Server listening on 0.0.0.0 port 22.',
      'Accepted publickey for jo from 203.0.113.77 port 40003 ssh2: ED25519 SHA256:abc',
      'pam_unix(sshd:session): session opened for user jo(uid=1000) by (uid=0)',
      'subsystem request for sftp by user jo',
      'Connection closed by invalid user ghost 203.0.113.77 port 40004 [preauth]',
    ]);
  });

  it('bans an address at the top of the firewall after 5 failures', () => {
    const sim = net();
    sim.linuxSet('srv', 'fail2ban', true);
    for (let i = 0; i < 8; i++) sim.schedule(i * 200, () => sim.connectService('bad', SERVER, 22, { data: sshRequest({ user: `u${i}`, auth: 'password' }) }));
    sim.runUntilIdle();
    const dev = sim.dev('srv');
    expect(dev.firewall!.rules[0]).toMatchObject({ src: '203.0.113.77', action: 'deny', note: 'fail2ban' });
    expect(fileRows(dev, 'auth').filter((e) => e.fields?.result === 'invalid')).toHaveLength(5);
    expect(fileRows(dev, 'ufw').filter((e) => e.fields?.src === '203.0.113.77')).toHaveLength(3);
    const f2b = lines(sim, 'fail2ban');
    expect(f2b.at(-1)).toMatch(/^2026-11-16 09:00:\d\d,\d{3} fail2ban\.actions {8}\[\d+\]: NOTICE  \[sshd\] Ban 203\.0\.113\.77$/);
    expect(f2b.filter((l) => l.includes('Found 203.0.113.77'))).toHaveLength(5);
    expect(out(run(sim, 'ufw status numbered'))[4]).toBe('[ 1] Anywhere                   DENY IN     203.0.113.77               # fail2ban');
  });

  it('reads back through auth.log when it starts, and bans failures still inside findtime', () => {
    const sim = net();
    for (let i = 0; i < 6; i++) sim.schedule(i * 200, () => sim.connectService('bad', SERVER, 22, { data: sshRequest({ user: `u${i}`, auth: 'password' }) }));
    sim.runUntilIdle();
    const dev = sim.dev('srv');
    expect(dev.firewall!.rules.some((r) => r.note === 'fail2ban')).toBe(false);
    sim.linuxSet('srv', 'fail2ban', true);
    sim.runUntilIdle();
    expect(dev.firewall!.rules[0]).toMatchObject({ src: '203.0.113.77', action: 'deny', note: 'fail2ban' });
    expect(lines(sim, 'fail2ban').filter((l) => l.includes('Found 203.0.113.77'))).toHaveLength(5);
  });
});

describe('ufw', () => {
  it('reads the rule shapes ufw takes', () => {
    const rule = (s: string) => {
      const r = parseUfw(s.split(' '));
      if (!r.ok || r.op.op !== 'add') throw new Error(s);
      return r.op;
    };
    expect(rule('deny from 203.0.113.77')).toEqual({ op: 'add', rule: { dir: 'in', proto: 'any', src: '203.0.113.77', dst: 'any', dport: 'any', action: 'deny' } });
    expect(rule('insert 1 deny from 203.0.113.77 to any port 22')).toEqual({ op: 'add', at: 1, rule: { dir: 'in', proto: 'any', src: '203.0.113.77', dst: 'any', dport: 22, action: 'deny' } });
    expect(rule('allow from 192.0.2.0/24 to any port 22 proto tcp').rule).toMatchObject({ src: '192.0.2.0/24', dport: 22, proto: 'tcp' });
    expect(rule('allow 22/tcp').rule).toMatchObject({ src: 'any', dport: 22, proto: 'tcp' });
    expect(rule('allow ssh').rule).toMatchObject({ dport: 22, proto: 'tcp' });
    expect(rule('allow from 192.0.2.7/24 to any port ssh').rule).toMatchObject({ src: '192.0.2.0/24', dport: 22, proto: 'tcp' });
    expect(rule('deny out to 203.0.113.0/24').rule).toMatchObject({ dir: 'out', dst: '203.0.113.0/24' });
    expect(rule('allow 22/tcp comment Office').rule).toMatchObject({ src: 'any', dport: 22, proto: 'tcp', note: 'Office' });
    expect(rule('deny from 203.0.113.77 comment spray').rule).toMatchObject({ src: '203.0.113.77', note: 'spray' });
    expect(msg('ufw deny from 203.0.113.77 from 203.0.113.78')).toMatch(/^ERROR: Invalid syntax\. A rule has one from\./);
  });

  it('explains mistakes with ufw’s error and what to type', () => {
    expect(msg('ufw')).toBe('Usage: ufw COMMAND. Try ufw status numbered.');
    expect(msg('ufw deny from 203.0.113')).toBe("ERROR: Bad source address. “203.0.113” isn't a whole address: write four numbers with dots between them, like 203.0.113.9.");
    expect(msg('ufw deny 203.0.113.77')).toBe('ERROR: Invalid syntax. To deny a computer, write from before its address: ufw deny from 203.0.113.77');
    expect(msg('ufw deny from 203.0.113.77 port')).toBe('ERROR: Bad port. Put a port number after port. Write a number like 22.');
    expect(msg('ufw insert first deny from 203.0.113.77')).toBe('ERROR: Insert position must be a number. Type it like this: ufw insert 1 deny from 203.0.113.9');
    expect(msg('ufw insert 0 deny from 203.0.113.77')).toBe("ERROR: Invalid position '0'. Rule numbers start at 1.");
    expect(msg('ufw block from 203.0.113.77')).toBe('ERROR: Invalid syntax. ufw doesn’t know “block”. Try ufw status numbered, ufw deny from <address>, ufw insert <number> ..., or ufw delete <number>.'.replace('doesn’t', "doesn't"));
    expect(msg('ufw disable')).toBe('This lab keeps the firewall on and its rules in place. Change one rule at a time with allow, deny, insert, and delete.');
    expect(msg('ufw deny to any port')).toBe('ERROR: Bad port. Put a port number after port. Write a number like 22.');
    expect(msg('ufw allow')).toBe('ERROR: Wrong number of arguments. Say what to allow. Type it like this: ufw deny from 203.0.113.9, or ufw allow from 192.0.2.0/24 to any port 22.');
    expect(msg('sudo')).toBe('usage: sudo <command>. sudo runs one command as the administrator: sudo ufw status numbered');
  });

  it('prints status the way ufw does', () => {
    const sim = net();
    expect(out(run(sim, 'sudo ufw status numbered'))).toEqual([
      'Status: active',
      '',
      '     To                         Action      From',
      '     --                         ------      ----',
      '[ 1] 22/tcp                     DENY IN     203.0.113.140',
      '[ 2] 443/tcp                    ALLOW IN    Anywhere',
      '[ 3] 22/tcp                     ALLOW IN    Anywhere',
      '[ 4] Anywhere                   DENY IN     Anywhere',
      '',
    ]);
    expect(out(run(sim, 'ufw status verbose'))).toEqual([
      'Status: active',
      'Logging: on (low)',
      'Default: deny (incoming), allow (outgoing), disabled (routed)',
      'New profiles: skip',
      '',
      'To                         Action      From',
      '--                         ------      ----',
      '22/tcp                     DENY IN     203.0.113.140',
      '443/tcp                    ALLOW IN    Anywhere',
      '22/tcp                     ALLOW IN    Anywhere',
      'Anywhere                   DENY IN     Anywhere',
      '',
    ]);
    expect(out(run(sim, 'ufw status'))[4]).toBe('22/tcp                     DENY        203.0.113.140');
    expect(out(run(sim, 'ufw status'))[5]).toBe('443/tcp                    ALLOW       Anywhere');
  });

  it('adds at the bottom, inserts, skips, updates, and deletes', () => {
    const sim = net();
    let r = run(sim, 'ufw deny from 203.0.113.77');
    expect(out(r)).toEqual(['Rule added']);
    expect(r.meaning).toBe('ufw put it at the bottom, as rule 5. Rule 4 above it matches every incoming packet, and ufw stops at the first match, so it never gets to rule 5.');
    r = run(sim, 'ufw insert 1 deny from 203.0.113.77');
    expect(out(r)).toEqual(['Skipping inserting existing rule']);
    expect(r.meaning).toBe('ufw already has this exact rule (rule 5), so nothing changed. To move it, delete rule 5 first, then insert it where you want it.');
    expect(out(run(sim, 'ufw delete 5'))).toEqual(['Deleting:', ' deny from 203.0.113.77 to any', 'Rule deleted']);
    expect(out(run(sim, 'ufw insert 1 deny from 203.0.113.77'))).toEqual(['Rule inserted']);
    expect(sim.dev('srv').firewall!.rules[0].src).toBe('203.0.113.77');
    expect(out(run(sim, 'ufw delete 9'))).toEqual(["ERROR: Could not find rule '9'"]);
    expect(out(run(sim, 'ufw insert 9 allow 80/tcp'))).toEqual(["ERROR: Invalid position '9'"]);
    expect(out(run(sim, 'ufw deny 22/tcp'))).toEqual(['Rule updated']);
    expect(sim.dev('srv').firewall!.rules[3]).toMatchObject({ dport: 22, src: 'any', action: 'deny' });
    expect(out(run(sim, 'ufw delete allow 21/tcp'))).toEqual(['Could not delete non-existent rule']);
    expect(out(run(sim, 'ufw delete deny 22/tcp'))).toEqual(['Deleting:', ' deny 22/tcp', 'Rule deleted']);
  });

  it('writes rules as commands and columns', () => {
    expect(ufwRuleText({ dir: 'in', proto: 'tcp', src: '203.0.113.140', dst: 'any', dport: 22, action: 'deny' })).toBe('deny from 203.0.113.140 to any port 22 proto tcp');
    expect(ufwRuleText({ dir: 'in', proto: 'tcp', src: 'any', dst: 'any', dport: 21, action: 'allow' })).toBe('allow 21/tcp');
    expect(ufwColumns({ dir: 'in', proto: 'any', src: '198.18.40.0/24', dst: 'any', dport: 22, action: 'allow' })).toEqual({ to: '22', action: 'ALLOW IN', from: '198.18.40.0/24', tail: '' });
    expect(ufwStatus({ outside: 'eth0', mode: 'stateful', rules: [], conns: [], nextId: 1 }, UFW_DEFAULT)).toEqual(['Status: active', '', 'To                         Action      From', '--                         ------      ----', '']);
  });
});

describe('ss, grep, tail', () => {
  it('lists listening ports', () => {
    const sim = net();
    const r = run(sim, 'ss -tuln');
    expect(out(r)).toEqual([
      'Netid State   Recv-Q Send-Q     Local Address:Port      Peer Address:Port',
      'tcp   LISTEN  0      128                0.0.0.0:22              0.0.0.0:*',
      'tcp   LISTEN  0      100              127.0.0.1:25              0.0.0.0:*',
      'tcp   LISTEN  0      511               0.0.0.0:443              0.0.0.0:*',
    ]);
    expect(r.meaning).toBe(
      '3 sockets are listening (UDP ones show UNCONN). 2 of them use 0.0.0.0, which means "every address this server has": anyone the firewall lets through can connect. 127.0.0.1 and 127.0.0.53 accept connections only from programs on this server.',
    );
    expect(out(run(sim, 'ss -tp'))).toEqual([
      'Netid State   Recv-Q Send-Q     Local Address:Port      Peer Address:Port Process',
      'tcp   ESTAB   0      0           198.51.100.10:ssh       192.0.2.15:50122 users:(("sshd",pid=812,fd=4))',
    ]);
    expect(msg('ss -x')).toBe("ss: invalid option -- 'x'. This ss knows -t (TCP), -u (UDP), -l (listening ports), -n (numbers instead of names), -p (the program), and -a (all).");
  });

  it('greps a file with line numbers, counts, and quotes', () => {
    const sim = net();
    for (const u of ['admin', 'root', 'test']) sim.connectService('bad', SERVER, 22, { data: sshRequest({ user: u, auth: 'password' }) });
    sim.runUntilIdle();
    let r = run(sim, 'grep -n "invalid user" /var/log/auth.log');
    expect(out(r).map((l) => l.replace(/^(\d+):.* web01 .*for /, '$1:… '))).toEqual(['1:… invalid user admin from 203.0.113.77 port 49152 ssh2', '3:… invalid user test from 203.0.113.77 port 49154 ssh2']);
    expect(r.meaning).toBe('2 lines contain “invalid user”. The number before each line is its line number in the file.');
    expect(out(run(sim, 'grep -c Failed /var/log/auth.log'))).toEqual(['3']);
    r = run(sim, 'grep failed /var/log/auth.log');
    expect(r.meaning).toBe('No line contains “failed”. grep matches capital letters exactly. Add -i to ignore them.');
    expect(out(run(sim, 'grep -ic failed /var/log/auth.log'))).toEqual(['3']);
    r = run(sim, 'grep Failed auth.log');
    expect(out(r)).toEqual(['grep: auth.log: No such file or directory', 'The file is /var/log/auth.log. Type the whole path, starting with /.']);
    expect(out(run(sim, 'grep "Failed password" -n /var/log/auth.log'))[0]).toMatch(/^1:Nov 16/);
    expect(out(run(sim, 'grep -- -n /var/log/auth.log'))).toEqual([]);
    expect(msg('grep Failed')).toBe('grep needs a file after the text. Type it like this: grep Failed /var/log/auth.log');
    expect(msg('grep "Failed password /var/log/auth.log')).toBe('A quote is missing its partner. Close the text with the same kind of quote: grep "Failed password" /var/log/auth.log');
  });

  it('tails the end of a file', () => {
    const sim = net();
    for (const u of ['a', 'b', 'c']) sim.connectService('bad', SERVER, 22, { data: sshRequest({ user: u, auth: 'password' }) });
    sim.runUntilIdle();
    const r = run(sim, 'tail -n 2 /var/log/auth.log');
    expect(r.out).toHaveLength(2);
    expect(r.meaning).toBe('Lines 2 to 3 of /var/log/auth.log, the newest at the bottom.');
    expect(msg('tail -f /var/log/auth.log')).toBe('tail -f keeps watching a file, and this terminal runs one command at a time. Run tail again to see new lines, or watch the Log files card.');
  });

  it('splits words like a shell', () => {
    expect(shellWords(`grep -n "Failed password" /var/log/auth.log`)).toEqual(['grep', '-n', 'Failed password', '/var/log/auth.log']);
    expect(shellWords(`grep '' x`)).toEqual(['grep', '', 'x']);
    expect(shellWords(`grep "x`)).toBeUndefined();
  });
});

describe('typed checks', () => {
  const spec = { kind: 'terminal' as const, devices: ['srv', 'bad'], commands: ['ufw' as const, 'grep' as const, 'ss' as const] };
  it('refuses a mixed-up from and to', () => {
    const sim = net();
    const m = (line: string, at = 'srv') => {
      const r = checkCommand(sim, spec, at, line);
      return r.ok ? 'ok' : r.msg;
    };
    expect(m('ufw deny to 203.0.113.77')).toBe('“to 203.0.113.77” matches packets going to 203.0.113.77. Packets that computer sends here come from it. Write from: ufw deny from 203.0.113.77');
    expect(m('ufw deny from 203.0.113.77 port 22')).toBe(
      '“from 203.0.113.77 port 22” means traffic sent from port 22 on that computer. To match traffic going to this server\'s port 22, write to any port 22: ufw deny from 203.0.113.77 to any port 22',
    );
    expect(m('ufw deny from 203.0.113.77 to 198.51.100.10 port 22')).toBe('ok');
    expect(m('ss -tuln', 'bad')).toBe("ss runs on a Linux server. Bad isn't one.");
    expect(m('ping 10.0.0.1')).toBe('This step doesn’t use ping. Try ufw, grep or ss.');
  });
});
