import { capturedAfter } from '../../sim/capture';
import { matchFilter, parseFilter } from '../../sim/displayFilter';
import type { Sim } from '../../sim/sim';
import type { Frame } from '../../sim/types';
import { capturedSince, filtered as filteredOnApply, inspected, openedFrame } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, CheckCtx, LabDef, MapZone, ToolSpec } from '../types';
import {
  busyDoneAt,
  busyMinute,
  busyStart,
  buildCapture,
  captured,
  capturedThrough,
  capturing,
  BUSY_ANSWERS,
  cleanPageCapture,
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
  showStart,
  startedSince,
  tvShow,
} from './scenario';
import { WIRESHARK_WINDOW } from './wiresharkWindow';

// ---------------------------------------------------------------------------
// Lesson buttons and the lines under them
// ---------------------------------------------------------------------------

/**
 * A warning when the capture wasn't running as the button was pressed.
 * `doneAt`: when what the button started was over, once it is.
 */
function offLine(sim: Sim, since: number, label: string, doneAt?: number): ActionLine[] {
  if (capturedThrough(sim, since, since)) return [];
  const r = run(sim);
  const done = doneAt !== undefined;
  // A capture started after it was over is a new capture, not a late one.
  if (r && done && r.start >= doneAt) {
    return [{ tone: 'wait', text: `Your capture started after this ended. It doesn't have these packets. To record them, press "${label}" again.` }];
  }
  if (r && r.start > since) {
    const button = capturing(sim) ? 'Restart' : 'Start';
    const then = done ? `Press ${button}` : `When this finishes, press ${button}`;
    return [{ tone: 'bad', text: `The capture started after you pressed "${label}", so it missed the first packets. ${then}, then press "${label}" again.` }];
  }
  const then = done ? 'Press Start' : 'When this finishes, press Start';
  return [{ tone: 'bad', text: `The capture was off, so it recorded none of this. ${then}, then press "${label}" again.` }];
}

const packets = (n: number) => `${n} packet${n === 1 ? '' : 's'}`;
const isPing = is('icmp');

/**
 * "Loading…", then whether the laptop's page loaded and how many packets the
 * capture got for it. A press while a page is loading does nothing (see
 * openSchool), so these lines follow the load that was already running.
 * With `clean`, also say when the list holds packets from before the load.
 */
const pageLines =
  (label: string, what: string, clean = false) =>
  (sim: Sim, since: number): ActionLine[] => {
    const b = sim.dev('laptop').browser;
    if (!b || b.startedAt > since) return [];
    const from = b.startedAt;
    const loading = b.status === 'resolving' || b.status === 'loading';
    const off = offLine(sim, from, label, loading ? undefined : (b.doneAt ?? from));
    if (loading) return [...off, { tone: 'wait', text: `Loading ${what}…` }];
    if (b.status !== 'loaded') return [...off, { tone: 'bad', text: b.error ?? "The page didn't load." }];
    const loaded = `${what[0].toUpperCase()}${what.slice(1)} loaded.`;
    if (off.length) return [{ tone: 'good', text: loaded }, ...off];
    // Pings sent alongside (step 11) aren't part of the page.
    const n = capturedAfter(sim.dev('laptop'), from).filter((c) => !isPing(c.frame)).length;
    const before = captured(sim).filter((c) => c.t < from).length;
    if (clean && before > 0) {
      return [
        { tone: 'good', text: `${loaded} The capture recorded ${packets(n)} for it.` },
        {
          tone: 'bad',
          text: `Your list also has ${packets(before)} from before you pressed "${label}". For a list of this page alone, press ${capturing(sim) ? 'Restart' : 'Start'}, then press "${label}" again.`,
        },
      ];
    }
    return [{ tone: 'good', text: `${loaded}${capturing(sim) ? ' Press Stop.' : ''} The capture recorded ${packets(n)} for it.` }];
  };

