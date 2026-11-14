import { evaluate } from '../../sim/firewall';
import { payloadLen } from '../../sim/tcp';
import type { FileFrame } from '../../sim/capfile';
import type { Sim } from '../../sim/sim';
import type { Frame, IpPacket } from '../../sim/types';
import { citeQuestion } from '../cite';
import { fileFiltered, followed, happened, inspected, openedCapfile, openedPacket, sawStats } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, LabDef, ToolSpec } from '../types';
import {
  BREAKROOM_PORT,
  build,
  C2_PORT,
  FILE_DEFS,
  FILES,
  IP,
  isEchoReply,
  isEchoRequest,
  isFloodFrame,
  isPoison,
  isRst,
  isSyn,
  isSynAck,
  KIOSKS,
  MAC,
  replayCheckin,
  replayFlood,
  RSYNC_PORT,
  TELNET_PASSWORD,
  toC2,
  type FileId,
} from './scenario';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** The Capture tab with these saved files, and everything Wireshark's toolbar gives an analyst. */
const files = (...ids: FileId[]): ToolSpec => ({ kind: 'capture-file', device: 'analyst', files: ids, filter: true, stats: true, follow: true });

const kioskIps: string[] = KIOSKS.map((k) => IP[k]);
const payload = (f: Frame) => !!f.ip && payloadLen(f.ip) > 0;
const port = (f: Frame, p: number) => f.ip?.srcPort === p || f.ip?.dstPort === p;
const ipText = /^\s*\d{1,3}(\.\d{1,3}){3}\s*$/;

// ---------------------------------------------------------------------------
// The fix step: what the live network does now
// ---------------------------------------------------------------------------

const breakroomSecured = (sim: Sim) => !!sim.dev('switch').switchSec?.ports[BREAKROOM_PORT]?.security;

/** A check-in from the camera recorder to 192.0.2.44, and an ordinary kiosk payment, as the router's firewall sees them leaving. */
const C2_PROBE: IpPacket = { src: IP.cams, dst: IP.c2, proto: 'tcp', srcPort: 49152, dstPort: C2_PORT, ttl: 64, app: { kind: 'svc', app: 'http' } } as IpPacket;
const MAPS_PROBE: IpPacket = { src: IP.dispatch1, dst: IP.maps, proto: 'tcp', srcPort: 49153, dstPort: 443, ttl: 64, app: { kind: 'svc', app: 'https' } } as IpPacket;

function c2Denied(sim: Sim): boolean {
  const fw = sim.dev('gw').firewall;
  return !!fw && evaluate(fw, C2_PROBE, 'out').action === 'deny';
}
function mapsAllowed(sim: Sim): boolean {
  const fw = sim.dev('gw').firewall;
  return !!fw && evaluate(fw, MAPS_PROBE, 'out').action === 'allow';
}

const floodBlocked = (sim: Sim, since: number) =>
  happened(sim, since, (e) => e.type === 'port-security' && e.device === 'switch' && e.iface === BREAKROOM_PORT);
const checkinBlocked = (sim: Sim, since: number) =>
  happened(sim, since, (e) => e.type === 'firewall' && e.device === 'gw' && e.verdict.action === 'deny' && e.pkt.dst === IP.c2);
const checkinOpened = (sim: Sim, since: number) => happened(sim, since, (e) => e.type === 'tcp' && e.what === 'open' && e.session.serverIp === IP.c2);

const replayFloodAction: ActionDef = {
  id: 'replay-flood',
  label: 'Replay the 14:00 flood',
  run: replayFlood,
  outcome(sim, since): ActionLine[] {
    if (floodBlocked(sim, since)) return [{ tone: 'good', text: 'Port security shut port 7 at the first made-up MAC. The flood stopped at the switch.' }];
    if (!sim.idle) return [{ tone: 'wait', text: 'The break-room PC is sending made-up MACs…' }];
    return [{ tone: 'bad', text: 'The made-up MACs went into the switch’s table. Turn on port security on port 7, then replay it.' }];
  },
};

const replayCheckinAction: ActionDef = {
  id: 'replay-checkin',
  label: 'Replay the 02:00 check-in',
  run: replayCheckin,
  outcome(sim, since): ActionLine[] {
    if (checkinBlocked(sim, since)) return [{ tone: 'good', text: 'The router’s firewall denied the recorder’s SYN to 192.0.2.44. The check-in never left the depot.' }];
    if (checkinOpened(sim, since)) return [{ tone: 'bad', text: 'The recorder reached 192.0.2.44 again. Add the deny rule above allow out, then replay it.' }];
    return [{ tone: 'wait', text: 'The recorder is calling out…' }];
  },
};

// ---------------------------------------------------------------------------
// The lab
// ---------------------------------------------------------------------------

