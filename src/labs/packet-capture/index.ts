import { capturedAfter } from '../../sim/capture';
import { matchFilter, parseFilter } from '../../sim/displayFilter';
import type { Sim } from '../../sim/sim';
import type { Frame } from '../../sim/types';
import { capturedSince, filtered, inspected, openedFrame } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, CheckCtx, LabDef, MapZone, ToolSpec } from '../types';
import {
  busyMinute,
  buildCapture,
  captured,
  capturedThrough,
  capturing,
  CHAT_CHECKS,
  ensureBusyCapture,
  ensurePageCapture,
  HOMEWORK,
  IP,
  is,
  isChat,
  isHomeworkGet,
  isHomeworkPage,
  isPhoneDhcp,
  isRouterArpReply,
  isRouterPingReply,
  isSchoolDnsAnswer,
  isTvArp,
  isVideoTls,
  isWeatherPage,
  lastSince,
  MAC,
  openSchool,
  openVideo,
  phoneRejoins,
  readyToStart,
  run,
  showSince,
  startedSince,
  tvShow,
  VIDEO_PIECES,
} from './scenario';

// ---------------------------------------------------------------------------
// Lesson buttons and the lines under them
// ---------------------------------------------------------------------------

/** A warning when the capture wasn't running as the button was pressed. */
function offLine(sim: Sim, since: number, label: string): ActionLine[] {
  if (capturedThrough(sim, since, since)) return [];
  return [{ tone: 'bad', text: `The capture was off, so it recorded none of this. Press Start, then press ${label} again.` }];
}

const packets = (n: number) => `${n} packet${n === 1 ? '' : 's'}`;

/** "Loading…", then whether the laptop's page loaded and how many packets the capture got. */
const pageLines =
  (label: string, what: string) =>
  (sim: Sim, since: number): ActionLine[] => {
    const b = sim.dev('laptop').browser;
    if (!b || b.startedAt < since) return [];
    const off = offLine(sim, since, label);
    if (b.status === 'resolving' || b.status === 'loading') return [...off, { tone: 'wait', text: `Loading ${what}…` }];
    if (b.status !== 'loaded') return [...off, { tone: 'bad', text: b.error ?? "The page didn't load." }];
    if (off.length) return [{ tone: 'good', text: `${what[0].toUpperCase()}${what.slice(1)} loaded.` }, ...off];
    const n = capturedAfter(sim.dev('laptop'), since).length;
    return [{ tone: 'good', text: `${what[0].toUpperCase()}${what.slice(1)} loaded. The capture recorded ${packets(n)} for it.` }];
  };

const SCHOOL_LABEL = 'Open the school website';
const openSchoolButton: ActionDef = {
  id: 'open-school',
  label: SCHOOL_LABEL,
  run: openSchool,
  outcome: pageLines(SCHOOL_LABEL, 'the homework page'),
};

const VIDEO_LABEL = 'Open the video site';
const openVideoButton: ActionDef = {
  id: 'open-video',
  label: VIDEO_LABEL,
  run: openVideo,
  outcome: pageLines(VIDEO_LABEL, 'the video site'),
};

const PHONE_LABEL = 'The phone rejoins the Wi-Fi';
const phoneButton: ActionDef = {
  id: 'phone-rejoins',
  label: PHONE_LABEL,
  run: phoneRejoins,
  outcome: (sim, since) => {
    const off = offLine(sim, since, PHONE_LABEL);
    const ack = lastSince(sim, since, 'dhcp', (e) => e.what === 'ack' && e.client === 'phone' && !e.quiet);
    if (ack) return [{ tone: 'good', text: `The phone got its address, ${ack.ip}, again.` }, ...off];
    if (lastSince(sim, since, 'wifi', (e) => e.what === 'join' && e.client === 'phone')) return [...off, { tone: 'wait', text: 'The phone is back and asking for an address…' }];
    return [...off, { tone: 'wait', text: 'The phone left the Wi-Fi…' }];
  },
};

const BUSY_LABEL = 'Leave the laptop alone for a minute';
/** Every answer the laptop's apps get in the busy minute: chat, video, weather, and the school page. */
const BUSY_ANSWERS = CHAT_CHECKS + VIDEO_PIECES + 2;
const busyButton: ActionDef = {
  id: 'busy-minute',
  label: BUSY_LABEL,
  run: busyMinute,
  outcome: (sim, since) => {
    const off = offLine(sim, since, BUSY_LABEL);
    if (off.length) return off;
    const mine = capturedAfter(sim.dev('laptop'), since);
    const answers = mine.filter((c) => c.frame.ip?.app.kind === 'http-res' && c.frame.ip.dst === IP.laptop).length;
    if (answers >= BUSY_ANSWERS) return [{ tone: 'good', text: `The minute is over. The capture recorded ${packets(mine.length)}.` }];
    if (!capturing(sim)) return [{ tone: 'bad', text: `The capture stopped before the minute was over, with ${packets(mine.length)}. Press Start, then press ${BUSY_LABEL} again.` }];
    return [{ tone: 'wait', text: `The laptop's apps are at work: ${packets(mine.length)} so far…` }];
  },
};

