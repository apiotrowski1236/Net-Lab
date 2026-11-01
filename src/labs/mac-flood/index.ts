import type { Sim } from '../../sim/sim';
import { macTableUse } from '../../sim/switchsec';
import { capturedSince, happened, inspected, openedFrame, openedLog } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import { ATTENDANCE_URL, buildOffice, IP, isAttendance, MAC, PORT, TABLE_SIZE, zones } from './scenario';

// Buttons in the lesson. Each one checks the network first, so pressing it twice is harmless.

const plugIn: ActionDef = {
  id: 'plug-in',
  label: 'Mallory plugs into the lobby jack',
  run: (sim) => {
    if (sim.peer('sw', PORT.jack)?.device === 'mallory') return;
    if (sim.dev('mallory').ifaces[0].linkId) sim.disconnect('mallory', 'eth0');
    sim.connect({ device: 'mallory', iface: 'eth0' }, { device: 'sw', iface: PORT.jack });
  },
};

const ortizSends: ActionDef = {
  id: 'ortiz-sends',
  label: 'Ms. Ortiz sends attendance',
  run: (sim) => sim.browse('ortiz', ATTENDANCE_URL),
};

const floodAgain: ActionDef = {
  id: 'flood-again',
  label: 'Mallory floods again',
  run: (sim) => sim.macFlood('mallory', 2),
};

const takeCable: ActionDef = {
  id: 'take-cable',
  label: "Mallory takes the printer's cable",
  run: (sim) => {
    if (sim.peer('sw', PORT.printer)?.device === 'mallory') return;
    if (sim.dev('printer').ifaces[0].linkId) sim.disconnect('printer', 'eth0');
    if (sim.dev('mallory').ifaces[0].linkId) sim.disconnect('mallory', 'eth0');
    sim.connect({ device: 'mallory', iface: 'eth0' }, { device: 'sw', iface: PORT.printer });
  },
};

const malloryPings: ActionDef = {
  id: 'mallory-pings',
  label: 'Mallory pings the records server',
  run: (sim) => {
    sim.ping('mallory', IP.records);
  },
};

// Step setups put the network in the state a step needs, in case the student
// reset it. Each one checks first, so running it twice changes nothing.

const OFFICE_MACS = [MAC.router, MAC.records, MAC.ortiz, MAC.chen, MAC.printer];

function ensureOnJack(sim: Sim): void {
  plugIn.run(sim);
  if (!sim.dev('mallory').sniffing) sim.setSniffing('mallory', true);
}

/** The table is full of made-up MACs and the records server has dropped out. */
function ensureFlooded(sim: Sim): void {
  ensureOnJack(sim);
  // Ms. Ortiz's PC learned the server's MAC in step 2. Without it, her ARP
  // exchange would teach the switch where the server is before the upload.
  const ortiz = sim.dev('ortiz');
  if (!ortiz.arp[IP.records]) ortiz.arp[IP.records] = { mac: MAC.records, at: sim.t, via: 'auto' };
  const sw = sim.dev('sw');
  if (sw.macTable[MAC.records] === undefined && macTableUse(sw).used >= TABLE_SIZE) return;
  sim.macFlood('mallory', 3);
}

/** The flood is over and the old entries have expired: only the real devices are in the table. */
function ensureCleanTable(sim: Sim): void {
  ensureOnJack(sim);
  const sw = sim.dev('sw');
  const known = new Set([...OFFICE_MACS, MAC.mallory]);
  for (const mac of Object.keys(sw.macTable)) if (!known.has(mac)) delete sw.macTable[mac];
  sim.prelearnSwitch('sw');
}

/** Port 7 is off, one way or the other. */
function ensureJackOff(sim: Sim): void {
  if (!sim.dev('sw').switchSec?.ports[PORT.jack]?.shutdown) sim.setPortShutdown('sw', PORT.jack, true);
}

