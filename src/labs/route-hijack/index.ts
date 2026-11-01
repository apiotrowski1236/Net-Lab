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
  version: 1,
  title: 'Advertise a Bad Route',
  tagline: "Hijack the internet's directions with one false announcement. Then see what it takes to stop it.",
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves', '3.3 Misdirected and Overwhelmed'],
  ced: ['3.1.A', '3.1.B', '3.1.C'],
  minutes: 40,
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

        Each network owns blocks of addresses called **prefixes**. \`203.0.113.0/24\` means every address that starts with 203.0.113. The /24 says the first 24 bits, the first three numbers, are fixed.

        Click [[home]] and read its **routing table**. Each row says where to send packets for one prefix.

        > This lab is a simulation. Announcing addresses you don't own on the real internet disrupts service for many people and can be a crime.
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
            { id: 'shady', text: 'Shady Net', feedback: 'Read the next hop in the row for 203.0.113.0/24.' },
          ],
          explain: "HomeNet's row for 203.0.113.0/24 lists Transit West as the next hop.",
        },
      ],
    },

    {
      id: 'path',
      title: 'Follow a request',
      body: md`
        Press **Alice opens bank.example** and follow the request across the map. Each network passes it to the next one on its route.
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

        Each network that accepts the announcement adds its own AS number to the front of the path and passes it on. That list of numbers is the **AS path**. The protocol that carries these announcements is the **Border Gateway Protocol** (BGP).

        Press the button and watch the ROUTE packets spread. Then open [[west]].
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
          expectHint: 'Open Transit West. Find the row for 203.0.113.0/24 and read the AS path column.',
          explain: 'Transit West heard it from Transit East (300), which heard it from BankHost (400).',
        },
        {
          id: 'why-path',
          kind: 'choice',
          prompt: 'Why does each network add its own AS number to the path before passing it on?',
          options: [
            { id: 'length', text: 'So every network can see how far away the prefix is, and spot loops', correct: true },
            {
              id: 'sign',
              text: 'To sign the announcement so nobody can fake it',
              feedback: "Nothing in a basic BGP announcement is signed. That's the problem this lab is about.",
            },
            { id: 'encrypt', text: 'To encrypt the route', feedback: 'BGP announcements travel in plaintext.' },
            { id: 'bill', text: 'So networks can bill each other', feedback: 'Billing happens in contracts, not in BGP.' },
          ],
          explain:
            'BGP prefers the shortest AS path. A network that finds its own number already in a path rejects it, which stops announcements from going around in circles.',
        },
      ],
    },

    {
      id: 'hijack',
      title: "Announce a prefix you don't own",
      body: md`
        Switch to [[shady]]. BGP routers believe what their neighbors tell them. Nothing in the protocol checks whether Shady Net owns the prefixes it announces.

        Type the bank's prefix, \`203.0.113.0/24\`, into the **route announcer** in the Toolkit and announce it from Shady Net. Then open [[home]] and read its route to the bank.

        Announcing someone else's prefix to pull in their traffic is a **BGP hijack**.
      `,
      focus: ['shady', 'west', 'home'],
      open: 'tools',
      tools: [{ kind: 'bgp-announce', device: 'shady', target: BANK_TARGET }],
      goals: [
        { id: 'announce', label: 'Announce 203.0.113.0/24 from [[shady]]', check: ({ sim }) => announcing(sim, BANK_PREFIX) },
        {
          id: 'home',
          label: "[[home]] now sends the bank's traffic toward Shady Net",
          hint: 'Wait for the ROUTE packets to reach HomeNet, then open it.',
          check: ({ sim }) => routesToShady(sim, 'home'),
        },
      ],
      questions: [
        {
          id: 'why-switch',
          kind: 'choice',
          prompt: "HomeNet already had a working route to the bank. Why did it switch to Shady Net's route?",
          options: [
            { id: 'shorter', text: "Shady Net's path (200, 666) is shorter than the real one (200, 300, 400).", correct: true },
            { id: 'newer', text: "Shady Net's announcement arrived more recently.", feedback: 'BGP compares paths, not arrival times.' },
            { id: 'closer', text: 'Shady Net is closer on the map.', feedback: "Routers don't know where anything sits on a map. They compare AS paths." },
            { id: 'withdrew', text: 'BankHost stopped announcing.', feedback: 'Open BankHost. It still announces its prefix.' },
          ],
          explain: "BGP prefers the shortest AS path. A router can't tell a short fake path from a short real one.",
        },
      ],
    },

    {
      id: 'blackhole',
      title: 'Where did the traffic go?',
      body: md`
        Press **Alice opens bank.example** and follow the request.

        Shady Net has no path to the real bank. When a network attracts traffic and then drops it, the traffic has fallen into a **black hole**. To Alice, the bank looks like it is down.

        Then open [[east]] and check its route to the bank.
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
          prompt: "Which networks now send the bank's traffic to Shady Net?",
          options: [
            { id: 'home', text: 'HomeNet', correct: true },
            { id: 'west', text: 'Transit West', correct: true },
            { id: 'east', text: 'Transit East', feedback: "Open Transit East. Its path is 400, one hop. That's shorter than 200 666." },
            { id: 'bankhost', text: 'BankHost', feedback: 'BankHost owns the prefix. It never prefers a path through someone else.' },
          ],
          explain:
            'Transit East is one hop from BankHost, so the real route is shorter than the fake one. Networks closer to the attacker were fooled. Networks closer to the real owner were not.',
        },
      ],
    },

    {
      id: 'specific',
      title: 'A more specific lie',
      body: md`
        Shady Net fooled only part of the internet. Routers have one rule that beats path length: **longest prefix match**. A router always picks the most specific route that contains the destination.

        \`203.0.113.0/25\` covers only the first half of the bank's prefix, 203.0.113.0 through 203.0.113.127. The bank at 203.0.113.10 is in that half.

        Announce a prefix that is more specific than /24 and still contains the bank's address. \`203.0.113.0/25\` works. Then open [[east]] again.

        > In February 2008, Pakistan Telecom tried to block YouTube inside Pakistan by announcing a more specific route for YouTube's addresses. The announcement leaked to the rest of the internet. For about two hours, much of the world's YouTube traffic went to Pakistan and disappeared.
      `,
      focus: ['shady', 'east'],
      open: 'tools',
      tools: [{ kind: 'bgp-announce', device: 'shady', target: BANK_TARGET }],
      goals: [
                {
          id: 'announce',
          label: "Announce a prefix from [[shady]] that is more specific than /24 and contains the bank's address",
          hint: 'A /25 is half of a /24. 203.0.113.0/25 covers 203.0.113.0 through 203.0.113.127.',
          check: ({ sim }) => moreSpecifics(sim).length > 0,
        },
        {
          id: 'east',
          label: "Even [[east]] sends the bank's traffic toward Shady Net",
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

        Press **Alice signs in (HTTP)**. Then press **Alice signs in (HTTPS)**. Compare what her browser shows each time.

        An HTTPS site proves who it is with a **certificate**: a file, signed by a trusted authority, that says "this key belongs to bank.example." Shady Net can copy the page, but it can't get a real certificate for bank.example.

        > In April 2018, attackers used a BGP hijack to take over traffic for part of Amazon's DNS service. Visitors to the cryptocurrency site MyEtherWallet were sent to a fake copy. The fake site had no valid certificate, so browsers showed a warning. Users who clicked past the warning lost about $150,000.
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
          prompt: 'Alice\'s browser says "Your connection is not private." What should she do?',
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
        Now defend. A prefix owner can publish a signed record called a **ROA** (Route Origin Authorization). It says which AS may announce the prefix. The system that stores and signs these records is the **RPKI**.

        A router that does **route origin validation** (ROV) checks each announcement against the ROAs. It rejects any announcement whose last AS number, the **origin**, isn't allowed.

        BankHost published a ROA: only AS400 may announce 203.0.113.0/24.

        1. Turn on validation for one network at a time. Find the one network that protects everyone.
        2. Press **Alice opens https://bank.example**.
      `,
      focus: ['home', 'west', 'east', 'bankhost'],
      open: 'tools',
      tools: [{ kind: 'bgp-validate', devices: ['home', 'west', 'east', 'bankhost'] }],
      actions: [openBankHttps],
      goals: [
        {
          id: 'reject',
          label: "A network rejects Shady Net's announcement",
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'route-rejected'),
        },
        {
          id: 'real',
          label: 'Alice reaches the real bank',
          hint: 'Which network hears from Shady Net first?',
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.status === 'loaded' && !b.fake),
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
          prompt: 'Compare this BGP hijack to a man-in-the-middle attack on café Wi-Fi. How are they alike? How is the number of victims different?',
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
        Look over your summary on the right. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
  ],
};
