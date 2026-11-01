import type { Sim } from '../../sim/sim';
import { capturedSince, happened, inspected, isEncrypted, isPlainLogin, openedFrame, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import { buildCafe, enableWpa2, IP, LOGIN_BODY, MAC } from './scenario';

const login: ActionDef = {
  id: 'login',
  label: 'Alice signs in',
  run: (sim) => sim.browse('alice', 'http://bank.example/login', LOGIN_BODY),
};

const loginHttps: ActionDef = {
  id: 'login-https',
  label: 'Alice signs in with HTTPS',
  run: (sim) => sim.browse('alice', 'https://bank.example/login', LOGIN_BODY),
};

// Step setups put the network in the state a step needs, in case the student
// reset it. Each one checks first, so running it twice changes nothing.

function ensureSniffing(sim: Sim): void {
  if (!sim.dev('mallory').sniffing) sim.setSniffing('mallory', true);
}

function ensurePoisoned(sim: Sim): void {
  enableWpa2(sim);
  ensureSniffing(sim);
  const alice = sim.dev('alice').arp[IP.router];
  if (alice?.mac !== MAC.mallory && alice?.via !== 'static') sim.arpSpoof('mallory', 'alice', IP.router);
  if (sim.dev('router').arp[IP.alice]?.mac !== MAC.mallory) sim.arpSpoof('mallory', 'router', IP.alice);
}

function ensureInTheMiddle(sim: Sim): void {
  ensurePoisoned(sim);
  if (!sim.dev('mallory').forwarding) sim.setForwarding('mallory', true);
}

export const onPathLab: LabDef = {
  id: 'on-path',
  version: 1,
  title: 'Traffic in the Wrong Hands',
  tagline: 'Sniff a password on café Wi-Fi, then become the man in the middle. Then stop yourself.',
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves', '3.2 Traffic in the Wrong Hands', '3.7 Locking Down the Airwaves'],
  ced: ['3.1.A', '3.1.B', '3.2.B', '3.5.E'],
  minutes: 45,
  objectives: [
    'Explain the difference between an IP address and a MAC address.',
    'Capture plaintext traffic on an open wireless network.',
    'Explain how ARP poisoning puts an attacker on the path between two devices.',
    'Compare WPA2, HTTPS, and static ARP entries as defenses.',
  ],
  build: buildCafe,
  captureDevice: 'mallory',
  labelMacs: true,
  steps: [
    {
      id: 'welcome',
      title: 'Meet the café',
      body: md`
        [[alice]] sits down at Riverside Café and opens her laptop to check her bank account. Two other people share the café Wi-Fi: [[sam]] and [[mallory]].

        In this lab you play Mallory. First you will try to read Alice's password as it crosses the network. Then you will switch sides and stop the attack.

        Every device on this network has two addresses:

        - An **IP address**, like \`192.168.1.10\`, says where a device sits on the internet. It changes when the device joins a different network.
        - A **MAC address**, like \`0a:11:ce:00:00:10\`, belongs to the network card itself. Devices on the same local network use it to hand frames to each other.

        Click [[alice]] on the map to look inside her laptop. Then click [[mallory]].

        > Everything in this lab happens inside a simulation. Capturing other people's traffic on a real network without permission is illegal.
      `,
      focus: ['alice', 'mallory'],
      goals: [
        { id: 'alice', label: 'Open [[alice]] in the inspector', check: inspected('alice') },
        { id: 'mallory', label: 'Open [[mallory]] in the inspector', check: inspected('mallory') },
      ],
      questions: [
        {
          id: 'which-changes',
          kind: 'choice',
          prompt: 'Alice takes her laptop to the library and joins its Wi-Fi. Which of her addresses changes?',
          options: [
            { id: 'ip', text: 'Her IP address', correct: true },
            { id: 'mac', text: 'Her MAC address', feedback: 'The MAC address belongs to the network card. The card goes with the laptop.' },
            { id: 'both', text: 'Both addresses', feedback: 'One of the two belongs to the hardware. Which one?', last: true },
            { id: 'neither', text: 'Neither address', feedback: 'The library network uses different IP addresses than the café.', last: true },
          ],
          explain: 'The IP address depends on the network Alice joins. The MAC address belongs to her network card, so it goes wherever the laptop goes.',
        },
      ],
    },

    {
      id: 'normal',
      title: 'A normal sign-in',
      body: md`
        Start with a sign-in where nobody interferes.

        Press **Alice signs in**. Her laptop sends her username and password to \`bank.example\`. Watch the packets cross the map. Use the speed buttons or pause, and click any packet to read it.

        Alice's laptop does not know the router's MAC address yet. Before it sends anything, it broadcasts an **ARP request** to every device on the Wi-Fi: "Who has 192.168.1.1?" The router answers with an **ARP reply**.
      `,
      focus: ['alice', 'wifi', 'router'],
      open: { inspect: 'alice' },
      actions: [login],
      goals: [
        {
          id: 'arp',
          label: "Alice learns the router's MAC address",
          hint: 'Press **Alice signs in** and watch the ARP packets first.',
          check: ({ sim }) => sim.dev('alice').arp[IP.router]?.mac === MAC.router,
        },
        {
          id: 'loaded',
          label: "Alice's bank page loads",
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.status === 'loaded'),
        },
      ],
      questions: [
        {
          id: 'why-arp',
          kind: 'choice',
          prompt: 'Why did Alice send an ARP request before her login?',
          options: [
            { id: 'mac', text: "She needed the router's MAC address to hand the packet to the router.", correct: true },
            { id: 'ip', text: "She needed the bank's IP address.", feedback: "ARP only works on the local network. The bank isn't on the café network." },
            { id: 'pass', text: 'She was checking her password.', feedback: 'ARP knows nothing about passwords.' },
            { id: 'permission', text: 'She was asking permission to use the Wi-Fi.', feedback: 'Open Wi-Fi asks no permission at all.' },
          ],
          explain:
            "The packet is addressed to the bank's IP, but it leaves the café through the router. Alice needs the router's MAC address to put the packet in a frame the router will accept.",
        },
      ],
    },

    {
      id: 'sniff',
      title: 'Listen in',
      body: md`
        The café Wi-Fi is **open**: no password and no encryption. Radio reaches every device in the room, so every network card receives every frame. Normally a card ignores frames addressed to another MAC address.

        A **packet sniffer** keeps those frames instead.

        1. Open the **Toolkit** tab and turn on packet capture for [[mallory]].
        2. Press **Alice signs in**.
        3. Open the **Capture** tab and click the packet that carries the login.
      `,
      focus: ['mallory', 'wifi'],
      open: 'tools',
      tools: [{ kind: 'sniffer', device: 'mallory' }],
      actions: [login],
      goals: [
        { id: 'on', label: 'Turn on packet capture for [[mallory]]', check: ({ sim }) => sim.dev('mallory').sniffing },
        {
          id: 'caught',
          label: "Capture Alice's login",
          hint: 'Turn capture on first. Then press **Alice signs in**.',
          check: ({ sim, since }) => capturedSince(sim, 'mallory', since, isPlainLogin),
        },
        {
          id: 'opened',
          label: 'Open the login packet in the Capture tab',
          hint: 'In the **Capture** tab, click the HTTP row with **POST** in the Info column.',
          check: openedFrame('mallory', isPlainLogin),
        },
      ],
      questions: [
        {
          id: 'password',
          kind: 'text',
          prompt: "What is Alice's password?",
          lines: 1,
          expect: /^pumpkinspice$/i,
          expectHint: 'Open the HTTP layer of the POST packet. The password comes after pass=.',
          explain: 'Anyone on this Wi-Fi with a sniffer could read it.',
        },
      ],
    },

    {
      id: 'why',
      title: 'Why that worked',
      body: md`
        Two things went wrong for Alice.

        1. **Open Wi-Fi** delivers every frame to every device in range.
        2. **HTTP** sends the form in **plaintext**. Anyone who holds a copy can read it.

        Reading traffic as it passes is called **eavesdropping**, and the tool is a **packet sniffer**. Sniffing is **passive**: Mallory sent nothing at all.
      `,
      questions: [
        {
          id: 'unnoticed',
          kind: 'text',
          prompt: "Alice's bank page looked normal. Explain why Alice had no way to tell that Mallory read her password.",
          minWords: 15,
        },
        {
          id: 'one-change',
          kind: 'choice',
          prompt: "Which single change would have kept the password secret from Mallory's sniffer?",
          options: [
            { id: 'https', text: 'The bank uses HTTPS.', correct: true },
            { id: 'longer', text: 'Alice picks a longer password.', feedback: 'A longer password in plaintext is still plaintext.' },
            { id: 'far', text: 'Mallory sits at a table farther away.', feedback: 'Wi-Fi reaches the whole café.' },
            { id: 'tabs', text: 'Alice closes her other browser tabs.', feedback: 'Other tabs have nothing to do with this packet.' },
          ],
          explain: "HTTPS encrypts everything between Alice's browser and the bank. Mallory still captures the packets but can't read them.",
        },
      ],
    },

    {
      id: 'wpa2',
      title: 'Lock the Wi-Fi',
      body: md`
        The café owner reads about sniffing and turns on **WPA2**. Each device now joins with the Wi-Fi password and gets its own encryption key. The access point sends each frame only to the device it is addressed to. On the map, the Wi-Fi now behaves like a **switch** instead of a hub.

        Mallory is still capturing. Press **Alice signs in** and check the Capture tab.

        Then open [[wifi]]. Its **MAC address table** records which port leads to each device.
      `,
      setup: (sim) => {
        enableWpa2(sim);
        ensureSniffing(sim);
      },
      focus: ['wifi', 'mallory'],
      tools: [{ kind: 'sniffer', device: 'mallory' }],
      actions: [login],
      goals: [
        {
          id: 'quiet',
          label: 'Alice signs in while Mallory captures no password',
          hint: "Leave Mallory's capture on and press **Alice signs in**.",
          check: ({ sim, ev, since }) =>
            ev?.type === 'page' &&
            ev.device === 'alice' &&
            ev.browser.status === 'loaded' &&
            ev.browser.startedAt >= since &&
            sim.dev('mallory').sniffing &&
            !capturedSince(sim, 'mallory', since, isPlainLogin),
        },
        { id: 'table', label: "Open [[wifi]] and read its MAC address table", check: inspected('wifi') },
      ],
      questions: [
        {
          id: 'why-blocked',
          kind: 'choice',
          prompt: "Mallory's sniffer is still on. Why didn't it capture Alice's login this time?",
          options: [
            { id: 'switch', text: 'The access point now sends each frame only to the device it is addressed to.', correct: true },
            {
              id: 'https',
              text: 'WPA2 turned the login into HTTPS.',
              feedback: 'The bank connection is still plain HTTP. WPA2 protects the radio link inside the café.',
            },
            { id: 'pass', text: 'Alice changed her password.', feedback: 'She used the same password.' },
            { id: 'broken', text: "Mallory's network card stopped working.", feedback: 'Check the Capture tab. Mallory still receives some frames.' },
          ],
          explain:
            'With WPA2 each device has its own key, and the access point delivers frames by MAC address. Mallory now receives only frames meant for her, plus broadcasts like ARP requests.',
        },
      ],
    },

    {
      id: 'arp',
      title: 'ARP believes anyone',
      body: md`
        Mallory can't overhear Alice anymore. To read Alice's traffic now, she has to get Alice to send it to her.

        Think back to step 2. Alice asked who had 192.168.1.1, and she believed the answer. ARP has no way to check who sent a reply. Most devices also accept ARP replies they never asked for, and they overwrite their table with whatever the reply says.

        Open [[alice]] and find her **ARP table**.
      `,
      focus: ['alice'],
      goals: [{ id: 'look', label: "Open [[alice]] and find her ARP table", check: inspected('alice') }],
      questions: [
        {
          id: 'where',
          kind: 'choice',
          prompt: "Suppose Alice's ARP table said 192.168.1.1 is at `0e:ba:d0:00:00:66`, which is Mallory's MAC address. Where would Alice's next login go?",
          options: [
            { id: 'mallory', text: "To Mallory's laptop", correct: true },
            { id: 'router', text: 'To the router, as usual', feedback: 'Alice looks up the MAC address for 192.168.1.1. Whose MAC is in that row?' },
            { id: 'bank', text: 'Straight to the bank', feedback: 'Alice still sends everything for the internet through 192.168.1.1.' },
            { id: 'nowhere', text: 'Nowhere. It would fail right away.', feedback: "Mallory's MAC address is a real address on this network." },
          ],
          explain:
            "Alice still means to send the packet through the router. But her laptop builds the frame with whatever MAC address the ARP table lists for 192.168.1.1, and that's Mallory's.",
        },
      ],
    },

    {
      id: 'poison',
      title: 'Poison the ARP tables',
      body: md`
        **ARP poisoning** (also called ARP spoofing) means sending forged ARP replies so a device stores the wrong MAC address.

        Mallory has to fool both ends of the conversation:

        - Tell [[alice]] that the router's IP address, 192.168.1.1, is at Mallory's MAC.
        - Tell [[router]] that Alice's IP address, 192.168.1.10, is at Mallory's MAC.

        Use the **ARP spoofer** in the Toolkit. Pick who to fool, then type the IP address Mallory pretends to own. Forged packets show in red on the map. Real networks don't color them. This simulator does so you can follow them.
      `,
      focus: ['alice', 'router', 'mallory'],
      open: 'tools',
      tools: [
        { kind: 'arp-spoof', device: 'mallory', victims: ['alice', 'router'] },
      ],
      goals: [
        {
          id: 'alice',
          label: "[[alice]] thinks the router is at Mallory's MAC",
          hint: 'Tell **Alice** that **192.168.1.1 (the router)** is at your MAC.',
          check: ({ sim }) => sim.dev('alice').arp[IP.router]?.mac === MAC.mallory,
        },
        {
          id: 'router',
          label: "[[router]] thinks Alice is at Mallory's MAC",
          hint: 'Tell **Café router** that **192.168.1.10 (Alice)** is at your MAC.',
          check: ({ sim }) => sim.dev('router').arp[IP.alice]?.mac === MAC.mallory,
        },
      ],
    },

    {
      id: 'broken',
      title: 'Something breaks',
      body: md`
        Both ARP tables now point at Mallory. Press **Alice signs in** and follow her packets.
      `,
      setup: ensurePoisoned,
      focus: ['alice', 'mallory'],
      actions: [login],
      goals: [
        {
          id: 'dropped',
          label: "Alice's login reaches Mallory and goes no further",
          hint: 'Press **Alice signs in** and watch where the packet stops.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'drop' && e.device === 'mallory' && e.reason === 'not-forwarding'),
        },
      ],
      questions: [
        {
          id: 'why-broken',
          kind: 'choice',
          prompt: "Alice's page never loads. Why?",
          options: [
            { id: 'drop', text: "Mallory's laptop received the packet but isn't set up to pass it on.", correct: true },
            { id: 'bank', text: 'The bank went down.', feedback: "The packet never left the café. Look where it stopped." },
            { id: 'wpa2', text: 'WPA2 blocked the forged ARP reply.', feedback: "Open Alice's ARP table. The forged reply worked." },
            { id: 'typo', text: 'Alice typed the wrong password.', feedback: 'The bank never saw her password.' },
          ],
          explain:
            "A normal computer drops packets addressed to someone else's IP. Alice loses her connection. That's a kind of denial of service, and Alice would notice it.",
        },
      ],
    },

    {
      id: 'relay',
      title: 'Become the middle',
      body: md`
        To stay hidden, Mallory has to pass each packet along after she reads it. Turn on **IP forwarding** for Mallory in the Toolkit. Then press **Alice signs in** again.

        This is a **man-in-the-middle attack**, also called an **on-path attack**. Mallory sits between Alice and the router, reads everything, and relays it so the connection keeps working.
      `,
      setup: ensurePoisoned,
      focus: ['alice', 'mallory', 'router'],
      open: 'tools',
      tools: [{ kind: 'forwarding', device: 'mallory' }, { kind: 'sniffer', device: 'mallory' }],
      actions: [login],
      goals: [
        { id: 'fwd', label: 'Turn on IP forwarding for [[mallory]]', check: ({ sim }) => sim.dev('mallory').forwarding },
        {
          id: 'loaded',
          label: "Alice's bank page loads",
          hint: 'Turn on forwarding first, then press **Alice signs in**.',
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.status === 'loaded'),
        },
        {
          id: 'caught',
          label: "Mallory captures Alice's password on the way through",
          hint: "Check that Mallory's packet capture is still on.",
          check: ({ sim, since }) => capturedSince(sim, 'mallory', since, isPlainLogin),
        },
      ],
      questions: [
        {
          id: 'compare',
          kind: 'text',
          prompt: 'Compare this attack to the sniffing in step 3. What did Mallory have to do this time that she did not do before, and why?',
          minWords: 20,
        },
      ],
    },

    {
      id: 'https',
      title: 'Try HTTPS',
      body: md`
        Mallory is still in the middle. This time Alice signs in with **HTTPS**. Her browser and the bank agree on a secret key, and **TLS** encrypts everything inside the connection.

        Press **Alice signs in with HTTPS**. Then find the packet in Mallory's capture and open it.
      `,
      setup: ensureInTheMiddle,
      focus: ['alice', 'mallory'],
      tools: [{ kind: 'sniffer', device: 'mallory' }],
      actions: [loginHttps],
      goals: [
        {
          id: 'loaded',
          label: "Alice's HTTPS page loads",
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.secure && b.status === 'loaded'),
        },
        {
          id: 'opened',
          label: 'Open an encrypted packet in the Capture tab',
          hint: 'In the **Capture** tab, click a row marked **HTTPS**.',
          check: openedFrame('mallory', isEncrypted),
        },
      ],
      questions: [
        {
          id: 'metadata',
          kind: 'choice',
          multi: true,
          prompt: 'Mallory is still in the middle. What can she still learn from the HTTPS packets?',
          options: [
            { id: 'ips', text: "Alice's IP address and the bank's IP address", correct: true },
            { id: 'when', text: 'When Alice connected and about how much data she sent', correct: true },
            { id: 'pass', text: "Alice's password", feedback: 'Open the packet again. The HTTP layer is scrambled.' },
            { id: 'balance', text: "Alice's account balance", feedback: 'The page comes back inside the same encrypted connection.' },
          ],
          explain:
            'Encryption hides the contents. The IP header stays readable so routers can deliver the packet. Who talked to whom, when, and how much is called metadata, and HTTPS does not hide it.',
        },
      ],
    },

    {
      id: 'detect',
      title: 'Spot it and stop it',
      body: md`
        Switch sides. You are now the café's IT person.

        ARP poisoning leaves a fingerprint. Open [[router]] and read its ARP table. Two different IP addresses point to the same MAC address.

        One fix is a **static ARP entry**: the correct MAC address, typed in by hand and locked. A locked entry ignores ARP replies. Larger networks use a switch feature called **Dynamic ARP Inspection** to run the same check on every ARP reply.

        1. Find the router's real MAC address. Open [[router]] and read its **Addresses** table. Use the MAC address on the port with IP address 192.168.1.1.
        2. In the Toolkit, use **Lock ARP entries** to lock 192.168.1.1 to that MAC on Alice's laptop.
        3. Use the ARP spoofer to poison Alice again.
      `,
      setup: ensureInTheMiddle,
      focus: ['router', 'alice'],
      tools: [{ kind: 'static-arp', device: 'alice' }, { kind: 'arp-spoof', device: 'mallory', victims: ['alice', 'router'] }],
      goals: [
        { id: 'spot', label: 'Open [[router]] and find the repeated MAC address', check: inspected('router') },
        {
          id: 'lock',
          label: "Lock the router's MAC address on [[alice]]",
          hint: "Alice's ARP table shows Mallory's MAC right now, so don't copy it from there. Open the router and copy the MAC from its Addresses table.",
          check: ({ sim }) => {
            const e = sim.dev('alice').arp[IP.router];
            return e?.via === 'static' && e.mac === MAC.router;
          },
        },
        {
          id: 'reject',
          label: 'Alice ignores a forged ARP reply',
          hint: 'In the ARP spoofer, tell **Alice** that **192.168.1.1** is at your MAC.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'arp-rejected' && e.device === 'alice'),
        },
      ],
      questions: [
        {
          id: 'which-mac',
          kind: 'choice',
          prompt: "In the router's ARP table, which MAC address shows up twice?",
          options: [
            { id: 'mallory', text: `${MAC.mallory} (Mallory)`, correct: true },
            { id: 'alice', text: `${MAC.alice} (Alice)`, feedback: "Read the router's table again. Alice's real MAC may not be in it at all." },
            { id: 'sam', text: `${MAC.sam} (Sam)`, feedback: 'Sam was never part of the attack.' },
            { id: 'router', text: `${MAC.router} (the router)`, feedback: "The router doesn't list itself." },
          ],
          explain: "Mallory's MAC sits next to both her own IP and Alice's IP. One device claiming two IP addresses is a classic sign of ARP poisoning.",
        },
      ],
    },

    {
      id: 'defenses',
      title: 'Choose a defense',
      body: md`
        You saw three defenses in this lab:

        - **WPA2** on the Wi-Fi
        - **HTTPS** on the website
        - **Static ARP entries** (or Dynamic ARP Inspection) on the network

        Each one stopped a different part of the attack.
      `,
      questions: [
        {
          id: 'pick-one',
          kind: 'text',
          prompt:
            'The café can afford only one of the three defenses. Pick one. Explain what it stops, and name one attack from this lab that it does not stop.',
          minWords: 40,
          lines: 6,
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
