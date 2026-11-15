import type { Sim } from '../../sim/sim';
import { prefixContains, prefixLen } from '../../sim/addr';
import { asPathTo, happened, inspected, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import { AS, BANK_IP, BANK_PREFIX, buildInternet, FAKE_BANK, LOGIN_BODY, MORE_SPECIFIC, replayAnnouncements } from './scenario';

const openBank: ActionDef = {
  id: 'open',
  label: 'Alice opens bank.example',
  run: (sim) => sim.browse('alice', 'http://bank.example/'),
};

const openBankHttps: ActionDef = {
  id: 'open-https',
  label: 'Alice opens https://bank.example',
  run: (sim) => sim.browse('alice', 'https://bank.example/'),
};

const routesToShady = (sim: Sim, device: string) => {
  const path = asPathTo(sim, device, BANK_IP);
  return !!path && path[path.length - 1] === AS.shady;
};
const announcing = (sim: Sim, prefix: string) => sim.dev('shady').bgp!.origins.includes(prefix);
/** Prefixes Shady Net announces that are smaller than the bank's /24 but still contain the bank. */
const moreSpecifics = (sim: Sim) => sim.dev('shady').bgp!.origins.filter((p) => prefixLen(p) > prefixLen(BANK_PREFIX) && prefixContains(p, BANK_IP));
const BANK_TARGET = { ip: BANK_IP, label: 'the bank' };
const DEFENDERS = ['home', 'west', 'east', 'bankhost'];
const validating = (sim: Sim) => DEFENDERS.filter((id) => sim.dev(id).bgp?.validate);
/** When validation was last turned on or off anywhere, so a page load from before the change doesn't count. */
const lastValidationChange = (sim: Sim) => {
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i];
    if (e.type === 'config' && e.what === 'validate') return e.t;
  }
  return 0;
};

// Step setups restore what a step needs if the student reset the network or
// skipped ahead in an unexpected way. Each checks first, so it is safe to repeat.

function equalPrefixHijackOnly(sim: Sim): void {
  if (!announcing(sim, BANK_PREFIX)) sim.announce('shady', BANK_PREFIX);
  for (const p of moreSpecifics(sim)) sim.withdraw('shady', p);
}

function impostor(sim: Sim): void {
  if (!moreSpecifics(sim).length) sim.announce('shady', MORE_SPECIFIC);
  sim.dev('shady').impersonate = FAKE_BANK;
}