const TV_LABEL = 'The TV plays a show';
const tvButton: ActionDef = {
  id: 'tv-show',
  label: TV_LABEL,
  run: tvShow,
  outcome: (sim, since) => {
    const off = offLine(sim, since, TV_LABEL);
    const c = showSince(sim, since);
    if (c?.status === 'open') return [{ tone: 'good', text: 'The TV is playing the show.' }, ...off];
    if (c && c.status !== 'pending') return [{ tone: 'bad', text: "The show didn't load." }, ...off];
    return [...off, { tone: 'wait', text: 'The TV is loading the show…' }];
  },
};

// ---------------------------------------------------------------------------
// Map zones
// ---------------------------------------------------------------------------

function zones(): MapZone[] {
  return [
    { id: 'home', shape: { kind: 'rect', x: 165, y: 35, w: 535, h: 490 }, label: "The Nguyens' home", tone: 'neutral' },
    { id: 'box', shape: { kind: 'rect', x: 265, y: 215, w: 395, h: 182 }, label: 'Wi-Fi router (one box)', tone: 'info' },
    { id: 'internet', shape: { kind: 'rect', x: 740, y: 35, w: 470, h: 500 }, label: 'The internet', tone: 'neutral', dashed: true },
  ];
}

// ---------------------------------------------------------------------------
// Tools and goal checks
// ---------------------------------------------------------------------------

const CAPTURE: ToolSpec = { kind: 'capture', device: 'laptop' };
const FILTER: ToolSpec = { kind: 'capture', device: 'laptop', filter: true };
const PING: ToolSpec = { kind: 'ping' };

const started = ({ sim, since }: CheckCtx) => startedSince(sim, since);
const startGoal = { id: 'start', label: 'Start a new capture on [[laptop]]', hint: 'Open the **Capture** tab and press **Start**.', check: started };

/** A packet the TV sends to the video site, and the same packet from the laptop: a filter for the TV's address shows the first and hides the second. */
const showPiece = (from: 'tv' | 'laptop'): Frame => ({
  id: -1,
  origin: from,
  src: MAC[from],
  dst: MAC.routerHome,
  ip: { src: IP[from], dst: IP.video, ttl: 64, proto: 'tcp', srcPort: 50000, dstPort: 443, encrypted: true, app: { kind: 'svc', conn: 0, app: 'https', reply: false } },
});
const TV_PIECE = showPiece('tv');
const LAPTOP_PIECE = showPiece('laptop');

/** The student filtered for the TV's packets: a filter that would show the TV's own traffic and not the laptop's. */
const filteredForTv = ({ ev }: CheckCtx): boolean => {
  if (ev?.type !== 'ui:filter' || ev.device !== 'laptop') return false;
  const p = parseFilter(ev.filter);
  return p.ok && !!p.node && matchFilter(p.node, TV_PIECE) && !matchFilter(p.node, LAPTOP_PIECE);
};

const filteredArp = filtered('laptop', (f) => !!f.arp);