const SCHOOL_LABEL = 'Open the school website';
const openSchoolButton: ActionDef = {
  id: 'open-school',
  label: SCHOOL_LABEL,
  run: openSchool,
  outcome: pageLines(SCHOOL_LABEL, 'the homework page', true),
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
    const ack = lastSince(sim, since, 'dhcp', (e) => e.what === 'ack' && e.client === 'phone' && !e.quiet);
    const off = offLine(sim, since, PHONE_LABEL, ack?.t);
    if (ack) {
      // Step 5 also pings the router: say Stop once the capture has the reply.
      const pinged = captured(sim).some((c) => isPing(c.frame) && c.frame.ip?.dst === IP.laptop);
      const next = off.length || !capturing(sim) ? '' : pinged ? ' Press Stop.' : ' Next, in the Toolkit tab, ping the router from the laptop.';
      return [{ tone: 'good', text: `The phone got its address, ${ack.ip}, again.${next}` }, ...off];
    }
    if (lastSince(sim, since, 'wifi', (e) => e.what === 'join' && e.client === 'phone')) return [...off, { tone: 'wait', text: 'The phone is back and asking for an address…' }];
    return [...off, { tone: 'wait', text: 'The phone left the Wi-Fi…' }];
  },
};

const BUSY_LABEL = 'Leave the laptop alone for a minute';
const busyButton: ActionDef = {
  id: 'busy-minute',
  label: BUSY_LABEL,
  run: busyMinute,
  outcome: (sim, since) => {
    // A press while the minute runs does nothing (see busyMinute): follow the minute that's running.
    const from = Math.min(busyStart(sim) ?? since, since);
    // The minute is over when its last answer comes through the router: an event, so this line redraws then.
    const doneAt = busyDoneAt(sim, from);
    const over = doneAt !== undefined;
    const off = offLine(sim, from, BUSY_LABEL, doneAt);
    if (off.length) return over ? [{ tone: 'good', text: 'The minute is over.' }, ...off] : off;
    const mine = capturedAfter(sim.dev('laptop'), from);
    const answers = mine.filter((c) => c.frame.ip?.app.kind === 'http-res' && c.frame.ip.dst === IP.laptop).length;
    if (answers >= BUSY_ANSWERS) {
      return [{ tone: 'good', text: `The minute is over.${capturing(sim) ? ' Press Stop.' : ''} The capture recorded ${packets(mine.length)}.` }];
    }
    if (!capturing(sim)) return [{ tone: 'bad', text: `The capture stopped before the minute was over, with ${packets(mine.length)}. Press Start, then press "${BUSY_LABEL}" again.` }];
    return [{ tone: 'wait', text: `The laptop's apps are at work: ${packets(mine.length)} so far…` }];
  },
};

const TV_LABEL = 'The TV plays a show';
/** The TV's packets that the router passed since `since`: the show traffic the laptop never sees. */
const tvPackets = (sim: Sim, since: number) =>
  sim.events.filter((e) => e.t >= since && e.type === 'forwarded' && e.device === 'router' && (e.frame.ip?.src === IP.tv || e.frame.ip?.dst === IP.tv)).length;
