import { evaluate } from '../../sim/firewall';
import { payloadLen } from '../../sim/tcp';
import { loadCaptureFile, parsePacketList, type FileFrame } from '../../sim/capfile';
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
/** The text a service packet carries (an HTTP reply's headers and body). */
const svcText = (f: Frame) => (f.ip?.app.kind === 'svc' ? (f.ip.app.text ?? '') : '');
const port = (f: Frame, p: number) => f.ip?.srcPort === p || f.ip?.dstPort === p;

/** The different commands (sleep, upload) in the 02:00 packets a student cites. */
function citedCommands(v: string): Set<string> {
  const p = parsePacketList(v);
  const out = new Set<string>();
  if (!p.ok) return out;
  const file = loadCaptureFile(FILES.night);
  for (const n of p.nums) {
    const cmd = /cmd=(\w+)/.exec(svcText(file.frames[n - 1]?.frame ?? ({} as Frame)))?.[1];
    if (cmd) out.add(cmd);
  }
  return out;
}

/** A cite question for the 02:00 commands that also wants two different ones, so following only sleep replies doesn't pass. */
function twoCommands(o: Parameters<typeof citeQuestion>[0]) {
  const q = citeQuestion(o);
  const fits = q.verify!;
  return {
    ...q,
    verify: (v: string, answer: Parameters<typeof fits>[1]) =>
      fits(v, answer) ?? (citedCommands(v).size < 2 ? 'Every packet here gives the same command. Follow more check-ins: one reply gives a different command.' : undefined),
  };
}

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

const floodTripped = (sim: Sim, since: number) =>
  happened(sim, since, (e) => e.type === 'port-security' && e.device === 'switch' && e.iface === BREAKROOM_PORT);
// A second replay finds port 7 already shut: the frames drop at the port and port security has nothing new to say.
const floodHitShutPort = (sim: Sim, since: number) =>
  happened(sim, since, (e) => e.type === 'drop' && e.device === 'switch' && e.reason === 'port-shutdown' && !!e.frame?.burst);
const floodBlocked = (sim: Sim, since: number) => floodTripped(sim, since) || floodHitShutPort(sim, since);
// Only a check-in stopped at its first SYN counts: a stateless firewall also denies the rest of one that
// already got through when the rule moves up partway, and that check-in reached 192.0.2.44.
const checkinBlocked = (sim: Sim, since: number) =>
  happened(sim, since, (e) => e.type === 'firewall' && e.device === 'gw' && e.verdict.action === 'deny' && e.pkt.dst === IP.c2 && !!e.pkt.tcp?.flags.syn && !e.pkt.tcp.flags.ack);
const checkinOpened = (sim: Sim, since: number) => happened(sim, since, (e) => e.type === 'tcp' && e.what === 'open' && e.session.serverIp === IP.c2);

