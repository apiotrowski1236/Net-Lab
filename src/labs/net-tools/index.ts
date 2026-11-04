import type { Sim } from '../../sim/sim';
import type { NetstatRun, TermCommand } from '../../sim/terminal';
import { inspected, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, CheckCtx, LabDef, MapZone, ToolSpec } from '../types';
import {
  buildLibrary,
  closeRisky,
  dnsFixed,
  ensureRepairs,
  ensureTicketsDone,
  fixDns,
  fixInternet,
  internetFixed,
  IP,
  LIBRARY_NET,
  lookups,
  NAME,
  netstats,
  nmaps,
  openCatalog,
  openPorts,
  OWNER,
  pc2Plugged,
  pingAnswered,
  pings,
  RAT,
  riskyClosed,
  traces,
  unplugPc2,
  watchPc2,
  wholeNetwork,
} from './scenario';

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function zones(sim: Sim): MapZone[] {
  return [
    { id: 'library', shape: { kind: 'rect', x: 20, y: 70, w: 640, h: 540 }, label: 'Lakeside Public Library', tone: 'neutral' },
    { id: 'internet', shape: { kind: 'rect', x: 690, y: 70, w: 560, h: 540 }, label: 'The internet', tone: 'neutral', dashed: true },
    // Once its cable is out, Public PC 2 stays marked, so it doesn't look plugged in again later.
    ...(pc2Plugged(sim) ? [] : [{ id: 'unplugged', shape: { kind: 'rect' as const, x: 40, y: 282, w: 140, h: 148 }, label: 'Unplugged', labelAt: 'bottom' as const, tone: 'warn' as const, dashed: true }]),
  ];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const LOOK: TermCommand[] = ['ping', 'traceroute', 'nslookup', 'netstat'];
const term = (device: string, commands: TermCommand[]): ToolSpec => ({ kind: 'terminal', devices: [device], commands });
/** The help desk laptop with nmap, inside the permission letter's scope. */
const NMAP: ToolSpec = { kind: 'terminal', devices: ['laptop'], commands: [...LOOK, 'nmap'], nmap: { from: 'laptop', scope: [LIBRARY_NET], owner: OWNER } };

// ---------------------------------------------------------------------------
// Reading the student's runs
// ---------------------------------------------------------------------------

const sawWrongRecord = (sim: Sim, since: number) => lookups(sim, 'pc1', since).some((r) => r.name === NAME.catalog && r.answer === IP.wrongCatalog);
const brokenTrace = (sim: Sim, since: number) => traces(sim, 'pc1', since).some((r) => r.ip === IP.ebooks && r.end === 'silent');
const tracing = (sim: Sim) => (sim.dev('pc1').term ?? []).some((r) => r.kind === 'traceroute' && r.doneAt === undefined);
const showsRat = (r: NetstatRun) => r.programs && r.rows.some((x) => x.foreign === `${IP.remote}:${RAT.port}`);
/** Once: these buttons check what the student found first, the way the person on the other end would ask. */
const ever = 0;

// ---------------------------------------------------------------------------
// Lesson buttons
// ---------------------------------------------------------------------------

const reportDns: ActionDef = {
  id: 'report-dns',
  label: 'Send the finding to the IT contractor',
  run: (sim) => {
    if (sawWrongRecord(sim, ever)) fixDns(sim);
  },
  outcome: (sim): ActionLine[] =>
    dnsFixed(sim)
      ? [{ tone: 'good', text: 'The IT contractor says the record is fixed. Check their work with nslookup.' }]
      : sawWrongRecord(sim, ever)
        ? [{ tone: 'wait', text: 'You have the lookup now. Press the button again to send it.' }]
        : [{ tone: 'bad', text: 'The IT contractor asks: what does the record say right now? Look it up with nslookup first.' }],
};

/** The fix was checked: an nslookup since the repair gave the right address. */
const checkedFix = (sim: Sim) => dnsFixed(sim) && lookups(sim, 'pc1', ever).some((r) => r.name === NAME.catalog && r.answer === IP.catalog);

const openCatalogButton: ActionDef = {
  id: 'open-catalog',
  label: 'Public PC 1 opens the catalog',
  run: (sim) => {
    if (checkedFix(sim)) openCatalog(sim);
  },
  outcome: (sim, since): ActionLine[] => {
    const b = sim.dev('pc1').browser;
    if (!b || b.startedAt < since) return [{ tone: 'bad', text: 'Check the IT contractor’s fix with nslookup first.' }];
    if (b.status === 'resolving' || b.status === 'loading') return [{ tone: 'wait', text: 'Public PC 1 is opening the catalog…' }];
    if (b.status === 'loaded') return [{ tone: 'good', text: 'The catalog loads on Public PC 1. Ticket 1 is solved.' }];
    return [{ tone: 'bad', text: 'The catalog still didn’t load. Run nslookup again and check the address.' }];
  },
};

const callIsp: ActionDef = {
  id: 'call-isp',
  label: 'Call the internet provider',
  // A trace still running would show half the old path and half the new one: the call waits for it.
  run: (sim) => {
    if (brokenTrace(sim, ever) && !tracing(sim)) fixInternet(sim);
  },
  outcome: (sim): ActionLine[] =>
    internetFixed(sim)
      ? [{ tone: 'good', text: 'The provider found the break you traced: a cut cable. They replaced it. Run traceroute again to check.' }]
      : tracing(sim)
        ? [{ tone: 'wait', text: 'The provider asks where the path stops. Wait for the trace to finish, then press the button again.' }]
        : brokenTrace(sim, ever)
          ? [{ tone: 'wait', text: 'You have the trace now. Press the button again to call.' }]
          : [{ tone: 'bad', text: 'The provider asks: where on the path does it stop? Run traceroute first so you can tell them.' }],
};

const watchButton: ActionDef = {
  id: 'watch-pc2',
  label: 'Watch Public PC 2',
  run: watchPc2,
  outcome: (sim, since): ActionLine[] => {
    const c = (sim.dev('pc2').conns ?? []).filter((x) => x.t >= since && x.to === IP.remote).pop();
    if (!c || c.status === 'pending') return [{ tone: 'wait', text: 'Public PC 2 is sending something…' }];
    if (c.status !== 'open') return [{ tone: 'bad', text: 'Public PC 2 tried to reach 203.0.113.66, but nothing came back.' }];
    return [{ tone: 'good', text: 'Nobody is sitting at Public PC 2, but it sent packets to 203.0.113.66, out on the internet, and got answers back.' }];
  },
};

const unplugButton: ActionDef = {
  id: 'unplug-pc2',
  label: 'Unplug Public PC 2',
  run: (sim) => {
    if (pc2Plugged(sim) && netstats(sim, 'pc2', ever).some(showsRat)) unplugPc2(sim);
  },
  outcome: (sim): ActionLine[] =>
    pc2Plugged(sim)
      ? netstats(sim, 'pc2', ever).some(showsRat)
        ? [{ tone: 'wait', text: 'You found the connection. Press the button again to unplug Public PC 2.' }]
        : [{ tone: 'bad', text: 'Find the connection with netstat -b first, so you can tell IT what you cut off.' }]
      : [{ tone: 'good', text: "Public PC 2's network cable is out. Whoever was controlling it is cut off. IT will clean it up before it goes back online." }],
};

const closeButton: ActionDef = {
  id: 'close-risky',
  label: 'Ask the IT contractor to turn off FTP and Telnet',
  run: closeRisky,
  outcome: (): ActionLine[] => [{ tone: 'good', text: 'The IT contractor says FTP is off on the catalog server and Telnet is off on the printer. Scan again to check.' }],
};

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

const pingGoal = (id: string, label: string, ip: string, hint: string) => ({
  id,
  label,
  hint,
  check: ({ sim, since }: CheckCtx) => pings(sim, 'pc1', since).some((r) => pingAnswered(r, ip)),
});

const scanned = ({ sim, since }: CheckCtx) => nmaps(sim, 'laptop', since).some(wholeNetwork);

export const netToolsLab: LabDef = {
  id: 'net-tools',
  version: 4,
  title: 'Clues from the Command Line',
  tagline:
    'Solve three help desk tickets at a public library with ping, traceroute, nslookup, and netstat. Then, with written permission, map the network with nmap and find services that should be turned off.',
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves'],
  ced: ['3.1.B', '3.1.C', '3.5.E'],
  minutes: 45,
  objectives: [
    'Use ping and traceroute to test whether a computer can be reached, and to find where on the path a connection breaks.',
    'Use nslookup to check which address a name points to, and spot a wrong DNS record.',
    'Use netstat to list a computer’s connections and the programs behind them, and spot one that doesn’t belong.',
    'Explain why nmap needs the network owner’s written permission, and use it within that permission to find open ports and known vulnerabilities.',
  ],
  build: buildLibrary,
  map: { addresses: (d) => d.kind !== 'switch', zones },
  steps: [
    {
      id: 'tour',
      title: 'The library help desk',
      body: md`
        You volunteer at the Lakeside Public Library's help desk after school. Three tickets are waiting:

        1. "The catalog won't load on the public computers."
        2. "The e-book site won't load."
        3. "The mouse on Public PC 2 moved by itself!"

        You'll solve them with **command-line tools**: programs you run by typing a command. Windows, macOS, and Linux all have versions of the first four. nmap is a free download.

        | Command | The question it answers |
        |---|---|
        | ping | Is that computer there, and can I reach it? |
        | traceroute | Which routers does my traffic pass through? |
        | nslookup | Which address goes with this name? |
        | netstat | What is this computer connected to right now? |
        | nmap | Which computers are on this network, and which of their ports are open? |

        A **port** is a numbered door into a computer, one for each service. Secure websites use port 443, for example. (The **Port** column in a device's details, like eth0 or lan, means something else: the jack a cable plugs into.)

        **The rule: nmap only with written permission.** The first four look at your own computer or ask one simple question. nmap knocks on the doors of other people's computers. Scanning a network without its owner's written permission can be a crime, even if you mean no harm. Everything in this lab happens inside a simulation.

        Click [[router]]. It connects the library to the internet, and it's the library's **DNS server**: it turns names like catalog.lakeside.example into addresses. Then click [[catalog]]. Its details open under the map. You don't need most of them today: scroll down to **Open ports**, the doors this server has open. In step 8, nmap finds the same list from outside.
      `,
      focus: ['router', 'catalog'],
      goals: [
        { id: 'router', label: 'Open [[router]]', check: inspected('router') },
        { id: 'catalog', label: 'Open [[catalog]]', check: inspected('catalog') },
      ],
      questions: [
        {
          id: 'allowed',
          kind: 'choice',
          prompt: 'Which of these is fine to do without asking anyone?',
          options: [
            { id: 'ping', text: 'Ping your own home router from your own laptop', correct: true },
            {
              id: 'school',
              text: "Scan the school's network with nmap to help the IT staff",
              feedback: 'Wanting to help is not permission. The school owns that network, so you need its written permission before any scan.',
            },
            {
              id: 'game',
              text: "Scan a game's server with nmap, as long as you don't break anything",
              feedback: "Scanning someone else's server without permission can be a crime, even if nothing breaks. The game company never agreed to it.",
            },
            {
              id: 'friend',
              text: "Run netstat on a classmate's laptop while they're out of the room",
              feedback: 'netstat is harmless on your own computer. Using someone else’s computer without asking is not.',
            },
          ],
          explain: 'Your own computer and your own network are yours to test. Anything that belongs to someone else, a school, a company, or a classmate, needs their permission first.',
        },
      ],
    },

    {
      id: 'ping',
      title: 'ping: is it there?',
      body: md`
        Ticket 1: the catalog won't load on the public computers. Start at [[pc1]].

        **ping** sends a tiny "are you there?" message, and the other computer sends one back.

        1. Open the **Toolkit** tab. The **Terminal** is sitting at Public PC 1.
        2. Type \`ping 10.0.0.1\` and press Enter. That's the library router.
        3. Then ping [[catalog]] at 10.0.0.20. Watch the map: first, **ARP** asks the network "who has 10.0.0.20?" The **learned a MAC** tag means Public PC 1 now knows the catalog server's hardware address. Then the pings go.

        Each reply line shows:

        - **time**: how long the round trip took, in **milliseconds** (ms). 1,000 ms is one second.
        - **TTL** (time to live): starts at 64 or 128, and each router on the way lowers it by 1. At 0 the packet is thrown away. Ticket 2's tool, traceroute, uses this.

        (The map moves packets slowly so you can watch. The terminal prints real-world times.)
      `,
      focus: ['pc1', 'router', 'catalog'],
      open: 'tools',
      tools: [term('pc1', ['ping'])],
      goals: [
        pingGoal('router', 'Ping the library router (10.0.0.1) from [[pc1]]', IP.router, 'In the Terminal, type ping 10.0.0.1 and press Enter.'),
        pingGoal('catalog', 'Ping [[catalog]] (10.0.0.20)', IP.catalog, 'Type ping 10.0.0.20 and press Enter.'),
      ],
      questions: [
        {
          id: 'proves',
          kind: 'choice',
          prompt: 'The catalog server answered all 4 pings. What does that prove?',
          options: [
            { id: 'reach', text: 'It is on, and the network between Public PC 1 and it works', correct: true },
            {
              id: 'site',
              text: 'Its catalog website works',
              feedback: 'ping only tests whether the computer answers. The website is a separate program on it, and it could still be broken.',
            },
            {
              id: 'fixed',
              text: 'The ticket is solved',
              feedback: 'The public computers still can’t open the catalog. The ping shows the problem is somewhere else.',
            },
            {
              id: 'fast',
              text: 'The catalog server is fast',
              feedback: 'A short round trip means the network between you is quick. It says little about how fast the server itself is.',
            },
          ],
          explain: 'Each reply traveled there and back, so the server is on and every cable on the way works in both directions. ping doesn’t test the programs on the server, like its website.',
          afterGoals: true,
        },
      ],
    },

    {
      id: 'ping-name',
      title: 'ping by name',
      body: md`
        People don't type addresses. The public computers open the catalog by its name. Try what they do.

        1. Type \`ping catalog.lakeside.example\`.
        2. The address in square brackets is where the name led. Compare it with [[catalog]]'s address on the map.

        **Destination host unreachable** means nobody answered "who has this address?". The "Reply from" lines come from Public PC 1 itself, reporting that it gave up.
      `,
      focus: ['pc1', 'catalog'],
      open: 'tools',
      tools: [term('pc1', ['ping'])],
      goals: [
        {
          id: 'name',
          label: 'Ping catalog.lakeside.example from [[pc1]]',
          hint: 'Type ping catalog.lakeside.example and press Enter. Watch the spelling.',
          check: ({ sim, since }) => pings(sim, 'pc1', since).some((r) => r.lookup?.name === NAME.catalog && r.lookup.status === 'found'),
        },
      ],
      questions: [
        {
          id: 'wrong',
          kind: 'choice',
          prompt: 'What went wrong?',
          options: [
            { id: 'address', text: 'The name leads to 10.0.0.21, but the catalog server is at 10.0.0.20', correct: true },
            { id: 'off', text: 'The catalog server is turned off', feedback: 'You pinged 10.0.0.20 a minute ago, and it answered.' },
            { id: 'cable', text: "Public PC 1's cable is unplugged", feedback: 'Public PC 1 reached the router and the catalog server in the last step, so its cable works.' },
            {
              id: 'spelling',
              text: 'The name is spelled wrong',
              feedback: 'A misspelled name finds no address at all: "could not find host". This name found one. It was the wrong one.',
            },
          ],
          explain: 'The server is fine at 10.0.0.20. The name sends everyone to 10.0.0.21, where no device lives, so the problem is the name, not the server.',
          afterGoals: true,
        },
      ],
    },

    {
      id: 'nslookup',
      title: 'nslookup: names and addresses',
      body: md`
        A ping by name has two parts. First the computer asks a **DNS server** which address goes with the name. Then it pings that address. **nslookup** does only the first part, so you see exactly what the DNS server says.

        1. Type \`nslookup catalog.lakeside.example\`. The first two lines name the DNS server that answered, [[router]]. (#53 means port 53, the DNS port.)
        2. The last **Address** line is the answer. Is it the catalog server's address? If not, the record is wrong.
        3. The library pays an **IT contractor**, an outside company, to manage the router. Press [[button:report-dns]].
        4. Check their fix with the same nslookup. (The up arrow key brings back the command.)
        5. Press [[button:open-catalog]].
      `,
      focus: ['pc1', 'router'],
      open: 'tools',
      tools: [term('pc1', ['ping', 'nslookup'])],
      actions: [reportDns, openCatalogButton],
      goals: [
        {
          id: 'lookup',
          label: 'Look up catalog.lakeside.example with nslookup',
          hint: 'Type nslookup catalog.lakeside.example and press Enter.',
          check: ({ sim, since }) => lookups(sim, 'pc1', since).some((r) => r.name === NAME.catalog && r.status === 'found'),
        },
        { id: 'report', label: 'Report the wrong record', hint: 'Press **Send the finding to the IT contractor**.', check: ({ sim }) => dnsFixed(sim) },
        {
          id: 'check',
          label: 'Check the fix with nslookup',
          hint: 'Run nslookup catalog.lakeside.example again.',
          check: ({ sim, since }) => lookups(sim, 'pc1', since).some((r) => r.name === NAME.catalog && r.answer === IP.catalog),
        },
        {
          id: 'open',
          label: '[[pc1]] opens the catalog',
          hint: 'Press **Public PC 1 opens the catalog**.',
          check: ({ sim, since }) => pageSince(sim, 'pc1', since, (b) => b.status === 'loaded' && b.from === IP.catalog),
        },
      ],
      questions: [
        {
          id: 'next-time',
          kind: 'choice',
          prompt: 'Next week a visitor says news.example won’t load, but other sites do. Which command checks the name first?',
          options: [
            { id: 'nslookup', text: 'nslookup news.example', correct: true },
            { id: 'ping-router', text: 'ping 10.0.0.1', feedback: 'That checks the library router, and other sites load, so the router works. It says nothing about the name.' },
            { id: 'netstat', text: 'netstat', feedback: 'netstat lists the connections a computer already has open. It doesn’t look up names.' },
            {
              id: 'restart',
              text: 'Restart the computer',
              feedback: 'Restarting fixes some problems, but you wouldn’t learn what was wrong. If the DNS record is wrong, it stays wrong after a restart.',
            },
          ],
          explain: 'nslookup shows which address the DNS server gives for a name. If the address is missing or wrong, you’ve found the problem.',
        },
      ],
    },

    {
      id: 'traceroute',
      title: 'traceroute: follow the path',
      body: md`
        Ticket 2: the e-book site, ebooks.example, won't load.

        1. Type \`ping ebooks.example\`. **Request timed out** means no answer came back in time. Something on the way is broken, but where?
        2. Type \`traceroute ebooks.example\` (on Windows, \`tracert\`) and watch the map. The blue tags at [[router]] are address sharing: your packets go out with the library's one internet address (**sent as**). The router passes the answers back to you (**answer for**).

        traceroute sends pings with a small TTL. The router where the TTL hits 0 drops the packet and sends back a **time exceeded** message from its own address:

        | Try | TTL sent | Where it hits 0 | Shows up as |
        |---|---|---|---|
        | 1 | 1 | 1st router | line 1 |
        | 2 | 2 | 2nd router | line 2 |
        | 3 | 3 | 3rd router | line 3, and so on |

        Each line is one **hop**: one router on the way (the internet provider's box is a router too). A \`*\` means nothing answered. Some routers ignore traceroute, so one \`*\` isn't proof. When the trace never gets past it and pings fail too, the path is broken there.

        3. Answer **In the first trace, where is the problem?** below.
        4. Press [[button:call-isp]].
        5. Run the traceroute again, and count the routers on the way.
      `,
      focus: ['pc1', 'isp', 'core', 'ebooks'],
      open: 'tools',
      tools: [term('pc1', ['ping', 'nslookup', 'traceroute'])],
      actions: [callIsp],
      goals: [
        {
          id: 'ping',
          label: 'Ping ebooks.example',
          hint: 'Type ping ebooks.example and press Enter.',
          check: ({ sim, since }) => pings(sim, 'pc1', since).some((r) => r.ip === IP.ebooks),
        },
        {
          id: 'trace',
          label: 'Trace the path to ebooks.example',
          hint: 'Type traceroute ebooks.example and press Enter. Wait for "Trace stopped".',
          check: ({ sim, since }) => brokenTrace(sim, since),
        },
        { id: 'call', label: 'Report the break to the internet provider', hint: 'Press **Call the internet provider**.', check: ({ sim }) => internetFixed(sim) },
        {
          id: 'again',
          label: 'Trace the path again, all the way to the site',
          hint: 'Run traceroute ebooks.example again. Press the up arrow key to bring it back.',
          // Every hop answered: a trace that started before the repair doesn't count.
          check: ({ sim, since }) => traces(sim, 'pc1', since).some((r) => r.ip === IP.ebooks && r.end === 'reached' && r.hops.every((h) => h.status === 'answer')),
        },
      ],
      questions: [
        {
          id: 'where',
          kind: 'choice',
          prompt: 'In the first trace, where is the problem?',
          options: [
            { id: 'beyond', text: 'Past the internet provider, out on the internet', correct: true },
            { id: 'library', text: "In the library's network", feedback: 'Line 1, the library router, answered. So did line 2, past it. The library side works.' },
            {
              id: 'site',
              text: 'At the e-book site itself',
              feedback: 'The trace never got near the site. It stopped right after the internet provider, two stops before the site.',
            },
            { id: 'pc', text: 'In Public PC 1', feedback: 'Public PC 1 got answers from two routers, so its own connection works.' },
          ],
          explain:
            'The last stop to answer was the internet provider. Past it, nothing answered, so the break is beyond the library. The library can’t fix that; the provider can. (The map shows the cut: no line between the provider and the internet router. A real technician can’t see that, so they use traceroute.) Next, if you haven’t yet, press the Call the internet provider button.',
        },
        {
          id: 'routers',
          kind: 'choice',
          prompt: 'After the repair, how many routers are between Public PC 1 and the e-book site?',
          options: [
            { id: '3', text: '3', correct: true },
            { id: '4', text: '4', feedback: 'There are 4 lines, but the last line is the e-book site itself, not a router.' },
            { id: '2', text: '2', feedback: 'Count the lines before the last one. Each is a router that answered "time exceeded".' },
            { id: '1', text: '1', feedback: 'The library router is only the first stop. Count every line before the site.' },
          ],
          explain: 'Lines 1 to 3 are routers: the library router, the internet provider, and the internet router. Line 4 is the site.',
          afterGoals: true,
        },
      ],
    },

    {
      id: 'netstat',
      title: 'netstat: who is connected?',
      body: md`
        Ticket 3: a library visitor saw the mouse on [[pc2]] move by itself. Someone far away may be using a **remote-control program**: software that shows them the screen and moves the mouse. An attacker who hides one can see every password typed.

        **netstat** lists a computer's open connections. Here is one normal line of \`netstat -b\`, and what each part means:

        | Column | Example | What it means |
        |---|---|---|
        | Proto | TCP | the kind of connection |
        | Local Address | 10.0.0.32:49712 | this computer, then its port |
        | Foreign Address | 10.0.0.20:443 | the other computer, then its port |
        | State | ESTABLISHED | connected right now |
        | Program | browser.exe | what opened it |

        Port 443 is the usual door for secure websites.

        1. Press [[button:watch-pc2]] and watch the map.
        2. The Terminal is sitting at Public PC 2. Type \`netstat -b\`. (\`-b\` is the Windows option. Linux and macOS use others. Real Windows prints each program on its own line, in brackets; this lab puts it in a column.)
        3. Find the line that doesn't belong. The map shows where each Foreign Address is.
        4. Press [[button:unplug-pc2]] to cut it off until IT can check it.
      `,
      focus: ['pc2', 'remote'],
      open: 'tools',
      setup: ensureRepairs,
      tools: [term('pc2', LOOK)],
      actions: [watchButton, unplugButton],
      goals: [
        {
          id: 'watch',
          label: 'Watch [[pc2]]',
          hint: 'Press **Watch Public PC 2**.',
          check: ({ sim, since }) => (sim.dev('pc2').conns ?? []).some((c) => c.t >= since && c.to === IP.remote && c.status === 'open'),
        },
        {
          id: 'netstat',
          label: 'List its connections and programs with `netstat -b`',
          hint: 'Type netstat -b and press Enter.',
          check: ({ sim, since }) => netstats(sim, 'pc2', since).some(showsRat),
        },
        { id: 'unplug', label: 'Unplug [[pc2]]', hint: 'Press **Unplug Public PC 2**.', check: ({ sim }) => !pc2Plugged(sim) },
      ],
      questions: [
        {
          id: 'odd',
          kind: 'choice',
          prompt: 'Which connection doesn’t belong?',
          options: [
            { id: 'rat', text: 'update-helper.exe to 203.0.113.66, port 4444', correct: true },
            { id: 'catalog', text: 'browser.exe to 10.0.0.20, port 443', feedback: "10.0.0.20 is the library's catalog server, and 443 is HTTPS. That's the browser showing the catalog." },
            { id: 'ebooks', text: 'browser.exe to 192.0.2.80, port 443', feedback: '192.0.2.80 is the e-book site, over HTTPS. Visitors use it every day.' },
            { id: 'none', text: 'None of them. They are all normal.', feedback: 'Look at the Foreign Address of each line, and find it on the map.', last: true },
          ],
          explain:
            'A program named like an updater, connected to an unknown server on an unusual port, is a common sign of a remote-control program. Attack tools often use port 4444.',
          afterGoals: ['netstat'],
        },
      ],
    },

    {
      id: 'permission',
      title: 'Permission first',
      body: md`
        The library director wants to know what else on the network is open to attack. IT staff find out with a **port scan**: nmap knocks on common ports of every computer in a network and reports which ones open. Attackers run the same scans to pick targets, so a scan needs the owner's written permission first.

        The director signs this letter:

        > **Lakeside Public Library: permission to scan**
        >
        > - **What:** the library's network, 10.0.0.0/24, including checks for known vulnerabilities (weaknesses)
        > - **From:** the help desk laptop
        > - **When:** today, 3:00 to 5:00 p.m.
        > - **Why:** to find services that should be turned off
        >
        > Not covered: any other network. That includes the e-book site, the internet provider, and the guest Wi-Fi, where visitors connect their own devices.
        >
        > *Signed: the library director*

        The **/24** means every address that starts with 10.0.0: all 256, from 10.0.0.0 to 10.0.0.255. Only the library's own computers (pulsing on the map) use them. The guest Wi-Fi is a separate network.

        This is the **scope**: what you may scan, from where, and when. Don't scan outside it, even if something looks broken or interesting. This lab's Terminal refuses scans outside the letter. A real nmap won't, so following the letter is your job.
      `,
      focus: ['router', 'laptop', 'pc1', 'pc2', 'catalog', 'printer'],
      questions: [
        {
          id: 'covered',
          kind: 'choice',
          prompt: 'Which of these does the letter let you scan?',
          options: [
            { id: 'catalog', text: 'The catalog server, 10.0.0.20', correct: true },
            { id: 'ebooks', text: 'The e-book site, 192.0.2.80', feedback: 'The letter names the e-book site as not covered. Only its owner can give permission to scan it.' },
            { id: 'isp', text: "The internet provider's router, 198.51.100.1", feedback: 'The provider owns that router. The library director can’t give permission for it.' },
            { id: 'visitor', text: "A visitor's laptop on the guest Wi-Fi", feedback: "The guest Wi-Fi is a separate network, and the laptop belongs to the visitor. The letter leaves both out." },
          ],
          explain: '10.0.0.20 is inside 10.0.0.0/24, the network the director owns and named in the letter.',
        },
        {
          id: 'late',
          kind: 'choice',
          prompt: 'Suppose your scans run late. At 5:30 p.m. you want to run one more. What should you do?',
          options: [
            { id: 'ask', text: 'Ask the director again first', correct: true },
            { id: 'go', text: 'Scan. You already had permission earlier today.', feedback: 'The letter covers 3:00 to 5:00 p.m. After 5:00, you have no permission.' },
            { id: 'quick', text: 'Run a quick scan of only one computer', feedback: 'One computer or 256, a scan outside the letter’s time is still outside the letter.' },
            { id: 'other', text: 'Scan from a different laptop instead', feedback: 'The letter covers only the help desk laptop, and only until 5:00 p.m.' },
          ],
          explain: 'Permission covers what the letter says: which network, from which computer, and when. Outside that, ask again.',
        },
      ],
    },

    {
      id: 'nmap',
      title: 'nmap: map the network',
      body: md`
        Now you have permission. An **open** port means a program is answering there, ready for connections. Every open port is a door into that computer, so IT staff keep open only the ones they need.

        1. The Terminal is on [[laptop]], the only computer the letter lets you scan from. Type \`nmap 10.0.0.0/24\`.
        2. nmap asks for every address on the network, then knocks on 10 common ports at each computer it finds. (A real nmap checks 1,000.) A red **no ARP answer** tag on [[laptop]] means it asked for an empty address: no computer has it.
        3. Read the report: one block for each computer that answered. Press **Bigger** on the Terminal to see more. **Host is up** means it answered. The **latency** is how long the answer took, in seconds. A number that starts with 0.000, like 0.00038s, is less than a millisecond.

        | Service | Port | What it does |
        |---|---|---|
        | ssh | 22 | log in and control a computer from far away, **encrypted** (scrambled so only the two ends can read it) |
        | telnet | 23 | the same, but in **plain text**: anyone capturing packets can read the password |
        | ftp | 21 | move files, also in plain text |
        | domain | 53 | DNS |
        | http | 80 | websites, not encrypted |
        | https | 443 | websites, encrypted |
        | ipp | 631 | printing |
      `,
      focus: ['laptop'],
      open: 'tools',
      setup: ensureTicketsDone,
      tools: [NMAP],
      goals: [
        { id: 'scan', label: 'Scan 10.0.0.0/24 from [[laptop]]', hint: 'Type nmap 10.0.0.0/24 and press Enter. Wait for "Nmap done".', check: scanned },
      ],
      questions: [
        {
          id: 'telnet',
          kind: 'choice',
          prompt: 'Which device has Telnet open?',
          options: [
            { id: 'printer', text: 'The printer', correct: true },
            { id: 'catalog', text: 'The catalog server', feedback: "Look again at 10.0.0.20's ports. It has ssh, the encrypted login, but not telnet." },
            { id: 'router', text: 'The library router', feedback: 'The router has domain (DNS, port 53) and https open, not telnet.' },
            { id: 'pc1', text: 'Public PC 1', feedback: 'All 10 ports on Public PC 1 are closed.' },
          ],
          explain: 'Printers often come with Telnet turned on for setup. Anyone on the network could try to log in, and the password would cross the network unencrypted.',
          afterGoals: true,
        },
      ],
    },

    {
      id: 'vuln',
      title: 'Known vulnerabilities',
      body: md`
        An open port isn't the whole story. The program behind it might be an old version with a **vulnerability**: a known weakness an attacker can use. Researchers publish each one as a **CVE** (Common Vulnerabilities and Exposures) with an ID like CVE-2011-2523, so everyone can check for it.

        1. Type \`nmap -sV --script vuln 10.0.0.0/24\`. **-sV** asks each open port which program and version answers. **--script vuln** tests for known vulnerabilities. Some tests try the weakness for real, so the letter had to allow them.
        2. Read the new **VERSION** column, and the lines that start with \`|\`. A **backdoor** is a secret way in that skips the password.
      `,
      focus: ['laptop', 'catalog', 'printer'],
      open: 'tools',
      setup: ensureTicketsDone,
      tools: [NMAP],
      goals: [
        {
          id: 'vuln',
          label: 'Scan for known vulnerabilities',
          hint: 'Type nmap -sV --script vuln 10.0.0.0/24 and press Enter.',
          check: ({ sim, since }) => nmaps(sim, 'laptop', since).some((r) => r.vuln && (wholeNetwork(r) || r.target === IP.catalog)),
        },
      ],
      questions: [
        {
          id: 'turn-off',
          kind: 'choice',
          multi: true,
          prompt: 'Which services should the library turn off?',
          options: [
            {
              id: 'ftp',
              text: 'FTP (port 21) on the catalog server',
              correct: true,
              missed: 'Look at the lines that start with | in the scan: one service has a known vulnerability.',
            },
            {
              id: 'telnet',
              text: 'Telnet (port 23) on the printer',
              correct: true,
              missed: 'The scan doesn’t flag everything. Which service lets someone log in and control a device, with the password in plain text?',
            },
            { id: 'https', text: 'HTTPS (port 443) on the catalog server', feedback: 'That’s the catalog website itself, and it’s encrypted. Turning it off would close the catalog.' },
            { id: 'dns', text: 'DNS (port 53) on the library router', feedback: 'Every computer in the library uses it to look up names. Without it, no site would load by name.' },
          ],
          explain:
            'Turn off what has a known flaw or sends passwords as plain text, and keep what the library needs. The vuln script flagged the FTP backdoor. It didn’t flag Telnet: you spotted that one by knowing what Telnet does.',
          afterGoals: true,
        },
      ],
    },

    {
      id: 'close',
      title: 'Close the doors',
      body: md`
        It's 4:40 p.m., inside the letter's time.

        1. Press [[button:close-risky]].
        2. Scan again to check: \`nmap 10.0.0.0/24\`. nmap still knocks on ports 21 and 23, so you'll see those packets on the map, but they should be gone from the report.

        Checking a fix with the same tool that found the problem is how IT staff know the fix worked.
      `,
      focus: ['catalog', 'printer'],
      open: 'tools',
      setup: ensureTicketsDone,
      tools: [NMAP],
      actions: [closeButton],
      goals: [
        { id: 'closed', label: 'Ask for FTP and Telnet to be turned off', hint: 'Press **Ask the IT contractor to turn off FTP and Telnet**.', check: ({ sim }) => riskyClosed(sim) },
        {
          id: 'rescan',
          label: 'Scan again: no FTP or Telnet',
          hint: 'Run nmap 10.0.0.0/24 again after the IT contractor is done.',
          check: ({ sim, since }) =>
            nmaps(sim, 'laptop', since).some(
              (r) => wholeNetwork(r) && openPorts(sim, r, IP.catalog).includes(443) && !openPorts(sim, r, IP.catalog).includes(21) && !openPorts(sim, r, IP.printer).includes(23),
            ),
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        You solved three tickets by asking the network simple questions: is it there (ping), where does the path break (traceroute), what address goes with a name (nslookup), and what is this computer connected to (netstat). Then, with written permission, you found two risky services with nmap and got them turned off.

        In class, we'll try ping, traceroute, nslookup, and netstat on real computers. They're safe to run on your own computer. Don't run nmap on any network you don't own, including the school's, without written permission from its owner. Scanning without permission can get you suspended from school, taken to court, or in trouble with the police.

        Tip: on Windows, netstat -b works only in a Command Prompt opened as administrator.
      `,
      questions: [
        {
          id: 'advice',
          kind: 'text',
          prompt: 'A friend wants to run nmap on the school network to "see if it’s secure." What would you tell them? Explain the risk, and what they could do instead. You can start with: "I would tell them…"',
          minWords: 40,
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
  ],
};