const tvButton: ActionDef = {
  id: 'tv-show',
  label: TV_LABEL,
  run: tvShow,
  outcome: (sim, since) => {
    const c = showSince(sim, since);
    const off = offLine(sim, since, TV_LABEL, c && c.status !== 'pending' ? (c.doneAt ?? c.t) : undefined);
    if (c?.status === 'open') {
      // Say what's next only while a capture that has the show runs; otherwise the capture line says it.
      const next = !off.length && capturing(sim) ? " Press Stop, then filter for the TV's address." : '';
      return [{ tone: 'good', text: `The TV is playing the show. It sent and received ${packets(tvPackets(sim, since))} through the router.${next}` }, ...off];
    }
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
/** The capture was already running at time `t`, when a lesson button was pressed. */
const startedBy = (sim: Sim, t: number | undefined) => t !== undefined && (run(sim)?.start ?? Infinity) <= t;
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

/** The filter on screen in each sim's Capture tab. A step starts with none (LabSession clears it). */
const shownFilter = new WeakMap<Sim, string>();
/**
 * `filtered` from helpers checks only when the student presses Enter. This also
 * checks the filter still on screen as packets arrive, so a filter typed before
 * the packets came in checks off once they show.
 */
const filtered = (device: string, want: (f: Frame) => boolean) => {
  const onApply = filteredOnApply(device, want);
  return (ctx: CheckCtx): boolean => {
    const { sim, ev } = ctx;
    if (ev?.type === 'ui:enter-step') shownFilter.delete(sim);
    if (ev?.type === 'ui:filter') {
      if (ev.device === device) shownFilter.set(sim, ev.filter);
      return onApply(ctx);
    }
    const filter = shownFilter.get(sim);
    return !!filter && onApply({ ...ctx, ev: { type: 'ui:filter', device, filter } });
  };
};

const filteredArp = filtered('laptop', (f) => !!f.arp);

export const packetCaptureLab: LabDef = {
  id: 'packet-capture',
  version: 2,
  title: 'Packet Capture Basics',
  tagline: "Capture the family laptop's traffic, open packets layer by layer, learn the common kinds, and filter for the packets you want, to get ready for Wireshark.",
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

        Network technicians use captures to find problems, and security analysts use them to spot attacks. The most common tool is **Wireshark**, a free program. In our next class, we'll install it together. Here, on a small, slow network, you'll learn to read a capture first, so Wireshark's busy window won't surprise you.

        A capture can show private things: the sites someone visits, and anything sent without encryption. Capture only on your own device, or with permission from the network's owner. Capturing other people's traffic without permission is illegal.

        On the map, the home is on the left and the internet is on the right. Out on the internet are five servers. One of them, [[dns]], turns names like school.example into addresses. Later you'll see why that matters. (The number after the slash in an address, like /24, says which addresses share its network. You won't need it in this lab.)
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
          explain: "Wireshark on your own computer records only what your network card sends and receives. Later you'll see that it misses packets between other devices, like the family TV and a video site.",
        },
      ],
    },

    {
      id: 'first-capture',
      title: 'Your first capture',
      body: md`
        To capture traffic, first **Start** the capture. Then wait for traffic on the network to go by, then **Stop** the capture. You can change the speed of the packets or replay the animation using the controls at the top of the network view.

        1. In the **Capture** tab under the map, press **Start**.
        2. Press [[button:open-school]]. The laptop loads the homework page. Watch the list fill up.
        3. When the line under the button says the page loaded, press **Stop**.

        Each row in the list is one packet. The columns match Wireshark's:

        - **No.**: the packet's number, counting from 1.
        - **Time**: seconds since you pressed Start. The lesson's network keeps its own time, so these seconds won't match a real clock.
        - **Source** and **Destination**: where the packet came from and where it was going. Some rows show MAC addresses instead of IP addresses. Later you'll see why.
        - **Protocol**: the kind of packet. A **protocol** is a set of rules for one job, like getting a web page.
        - **Info**: a short summary of what's inside.

        While a capture runs, **Start** changes to **Restart**. Either one deletes the old list and starts a new one.
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
          hint: 'With the capture running, press **Open the school website**. The list should hold this one page load, from its first packet to the page.',
          check: ({ sim, since }) => startedSince(sim, since) && cleanPageCapture(sim),
        },
        {
          id: 'stop',
          label: 'Stop the capture',
          hint: 'After the page loads, press **Stop** in the Capture tab.',
          check: ({ sim, since }) => startedSince(sim, since) && !capturing(sim) && cleanPageCapture(sim),
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
            { id: 'six', text: 'Six, of three different kinds', correct: true },
            { id: 'hundreds', text: 'More than a hundred', feedback: 'Your list is short. A real browser sends more than this, but not that many for one small page.' },
          ],
          explain: "Six packets: two ARP, two DNS, and two HTTP. Soon you'll see why one page needs all three. (A real browser sends a few more, to open and close the connection. Wireshark shows those too.)",
        },
      ],
    },

    {
      id: 'layers',
      title: 'Open a packet',
      body: md`
        Click a packet in the list to open its **layers**. They show beside the list. A packet is one message wrapped inside another, like a letter in an envelope in a mailing box. Each layer does one part of the delivery.

        - **Ethernet**: the **MAC addresses** for this **hop**. A hop is one trip from a device to the next one, like the laptop to the router.
        - **IP**: the **IP addresses** of the packet's source and destination: the sender and the receiver.
        - **TCP** or **UDP**: the **port numbers**. A port says which program should get the packet. Plain web (HTTP) servers listen on port 80.
        - The message itself: here, an **HTTP** request for a web page, or the page contents.

        Under each layer's title is Wireshark's name for it. Wireshark shows the same layers, top to bottom, under its packet list.

        Some packets also have a note that the router changed an address. That's address sharing (NAT) from lab 1: the family's devices share one public address on the internet. You can skip the note's numbers, and rows like TTL.

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
          explain: "The MAC addresses change at every hop. The To IP stays the school website's address the whole way. (One IP address does change: the router puts the family's public address in place of the laptop's address on the way out. It switches them back when the answer comes in. That's the note on the 200 OK.)",
        },
      ],
    },

    {
      id: 'page-story',
      title: 'One click, three kinds of packets',
      body: md`
        Read the whole list again, top to bottom. To load one page, the laptop did three jobs in order:

        1. **ARP** (Address Resolution Protocol): "Who has 192.168.1.1?" The laptop asks everyone on the home network for the router's MAC address, and [[router]] answers. The laptop needs that MAC address for the Ethernet layer. ARP packets have no IP layer, so the list shows their MAC addresses.
        2. **DNS** (Domain Name System): the laptop asks [[dns]] for the IP address of school.example. DNS turns names into IP addresses, the way a contact list turns a name into a phone number.
        3. **HTTP** (Hypertext Transfer Protocol): the laptop asks [[school]] for the page, and the page comes back.

        Open the ARP reply and the DNS answer.

        *(To keep the lesson clear, this laptop forgets the router's MAC address each time it opens a page, so every page starts with ARP. Other packets, like the pings in the next step, use the MAC address it already knows. A real computer remembers the MAC address and its DNS answers for a while, so Wireshark won't show ARP and DNS before every page.)*
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
          wrong: [
            { match: /192\.0\.2\.(08|8|800)\b/, text: 'Close. Check the last number against the DNS answer, digit by digit.' },
            { match: /\b192\.0\.2\.53\b/, text: "That's the name server's own address. Open the DNS answer and read the address it gave for school.example." },
          ],
          explain: "192.0.2.80. The GET request's To IP is the same address.",
        },
      ],
    },

    {
      id: 'more-kinds',
      title: 'Packets with other jobs',
      body: md`
        Not every packet is about web pages. Two more kinds you'll see in Wireshark:

        - **DHCP** (Dynamic Host Configuration Protocol): a device that has joined a network asks for an IP address.
        - **Ping**: a test message. One device asks "Are you there?" and the other answers. Wireshark calls ping packets **ICMP** (Internet Control Message Protocol).

        1. Press **Start** for a new capture.
        2. Press **The phone rejoins the Wi-Fi**.
        3. In the **Toolkit** tab, ping [[router]] (192.168.1.1) from [[laptop]].
        4. When the phone has its address again and the ping has its reply, press **Stop**.
        5. Open one of the phone's DHCP packets, and the router's ping reply.

        The capture shows only two of the phone's four DHCP messages: the two sent to everyone. This router sends the other two to the phone alone. (Some routers send all four to everyone, so Wireshark may show all four.)
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
          label: 'Open a DHCP packet from [[phone]] (Source 0.0.0.0)',
          hint: 'With the capture running, press **The phone rejoins the Wi-Fi**. Then click a DHCP row from 0.0.0.0.',
          check: openedFrame('laptop', isPhoneDhcp),
        },
        {
          id: 'ping',
          label: 'Open the ping reply from [[router]]',
          hint: 'In the Toolkit tab, ping 192.168.1.1 from the laptop. Then click the ICMP row whose Info says reply.',
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
        3. When the line under the button says the video site loaded, press **Stop**.
        4. Open one of its encrypted packets.

        Wireshark calls these packets TLS, and so does the Protocol column here. The map still labels them HTTPS. Their Info says Application Data.
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
          check: ({ sim, since }) => startedSince(sim, since) && startedBy(sim, sim.dev('laptop').browser?.startedAt) && captured(sim).some((c) => isVideoTls(c.frame)),
        },
        {
          id: 'open',
          label: 'Open an encrypted (TLS) packet',
          hint: 'Click a row whose Protocol says TLS.',
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
          expectHint: "Open the TLS packet the laptop sent and read the TCP layer's To port.",
          wrong: [
            { match: /\b(434|344|433)\b/, text: 'Close. Check the order of the digits against the TCP layer.' },
            { match: /\b(49|5\d|6[0-5])\d{3}\b/, text: "That's the laptop's own port, the From port. The question asks for the port the request went to." },
            { match: /\b80\b/, text: "Port 80 is for plain HTTP. This request used HTTPS. Open the TLS packet the laptop sent and read the TCP layer's To port." },
          ],
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
        2. Press **Leave the laptop alone for a minute**. (In this lesson the minute is shorter: it lasts about 16 seconds in the Time column. To make it go faster, press **4×** above the map.)
        3. Watch the list grow. When the line under the button says the minute is over, press **Stop**.

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
          check: ({ sim, since }) =>
            startedSince(sim, since) && startedBy(sim, busyStart(sim)) && captured(sim).length >= 40 && captured(sim).some((c) => isWeatherPage(c.frame)),
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
        Packet captures can have hundreds or even thousands of packets. In order to find the ones we're looking for, we can filter by IP address, protocol, and more. Wireshark requires filters in a specific syntax, so we'll practice some of them now.

        Type a filter in the Capture tab's filter bar and press Enter:

        - \`dns\` shows only name lookups.
        - \`http\` shows only plain web traffic.

        The bar turns green when Wireshark would understand the filter, and red when it wouldn't. Press Enter on a red one to see what's wrong. Filters are lowercase.

        Filter \`dns\`, then \`http\`. Then open the weather service's answer and read it.

        A filter only hides packets. The capture still remembers the entire list. Clear the filter to see them all again. (If your list is empty, press **Start**, then **Leave the laptop alone for a minute**.)
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
          id: 'weather',
          kind: 'text',
          prompt: "What's today's weather, according to the weather service?",
          // Any number in the answer has to be the right temperature: "sunny 27" is wrong.
          expect: /^(?![\s\S]*\d)[\s\S]*sunny|(^|\D)72(\D|$)/i,
          expectHint: "Open the 200 OK from the weather service and read the page text.",
          wrong: [{ match: /\d/, text: 'Check the temperature against the page text, digit by digit.' }],
          explain: "Sunny, with a high of 72°F. It's plain HTTP, so anyone capturing can read it too.",
        },
      ],
    },

    {
      id: 'address-filter',
      title: 'Follow one conversation',
      body: md`
        A filter can pick packets by address, too. In Wireshark:

        - \`ip.addr == 192.0.2.140\` shows packets to or from that address. Use two equals signs.
        - \`!\` means "not": \`!dns\` shows everything except DNS.
        - \`||\` means "or": \`dns || http\` shows both kinds.

        [[chat]] is at 198.51.100.140. Filter for every packet to or from it. Then replace that filter with one that shows everything except ARP.
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
        { id: 'no-arp', label: 'Show everything except ARP', hint: 'Clear the bar, type `!arp`, and press Enter.', check: filtered('laptop', (f) => !f.arp) },
      ],
      questions: [
        {
          id: 'chat-shows',
          kind: 'choice',
          prompt: 'What can you read in the chat packets?',
          options: [
            { id: 'outside', text: 'Addresses and ports, but not the messages', correct: true },
            { id: 'messages', text: 'The messages, because chat is plain HTTP', feedback: 'Look at the Protocol column: TLS. The messages are locked inside it.' },
            { id: 'nothing', text: 'Nothing: chat apps hide their packets', feedback: 'The packets are in the list, and their addresses and ports are readable.' },
            { id: 'who', text: 'Who the family is chatting with', feedback: "The capture shows only the chat service's address. Who a message is for is inside the locked part." },
          ],
          explain: 'The chat app uses HTTPS. A capture shows when the laptop talked to the chat service and how often, but not what anyone said.',
        },
      ],
    },

    {
      id: 'cant-see',
      title: "What the capture can't see",
      body: md`
        Your capture shows the laptop's packets. What about the rest of the family?

        1. Press **Start** for a new capture.
        2. Press **The TV plays a show**. [[tv]] sends and receives packets to load it.
        3. When the TV is playing, press **Stop**. Then filter for the TV's address: \`ip.addr == 192.168.1.12\`. The list comes up empty, and that's the point: none of the TV's video reached the laptop.
        4. Then filter \`arp\`. ARP packets have no IP layer, so \`ip.addr\` filters never show them.

        The capture misses almost everything the TV did. [[wifi]] is a **switch**: it sends each packet only to the device it's for. The laptop gets its own packets, plus the few sent to everyone, like ARP requests.

        So Wireshark on your computer shows your own traffic, not your family's or your classmates'. To see other devices' traffic, an attacker has to trick the switch. This is one example of a cyber attack, and we'll learn more about how to perform and defend against these attacks in a future lab.
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
            return startedSince(sim, since) && c?.status === 'open' && startedBy(sim, showStart(sim)) && capturedSince(sim, 'laptop', since, isTvArp);
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
        Wireshark looks busier than this tab, but it has the same parts. Here is a drawing of its window:

        ${WIRESHARK_WINDOW}

        1. **Toolbar**: Start is a blue shark fin (a triangle), Stop is a red square, and Restart is a green fin. Before your first capture, Wireshark lists your computer's network connections, called **interfaces**. Pick Wi-Fi (or Ethernet, if you use a cable): the one with a moving line next to it.
        2. **Filter bar**: the filters from this lab work there too.
        3. **Packet list**: the same columns, plus **Length**, the packet's size in bytes.
        4. **Packet details**: the layers of the packet you clicked. Click an arrow to open a layer.
        5. **Packet bytes**: the whole packet as the computer stores it, written in **hexadecimal** (the digits 0 to 9 and the letters a to f). You can ignore this part.

        To make Wireshark's text bigger, use **View > Zoom In**.

        Wireshark also shows packets this lab left out:

        - **TCP** starts each connection with three small packets, marked [SYN], [SYN, ACK], and [ACK], like rows 3 to 5 in the drawing.
        - **QUIC** is a newer way to carry encrypted web traffic. Wireshark lists it as QUIC, so filter \`quic\` to see it.
        - **IPv6** addresses are longer, with colons.

        **Practice two filters here:**

        1. Press **Start**.
        2. In the **Toolkit** tab, ping [[router]] (192.168.1.1) from the laptop.
        3. Press **Open the video site**. When it loads, press **Stop**.
        4. Filter for the pings, then for the encrypted web traffic. Use Wireshark's names.
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
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        You've captured packets, opened their layers, and filtered a busy list down to the packets you wanted. In our next class, we'll download Wireshark and observe some real-world network traffic together! Until then, please do not install or attempt to use Wireshark on your own. Capturing and tampering with network traffic without permission is spying, and can get you in trouble with the school or even the government.
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
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
  ],
};