const replayFloodAction: ActionDef = {
  id: 'replay-flood',
  label: 'Replay the 14:00 flood',
  run: replayFlood,
  outcome(sim, since): ActionLine[] {
    if (floodTripped(sim, since)) return [{ tone: 'good', text: 'Port security shut port 7 at the first made-up MAC. The flood stopped at the switch.' }];
    if (floodHitShutPort(sim, since)) return [{ tone: 'good', text: 'Port 7 is still shut from your last replay, so the flood stopped at the switch again.' }];
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
  version: 3,
  title: 'Finding Attacks in Packet Captures',
  tagline: 'Open a day of packet captures from a bus depot, tell attacks from an outage and a false alarm, and cite the packets that prove each attack.',
  unit: 3,
  codehs: ['3.18 The Story in the Logs'],
  ced: ['3.5.E', '3.5.D', '3.1.C'],
  minutes: 60,
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
        You are the new security analyst for **Valley Transit**, the city's bus company. [[gw]] connects the depot to the internet. Inside are two dispatch computers, the [[fares]] that takes card payments from three ticket kiosks, a [[cams]] for the security cameras, and a [[backup]].

        Night shift left you a ticket:

        > Network was weird all day. Kiosks failed in the morning, things were slow at lunch, and the camera recorder was talking to something at 2 a.m. Threat intel says to watch for these addresses: 192.0.2.44, 198.18.5.9, 203.0.113.250.

        **Threat intel** is a list of addresses other analysts have seen in attacks. Everything in this lab happens inside a simulation. Capturing other people's traffic without permission, or attacking a network, is illegal.

        [[switch]] has a **mirror port**: it sends a copy of every frame out one port, where [[analyst]] is plugged in. Each hour the laptop saved a one-minute **capture file**, a recording of packets you open later, like a .pcap file in Wireshark.

        1. Click [[switch]]. **Mirror port** is below its port tables.
        2. Open the **Capture** tab. It shows **07:00 depot.pcap**, a normal morning. The **No.** column numbers every packet, and **Time** counts seconds from the start of the file.
        3. Press **Endpoints: IPv4**. It lists every IP address, with how many packets it sent and received, busiest first. **Bytes** counts how much data, so it can rank addresses in a different order.

        A normal hour is the depot's **baseline**: once you know it, anything new stands out. (203.0.113.10 is the bus-tracking map service on the internet, which dispatch checks all day.)
      `,
      focus: ['switch', 'analyst'],
      tools: [files('morning')],
      goals: [
        { id: 'mirror', label: 'Click [[switch]]', hint: 'Click the Depot switch on the map. Mirror port is below its port tables.', check: inspected('switch') },
        { id: 'open-file', label: 'Open **07:00 depot.pcap** in the Capture tab', hint: 'Click the Capture tab under the map.', check: openedCapfile('morning') },
        { id: 'endpoints', label: 'Open **Endpoints: IPv4** for 07:00', hint: 'The Statistics buttons are at the top of the Capture tab.', check: sawStats('morning', 'endpoints-ip') },
      ],
      questions: [
        {
          id: 'top-talker',
          kind: 'choice',
          prompt: 'Which address sends and receives the most packets in the 07:00 file?',
          options: [
            { id: 'fares', text: '198.51.100.20, the fare server', correct: true },
            { id: 'maps', text: '203.0.113.10, the map service', feedback: 'It comes second. Sort Endpoints by Packets and read the top row.' },
            { id: 'dispatch', text: '198.51.100.11, Dispatch 1', feedback: 'Dispatch 1 only checks the bus map. Sort Endpoints by Packets and read the top row.' },
            { id: 'cams', text: '198.51.100.40, the camera recorder', feedback: 'The recorder isn’t in this file at all. Remember that for later.' },
          ],
          explain: 'Every kiosk payment is a conversation with the fare server, so it tops a normal hour. The camera recorder doesn’t show up at all: the cameras are wired straight to it, so it has no reason to send anything across the depot switch.',
        },
      ],
    },

    {
      id: 'outage',
      title: 'Kiosks can’t take cards',
      body: md`
        At 08:00 the kiosks stopped taking cards. Pick **08:00 depot.pcap** from the file menu at the top of the Capture tab (press the file name).

        Every TCP connection starts with a **three-way handshake**. Each step is marked by **flags**, on and off switches in the TCP header. The Info column lists them in brackets, like [SYN] or [RST, ACK]:

        - **SYN** (synchronize): "Can I connect to this port?"
        - **SYN, ACK**: "Yes." The port is open.
        - **ACK** (acknowledge): "OK." Now data can flow.
        - **RST** (reset): "No." Nothing is listening on that port, so the connection is refused. A refusal has ACK on too, so it reads [RST, ACK]. (Either side can also send an RST to end a connection, and some firewalls send them.)

        Type this display filter and press Enter:

        \`tcp.flags.reset == 1\`

        It shows only packets with the RST flag on. Read the Source column: who is saying no? Then clear the filter and look at what comes right before a reset.

        A packet keeps its number when a filter hides other rows, so analysts **cite** packets by number: they list the numbers in a report as proof.
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
          explain: 'Each kiosk SYN to port 443 gets an RST, ACK from 198.51.100.20 less than a millisecond later.',
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
              feedback: 'Count them: each kiosk sends one SYN every three seconds as it retries, 20 in the whole minute. A flood would be thousands.',
            },
            {
              id: 'unplugged',
              text: 'No. The kiosks are unplugged from the switch, so their payments never arrive.',
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
        Staff said the network was slow at lunch. **12:00 depot.pcap** is open. Press **I/O Graph**: a bar for each second, as tall as the number of packets in it.

        There are two spikes. Start with the first, at about 14 to 24 seconds. Filter to ICMP, the protocol ping uses:

        \`icmp\`

        The matching packets turn darker on the graph, so you can see the filter covers the spike. An **echo request** is a ping, and an **echo reply** answers it. To list only the requests, filter \`icmp.type == 8\`.

        The requests go to 198.51.100.255, the depot's **broadcast address**, so every depot computer gets a copy. Each one sends its echo reply to the address in the request's Source column, so whoever has that address gets all the replies.

        Pings sent to a broadcast address like this are a **smurf attack**, named after an old program that sent them. It works because the depot's old router has **directed broadcast** on: a setting that lets pings from the internet reach the broadcast address. Turning it off stops this.

        Now read the Source. Anyone who builds a packet can write any address there. Faking it is called **spoofing**, and the fake address is **forged**.
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
          explain: 'Each request goes to 198.51.100.255 and says it comes from 203.0.113.77. Nine echo replies follow it, one from each depot computer.',
        }),
        {
          id: 'forged',
          kind: 'choice',
          prompt: 'The echo requests say they come from 203.0.113.77. Is that the attacker?',
          options: [
            { id: 'victim', text: 'No. It’s the victim, and its address was forged.', correct: true },
            {
              id: 'source',
              text: 'Yes. The Source column always shows who sent a packet.',
              feedback: 'Anyone who builds a packet can write any source address into it. Follow the replies: they all go to 203.0.113.77, which only hurts it.',
            },
            { id: 'router', text: 'No. It’s the depot router checking that computers are up.', feedback: 'The router is 198.51.100.1. 203.0.113.77 is outside the depot.' },
            {
              id: 'kiosks',
              text: 'Yes. It is trying to shut down the depot’s kiosks.',
              feedback: 'Each ping that reaches the depot turns into nine replies, all sent to 203.0.113.77. Who gets the most traffic?',
            },
          ],
          explain:
            'In a smurf attack, the victim’s address is forged as the source. Every computer replies to the victim, so one packet becomes nine. The depot was the **amplifier**, the network that multiplied the attack, and its slow lunch was a side effect. Modern routers turn directed broadcast off by default, and most computers ignore broadcast pings, but this old router and its computers don’t.',
        },
      ],
    },

    {
      id: 'backup',
      title: 'Slow at lunch: the second spike',
      body: md`
        Now the second spike, at about 38 to 47 seconds. Open **Conversations**: it lists each pair of addresses that talked, busiest first.

        The top pair is the fare server and the backup server, 198.51.100.20 and 198.51.100.50. Press **Filter** on that row to show only their packets, and read a few. They use port 873, **rsync**: the program the depot uses for backups. It copies files from one computer to another.

        A detector watches traffic and raises an alert when something looks wrong. **Positive** means it raised an alert, and **negative** means it didn't. **True** means the detector was right about whether there was an attack, and **false** means it was wrong:

        - **True positive**: an alert, and a real attack.
        - **False positive**: an alert, but the traffic was harmless.
        - **False negative**: a real attack, and no alert.
        - **True negative**: harmless traffic, and no alert.
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
          id: 'false-alarm',
          kind: 'choice',
          prompt: 'A detector raised a “traffic spike” alert for this second spike, at 12:00:38. What kind of alert is that?',
          options: [
            { id: 'fp', text: 'A false positive', correct: true },
            { id: 'tp', text: 'A true positive', feedback: 'A true positive needs a real attack. This spike is two depot servers on the backup program’s port.' },
            { id: 'fn', text: 'A false negative', feedback: 'A false negative is an attack with no alert. Here there was an alert and no attack.' },
            { id: 'tn', text: 'A true negative', feedback: 'A true negative is no alert for harmless traffic. Here the detector did alert.' },
          ],
          explain:
            'The fare server, the backup server, rsync’s port, and a steady stream of full-size packets: this is a backup, not an attack. The depot schedules its backups for the night, so someone probably started this one by hand. That’s worth a question to whoever runs the servers, but it’s still not an attack. A spike alone doesn’t prove an attack, so this alert is a **false positive**. Too many of them, and analysts start ignoring alerts. (rsync on port 873 doesn’t encrypt what it copies. That’s a weakness worth fixing, but it isn’t an attack.)',
        },
      ],
    },

    {
      id: 'arp',
      title: 'One MAC, two addresses',
      body: md`
        **13:00 depot.pcap** is open. Filter to ARP replies (opcode 2 is a reply, and 1 is a request):

        \`arp.opcode == 2\`

        A **MAC address** is the hardware name of a network card, like 08:00:27:4c:9d:e2. An IP address is where a device sits on the network. An **ARP reply** connects the two: it tells a computer "this IP address is at this MAC address." The Info column shows each claim, and the Source column shows the MAC that sent it. Open a reply to read its whole **Claim** in the ARP layer.

        The router is 198.51.100.1. Click [[gw]] to see its real MAC address. Do all the replies agree with it? Write down a MAC that doesn't match. To find whose it is, read the router's **ARP table**, at the bottom of its Inspect panel: its list of which IP is at which MAC, with each device's name. Many MACs here start with the same numbers, so compare the last part.

        A computer believes any ARP reply, unless its entry for the router was typed in by hand. That is a **static ARP entry**, and no reply can change it.
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
          explain: `Each one says 198.51.100.1 is at ${MAC.breakroom}. The router’s real MAC is ${MAC.gw}.`,
        }),
        {
          id: 'whose-mac',
          kind: 'choice',
          prompt: 'Which device sent the forged replies?',
          options: [
            { id: 'breakroom', text: 'The Break-room PC', correct: true },
            { id: 'router', text: 'The Depot router', feedback: `The router’s MAC is ${MAC.gw}. The forged replies only claim its IP address.` },
            { id: 'dispatch2', text: 'Dispatch 2', feedback: 'Dispatch 2 is a victim: the replies are sent to it. Compare the last part of the MAC with the router’s ARP table.' },
            { id: 'analyst', text: 'The Analyst laptop', feedback: 'The analyst laptop only listens on the mirror port. Compare the last part of the MAC with the router’s ARP table.' },
          ],
          explain:
            'This is **ARP poisoning**. The Break-room PC tells both dispatch computers that the router’s IP is at its own MAC. Their internet traffic now goes to the Break-room PC first, which passes it on: an on-path attack. It can see who dispatch talks to and when, and read anything that isn’t encrypted. A static ARP entry for the router on each dispatch computer would stop it.',
        },
      ],
    },

    {
      id: 'flood',
      title: 'Thousands of MACs in ten seconds',
      body: md`
        A switch keeps a **MAC address table**: which MAC is on which port, so it can send each frame out one port only. The table has room for only so many MACs. When it's full, the switch can't learn new ones. It sends each frame it can't place out every port, like a **hub** (an old device that repeats everything to everyone).

        **14:00 depot.pcap** is open. Open **Endpoints: Ethernet**, which lists every MAC address in the file. A depot this size has about ten. How many does this file have? The count is above the table.

        Open the **I/O Graph** and click a bar in the spike. The **Packet list** opens at that second. Open a few frames there. Each is an Ethernet frame with nothing inside, from a different made-up MAC. (Click a row, then the arrow keys move up and down.)
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
          minText: 'ten of the flood’s frames',
          // A range across the flood picks up a few ordinary packets sent in the same seconds. They don't count either way.
          skip: (c) => !isFloodFrame(c.frame) && c.t >= 20_000 && c.t <= 30_500 && 'is ordinary depot traffic sent during the flood, so it doesn’t count.',
          fits: (c) => (isFloodFrame(c.frame) ? true : 'is ordinary depot traffic from before or after the flood.'),
          explain: 'If a range you cite includes a few ordinary packets sent in the same seconds, they don’t count for or against you. In a real report, say so, or list only the flood’s frames.',
        }),
        {
          id: 'mac-table',
          kind: 'choice',
          prompt: 'What did the flood do to the depot switch’s MAC address table?',
          options: [
            { id: 'filled', text: 'It filled the table with made-up MACs, so frames went out every port.', correct: true },
            { id: 'erased', text: 'It erased the table, and the switch turned itself off.', feedback: 'A full table doesn’t turn a switch off. The switch stops learning, and frames for unknown MACs go out every port.' },
            { id: 'ignored', text: 'Nothing. A switch ignores frames that have no IP packet inside.', feedback: 'A switch reads only the Ethernet header. It learns every new source MAC, whatever is inside.' },
            { id: 'shut', text: 'It made the switch shut off the port the frames came in on.', feedback: 'Only port security shuts a port, and it was off at 14:00.' },
          ],
          explain:
            'This is **MAC flooding**. With its table full, the switch sends frames for MACs it hasn’t learned out every port, like a hub. Anyone can then capture traffic meant for other ports. The capture can’t show which port the frames came in on, since the made-up MACs belong to no one. The switch’s MAC table did: at 14:00 it filled up with made-up MACs, all on port 7, the Break-room PC’s port. (A switch deletes a MAC it hasn’t heard from in a while, so those entries are gone now.) **Port security** on port 7, which limits how many MACs one port may use, would have stopped it.',
        },
      ],
    },

    {
      id: 'scan',
      title: 'One address, a thousand ports',
      body: md`
        **15:00 depot.pcap** is open. Open **Conversations** and click the **Ports** heading to sort by it: the number of different ports one side used. Most conversations use a few. One uses more than a thousand.

        Filter to connection attempts:

        \`tcp.flags.syn == 1\`

        One outside address sends a SYN to port 1 on the fare server, then port 2, then 3, and on up. This is a **port scan**: the scanner tries port after port to learn which ones are open. A closed port answers RST. An open port answers SYN, ACK, and the scanner ends it with RST before the handshake finishes.

        (Real scanners like nmap try ports in a random order. This one goes in order, so the pattern is clear.) The scanner isn't on the threat list. A threat list only names attackers someone has already seen.

        To find the open ports, show only packets with both flags on. \`&&\` means "and": a packet has to match every part. Normal kiosk connections have SYN, ACK packets too, so also match the scanner's address. Copy this filter, then type the scanner's address at the end:

        \`\`\`
        tcp.flags.syn == 1 && tcp.flags.ack == 1
        && ip.addr ==
        \`\`\`
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
            '203.0.113.66 sent 1,024 SYNs in about six seconds. Two SYN, ACKs go back to it: from port 443, the fare program, and port 873, rsync. Now the scanner knows where to aim next. A scan is **reconnaissance**: an attacker making a map of targets before attacking them. Nobody approved this one, so it goes in your report as an attack, even though nothing else came from 203.0.113.66. (rsync open to the internet is a problem of its own, since it doesn’t encrypt.)',
        }),
      ],
    },

    {
      id: 'c2',
      title: 'Wrong port, wrong program',
      body: md`
        **02:00 depot.pcap** is open. It's from early this morning, when nobody works at the depot. Open **Conversations**. One pair is the nightly backup. The other is [[cams]] talking to an outside address on port 4444. Compare that address with the threat list in the ticket:

        > 192.0.2.44, 198.18.5.9, 203.0.113.250

        The recorder makes a **check-in** every ten seconds: a new connection that asks the server for orders. Filter to the check-ins:

        \`tcp.port == 4444 && http\`

        Click one and press **Follow TCP Stream**. It puts one connection in order: what the recorder sent in one color, and what came back in another. Each check-in has its own stream. Follow them until you find two different commands. A reply with a different Length is a good one to try.

        Web traffic normally uses port 80 (HTTP) or 443 (HTTPS). Port 4444 is the default for a well-known attack tool. A known bad address and a program on the wrong port are both **indicators of compromise** (IoCs). Here "compromised" means broken into: an IoC is evidence in traffic or logs that an attack happened.
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
        twoCommands({
          id: 'cite-commands',
          prompt: 'Cite two packets where the outside server sends the recorder two different commands.',
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
                  : !svcText(f).includes('cmd=')
                    ? 'is the server confirming the upload, not a command. A command reply has cmd= in it.'
                    : true,
          explain:
            'The recorder checks in every ten seconds and asks for orders: this is **command and control** (C2) traffic. Most replies said `sleep 10`: wait ten seconds, then check in again. One said to upload a garage camera video, and the next connection sent it. A firewall rule on the router that denies traffic out to 192.0.2.44 would cut it off, but the recorder still needs to be erased and set up again.',
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

        The **CIA triad** names what security protects: **confidentiality** (only the right people can see data), **integrity** (data isn't changed without permission), and **availability** (systems work when people need them).

        The capture files are still in the Capture tab if you want to check your evidence. Answer these for your report.
      `,
      tools: [files('outage', 'noon', 'arp', 'flood', 'scan', 'night')],
      questions: [
        {
          id: 'attacks',
          kind: 'choice',
          multi: true,
          prompt: 'Which findings are attacks? Choose every one. An attack still counts if the depot wasn’t its target, or if nothing broke.',
          options: [
            { id: 'rst', text: '08:00: RSTs from the fare server', feedback: 'The fare program crashed. That’s an outage.' },
            { id: 'smurf', text: '12:00: pings to the broadcast address', correct: true },
            { id: 'rsync', text: '12:00: the rsync burst', feedback: 'That was the backup. Its alert was a false positive.' },
            { id: 'arp', text: '13:00: the forged ARP replies', correct: true },
            { id: 'flood', text: '14:00: the made-up MACs', correct: true },
            { id: 'scan', text: '15:00: the SYNs to 1,024 ports', correct: true },
            { id: 'c2', text: '02:00: the recorder’s HTTP to 192.0.2.44', correct: true },
          ],
          explain: 'Five attacks: a smurf, ARP poisoning, a MAC flood, a port scan (reconnaissance), and C2 traffic. The outage and the backup are on the list too, marked “not an attack,” so nobody wastes time on them again.',
        },
        {
          id: 'cia-c2',
          kind: 'choice',
          prompt: 'The recorder uploaded a garage camera video to 192.0.2.44. Which part of the CIA triad did that harm most?',
          options: [
            { id: 'c', text: 'Confidentiality', correct: true },
            { id: 'i', text: 'Integrity', feedback: 'The video wasn’t changed. Someone outside got a copy they shouldn’t have.' },
            { id: 'a', text: 'Availability', feedback: 'The recorder still records. The harm is who can now see the video.' },
          ],
          explain: 'The video wasn’t changed, and the recorder still records, even though it now takes orders from outside. Someone outside the depot got a copy of footage they shouldn’t see: a loss of confidentiality.',
        },
        {
          id: 'fix-smurf',
          kind: 'choice',
          prompt: 'Which change stops the depot being used in the next smurf attack?',
          options: [
            { id: 'directed', text: 'Turn off directed broadcast on the depot router.', correct: true },
            { id: 'victim', text: 'Block 203.0.113.77, the address in the pings, at the router.', feedback: 'That’s the victim. The next attack will forge some other victim’s address.' },
            { id: 'port-sec', text: 'Turn on port security on every port of the depot switch.', feedback: 'Port security limits MACs on a switch port. The pings came in from the internet, through the router.' },
            { id: 'one-host', text: 'Turn off ping replies on the fare server.', feedback: 'Nine computers answered. One fewer still leaves eight replies per ping.' },
          ],
          explain: 'With directed broadcast off, the router drops pings from outside aimed at 198.51.100.255, so nobody inside answers them.',
        },
        {
          id: 'fix-arp',
          kind: 'choice',
          prompt: 'Which change protects dispatch from the 13:00 ARP poisoning?',
          options: [
            { id: 'static', text: 'A static ARP entry for the router on each dispatch computer.', correct: true },
            { id: 'block-gw', text: 'A firewall rule on the router blocking 198.51.100.1.', feedback: 'That’s the router itself. Blocking it cuts dispatch off from the internet.' },
            { id: 'encrypt', text: 'Turning on encryption for all ARP replies.', feedback: 'ARP has no encryption to turn on. A computer believes any reply unless its entry is fixed.' },
            { id: 'mirror', text: 'Moving the analyst laptop off the mirror port.', feedback: 'The analyst laptop only listens. The forged replies come from the Break-room PC.' },
          ],
          explain: 'A static entry can’t be changed by a reply, forged or not. On a bigger network, a switch feature called Dynamic ARP Inspection checks replies for every port.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Write it up',
      body: md`
        Write the summary for your shift lead, the person in charge of your shift. Your packet numbers are in the earlier steps, and the capture files are in the Capture tab.
      `,
      tools: [files('outage', 'noon', 'arp', 'flood', 'scan', 'night')],
      questions: [
        {
          id: 'writeup',
          kind: 'text',
          prompt:
            'Pick one attack you found today.\n\n- Name it.\n- Cite the packet numbers that prove it.\n- Say what in those packets shows the attack.\n- Explain why a capture is stronger evidence than a staff member saying “the network was slow.”',
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
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.
      `,
    },

    {
      id: 'fix',
      title: 'Optional extra challenge: fix it and capture again',
      extra: true,
      body: md`
        Two of the attacks can be stopped right here, on the live depot network. **Port security** limits how many MACs one switch port may use.

        1. **The MAC flood.** Click [[switch]]. In **Ports and port security**, press **Edit** on **port 7**, the [[breakroom]]'s port. Then:
           - Turn port security on with its switch, not the **Shut port down** button.
           - Keep **Most MACs** at 1.
           - Keep **If another MAC shows up** on **Shut the port down**.
           - Press **Save port 7**.
        2. **The C2 traffic.** Click [[gw]] and press **Add a rule**. Pick **DENY**, **out**, and **any protocol**. Type 192.0.2.44 in the **to** address box. Leave the other boxes as **any**, and press **Add rule**.
        3. The router checks its rules from the top. Use the arrows to move your rule above **Depot to the internet**, the ALLOW out rule.
        4. Press **Start** in the Capture tab to capture live on [[analyst]]. Then press each button below and watch what happens. Each button replays a short sample of that attack.

        If port security stops the flood, the capture stays empty: the frames never get past port 7. The check-in is different. The capture still shows the recorder's first SYN, because the switch copies it to the mirror port before the router drops it.

        (The in rule, **Lets everything in**, is how the 15:00 scan reached the fare server. Closing it is a job for another lab.)
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
            { id: 'first', text: 'The router uses the first rule that matches.', correct: true },
            { id: 'newest', text: 'The router only reads the newest rule.', feedback: 'The router reads from the top, whatever order the rules were added in.' },
            { id: 'deny-last', text: 'Deny rules only work at the top of a list.', feedback: 'A deny rule works anywhere. It has to come before any rule that would allow the same packet.' },
            { id: 'cosmetic', text: 'It doesn’t matter. The order is only how they’re shown.', feedback: 'Try it: below allow out, the check-in matches allow first and goes through.' },
          ],
          explain: 'Allow out matches the check-in too. The router stops at the first rule that matches, so a deny rule below allow out never gets checked.',
        },
      ],
    },

    {
      id: 'telnet',
      title: 'Optional extra challenge: a password in plain text',
      extra: true,
      body: md`
        At 16:00 someone signed in to [[gw]] with **Telnet**, an old remote sign-in program that sends everything as plain text, passwords included.

        **16:00 depot.pcap** is open. Filter to \`telnet\`, open a packet, and follow its TCP stream. (Real Telnet sends each key press in its own packet. This file puts each line in one, to keep it short.)
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
          explain: 'Anyone on the mirror port, or anyone who floods the switch, can read it. SSH is a program that does the same job with encryption, so a capture of it shows only scrambled bytes.',
        },
      ],
    },
  ],
};
