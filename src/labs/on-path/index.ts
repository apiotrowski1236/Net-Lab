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

/** Steps that ask for a fresh capture start with Mallory's list empty, so old packets can't be mistaken for new ones. */
function freshCapture(sim: Sim): void {
  sim.clearCapture('mallory');
}

export const onPathLab: LabDef = {
  id: 'on-path',
  version: 4,
  title: 'On-Path Attacks: Sniffing and ARP Poisoning',
  tagline: 'Sniff a password on café Wi-Fi, put yourself between two devices with ARP poisoning, and see what WPA2, HTTPS, and static ARP entries stop.',
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves', '3.2 Traffic in the Wrong Hands', '3.7 Locking Down the Airwaves'],
  ced: ['3.1.A', '3.1.B', '3.2.B', '3.5.E'],
  minutes: 50,
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

        In this lab you play Mallory. First you will listen in on Alice's traffic. Then you will try an **on-path attack**: getting between Alice and the router, so all her traffic passes through you. Last, you will switch sides and stop it.

        Every device on this network has two addresses:

        - An **IP address**, like \`192.168.1.10\`, says where a device sits on its network. It changes when the device joins a different network.
        - A **MAC address**, like \`0a:11:ce:00:00:10\`, belongs to the network card itself. Devices on the same local network use it to hand each other **frames**: packets with MAC addresses on the outside.

        Click [[alice]], here or on the map, to look inside her laptop. Then click [[mallory]]. Find the two addresses in each one. You can skip the rest for now, like the /24 after the IP address and the Port column. (Mallory's ARP table is already full because she has been watching the network. You will learn about ARP tables in step 2.)

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
          explain:
            'The IP address depends on the network Alice joins. The MAC address belongs to her network card, so it goes wherever the laptop goes. (Many phones and laptops now make up a new MAC address for each Wi-Fi network, for privacy. In this lab, each card keeps its own.)',
        },
      ],
    },

    {
      id: 'normal',
      title: 'A normal sign-in',
      body: md`
        Start with a normal sign-in, with no attacker.

        Press **2×** above the map to speed up the packets. Then press **Alice signs in**. Her laptop sends her username and password to \`bank.example\`. Watch the packets cross the map. You can click any packet to read it.

        Alice's laptop does not know the router's MAC address yet. Before it sends anything, it **broadcasts** an **ARP request**, a question sent to every device on the Wi-Fi: "Who has 192.168.1.1?" Watch for **not for me** over Sam and Mallory. They got the question too. The router answers with an **ARP reply**.
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
            { id: 'ip', text: "She needed to look up the bank's IP address.", feedback: "ARP only works on the local network. The bank isn't on the café network." },
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
          expect: /^\s*pumpkinspice\s*$/,
          expectHint: 'Open the HTTP layer of the POST packet. The password comes after pass=. Copy it exactly. Capital letters count.',
          explain:
            'Two things let Mallory read it. On **open Wi-Fi**, every device can read every frame. And **HTTP** sends the form in **plaintext**: readable text with no scrambling. Sites that use **HTTPS** encrypt the form first, so only the bank can read it. You will try HTTPS in step 9.',
        },
        {
          id: 'unnoticed',
          kind: 'choice',
          prompt: "Alice's bank page looked normal. Why couldn't Alice tell that Mallory read her password?",
          options: [
            { id: 'passive', text: 'Mallory only kept copies, so nothing changed for Alice.', correct: true },
            { id: 'fast', text: 'Mallory read the password too fast for Alice to notice.', feedback: 'Speed has nothing to do with it. Think about what Mallory sent to Alice.' },
            { id: 'hidden', text: 'The bank hid a security warning from Alice’s screen.', feedback: 'There was no warning to hide. The bank never knew either.' },
            { id: 'locked', text: 'The password was encrypted, so the page looked normal.', feedback: 'It was plaintext. You read it yourself.' },
          ],
          explain:
            "Reading traffic as it passes is called **eavesdropping**. Sniffing is **passive**: Mallory sent nothing, so Alice's packets reach the bank the same way they always do.",
        },
      ],
    },

    {
      id: 'wpa2',
      title: 'Lock the Wi-Fi',
      body: md`
        The café owner turns on **WPA2**, a kind of Wi-Fi encryption. Everyone joins with the password on the chalkboard. Then each device gets its own secret **key**, shared only with the access point (the Café Wi-Fi box).

        The radio still reaches every device. But each device's frames, both to it and from it, are locked with that device's own key. The other devices can't read them. Only the MAC addresses on the outside stay readable, so the frame can be delivered. (The map still labels each packet with what is inside, so you can follow it. The other devices get only the locked frame.)

        Mallory's capture is still on, and her list starts over in this step. Press **Alice signs in**. Then open one of the dark **WPA2** packets in the Capture tab.
      `,
      setup: (sim) => {
        enableWpa2(sim);
        ensureSniffing(sim);
        freshCapture(sim);
      },
      focus: ['wifi', 'mallory'],
      tools: [{ kind: 'sniffer', device: 'mallory' }],
      actions: [login],
      goals: [
        {
          id: 'quiet',
          label: "Alice signs in, and Mallory's capture shows no password",
          hint: "Leave Mallory's capture on and press **Alice signs in**.",
          check: ({ sim, ev, since }) =>
            ev?.type === 'page' &&
            ev.device === 'alice' &&
            ev.browser.status === 'loaded' &&
            ev.browser.startedAt >= since &&
            sim.dev('mallory').sniffing &&
            !capturedSince(sim, 'mallory', since, isPlainLogin),
        },
        {
          id: 'sealed',
          label: 'Open an encrypted Wi-Fi frame in the Capture tab',
          hint: 'In the **Capture** tab, click a row marked **WPA2**.',
          check: openedFrame('mallory', (f) => !!f.sealed),
        },
      ],
      questions: [
        {
          id: 'why-blocked',
          kind: 'choice',
          prompt: "Mallory's sniffer caught Alice's frames again. Why can't she read the login this time?",
          options: [
            { id: 'key', text: "Each frame is locked with Alice's own key.", correct: true },
            {
              id: 'https',
              text: "WPA2 turned Alice's bank login into an HTTPS login.",
              feedback: 'The bank connection is still plain HTTP. That is why her browser still says Not secure. WPA2 only locks the radio trip between Alice and the access point.',
            },
            { id: 'radio', text: "Mallory's radio can no longer hear Alice's laptop.", feedback: "Mallory's capture has Alice's frames, so the radio still reaches her." },
            {
              id: 'pass',
              text: "Mallory doesn't know the café's new Wi-Fi password.",
              feedback: "The password is on the chalkboard, and Mallory is on the Wi-Fi. She doesn't have Alice's own key.",
            },
          ],
          explain:
            'WPA2 gives each device its own key. Mallory can open frames sent to her, plus broadcasts like ARP requests, which every device on the Wi-Fi can read. (On a real network, someone who knows the Wi-Fi password and catches Alice joining can sometimes find her key. WPA3 fixes that.)',
        },
      ],
    },

    {
      id: 'arp',
      title: 'ARP believes anyone',
      body: md`
        Mallory can't read Alice's frames anymore. To read Alice's traffic now, she has to get Alice to send it to her. Frames sent to Mallory are locked with Mallory's own key, and she has that one.

        Think back to step 2. Alice asked who had 192.168.1.1, and she believed the answer. ARP has no way to check who sent a reply. Most devices also accept ARP replies they never asked for, and they overwrite their table with whatever the reply says.

        Open [[alice]] and scroll to her **ARP table**.
      `,
      focus: ['alice'],
      goals: [{ id: 'look', label: 'Open [[alice]] in the inspector', check: inspected('alice') }],
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
        **ARP poisoning** (also called ARP spoofing) means sending **forged** (fake) ARP replies so a device stores the wrong MAC address.

        Mallory has to fool both ends of the conversation:

        - Tell [[alice]] that the router's IP address, 192.168.1.1, is at Mallory's MAC.
        - Tell [[router]] that Alice's IP address, 192.168.1.10, is at Mallory's MAC.

        Use the **ARP spoofer** in the Toolkit. Pick who to fool, then type the IP address Mallory pretends to own. Forged packets show in red on the map. (Real networks don't color them. The simulator does, so you can follow them.)
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

        Mallory's capture will show the password, because the login now comes to her. But watch what happens to Alice's page. A device **drops** a packet when it throws it away.
      `,
      setup: ensurePoisoned,
      focus: ['alice', 'mallory'],
      open: { inspect: 'alice' },
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
            { id: 'drop', text: "Mallory's laptop received the packet and threw it away.", correct: true },
            { id: 'bank', text: "The bank's website stopped working.", feedback: "The packet never left the café. Look where it stopped." },
            { id: 'wpa2', text: 'WPA2 blocked the forged ARP reply.', feedback: "Open Alice's ARP table. The forged reply worked." },
            { id: 'typo', text: 'Alice typed the wrong password.', feedback: 'The bank never saw her password.' },
          ],
          explain:
            "A normal computer drops packets addressed to someone else's IP. Alice loses her connection. An attack that stops someone from using a service is called a **denial of service**, and Alice would notice it.",
        },
      ],
    },

    {
      id: 'relay',
      title: 'Become the middle',
      body: md`
        To stay hidden, Mallory has to pass each packet along after she reads it. Her capture list starts over in this step.

        1. Turn on **IP forwarding** for Mallory in the Toolkit.
        2. Press **Alice signs in** again. (Her sign-in from step 7 never finished.) Use **1×** for this one, and watch the login go from Alice to Mallory, then on to the router.

        This is the **on-path attack**, also called a **man-in-the-middle attack**. Mallory sits between Alice and the router, reads everything, and passes it on so the connection keeps working.
      `,
      setup: (sim) => {
        ensurePoisoned(sim);
        freshCapture(sim);
      },
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
          hint: "Turn on forwarding, and check that Mallory's packet capture is still on.",
          check: ({ sim, ev }) => ev?.type === 'captured' && ev.device === 'mallory' && isPlainLogin(ev.frame) && sim.dev('mallory').forwarding,
        },
      ],
      questions: [
        {
          id: 'compare',
          kind: 'text',
          prompt: 'Compare this attack to the sniffing in step 3. What did Mallory have to do this time that she did not do before, and why?',
          minWords: 15,
        },
      ],
    },

    {
      id: 'https',
      title: 'Try HTTPS',
      body: md`
        Mallory is still in the middle. This time Alice signs in with **HTTPS**, which is HTTP sent inside **TLS**, a layer of encryption. Alice's browser and the bank agree on a secret key. The bank also shows a **certificate** that proves it is the real bank. Without it, Mallory could pretend to be the bank. Then Alice would agree on a key with Mallory instead.

        Press **Alice signs in with HTTPS**. Then open one of the new packets in Mallory's capture.
      `,
      setup: (sim) => {
        ensureInTheMiddle(sim);
        freshCapture(sim);
      },
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
          prompt: 'Mallory is still in the middle. Look at every column of her capture. What can she still learn from the HTTPS packets?',
          options: [
            { id: 'ips', text: "Alice's IP address and the bank's IP address", correct: true },
            { id: 'when', text: 'When Alice connected and how many packets she sent', correct: true },
            { id: 'pass', text: "Alice's password", feedback: 'Open the packet again. The HTTP layer is scrambled.' },
            { id: 'balance', text: "Alice's account balance", feedback: 'The page comes back inside the same encrypted connection.' },
          ],
          explain:
            'Encryption hides the contents. The IP header stays readable so routers can deliver the packet. Who talked to whom, when, and how many packets is called metadata, and HTTPS does not hide it.',
        },
      ],
    },

    {
      id: 'detect',
      title: 'Spot it and stop it',
      body: md`
        Switch sides. You are now the café's IT person.

        1. Open [[router]] and read its **ARP table**. Two IP addresses point to the same MAC address: one device is pretending to be two.
        2. In the router's **Addresses** table, find the row with 192.168.1.1 and copy its MAC address.
        3. In the Toolkit, use **Lock ARP entries** to lock 192.168.1.1 to that MAC on Alice. A locked entry, called a **static ARP entry**, ignores ARP replies.
        4. Use the ARP spoofer to poison Alice again. She should ignore it.
      `,
      setup: ensureInTheMiddle,
      focus: ['router', 'alice'],
      tools: [{ kind: 'static-arp', device: 'alice' }, { kind: 'arp-spoof', device: 'mallory', victims: ['alice', 'router'] }],
      goals: [
        { id: 'spot', label: 'Open [[router]] in the inspector', check: inspected('router') },
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
          id: 'other-half',
          kind: 'choice',
          prompt:
            "Alice's laptop is locked now. The router's ARP table still lists Alice's IP, 192.168.1.10, at Mallory's MAC. When the bank answers Alice, where does the router send the reply?",
          options: [
            { id: 'mallory', text: "To Mallory's laptop", correct: true },
            { id: 'alice', text: "Straight to Alice, since her laptop is locked", feedback: "The lock is on Alice's laptop. The router reads its own ARP table, and that table is still poisoned." },
            { id: 'bank', text: 'Back to the bank', feedback: 'The router is delivering the reply to 192.168.1.10. It looks up which MAC address to use.' },
            { id: 'dropped', text: 'Nowhere. The router drops it.', feedback: "Mallory's MAC is a real address on this network, so the router hands the reply to her.", last: true },
          ],
          explain:
            'A lock protects only the device it is on, so Mallory still gets the bank\'s replies to Alice. To protect the router\'s side too, the café would lock Alice\'s MAC on the router as well. Or it would turn on Dynamic ARP Inspection, a feature of some switches and access points that checks every ARP reply.',
        },
      ],
    },

    {
      id: 'defenses',
      title: 'Choose a defense',
      body: md`
        You saw three defenses in this lab:

        - **WPA2** on the Wi-Fi
        - **HTTPS** on the bank's website
        - **Static ARP entries** on the devices

        Each one stopped a different part of the attack.
      `,
      questions: [
        {
          id: 'pick-one',
          kind: 'text',
          prompt:
            'Suppose only one of the three defenses could be in place. Pick one. Explain what it stops, and name one attack from this lab that it does not stop.',
          minWords: 30,
          lines: 6,
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
