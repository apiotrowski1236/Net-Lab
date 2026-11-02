import type { Sim } from '../../sim/sim';
import { reach } from '../../sim/wifi';
import { happened, inspected, openedFrame, openedLog, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, CableRefusal, CheckCtx, LabDef, MapZone } from '../types';
import {
  ap,
  bothLoaded,
  buildHome,
  connSince,
  FACTORY_SSID,
  FAMILY,
  familyJoins,
  IP,
  ipOf,
  joined,
  lastSince,
  neighborTries,
  PAGES,
  print,
  ready,
  secured,
  STRANGER_PORT,
  tvRestarts,
  uplinked,
  videoUrl,
  WIFI_POS,
  WIRED,
  wiredIn,
} from './scenario';

// ---------------------------------------------------------------------------
// Lesson buttons and the lines under them
// ---------------------------------------------------------------------------

const watchPacket: ActionDef = {
  id: 'watch-packet',
  label: 'Watch a packet',
  run: (sim) => sim.ping('school', IP.video),
  outcome: (sim, since) => {
    const sent = lastSince(sim, since, 'ping-sent', (e) => e.device === 'school');
    if (!sent) return [];
    if (lastSince(sim, since, 'ping-reply', (e) => e.device === 'school' && e.seq === sent.seq)) return [{ tone: 'good', text: 'The video site answered the school website.' }];
    if (lastSince(sim, since, 'ping-fail', (e) => e.device === 'school' && e.seq === sent.seq)) return [{ tone: 'bad', text: "The packet didn't come back. Press Watch a packet again." }];
    return [{ tone: 'wait', text: 'The packet is on its way…' }];
  },
};

const familyJoinsButton: ActionDef = {
  id: 'family-joins',
  label: 'The family joins',
  run: familyJoins,
  outcome: (sim) =>
    FAMILY.map((id): ActionLine => {
      const d = sim.dev(id);
      const w = ap(sim);
      if (joined(sim, id)) return ipOf(sim, id) ? { tone: 'good', text: `${d.label} joined ${w.ssid} and got an address.` } : { tone: 'wait', text: `${d.label} joined ${w.ssid}. Asking for an address…` };
      if (w.off) return { tone: 'bad', text: `${d.label} found no Wi-Fi network to join. Is the Wi-Fi on?` };
      if (d.wifiClient?.ssid !== w.ssid) return { tone: 'bad', text: `${d.label} knows the old network name. Press The family joins again.` };
      return { tone: 'bad', text: `${d.label} couldn't join ${w.ssid}.` };
    }),
};

const neighborButton: ActionDef = {
  id: 'neighbor-tries',
  label: 'The neighbor tries to join',
  run: neighborTries,
  outcome: (sim, since) => {
    if (joined(sim, 'neighbor')) return [{ tone: 'bad', text: "The neighbor's laptop guessed the password and joined. Pick one that's harder to guess." }];
    const tries = sim.events.filter((e) => e.t >= since && e.type === 'wifi' && e.what === 'rejected' && e.client === 'neighbor').length;
    if (!tries) return [{ tone: 'bad', text: "The neighbor's laptop found no Wi-Fi network to join." }];
    return [{ tone: 'good', text: `The neighbor's laptop tried ${tries} common password${tries === 1 ? '' : 's'}. None worked, so it can't join.` }];
  },
};

const tvButton: ActionDef = {
  id: 'tv-restarts',
  label: 'The TV restarts',
  run: tvRestarts,
  outcome: (sim, since) => {
    const ack = lastSince(sim, since, 'dhcp', (e) => e.what === 'ack' && e.client === 'tv' && !e.quiet);
    if (ack) return [{ tone: 'good', text: `The TV got the address ${ack.ip} again.` }];
    if (lastSince(sim, since, 'wifi', (e) => e.what === 'join' && e.client === 'tv')) return [{ tone: 'wait', text: 'The TV is back and asking for an address…' }];
    return [{ tone: 'wait', text: 'The TV is restarting…' }];
  },
};

/** "Sending the homework to the printer…", then whether it printed. */
const printLines =
  (from: string, tag: string, what: string) =>
  (sim: Sim, since: number): ActionLine[] => {
    const c = connSince(sim, from, since, tag);
    if (!c) return [];
    if (c.status === 'pending') return [{ tone: 'wait', text: `Sending the ${what} to the printer…` }];
    if (c.status === 'open') return [{ tone: 'good', text: `The printer got the ${what} and printed it.` }];
    return [{ tone: 'bad', text: `The ${what} didn't reach the printer.` }];
  };

const printHomework: ActionDef = {
  id: 'print-homework',
  label: 'Print the homework',
  run: (sim) => print(sim, 'laptop', 'homework.pdf', 'homework'),
  outcome: printLines('laptop', 'homework', 'homework'),
};