export const packetCaptureLab: LabDef = {
  id: 'packet-capture',
  version: 1,
  title: "What's in a Packet?",
  tagline: "Capture the family laptop's traffic, open packets layer by layer, learn the common kinds, and use filters to find the packets you want, so Wireshark feels familiar.",
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves'],
  ced: ['3.1.A', '3.2.B'],
  minutes: 45,
  objectives: [
    'Start and stop a packet capture, and read its columns: number, time, source, destination, protocol, and info.',
    'Describe the layers of a packet (Ethernet, IP, TCP or UDP, and the message) and what each one does.',
    'Recognize ARP, DNS, HTTP, HTTPS (TLS), DHCP, and ping (ICMP) packets, and explain what an encrypted packet still shows.',
    'Use display filters to find packets, and explain what a capture on one computer can and cannot see.',
  ],
  build: buildCapture,
  map: { addresses: (d) => d.id !== 'isp', zones },
  labelMacs: true,
  hostRoutes: true,
  captureDevice: 'laptop',
  wireshark: true,
  steps: [
    {
      id: 'tour',
      title: 'Meet the capture',
      body: md`
        In lab 1 you set up the Nguyens' home network. Now you'll watch it work, one packet at a time.

        The family laptop's Wi-Fi light blinks all day, even when nobody is using it. What is it sending? To find out, you'll run a **packet capture** on [[laptop]]: a recording of every packet its network card sends or receives. Each line of a capture is one packet: when it went, where it came from, where it went, and what it carries.

        Network technicians use captures to find problems, and security analysts use them to spot attacks. The most common tool is **Wireshark**, a free program. In Part 2 of this lab you'll install it. Here, on a small, slow network, you'll learn to read a capture first, so Wireshark's busy window won't surprise you.

        A capture can show private things: the sites someone visits, and anything sent without encryption. Capture only on your own device, or with permission from the network's owner. Capturing other people's traffic without permission is illegal.

        On the map, the home is on the left and the internet is on the right. Out on the internet are five servers. One of them, [[dns]], turns names like school.example into addresses. You'll see why that matters in step 4.
      `,
      focus: ['laptop', 'dns'],
      goals: [
        { id: 'laptop', label: 'Open [[laptop]]', check: inspected('laptop') },
        { id: 'dns', label: 'Open [[dns]]', check: inspected('dns') },
      ],
      questions: [
        {
          id: 'records',
          kind: 'choice',
          prompt: 'What does a packet capture on the laptop record?',
          options: [
            { id: 'card', text: "Every packet the laptop's network card sends or receives", correct: true },
            { id: 'internet', text: 'Every packet on the whole internet', feedback: "A capture runs on one device. It records only what reaches that device's network card." },
            { id: 'pages', text: 'Only the web pages the laptop opens', feedback: "It records every kind of packet, not only web pages. You'll see six kinds in this lab." },
            { id: 'files', text: 'The passwords saved on the laptop', feedback: "A capture records packets on the network, not files on the computer. A password shows up only if it's sent without encryption." },
          ],
          explain: "Wireshark on your own computer records what your network card sends and receives. Step 10 shows what that leaves out.",
        },
      ],
    },

    {
      id: 'first-capture',
      title: 'Your first capture',
      body: md`
        A capture takes three moves: **Start**, do something on the network, **Stop**. Wireshark works the same way.

        1. In the **Capture** tab under the map, press **Start**.
        2. Press **Open the school website**. The laptop loads the homework page. Watch the packets on the map and the list filling up.
        3. When the page has loaded, press **Stop**.

        Each row in the list is one packet. The columns match Wireshark's:

        - **No.**: the packet's number, counting from 1.
        - **Time**: seconds since you pressed Start.
        - **Source** and **Destination**: where the packet came from and where it was going.
        - **Protocol**: the kind of packet. A **protocol** is a set of rules for one job, like getting a web page.
        - **Info**: a short summary of what's inside.

        Pressing **Start** again throws the old list away and starts a new one.
      `,
      focus: ['laptop', 'school'],
      open: 'capture',
      tools: [CAPTURE],
      actions: [openSchoolButton],
      goals: [
        startGoal,
        {
          id: 'page',
          label: 'Capture the homework page loading',
          hint: 'With the capture running, press **Open the school website**.',
          check: ({ sim, since }) => startedSince(sim, since) && captured(sim).some((c) => isHomeworkPage(c.frame)),
        },
        {
          id: 'stop',
          label: 'Stop the capture',
          hint: 'After the page loads, press **Stop** in the Capture tab.',
          check: ({ sim, since }) => startedSince(sim, since) && !capturing(sim) && captured(sim).some((c) => isHomeworkPage(c.frame)),
        },
      ],
      questions: [
        {
          id: 'how-many',
          kind: 'choice',
          prompt: 'How many packets did the laptop send and receive to load one page?',
          afterGoals: true,
          options: [
            { id: 'one', text: 'One: the page itself', feedback: 'Count the rows in your capture. The page is only the last one.' },
            { id: 'two', text: 'Two: a request and the page', feedback: 'Look above the GET request. The laptop sent and received other packets first.' },
            { id: 'six', text: 'Six, of three kinds', correct: true },
            { id: 'hundreds', text: 'More than a hundred', feedback: 'Your list is short. A real browser sends more than this, but not that many for one small page.' },
          ],
          explain: 'Six packets: two ARP, two DNS, and two HTTP. Step 4 explains why one page needs all three. (A real browser sends a few more, to open and close the connection. Wireshark shows those too.)',
        },
      ],
    },

    {
      id: 'layers',
      title: 'Open a packet',
      body: md`
        Click a packet in the list to open it. The right side shows its **layers**: one message wrapped inside another, like a letter in an envelope in a mailing box. Each layer does one part of the delivery.

        - **Ethernet**: the **MAC addresses** for this hop. It gets the packet to the next device on the local network.
        - **IP**: the **IP addresses** of the two ends. It gets the packet across networks, all the way there.
        - **TCP** or **UDP**: the **port numbers**. A port says which program should get the packet. Web servers listen on port 80.
        - The message itself: here, an **HTTP** request for a web page, or the page.

        Under each layer's title is Wireshark's name for it. Wireshark shows the same layers, top to bottom, under its packet list.

        Open the **GET /homework** packet (the request), then the **200 OK** packet (the page).
      `,
      setup: ensurePageCapture,
      focus: ['laptop', 'school'],
      open: 'capture',
      tools: [CAPTURE],
      actions: [openSchoolButton],
      goals: [
        {
          id: 'get',
          label: 'Open the GET /homework packet',
          hint: 'In the Capture tab, click the row whose Info says GET /homework.',
          check: openedFrame('laptop', isHomeworkGet),
        },
        {
          id: 'page',
          label: 'Open the 200 OK packet',
          hint: `Click the row whose Info starts with 200 OK. Its page title is "${HOMEWORK.title}".`,
          check: openedFrame('laptop', isHomeworkPage),
        },
      ],
      questions: [
        {
          id: 'program',
          kind: 'choice',
          prompt: "Which layer says which program on the school's server should get the request?",
          options: [
            { id: 'eth', text: 'Ethernet', feedback: "Ethernet's MAC addresses get the packet to the next device, not to a program." },
            { id: 'ip', text: 'IP', feedback: 'IP addresses pick the computer, not the program on it.' },
            { id: 'tcp', text: 'TCP', correct: true },
            { id: 'http', text: 'HTTP', feedback: "HTTP is the request itself: what the program reads, not how the packet finds the program." },
          ],
          explain: "TCP's To port, 80, means the web server program. Another program on the same server listens on a different port.",
        },
        {
          id: 'to-mac',
          kind: 'choice',
          prompt: "In the GET request, the To MAC is the router's, not the school website's. Why?",
          options: [
            { id: 'hop', text: 'Ethernet only carries a packet to the next device: the router', correct: true },
            { id: 'none', text: 'The school website has no MAC address', feedback: "Every network card has a MAC address. The school website's is far away, on another network." },
            { id: 'hide', text: "The router hides the school's MAC address to keep it private", feedback: "The router isn't hiding it. An Ethernet address only works on its own local network." },
            { id: 'wrong', text: 'The laptop put the wrong MAC address in it', feedback: "It's right on purpose. Look at the To IP: that's still the school website." },
          ],
          explain: 'The MAC addresses change at every hop. The IP addresses stay the same from one end to the other.',
        },
      ],
    },

    {
      id: 'page-story',
      title: 'One click, three kinds of packets',
      body: md`
        Read the whole list again, top to bottom. To load one page, the laptop did three jobs in order:

        1. **ARP** (Address Resolution Protocol): "Who has 192.168.1.1?" The laptop asks everyone on the home network for the router's MAC address, and [[router]] answers. The laptop needs that MAC address for the Ethernet layer.
        2. **DNS** (Domain Name System): the laptop asks [[dns]] for the IP address of school.example. DNS turns names into IP addresses, the way a contact list turns a name into a phone number.
        3. **HTTP** (Hypertext Transfer Protocol): the laptop asks [[school]] for the page, and the page comes back.

        Open the ARP reply and the DNS answer.

        (To keep the lesson clear, this laptop forgets the router's MAC address after every page. A real computer remembers it and its DNS answers for a while, so Wireshark won't show ARP and DNS before every page.)
      `,
      setup: ensurePageCapture,
      focus: ['laptop', 'router', 'dns', 'school'],
      open: 'capture',
      tools: [CAPTURE],
      actions: [openSchoolButton],
      goals: [
        {
          id: 'arp',
          label: 'Open the ARP reply from [[router]]',
          hint: 'Click the ARP row whose Info says 192.168.1.1 is at a MAC address.',
          check: openedFrame('laptop', isRouterArpReply),
        },
        {
          id: 'dns',
          label: 'Open the DNS answer for school.example',
          hint: 'Click the DNS row whose Info starts with Answer.',
          check: openedFrame('laptop', isSchoolDnsAnswer),
        },
      ],
      questions: [
        {
          id: 'order',
          kind: 'choice',
          prompt: 'Why does the DNS lookup come before the HTTP request?',
          options: [
            { id: 'address', text: "The laptop needs the school's IP address to send the request", correct: true },
            { id: 'safe', text: 'DNS checks that the page is safe to open', feedback: "DNS only turns names into addresses. It doesn't check pages." },
            { id: 'router', text: 'The router makes every device ask DNS first', feedback: 'The laptop asked on its own. It had a name, school.example, and needed an address.' },
            { id: 'slow', text: 'HTTP packets are slower, so they go last', feedback: "The order isn't about speed. The GET request needs a To IP, and DNS supplies it." },
          ],
          explain: 'The link said school.example, but packets need IP addresses. The DNS answer gave the address, and the GET request went there.',
        },
        {
          id: 'address',
          kind: 'text',
          prompt: 'What IP address did the DNS answer give for school.example?',
          expect: /\b192\.0\.2\.80\b/,
          expectHint: 'Open the DNS answer and read its IP address row.',
          explain: "192.0.2.80. The GET request's To IP is the same address.",
        },
      ],
    },

    {
      id: 'more-kinds',
      title: 'Packets with other jobs',
      body: md`
        Not every packet is about web pages. Two more kinds you'll see in Wireshark:

        - **DHCP** (Dynamic Host Configuration Protocol): a device that has joined a network asks for an IP address. Lab 1 showed the four messages.
        - **Ping**: a test message. One device asks "Are you there?" and the other answers. Wireshark calls ping packets **ICMP** (Internet Control Message Protocol).

        1. Press **Start** for a new capture.
        2. Press **The phone rejoins the Wi-Fi**.
        3. In the **Toolkit** tab, ping [[router]] (192.168.1.1) from [[laptop]].
        4. Open one of the phone's DHCP packets, and the router's ping reply.

        The capture shows only two of the phone's four DHCP messages: the two sent to everyone. The router sends the other two to the phone alone.
      `,
      setup: readyToStart,
      focus: ['laptop', 'phone', 'router'],
      open: 'capture',
      tools: [CAPTURE, PING],
      actions: [phoneButton],
      goals: [
        startGoal,
        {
          id: 'dhcp',
          label: "Open one of [[phone]]'s DHCP packets",
          hint: 'With the capture running, press **The phone rejoins the Wi-Fi**. Then click a DHCP row from 0.0.0.0.',
          check: openedFrame('laptop', isPhoneDhcp),
        },
        {
          id: 'ping',
          label: "Open [[router]]'s ping reply",
          hint: 'In the Toolkit tab, ping 192.168.1.1 from the laptop. Then click the PING row whose Info says reply.',
          check: openedFrame('laptop', isRouterPingReply),
        },
      ],
      questions: [
        {
          id: 'first-packet',
          kind: 'choice',
          prompt: 'A device that joins a network has no IP address yet. Which kind of packet does it send first?',
          options: [
            { id: 'dhcp', text: 'DHCP', correct: true },
            { id: 'dns', text: 'DNS', feedback: 'DNS turns names into addresses, and the device needs an address to send from first.' },
            { id: 'arp', text: 'ARP', feedback: "ARP asks for another device's MAC address. First the phone needs its own IP address." },
            { id: 'ping', text: 'Ping', feedback: 'A ping tests whether a device answers. It needs an address to send from.' },
          ],
          explain: `The phone's DHCP Discover came from 0.0.0.0, meaning "no address yet," and went to 255.255.255.255, meaning everyone on the network.`,
        },
      ],
    },

    {
      id: 'https',
      title: 'Locked packets',
      body: md`
        The school website uses plain HTTP, so anyone with a capture can read its pages. Most sites use **HTTPS** instead: HTTP inside **TLS** (Transport Layer Security). TLS **encrypts** the message, scrambling it so only the browser and the server can read it.

        1. Press **Start** for a new capture.
        2. Press **Open the video site**. It uses HTTPS.
        3. Open one of the HTTPS packets.

        The Protocol column says HTTPS. Wireshark says TLS for these packets, and its Info column says Application Data.
      `,
      setup: readyToStart,
      focus: ['laptop', 'video'],
      open: 'capture',
      tools: [CAPTURE],
      actions: [openVideoButton],
      goals: [
        startGoal,
        {
          id: 'captured',
          label: "Capture the video site's page",
          hint: 'With the capture running, press **Open the video site**.',
          check: ({ sim, since }) => startedSince(sim, since) && captured(sim).some((c) => isVideoTls(c.frame)),
        },
        {
          id: 'open',
          label: 'Open an HTTPS packet',
          hint: 'Click a row whose Protocol says HTTPS.',
          check: openedFrame('laptop', (f) => !!f.ip?.encrypted),
        },
      ],
      questions: [
        {
          id: 'still-see',
          kind: 'choice',
          prompt: 'The page is encrypted. What can someone with this capture still learn?',
          options: [
            { id: 'outside', text: "The site's name and address, but not the page", correct: true },
            { id: 'nothing', text: 'Nothing: the whole packet is scrambled', feedback: 'Look at the IP and TCP layers. Only the message inside them is locked.' },
            { id: 'title', text: "The video's title, but not the site's address", feedback: "That's backwards. The title is inside the locked part. The addresses are outside it." },
            { id: 'all', text: 'Everything, because a capture unlocks TLS', feedback: 'Without the keys, the message stays scrambled. Only the browser and the server have them.' },
          ],
          explain: "The addresses and ports stay readable so the network can deliver the packet. The DNS lookup wasn't encrypted either, so it shows the name video.example. The page itself stays locked.",
        },
        {
          id: 'port',
          kind: 'text',
          prompt: 'Which port number did the laptop send the HTTPS request to?',
          expect: /\b443\b/,
          expectHint: "Open the HTTPS packet the laptop sent and read the TCP layer's To port.",
          explain: 'Port 443 means HTTPS. Plain HTTP uses port 80.',
        },
      ],
    },

    {
      id: 'busy',
      title: 'A busy minute',
      body: md`
        Back to the blinking Wi-Fi light. Nobody is using the laptop, but its apps are working: the chat app checks for new messages, the video app loads the next video, the weather app gets today's forecast, and the browser reloads the homework page.

        1. Press **Start** for a new capture.
        2. Press **Leave the laptop alone for a minute**. (The lesson squeezes the minute into about 15 seconds.)
        3. Watch the list grow. When the button's line says the minute is over, press **Stop**.

        A real computer is far busier. In Wireshark, hundreds of packets a minute is normal. The next steps show how to find the few you care about.
      `,
      setup: readyToStart,
      focus: ['laptop'],
      open: 'capture',
      tools: [CAPTURE],
      actions: [busyButton],
      goals: [
        startGoal,
        {
          id: 'busy',
          label: 'Capture the busy minute: at least 40 packets',
          hint: 'With the capture running, press **Leave the laptop alone for a minute** and wait for it to finish.',
          check: ({ sim, since }) => startedSince(sim, since) && captured(sim).length >= 40 && captured(sim).some((c) => isWeatherPage(c.frame)),
        },
        {
          id: 'stop',
          label: 'Stop the capture',
          hint: 'Press **Stop** in the Capture tab.',
          check: ({ sim, since }) => startedSince(sim, since) && !capturing(sim) && captured(sim).length >= 40,
        },
      ],
      questions: [
        {
          id: 'why-busy',
          kind: 'choice',
          prompt: 'Nobody touched the laptop. Why did it send and receive so many packets?',
          options: [
            { id: 'apps', text: 'Its apps work in the background, without anyone clicking', correct: true },
            { id: 'remote', text: 'Someone else was using the laptop from far away', feedback: "Every packet went to a server the family's own apps use: chat, video, weather, and school." },
            { id: 'router', text: 'The router sends packets to every device all day', feedback: 'Most of these went between the laptop and servers on the internet, not from the router.' },
            { id: 'capture', text: 'The capture sends extra packets to fill the list', feedback: "A capture only records. It doesn't send anything." },
          ],
          explain: "Apps go online on their own, all day. That's why Wireshark fills up fast on a real computer, even when you aren't doing anything.",
        },
      ],
    },

    {
      id: 'filter',
      title: 'Filters',
      body: md`
        Scrolling through a busy capture is slow. A **display filter** hides every packet except the ones you ask for. Wireshark's filter bar sits right above its packet list, and so does this one now.

        Type a filter in the Capture tab's filter bar and press Enter:

        - \`dns\` shows only name lookups.
        - \`http\` shows only plain web traffic.

        The bar turns green when Wireshark would understand the filter, and red when it wouldn't. Press Enter on a red one to see what's wrong. Filters are lowercase.

        Filter \`dns\`, then \`http\`. Then open the weather service's answer and read it.

        A filter only hides packets. The capture still holds every one: clear the filter to see them all again. (If your list is empty, press **Start**, then **Leave the laptop alone for a minute**.)
      `,
      setup: ensureBusyCapture,
      focus: ['laptop', 'weather'],
      open: 'capture',
      tools: [FILTER],
      actions: [busyButton],
      goals: [
        { id: 'dns', label: 'Filter for name lookups', hint: 'Type `dns` in the filter bar and press Enter.', check: filtered('laptop', is('dns')) },
        { id: 'http', label: 'Filter for plain web traffic', hint: 'Type `http` in the filter bar and press Enter.', check: filtered('laptop', is('http')) },
        {
          id: 'weather',
          label: "Open [[weather]]'s answer",
          hint: 'With the `http` filter on, click the 200 OK row from 192.0.2.140.',
          check: openedFrame('laptop', isWeatherPage),
        },
      ],
      questions: [
        {
          id: 'names',
          kind: 'choice',
          multi: true,
          prompt: 'Which names did the laptop look up during the busy minute?',
          options: [
            { id: 'chat', text: 'chat.example', correct: true },
            { id: 'weather', text: 'weather.example', correct: true },
            { id: 'bank', text: 'bank.example', feedback: 'Nothing looked up bank.example. Filter dns and read the Info column.' },
            { id: 'video', text: 'video.example', correct: true },
            { id: 'school', text: 'school.example', correct: true },
            { id: 'games', text: 'games.example', feedback: 'Nothing looked up games.example. Filter dns and read the Info column.' },
          ],
          explain: 'The dns filter shows four questions and four answers. Each name belongs to an app or page the laptop used.',
        },
        {
          id: 'weather',
          kind: 'text',
          prompt: "What's today's weather, according to the weather service?",
          expect: /sunny|72/i,
          expectHint: "Open the 200 OK from the weather service and read the page text.",
          explain: "Sunny, with a high of 72°F. It's plain HTTP, so anyone capturing can read it too.",
        },
      ],
    },

    {
      id: 'address-filter',
      title: 'Follow one conversation',
      body: md`
        A filter can pick packets by address, too. In Wireshark:

        - \`ip.addr == 198.51.100.140\` shows packets to or from that address. Use two equals signs.
        - \`ip.src ==\` shows packets from an address, and \`ip.dst ==\` packets to it.
        - \`!\` means "not": \`!arp\` shows everything except ARP.
        - \`&&\` means "and", and \`||\` means "or": \`dns || http\` shows both.

        [[chat]] is at 198.51.100.140. Filter for every packet to or from it. Then filter out the ARP packets.
      `,
      setup: ensureBusyCapture,
      focus: ['laptop', 'chat'],
      open: 'capture',
      tools: [FILTER],
      actions: [busyButton],
      goals: [
        {
          id: 'chat',
          label: 'Show only the packets to or from [[chat]]',
          hint: 'Type `ip.addr == 198.51.100.140` and press Enter.',
          check: filtered('laptop', isChat),
        },
        { id: 'no-arp', label: 'Show everything except ARP', hint: 'Type `!arp` and press Enter.', check: filtered('laptop', (f) => !f.arp) },
      ],
      questions: [
        {
          id: 'chat-shows',
          kind: 'choice',
          prompt: 'What can you read in the chat packets?',
          options: [
            { id: 'outside', text: 'Addresses and ports, but not the messages', correct: true },
            { id: 'messages', text: 'The messages, because chat is plain HTTP', feedback: 'Look at the Protocol column: HTTPS. The messages are locked inside TLS.' },
            { id: 'nothing', text: 'Nothing: chat apps hide their packets', feedback: 'The packets are in the list, and their addresses and ports are readable.' },
            { id: 'who', text: 'Who the family is chatting with', feedback: "The capture shows only the chat service's address. Who a message is for is inside the locked part." },
          ],
          explain: 'The chat app uses HTTPS. A capture shows when the laptop talked to the chat service and how often, but not what anyone said.',
        },
        {
          id: 'weather-filter',
          kind: 'choice',
          prompt: 'Which filter shows only the packets to and from the weather service?',
          options: [
            { id: 'addr', text: 'ip.addr == 192.0.2.140', correct: true },
            { id: 'word', text: 'weather', feedback: "Wireshark doesn't know the word weather. Try it in the filter bar to see its message." },
            { id: 'name', text: 'ip.addr == weather.example', feedback: 'ip.addr needs an IP address, not a name. The DNS answer for weather.example has it.' },
            { id: 'http', text: 'http', feedback: "That also shows the school website's packets." },
          ],
          explain: "192.0.2.140 is the weather service's address. The DNS answer for weather.example says so.",
        },
      ],
    },

    {
      id: 'cant-see',
      title: "What the capture can't see",
      body: md`
        Your capture shows the laptop's packets. What about the rest of the family?

        1. Press **Start** for a new capture.
        2. Press **The TV plays a show**. Watch [[tv]] on the map: it sends and receives lots of packets.
        3. Filter for the TV's address: \`ip.addr == 192.168.1.12\`.
        4. Then filter \`arp\`.

        The capture misses almost everything the TV did. [[wifi]] is a **switch**: it sends each packet only to the device it's for. The laptop gets its own packets, plus the few sent to everyone, like ARP requests. (Lab 1 showed this.)

        So Wireshark on your computer shows your own traffic, not your family's or your classmates'. To see other devices' traffic, an attacker has to trick the switch. A later lab shows how, and how to stop it.
      `,
      setup: readyToStart,
      focus: ['laptop', 'tv', 'wifi'],
      open: 'capture',
      tools: [FILTER],
      actions: [tvButton],
      goals: [
        {
          id: 'show',
          label: 'Capture while [[tv]] plays a show',
          hint: 'Press **Start**, then **The TV plays a show**. Wait until the TV is playing.',
          check: ({ sim, since }) => {
            const c = showSince(sim, since);
            return startedSince(sim, since) && c?.status === 'open' && run(sim)!.start <= c.t && capturedSince(sim, 'laptop', since, isTvArp);
          },
        },
        {
          id: 'tv-filter',
          label: "Filter for the TV's address",
          hint: 'Type `ip.addr == 192.168.1.12` and press Enter.',
          check: filteredForTv,
        },
        {
          id: 'arp',
          label: "Filter for ARP, and find the TV's request",
          hint: 'Type `arp` and press Enter. One request comes from 192.168.1.12.',
          check: (ctx) => filteredArp(ctx) && captured(ctx.sim).some((c) => isTvArp(c.frame)),
        },
      ],
      questions: [
        {
          id: 'why',
          kind: 'choice',
          prompt: "The laptop's capture got the TV's ARP request but none of its video. Why?",
          options: [
            { id: 'switch', text: 'The ARP request went to everyone, and the video only to the TV', correct: true },
            { id: 'encrypted', text: 'The video was encrypted, so the capture skipped it', feedback: 'A capture records encrypted packets too, like the chat packets. These never reached the laptop.' },
            { id: 'far', text: 'The TV is too far from the laptop', feedback: 'Distance has nothing to do with it. Every packet went through the switch, and the switch picked where each one went.' },
            { id: 'full', text: 'The capture was too busy to record them', feedback: "The list had room. The switch never sent the TV's packets to the laptop." },
          ],
          explain: "A switch sends each packet only toward the device it's for. A packet sent to everyone, like an ARP request, reaches every device, so every capture sees it.",
        },
      ],
    },

    {
      id: 'wireshark',
      title: 'Get ready for Wireshark',
      body: md`
        Wireshark looks busier than this, but it works the same way. Some things carry over, and some are new:

        - **Pick an interface first.** Wireshark lists your computer's network connections. Pick Wi-Fi (or Ethernet, if you use a cable): the one with a moving line next to it.
        - **Start** is a blue shark fin. **Stop** is a red square.
        - The packet list has the same columns, plus **Length**: the packet's size in bytes.
        - Under the list are the layers, like the right side of this tab. Under those are the packet's raw **bytes**, in hexadecimal.
        - Wireshark says ICMP for ping and TLS for HTTPS.
        - You'll see extra packets. TCP opens each connection with three small packets, marked [SYN], [SYN, ACK], and [ACK]. Many sites use **QUIC**, a newer way to carry web traffic. Some addresses are **IPv6**: longer, with colons.
        - Filters work the same: \`dns\`, \`http\`, \`tls\`, \`icmp\`, \`arp\`, \`ip.addr ==\`.

        Practice two Wireshark filters here. Press **Start**, ping [[router]] from the laptop in the **Toolkit** tab, and press **Open the video site**. Then filter for the pings, and then for the encrypted web traffic, using Wireshark's names.
      `,
      setup: readyToStart,
      focus: ['laptop', 'router', 'video'],
      open: 'capture',
      tools: [FILTER, PING],
      actions: [openVideoButton],
      goals: [
        { id: 'icmp', label: "Filter for pings, Wireshark's way", hint: "Type `icmp`. Wireshark doesn't know the word ping.", check: filtered('laptop', is('icmp')) },
        { id: 'tls', label: "Filter for encrypted web traffic, Wireshark's way", hint: 'Type `tls`.', check: filtered('laptop', is('tls')) },
      ],
      questions: [
        {
          id: 'dns-filter',
          kind: 'text',
          prompt: 'In Wireshark, what would you type in the filter bar to see only name lookups?',
          expect: /^\s*["'“”]?(dns|udp\.port\s*==\s*53)["'“”]?\s*\.?\s*$/,
          expectHint: "Wireshark's filters are protocol names in lowercase. Which protocol looks up names?",
          explain: 'dns. Filters are lowercase: Wireshark turns the bar red for DNS.',
        },
        {
          id: 'first-move',
          kind: 'choice',
          prompt: "You start Wireshark, and hundreds of packets pour in. What's a good first move?",
          options: [
            { id: 'filter', text: "Stop the capture, then filter for what you're looking for", correct: true },
            { id: 'read', text: 'Read every packet, starting from No. 1', feedback: 'That could take hours. A filter gets you to the right packets in seconds.' },
            { id: 'virus', text: 'Close it, because your computer may have a virus', feedback: 'A busy list is normal. Apps talk to the internet all day, as the busy minute showed.' },
            { id: 'unplug', text: 'Turn off the Wi-Fi so the list stops growing', feedback: 'Press Stop instead. It keeps everything captured so far, and your internet keeps working.' },
          ],
          explain: 'Stop, then filter. Almost every capture you read will start that way.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        You've captured packets, opened their layers, and filtered a busy list down to the packets you wanted. Next is Part 2: Wireshark on a real computer.
      `,
      questions: [
        {
          id: 'advice',
          kind: 'text',
          prompt: 'A friend is about to open Wireshark for the first time. What should they expect to see, and how can they find the packets they care about? Name at least two kinds of packets and one filter.',
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