/** Mallory has gone, and the printer is back on port 5. */
function ensurePrinterBack(sim: Sim): void {
  ensureJackOff(sim);
  // If Mallory never took the cable, act out the swap so the log has the evidence.
  if (sim.peer('sw', PORT.printer)?.device === 'printer' && !sim.dev('sw').logs.some((e) => e.fields?.port === PORT.printer && e.fields?.state === 'down' && e.t >= 0)) {
    takeCable.run(sim);
  }
  if (sim.dev('mallory').ifaces[0].linkId) sim.disconnect('mallory', 'eth0');
  if (!sim.dev('printer').ifaces[0].linkId) sim.connect({ device: 'printer', iface: 'eth0' }, { device: 'sw', iface: PORT.printer });
  sim.setMac('mallory', null);
  if (sim.dev('mallory').sniffing) sim.setSniffing('mallory', false);
}

const portSet = (sim: Sim, port: string) => sim.dev('sw').switchSec?.ports[port];

/** When port security first acted on port 7 this step, or undefined. */
function blockedAt(sim: Sim, since: number): number | undefined {
  for (const e of sim.events) {
    if (e.t < since) continue;
    if (e.type === 'port-security' && e.device === 'sw' && e.iface === PORT.jack) return e.t;
  }
  return undefined;
}