const printPhoto: ActionDef = {
  id: 'print-photo',
  label: 'The phone prints a photo',
  run: (sim) => print(sim, 'phone', 'photo.jpg', 'photo'),
  outcome: printLines('phone', 'photo', 'photo'),
};

const phoneVideo: ActionDef = { id: 'phone-video', label: 'Phone opens the video site', run: (sim) => sim.browse('phone', videoUrl(PAGES.cats)) };

const bothBrowse: ActionDef = {
  id: 'both-browse',
  label: 'Phone and laptop browse at once',
  run: (sim) => {
    sim.browse('phone', videoUrl(PAGES.cats));
    sim.browse('laptop', videoUrl(PAGES.fractions));
  },
};

const strangerKnocks: ActionDef = {
  id: 'stranger-knocks',
  label: 'A stranger knocks',
  run: (sim) => sim.connectService('stranger', IP.public, STRANGER_PORT, { tag: 'knock' }),
  outcome: (sim, since) => {
    if (lastSince(sim, since, 'drop', (e) => e.device === 'router' && e.reason === 'unsolicited'))
      return [{ tone: 'good', text: "The router dropped the stranger's packet. Nobody in the home asked for it." }];
    if (connSince(sim, 'stranger', since, 'knock')?.status === 'open') return [{ tone: 'bad', text: "The stranger's packet got in." }];
    return [{ tone: 'wait', text: "The stranger's packet is on its way…" }];
  },
};

// ---------------------------------------------------------------------------
// Cables the lesson turns away (step 2). The first match wins.
// ---------------------------------------------------------------------------

const HOME_PORT = 'Plug the {a} into a home port on the Switch and Wi-Fi.';

const REFUSALS: CableRefusal[] = [
  ...FAMILY.map((id): CableRefusal => ({ between: [id, '*'], text: 'The {a} uses Wi-Fi. It connects in the next step.' })),
  { between: ['neighbor', '*'], text: "That's the neighbor's laptop, next door. It isn't part of this home." },
  { between: ['router', 'wifi'], text: "The router and the Switch and Wi-Fi are already joined inside the box. The router's free port is its internet port, for the internet provider." },
  { between: ['isp', 'wifi'], text: "The internet provider's cable goes into the router's internet port. Home ports are for devices in the home." },
  { between: ['console', 'printer'], text: 'Plug each device into the Wi-Fi router, not into each other.' },
  ...['video', 'school', 'stranger'].map((id): CableRefusal => ({ between: [id, '*'], text: "The {a} is out on the internet, far from this home. Only the internet provider's cable comes into the home." })),
  ...WIRED.flatMap((id): CableRefusal[] => [
    { between: [id, 'router'], text: `That's the router's internet port. It leads out of the home. ${HOME_PORT}` },
    { between: [id, 'isp'], text: `The internet provider is outside the home. ${HOME_PORT}` },
  ]),
];

// ---------------------------------------------------------------------------
// Map zones
// ---------------------------------------------------------------------------

function zones(sim: Sim): MapZone[] {
  const out: MapZone[] = [
    { id: 'home', shape: { kind: 'rect', x: 165, y: 35, w: 535, h: 490 }, label: "The Nguyens' home", tone: 'neutral' },
    { id: 'box', shape: { kind: 'rect', x: 265, y: 215, w: 345, h: 182 }, label: 'Wi-Fi router (one box)', tone: 'info' },
    { id: 'next-door', shape: { kind: 'rect', x: 15, y: 195, w: 140, h: 200 }, label: 'Next door', tone: 'neutral', dashed: true },
    { id: 'internet', shape: { kind: 'rect', x: 720, y: 35, w: 270, h: 500 }, label: 'The internet', tone: 'neutral', dashed: true },
  ];
  const w = ap(sim);
  if (!w.off) out.push({ id: 'reach', shape: { kind: 'circle', cx: WIFI_POS.x, cy: WIFI_POS.y, r: reach(w) }, label: 'Wi-Fi reach', tone: 'info', dashed: true });
  return out;
}

// ---------------------------------------------------------------------------
// Goal checks
// ---------------------------------------------------------------------------

const plugged = (id: string) => ({ sim }: CheckCtx) => wiredIn(sim, id);
const printed = (from: string, tag: string) => ({ sim, since }: CheckCtx) => connSince(sim, from, since, tag)?.status === 'open';
const isPrint = (f: { ip?: { app: { kind: string; app?: string } } }) => f.ip?.app.kind === 'svc' && f.ip.app.app === 'ipp';