export const routeHijackLab: LabDef = {
  id: 'route-hijack',
  version: 2,
  title: 'BGP Route Hijacking',
  tagline: "Send a bank's traffic to the wrong network with one false BGP announcement, then stop it with route origin validation.",
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves', '3.3 Misdirected and Overwhelmed'],
  ced: ['3.1.A', '3.1.B', '3.1.C'],
  minutes: 50,
  objectives: [
    'Read a routing table and an AS path.',
    'Explain how BGP announcements spread between networks.',
    'Explain why a false announcement can redirect traffic, and why a more specific one spreads further.',
    'Evaluate route origin validation (RPKI) and HTTPS certificates as defenses.',
  ],
  build: buildInternet,
  steps: [
    {
      id: 'map',
      title: 'A map of the internet',
      body: md`
        The internet is a network of networks. Each network on this map belongs to one organization and has an **autonomous system number** (ASN), like AS100.

        - [[alice]] gets internet service from [[home]].
        - [[bank]] is hosted by [[bankhost]].
        - [[west]] and [[east]] are **transit** networks. They carry traffic between other networks.
        - [[shady]] is a small network connected to Transit West. Later, you will play Shady Net.

        Each network owns blocks of addresses called **prefixes**. \`203.0.113.0/24\` means every address that starts with 203.0.113. An address has four numbers, and each number is 8 bits. So /24 means the first 24 bits, the first three numbers, are fixed.

        Click [[home]]. In the Inspect panel, scroll down past **Addresses** to the **Routing table**. Each row says where to send packets for one prefix. **Send to** names the neighbor that gets them. The **AS path** lists the networks on the way there, and the last number is the network that owns the prefix. (The row for 198.51.100.0/24 is Shady Net's own block.) Step 3 shows where the path comes from.

        > Everything in this lab happens inside a simulation. Claiming addresses you don't own on the real internet disrupts service for many people and can be a crime.
      `,
      focus: ['home'],
      goals: [{ id: 'home', label: 'Open [[home]] and read its routing table', check: inspected('home') }],
      questions: [
        {
          id: 'next-hop',
          kind: 'choice',
          prompt: 'HomeNet gets a packet for the bank at 203.0.113.10. Which neighbor does it hand the packet to?',
          options: [
            { id: 'west', text: 'Transit West', correct: true },
            { id: 'east', text: 'Transit East', feedback: 'HomeNet has no direct link to Transit East. Look at the map.' },
            { id: 'bankhost', text: 'BankHost', feedback: 'HomeNet and BankHost are not connected to each other.' },
            { id: 'shady', text: 'Shady Net', feedback: 'Read the **Send to** column in the row for 203.0.113.0/24.' },
          ],
          explain: "HomeNet's row for 203.0.113.0/24 says **Send to** Transit West.",
        },
      ],
    },

    {
      id: 'path',
      title: 'Follow a request',
      body: md`
        Press **Alice opens bank.example** and follow the request across the map. Each network passes it to the next one on its route.

        The round trip takes about 20 seconds at 1×. The speed buttons above the map (\`2×\`, \`4×\`) make it faster.
      `,
      focus: ['alice', 'home', 'west', 'east', 'bankhost', 'bank'],
      actions: [openBank],
      goals: [
        {
          id: 'loaded',
          label: "Alice's bank page loads",
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.status === 'loaded'),
        },
      ],
      questions: [
        {
          id: 'order',
          kind: 'choice',
          prompt: "In what order did Alice's request cross the networks?",
          options: [
            { id: 'real', text: 'HomeNet, Transit West, Transit East, BankHost', correct: true },
            { id: 'skip-west', text: 'HomeNet, Transit East, BankHost', feedback: 'HomeNet has only one neighbor besides Alice.' },
            { id: 'shady', text: 'HomeNet, Transit West, Shady Net, BankHost', feedback: 'Shady Net has no link to BankHost.' },
            { id: 'direct', text: 'HomeNet, BankHost', feedback: 'Look at the map. Those two are not linked.' },
          ],
          explain: "That matches the AS path in HomeNet's routing table: 200, 300, 400.",
        },
      ],
    },

    {
      id: 'learn',
      title: 'How routes spread',
      body: md`
        How did HomeNet learn that path? [[bankhost]] owns the bank's prefix. It sends a **route announcement** to its neighbors: "I can reach 203.0.113.0/24. Path: 400."

        A network that accepts the announcement saves the path in its routing table. When it passes the announcement on, it adds its own AS number to the front. If AS7 hears "8 9" and passes it on, its neighbor hears "7 8 9".

        A network adds its number only when it sends the route out. Its own table never shows its own number. The protocol that carries these announcements is the **Border Gateway Protocol** (BGP).

        Two rules decide which path a router keeps:

        - A router that hears two paths to the same prefix picks the **shortest AS path**. (Real networks can set their own preferences first. In this lab, none do.)
        - A router that finds its own AS number already in a path throws that announcement away. This stops **loops**: routes that go around in circles.

        Press the button and watch the ROUTE packets spread. (At 4× they finish in about a second. Try 1× to watch them.) Then open [[west]] and scroll to its Routing table.
      `,
      focus: ['bankhost', 'east', 'west', 'home'],
      actions: [
        {
          id: 'replay',
          label: 'BankHost announces 203.0.113.0/24',
          run: (sim) => replayAnnouncements(sim, BANK_PREFIX, 'bankhost'),
        },
      ],
      goals: [
        {
          id: 'sent',
          label: 'BankHost announces its prefix',
          check: ({ sim, since }) =>
            happened(sim, since, (e) => e.type === 'config' && e.device === 'bankhost' && e.what === 'announce'),
        },
        { id: 'west', label: 'Open [[west]] and find its route to the bank', check: inspected('west') },
      ],
      questions: [
        {
          id: 'west-path',
          kind: 'text',
          prompt: "What is Transit West's AS path to 203.0.113.0/24? Type the AS numbers in order.",
          lines: 1,
          expect: /^\D*300\D+400\D*$/,
          expectHint: "Open Transit West and find the row for 203.0.113.0/24. Type its AS path column, nearest network first. A network doesn't list itself, so 200 isn't in it.",
          explain: 'Transit West heard it from Transit East (300), which heard it from BankHost (400).',
        },
        {
          id: 'why-path',
          kind: 'choice',
          prompt: 'Why does each network add its own AS number to the path before passing it on?',
          options: [
            { id: 'length', text: 'So every network can count how many networks away the prefix is, and spot loops', correct: true },
            {
              id: 'sign',
              text: 'To sign the announcement so nobody can fake it',
              feedback: "Nothing in a basic BGP announcement is signed. That's the problem this lab is about.",
            },
            { id: 'encrypt', text: 'To encrypt the route', feedback: 'BGP announcements travel in plaintext.' },
            { id: 'bill', text: 'So networks can bill each other', feedback: 'Billing happens in contracts, not in BGP.' },
          ],
          explain:
            'The length of the path tells a router how many networks away the prefix is, so it can pick the shortest path. A network that finds its own number already in a path rejects it, which stops loops.',
        },
      ],
    },

    {
      id: 'hijack',
      title: "Announce a prefix you don't own",
      body: md`
        Now you play [[shady]]. BGP routers believe what their neighbors tell them. Nothing in the protocol checks whether Shady Net owns the prefixes it announces.

        Shady Net's **route announcer** is open in the Toolkit. Type the bank's prefix, \`203.0.113.0/24\`, and announce it. Then open [[west]] and [[home]] and read their routes to the bank.

        Transit West now hears two paths to the bank. Its table shows only the one it picked. HomeNet has only one neighbor, so its **Send to** stays Transit West. Look at where its AS path ends.

        Announcing someone else's prefix to pull in their traffic is a **BGP hijack**.
      `,
      focus: ['shady', 'west', 'home'],
      open: 'tools',
      tools: [{ kind: 'bgp-announce', device: 'shady', target: BANK_TARGET }],
      goals: [
        { id: 'announce', label: 'Announce 203.0.113.0/24 from [[shady]]', check: ({ sim }) => announcing(sim, BANK_PREFIX) },
        {
          id: 'home',
          label: "Open [[home]] after the announcement and see where its route to the bank ends",
          hint: 'Wait for the ROUTE packets to reach HomeNet, then open it.',
          check: (ctx) => routesToShady(ctx.sim, 'home') && inspected('home')(ctx),
        },
      ],
      questions: [
        {
          id: 'why-switch-west',
          kind: 'choice',
          prompt: "Transit West already had a working route to the bank. Why did it switch to Shady Net's route?",
          options: [
            { id: 'shorter', text: "Shady Net's path (666) is shorter than the real one (300, 400).", correct: true },
            { id: 'newer', text: "Shady Net's path (666) arrived after the real one (300, 400).", feedback: 'BGP compares paths, not arrival times.' },
            { id: 'closer', text: 'Shady Net is closer on the map.', feedback: "Routers don't know where anything sits on a map. They compare AS paths." },
            { id: 'withdrew', text: 'BankHost stopped announcing, so the real path (300, 400) is gone.', feedback: 'BankHost still announces its prefix. Open Transit East: it still uses the real path.' },
          ],
          explain:
            "BGP picks the shortest AS path, and a router can't tell a short fake path from a short real one. HomeNet followed along, because it sends everything for the bank to Transit West.",
        },
      ],
    },

    {
      id: 'blackhole',
      title: 'Where did the traffic go?',
      body: md`
        Press **Alice opens bank.example** and follow the request. Where does it stop?

        Then open [[east]] and check its route to the bank.

        When a network pulls in traffic and then drops it, the traffic has fallen into a **black hole**. To Alice, the bank looks like it is down.
      `,
      setup: equalPrefixHijackOnly,
      focus: ['alice', 'shady', 'east'],
      actions: [openBank],
      goals: [
        {
          id: 'hole',
          label: "Alice's request ends at [[shady]]",
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'drop' && e.device === 'shady' && e.reason === 'blackhole'),
        },
        { id: 'east', label: 'Open [[east]] and check its route to the bank', check: inspected('east') },
      ],
      questions: [
        {
          id: 'fooled',
          kind: 'choice',
          multi: true,
          prompt: "Whose route to the bank now ends at Shady Net (666)? Pick every one.",
          options: [
            { id: 'home', text: 'HomeNet', correct: true, missed: "Open HomeNet again. Where does its AS path end?" },
            { id: 'west', text: 'Transit West', correct: true, missed: 'Open Transit West again. Where does its AS path end?' },
            { id: 'east', text: 'Transit East', feedback: "Open Transit East. Its path is 400, one network long. That's shorter than 200 666." },
            { id: 'bankhost', text: 'BankHost', feedback: 'BankHost owns the prefix. It never prefers a path through someone else.' },
          ],
          explain:
            "HomeNet's path is 200 666, and Transit West's is 666. Transit East is next to BankHost, so the real route is shorter than the fake one. Networks fewer steps from the attacker were fooled. Networks fewer steps from the real owner were not.",
        },
      ],
    },

    {
      id: 'specific',
      title: 'A more specific lie',
      body: md`
        Shady Net fooled only part of the internet. Routers have one rule that beats path length: **longest prefix match**. The /24 and a /25 are two different routes. When a packet arrives, the router uses the most specific route that contains the destination. "Longest" means the most fixed bits: a /25 fixes 25 bits, one more than a /24.

        Each extra fixed bit cuts the block in half. A /24 holds 256 addresses (0 to 255 is 256 numbers, because 0 counts), so a /25 holds 128:

        | Prefix | Addresses | Has the bank, 203.0.113.10? |
        | --- | --- | --- |
        | \`203.0.113.0/24\` | 203.0.113.0 to 203.0.113.255 | yes |
        | \`203.0.113.0/25\` | 203.0.113.0 to 203.0.113.127 | yes |
        | \`203.0.113.128/25\` | 203.0.113.128 to 203.0.113.255 | no |

        Announce \`203.0.113.0/25\` from Shady Net. Then open [[east]] again.

        > On the real internet, most networks ignore announcements more specific than /24, like a /25. So a real hijacker picks a victim with a bigger block and announces a /24 piece of it. This lab's bank owns only a /24, so you use a /25.

        > In February 2008, Pakistan Telecom tried to block YouTube inside Pakistan. It announced a /24 piece of YouTube's bigger block. The announcement spread to the rest of the internet. For about two hours, much of the world's YouTube traffic went to Pakistan and was dropped.
      `,
      focus: ['shady', 'east'],
      open: 'tools',
      tools: [{ kind: 'bgp-announce', device: 'shady', target: BANK_TARGET }],
      goals: [
        {
          id: 'announce',
          label: "Announce a prefix from [[shady]] that is more specific than /24 and contains the bank's address",
          hint: "Type 203.0.113.0/25. It is the first half of the bank's /24, and the bank at 203.0.113.10 is in it.",
          check: ({ sim }) => moreSpecifics(sim).length > 0,
        },
        {
          id: 'east',
          label: "Even [[east]]'s route to the bank now ends at Shady Net",
          hint: 'Wait for the ROUTE packets to reach Transit East.',
          check: ({ sim }) => routesToShady(sim, 'east'),
        },
      ],
      questions: [
        {
          id: 'why-specific',
          kind: 'text',
          prompt: "Transit East's real route has a shorter AS path. Explain why Transit East still sends the bank's traffic to Shady Net.",
          minWords: 20,
        },
      ],
    },

    {
      id: 'impersonate',
      title: 'Pretend to be the bank',
      body: md`
        People notice a black hole fast. A smarter attacker answers the traffic instead. Shady Net now runs a copy of the bank's sign-in page.

        1. Press [[button:http]]. Her page looks normal. Then scroll down in [[shady]]'s Inspect panel until you see **Stolen passwords**.
        2. Press [[button:https]]. Watch what her browser shows this time.

        An HTTPS site proves who it is with a **certificate**: a file, signed by a company that browsers trust, that proves the site really is bank.example. Shady Net can copy the page, but it has no real certificate for bank.example.

        > In April 2018, attackers used a BGP hijack to take over part of Amazon's DNS service, which turns site names into addresses. Visitors to MyEtherWallet, a cryptocurrency site, were sent to a fake copy. The fake site had no valid certificate, so browsers showed a warning. Users who clicked past it lost about $150,000.
      `,
      setup: impostor,
      focus: ['alice', 'shady'],
      open: { inspect: 'shady' },
      actions: [
        { id: 'http', label: 'Alice signs in (HTTP)', run: (sim) => sim.browse('alice', 'http://bank.example/login', LOGIN_BODY) },
        { id: 'https', label: 'Alice signs in (HTTPS)', run: (sim) => sim.browse('alice', 'https://bank.example/login', LOGIN_BODY) },
      ],
      goals: [
        {
          id: 'stolen',
          label: 'The fake page collects a password over HTTP',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'credentials-stolen' && e.device === 'shady'),
        },
        {
          id: 'warn',
          label: "Alice's browser warns her during the HTTPS sign-in",
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.secure && b.status === 'warning'),
        },
      ],
      questions: [
        {
          id: 'warning',
          kind: 'choice',
          prompt: "Alice's browser warns that the site can't prove it is bank.example. What should she do?",
          options: [
            { id: 'leave', text: 'Close the page, and contact the bank another way.', correct: true },
            { id: 'continue', text: 'Click Advanced and continue to the site.', feedback: 'That is what the MyEtherWallet victims did.' },
            { id: 'refresh', text: 'Refresh until the warning goes away.', feedback: 'The warning goes away only when the real bank answers again.' },
            { id: 'incognito', text: 'Open the site in a private window.', feedback: 'A private window still connects to the same fake server.' },
          ],
          explain: 'A certificate warning on a site that normally works means someone may be pretending to be that site. Clicking past it hands them the password.',
        },
      ],
    },

    {
      id: 'rov',
      title: 'Check who owns what',
      body: md`
        Now defend. The **origin** of a route is the last AS number in its path: the network that started the announcement.

        BankHost has published a signed record that says: only AS400 may be the origin for 203.0.113.0/24. An announcement for that block, or for any smaller block inside it, from any other origin fails the check. A router that turns on **route origin validation** checks each announcement against records like this one. If the origin isn't allowed, the router rejects the announcement. (The records are called ROAs, and they are kept in a public registry called the RPKI.)

        1. In the Toolkit, turn on validation for one network. Then press [[button:open-https]] and see if Alice reaches the real bank.
        2. If she doesn't, turn that network off and try another. Find the one network that protects everyone.

        Each router passes on only the one route it picked. If a network rejects the fake route and is left with no route at all, look at what its neighbor is passing on.
      `,
      focus: ['home', 'west', 'east', 'bankhost'],
      open: 'tools',
      tools: [{ kind: 'bgp-validate', devices: DEFENDERS }],
      actions: [openBankHttps],
      goals: [
        {
          id: 'reject',
          label: "A network rejects Shady Net's announcement",
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'route-rejected'),
        },
        {
          id: 'real',
          label: 'Alice reaches the real bank with only one network validating',
          hint: 'Turn validation off everywhere except one network. Which network hears from Shady Net first?',
          check: ({ sim, since }) =>
            validating(sim).length === 1 &&
            pageSince(sim, 'alice', Math.max(since, lastValidationChange(sim)), (b) => b.status === 'loaded' && !b.fake),
        },
      ],
      questions: [
        {
          id: 'which-network',
          kind: 'text',
          prompt: 'Which single network protected everyone when it turned on validation? Explain why, using the map.',
          minWords: 25,
        },
      ],
    },

    {
      id: 'reflect',
      title: "What validation can't catch",
      body: md`
        Route origin validation checks only the **origin**: the last AS number in the path. It doesn't check the rest of the path.
      `,
      questions: [
        {
          id: 'forged-path',
          kind: 'choice',
          prompt: 'Shady Net announces 203.0.113.0/24 with the path **666 400**, pretending it has a link to BankHost. Would route origin validation reject it?',
          options: [
            { id: 'no', text: 'No. The origin is still AS400, so the announcement passes the check.', correct: true },
            { id: 'yes-666', text: 'Yes. AS666 appears in the path.', feedback: 'Route origin validation looks at one number in the path. Which one?' },
            { id: 'yes-roa', text: 'Yes. The ROA lists every AS allowed in the path.', feedback: 'A ROA names one thing: the AS allowed to originate the prefix.' },
          ],
          explain:
            'Origin validation stops announcements from the wrong origin. Newer defenses check the rest of the path, but few networks use them so far.',
        },
        {
          id: 'compare',
          kind: 'text',
          prompt: "In the on-path lab, Mallory got between Alice and the router on café Wi-Fi, so all of Alice's traffic passed through her. Compare that on-path attack to this BGP hijack. How are they alike? How is the number of victims different?",
          minWords: 30,
          lines: 5,
        },
      ],
    },

    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary. You can go back to any step and change an answer, then download and hand in your report again.
      `,
    },
  ],
};