export const macFloodLab: LabDef = {
  id: 'mac-flood',
  version: 1,
  title: 'Flood the Switch',
  tagline: "Overflow a switch's memory so it repeats everyone's traffic to you, then lock its ports.",
  unit: 3,
  codehs: [],
  ced: ['3.1.A', '3.1.B', '3.2.A', '3.2.B', '3.3.B', '3.5.E'],
  minutes: 45,
  objectives: [
    "Explain how MAC flooding turns a switch into a hub and lets an attacker eavesdrop.",
    'Find a MAC flood in a switch’s log and MAC address table.',
    'Stop MAC flooding with port security, and close unused ports.',
    'Explain why MAC spoofing defeats MAC filtering, and write a switch security policy.',
  ],
  build: buildOffice,
  captureDevice: 'mallory',
  labelMacs: true,
  clock: '10:15',
  map: { ports: true, zones },
  steps: [
    {
      id: 'office',
      title: 'The front office',
      body: md`
        Lincoln High's front office runs on one **switch**, [[sw]]. Everything in the office plugs into it: [[ortiz]], who takes attendance, [[chen]], the counselor, the [[records]], and the [[router]] to the district network. The [[printer]] sits out in the lobby so visitors can print forms.

        Port 7 of the switch runs to a **wall jack** in the lobby: a network socket in the wall. Nothing is plugged into it, and anyone waiting in the lobby could plug in. Today someone will: [[mallory]], a visitor with a laptop.

        A switch keeps a **MAC address table**, a list of which port leads to each MAC address. When a frame comes in, the switch looks up the frame's To MAC and sends the frame out that one port. Only the device it's addressed to gets it.

        Click [[sw]] on the map and find its MAC address table. Then click [[mallory]].

        > Everything in this lab happens inside a simulation. Flooding a switch or faking a MAC address on a real network without permission is illegal.
      `,
      focus: ['sw', 'mallory'],
      goals: [
        { id: 'switch', label: 'Open the Office switch in the inspector', check: inspected('sw') },
        { id: 'mallory', label: 'Open Mallory in the inspector', check: inspected('mallory') },
      ],
      questions: [
        {
          id: 'one-port',
          kind: 'choice',
          prompt: "Ms. Ortiz sends a frame to the records server's MAC address. The switch's table says that MAC is on port 2. Where does the frame go?",
          options: [
            { id: 'p2', text: 'Out port 2 only', correct: true },
            { id: 'all', text: 'Out every port', feedback: 'That is what a hub does. A switch uses its table so it doesn’t have to.' },
            { id: 'p7', text: 'Out port 7, to the lobby', feedback: 'Nothing is plugged into port 7, and the table says port 2.' },
            { id: 'back', text: 'Back out port 3, to Ms. Ortiz', feedback: 'A switch never sends a frame back out the port it came in on.' },
          ],
          explain: 'The switch finds the To MAC in its table and sends the frame out that one port. Devices on the other ports never see it.',
        },
      ],
    },

    {
      id: 'jack',
      title: 'A jack in the lobby',
      body: md`
        You play Mallory for the next few steps.

        Press **Mallory plugs into the lobby jack**. Her laptop connects to port 7 of [[sw]].

        Open the **Toolkit** and turn on **Packet capture** for Mallory. It copies every frame that reaches her network card.

        Then press **Ms. Ortiz sends attendance**. Her PC sends third period's absences to the [[records]]. Her PC doesn't know the server's MAC address yet, so it first sends an ARP request: a **broadcast**, a frame addressed to every device. Watch which frames reach the lobby.
      `,
      focus: ['mallory', 'sw', 'ortiz'],
      actions: [plugIn, ortizSends],
      tools: [{ kind: 'sniffer', device: 'mallory' }],
      goals: [
        {
          id: 'plugged',
          label: 'Mallory is plugged into the lobby jack (port 7)',
          check: ({ sim }) => sim.peer('sw', PORT.jack)?.device === 'mallory',
        },
        {
          id: 'capture',
          label: 'Mallory is capturing',
          hint: 'Turn on **Packet capture** in the Toolkit.',
          check: ({ sim }) => sim.dev('mallory').sniffing,
        },
        {
          id: 'sent',
          label: "Ms. Ortiz's attendance reaches the server while Mallory captures",
          hint: 'Turn on capture first, then press **Ms. Ortiz sends attendance**.',
          // Checked as the server receives it: Mallory must be listening at that moment.
          check: ({ sim, ev }) =>
            ev?.type === 'http-request' &&
            ev.device === 'records' &&
            isAttendance(ev.frame) &&
            sim.dev('mallory').sniffing &&
            sim.peer('sw', PORT.jack)?.device === 'mallory',
        },
      ],
      questions: [
        {
          id: 'why-not',
          kind: 'choice',
          afterGoals: true,
          prompt: "Look in the Capture tab. Ms. Ortiz's attendance reached the server, but Mallory has no copy. Why?",
          options: [
            { id: 'table', text: "The switch looked up the server's MAC and sent the frame out port 2 only.", correct: true },
            { id: 'encrypted', text: 'The attendance was encrypted.', feedback: 'It is plain HTTP. And an encrypted frame would still show up in the capture, as gibberish.' },
            { id: 'ip', text: 'Mallory has an IP address on a different network.', feedback: 'Her IP address is on the office network. Besides, a switch sends frames by MAC address, not IP address.' },
            {
              id: 'jack',
              text: 'Wall jacks only carry broadcasts.',
              feedback: 'Port 7 is an ordinary port. The switch sends a frame there when its table points there, or when it doesn’t know where to send it.',
            },
          ],
          explain:
            "A frame for one MAC goes only where the switch's table points. Broadcasts, like Ms. Ortiz's ARP request, go out every port. That is why Mallory caught the ARP request and nothing else.",
        },
      ],
    },

    {
      id: 'flood',
      title: 'Fill the table',
      body: md`
        The MAC address table is what keeps Mallory out of the conversation. So Mallory goes after the table.

        A switch learns the From MAC of every frame that comes in, and its table has room for only so many entries. **MAC flooding** is sending frames from thousands of made-up MAC addresses until the table is full. Real devices get pushed out.

        Open the **Toolkit** and find the **MAC flooder**. Choose how many bursts and press **Flood**. Each burst is 20 frames, each from a different made-up MAC. On the map, a stack marked ×20 stands for 20 frames.

        Keep flooding until the table is full. Watch the meter on the flooder, or click [[sw]] to watch its table.

        This switch holds ${TABLE_SIZE} entries so you can watch it fill. Real switches hold thousands, and a flooding tool sends thousands of frames a second. When the table is full, this switch pushes out its oldest entry to make room. (Real switches stop learning and let old entries expire after a few minutes. The result is the same.)
      `,
      focus: ['mallory', 'sw'],
      open: 'tools',
      tools: [{ kind: 'mac-flood', device: 'mallory' }],
      goals: [
        {
          id: 'full',
          label: "The switch's MAC table is full",
          hint: `Send more bursts. The table holds ${TABLE_SIZE} entries.`,
          check: ({ sim }) => macTableUse(sim.dev('sw')).used >= TABLE_SIZE,
        },
        {
          id: 'gone',
          label: "The records server's MAC is pushed out of the table",
          hint: 'Keep flooding. The oldest entries go first.',
          check: ({ sim }) => sim.dev('sw').macTable[MAC.records] === undefined,
        },
      ],
      questions: [
        {
          id: 'unknown',
          kind: 'choice',
          afterGoals: true,
          prompt: "The records server's MAC is gone from the table. Ms. Ortiz sends the server another frame. What does the switch do with it?",
          options: [
            { id: 'flood', text: 'Sends it out every port', correct: true },
            { id: 'drop', text: 'Drops it', feedback: 'A switch doesn’t drop a frame for a MAC it doesn’t know. It sends it everywhere so the right device still gets it.' },
            { id: 'p2', text: 'Sends it out port 2, where the server was', feedback: 'The switch has no memory of port 2 for that MAC anymore. The entry is gone.' },
            { id: 'arp', text: "Asks for the server's MAC with ARP", feedback: 'Switches don’t use ARP. Computers use ARP to find the MAC for an IP address.' },
          ],
          explain: 'A switch that doesn’t know where a MAC is sends the frame out every port except the one it came in on. With its table full of fake entries, the switch acts like a hub.',
        },
      ],
    },

    {
      id: 'overheard',
      title: 'Everything, everywhere',
      setup: ensureFlooded,
      body: md`
        The table is full of Mallory's made-up MACs, and the [[records]] isn't in it anymore.

        Press **Ms. Ortiz sends attendance** again. The switch doesn't know where the server is, so it sends her frame out every port, including port 7. Listening in on traffic meant for someone else is called **eavesdropping**.

        Then open the **Capture** tab and click the attendance frame (**GET /attendance**) to read it.
      `,
      focus: ['ortiz', 'sw', 'mallory'],
      tools: [{ kind: 'sniffer', device: 'mallory' }, { kind: 'mac-flood', device: 'mallory' }],
      actions: [ortizSends],
      goals: [
        {
          id: 'caught',
          label: "Mallory captures Ms. Ortiz's attendance",
          hint: "Press **Ms. Ortiz sends attendance**. If Mallory catches nothing, flood again: the server's entry may be back in the table.",
          check: ({ sim, since }) => capturedSince(sim, 'mallory', since, isAttendance),
        },
        {
          id: 'opened',
          label: 'Open the attendance frame in the Capture tab',
          hint: 'In the **Capture** tab, click the line that says **GET /attendance**.',
          check: openedFrame('mallory', isAttendance),
        },
      ],
      questions: [
        {
          id: 'cia',
          kind: 'choice',
          prompt: 'Attendance, and the reason a student is absent, are private. Which part of the CIA triad did the flood break?',
          options: [
            { id: 'c', text: 'Confidentiality', correct: true },
            { id: 'i', text: 'Integrity', feedback: 'Nothing was changed. The upload reached the server exactly as Ms. Ortiz sent it.' },
            { id: 'a', text: 'Availability', feedback: 'The attendance still got through, and the server still works.' },
          ],
          explain: 'Confidentiality means only the people who should see data can see it. Mallory read a private record without changing it or stopping it.',
        },
        {
          id: 'who',
          kind: 'text',
          prompt: "Which student is out for a doctor's appointment?",
          placeholder: 'First and last name',
          expect: /jordan/i,
          expectHint: 'Open the attendance frame and read the path in the HTTP request.',
          explain: 'Jordan Lee. The absence list and the reason were in the request, in plain text.',
        },
      ],
    },

    {
      id: 'detect',
      title: 'Spot the flood',
      body: md`
        Switch sides. You're the school's network admin now. Ms. Ortiz says the office network feels slow this morning. Find out why.

        A switch keeps a **log**: one line for every event it notices, with the time. Open the **Logs** tab and read [[sw]]'s log. Click a line to see its details.

        Then click [[sw]] and look at its **Ports and port security** table. Count the MAC addresses on each port. A PC or a printer has one.
      `,
      focus: ['sw'],
      open: 'logs',
      tools: [{ kind: 'logs', devices: ['sw'] }],
      goals: [
        {
          id: 'log',
          label: 'Open a "MAC address table full" line in the switch\'s log',
          hint: 'In the **Logs** tab, click a line that starts with %SW_MATM-4-TABLE_FULL.',
          check: openedLog((e) => e.device === 'sw' && e.source === 'mac-table'),
        },
        { id: 'inspect', label: 'Open the Office switch and check its ports', check: inspected('sw') },
      ],
      questions: [
        {
          id: 'evidence',
          kind: 'choice',
          prompt: 'Which clue best shows this is MAC flooding, not a busy morning?',
          options: [
            { id: 'many', text: 'Port 7 has dozens of MAC addresses, but a wall jack serves one device.', correct: true },
            { id: 'full', text: 'The MAC table is full.', feedback: 'A big, busy network can fill a table too. What’s strange is where the entries came from.' },
            { id: 'warn', text: 'The switch log has warnings.', feedback: 'Warnings happen for many reasons. Read what they say: which port did the new MACs arrive on?' },
            { id: 'p3', text: "Ms. Ortiz's port went down and up this morning.", feedback: 'That happened at 09:23, long before the flood. A PC restarting does that.' },
          ],
          explain:
            'One port that suddenly has dozens of new MAC addresses is the sign of MAC flooding. In the log, each table-full line from port 7 learned 20 new addresses at once. A real device, like Ms. Ortiz’s PC on port 3, brings one.',
        },
        {
          id: 'port',
          kind: 'text',
          prompt: 'Which switch port is the flood coming in on?',
          placeholder: 'Port number',
          expect: /^\s*(port\s*|p)?\s*7\s*\.?\s*$/i,
          expectHint: 'Look at the port named in the table-full log lines, or the port with the most MACs.',
          explain: 'Port 7, the wall jack in the lobby.',
        },
      ],
    },

    {
      id: 'portsec',
      title: 'Port security',
      setup: ensureCleanTable,
      body: md`
        The flood has stopped for now, and the switch has learned the real devices again. Mallory's laptop is still on port 7. Lock that port down.

        **Port security** limits how many MAC addresses may use a switch port. A laptop has one MAC. If another MAC shows up, the switch does what you choose:

        - **Shut the port down**: the port turns off until an admin turns it back on.
        - **Drop its frames, keep the port on**: frames from the extra MACs are thrown away and logged.

        Click [[sw]]. In **Ports and port security**, choose **Edit** on port 7. Turn on port security, set **Most MACs** to 1, choose **Shut the port down**, and press **Save port 7**.

        Then press **Mallory floods again** and watch port 7. Press **Ms. Ortiz sends attendance** to check that her data stays private.
      `,
      focus: ['sw', 'mallory'],
      open: { inspect: 'sw' },
      tools: [{ kind: 'port-security', device: 'sw' }],
      actions: [floodAgain, ortizSends],
      goals: [
        {
          id: 'set',
          label: 'Port 7 allows 1 MAC and shuts down on a violation',
          hint: 'Click the Office switch. Choose **Edit** on port 7, set **Most MACs** to 1, choose **Shut the port down**, and save.',
          check: ({ sim }) => {
            const ps = portSet(sim, PORT.jack)?.security;
            return ps?.maxMacs === 1 && ps.violation === 'shutdown';
          },
        },
        {
          id: 'blocked',
          label: "Port security stops Mallory's flood",
          hint: 'Save the port 7 settings first, then press **Mallory floods again**.',
          check: ({ sim, since }) => blockedAt(sim, since) !== undefined,
        },
        {
          id: 'private',
          label: "Ms. Ortiz's attendance reaches the server, and Mallory captures none of it",
          hint: 'After port 7 shuts, press **Ms. Ortiz sends attendance**.',
          check: ({ sim, since }) => {
            const at = blockedAt(sim, since);
            if (at === undefined) return false;
            const sent = happened(sim, at, (e) => e.type === 'http-request' && e.device === 'records' && isAttendance(e.frame));
            return sent && !sim.dev('mallory').capture.some((c) => c.t >= at && isAttendance(c.frame));
          },
        },
      ],
      questions: [
        {
          id: 'why-works',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Port 7 shut down at the first made-up MAC. Why does that stop MAC flooding?',
          options: [
            { id: 'limit', text: 'A flood needs thousands of MACs on one port. Now that port may use only one.', correct: true },
            { id: 'ban', text: "It removes Mallory's laptop from the network for good.", feedback: 'An admin can turn the port back on. Port security counts MACs. It doesn’t know who Mallory is.' },
            { id: 'encrypt', text: 'It encrypts the attendance.', feedback: 'Port security doesn’t encrypt anything. The upload is still plain HTTP.' },
            { id: 'bigger', text: 'It makes the MAC table bigger.', feedback: 'The table is the same size. It never fills with fake entries, because they never get in.' },
          ],
          explain: 'With a limit of one MAC, the second MAC on the port is a violation. The made-up MACs never reach the table, so the real devices stay in it.',
        },
      ],
    },

    {
      id: 'filter',
      title: 'Only known devices',
      setup: ensureJackOff,
      body: md`
        Port 7 is off. Mallory looks around the lobby and finds another network cable: the one that runs to the [[printer]].

        As the admin, try **MAC filtering** on the printer's port: allow only the printer's MAC address on port 5.

        1. Click [[printer]] and read its MAC address.
        2. Click [[sw]] and choose **Edit** on port 5. Turn on port security. Set **Most MACs** to 1, choose **Drop its frames, keep the port on**, and type the printer's MAC under **Only these MACs**. Press **Save port 5**.

        Now play Mallory again. The printer's MAC is on a sticker on its back. Changing the MAC address your network card sends is called **MAC spoofing**.

        3. In the **Toolkit**, use the **MAC changer** to make Mallory's laptop send the printer's MAC.
        4. Press **Mallory takes the printer's cable**, then **Mallory pings the records server**.
      `,
      focus: ['printer', 'sw', 'mallory'],
      tools: [{ kind: 'mac-change', device: 'mallory' }, { kind: 'port-security', device: 'sw' }],
      actions: [takeCable, malloryPings],
      goals: [
        {
          id: 'filter',
          label: "Port 5 allows only the printer's MAC",
          hint: "Click the Office switch, choose **Edit** on port 5, and type the printer's MAC under **Only these MACs**.",
          check: ({ sim }) => {
            const allowed = portSet(sim, PORT.printer)?.security?.allowed;
            return allowed?.length === 1 && allowed[0] === MAC.printer;
          },
        },
        {
          id: 'spoof',
          label: "Mallory's laptop sends the printer's MAC",
          hint: "Type the printer's MAC into the **MAC changer** and press **Change MAC**.",
          check: ({ sim }) => sim.dev('mallory').ifaces[0].mac === MAC.printer,
        },
        {
          id: 'in',
          label: "Mallory reaches the records server through the printer's port",
          hint: "Change Mallory's MAC first, then take the cable and ping. If port 5 shut down, turn it back on in the switch's inspector.",
          check: ({ sim, since }) =>
            sim.peer('sw', PORT.printer)?.device === 'mallory' &&
            happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'mallory' && e.from === IP.records),
        },
      ],
      questions: [
        {
          id: 'not-enough',
          kind: 'choice',
          afterGoals: true,
          prompt: 'MAC filtering let Mallory in. Why isn’t it enough on its own?',
          options: [
            { id: 'copy', text: 'Every frame shows its From MAC, and software can change it.', correct: true },
            { id: 'max', text: 'Port 5 allowed too many MACs.', feedback: 'It allowed exactly one. Mallory used that one.' },
            { id: 'weak', text: "The printer's MAC was too short.", feedback: 'Every MAC is the same length. A copy works as well as the original.' },
            { id: 'wifi', text: 'MAC filtering only works on Wi-Fi.', feedback: 'Switches and Wi-Fi access points both offer it, and spoofing beats it on both.' },
          ],
          explain: 'A MAC address is a label, not a proof. Anyone who can read it, on a sticker or in a captured frame, can copy it.',
        },
      ],
    },

    {
      id: 'close',
      title: 'Close the doors',
      setup: ensurePrinterBack,
      body: md`
        Mallory has left, and the [[printer]] is back on its cable. MAC filtering never complained: every frame had the right MAC. The switch's log noticed something else.

        Open the **Logs** tab and type port 5 in the **Search** box. Only port 5's lines are left. Click a **warning** that says port 5 changed state to **down**: that is Mallory unplugging the printer. A printer that drops off the network and comes back is worth checking on.

        Now close the doors. A port with nothing plugged in is an open door. Click [[sw]], choose **Edit** on each empty port (6, 7, and 8), and press **Shut port down**.

        Port 7 is off already because port security shut it. That lasts only until someone turns it back on, so press **Shut port down** on it too.
      `,
      focus: ['sw', 'printer'],
      open: 'logs',
      tools: [{ kind: 'port-security', device: 'sw' }],
      goals: [
        {
          id: 'log',
          label: 'Open the log line where port 5 went down',
          hint: 'In the **Logs** tab, search for port 5. Click a warning line: it ends with changed state to down.',
          check: openedLog((e) => e.device === 'sw' && e.fields?.port === PORT.printer && e.fields?.state === 'down'),
        },
        {
          id: 'shut',
          label: 'Every port with nothing plugged in is shut down',
          hint: 'Click the Office switch. Choose **Edit** on ports 6, 7, and 8, and press **Shut port down** on each.',
          check: ({ sim }) => {
            const sw = sim.dev('sw');
            return sw.ifaces.every((i) => i.linkId || sw.switchSec?.ports[i.id]?.shutdown === 'admin');
          },
        },
      ],
      questions: [
        {
          id: 'prove',
          kind: 'choice',
          prompt: 'With every empty port shut, someone could still unplug a device and use its port with a copied MAC. What would stop that?',
          options: [
            { id: 'auth', text: 'The port lets a device in only after it proves who it is, with a certificate or password.', correct: true },
            { id: 'hide', text: "Hide the switch's MAC table.", feedback: 'Mallory never needed the table. She read the MAC off a sticker.' },
            { id: 'more', text: 'Turn on MAC filtering on every port.', feedback: 'MAC filtering is what Mallory just beat. A copied MAC passes it.' },
            { id: 'logs', text: 'Delete old log lines so nobody can read them.', feedback: 'The log is how you caught the printer swap. Keep it.' },
          ],
          explain:
            'Making each device prove its identity before the port opens is port-based authentication. Its standard is 802.1X. It goes beyond this course, but it is how many schools and companies lock down wall jacks. Keeping switches and spare jacks out of public areas helps too.',
        },
      ],
    },

    {
      id: 'policy',
      title: 'The switch policy',
      body: md`
        A **security policy** is a written set of rules an organization follows. A **switch security policy** says how every switch must be set up, so the next admin doesn't leave a jack open.

        Help write Lincoln High's. Pick every rule that belongs in it.
      `,
      questions: [
        {
          id: 'rules',
          kind: 'choice',
          multi: true,
          prompt: 'Which rules belong in the school’s switch security policy? Pick all that apply.',
          options: [
            { id: 'central', text: "Admins sign in to switches through the district's authentication server, not a local account on each switch.", correct: true },
            { id: 'portsec', text: 'Port security is on for every port that leads to a user’s device.', correct: true },
            { id: 'unused', text: 'Unused ports are shut down.', correct: true },
            { id: 'filter', text: 'Ports for devices that never move, like printers, use MAC filtering.', correct: true },
            { id: 'lobby', text: 'Lobby jacks stay on so visitors can get online.', feedback: 'Visitors belong on a separate guest network. An open office jack is how Mallory got in.' },
            { id: 'shared', text: 'Office staff share one switch password, so anyone can fix a problem.', feedback: 'A shared password can’t be traced to one person, and everyone who leaves still knows it.' },
          ],
          explain:
            'Each rule closes a door from this lab. Signing in through one authentication server means one place to remove an admin’s access and one record of who changed what. MAC filtering is weak alone, but together with port security and logs it raises the bar.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        You used four controls today: port security, shutting unused ports, MAC filtering, and reading the switch's log. Each one stops some attacks and misses others.
      `,
      questions: [
        {
          id: 'first',
          kind: 'text',
          prompt:
            "MAC flooding broke the confidentiality of the front office's student records. You can turn on one control from this lab first. Which one, and why? Say what it stops and what it doesn't.",
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
        Look over your summary on the right. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
  ],
};
