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

function zones(): MapZone[] {
  return [
    { id: 'library', shape: { kind: 'rect', x: 20, y: 70, w: 640, h: 540 }, label: 'Lakeside Public Library', tone: 'neutral' },
    { id: 'internet', shape: { kind: 'rect', x: 690, y: 70, w: 560, h: 540 }, label: 'The internet', tone: 'neutral', dashed: true },
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
      : [{ tone: 'bad', text: 'The IT contractor asks: what does the record say right now? Look it up with nslookup first.' }],
};

const openCatalogButton: ActionDef = { id: 'open-catalog', label: 'Public PC 1 opens the catalog', run: openCatalog };

const callIsp: ActionDef = {
  id: 'call-isp',
  label: 'Call the internet provider',
  run: (sim) => {
    if (brokenTrace(sim, ever)) fixInternet(sim);
  },
  outcome: (sim): ActionLine[] =>
    internetFixed(sim)
      ? [{ tone: 'good', text: 'The provider found a cut cable between its building and the internet router, and replaced it. Run traceroute again to check.' }]
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
    return [{ tone: 'good', text: 'Nobody is sitting at Public PC 2, but it traded packets with 203.0.113.66, out on the internet.' }];
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
      ? [{ tone: 'bad', text: 'Find the connection with netstat -b first, so you can tell IT what you cut off.' }]
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
  version: 1,
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

        You'll solve them with **command-line tools**: programs you run by typing a command instead of clicking. Every IT technician uses these. Windows, macOS, and Linux come with the first four, and nmap is a free download.

        | Command | The question it answers |
        |---|---|
        | ping | Is that computer there, and can I reach it? |
        | traceroute | Which routers does my traffic pass through? |
        | nslookup | Which address goes with this name? |
        | netstat | What is this computer connected to right now? |
        | nmap | Which computers are on this network, and which of their ports are open? |

        **The rule for this lab, and for real life:** the first four only ask simple questions or look at your own computer. They're fine to run on your own computer. **nmap** is different. It knocks on every door of other people's computers, looking for one that opens. Scanning a network without its owner's written permission can be a crime, even if you mean no harm. IT staff get permission in writing first, and so will you.

        Everything in this lab happens inside a simulation.

        On the map, the library is on the left. Click [[router]]. It connects the library to the internet, and it's also the library's **DNS server**: it turns names like catalog.lakeside.example into addresses. Then click [[catalog]], which runs the library's online catalog.
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
        Ticket 1: the catalog won't load on the public computers. Start where the problem is, at [[pc1]].

        **ping** sends a tiny "are you there?" message, and the other computer sends one back. A reply proves the computer is on, and that every cable and router between you works, in both directions.

        1. Open the **Toolkit** tab. The **Terminal** is sitting at Public PC 1.
        2. Type \`ping 10.0.0.1\` and press Enter. That's the library router.
        3. Then ping the catalog server, [[catalog]], at 10.0.0.20.

        ping sends 4 pings. Each reply line shows:

        - **time**: how long the round trip took, in **milliseconds** (ms). 1,000 ms is one second. Inside one building, a round trip takes less than 1 ms.
        - **TTL** (time to live): a number every packet carries. Each router it passes lowers the TTL by 1, and a router that lowers it to 0 throws the packet away. That keeps a lost packet from circling the internet forever.

        (The map moves packets slowly so you can watch them. The terminal prints the times a real network would take.)
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
          afterGoals: true,
        },
      ],
    },

    {
      id: 'ping-name',
      title: 'ping by name',
      body: md`
        People don't type addresses. The public computers open the catalog by its name, catalog.lakeside.example. Try what they do.

        1. Type \`ping catalog.lakeside.example\`.
        2. Read the first line. The address in square brackets is where the name led.
        3. Compare it with [[catalog]]'s address on the map.

        **Destination host unreachable** means Public PC 1 asked the library network "who has this address?" and no device answered.
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
          afterGoals: true,
        },
      ],
    },

    {
      id: 'nslookup',
      title: 'nslookup: names and addresses',
      body: md`
        A ping by name happens in two parts. First the computer asks a **DNS server** which address goes with the name. Then it pings that address. **nslookup** does only the first part, so you can see exactly what the DNS server says.

        1. Type \`nslookup catalog.lakeside.example\`. The **Server** line shows which DNS server answered: [[router]], at 10.0.0.1.
        2. The record is wrong: the name points at 10.0.0.21. The library's IT contractor manages the router. Press [[button:report-dns]].
        3. Check their fix: run the same nslookup again. (Press the up arrow key to bring back the command.)
        4. Press [[button:open-catalog]].
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
          prompt: 'Next week a patron says news.example won’t load, but other sites do. Which command checks the name first?',
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

        1. Type \`ping ebooks.example\`. Every ping times out. Something on the way is broken, but where?
        2. **traceroute** finds out. It sends a ping with a TTL of 1. The first router lowers the TTL to 0, throws the ping away, and sends back a "time exceeded" message from its own address. Next it sends a TTL of 2, which reaches the second router, and so on, until the site itself answers. Each line of output is one stop on the way, and a \`*\` means nothing answered.
        3. Type \`traceroute ebooks.example\`. (On Windows the command is \`tracert\`.) Watch the map: each try goes one router farther.
        4. Answer the first question below. Then press [[button:call-isp]].
        5. Run the traceroute again, and count the routers on the way.

        (This traceroute sends one try per stop and gives up after 2 stops in a row with no answer. A real one sends three tries and keeps going for up to 30 stops.)
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
          check: ({ sim, since }) => traces(sim, 'pc1', since).some((r) => r.ip === IP.ebooks && r.end === 'reached'),
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
          explain: 'The last stop to answer was the internet provider. Past it, nothing answered, so the break is beyond the library. The library can’t fix that; the provider can.',
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
        Ticket 3: a patron saw the mouse on [[pc2]] move by itself, as if someone else were steering it. That could be a **remote-control program**: software that lets a person on another computer see the screen and move the mouse. IT staff use these to help people. An attacker who sneaks one onto a computer can watch everything, including passwords typed on it.

        **netstat** lists a computer's open **connections**. Each line shows this computer's address and port, the other computer's address and port (**Foreign Address**), and the **State**. ESTABLISHED means the connection is open right now. A **port** is a number that says which program on a computer a connection belongs to, like an apartment number in a building's address.

        1. Press [[button:watch-pc2]] and watch the map.
        2. The Terminal is now sitting at Public PC 2. Type \`netstat -b\`. The \`-b\` adds the **Program**: what on this computer opened each connection.
        3. Find the line that doesn't belong. The map shows where each Foreign Address is.
        4. Press [[button:unplug-pc2]] to cut it off while IT investigates. Then run netstat again.
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
          label: 'List its connections and programs with netstat -b',
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
            { id: 'ebooks', text: 'browser.exe to 192.0.2.80, port 443', feedback: '192.0.2.80 is the e-book site, over HTTPS. Patrons use it every day.' },
            { id: 'none', text: 'None of them. They are all normal.', feedback: 'Look at the Foreign Address of each line, and find it on the map.', last: true },
          ],
          explain:
            'A program named like an updater, holding a connection to an unknown server on an unusual port, is a classic sign of a remote-control program. Port 4444 is a favorite of attack tools.',
        },
      ],
    },

    {
      id: 'permission',
      title: 'Permission first',
      body: md`
        The library director heard about Public PC 2 and wants to know what else is exposed. IT staff answer that with a **port scan**: nmap knocks on common ports of every computer in a network and reports which ones open. Attackers run the same scans to pick targets. That's why scanning needs the owner's permission, in writing, before you start.

        The director signs this letter:

        > **Lakeside Public Library: permission to scan**
        >
        > I give the help desk volunteer permission to scan the library's network, 10.0.0.0/24, with nmap from the help desk laptop, today from 3:00 to 5:00 p.m., to find services that should be turned off.
        >
        > This does not cover any other network, including the e-book site, the internet provider, or patrons' own devices.
        >
        > *Signed: the library director*

        Security testers call this the **scope**: exactly what you may scan, from where, and when. Anything outside it is off limits, even if it looks broken or interesting. The Terminal in this lab refuses scans outside the letter. A real nmap won't stop you, so the rule is on you.
      `,
      questions: [
        {
          id: 'covered',
          kind: 'choice',
          prompt: 'Which of these does the letter let you scan?',
          options: [
            { id: 'catalog', text: 'The catalog server, 10.0.0.20', correct: true },
            { id: 'ebooks', text: 'The e-book site, 192.0.2.80', feedback: 'The letter names the e-book site as not covered. Only its owner can give permission to scan it.' },
            { id: 'isp', text: "The internet provider's router, 198.51.100.1", feedback: 'The provider owns that router. The library director can’t give permission for it.' },
            { id: 'patron', text: "A patron's laptop on the library network", feedback: "It's on the library's network, but it belongs to the patron. The letter leaves patrons' devices out." },
          ],
          explain: '10.0.0.20 is inside 10.0.0.0/24, the network the director owns and named in the letter.',
        },
        {
          id: 'broken',
          kind: 'choice',
          prompt: 'The e-book site was broken earlier. Can you scan it to check that it’s safe now?',
          options: [
            { id: 'no', text: 'No. Its owner hasn’t given permission, and the letter excludes it.', correct: true },
            { id: 'yes-help', text: 'Yes, because you’re trying to help', feedback: 'Good intentions don’t count as permission. Only the site’s owner can allow a scan.' },
            { id: 'yes-quick', text: 'Yes, if the scan is quick', feedback: 'A quick scan is still a scan. The law cares whether you had permission, not how long it took.' },
            { id: 'yes-library', text: 'Yes, because the library uses the site', feedback: 'Using a site doesn’t make it yours. The library can only give permission for what it owns.' },
          ],
        },
      ],
    },

    {
      id: 'nmap',
      title: 'nmap: map the network',
      body: md`
        Now you have permission. An **open** port means a program answered there, ready for connections, like a web server on port 80 or 443. Every open port is a door into that computer, so IT staff keep open only the ones they need.

        1. The Terminal is now on [[laptop]], the only computer the letter covers. Type \`nmap 10.0.0.0/24\`. The /24 means all 256 addresses from 10.0.0.0 to 10.0.0.255.
        2. Watch the map: nmap pings every address, then knocks on 10 common ports at each computer that answers. (The map draws only the pings to devices that exist. A real nmap checks 1,000 ports unless you tell it otherwise.)
        3. Read the report. There's one block for each computer that answered, with its open ports.

        Some services worth knowing: **ssh** (22) and **telnet** (23) let someone log in and control a computer from far away. SSH encrypts everything. **Telnet** sends everything as plain text, passwords included, so anyone capturing packets on the way can read them. **ftp** (21) moves files, also unencrypted.
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
        {
          id: 'missing',
          kind: 'choice',
          prompt: 'Public PC 2 isn’t in the report. Why?',
          options: [
            { id: 'unplugged', text: 'You unplugged it, so it couldn’t answer', correct: true },
            {
              id: 'closed',
              text: 'All its ports are closed',
              feedback: 'Then nmap would still list it, like Public PC 1: "All 10 scanned ports are closed". It answered no ping at all.',
            },
            { id: 'hidden', text: 'The remote-control program hid it', feedback: 'The program can’t answer anything once the cable is out. The reason is simpler.' },
            { id: 'scope', text: 'It’s outside the permission letter', feedback: 'Its address, 10.0.0.32, is inside 10.0.0.0/24, so the scan did try it.' },
          ],
          afterGoals: true,
        },
      ],
    },

    {
      id: 'vuln',
      title: 'Known vulnerabilities',
      body: md`
        An open port isn't the whole story. The program behind it might be an old version with a known flaw. Security researchers publish known flaws as **CVEs** (Common Vulnerabilities and Exposures), each with an ID like CVE-2011-2523, so everyone can check for them.

        1. Type \`nmap -sV --script vuln 10.0.0.0/24\`. **-sV** asks each open port which program and version is answering. **--script vuln** checks those versions against known flaws.
        2. Read the new **VERSION** column, and the lines that start with \`|\`.
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
          prompt: 'Which services should the library turn off? Pick all that apply.',
          options: [
            { id: 'ftp', text: 'FTP (port 21) on the catalog server', correct: true, feedback: 'Yes: vsftpd 2.3.4 has a known backdoor.' },
            { id: 'telnet', text: 'Telnet (port 23) on the printer', correct: true, feedback: 'Yes: it sends logins as plain text.' },
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
        1. Press [[button:close-risky]].
        2. Scan again to check: \`nmap 10.0.0.0/24\`. Ports 21 and 23 should be gone.

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
      questions: [
        {
          id: 'late',
          kind: 'choice',
          prompt: 'It’s 5:30 p.m. You want to run one more scan. What should you do?',
          options: [
            { id: 'ask', text: 'Ask the director for permission again first', correct: true },
            { id: 'go', text: 'Scan. You already had permission today.', feedback: 'The letter covers 3:00 to 5:00 p.m. After 5:00, you have no permission.' },
            { id: 'quick', text: 'Run a quick scan of one computer', feedback: 'One computer or 256, a scan outside the letter’s time is still outside the letter.' },
            { id: 'other', text: 'Scan from a different laptop', feedback: 'The letter covers only the help desk laptop, and only until 5:00 p.m.' },
          ],
          explain: 'Permission covers what the letter says: which network, from which computer, and when. Outside that, ask again.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        You solved three tickets by asking the network simple questions: is it there (ping), where does the path break (traceroute), what address goes with a name (nslookup), and what is this computer connected to (netstat). Then, with written permission, you found two risky services with nmap and got them closed.

        In class, we'll try ping, traceroute, nslookup, and netstat on real computers. They're safe to run on your own computer. Don't run nmap on any network you don't own, including the school's, without written permission from its owner. Scanning without permission can get you suspended, sued, or charged with a crime.
      `,
      questions: [
        {
          id: 'advice',
          kind: 'text',
          prompt: 'A friend wants to run nmap on the school network to "see if it’s secure." What would you tell them? Explain the risk, and what they could do instead.',
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