export const homeNetworkLab: LabDef = {
  id: 'home-network',
  version: 1,
  title: 'Who Gets the Packet?',
  tagline: 'Set up a home Wi-Fi router, connect the family, and follow how it gets every packet to the right device.',
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves'],
  ced: ['3.1.B', '3.2.B'],
  minutes: 40,
  objectives: [
    'Name the parts of a home network: devices, a switch, an access point, and a router.',
    'Explain why Wi-Fi needs a password and WPA2 or WPA3.',
    'Explain how a device gets an IP address (DHCP), and how a MAC address differs from an IP address.',
    'Explain how a switch, a default gateway, and NAT get each packet to the right device.',
  ],
  build: buildHome,
  map: { ports: true, addresses: (d) => d.id !== 'isp', zones },
  labelMacs: true,
  hostRoutes: true,
  captureDevice: 'laptop',
  steps: [
    {
      id: 'tour',
      title: 'Meet the network',
      body: md`
        The Nguyen family is getting internet at home. A new **Wi-Fi router** sits in their living room, not set up yet. Your job: set it up, connect the family's devices, and find out how it gets every message to the right device.

        A **network** is a group of devices that can send messages to each other. A **device** is anything on a network: a laptop, a phone, a printer. The devices in one home make a **home network**, also called a **LAN** (local area network). The **internet** is millions of networks connected together.

        On the map, the Nguyens' home is in the middle and the internet is on the right. The neighbor's house is on the left. The Wi-Fi router is one box with two parts: [[router]] and [[wifi]].

        **How to use this app**

        - **Click a device** on the map to look inside it. What you find shows in the **Inspect** tab under the map.
        - **Goals** are under this text. Each one checks itself and turns green when it's done. Stuck? Open its **Hint**.
        - **Lesson buttons** make something happen on the network. Press **Watch a packet**. A colored tag runs along the lines: a message on its way.
        - Above the map, **Pause** (the two bars) freezes everything, and **0.5×** to **4×** set the speed. **Replay step** shows this step's traffic again. **Packet colors** says what each color means.
        - The tabs under the map: **Inspect** shows the device you clicked. **Capture** lists every packet the laptop sends or receives (none yet). **Toolkit** holds the tools a step gives you.
        - **Questions** come after the goals. Pick an answer and press **Check**. When everything is done, press **Continue**.
      `,
      focus: ['router', 'wifi', 'laptop'],
      actions: [watchPacket],
      goals: [
        { id: 'router', label: 'Open [[router]]', check: inspected('router') },
        { id: 'wifi', label: 'Open [[wifi]]', check: inspected('wifi') },
        { id: 'laptop', label: 'Open [[laptop]]', check: inspected('laptop') },
        {
          id: 'packet',
          label: 'Watch a packet cross the internet and come back',
          hint: 'Press **Watch a packet**. The school website sends a test message to the video site, and the video site answers.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'school' && e.from === IP.video),
        },
      ],
      questions: [
        {
          id: 'router-job',
          kind: 'choice',
          prompt: "What does the Nguyens' Wi-Fi router connect?",
          options: [
            { id: 'both', text: 'Home devices to each other, and the home to the internet', correct: true },
            { id: 'wifi-only', text: 'Only the devices that use Wi-Fi, not the wired ones', feedback: 'Look at [[wifi]]: it has numbered ports for cables too. Wired devices connect to the same box.' },
            { id: 'servers', text: 'The video site to the school website, across the internet', feedback: "Those two are out on the internet. They talk without the Nguyens' router, as the test packet showed." },
            { id: 'direct', text: 'Each device in the home straight to the internet provider', feedback: 'Every device in the home goes through the box. The devices also talk to each other, like the laptop to the printer.' },
          ],
          explain: 'The box does two jobs. Its switch and Wi-Fi part connects the devices in the home to each other. Its router part connects the whole home network to the internet.',
        },
      ],
    },

    {
      id: 'cables',
      title: 'Plug in the cables',
      body: md`
        Some devices connect with a **cable**. A cable plugs into a **port**, a socket on a device. The game console and the printer use cables.

        [[wifi]] has four numbered **home ports**, for devices in the home. [[router]] has one **internet port**. The cable from the family's **internet provider** (the company that connects homes to the internet, also called an **ISP**) goes there, and nothing else does: it leads out of the home.

        Plug in three cables:

        - [[console]] into a home port on [[wifi]]
        - [[printer]] into a home port on [[wifi]]
        - [[router]]'s internet port into [[isp]]

        Drag from one device to the other on the map, or use **Cables** in the **Toolkit** tab. To unplug a cable, click it on the map.

        Watch [[console]] after you plug it in. It sends its first packets right away. Step 4 explains them.

        (Many homes have one more box, a modem, between the router and the provider. Here the router plugs straight in.)
      `,
      focus: ['console', 'printer', 'router', 'isp'],
      tools: [{ kind: 'cable', refuse: REFUSALS }],
      goals: [
        {
          id: 'console',
          label: 'Plug [[console]] into a home port on [[wifi]]',
          hint: 'Drag from the game console to the Switch and Wi-Fi. The cable goes into the next free home port.',
          check: plugged('console'),
        },
        {
          id: 'printer',
          label: 'Plug [[printer]] into a home port on [[wifi]]',
          hint: 'Drag from the printer to the Switch and Wi-Fi. The cable goes into the next free home port.',
          check: plugged('printer'),
        },
        {
          id: 'uplink',
          label: "Plug [[router]]'s internet port into [[isp]]",
          hint: "Drag from the router to the internet provider. The router's only free port is its internet port.",
          check: ({ sim }) => uplinked(sim),
        },
      ],
      questions: [
        {
          id: 'wired',
          kind: 'choice',
          prompt: "The laptop, phone, and TV will use Wi-Fi instead of cables. What's one real difference?",
          options: [
            { id: 'air', text: 'Wi-Fi goes through the air, so anyone nearby can hear it', correct: true },
            { id: 'internet', text: 'Only devices on a cable can reach the internet at all', feedback: 'Wi-Fi devices reach the internet through the same box as wired ones. Both ways lead to [[wifi]].' },
            { id: 'one-way', text: 'A cable sends messages one way, so it needs a second cable back', feedback: 'Every cable carries messages both ways. The console sends and receives on the same cable.' },
            { id: 'address', text: "Wired devices don't need an address to get messages", feedback: 'Every device needs an address, wired or not. Step 4 shows how they get one.' },
          ],
          explain: "A cable's signal stays inside the cable. Wi-Fi is radio: it goes through walls, out to the yard, and next door. That's why Wi-Fi needs a password.",
        },
      ],
    },

    {
      id: 'wifi',
      title: 'Turn on the Wi-Fi',
      body: md`
        **Wi-Fi** connects devices by radio instead of a cable. [[wifi]] is the home's **access point**: the radio that Wi-Fi devices talk to.

        Radio goes through walls. This Wi-Fi reaches the yard, the street, and [[neighbor]] next door. So a home network needs a lock:

        - A **Wi-Fi password** that only the family knows. A device must know it to join.
        - **WPA2** or **WPA3** security. Both check the password, and both **encrypt** (scramble) everything sent over the air, so a listener can't read it. WPA3 is newer and harder to break.

        Click [[wifi]] and find **Wi-Fi setup** in the Inspect tab:

        1. Give the network a name. Devices see this name, the **SSID**, when they look for Wi-Fi.
        2. Pick WPA2 or WPA3, and save a password of at least 8 characters.
        3. Turn the Wi-Fi on.

        Then press **The family joins**. The laptop, phone, and TV join, and each one sends its first packets. Last, press **The neighbor tries to join**. The neighbor will guess common passwords.

        (In real life, each person types the password on their own device. Here, **The family joins** types it for them.)
      `,
      focus: ['wifi', 'neighbor'],
      open: { inspect: 'wifi' },
      tools: [{ kind: 'wifi-config', device: 'wifi', basic: true }],
      actions: [familyJoinsButton, neighborButton],
      goals: [
        {
          id: 'name',
          label: 'Give the Wi-Fi network a name',
          hint: 'Click [[wifi]]. Type a name under **Network name** and press **Save**.',
          check: ({ sim }) => ap(sim).ssid !== FACTORY_SSID,
        },
        {
          id: 'secure',
          label: 'Turn on the Wi-Fi with WPA2 or WPA3 and a password',
          hint: 'In **Wi-Fi setup**, pick WPA2 or WPA3, save a password of 8 or more characters, then switch the Wi-Fi on.',
          check: ({ sim }) => secured(sim),
        },
        {
          id: 'family',
          label: '[[laptop]], [[phone]], and [[tv]] join the Wi-Fi',
          hint: 'Press **The family joins** once the Wi-Fi is on. If you rename the network, press it again: the devices only know the old name.',
          check: ({ sim }) => FAMILY.every((id) => joined(sim, id)),
        },
        {
          id: 'neighbor',
          label: '[[neighbor]] tries to join and is turned away',
          hint: 'Press **The neighbor tries to join**. If the neighbor gets in, your password was too simple. Save a longer one and try again.',
          check: ({ sim, since }) =>
            !joined(sim, 'neighbor') && happened(sim, since, (e) => e.type === 'wifi' && e.what === 'rejected' && e.client === 'neighbor' && !e.quiet),
        },
      ],
      questions: [
        {
          id: 'walls',
          kind: 'choice',
          prompt: "The Nguyens' Wi-Fi is inside their house. Why does it still need a password?",
          options: [
            { id: 'walls', text: 'Its radio goes through walls, so people nearby can try to join', correct: true },
            { id: 'farther', text: 'A password makes the Wi-Fi signal reach farther outside', feedback: "A password doesn't change how far the signal goes. The radio's strength does. The password decides who may join." },
            { id: 'family', text: "Without one, the family's own devices can't join", feedback: 'A network with no password lets anyone join, the family included. The password keeps everyone else out.' },
            { id: 'isp', text: 'The internet provider checks it before letting the home online', feedback: 'The internet provider never sees your Wi-Fi password. It guards only the radio in your home.' },
          ],
          explain:
            "Wi-Fi goes wherever its radio reaches: through walls, into the yard, next door. With WPA2 or WPA3 and a password that's hard to guess, only devices that know it can join, and what they send is scrambled for anyone listening.",
        },
      ],
    },

    {
      id: 'addresses',
      title: 'Everyone gets an address',
      body: md`
        To get a message, a device needs an address, the way a house needs one for mail. Every device here has two:

        - A **MAC address** is built into the device's network hardware at the factory. It's like your name: it stays the same wherever the device goes. It looks like \`02:00:00:00:00:21\`.
        - An **IP address** is the device's address on this network. It's like a mailing address: join a different network, and you get a different one. It looks like \`192.168.1.12\`.

        The router hands out the IP addresses. When a device joins, it asks for one, and the router picks a free address and writes it down. This is called **DHCP**. It takes four messages:

        1. **Discover.** The device, to everyone: "I'm new here. Can someone give me an IP address?"
        2. **Offer.** The router: "You can have this one."
        3. **Request.** The device: "I'll take it."
        4. **Ack** (short for acknowledge). The router: "It's yours. And I'm your way out to the internet."

        Press **The TV restarts**. Set the speed to **0.5×** and watch the TV get its address again.

        Then click [[router]] and find **Connected devices**: every device's name, MAC address, and IP address. Click [[phone]] too, and check that its addresses match its line in the list.

        (Some phones make up a new MAC address for each network, for privacy. Here, every device keeps its own. Real devices also often skip to Request when they rejoin. Here, they always send all four messages.)
      `,
      setup: ready,
      focus: ['tv', 'router', 'phone'],
      actions: [tvButton],
      goals: [
        {
          id: 'tv',
          label: 'Watch [[tv]] ask for an address and get one',
          hint: 'Press **The TV restarts**. The TV leaves the Wi-Fi, joins again, and sends the four DHCP messages.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'dhcp' && e.what === 'ack' && e.client === 'tv' && !e.quiet),
        },
        { id: 'router', label: 'Find **Connected devices** on [[router]]', hint: 'Click the router on the map. Scroll down in the Inspect tab.', check: inspected('router') },
        { id: 'phone', label: 'Open [[phone]] and compare its addresses', check: inspected('phone') },
      ],
      questions: [
        {
          id: 'who',
          kind: 'choice',
          prompt: "Which of the phone's two addresses did the router hand out?",
          options: [
            { id: 'ip', text: 'Its IP address', correct: true },
            { id: 'mac', text: 'Its MAC address', feedback: "The MAC address was built into the phone's Wi-Fi hardware at the factory. The router only read it and wrote it down." },
            { id: 'neither', text: 'Neither. The phone picked its own.', feedback: 'The phone asked with DHCP, and the router offered the address. Look back at the four messages.' },
            { id: 'both', text: 'Both of them', feedback: 'Only one came from the router. The other was in the phone before it ever joined.', last: true },
          ],
          explain: "The MAC address came with the phone. The IP address came from the router when the phone joined, through DHCP. The router's Connected devices list pairs the two.",
        },
        {
          id: 'same',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The TV got the same IP address as before. How did the router know it was the TV?',
          options: [
            { id: 'mac', text: "It found the TV's MAC address in its list", correct: true },
            { id: 'old-ip', text: 'The TV told the router its old IP address', feedback: 'The TV had no IP address when it asked. Its Discover came from 0.0.0.0, which means "no address yet." What else was on it?' },
            { id: 'name', text: 'It read the name "Smart TV" on the message', feedback: `Names repeat: lots of homes have a "Smart TV." The router goes by the MAC address, which belongs to this TV's hardware.` },
            { id: 'chance', text: "It didn't. The TV got that address by chance.", feedback: "The TV's line was already in Connected devices. The router gave back the address it had saved for that MAC address." },
          ],
          explain: "The router's list pairs each MAC address with the IP address it handed out. When the same MAC address asks again, the router hands back the same IP address.",
        },
      ],
    },

    {
      id: 'packets',
      title: 'Packets',
      body: md`
        Messages don't travel in one piece. They're cut into small pieces called **packets**. Each packet carries a "from" address and a "to" address, like an envelope. A big file, like a homework page, takes many packets. (The map draws this print job as one packet, to keep it clear.)

        Press **Print the homework**. Watch the laptop's packets go over the Wi-Fi to [[wifi]], then down the cable to [[printer]]. Print packets are marked PRINT. The laptop first asks who the printer is; step 6 explains that part.

        The **Capture** tab lists every packet the laptop sends or receives. Click a print packet to open it, and find:

        - **From IP** and **To IP**: the IP addresses of the device that sent it and the device it's for.
        - **From MAC** and **To MAC**: the same two devices, by MAC address.

        Skip the other lines for now.
      `,
      setup: ready,
      focus: ['laptop', 'printer'],
      open: 'capture',
      actions: [printHomework],
      goals: [
        { id: 'printed', label: '[[printer]] prints the homework', hint: 'Press **Print the homework**. It takes a few seconds.', check: printed('laptop', 'homework') },
        { id: 'opened', label: 'Open a print packet in the **Capture** tab', hint: 'Open the Capture tab and click a row marked PRINT. Its details open next to the list.', check: openedFrame('laptop', isPrint) },
      ],
      questions: [
        {
          id: 'to-address',
          kind: 'choice',
          afterGoals: true,
          prompt: "What is the print packet's To IP address for?",
          options: [
            { id: 'where', text: 'It tells the network which device should get it', correct: true },
            { id: 'sender', text: 'It tells the printer who sent the homework', feedback: "That's the From address. The printer reads it to know where to send its answer." },
            { id: 'size', text: 'It says how big the homework file is', feedback: "Addresses say where a packet goes, not what's inside." },
            { id: 'ssid', text: 'It names the Wi-Fi network the packet uses', feedback: "The Wi-Fi network has a name, but packets carry device addresses. This To IP is the printer's." },
          ],
          explain: 'Like the address on an envelope, the "to" address tells every part of the network where the packet is going. The "from" address tells the receiver where to send its answer.',
        },
      ],
    },

    {
      id: 'switch',
      title: "Who's where",
      body: md`
        To send its packets, the laptop needed the printer's MAC address. It only knew the printer's IP address. So it asked every device at once: "Who has this IP address?" A message to every device at once is a **broadcast**. Only the printer answered: "That's me. Here's my MAC address." This question and answer is called **ARP**. Both are in the laptop's Capture tab, marked ARP.

        How does [[wifi]] know where to send each packet? It reads the "from" MAC address on every packet it gets, and writes down where that packet came in: which home port, or Wi-Fi. That list is its **MAC address table**. When a packet comes for that MAC address, the switch sends it only that way.

        Press **The phone prints a photo**. Then look at the laptop's Capture tab. What did the laptop hear?

        Click [[wifi]] and find its MAC address table. Find the printer's port.
      `,
      setup: ready,
      focus: ['wifi', 'phone', 'printer'],
      actions: [printPhoto],
      goals: [
        { id: 'photo', label: '[[phone]] prints a photo', hint: 'Press **The phone prints a photo**.', check: printed('phone', 'photo') },
        {
          id: 'table',
          label: "Find the printer in [[wifi]]'s MAC address table",
          hint: "Click the Switch and Wi-Fi. The table lists each MAC address and the port it's on. If the printer isn't there yet, print the photo first.",
          check: ({ sim, ev }) => {
            const mac = sim.dev('printer').ifaces[0].mac;
            return ev?.type === 'ui:inspect' && ev.device === 'wifi' && !!sim.dev('wifi').macTable[mac];
          },
        },
      ],
      questions: [
        {
          id: 'missing',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The laptop\'s capture shows the phone asking "Who has…?" but not the photo. Why not?',
          options: [
            { id: 'broadcast', text: 'The question went to everyone. The photo went only to the printer.', correct: true },
            { id: 'far', text: 'The laptop is too far from the phone to hear it', feedback: "The laptop heard the phone's question, so distance isn't it." },
            { id: 'scrambled', text: 'The photo was scrambled, so the laptop threw it away', feedback: 'A scrambled packet would still show in the capture, as gibberish. The photo never reached the laptop at all.' },
            { id: 'unknown', text: "The switch didn't know where the printer was yet", feedback: "It did: the printer's MAC address was already in its table. So the switch sent the photo straight out the printer's port." },
          ],
          explain: `A broadcast goes to every device. Everything else goes only toward the device it's for: the switch looks up the "to" MAC address in its table and sends the packet out that one port.`,
        },
        {
          id: 'learned',
          kind: 'choice',
          prompt: 'How did the switch learn which port leads to the printer?',
          options: [
            { id: 'from-mac', text: 'It read the "from" MAC address on a packet the printer sent', correct: true },
            { id: 'cable', text: "You told it when you plugged in the printer's cable", feedback: "You only plugged in a cable. The switch learned the rest by itself, from the printer's packets." },
            { id: 'ip', text: "The printer's IP address has the port number in it", feedback: "An IP address doesn't say which port a device is on. The switch works with MAC addresses." },
            { id: 'router', text: 'The router sent it a list of every device in the home', feedback: "The router hands out IP addresses, but it doesn't tell the switch where devices are." },
          ],
          explain: "Every packet carries its sender's MAC address. When the printer sent its first packet, the switch saw that MAC address come in on the printer's port and wrote it down.",
        },
      ],
    },

    {
      id: 'internet',
      title: 'Out to the internet',
      body: md`
        The phone wants a video from [[video]], out on the internet. The site's IP address, 198.51.100.20, doesn't start with 192.168.1, so it isn't in the home.

        Every device follows one rule:

        - If the "to" address is on the home network (here, it starts with 192.168.1), send the packet straight to that device.
        - If not, send it to the **default gateway**: the way out of the home. That's [[router]], at 192.168.1.1. The router said so in its DHCP Ack.

        The router checks the "to" address too. A home address goes back inside. Anything else goes out the internet port to [[isp]], and the internet carries it on to the site.

        Click [[phone]] and find its default gateway. Then press **Phone opens the video site** and follow the packets out of the home and back.

        Watch [[router]] as the request leaves. It changes something on the packet. The next step explains what.

        (Real devices first look up a site's IP address from its name. Here, they already know it.)
      `,
      setup: ready,
      focus: ['phone', 'router', 'isp', 'video'],
      actions: [phoneVideo],
      goals: [
        { id: 'gateway', label: 'Open [[phone]] and find its default gateway', hint: 'Click the phone. The default gateway is in the Inspect tab.', check: inspected('phone') },
        {
          id: 'video',
          label: 'The video loads on [[phone]]',
          hint: 'Press **Phone opens the video site**. The page pops up next to the phone.',
          check: ({ sim, since }) => pageSince(sim, 'phone', since, (b) => b.status === 'loaded' && b.title === PAGES.cats.title),
        },
      ],
      questions: [
        {
          id: 'sort',
          kind: 'choice',
          multi: true,
          prompt: 'The phone has packets for these "to" addresses. Which ones does it send to its default gateway? Pick all that apply.',
          options: [
            { id: 'video', text: '198.51.100.20', correct: true },
            { id: 'school', text: '192.0.2.30', correct: true },
            { id: 'home-11', text: '192.168.1.11', feedback: "192.168.1.11 starts with 192.168.1, so it's on the home network. The phone sends it straight there." },
            { id: 'home-12', text: '192.168.1.12', feedback: '192.168.1.12 is a home address. The phone delivers it itself, without the router.' },
          ],
          explain: 'Home addresses here all start with 192.168.1, and the phone delivers those itself. Everything else goes to the default gateway to leave the home, even 192.0.2.30, which also starts with 192.',
        },
      ],
    },

    {
      id: 'nat',
      title: 'One address for the whole home',
      body: md`
        The internet provider gives the whole home one address on the internet, its **public address**: 203.0.113.25, on the router's internet port.

        Addresses that start with 192.168 are **private addresses**. Millions of homes use the same ones, so the internet can't deliver to them. Out on the internet, a packet needs the home's public address.

        So the router swaps addresses. When a packet leaves the home, the router:

        1. Replaces the device's private "from" address with the home's public address.
        2. Gives the packet a tracking number, and writes a line in its list: which device sent it, with which number, to whom.

        The tracking number is called a **port number**. That's a second meaning of "port": a number on a packet, not a socket for a cable. When an answer comes back to that number, the router finds the line, puts back the device's private address, and sends the answer to the device that asked. This is **NAT** (network address translation).

        It works like mail to an apartment building. Every letter has the same street address, and the apartment number tells the front desk whose it is.

        Press **Phone and laptop browse at once**. Both ask the same video site for different videos at the same moment. Then open the laptop's answer in the **Capture** tab: its details show how the router changed its "to" address. Last, click [[router]] and find **Address sharing (NAT)**.

        (These sites use plain HTTP, so you can read their pages in the capture. Real sites use HTTPS, which scrambles them.)
      `,
      setup: ready,
      focus: ['router', 'phone', 'laptop', 'video'],
      actions: [bothBrowse],
      goals: [
        {
          id: 'both',
          label: '[[phone]] and [[laptop]] each get their own video',
          hint: 'Press **Phone and laptop browse at once**. Watch the router send each answer to the device that asked.',
          check: ({ sim, since }) => bothLoaded(sim, since),
        },
        {
          id: 'answer',
          label: "Open the laptop's answer in the **Capture** tab",
          hint: 'In the Capture tab, click the newest HTTP row from 198.51.100.20. Read the note under the IP packet.',
          check: openedFrame('laptop', (f) => f.ip?.app.kind === 'http-res' && !!f.ip.nat),
        },
        {
          id: 'table',
          label: 'Find **Address sharing (NAT)** on [[router]] after both answers arrive',
          hint: "Click the router. Each line is one device's conversation with the video site.",
          check: (c) => inspected('router')(c) && bothLoaded(c.sim, c.since),
        },
      ],
      questions: [
        {
          id: 'match',
          kind: 'choice',
          prompt: "Both answers came to the home's public address, 203.0.113.25. How did the router know which one was the phone's?",
          options: [
            { id: 'port', text: "Each answer's port number matched a line in its list", correct: true },
            { id: 'private', text: "The phone's private address was on the answer", feedback: 'On the internet, the answer\'s "to" address was the home\'s public address. The phone\'s private address never left the home.' },
            { id: 'both', text: 'It sent both answers to both devices', feedback: 'Then the laptop would get a cat video it never asked for. Check the capture: the laptop got only its own answer.' },
            { id: 'mac', text: "The phone's MAC address was on the answer", feedback: "MAC addresses travel only inside one network. The video site never learns the phone's MAC address." },
          ],
          explain: 'The router gave each request its own port number and wrote down which device sent it. The answers came back to those numbers, so the router looked up who asked.',
        },
      ],
    },

    {
      id: 'stranger',
      title: 'Nobody asked for this',
      body: md`
        The list protects the home, too. A packet from the internet gets in only if it answers something a device in the home sent.

        Press **A stranger knocks**. [[stranger]], out on the internet, sends a packet to the home's public address. Nobody in the home asked for it, so the router's list has no line for it. The router **drops** it: it throws the packet away.

        The router writes what it did in its **log**, a list of events with the time of each. Open the **Logs** tab and click the line about the dropped packet.

        Some games ask you to set up **port forwarding**: a line you add to the list by hand, so packets for one port number go to one device even when nobody asked. That opens a door on purpose, so add one only when you need it.

        (Address sharing is not a full firewall. A later lab builds one.)
      `,
      setup: ready,
      focus: ['stranger', 'router'],
      tools: [{ kind: 'logs', devices: ['router'] }],
      actions: [strangerKnocks],
      goals: [
        {
          id: 'dropped',
          label: "[[router]] drops the stranger's packet",
          hint: 'Press **A stranger knocks** and watch the router.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'drop' && e.device === 'router' && e.reason === 'unsolicited'),
        },
        {
          id: 'log',
          label: "Open the router's log line about it",
          hint: 'Open the Logs tab and click the line that starts with Blocked.',
          check: openedLog((e) => e.source === 'nat' && e.fields?.action === 'drop'),
        },
      ],
      questions: [
        {
          id: 'why',
          kind: 'choice',
          prompt: "Why did the router drop the stranger's packet?",
          options: [
            { id: 'no-line', text: 'It matched no line in the list: nobody inside asked for it', correct: true },
            { id: 'password', text: "The stranger didn't know the Wi-Fi password", feedback: 'The packet came in through the internet port, not over Wi-Fi. The Wi-Fi password guards only the radio.' },
            { id: 'wrong-address', text: 'It was sent to the wrong address', feedback: "The address was right: 203.0.113.25 is the home's public address. That's how it reached the router." },
            { id: 'off', text: 'The devices in the home were all turned off', feedback: 'The laptop, phone, and TV were on. The router never passed the packet to any of them.' },
          ],
          explain: "The router lets in answers to packets that left the home. The stranger's packet answered nothing, so no line in the list said where it should go.",
        },
        {
          id: 'protect',
          kind: 'choice',
          prompt: 'How does this protect the laptop, phone, and TV?',
          options: [
            { id: 'start', text: "Strangers on the internet can't start a conversation with them", correct: true },
            { id: 'hide', text: "It hides the home's public address from everyone", feedback: "The stranger knew the public address, and the packet reached the router. What it couldn't reach was a device inside." },
            { id: 'all', text: 'It blocks every packet that comes from the internet', feedback: "Answers to the family's own requests get through, like the videos in step 8." },
            { id: 'scramble', text: 'It scrambles their packets so nobody can read them', feedback: "That's what WPA2 and WPA3 do on the Wi-Fi. Address sharing doesn't scramble anything." },
          ],
          explain: "A device in the home can reach out, and the answers come back in. Nobody outside can reach in first. That's one reason home devices are hard to reach from the internet.",
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        Look back at how the box sends every packet to the right place. The router hands out addresses, the switch sends each packet toward its device, and the router shares one public address with the whole home.
      `,
      questions: [
        {
          id: 'answer-path',
          kind: 'text',
          prompt: 'Explain how an answer from the internet reaches the right device in the home. Use the words public address, port number, and private address.',
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