export const captureAnalysisLab: LabDef = {
  id: 'capture-analysis',
  version: 1,
  title: 'The Story in the Capture',
  tagline: 'Open a day of packet captures from a bus depot, tell the broken from the malicious, and cite the packets that prove each attack.',
  unit: 3,
  codehs: ['3.18 The Story in the Logs'],
  ced: ['3.5.E', '3.5.D', '3.1.C'],
  minutes: 50,
  objectives: [
    'Use Statistics views (Endpoints, Conversations, and the I/O Graph) to find what stands out in a capture file.',
    'Read TCP flags to tell an open port, a closed port, and a port scan apart.',
    'Find the packets that prove a smurf attack, ARP poisoning, a MAC flood, a port scan, and command-and-control traffic, and cite them by number.',
    'Tell an attack from an outage or a false alarm, and choose a mitigation for each attack.',
  ],
  build: () => build(),
  captureDevice: 'analyst',
  captureFiles: FILE_DEFS,
  wireshark: true,
  map: { addresses: (d) => d.kind === 'host' || d.id === 'gw' },
  clock: '17:00',
  steps: [
    {
      id: 'ticket',
      title: 'The ticket',
      body: md`
        You are the new security analyst for **Valley Transit**, the city's bus company. The depot network runs two dispatch computers, the [[fares]] that takes card payments from three ticket kiosks, a [[cams]] for the security cameras, and a [[backup]]. [[gw]] connects the depot to the internet.

        Night shift left you a ticket:

        > Network was weird all day. Kiosks failed in the morning, things were slow at lunch, and the camera recorder was talking to something at 2 a.m. Threat intel says to watch for these addresses: 192.0.2.44, 198.18.5.9, 203.0.113.250.

        Everything in this lab happens inside a simulation. Capturing other people's traffic without permission, or attacking a network, is illegal.

        [[switch]] has a **mirror port**: the switch sends a copy of every frame it receives out one port, so a computer plugged in there can capture the traffic of the whole depot. [[analyst]] sits on that port. It saved a **capture file** every hour. A capture file is a recording of packets you open later, like a .pcap file in Wireshark.

        1. Click [[switch]] and find **Mirror port**.
        2. Open the **Capture** tab. It shows **07:00 depot.pcap**, a normal morning.
        3. Click any packet to open its layers.

        The **No.** column numbers every packet in the file. A packet keeps its number even when a filter hides the rows around it, so analysts use these numbers to point to evidence in a report. **Time** counts seconds from the start of the file.
      `,
      open: { inspect: 'switch' },
      focus: ['switch', 'analyst'],
      tools: [{ kind: 'capture-file', device: 'analyst', files: ['morning'] }],
      goals: [
        { id: 'mirror', label: 'Find the mirror port on [[switch]]', hint: 'Click the Depot switch on the map. Mirror port is in its settings.', check: inspected('switch') },
        { id: 'open-file', label: 'Open **07:00 depot.pcap** in the Capture tab', hint: 'Click the Capture tab under the map.', check: openedCapfile('morning') },
        { id: 'open-packet', label: 'Open a packet', hint: 'Click any row in the packet list.', check: openedPacket('morning') },
      ],
      questions: [
        {
          id: 'why-mirror',
          kind: 'choice',
          prompt: 'Why capture at the mirror port instead of on one of the depot’s computers?',
          options: [
            { id: 'all', text: 'The mirror port gets a copy of every device’s traffic, so one capture shows the whole depot.', correct: true },
            {
              id: 'one',
              text: 'A capture on one computer would show the whole depot, but more slowly.',
              feedback: 'A switch sends each computer only its own frames and broadcasts. A capture there would miss everyone else’s traffic.',
            },
            { id: 'faster', text: 'The mirror port makes the depot’s network faster while you capture.', feedback: 'A copy doesn’t speed anything up. It lets one laptop see what every port sees.' },
            { id: 'decrypt', text: 'The mirror port decrypts the traffic, so you can read the card payments.', feedback: 'Encrypted traffic stays encrypted wherever you capture it. The mirror port only copies frames.' },
          ],
          explain: 'A switch sends each frame only to the port it’s meant for, so a computer normally sees only its own traffic. A mirror port (Cisco calls it SPAN) gets a copy of everything, which is where sensors and analysts plug in.',
        },
      ],
    },

    {
      id: 'normal',
      title: 'What normal looks like',
      body: md`
        Before you hunt for anything strange, learn what an ordinary hour looks like. This is the depot's **baseline**: what normal looks like, so anything new stands out later.

        Wireshark's **Statistics** menu sums up a whole file. Use the Statistics buttons in the Capture tab:

        1. **Endpoints: IPv4** lists every IP address in the file, with how many packets it sent and received. It opens sorted by **Packets**, busiest first. Click any heading to sort by that column.
        2. **Conversations** lists each pair of addresses that talked, and how much.

        The map shows each device's address. 203.0.113.10 is not on the map: it's the bus-tracking map service on the internet, which dispatch checks all day.
      `,
      open: 'capture',
      focus: ['fares', 'kiosk1', 'kiosk2', 'kiosk3'],
      tools: [files('morning')],
      goals: [
        { id: 'endpoints', label: 'Open **Endpoints: IPv4** for 07:00', hint: 'The Statistics buttons are at the top of the Capture tab.', check: sawStats('morning', 'endpoints-ip') },
        { id: 'convs', label: 'Open **Conversations** for 07:00', hint: 'The Statistics buttons are at the top of the Capture tab.', check: sawStats('morning', 'conversations') },
      ],
      questions: [
        {
          id: 'top-talker',
          kind: 'choice',
          prompt: 'Which address sends and receives the most packets in a normal hour?',
          options: [
            { id: 'fares', text: '198.51.100.20, the fare server', correct: true },
            { id: 'maps', text: '203.0.113.10, the map service', feedback: 'It comes second. Sort Endpoints by Packets and read the top row.' },
            { id: 'dispatch', text: '198.51.100.11, Dispatch 1', feedback: 'Dispatch 1 only checks the bus map. Sort Endpoints by Packets and read the top row.' },
            { id: 'cams', text: '198.51.100.40, the camera recorder', feedback: 'The recorder isn’t in this file at all. Remember that for later.' },
          ],
          explain: 'Every kiosk payment is a conversation with the fare server, so it tops a normal hour. The camera recorder doesn’t show up at all: the cameras are wired straight to it, so it has no reason to send anything across the depot switch.',
        },
        {
          id: 'why-baseline',
          kind: 'choice',
          prompt: 'Why does an analyst look at a normal hour first?',
          options: [
            { id: 'compare', text: 'To spot what changes later: a new address, a new port, or far more packets than usual.', correct: true },
            { id: 'safe', text: 'Normal hours can’t contain attacks, so they can be skipped from now on.', feedback: 'Attacks can hide in any hour. The baseline is for comparing, not for skipping.' },
            { id: 'tool', text: 'Wireshark can’t open other files until it has read a normal one.', feedback: 'Wireshark opens any file. The baseline is for you, so you know what to compare against.' },
            { id: 'infected', text: 'The normal hour lists which computers are infected.', feedback: 'A normal hour shows healthy traffic. It tells you what to expect, so the odd parts stand out later.' },
          ],
        },
      ],
    },

    {
      id: 'outage',
      title: 'Kiosks can’t take cards',
      body: md`
        At 08:00 the kiosks stopped taking cards. Open **08:00 depot.pcap** from the file list at the top of the Capture tab.

        Every TCP connection starts with a **three-way handshake**. Each step is marked by **flags**, on and off switches in the TCP header that the Info column lists in brackets:

        - **SYN** (synchronize): "I'd like to connect to this port."
        - **SYN, ACK**: "Go ahead." The port is open.
        - **ACK** (acknowledge): "Got it." Now data can flow.
        - **RST** (reset): "No." Here it means nothing is listening on that port, so the connection is refused. (Either side can also send an RST to end a connection, and some firewalls send them.)

        Type this display filter and press Enter:

        \`tcp.flags.reset == 1\`

        It shows only packets with the RST flag on. Read the Source column: who is saying no? Then clear the filter and look at what comes right before a reset.
      `,
      open: 'capture',
      focus: ['fares', 'kiosk1', 'kiosk2', 'kiosk3'],
      tools: [files('morning', 'outage')],
      goals: [
        {
          id: 'filter-rst',
          label: 'Filter **08:00 depot.pcap** down to the resets',
          hint: 'Type tcp.flags.reset == 1 in the filter bar and press Enter.',
          check: fileFiltered(FILES.outage, isRst, { min: 5 }),
        },
      ],
      questions: [
        citeQuestion({
          id: 'cite-rst',
          prompt: 'Which packet shows the fare server refusing a kiosk? Type one packet number.',
          placeholder: 'One packet number, like 412',
          file: FILES.outage,
          fits: ({ frame: f }) =>
            !isRst(f)
              ? 'is not a reset. Look for [RST, ACK] in the Info column.'
              : f.ip!.src !== IP.fares || !kioskIps.includes(f.ip!.dst)
                ? 'is a reset, but not one from the fare server to a kiosk.'
                : true,
          explain: 'Each kiosk SYN to port 443 gets an RST, ACK from 198.51.100.20 a fraction of a millisecond later.',
        }),
        {
          id: 'attack-or-not',
          kind: 'choice',
          prompt: 'Is the 08:00 problem an attack?',
          options: [
            { id: 'outage', text: 'No. The fare server answers at once, but its fare program isn’t running.', correct: true },
            {
              id: 'rst-attack',
              text: 'Yes. An RST means an attacker cut the connection.',
              feedback: 'An RST is a server’s normal answer when nothing listens on a port. Look at who sent it: the fare server, from its own address.',
            },
            {
              id: 'syn-flood',
              text: 'Yes. Someone is flooding the fare server with SYNs.',
              feedback: 'Count them: one SYN from each kiosk every few seconds, the same pace as a normal morning. A flood would be thousands.',
            },
            {
              id: 'unplugged',
              text: 'No. The kiosks are unplugged from the switch.',
              feedback: 'The kiosks’ SYNs are in the capture, so they’re connected. The fare server answers them too. It says no.',
            },
          ],
          explain:
            'The fare server is up and reachable, since it answers every SYN right away. RST means nothing is listening on port 443: the fare program crashed. Restarting it fixes the kiosks. Not every problem on a network is an attack.',
        },
      ],
    },

    {
      id: 'smurf',
      title: 'Slow at lunch: the first spike',
      body: md`
        Staff said the network was slow at lunch. Open **12:00 depot.pcap**, then **I/O Graph**. It draws how many packets crossed the network each second. Point at a bar to read its numbers.

        There are two spikes. Start with the first, at about 14 to 24 seconds. Filter to ICMP, the protocol ping uses:

        \`icmp\`

        The I/O Graph draws the matching packets in a darker color, so you can check that the filter covers the spike. Click a bar in the spike to open the **Packet list** at that second. An **echo request** is a ping, and an **echo reply** answers it.

        Look at where the echo requests are sent: 198.51.100.255 is the depot's **broadcast address**. Every computer on the depot network gets a copy of each one, and every one of them replies.

        Then look at the Source. Anyone who builds a packet can write any address there. Faking it is called **spoofing**. So ask: who gets all the replies?
      `,
      open: 'capture',
      tools: [files('noon')],
      goals: [
        { id: 'io', label: 'Open the **I/O Graph** for 12:00', hint: 'It’s the last Statistics button.', check: sawStats('noon', 'io') },
        {
          id: 'filter-icmp',
          label: 'Filter 12:00 to ICMP',
          hint: 'Type icmp in the filter bar and press Enter.',
          check: fileFiltered(FILES.noon, (f) => f.ip?.proto === 'icmp', { min: 20 }),
        },
      ],
      questions: [
        citeQuestion({
          id: 'cite-smurf',
          prompt: 'Cite two or more echo requests sent to the broadcast address.',
          file: FILES.noon,
          min: 2,
          minText: 'two packet numbers',
          fits: ({ frame: f }) =>
            isEchoReply(f)
              ? 'is an echo reply from a depot computer. Cite the requests sent to 198.51.100.255.'
              : !isEchoRequest(f) || f.ip!.dst !== IP.broadcast
                ? 'is not an echo request to 198.51.100.255.'
                : true,
        }),
        {
          id: 'forged',
          kind: 'choice',
          prompt: 'The echo requests say they come from 203.0.113.77. Is that the attacker?',
          options: [
            { id: 'victim', text: 'No. It’s the victim. The attacker forged its address, so every reply lands on it.', correct: true },
            {
              id: 'source',
              text: 'Yes. The Source column always shows who sent a packet.',
              feedback: 'Anyone who builds a packet can write any source address into it. Follow the replies: they all go to 203.0.113.77, which only hurts it.',
            },
            { id: 'router', text: 'No. It’s the depot router checking that computers are up.', feedback: 'The router is 198.51.100.1. 203.0.113.77 is outside the depot.' },
            {
              id: 'kiosks',
              text: 'Yes. It wants to knock the depot’s kiosks offline.',
              feedback: 'The depot gets one ping per request. Each one turns into nine replies sent to 203.0.113.77. Who gets the most traffic?',
            },
          ],
          explain:
            'This is a **smurf attack**. The attacker sends pings to a network’s broadcast address with the victim’s address as the source. Every computer replies to the victim, so one packet becomes nine. The depot was the amplifier, and its slow lunch was a side effect. It worked because the depot router has **directed broadcast** on, a setting that lets pings from outside reach the broadcast address. Modern routers turn it off by default, and most computers now ignore broadcast pings, but this old router didn’t.',
        },
      ],
    },

    {
      id: 'backup',
      title: 'Slow at lunch: the second spike',
      body: md`
        Now the second spike, at about 38 to 47 seconds. Clear the filter and open **Conversations**. It opens sorted by **Packets**, busiest first.

        The top conversation is between two depot computers. Press its **Filter** button to show only their packets. Then look at the I/O Graph again, and read a few packets in the list. Which port do they use? (Port 873 is **rsync**, a program that copies files from one computer to another.)

        A detector that watches traffic raises an alert when something looks wrong. The alert is a **true positive** if there really was an attack, and a **false positive** if the traffic was harmless.
      `,
      open: 'capture',
      focus: ['backup', 'fares'],
      tools: [files('noon')],
      goals: [
        { id: 'convs', label: 'Open **Conversations** for 12:00', hint: 'Statistics: Conversations.', check: sawStats('noon', 'conversations') },
        {
          id: 'filter-backup',
          label: 'Filter to the top conversation’s packets',
          hint: 'In Conversations, press Filter on the row for 198.51.100.20 and 198.51.100.50.',
          check: fileFiltered(FILES.noon, (f) => port(f, RSYNC_PORT), { min: 100 }),
        },
      ],
      questions: [
        {
          id: 'second-spike',
          kind: 'choice',
          prompt: 'Is the second spike an attack?',
          options: [
            { id: 'backup', text: 'No. The backup server is copying the fare server’s files over rsync.', correct: true },
            {
              id: 'theft',
              text: 'Yes. Two computers moving this much data must be stealing it.',
              feedback: 'Both ends are the depot’s own servers, on the backup program’s port. Data moving between them doesn’t leave the depot.',
            },
            { id: 'smurf2', text: 'Yes. It’s a second smurf attack.', feedback: 'A smurf is pings to a broadcast address. These are TCP packets between two depot servers on one port.' },
            { id: 'chatter', text: 'No. It’s the switch’s own background chatter.', feedback: 'A switch doesn’t send hundreds of packets a second. Read the addresses: two servers.' },
          ],
          explain:
            'One known pair, one port, the backup program, and a steady stream of full-size packets: that’s the nightly backup. Ask around and you learn someone started it early by hand. A spike alone doesn’t prove an attack. (rsync on port 873 doesn’t encrypt what it copies. That’s a weakness worth fixing, but it isn’t an attack.)',
        },
        {
          id: 'false-alarm',
          kind: 'choice',
          prompt: 'A detector raised a “traffic spike” alert at 12:00:38. What kind of alert is that?',
          options: [
            { id: 'fp', text: 'A false positive', correct: true },
            { id: 'tp', text: 'A true positive', feedback: 'A true positive is an alert for a real attack. This spike was a backup.' },
            { id: 'fn', text: 'A false negative', feedback: 'A false negative is an attack with no alert. Here there was an alert and no attack.' },
            { id: 'tn', text: 'A true negative', feedback: 'A true negative is no alert for harmless traffic. Here the detector did alert.' },
          ],
          explain: 'A **false positive** is an alert for something harmless. Too many of them, and analysts start ignoring alerts. Telling the detector about the backup window would quiet this one.',
        },
      ],
    },

    {
      id: 'arp',
      title: 'One MAC, two addresses',
      body: md`
        Open **13:00 depot.pcap** and filter to ARP replies:

        \`arp.opcode == 2\`

        A **MAC address** is the hardware name of a network card, like ${MAC.gw}. An IP address is where a device sits on the network. An **ARP reply** connects the two: it tells a computer "this IP address is at this MAC address." Read the replies in the Info column, or open one and read the **Claim** in its ARP layer. (You can filter on the claim's parts too, like \`arp.src.proto_ipv4 == 198.51.100.1\`.)

        The router is 198.51.100.1. Click [[gw]] to see its real MAC address. Do all the replies agree with it?
      `,
      open: 'capture',
      focus: ['gw', 'dispatch1', 'dispatch2'],
      tools: [files('arp')],
      goals: [
        {
          id: 'filter-arp',
          label: 'Filter 13:00 to ARP replies',
          hint: 'Type arp.opcode == 2 and press Enter.',
          check: fileFiltered(FILES.arp, (f) => f.arp?.op === 'reply', { min: 5 }),
        },
        { id: 'router-mac', label: 'Click [[gw]] to see its real MAC', hint: 'Click the Depot router on the map.', check: inspected('gw') },
      ],
      questions: [
        citeQuestion({
          id: 'cite-arp',
          prompt: 'Cite two or more forged ARP replies.',
          file: FILES.arp,
          min: 2,
          minText: 'two packet numbers',
          fits: ({ frame: f }) =>
            isPoison(f)
              ? true
              : f.arp?.op === 'reply' && f.arp.senderMac === MAC.gw
                ? `is the router’s real reply: ${MAC.gw} is the router’s own MAC.`
                : f.arp?.op === 'request'
                  ? 'is an ARP request, a question. Cite the replies.'
                  : 'is not an ARP reply.',
        }),
        {
          id: 'whose-mac',
          kind: 'choice',
          prompt: 'Which device sent the forged replies? Compare their MAC with the devices on the map.',
          options: [
            { id: 'breakroom', text: 'The Break-room PC', correct: true },
            { id: 'router', text: 'The Depot router', feedback: `The router’s MAC is ${MAC.gw}. The forged replies only claim its IP address.` },
            { id: 'dispatch2', text: 'Dispatch 2', feedback: 'Dispatch 2 is a victim: the replies are sent to it. Click devices on the map and compare MACs.' },
            { id: 'analyst', text: 'The Analyst laptop', feedback: 'The analyst laptop only listens on the mirror port. Click devices on the map and compare MACs.' },
          ],
          explain:
            'This is **ARP poisoning**. The Break-room PC tells both dispatch computers that the router’s IP is at its own MAC. Their internet traffic now goes to the break-room PC first, which can read it and pass it on: an on-path attack. A computer believes any ARP reply unless its entry for the router was typed in by hand, a **static ARP entry**.',
        },
      ],
    },

    {
      id: 'flood',
      title: 'Thousands of MACs in ten seconds',
      body: md`
        Open **14:00 depot.pcap** and **Endpoints: Ethernet**, which lists every MAC address in the file. A depot this size has about ten. How many does this file have?

        Open the **I/O Graph** to find when it happened, and click a bar in the spike. The **Packet list** opens at that second. Open a few frames there. Each is an Ethernet frame with nothing inside, from a different made-up MAC. (Click a row, then the arrow keys move up and down.)
      `,
      open: 'capture',
      focus: ['switch'],
      tools: [files('flood')],
      goals: [
        { id: 'eth', label: 'Open **Endpoints: Ethernet** for 14:00', hint: 'Statistics: Endpoints: Ethernet.', check: sawStats('flood', 'endpoints-eth') },
        { id: 'frame', label: 'Open one of the flood’s frames', hint: 'On the I/O Graph, click a bar at about 20 seconds, then click a row.', check: openedPacket('flood', (c) => isFloodFrame(c.frame)) },
      ],
      questions: [
        citeQuestion({
          id: 'cite-flood',
          prompt: 'Cite at least ten of the flood’s frames. A range works, like 1200-1250.',
          placeholder: 'Packet numbers or a range, like 1200-1250',
          file: FILES.flood,
          min: 10,
          minText: 'ten packet numbers',
          // A range across the flood picks up a few ordinary packets sent in the same seconds. They don't count either way.
          skip: (c) => !isFloodFrame(c.frame) && c.t >= 20_000 && c.t <= 30_500,
          fits: (c) => (isFloodFrame(c.frame) ? true : 'is ordinary depot traffic from before or after the flood.'),
        }),
        {
          id: 'mac-table',
          kind: 'choice',
          prompt: 'What did the flood do to the depot switch’s MAC address table?',
          options: [
            { id: 'filled', text: 'It filled the table with made-up MACs, so the switch sent frames out every port.', correct: true },
            { id: 'erased', text: 'It erased the table, and the switch turned itself off.', feedback: 'A full table doesn’t turn a switch off. The switch stops learning, and frames for unknown MACs go out every port.' },
            { id: 'ignored', text: 'Nothing. A switch ignores frames that have no IP packet inside.', feedback: 'A switch reads only the Ethernet header. It learns every new source MAC, whatever is inside.' },
            { id: 'shut', text: 'It made the switch shut off the port the frames came in on.', feedback: 'Only port security shuts a port, and it was off at 14:00.' },
          ],
          explain:
            'This is **MAC flooding**. With its table full, the switch sends every frame it can’t place out every port, like a **hub** (an old device that repeats everything to everyone). Anyone can then capture traffic meant for other ports. The capture can’t show which port the frames came in on, since the made-up MACs belong to no one. The switch’s MAC table can: at 14:00 it filled up with made-up MACs, all on port 7, the Break-room PC’s port.',
        },
      ],
    },

    {
      id: 'scan',
      title: 'Knocking on every door',
      body: md`
        Open **15:00 depot.pcap** and **Conversations**. Sort by **Ports**, the number of different ports one side used. Most conversations use a handful. One uses more than a thousand.

        Filter to connection attempts:

        \`tcp.flags.syn == 1\`

        One outside address sends a SYN to port 1 on the fare server, then port 2, then 3, and on up. This is a **port scan**: the scanner tries every door to learn which ones open. A closed port answers RST. An open port answers SYN, ACK, and the scanner hangs up with RST before the handshake finishes. (Real scanners like nmap try ports in a random order. This one goes in order, so the pattern stands out.)

        To find the open ports, show only packets with both flags on. \`&&\` means "and": a packet has to match both sides.

        \`tcp.flags.syn == 1 && tcp.flags.ack == 1\`

        Normal kiosk connections have SYN, ACK packets too. To keep only the scanner's, add \`&& ip.addr ==\` and the scanner's address.
      `,
      open: 'capture',
      focus: ['fares'],
      tools: [files('scan')],
      goals: [
        { id: 'convs', label: 'Open **Conversations** for 15:00', hint: 'Statistics: Conversations, then sort by Ports.', check: sawStats('scan', 'conversations') },
        {
          id: 'filter-syn',
          label: 'Filter 15:00 to packets with SYN on',
          hint: 'Type tcp.flags.syn == 1 and press Enter.',
          check: fileFiltered(FILES.scan, (f) => !!f.ip?.tcp?.flags.syn, { min: 2 }),
        },
      ],
      questions: [
        {
          id: 'scanner-ip',
          kind: 'text',
          short: true,
          prompt: 'What IP address ran the scan?',
          placeholder: 'An IP address',
          expect: ipText,
          expectHint: 'Type one IP address, like 203.0.113.5.',
          verify: (v) =>
            v.trim() === IP.scanner ? undefined : v.trim() === IP.fares ? 'That’s the fare server, the target. Who sends the SYNs?' : 'Find the address that sends SYNs to port after port.',
          explain: '203.0.113.66 sent 1,024 SYNs to the fare server in about six seconds, from the same source port every time.',
        },
        citeQuestion({
          id: 'cite-open',
          prompt: 'Which packets show the scanner finding an open port? Cite each one.',
          file: FILES.scan,
          min: 2,
          minText: 'two packet numbers (two ports are open)',
          fits: ({ frame: f }) =>
            isSynAck(f) && f.ip!.src === IP.fares && f.ip!.dst === IP.scanner
              ? true
              : isSyn(f) && f.ip!.src === IP.scanner
                ? 'is the scanner’s SYN, a question. Cite the answers that say yes.'
                : isRst(f)
                  ? 'is a reset. A reset means that port is closed, or the scanner hanging up.'
                  : isSynAck(f)
                    ? 'is a SYN, ACK from an ordinary connection, not an answer to the scanner.'
                    : 'is not a SYN, ACK sent to the scanner.',
          explain:
            'Two SYN, ACKs go back to 203.0.113.66: from port 443, the fare program, and port 873, rsync. Now the scanner knows where to aim next. A scan is **reconnaissance**: an attacker mapping targets before striking. One that nobody approved is a warning sign even before any attack lands.',
        }),
      ],
    },

    {
      id: 'c2',
      title: 'Wrong port, wrong program',
      body: md`
        Open **02:00 depot.pcap**. Nobody works at the depot at 2 a.m., so almost everything here is a machine on a schedule. Open **Conversations** to see who talked.

        One pair is the nightly backup. The other is [[cams]] talking to an outside address on port 4444. Compare that address with the threat list in the ticket:

        > 192.0.2.44, 198.18.5.9, 203.0.113.250

        Web traffic normally uses port 80 (HTTP) or 443 (HTTPS). Port 4444 is the default for a well-known attack tool, so web traffic on 4444 stands out.

        Click one of the recorder's packets and press **Follow TCP Stream**. It puts one connection in order: what the recorder sent in one color, and what came back in another. Each check-in is a new connection with its own stream. To see every check-in at once, filter to \`ip.addr == 192.0.2.44 && http\`.
      `,
      open: 'capture',
      focus: ['cams'],
      tools: [files('night')],
      goals: [
        {
          id: 'follow',
          label: 'Follow a TCP stream between [[cams]] and the outside address',
          hint: 'Open a packet to or from 192.0.2.44, then press Follow TCP Stream above its layers.',
          check: followed(FILES.night, (fs: FileFrame[]) => fs.some((c) => toC2(c.frame))),
        },
      ],
      questions: [
        {
          id: 'c2-ip',
          kind: 'text',
          short: true,
          prompt: 'What outside IP address does the camera recorder talk to?',
          placeholder: 'An IP address',
          expect: ipText,
          expectHint: 'Type one IP address, like 203.0.113.5.',
          verify: (v) =>
            v.trim() === IP.c2 ? undefined : v.trim() === IP.cams ? 'That’s the camera recorder itself. Who does it talk to?' : 'Open Conversations and find the recorder’s partner.',
        },
        citeQuestion({
          id: 'cite-orders',
          prompt: 'Cite every packet where the outside server sends the recorder a command. There are at least two.',
          file: FILES.night,
          min: 2,
          minText: 'two packet numbers',
          fits: ({ frame: f }) =>
            !toC2(f)
              ? 'is not part of the recorder’s conversation with 192.0.2.44.'
              : !payload(f)
                ? 'carries no data, only TCP flags.'
                : f.ip!.src !== IP.c2
                  ? 'is the recorder’s own message. Cite the replies from 192.0.2.44.'
                  : true,
          explain:
            'The recorder checks in every ten seconds and asks for orders: this is **command and control** (C2) traffic. One reply said to upload a garage camera video, and the next connection sent it.',
        }),
      ],
    },

    {
      id: 'report',
      title: 'The incident report',
      body: md`
        Time to write up the day. Here is what the captures showed:

        | Time | What the capture showed |
        |---|---|
        | 08:00 | The fare server answering kiosks' SYNs with RST |
        | 12:00 | Pings to the broadcast address, with replies to 203.0.113.77 |
        | 12:00 | A burst of rsync between the backup server and the fare server |
        | 13:00 | ARP replies pairing the router's IP with the Break-room PC's MAC |
        | 14:00 | Thousands of made-up source MACs in ten seconds |
        | 15:00 | SYNs from 203.0.113.66 to 1,024 ports on the fare server |
        | 02:00 | Plain HTTP from the camera recorder to 192.0.2.44 on port 4444 |

        An **indicator of compromise** (IoC) is evidence in traffic or logs that an attack happened. The **CIA triad** names what security protects: **confidentiality** (only the right people can see data), **integrity** (data isn't changed without permission), and **availability** (systems work when people need them).

        The capture files are still in the Capture tab if you want to check your evidence. Answer these for your report.
      `,
      tools: [files('outage', 'noon', 'arp', 'flood', 'scan', 'night')],
      questions: [
        {
          id: 'attacks',
          kind: 'choice',
          multi: true,
          prompt: 'Which findings are attacks? Choose every one.',
          options: [
            { id: 'rst', text: '08:00: RSTs from the fare server', feedback: 'The fare program crashed. That’s an outage.' },
            { id: 'smurf', text: '12:00: pings to the broadcast address', correct: true },
            { id: 'rsync', text: '12:00: the rsync burst', feedback: 'That was the backup, started early. A false alarm.' },
            { id: 'arp', text: '13:00: the forged ARP replies', correct: true },
            { id: 'flood', text: '14:00: the made-up MACs', correct: true },
            { id: 'scan', text: '15:00: the SYNs to 1,024 ports', correct: true },
            { id: 'c2', text: '02:00: the recorder’s HTTP to 192.0.2.44', correct: true },
          ],
          explain: 'Five attacks: a smurf, ARP poisoning, a MAC flood, a port scan, and C2 traffic. The outage and the backup are on the list too, marked “not an attack,” so nobody wastes time on them again.',
        },
        {
          id: 'iocs',
          kind: 'choice',
          multi: true,
          prompt: 'Which of these are indicators of compromise in the 02:00 traffic? Choose every one.',
          options: [
            { id: 'list', text: 'The recorder talks to an address on the threat list.', correct: true },
            { id: 'port', text: 'Plain HTTP runs on port 4444 instead of the web’s port 80.', correct: true },
            { id: 'backup', text: 'The backup server copies files from the fare server.', feedback: 'That’s the nightly backup, between two depot servers on the backup port.' },
            { id: 'tcp', text: 'The recorder’s traffic uses TCP.', feedback: 'Almost every program uses TCP. That alone says nothing.' },
          ],
          explain: 'A known bad address and a program on the wrong port are both classic IoCs. Either one is worth a look. Together they’re hard to explain away.',
        },
        {
          id: 'cia-c2',
          kind: 'choice',
          prompt: 'The recorder uploaded a garage camera video to 192.0.2.44. Which part of the CIA triad did that harm most?',
          options: [
            { id: 'c', text: 'Confidentiality', correct: true },
            { id: 'i', text: 'Integrity', feedback: 'The video wasn’t changed. Someone outside got a copy they shouldn’t have.' },
            { id: 'a', text: 'Availability', feedback: 'The recorder kept working. The harm is who can now see the video.' },
          ],
          explain: 'The video wasn’t changed, and the recorder kept working. Someone outside the depot got a copy of footage they shouldn’t see: a loss of confidentiality.',
        },
        {
          id: 'fix-smurf',
          kind: 'choice',
          prompt: 'Which change stops the depot being used in the next smurf attack?',
          options: [
            { id: 'directed', text: 'Turn off directed broadcast on the depot router.', correct: true },
            { id: 'victim', text: 'Block 203.0.113.77 at the router.', feedback: 'That’s the victim. The next attack will forge some other victim’s address.' },
            { id: 'port-sec', text: 'Turn on port security on the switch.', feedback: 'Port security limits MACs on a switch port. The pings came in from the internet, through the router.' },
            { id: 'one-host', text: 'Turn off ping on the fare server.', feedback: 'Nine computers answered. One fewer still leaves eight replies per ping.' },
          ],
          explain: 'With directed broadcast off, the router drops pings from outside aimed at 198.51.100.255, so nobody inside answers them.',
        },
        {
          id: 'fix-arp',
          kind: 'choice',
          prompt: 'Which change protects dispatch from the 13:00 ARP poisoning?',
          options: [
            { id: 'static', text: 'A static ARP entry for the router on each dispatch computer.', correct: true },
            { id: 'block-gw', text: 'A firewall rule blocking 198.51.100.1.', feedback: 'That’s the router itself. Blocking it cuts dispatch off from the internet.' },
            { id: 'encrypt', text: 'Turning on encryption for ARP replies.', feedback: 'ARP has no encryption to turn on. A computer believes any reply unless its entry is fixed.' },
            { id: 'mirror', text: 'Moving the analyst laptop off the mirror port.', feedback: 'The analyst laptop only listens. The forged replies come from the Break-room PC.' },
          ],
          explain: 'A static entry can’t be changed by a reply, forged or not. On a bigger network, a switch feature called Dynamic ARP Inspection checks replies for every port.',
        },
      ],
    },

    {
      id: 'fix',
      title: 'Fix it and capture again',
      body: md`
        Two of the attacks can be stopped right here, on the live depot network.

        1. **The MAC flood.** Click [[switch]]. In **Ports and port security**, press **Edit** on **port 7**, the [[breakroom]]'s port. Turn port security on, keep **Most MACs** at 1 and **Shut the port down**, and press **Save port 7**.
        2. **The C2 traffic.** Click [[gw]] and press **Add a rule**: **deny**, direction **out**, any protocol, destination 192.0.2.44, port **any**. Press **Add rule**.
        3. The router checks its rules from the top. Use the arrows to move your rule above **allow out**.
        4. Press **Start** in the Capture tab to capture live on [[analyst]]. Then press each button below and watch what happens.

        (Rule 2, **allow in** from anywhere, is how the 15:00 scan reached the fare server. Closing it is a job for another lab.)
      `,
      open: { inspect: 'switch' },
      focus: ['switch', 'breakroom', 'gw', 'cams'],
      tools: [
        { kind: 'port-security', device: 'switch' },
        { kind: 'firewall-rules', devices: ['gw'] },
        { kind: 'capture', device: 'analyst', filter: true },
      ],
      actions: [replayFloodAction, replayCheckinAction],
      goals: [
        {
          id: 'port-sec',
          label: 'Turn on port security on port 7 of [[switch]]',
          hint: 'Click the Depot switch, press Edit on port 7 in Ports and port security, and turn it on.',
          check: ({ sim }) => breakroomSecured(sim),
        },
        {
          id: 'flood-blocked',
          label: 'Replay the flood and see port security stop it',
          hint: 'Press Replay the 14:00 flood after port security is on.',
          check: ({ sim, since }) => breakroomSecured(sim) && floodBlocked(sim, since),
        },
        {
          id: 'deny-c2',
          label: 'Deny traffic out to 192.0.2.44 on [[gw]], and still allow everything else out',
          hint: 'Add a deny rule, direction out, destination 192.0.2.44, then move it above allow out.',
          check: ({ sim }) => c2Denied(sim) && mapsAllowed(sim),
        },
        {
          id: 'c2-blocked',
          label: 'Replay the check-in and see the firewall block it',
          hint: 'Press Replay the 02:00 check-in after your rule is in place.',
          check: ({ sim, since }) => c2Denied(sim) && checkinBlocked(sim, since),
        },
      ],
      questions: [
        {
          id: 'rule-order',
          kind: 'choice',
          prompt: 'Why does the deny rule have to sit above “allow out”?',
          options: [
            { id: 'first', text: 'The router uses the first rule that matches, and allow out matches the check-in too.', correct: true },
            { id: 'newest', text: 'The router only reads the newest rule.', feedback: 'The router reads from the top, whatever order the rules were added in.' },
            { id: 'deny-last', text: 'Deny rules only work at the top of a list.', feedback: 'A deny rule works anywhere. It has to come before any rule that would allow the same packet.' },
            { id: 'cosmetic', text: 'It doesn’t matter. The order is only how they’re shown.', feedback: 'Try it: below allow out, the check-in matches allow first and goes through.' },
          ],
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Write it up',
      body: md`
        Write the summary for your shift lead.
      `,
      questions: [
        {
          id: 'writeup',
          kind: 'text',
          prompt:
            'Pick one attack you found today. Name it, cite the packet numbers that prove it, and say what in those packets gives it away. Then explain why a capture is stronger evidence than a staff member saying “the network was slow.”',
          minWords: 40,
          lines: 7,
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

    {
      id: 'telnet',
      title: 'Optional extra challenge: a password in plain text',
      extra: true,
      body: md`
        At 16:00 someone signed in to [[gw]] with **Telnet**, an old remote sign-in program that sends everything as plain text, passwords included.

        Open **16:00 depot.pcap**, filter to \`telnet\`, open a packet, and follow its TCP stream. (Real Telnet sends each key press in its own packet. This file puts each line in one, to keep it short.)
      `,
      open: 'capture',
      focus: ['gw', 'dispatch2'],
      tools: [files('telnet')],
      goals: [
        {
          id: 'follow-telnet',
          label: 'Follow the Telnet stream',
          hint: 'Filter to telnet, open a packet, and press Follow TCP Stream.',
          check: followed(FILES.telnet, (fs: FileFrame[]) => fs.some((c) => port(c.frame, 23))),
        },
      ],
      questions: [
        {
          id: 'password',
          kind: 'text',
          short: true,
          prompt: 'What password did they type?',
          placeholder: 'The password, exactly',
          expect: /\S/,
          expectHint: 'Type the password from the stream.',
          verify: (v) => (v.trim() === TELNET_PASSWORD ? undefined : v.trim().toLowerCase() === TELNET_PASSWORD.toLowerCase() ? 'Close. Passwords care about capital letters.' : 'Read what the client sends after “Password:”.'),
          explain: 'Anyone on the mirror port, or anyone who floods the switch, can read it. SSH does the same job with encryption, so a capture shows only scrambled bytes.',
        },
      ],
    },
  ],
};
