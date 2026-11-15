import { checkRows, rowsText } from '../../runtime/citeRows';
import type { LogFile } from '../../sim/linux';
import { scanFindings, type Conn } from '../../sim/services';
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
  ensureBotReachesSsh,
  ensureFail2ban,
  ensureSprayBlocked,
  ftpClosed,
  fw,
  hostRuns,
  IP,
  joSignIn,
  connVerdict,
  guessRunStart,
  lastConn,
  lx,
  NET,
  nextBotnetIps,
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
  if (!settled(sim, c)) return [{ tone: 'wait', text: v ? `${v}. Waiting for an answer…` : 'On its way…' }];
  if (c.status === 'open') return [{ tone: friend ? 'good' : 'bad', text: `${v ?? 'Allowed'}. ${answered(c.banner ?? '')}` }];
  return [{ tone: friend ? 'bad' : 'good', text: `${v ?? 'Blocked'}. ufw dropped it and wrote a line in ufw.log. ${who} gets no answer.` }];
}

/** ufw dropped the connection's first packet. No answer will ever come, so the result is in. */
const dropped = (sim: Sim, c: Conn) => connVerdict(sim, c)?.action === 'deny';
/** The connection's result is in: it ended, or ufw dropped it. */
const settled = (sim: Sim, c: Conn) => c.status !== 'pending' || dropped(sim, c);

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
function guessLines(sim: Sim, since: number, from: string, tag: string, n: number): { done: boolean; reached: number; blocked: number; cs: Conn[]; lines: ActionLine[] } {
  // A press during a run is ignored, so its lines follow the run it landed in.
  const start = guessRunStart(sim, tag, since);
  const cs = (sim.dev(from).conns ?? []).filter((c) => c.t >= start && c.tag === tag);
  const done = cs.length === n && cs.every((c) => settled(sim, c));
  const reached = cs.filter((c) => c.status === 'open').length;
  const blocked = cs.filter((c) => c.status === 'no-answer' || dropped(sim, c)).length;
  return { done, reached, blocked, cs, lines: done ? [] : [{ tone: 'wait', text: `Guessing… ${cs.filter((c) => settled(sim, c)).length} of ${n} done.` }] };
}

