import { checkRows, rowsText } from '../../runtime/citeRows';
import type { LogFile } from '../../sim/linux';
import { scanFindings } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { HostCommand } from '../../sim/linux';
import { happened, inspected, loggedSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, CheckCtx, LabDef, MapZone, QuestionDef, ToolSpec } from '../types';
import {
  botAttack,
  botIp,
  botnetAttack,
  buildCoop,
  customerVisit,
  describeRow,
  ensureFail2ban,
  ensureSprayBlocked,
  ftpClosed,
  fw,
  hostRuns,
  IP,
  joSignIn,
  connVerdict,
  lastConn,
  lx,
  NET,
  rdpClosed,
  replayScan,
  replaySpray,
  RESCAN_PORTS,
  ROWS,
  rowsSince,
  scannerRdp,
  scannerSsh,
  sprayRule,
  sshOfficeOnly,
  vendorUpload,
  verdictWords,
  WEB,
} from './scenario';

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function zones(): MapZone[] {
  return [
    { id: 'coop', shape: { kind: 'rect', x: 60, y: 290, w: 230, h: 200 }, label: 'Harbor Food Co-op server', tone: 'good' },
    { id: 'office', shape: { kind: 'rect', x: 220, y: 80, w: 220, h: 170 }, label: `Co-op office ${NET.office}`, tone: 'neutral' },
    { id: 'vendor', shape: { kind: 'rect', x: 610, y: 80, w: 220, h: 170 }, label: `Bayline Farms ${NET.vendor}`, tone: 'neutral' },
    { id: 'unknown', shape: { kind: 'rect', x: 740, y: 400, w: 480, h: 320 }, label: 'Unknown addresses 203.0.113.0/24', tone: 'bad', dashed: true },
  ];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const term = (commands: HostCommand[]): ToolSpec => ({ kind: 'terminal', devices: [WEB], commands });
const logs = (files: LogFile[]): ToolSpec => ({ kind: 'log-files', device: WEB, files });
const guard = (controls: ('fail2ban' | 'passwords')[]): ToolSpec => ({ kind: 'ssh-guard', device: WEB, controls });
const ALL_LOGS: LogFile[] = ['auth', 'ufw', 'access', 'fail2ban'];

// ---------------------------------------------------------------------------
// Lesson buttons
// ---------------------------------------------------------------------------

/**
 * The lines under a one-connection button: which rule decided, then what
 * came back. `friend` sets the tone: a blocked customer is bad news, a
 * blocked attacker good news.
 */
function connLines(sim: Sim, since: number, from: string, tag: string, who: string, friend: boolean, answered: (banner: string) => string): ActionLine[] {
  const c = lastConn(sim, from, since, tag);
  if (!c) return [{ tone: 'wait', text: 'On its way…' }];
  const v = verdictWords(sim, c);
  if (c.status === 'pending') {
    if (connVerdict(sim, c)?.action === 'deny') return [{ tone: 'wait', text: `${v}. ${who} waits for an answer that never comes…` }];
    return [{ tone: 'wait', text: v ? `${v}. Waiting for an answer…` : 'On its way…' }];
  }
  if (c.status === 'open') return [{ tone: friend ? 'good' : 'bad', text: `${v ?? 'Allowed'}. ${answered(c.banner ?? '')}` }];
  return [{ tone: friend ? 'bad' : 'good', text: `${v ?? 'Blocked'}. ufw dropped it and wrote a line in ufw.log. ${who} got no answer.` }];
}

const customer: ActionDef = {
  id: 'customer',
  label: 'A customer opens the order page',
  run: customerVisit,
  outcome: (sim, since) => connLines(sim, since, 'customer', 'customer', 'The customer', true, (b) => `nginx answered “${b}”, and access.log has a new line.`),
};

const jo: ActionDef = {
  id: 'jo',
  label: 'Jo signs in from the office',
  run: joSignIn,
  outcome: (sim, since) => connLines(sim, since, 'jo', 'jo', 'Jo', true, () => 'Jo signed in with a key. auth.log has an Accepted publickey line.'),
};

const scanSsh: ActionDef = {
  id: 'scan-ssh',
  label: '203.0.113.140 tries SSH',
  run: scannerSsh,
  outcome: (sim, since) => connLines(sim, since, 'scanner', 'scanner-ssh', '203.0.113.140', false, () => 'sshd answered and asked for a password.'),
};

const scanRdp: ActionDef = {
  id: 'scan-rdp',
  label: '203.0.113.140 tries remote desktop',
  run: scannerRdp,
  outcome: (sim, since) => connLines(sim, since, 'scanner', 'scanner-rdp', '203.0.113.140', false, (b) => `xrdp answered (“${b}”) and showed a sign-in screen.`),
};

const vendor: ActionDef = {
  id: 'vendor',
  label: "Run Bayline Farms' nightly upload now",
  run: vendorUpload,
  outcome: (sim, since) => {
    const c = lastConn(sim, 'vendor', since, 'vendor');
    if (c && c.status === 'no-answer') {
      return [{ tone: 'bad', text: `${verdictWords(sim, c) ?? 'Blocked'}. The upload failed, so tonight's orders won't reach the co-op.` }];
    }
    return connLines(sim, since, 'vendor', 'vendor', 'Bayline Farms', true, () => 'Bayline Farms signed in with its key and sent the order file over SFTP.');
  },
};

/** The lines under a button that makes several sign-in guesses. */
function guessLines(sim: Sim, since: number, from: string, tag: string, n: number): { done: boolean; reached: number; blocked: number; lines: ActionLine[] } {
  const cs = (sim.dev(from).conns ?? []).filter((c) => c.t >= since && c.tag === tag);
  const done = cs.length === n && cs.every((c) => c.status !== 'pending');
  const reached = cs.filter((c) => c.status === 'open').length;
  const blocked = cs.filter((c) => c.status === 'no-answer').length;
  const dropped = cs.some((c) => connVerdict(sim, c)?.action === 'deny');
  const why = dropped ? ' ufw dropped a guess, and the attacker waits for an answer that never comes.' : '';
  return { done, reached, blocked, lines: done ? [] : [{ tone: 'wait', text: `Guessing… ${cs.filter((c) => c.status !== 'pending').length} of ${n} done.${why}` }] };
}

const spray: ActionDef = {
  id: 'spray',
  label: 'Replay the spray from 203.0.113.77',
  run: replaySpray,
  outcome: (sim, since) => {
    const g = guessLines(sim, since, 'sprayer', 'spray', 4);
    if (!g.done) return g.lines;
    const first = (sim.dev('sprayer').conns ?? []).find((c) => c.t >= since && c.tag === 'spray');
    const v = first ? verdictWords(sim, first) : undefined;
    const why = v ? ` ${v}.` : '';
    if (g.reached) return [{ tone: 'bad', text: `${g.reached} of 4 guesses reached sshd.${why} Each wrong guess is a new Failed password line in auth.log.` }];
    return [{ tone: 'good', text: `All 4 guesses were blocked.${why} sshd never saw them, so auth.log has no new lines from 203.0.113.77.` }];
  },
};

const bot: ActionDef = {
  id: 'bot',
  label: 'A bot starts guessing passwords',
  run: botAttack,
  outcome: (sim, since) => {
    const g = guessLines(sim, since, 'bot', 'bot', 8);
    if (!g.done) return g.lines;
    const ip = botIp(sim);
    if (!g.blocked) return [{ tone: 'bad', text: `All 8 guesses from ${ip} reached sshd. Nothing stopped them: fail2ban is off.` }];
    if (!g.reached) return [{ tone: 'good', text: `${ip} is already banned. ufw blocked all 8 guesses before sshd saw them.` }];
    return [{ tone: 'good', text: `${g.reached} guesses reached sshd. Then fail2ban banned ${ip}, and ufw blocked the last ${g.blocked}.` }];
  },
};

const botnet: ActionDef = {
  id: 'botnet',
  label: 'The botnet tries again',
  run: botnetAttack,
  outcome: (sim, since) => {
    const g = guessLines(sim, since, 'bot', 'botnet', 3);
    if (!g.done) return g.lines;
    const ip = botIp(sim);
    const cs = (sim.dev('bot').conns ?? []).filter((c) => c.t >= since && c.tag === 'botnet');
    if (g.blocked) return [{ tone: 'good', text: `This time it came from ${ip}. ufw blocked ${g.blocked} of 3 guesses.` }];
    if (cs.every((c) => c.banner?.includes('publickey')))
      return [{ tone: 'good', text: `3 tries from ${ip}. sshd closed each connection before any password: password sign-in is off, so no guess can work.` }];
    return [
      {
        tone: 'bad',
        text: `3 guesses from ${ip}, a new address. All 3 reached sshd. fail2ban counts 3 failures from this address, under its limit of 5, so it bans nobody.`,
      },
    ];
  },
};

const rescan: ActionDef = {
  id: 'rescan',
  label: 'Replay the scan from 203.0.113.140',
  run: replayScan,
  outcome: (sim, since) => {
    const s = (sim.dev('scanner').scans ?? []).filter((x) => x.t >= since).pop();
    if (!s || s.doneAt === undefined) return [{ tone: 'wait', text: 'Scanning web01…' }];
    const blocked = rowsSince(sim, 'ufw', since).filter((e) => e.fields?.src === IP.scanner).length;
    const open = scanFindings(s).flatMap((h) => h.open);
    return [
      {
        tone: 'good',
        text: `The scan pinged web01 to check it was up (ufw lets ping through), then knocked on ${RESCAN_PORTS.length} ports. ufw blocked ${blocked} packets and wrote a line for each in ufw.log. Ports ${open.join(', ')} answered, and ufw wrote nothing about them.`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

const tested = (from: string, tag: string) => ({ sim, since }: CheckCtx) => {
  const c = lastConn(sim, from, since, tag);
  return !!c && c.status !== 'pending';
};

/** A finished terminal command on web01 since the step began. */
const ran = (pred: (cmd: string, line: string, out: string) => boolean) => ({ sim, since }: CheckCtx) =>
  hostRuns(sim, since).some((r) => pred(r.cmd, r.line, r.out.map((o) => o.text).join('\n')));

/** The last time password sign-in was turned off. */
function passwordsOffAt(sim: Sim): number | undefined {
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i];
    if (e.type === 'config' && e.device === WEB && e.what === 'ssh-passwords') return e.on ? undefined : e.t;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const cite = (id: string, prompt: string, file: LogFile, want: number[], what: string, explain: string): QuestionDef => ({
  id,
  kind: 'text',
  prompt,
  short: true,
  placeholder: 'Rows, like 4-9',
  expect: /\d/,
  expectHint: 'Write row numbers, like 4-9 or 4, 5, 6.',
  verify: (v) => checkRows(v, want, what, (n) => describeRow(file, n)),
  explain,
});

// ---------------------------------------------------------------------------
// The lab
// ---------------------------------------------------------------------------

export const deviceAnalysisLab: LabDef = {
  id: 'device-analysis',
  version: 1,
  title: 'Device Security Analysis',
  tagline: "One web server, four kinds of evidence. Read its firewall rules and logs, find two attacks, change the rules, and stop the next attack while it happens.",
  unit: 3,
  codehs: ['3.18 The Story in the Logs', '3.19 Securing Networks Quiz', '3.10 The Rules of the Firewall', '3.12 Writing the Rulebooks'],
  ced: ['3.4.B', '3.4.D', '3.5.A', '3.5.E', '3.1.C', '3.2.A'],
  minutes: 55,
  objectives: [
    "Trace a connection through a host-based firewall's numbered rules, and explain why the first rule that matches decides.",
    'Find a password spray in auth.log, a port scan in ufw.log, and directory traversal in an access log, citing the rows and the attacker’s address.',
    'Write ufw commands that block an address, and explain why a new rule has to go above the rule it overrides.',
    'Describe how an automated system (fail2ban) halts an attack while it happens, name another countermeasure, and predict the impact of a rule change.',
  ],
  build: buildCoop,
  clock: '09:00',
  map: { addresses: (d) => d.kind !== 'switch', zones },
  steps: [
    {
      id: 'case',
      title: 'The case',
      body: md`
        Harbor Food Co-op sells groceries online at shop.harborfood.example. One Ubuntu Linux server runs the site: [[web01]]. Jo, the co-op's part-time admin, takes care of it from [[jo]] at the office. Every night at 2:10, the farm that supplies the co-op, [[vendor]], uploads the next day's order file to it.

        It's Monday morning. Over the weekend, something hammered the server. You have Jo's evidence: the server's firewall rules, its log files, and the co-op's server policy. Your job is the one on the AP exam's free-response question: read the evidence, find the attacks, and fix what let them in.

        Everything in this lab happens inside a simulation. Attacking or scanning a real server without permission is illegal.

        **The co-op's server policy**

        1. Only the website (ports 80 and 443) is open to everyone on the internet.
        2. Remote administration (SSH, remote desktop, screen sharing) is allowed only from the office network, 192.0.2.0/24.
        3. Files move only over encrypted connections: **SFTP** (file transfer over SSH), never FTP. Bayline Farms uploads the nightly order file this way, from its own network.
        4. Security updates are installed within 7 days.
        5. Someone reviews the server's logs every Monday.

        Click **web01** on the map. Scroll to **Firewall rules (ufw)**. This is a **host-based firewall**: a firewall that runs on the computer it protects and checks every packet that arrives for it. ufw checks the rules from the top, and the first rule that matches a packet decides. Rule 10 denies everything, so anything the rules above it don't allow is blocked.

        Next, see which programs are waiting for connections. A program that waits on a port is **listening**. The **Terminal** in the Toolkit is signed in to web01 as Jo. Type \`ss -tuln\` and press Enter. (\`-t\` means TCP, \`-u\` UDP, \`-l\` listening, \`-n\` numbers instead of names.) If the Terminal is too short to read, press **Bigger**.

        ss shows more than the **Open ports** table in Inspect does. It also lists programs that listen only on 127.0.0.1, the server's address for talking to itself. Nothing outside the server can reach those.
      `,
      focus: [WEB],
      tools: [term(['ss', 'ufw'])],
      goals: [
        { id: 'inspect', label: 'Click web01 on the map and find its firewall rules', check: inspected(WEB) },
        {
          id: 'ss',
          label: 'List the listening ports with ss -tuln',
          hint: 'Type ss -tuln in the Terminal and press Enter.',
          check: ran((cmd, line) => cmd === 'ss' && /-\w*l/.test(line)),
        },
      ],
      questions: [
        {
          id: 'site-rule',
          kind: 'choice',
          prompt: 'Customers order on the co-op’s website, which uses HTTPS on port 443. Which rule lets them in?',
          options: [
            { id: 'r4', text: 'Rule 4: ALLOW 443/tcp from Anywhere', correct: true },
            { id: 'r3', text: 'Rule 3: ALLOW 80/tcp from Anywhere', feedback: 'Port 80 is HTTP, the unencrypted web. The order site uses HTTPS on 443.' },
            { id: 'r5', text: 'Rule 5: ALLOW 22/tcp from Anywhere', feedback: 'Port 22 is SSH, for remote administration. The website doesn’t use it.' },
            { id: 'r10', text: 'Rule 10: DENY everything from Anywhere', feedback: 'Rule 10 blocks. A packet only gets to rule 10 when no rule above it matched, and rule 4 matches HTTPS first.' },
          ],
          explain: 'ufw reads down the list. Rules 1 to 3 don’t match a packet for port 443. Rule 4 does, so it decides: allow.',
        },
      ],
    },

    {
      id: 'trace',
      title: 'Trace the table',
      body: md`
        Before you test a rule, predict it. For each connection below, find the first rule that matches. The direction, the source address, and the port all have to fit. **Anywhere** fits every address.

        Answer the two questions before you press the buttons, so you're predicting. Then press each button and watch the matching row light up in [[web01]]'s rules.

        - A customer at 198.19.7.44 opens the order page (HTTPS, port 443): [[button:customer]]
        - Jo signs in from the office with SSH (port 22): [[button:jo]]
        - 203.0.113.140 tries to sign in with SSH (port 22): [[button:scan-ssh]]
        - 203.0.113.140 tries remote desktop (RDP, port 3389): [[button:scan-rdp]]

        ufw is a **stateful** firewall: it remembers each connection it allowed, so the server's replies go back out without a rule of their own.
      `,
      open: { inspect: WEB },
      actions: [customer, jo, scanSsh, scanRdp],
      goals: [
        { id: 'customer', label: 'Test the customer’s connection', check: tested('customer', 'customer') },
        { id: 'jo', label: 'Test Jo’s SSH sign-in', check: tested('jo', 'jo') },
        { id: 'scan-ssh', label: 'Test SSH from 203.0.113.140', check: tested('scanner', 'scanner-ssh') },
        { id: 'scan-rdp', label: 'Test remote desktop from 203.0.113.140', check: tested('scanner', 'scanner-rdp') },
      ],
      questions: [
        {
          id: 'jo-rule',
          kind: 'choice',
          prompt: 'Predict: which rule decides Jo’s SSH sign-in from 192.0.2.15?',
          options: [
            { id: 'r5', text: 'Rule 5: ALLOW 22/tcp from Anywhere', correct: true },
            { id: 'r1', text: 'Rule 1: DENY 22/tcp from 203.0.113.140', feedback: 'Rule 1 only matches packets from 203.0.113.140. Jo’s laptop is 192.0.2.15, so ufw moves on to rule 2.' },
            { id: 'r8', text: 'Rule 8: ALLOW 5900/tcp from 192.0.2.15', feedback: 'Rule 8 names Jo’s address, but its port is 5900, screen sharing. SSH is port 22.' },
            { id: 'r10', text: 'Rule 10: DENY everything from Anywhere', feedback: 'A rule above rule 10 matches first. Look for one with port 22 whose source includes 192.0.2.15.' },
          ],
          explain: 'Rule 1 doesn’t match Jo’s address. Rules 2 to 4 are other ports. Rule 5 matches: port 22, from Anywhere.',
        },
        {
          id: 'rdp-rule',
          kind: 'choice',
          prompt: 'Predict: what happens when 203.0.113.140 tries remote desktop on port 3389?',
          options: [
            { id: 'r7', text: 'Rule 7 allows it', correct: true },
            {
              id: 'r1',
              text: 'Rule 1 blocks it, because it blocks that address',
              feedback: 'Rule 1 blocks 203.0.113.140 only on port 22. A packet for 3389 doesn’t match it, so ufw keeps going down the list.',
            },
            { id: 'r10', text: 'Rule 10 blocks it', feedback: 'Rule 7 matches first: 3389 from Anywhere. ufw stops at the first match, so rule 10 never sees it.' },
            { id: 'r5', text: 'Rule 5 allows it', feedback: 'Rule 5 is port 22, SSH. Remote desktop uses 3389.' },
          ],
          explain: 'Blocking one port for an address doesn’t block the address. Rule 1 stops SSH from 203.0.113.140, but its remote desktop attempt matches rule 7.',
        },
      ],
    },

    {
      id: 'auth',
      title: 'The weekend in auth.log',
      body: md`
        Linux servers keep **log files** in /var/log. Each line records one event, starting with the date and time. **/var/log/auth.log** records sign-ins: who, from which address, and whether it worked.

        Open the **Log files** card in the Toolkit and pick **auth.log**. The number at the left of each line is its **row**. On the exam, you cite rows like these as evidence. (In this simulation, each failed sign-in writes one line. A real server writes two or three.)

        Three kinds of lines matter here:

        - \`Accepted publickey for bayline\` means Bayline Farms signed in with its **key**: a secret file on its computer that proves who it is, in place of a password.
        - \`Failed password for invalid user admin\` means someone guessed a password for an account that doesn't exist on this server.
        - \`Failed password for root\` has no "invalid user", because root is a real account: the administrator account on every Linux server.

        A **brute-force attack** tries many passwords on one account. A **password spray** turns that around: it tries one or two common passwords on many usernames. Each account sees only one wrong guess, so a rule like "lock the account after 5 wrong passwords" never kicks in. A spray usually aims at accounts that exist. This one also tried common default usernames that don't exist here, which is why most of its lines say invalid user.

        You can search from the Terminal too. \`grep\` prints the lines of a file that contain some text, and \`-n\` adds the row numbers:

        \`\`\`sh
        grep -n "Failed password" /var/log/auth.log
        \`\`\`

        Press **Bigger** on the Terminal to see more of the output.
      `,
      tools: [logs(['auth']), term(['grep', 'tail'])],
      goals: [
        {
          id: 'grep',
          label: 'Search auth.log with grep',
          hint: 'Type grep -n "Failed password" /var/log/auth.log in the Terminal.',
          check: ran((cmd, line, out) => cmd === 'grep' && line.includes('/var/log/auth.log') && out.includes(IP.sprayer)),
        },
      ],
      questions: [
        {
          id: 'ip',
          kind: 'text',
          prompt: 'What IP address did the password spray come from?',
          short: true,
          placeholder: 'An IP address',
          expect: /(^|[^\d.])203\.0\.113\.77(?![\d])/,
          expectHint: 'Copy the address after “from” in one of the Failed password lines.',
          wrong: [
            { match: /203\.0\.113\.140/, text: '203.0.113.140 shows up in other logs. Look at the Failed password lines in auth.log.' },
            { match: /198\.18\.40\.12/, text: 'That’s Bayline Farms. Its sign-ins worked, with a key.' },
            { match: /192\.0\.2\.15/, text: 'That’s Jo’s laptop at the office.' },
          ],
          explain: 'Every Failed password line came from 203.0.113.77, about half a minute apart.',
        },
        cite(
          'spray-rows',
          'Which rows of auth.log show the weekend’s spray? Cite every row.',
          'auth',
          ROWS.spray,
          'spray',
          `Rows ${rowsText(ROWS.spray)}: ${ROWS.spray.length} failed sign-ins from one address in about 7 minutes, each with a different username.`,
        ),
      ],
    },

    {
      id: 'ufw-log',
      title: 'Blocked at the door',
      body: md`
        **/var/log/ufw.log** has a line for every packet the firewall blocked. (This server's ufw is set to log every block.) Here's how to read one:

        | Part | What it means |
        |---|---|
        | [UFW BLOCK] | ufw dropped this packet |
        | IN=eth0 | it came in on eth0, the server's **network interface** (its network card) |
        | SRC= | the address it came from |
        | DST= | the address it was going to: web01 |
        | SPT= and DPT= | the source port, and the destination port: the door it knocked on |
        | SYN | the first packet of a new connection |

        Open **ufw.log**. Look for a burst of lines from one address that knock on many different ports in a second or two. That's a **port scan**: a program like nmap trying door after door to see which ones answer. A scan is often the first step of an attack, because it shows the attacker which services to go after.

        Some of the scan's knocks aren't in ufw.log at all. Ports the rules allow, like 80 and 443, answered, and ufw writes nothing when it allows a packet. To see this happen, replay the scan: [[button:rescan]]

        Your tests in step 2 and this replay add new lines at the bottom of ufw.log, with today's date. Scroll down to see them. The questions ask about the weekend's lines, above them.
      `,
      tools: [logs(['auth', 'ufw']), term(['grep', 'tail'])],
      actions: [rescan],
      questions: [
        {
          id: 'rule-25',
          kind: 'choice',
          prompt: `Row ${ROWS.scan25} of ufw.log shows a knock on port 25 (DPT=25). Which rule blocked it?`,
          options: [
            { id: 'r10', text: 'Rule 10: DENY everything from Anywhere', correct: true },
            { id: 'r1', text: 'Rule 1: DENY 22/tcp from 203.0.113.140', feedback: `Rule 1 matches 203.0.113.140 only on port 22. The DPT=22 line, row ${ROWS.scan22}, is rule 1's.` },
            {
              id: 'policy',
              text: 'No rule: ufw’s default policy',
              feedback: 'Close. ufw’s default is to deny incoming packets, but rule 10 matches everything first, so rule 10 decides.',
            },
            { id: 'r9', text: 'Rule 9: ALLOW 445/tcp from 192.0.2.0/24', feedback: 'Rule 9 allows. It’s for port 445 from the office.' },
          ],
          explain: 'No rule from 1 to 9 matches port 25 from 203.0.113.140. Rule 10 matches everything, so it blocks the packet, and ufw logs it.',
        },
        cite(
          'scan-rows',
          'Which rows of ufw.log show the weekend’s port scan? Cite every row.',
          'ufw',
          ROWS.scan,
          'scan',
          `Rows ${rowsText(ROWS.scan)}: ${ROWS.scan.length} different ports from 203.0.113.140 within about a second. A person doesn't type that fast.`,
        ),
      ],
    },

    {
      id: 'web-log',
      title: 'The web log',
      body: md`
        **/var/log/nginx/access.log** has a line for every request the website answered. Each line shows the client's address, the time, the request (like \`GET /menu\`), the **status code**, the size, the page the visitor came from, and the **user agent**: the program that asked.

        | Status | Meaning |
        |---|---|
        | 200 | OK, here's the page |
        | 302 | go to another page (after an order is placed) |
        | 404 | not found: no such page |
        | 400 | bad request, refused |

        Open **access.log**. Most lines are customers using web browsers. Then find the lines from 203.0.113.140, the address from ufw.log. Its user agent is curl, a command-line tool, not a browser.

        First, it asked for files that websites sometimes leave out by mistake: /.env (passwords and settings), /.git/config (the site's code history), /wp-login.php and /phpmyadmin/ (admin pages). Every answer was 404. Probing for weak spots like this is **reconnaissance**.

        Then it tried something else. Look at the requests with \`..\` in them. \`..\` means "the folder above," and \`%2f\` is how a web address writes \`/\`. Enough of them climb out of the web folder to the top of the disk. There, /etc/passwd lists the server's accounts, and /etc/shadow holds their passwords as **hashes**, a one-way scrambled form. Only the administrator account can read /etc/shadow. Using \`..\` to read files outside the web folder is **directory traversal**.
      `,
      tools: [logs(['auth', 'ufw', 'access']), term(['grep', 'tail'])],
      questions: [
        {
          id: 'status',
          kind: 'choice',
          prompt: 'The site answered each `..` request with status 400. What does that tell you?',
          options: [
            { id: 'refused', text: 'The site refused them, so the attacker didn’t get the files', correct: true },
            { id: 'got', text: 'The attacker got the files', feedback: 'A request that worked would get 200, OK. 400 means bad request, refused.' },
            { id: 'missing', text: 'The files don’t exist on this server', feedback: 'That would be 404, not found. /etc/passwd is on every Linux server. The site refused to hand it over.' },
            { id: 'blocked', text: 'ufw blocked the requests', feedback: 'ufw let them through: they went to port 80 or 443, which the rules allow. The website itself answered, with 400.' },
          ],
          explain:
            'The site refused all three, so the attack failed this time. A site with a bug in its download page might answer 200 and send /etc/passwd. **Input validation** closes that hole: the site works out the full location of every file a request names, and refuses any that land outside the web folder.',
        },
        cite(
          'traversal-rows',
          'Which rows of access.log show the directory traversal? Cite every row.',
          'access',
          ROWS.traversal,
          'directory traversal',
          `Rows ${rowsText(ROWS.traversal)}: each asks for a path with .. in it, and the site refused each one with 400.`,
        ),
      ],
    },

    {
      id: 'command',
      title: 'Write the command',
      body: md`
        The spray came from 203.0.113.77. Block it with a firewall rule.

        ufw changes the rules from the Terminal. Changing them takes administrator rights, so on a real server the command starts with \`sudo\`. (Here you can leave it off.)

        1. Type \`sudo ufw deny from 203.0.113.77\`. Then type \`ufw status numbered\` to see where the new rule went.
        2. Replay the spray: [[button:spray]]
        3. Read the result under the button. Did your rule stop it?

        If the spray still got through, the problem is the order of the rules. Delete your rule first: \`ufw delete N\` deletes rule number N. Then \`ufw insert N\` followed by a rule puts it at position N, like \`ufw insert 1 deny from 203.0.113.77\`. Replay the spray again.
      `,
      tools: [term(['ufw', 'grep', 'tail']), logs(['auth', 'ufw'])],
      actions: [spray],
      goals: [
        {
          id: 'deny',
          label: 'Add a rule that denies 203.0.113.77',
          hint: 'Type ufw deny from 203.0.113.77 in the Terminal.',
          check: ({ sim }) => fw(sim).rules.some(sprayRule),
        },
        {
          id: 'blocked',
          label: 'Replay the spray and see your rule block it',
          hint: 'Check ufw status numbered. Your rule has to be above the rule that allows 22/tcp from Anywhere.',
          check: ({ sim, since }) =>
            happened(sim, since, (e) => {
              if (e.type !== 'firewall' || e.device !== WEB || e.pkt.src !== IP.sprayer || e.verdict.action !== 'deny') return false;
              const r = fw(sim).rules.find((x) => x.id === e.verdict.ruleId);
              return !!r && sprayRule(r);
            }),
        },
      ],
      questions: [
        {
          id: 'order',
          kind: 'choice',
          afterGoals: true,
          prompt: 'After only `ufw deny from 203.0.113.77`, the spray still gets through. Why?',
          options: [
            { id: 'order', text: 'ufw put the rule at the bottom, and the rule allowing 22/tcp from Anywhere matches first', correct: true },
            { id: 'restart', text: 'New ufw rules only work after the server restarts', feedback: 'ufw changes work at once. Look at where the new rule landed in ufw status numbered.' },
            { id: 'moved', text: 'The attacker switched to a new address', feedback: 'Every replay came from 203.0.113.77. Check the SRC in ufw.log, or the from in auth.log.' },
            { id: 'ssh', text: 'A deny rule can’t block SSH', feedback: 'It can, once it’s above the rule that allows SSH. Order is the problem.' },
          ],
          explain: 'A new rule goes at the bottom, after rule 10. ufw stops at the first match, and the SSH rule above matches first, so the new rule never gets checked. ufw insert 1 puts it at the top.',
        },
      ],
    },

    {
      id: 'fail2ban',
      title: 'Stop it while it happens',
      body: md`
        Blocking an address after the attack is over is slow, and attackers have many addresses. An **intrusion detection system** (IDS) watches for an attack and alerts a person, who then acts. An **intrusion prevention system** (IPS) goes further: it stops the attack while it happens, with no person in the loop.

        **fail2ban** is a small IPS for Linux servers. It reads auth.log as the lines are written. When one address fails to sign in 5 times within 10 minutes, fail2ban adds a ufw rule at the top that blocks that address.

        1. In the **Sign-in defenses** card, turn on **fail2ban**.
        2. Press [[button:bot]]. A new computer, [[bot]], starts guessing passwords.
        3. Read **fail2ban.log**, then **ufw.log**. Open the **Inspect** tab and scroll to web01's firewall rules to see the new rule at the top.

        fail2ban.log calls each service it watches a **jail**. Here the jail is sshd. \`maxRetry: 5\` and \`findtime: 600\` mean 5 failures within 600 seconds, which is 10 minutes. \`banTime: 600\` means a ban lasts 10 minutes. When fail2ban starts, it also reads back through auth.log for failures from the last 10 minutes, so your own replays from step 6 can show up as Found lines.

        fail2ban can watch other logs too. It could watch access.log and ban any address that sends \`..\` requests, like 203.0.113.140 did.
      `,
      setup: ensureSprayBlocked,
      tools: [guard(['fail2ban']), logs(ALL_LOGS)],
      actions: [bot],
      goals: [
        { id: 'on', label: 'Turn on fail2ban', check: ({ sim }) => lx(sim).f2b.on },
        {
          id: 'banned',
          label: 'fail2ban bans the bot',
          hint: 'With fail2ban on, press the button and wait for all 8 guesses.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'config' && e.device === WEB && e.what === 'fail2ban-ban'),
        },
        {
          id: 'after',
          label: 'The bot’s next guesses are blocked by the new rule',
          check: ({ sim, since }) =>
            happened(sim, since, (e) => {
              if (e.type !== 'firewall' || e.device !== WEB || e.verdict.action !== 'deny' || e.pkt.src !== botIp(sim)) return false;
              return fw(sim).rules.find((r) => r.id === e.verdict.ruleId)?.note === 'fail2ban';
            }),
        },
      ],
      questions: [
        {
          id: 'halt',
          kind: 'choice',
          prompt: 'How did fail2ban stop the attack while it was happening?',
          options: [
            { id: 'ban', text: 'It counted failed sign-ins in auth.log, then added a ufw rule blocking that address', correct: true },
            { id: 'passwords', text: 'It changed the passwords of the accounts the bot guessed', feedback: 'fail2ban never touches accounts. It reads a log and changes the firewall.' },
            {
              id: 'alert',
              text: 'It sent Jo an alert, and Jo blocked the address',
              feedback: 'That would be an intrusion detection system (IDS): it detects and alerts, and a person acts. fail2ban acted by itself, in seconds.',
            },
            { id: 'slow', text: 'It slowed the server down until the bot gave up', feedback: 'Look at fail2ban.log: “Ban 203.0.113.201”. Then look at the top rule in web01’s firewall.' },
          ],
          explain: 'fail2ban found 5 failures from 203.0.113.201 in auth.log, banned the address, and inserted DENY from 203.0.113.201 as rule 1. Every guess after that matched rule 1 and never reached sshd.',
        },
      ],
    },

    {
      id: 'keys',
      title: 'Another countermeasure',
      body: md`
        fail2ban counts failures from each address. But [[bot]] is part of a **botnet**: thousands of infected computers that take turns, each making only a few guesses. Press [[button:botnet]] once or twice. Each press comes from a new address and makes 3 guesses, under fail2ban's limit of 5.

        A **countermeasure** is anything that defends against an attack. The strongest one here takes away what the attack needs: passwords. Jo and Bayline Farms already sign in with keys, so nobody needs a password to reach this server.

        1. In the **Sign-in defenses** card, turn off **Allow password sign-in**.
        2. Press [[button:botnet]] again. Scroll to the bottom of auth.log and read the new lines.
        3. Check that Jo can still get in: [[button:jo]]

        Turning off password sign-in makes sshd reload its settings: that's the "Received SIGHUP" line. After that, each try ends with [preauth], which means sshd closed the connection before any password was checked.

        Two more countermeasures for SSH: **multi-factor authentication** (MFA), which asks for a second proof, like a code from a phone, as well as a password. And a **VPN** (virtual private network), an encrypted connection into the office network from outside: the firewall allows SSH only from office and VPN addresses.
      `,
      setup: (sim) => {
        ensureSprayBlocked(sim);
        ensureFail2ban(sim);
      },
      tools: [guard(['fail2ban', 'passwords']), logs(ALL_LOGS)],
      actions: [botnet, jo],
      goals: [
        { id: 'off', label: 'Turn off password sign-in', check: ({ sim }) => !lx(sim).sshd.passwords },
        {
          id: 'preauth',
          label: 'The botnet tries again and can’t even try a password',
          hint: 'With password sign-in off, press the botnet button.',
          check: ({ sim, since }) => loggedSince(sim, WEB, since, (e) => e.fields?.file === 'auth' && e.fields.result === 'preauth' && e.fields.method === 'password'),
        },
        {
          id: 'jo',
          label: 'Jo can still sign in with a key',
          hint: 'After turning off password sign-in, press the Jo button.',
          check: ({ sim, since }) => {
            const off = passwordsOffAt(sim);
            return off !== undefined && loggedSince(sim, WEB, Math.max(since, off), (e) => e.fields?.file === 'auth' && e.fields.user === 'jo' && e.fields.result === 'accepted');
          },
        },
      ],
      questions: [
        {
          id: 'which',
          kind: 'choice',
          prompt: 'The botnet moves to a new address every few guesses. Which countermeasure still stops it?',
          options: [
            { id: 'keys', text: 'Turn off password sign-in, so only keys work', correct: true },
            {
              id: 'maxretry',
              text: 'Lower fail2ban’s limit from 5 failures to 3',
              feedback: 'The botnet can make 2 guesses per address instead. With thousands of addresses, it still gets thousands of guesses.',
            },
            { id: 'deny', text: 'Add ufw deny from the address it used last', feedback: 'The next guesses come from a different address. Blocking one at a time can’t keep up.' },
            {
              id: 'port',
              text: 'Move SSH from port 22 to port 2222',
              feedback: 'A port scan finds the new port in seconds. Hiding a service isn’t the same as protecting it.',
            },
          ],
          explain: 'With password sign-in off, sshd closes the connection before a password is ever checked. It doesn’t matter how many addresses the botnet has: no guess can work.',
        },
      ],
    },

    {
      id: 'policy',
      title: 'Change a rule, predict the impact',
      body: md`
        Here are the parts of the co-op's policy that cover the firewall:

        1. Only the website (ports 80 and 443) is open to everyone on the internet.
        2. Remote administration (SSH, remote desktop, screen sharing) is allowed only from the office network, 192.0.2.0/24.
        3. Files move only over encrypted connections: SFTP (file transfer over SSH), never FTP. Bayline Farms uploads the nightly order file this way, from its own network.

        Compare the policy with [[web01]]'s rules. Type \`ufw status numbered\` to list them in the Terminal.

        Then fix two of them:

        1. **SSH from the office only.** Delete the rule that allows 22/tcp from Anywhere. Insert this in its place, using its old number for N:

           \`\`\`sh
           ufw insert N allow from 192.0.2.0/24 to any port 22 proto tcp
           \`\`\`

        2. **No FTP.** Delete the rule that allows 21/tcp.

        Rule numbers change after every delete, so run \`ufw status numbered\` again before each command.

        Answer the prediction question before you test. Then test: [[button:jo]] [[button:vendor]]

        If a test fails, fix it with one more rule above the last rule, the DENY for everything else.
      `,
      tools: [term(['ufw', 'ss', 'grep', 'tail']), logs(ALL_LOGS)],
      actions: [jo, vendor],
      goals: [
        {
          id: 'ssh',
          label: 'SSH is allowed from the office, and not from the internet',
          hint: 'Delete the rule that allows 22/tcp from Anywhere. Then insert an allow for 192.0.2.0/24 at its old number.',
          check: ({ sim }) => sshOfficeOnly(sim),
        },
        { id: 'ftp', label: 'FTP (port 21) is closed', hint: 'Use ufw status numbered to find the rule that allows 21/tcp, then ufw delete with its number.', check: ({ sim }) => ftpClosed(sim) },
        {
          id: 'vendor',
          label: 'Bayline Farms’ upload works with the new rules',
          hint: 'If the upload is blocked, type ufw status numbered, then ufw insert N allow from 198.18.40.0/24 to any port 22 proto tcp, with N the number of the final DENY. Then run the upload again.',
          check: ({ sim, since }) => {
            const c = lastConn(sim, 'vendor', since, 'vendor');
            return sshOfficeOnly(sim) && !!c && c.status === 'open' && c.t >= (fw(sim).changedAt ?? 0);
          },
        },
      ],
      questions: [
        {
          id: 'breaks',
          kind: 'choice',
          multi: true,
          prompt: 'Which rules break the co-op’s policy? Pick all that do.',
          options: [
            { id: 'ftp', text: 'ALLOW 21/tcp from Anywhere (FTP)', correct: true, missed: 'FTP sends files, and passwords, without encryption. The policy says SFTP only.' },
            { id: 'ssh', text: 'ALLOW 22/tcp from Anywhere (SSH)', correct: true, missed: 'SSH is remote administration, and the policy allows that only from the office.' },
            { id: 'rdp', text: 'ALLOW 3389/tcp from Anywhere (remote desktop)', correct: true, missed: 'Remote desktop is remote administration too.' },
            { id: 'https', text: 'ALLOW 443/tcp from Anywhere (HTTPS)', feedback: 'The website is the one thing the policy opens to the internet.' },
            { id: 'vnc', text: 'ALLOW 5900/tcp from 192.0.2.15 (screen sharing)', feedback: '192.0.2.15 is Jo’s laptop, inside the office network. That fits the policy.' },
          ],
          explain: 'This step fixes SSH and FTP. Remote desktop stays open: closing it is the optional extra challenge after you submit.',
        },
        {
          id: 'predict',
          kind: 'choice',
          prompt: 'Predict: once SSH is allowed only from 192.0.2.0/24, who loses access?',
          options: [
            { id: 'vendor', text: 'Bayline Farms', correct: true },
            { id: 'jo', text: 'Jo', feedback: 'Jo’s laptop is 192.0.2.15, inside 192.0.2.0/24.' },
            { id: 'customers', text: 'Customers ordering on the website', feedback: 'Customers use port 443. This change touches only port 22.' },
            { id: 'nobody', text: 'Nobody, since only attackers use SSH from outside', feedback: 'Read policy rule 3 again. Who else connects from outside the office?' },
          ],
          explain: 'SFTP is file transfer over SSH, port 22. Closing SSH to the internet closes it for Bayline Farms too, until a rule allows their network.',
        },
      ],
    },

    {
      id: 'write-up',
      title: 'Write-up',
      body: md`
        The exam's free-response question asks for answers like these. Write in full sentences. Cite rows and rule numbers where they help. Your teacher grades this part.

        Your changes moved the rule numbers around. Use the weekend's table:

        | # | Action | From | Port |
        |---|---|---|---|
        | 1 | DENY | 203.0.113.140 | 22/tcp |
        | 2 | ALLOW | Anywhere | 21/tcp |
        | 3 | ALLOW | Anywhere | 80/tcp |
        | 4 | ALLOW | Anywhere | 443/tcp |
        | 5 | ALLOW | Anywhere | 22/tcp |
        | 6 | ALLOW | 192.0.2.0/24 | 3306/tcp |
        | 7 | ALLOW | Anywhere | 3389/tcp |
        | 8 | ALLOW | 192.0.2.15 | 5900/tcp |
        | 9 | ALLOW | 192.0.2.0/24 | 445/tcp |
        | 10 | DENY | Anywhere | everything |

        The **Log files** card is open if you need to look back.
      `,
      tools: [logs(ALL_LOGS)],
      questions: [
        {
          id: 'part-a',
          kind: 'text',
          label: 'A',
          prompt:
            'Pick one blocked connection from the weekend in ufw.log. Cite its row, name the rule in the table that blocked it, and explain how. Then describe a rule change that would allow it, and the impact of that change.',
          minWords: 25,
          lines: 5,
        },
        {
          id: 'part-b',
          kind: 'text',
          label: 'B',
          prompt:
            'Describe one attack in the logs: the password spray in auth.log or the directory traversal in access.log. Cite the rows and the attacker’s IP address. Then explain how an automated system could stop an attack like it while it happens, and name a different countermeasure.',
          minWords: 25,
          lines: 5,
        },
      ],
    },

    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.
      `,
    },

    {
      id: 'rdp',
      title: 'Optional extra challenge: Close the remote desktop hole',
      extra: true,
      body: md`
        Policy rule 2 covers remote desktop too, but the rule allowing 3389/tcp from Anywhere is still there. Change the rules so remote desktop is closed to the internet. Then test it: [[button:scan-rdp]]

        This challenge earns no points. Hand in your work again when you're done so your teacher sees it.
      `,
      tools: [term(['ufw'])],
      actions: [scanRdp],
      goals: [
        { id: 'closed', label: 'Remote desktop is closed to the internet', check: ({ sim }) => rdpClosed(sim) },
        {
          id: 'tested',
          label: 'Test it: 203.0.113.140 gets no answer on 3389',
          check: ({ sim, since }) => {
            const c = lastConn(sim, 'scanner', since, 'scanner-rdp');
            return rdpClosed(sim) && !!c && c.status === 'no-answer';
          },
        },
      ],
    },
  ],
};