const spray: ActionDef = {
  id: 'spray',
  label: 'Replay the spray from 203.0.113.77',
  run: replaySpray,
  outcome: (sim, since) => {
    const g = guessLines(sim, since, 'sprayer', 'spray', 4);
    if (!g.done) return g.lines;
    const first = g.cs[0];
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
    if (!g.blocked) {
      if (lx(sim).f2b.banned.includes(ip))
        return [
          {
            tone: 'bad',
            text: `All 8 guesses from ${ip} reached sshd before any ban. fail2ban banned ${ip} later, from the lines it read back when it started. Press the button again: the bot comes back from a new address, and you can watch fail2ban stop it.`,
          },
        ];
      return [{ tone: 'bad', text: `All 8 guesses from ${ip} reached sshd. Nothing stopped them: fail2ban is off.` }];
    }
    if (!g.reached) {
      if (lx(sim).f2b.banned.includes(ip)) return [{ tone: 'good', text: `${ip} is already banned. ufw blocked all 8 guesses before sshd saw them.` }];
      const v = g.cs[0] ? verdictWords(sim, g.cs[0]) : undefined;
      return [{ tone: 'bad', text: `${v ?? 'Blocked'}. ufw blocked all 8 guesses before sshd saw them, so fail2ban had nothing to count.` }];
    }
    const back = ip === IP.bot ? '' : `The bot came back from a new address, ${ip}. `;
    return [{ tone: 'good', text: `${back}${g.reached} guesses reached sshd. Then fail2ban banned ${ip}, and ufw blocked the last ${g.blocked}.` }];
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
    const cs = g.cs;
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
        text: `The scan pinged web01 to check it was up. (ufw has built-in rules, checked before the numbered list, that let ping through.) Then it tried ${RESCAN_PORTS.length} ports. ufw blocked ${blocked} packets and wrote a line for each in ufw.log. Ports ${open.join(', ')} answered, and ufw wrote nothing about them.`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

const tested = (from: string, tag: string) => ({ sim, since }: CheckCtx) => {
  const c = lastConn(sim, from, since, tag);
  return !!c && settled(sim, c);
};

/**
 * Addresses fail2ban banned since `since` while it was already running: a ban
 * during an attack. A ban from the lines fail2ban reads back when it starts
 * happens at the same moment it's turned on, so it doesn't count.
 */
function liveBans(sim: Sim, since: number): Set<string> {
  const out = new Set<string>();
  let onAt: number | undefined;
  for (const e of sim.events) {
    if (e.type !== 'config' || e.device !== WEB) continue;
    if (e.what === 'fail2ban') onAt = e.on ? e.t : undefined;
    else if (e.what === 'fail2ban-ban' && e.detail && e.t >= since && onAt !== undefined && e.t > onAt) out.add(e.detail);
  }
  return out;
}

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
  version: 2,
  title: 'Device Security Analysis',
  tagline: "Read a web server's firewall rules and logs, find two attacks, change the rules, and stop the next attack while it happens.",
  unit: 3,
  codehs: ['3.18 The Story in the Logs', '3.19 Securing Networks Quiz', '3.10 The Rules of the Firewall', '3.12 Writing the Rulebooks'],
  ced: ['3.4.B', '3.4.D', '3.5.A', '3.5.E', '3.1.C', '3.2.A'],
  minutes: 55,
  objectives: [
    "Trace a connection through a host-based firewall's numbered rules, and explain why the first rule that matches decides.",
    'Find a password spray in auth.log and a port scan in ufw.log, citing the rows and the attacker’s address.',
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
        Harbor Food Co-op sells groceries online at shop.harborfood.example. One Ubuntu Linux server, web01, runs the site. Jo, the co-op's part-time admin, takes care of it from [[jo]] at the office. Every night at 2:10, the farm that supplies the co-op, [[vendor]], uploads the next day's order file to it.

        It's Monday morning. Over the weekend, someone attacked the server again and again. You have Jo's evidence: the server's firewall rules, its log files, and the co-op's server policy. Your job is the one on the AP exam's free-response question: read the evidence, find the attacks, and fix what let them in.

        Everything in this lab happens inside a simulation. Attacking or scanning a real server without permission is illegal.

        **The co-op's server policy**

        1. Only the website (ports 80 and 443) is open to everyone on the internet.
        2. Remote administration (SSH, remote desktop, screen sharing) is allowed only from the office network, 192.0.2.0/24.
        3. Files from outside the office move only over encrypted connections: **SFTP** (file transfer over SSH), never FTP. Bayline Farms uploads its nightly order file this way.

        The /24 in 192.0.2.0/24 means the first three numbers stay the same. So the office network is every address that starts with 192.0.2, like Jo's laptop, 192.0.2.15.

        Click **web01** on the map. Scroll to **Firewall rules (ufw)**. This is a **host-based firewall**: it runs on the computer it protects and checks every packet that arrives. ufw checks the rules from the top, and the first rule that matches a packet decides. Rule 10 denies everything, so anything the rules above it don't allow is blocked.

        Next, see which programs are **listening**: waiting for connections on a port. In the Toolkit's **Terminal**, type \`ss -tuln\` and press Enter. (\`-t\` means TCP, \`-u\` UDP, \`-l\` listening, \`-n\` numbers instead of names.) Press **Bigger** if the output doesn't fit.

        Some programs listen only on 127.0.0.1, the server's address for talking to itself. Nothing outside the server can reach those.
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
          id: 'local-port',
          kind: 'choice',
          afterGoals: true,
          prompt: 'ss lists 127.0.0.1:25. That is the server’s mail program. Can a computer on the internet connect to it?',
          options: [
            { id: 'local', text: 'No. It listens only on 127.0.0.1, so only web01 can reach it', correct: true },
            {
              id: 'listening',
              text: 'Yes. A listening program takes connections from any address',
              feedback: 'Look at the address in front of the port. A program on 0.0.0.0 listens on every address. One on 127.0.0.1 listens only to the server itself.',
            },
            {
              id: 'rule',
              text: 'Yes, as soon as someone adds a ufw rule that allows port 25',
              feedback: 'A rule could let the packet in, but nothing would answer it. The mail program listens only on 127.0.0.1, not on the address the internet uses.',
            },
            {
              id: 'r10',
              text: 'Yes. Rule 10 only blocks ports that nobody is listening on',
              feedback: 'Rule 10 blocks every packet that the rules above it don’t allow, whether a program listens on that port or not.',
            },
          ],
          explain: 'A packet from the internet is addressed to web01’s public address, 198.51.100.10. The mail program listens only on 127.0.0.1, so it never hears that packet, whatever the firewall rules say.',
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

        Open the **Log files** card in the Toolkit and pick **auth.log**. The number at the left of each line is its **row**. On the exam, you cite rows as evidence. (Here each failed sign-in writes one line. A real server writes two or three.)

        Three kinds of lines matter:

        - \`Accepted publickey for bayline\`: Bayline Farms signed in with its **key**, a secret file on its own computer that proves who it is. The server keeps only the matching public half, so there is no password to guess.
        - \`Failed password for invalid user admin\`: someone guessed a password for an account that doesn't exist on this server.
        - \`Failed password for root\`: no "invalid user", because root is a real account, the administrator account on every Linux server.

        A **brute-force attack** tries many passwords on one account. A **password spray** is the opposite: one guess on each of many usernames. Each account sees only one wrong password, so a rule like "lock the account after 5 wrong passwords" never starts.

        You can also search from the Terminal. \`grep\` prints the lines of a file that contain some text, and \`-n\` adds the row numbers (the Terminal calls them line numbers):

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
        **/var/log/ufw.log** has a line for every packet the firewall blocked. Here's how to read one:

        | Part | What it means |
        |---|---|
        | [UFW BLOCK] | ufw dropped this packet |
        | IN=eth0 | it came in on eth0, the server's **network interface** (its network card) |
        | SRC= | the address it came from |
        | DST= | the address it was going to: web01 |
        | SPT= and DPT= | the source port, and the destination port: the service it tried to reach |
        | SYN | the first packet of a new connection |

        Open **ufw.log**. Look for a burst of lines from one address that try many different ports within a second or two. That's a **port scan**: a program like nmap tries port after port to see which ones answer. A scan often comes first in an attack, because it shows the attacker which services to go after.

        Some of the scan's tries aren't in ufw.log. Ports the rules allow, like 80 and 443, answered, and ufw writes nothing when it allows a packet. See it happen: [[button:rescan]]

        Your tests in step 2 and this replay add new lines at the bottom of ufw.log. The questions ask about the weekend's lines, above them.
      `,
      tools: [logs(['auth', 'ufw'])],
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
      id: 'command',
      title: 'Write the command',
      body: md`
        The spray came from 203.0.113.77. Block it with a firewall rule.

        ufw changes the rules from the Terminal. Changing them takes administrator rights, so on a real server the command starts with \`sudo\`. (Here you can leave it off.)

        1. Press **Bigger** on the Terminal, so the whole rule list fits. Type \`sudo ufw deny from 203.0.113.77\`. Then type \`ufw status numbered\` to see where the new rule went.
        2. Replay the spray: [[button:spray]]
        3. Read the result under the button. Did your rule stop it?

        If the spray still got through, the problem is the order of the rules. Delete your rule first: \`ufw delete N\` deletes rule number N. (A real server asks you to confirm a delete with y. This one skips that.) Then \`ufw insert N\` followed by a rule puts it at position N, like \`ufw insert 1 deny from 203.0.113.77\`. Replay the spray again.
      `,
      tools: [term(['ufw', 'grep', 'tail'])],
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
            { id: 'moved', text: 'The attacker switched to a new address', feedback: 'Every replay came from 203.0.113.77. The result under the button names the rule that let it in.' },
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
        Blocking an address after the attack is over is slow, and attackers have many addresses. An **intrusion detection system** (IDS) watches for an attack and alerts a person, who then acts. An **intrusion prevention system** (IPS) stops the attack by itself, while it happens.

        **fail2ban** is a small IPS for Linux servers. It reads auth.log as the lines are written. When one address fails to sign in 5 times within 10 minutes, fail2ban adds a ufw rule at the top that blocks that address. It can watch other logs too, like a web or mail server's.

        1. In the **Sign-in defenses** card, turn on **fail2ban**.
        2. Press [[button:bot]]. [[bot]] starts guessing passwords.
        3. Read **fail2ban.log**, then **ufw.log**. Then open the **Inspect** tab and find the new rule at the top of web01's firewall rules.

        When fail2ban starts, it reads back through the last 10 minutes of auth.log. So your replays from step 5 can show up as Found lines for 203.0.113.77. That's fewer than 5, so no ban. In fail2ban.log, \`maxRetry: 5\` is the limit, \`findtime: 600\` is 600 seconds (10 minutes), and \`banTime: 600\` is how long a ban lasts. fail2ban calls each service it watches a **jail**. Here the jail is sshd.

        (If your step 5 rule blocked all of 203.0.113.0/24, it now covers only 203.0.113.77, so [[bot]] can reach SSH.)
      `,
      setup: (sim) => {
        ensureSprayBlocked(sim);
        // A banned bot comes back from the next address, so that one has to reach SSH too.
        ensureBotReachesSsh(sim, [botIp(sim), ...nextBotnetIps(sim, 2)]);
      },
      tools: [guard(['fail2ban']), logs(ALL_LOGS)],
      actions: [bot],
      goals: [
        { id: 'on', label: 'Turn on fail2ban', check: ({ sim }) => lx(sim).f2b.on },
        {
          id: 'banned',
          label: 'fail2ban bans the bot',
          hint: 'With fail2ban on, press the button and wait for all 8 guesses.',
          check: ({ sim, since }) => liveBans(sim, since).has(botIp(sim)),
        },
        {
          id: 'after',
          label: 'The bot’s next guesses are blocked by the new rule',
          check: ({ sim, since }) =>
            happened(sim, since, (e) => {
              if (e.type !== 'firewall' || e.device !== WEB || e.verdict.action !== 'deny' || e.pkt.src !== botIp(sim)) return false;
              return fw(sim).rules.find((r) => r.id === e.verdict.ruleId)?.note === 'fail2ban' && liveBans(sim, since).has(e.pkt.src);
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
            { id: 'slow', text: 'It slowed the server down until the bot gave up', feedback: 'Look for the Ban line in fail2ban.log. Then look at the top rule in web01’s firewall.' },
          ],
          explain: 'fail2ban found 5 failures from the bot’s address in auth.log, banned it, and inserted a DENY for that address as rule 1. Every guess after that matched rule 1 and never reached sshd.',
        },
      ],
    },

    {
      id: 'keys',
      title: 'Another countermeasure',
      body: md`
        fail2ban counts failures from each address. But [[bot]] is part of a **botnet**: thousands of infected computers that take turns, each making only a few guesses. Press [[button:botnet]] once. Each press comes from a new address and makes 3 guesses, under fail2ban's limit of 5.

        A **countermeasure** is anything that defends against an attack. The strongest one here takes away what the attack needs: passwords. Jo and Bayline Farms already sign in with keys, so nobody needs a password to reach this server.

        1. In the **Sign-in defenses** card, turn off **Allow password sign-in**.
        2. Press [[button:botnet]] one more time. Scroll to the bottom of auth.log and read the new lines.
        3. Check that Jo can still get in: [[button:jo]]

        Turning off password sign-in makes sshd reload its settings: that's the "Received SIGHUP" line. After that, each try ends with [preauth]: sshd closed the connection before anyone signed in, without checking a password.

        Two other countermeasures for SSH: **multi-factor authentication** (MFA) asks for a second proof, like a code from a phone. A **VPN** (virtual private network) is an encrypted connection into the office network from outside, so the firewall can keep SSH open to office addresses only.
      `,
      setup: (sim) => {
        ensureSprayBlocked(sim);
        ensureBotReachesSsh(sim, nextBotnetIps(sim));
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
        Here's the co-op's policy again:

        1. Only the website (ports 80 and 443) is open to everyone on the internet.
        2. Remote administration (SSH, remote desktop, screen sharing) is allowed only from the office network, 192.0.2.0/24.
        3. Files from outside the office move only over encrypted connections: SFTP (file transfer over SSH), never FTP. Bayline Farms uploads its nightly order file this way.

        Compare the policy with [[web01]]'s rules. Type \`ufw status numbered\` to list them in the Terminal.

        Then fix two of them:

        1. **SSH from the office only.** Delete the rule that allows 22/tcp from Anywhere. Insert this in its place, using its old number for N:

           \`\`\`sh
           ufw insert N allow from 192.0.2.0/24 to any port 22 proto tcp
           \`\`\`

        2. **No FTP.** Delete the rule that allows 21/tcp.

        Rule numbers change after every delete, so run \`ufw status numbered\` again before each command.

        Answer the prediction question before you test. Then test: [[button:jo]] [[button:vendor]]

        If a test fails, add one more rule above the final DENY. Use the same command as the office rule, with the network that lost access in place of 192.0.2.0/24. The map shows each network's address.
      `,
      tools: [term(['ufw', 'ss', 'grep', 'tail'])],
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
          explain: 'Rules 6 and 9 (MySQL and file sharing) allow only the office, which fits. This step fixes SSH and FTP. Remote desktop stays open: closing it is the optional extra challenge after you submit.',
        },
        {
          id: 'predict',
          kind: 'choice',
          prompt: 'Predict: once SSH is allowed only from 192.0.2.0/24, who loses access?',
          options: [
            { id: 'vendor', text: 'Bayline Farms', correct: true },
            { id: 'jo', text: 'Jo', feedback: 'Jo’s laptop is 192.0.2.15, inside 192.0.2.0/24.' },
            { id: 'customers', text: 'Customers ordering on the website', feedback: 'Customers use port 443. This change touches only port 22.' },
            { id: 'nobody', text: 'Nobody, since only attackers use SSH from outside', feedback: 'Read point 3 of the policy again. Who else connects from outside the office?' },
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
            `Pick one of rows ${ROWS.served.slice(0, -1).join(', ')}, or ${ROWS.served.at(-1)} of ufw.log: weekend tries on ports where a program is listening. Cite the row and name the rule in the table that blocked it. Explain how that rule matched. Then suppose the co-op needed that service open: describe a rule change that would allow it, and the impact of that change.`,
          minWords: 25,
          lines: 5,
        },
        {
          id: 'part-b',
          kind: 'text',
          label: 'B',
          prompt:
            'Describe the password spray in auth.log. Cite the rows and the attacker’s IP address. Explain how an automated system could stop an attack like it while it happens. Then name a different countermeasure.',
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
        Point 2 of the co-op's policy covers remote desktop too, but the rule allowing 3389/tcp from Anywhere is still there. Change the rules so remote desktop is closed to the internet. Then test it: [[button:scan-rdp]]

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
            return rdpClosed(sim) && !!c && (c.status === 'no-answer' || dropped(sim, c));
          },
        },
      ],
    },
    {
      id: 'web-log',
      title: 'Optional extra challenge: The web log',
      extra: true,
      body: md`
        **/var/log/nginx/access.log** has a line for every request the website answered. Each line shows the client's address, the time, the request (like \`GET /menu\`), the **status code**, the size, the page the visitor came from, and the **user agent**: the program that asked.

        | Status | Meaning |
        |---|---|
        | 200 | OK, here's the page |
        | 302 | go to another page (after an order is placed) |
        | 404 | not found: no such page |
        | 400 | bad request, refused |

        Open **access.log**. Most lines are customers using web browsers. Then find the lines from 203.0.113.140, the address from ufw.log. Its user agent is curl, a command-line tool, not a browser.

        First, it asked for files that websites sometimes leave out by mistake: /.env (passwords and settings), /.git/config (the site's code history), and admin pages. Every answer was 404. Looking for weak spots like this is **reconnaissance**.

        Then it asked for paths with \`..\` in them. \`..\` means "the folder above," and \`%2f\` is how a web address writes \`/\`. Enough of them lead out of the web folder to the top of the disk, where /etc/passwd lists the server's accounts. Using \`..\` to read files outside the web folder is **directory traversal**.

        This challenge earns no points. Hand in your work again when you're done so your teacher sees it.
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
  ],
};
