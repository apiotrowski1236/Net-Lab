import { freshEntry } from '../../sim/dns';
import { happened, inspected, loggedSince, openedLog, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import { ALICE_LOGIN, buildDistrict, ensurePoisoned, IP, primeCache, SITE, TEACHER_LOGIN } from './scenario';

const EVIL_URL = `http://${IP.evil}/`;

const aliceOpens: ActionDef = {
  id: 'alice-open',
  label: `Alice opens http://${SITE}`,
  run: (sim) => sim.browse('alice', `http://${SITE}/`),
};

const benOpens: ActionDef = {
  id: 'ben-open',
  label: `Ben opens http://${SITE}`,
  run: (sim) => sim.browse('ben', `http://${SITE}/`),
};

const aliceOpensByIp: ActionDef = {
  id: 'alice-open-ip',
  label: `Alice opens ${EVIL_URL}`,
  run: (sim) => sim.browse('alice', EVIL_URL),
};

const aliceSignsIn: ActionDef = {
  id: 'alice-login',
  label: `Alice signs in at http://${SITE}`,
  run: (sim) => sim.browse('alice', `http://${SITE}/login`, ALICE_LOGIN),
};

const teacherSignsIn: ActionDef = {
  id: 'teacher-login',
  label: `Mr. Ruiz signs in at http://${SITE}`,
  run: (sim) => sim.browse('teacher', `http://${SITE}/login`, TEACHER_LOGIN),
};

const aliceSignsInHttps: ActionDef = {
  id: 'alice-https',
  label: `Alice signs in at https://${SITE}`,
  run: (sim) => sim.browse('alice', `https://${SITE}/login`, ALICE_LOGIN),
};

const mallorysBurst: ActionDef = {
  id: 'forge-again',
  label: 'Mallory sends another forged burst',
  run: (sim) => sim.forgeDnsAnswer('evil', 'resolver', SITE, IP.evil),
};

/** The resolver is currently handing out Mallory's address for the gradebook. */
const poisoned = (sim: Parameters<ActionDef['run']>[0]) => sim.dev('resolver').resolver!.cache[SITE]?.ip === IP.evil;
const cachesReal = (sim: Parameters<ActionDef['run']>[0]) => {
  const e = freshEntry(sim.dev('resolver').resolver!, SITE, sim.t);
  return e?.ip === IP.grades;
};

export const dnsSpoofLab: LabDef = {
  id: 'dns-spoof',
  version: 1,
  title: 'DNS Cache Poisoning',
  tagline: "Poison a DNS server's cache and send a whole school to a fake sign-in page, then make the attack harder.",
  unit: 3,
  codehs: ['3.3 Misdirected and Overwhelmed'],
  ced: ['3.1.A', '3.1.B', '3.1.C', '3.5.E'],
  minutes: 45,
  clock: '08:30',
  objectives: [
    'Explain how a resolver turns a name into an address, and why it caches the answer with a TTL.',
    'Explain how DNS cache poisoning plants a false record that everyone on the resolver inherits.',
    'Explain why HTTPS catches the impostor that DNS did not.',
    'Detect a poisoning from a traffic drop and a resolver log, and fix it.',
    'Evaluate unpredictable query IDs and signed records (DNSSEC) as defenses.',
  ],
  build: buildDistrict,
  steps: [
    {
      id: 'names',
      title: 'Names and numbers',
      body: md`
        People type names. Computers need numbers. **DNS**, the Domain Name System, turns a name like \`grades.example\` into an IP address like \`${IP.grades}\`.

        This is Maple Grove School District, first thing in the morning.

        - [[alice]], [[ben]], and [[teacher]] use the gradebook all day.
        - [[resolver]] is the district's **DNS resolver**. Every computer in the school asks it to look up names.
        - Out on the internet, [[ns]] is the **authoritative name server** for \`${SITE}\`. It is the one source that knows the real address.
        - [[grades]] is the real gradebook. [[evil]] is Mallory's server, for later.

        Click [[resolver]] and read its **DNS cache**. It is empty: nobody has looked anything up yet. Then click [[ns]] and read the record it is the authority for.
      `,
      focus: ['alice', 'resolver', 'ns', 'grades'],
      open: { inspect: 'resolver' },
      goals: [
        { id: 'resolver', label: "Open [[resolver]] and read its DNS cache", check: inspected('resolver') },
        { id: 'ns', label: "Open [[ns]] and read its record for the gradebook", check: inspected('ns') },
      ],
      questions: [
        {
          id: 'what-dns',
          kind: 'choice',
          prompt: 'What does a DNS lookup do?',
          options: [
            { id: 'name-to-ip', text: 'Turns a name people can read into the IP address a computer needs to send packets.', correct: true },
            { id: 'password', text: "Checks a site's password before loading it.", feedback: 'DNS has nothing to do with passwords. It only maps names to addresses.' },
            { id: 'encrypt', text: 'Encrypts the connection to a website.', feedback: 'That is what HTTPS does. DNS just finds the address.' },
            { id: 'route', text: 'Chooses which router the packet travels through.', feedback: 'Routing decides the path. DNS decides the destination address.' },
          ],
          explain: 'DNS is the internet\'s address book: it turns a name into the number a computer needs before it can send anything.',
        },
      ],
    },

    {
      id: 'lookup',
      title: 'A lookup',
      body: md`
        Press the button and follow the packets.

        1. Alice's laptop asks [[resolver]]: "What is the address of \`${SITE}\`?"
        2. The resolver does not know yet, so it asks [[ns]], the authority for that name.
        3. The answer comes back, \`${IP.grades}\`, and the resolver **caches** it: writes it down with a **TTL** (time to live), the number of seconds it may keep the answer.
        4. The resolver tells Alice, and her browser loads the real gradebook.

        Open [[resolver]] again and watch its cache fill in. The TTL counts down.

        > Real DNS asks a couple more servers first (a root server, then a \`.example\` server) before it reaches the authority. The idea is the same; this lab shows two levels.
      `,
      focus: ['alice', 'resolver', 'ns', 'grades'],
      open: { inspect: 'resolver' },
      actions: [aliceOpens],
      goals: [
        {
          id: 'loaded',
          label: 'Alice reaches the real gradebook',
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.status === 'loaded' && b.from === IP.grades),
        },
        {
          id: 'cached',
          label: `[[resolver]] caches ${SITE}`,
          hint: 'Wait for the answer to get back to the resolver, then open it.',
          check: ({ sim }) => cachesReal(sim),
        },
      ],
      questions: [
        {
          id: 'why-cache',
          kind: 'choice',
          prompt: 'Why does the resolver write the answer down instead of asking the name server every time?',
          options: [
            { id: 'faster', text: 'So the next person who asks for the same name gets an instant answer, without the trip to the name server.', correct: true },
            { id: 'secure', text: 'Because a written-down answer is harder to forge.', feedback: 'Caching is about speed, not safety. You are about to see how a cached answer can be forged.' },
            { id: 'legal', text: 'Because the name server only answers each name once.', feedback: 'The name server will answer as many times as it is asked. Caching just saves the trips.' },
          ],
          explain: 'A resolver might serve thousands of students. Caching means one trip to the name server answers everyone until the TTL runs out.',
        },
      ],
    },

    {
      id: 'cache',
      title: 'One answer, everyone',
      body: md`
        Now Ben opens the same site. Press the button and watch.

        The query stops at [[resolver]]. The answer is already in its cache and still fresh, so the resolver replies right away. No packets go out to the name server this time.

        One cached answer serves the whole school. That is the point of a resolver, and it is also the weakness: if the wrong answer ever gets into that cache, **everyone** who asks inherits it until it expires.
      `,
      focus: ['ben', 'resolver'],
      open: { inspect: 'resolver' },
      setup: primeCache,
      actions: [benOpens],
      goals: [
        {
          id: 'hit',
          label: '[[resolver]] answers Ben from its cache',
          check: ({ sim, since }) => loggedSince(sim, 'resolver', since, (e) => e.source === 'dns' && e.msg.startsWith(`cache hit ${SITE}`)),
        },
      ],
      questions: [
        {
          id: 'blast',
          kind: 'choice',
          prompt: "A wrong record in one student's laptop affects that laptop. Why is a wrong record in the resolver's cache so much worse?",
          options: [
            { id: 'everyone', text: 'Every computer in the school uses that one resolver, so they all get the wrong answer.', correct: true },
            { id: 'permanent', text: 'A record in the resolver can never be removed.', feedback: 'It can be removed, and it expires on its own at the TTL. The danger is how many people it reaches first.' },
            { id: 'faster', text: 'The resolver sends packets faster than a laptop.', feedback: 'Speed is not the issue. Reach is: one resolver answers the whole school.' },
          ],
          explain: 'Poisoning one laptop hits one person. Poisoning the shared resolver hits everyone behind it at once.',
        },
      ],
    },

    {
      id: 'impostor',
      title: 'A perfect copy',
      body: md`
        Switch sides. [[evil]] is Mallory's server. It runs a page that is a pixel-perfect copy of the gradebook's sign-in screen. The only thing that gives it away is its address: \`${IP.evil}\`, not \`${IP.grades}\`.

        Press the button to open Mallory's page directly by its address. Compare it to the real gradebook from the last step.

        A copied page is harmless on its own. Nobody types \`${IP.evil}\` into a browser. Mallory's problem is getting people to land there while they think they are at \`${SITE}\`. That is what the resolver's cache can do for them.
      `,
      focus: ['alice', 'evil'],
      actions: [aliceOpensByIp],
      goals: [
        {
          id: 'fake',
          label: "Alice loads Mallory's lookalike page",
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.status === 'loaded' && b.from === IP.evil),
        },
      ],
      questions: [
        {
          id: 'harvest',
          kind: 'choice',
          prompt: 'What is a lookalike sign-in page for?',
          options: [
            { id: 'steal', text: 'To record the username and password that someone types, thinking they are signing in to the real site.', correct: true },
            { id: 'slow', text: 'To slow the real site down.', feedback: 'A copy of a page does nothing to the real site. It collects what visitors type.' },
            { id: 'virus', text: 'To install a virus automatically.', feedback: 'This page does one thing: it harvests whatever is typed into it.' },
          ],
          explain: 'This is credential harvesting. The page looks real, so visitors hand over their passwords.',
        },
      ],
    },

    {
      id: 'poison',
      title: 'Guess the ticket number',
      body: md`
        Here is how Mallory gets the whole school to that page. When the resolver asks the name server a question, it stamps the question with a **query ID**, like a numbered ticket, and sends it from a source port. It will accept the first answer that comes back with the matching ticket number and port, and claims to be from the name server.

        Mallory can send packets from the internet with a **forged source address**: answers that *claim* to come from \`${IP.ns}\`. If one carries the right ticket number and gets back before the real one does, the resolver believes it and caches it.

        Open [[resolver]]. Its query IDs are marked **predictable**: this toy resolver uses a small, fixed range, so a short burst can cover every possible ticket. Use the **DNS forger** in the Toolkit. Make \`${SITE}\` point at Mallory's address, \`${IP.evil}\`.
      `,
      focus: ['evil', 'resolver', 'ns'],
      open: 'tools',
      setup: primeCache,
      tools: [{ kind: 'dns-forge', device: 'evil', resolver: 'resolver' }],
      goals: [
        {
          id: 'poisoned',
          label: `[[resolver]] now caches ${SITE} as Mallory's address`,
          hint: 'Open the resolver after the burst. The address in its cache should be ' + IP.evil + '.',
          check: ({ sim }) => poisoned(sim),
        },
      ],
      questions: [
        {
          id: 'why-worked',
          kind: 'choice',
          afterGoals: true,
          prompt: "The forged answer came from Mallory, not the name server. Why did the resolver accept it?",
          options: [
            { id: 'match', text: 'It matched the query ID and port the resolver was waiting for, and arrived before the real answer. Nothing in the message proves who really sent it.', correct: true },
            { id: 'trusted', text: 'Mallory is on the list of servers the resolver trusts.', feedback: 'There is no such list. The resolver trusts any answer with the right ticket number that claims the right source address.' },
            { id: 'password', text: 'Mallory guessed the name server\'s password.', feedback: 'DNS answers carry no password. The only thing checked is the query ID, port, and claimed source.' },
          ],
          explain: 'A plain DNS answer is not signed. The resolver matches the ticket number and believes the source address on the packet, both of which a forger can supply.',
        },
      ],
    },

    {
      id: 'harvest',
      title: 'A whole school, redirected',
      body: md`
        The cache is poisoned. Now everyone who looks up \`${SITE}\` is sent to Mallory. The students do nothing wrong: they type the real name, into the real browser, as always.

        Press both buttons. Watch each request go to [[evil]] instead of [[grades]]. Then open [[evil]] and read what it collected.
      `,
      focus: ['alice', 'teacher', 'evil'],
      open: { inspect: 'evil' },
      setup: ensurePoisoned,
      actions: [aliceSignsIn, teacherSignsIn],
      goals: [
        {
          id: 'alice',
          label: "Mallory's server records Alice's password",
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'credentials-stolen' && e.device === 'evil' && e.user === 'alice'),
        },
        {
          id: 'teacher',
          label: "Mallory's server records Mr. Ruiz's password",
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'credentials-stolen' && e.device === 'evil' && e.user === 'mr.ruiz'),
        },
      ],
      questions: [
        {
          id: 'who-blame',
          kind: 'choice',
          prompt: 'Alice checks the address bar. It says the real name. What, if anything, did she do wrong?',
          options: [
            { id: 'nothing', text: 'Nothing. The name was right; the resolver handed her browser the wrong address behind it.', correct: true },
            { id: 'typo', text: 'She mistyped the address.', feedback: 'She typed the correct name. The lie was one layer down, in the resolver.' },
            { id: 'clicked', text: 'She clicked a bad link in an email.', feedback: 'No link was involved. She used the name she always uses.' },
          ],
          explain: 'That is what makes poisoning dangerous: the name a careful user checks is exactly right. The wrong address hides underneath it.',
        },
      ],
    },

    {
      id: 'https',
      title: 'HTTPS says no',
      body: md`
        One thing still stands between Mallory and the passwords. Press the button: Alice signs in over **HTTPS** this time.

        An HTTPS server has to prove it owns the name with a **certificate**: a file, signed by a trusted authority, that says "this key belongs to \`${SITE}\`." Mallory copied the page, but cannot get a real certificate for a name they do not own. The handshake fails and the browser stops before Alice types anything.

        DNS pointed her at the wrong place. HTTPS is the layer that noticed.
      `,
      focus: ['alice', 'evil'],
      setup: ensurePoisoned,
      actions: [aliceSignsInHttps],
      goals: [
        {
          id: 'warn',
          label: "Alice's browser warns her and stops",
          check: ({ sim, since }) => pageSince(sim, 'alice', since, (b) => b.secure && b.status === 'warning'),
        },
      ],
      questions: [
        {
          id: 'why-https',
          kind: 'choice',
          prompt: 'The resolver was poisoned either way. Why did HTTPS catch the impostor when DNS did not?',
          options: [
            { id: 'cert', text: "HTTPS checks the server's certificate against the name in the address bar. Mallory has no valid certificate for that name, so the check fails.", correct: true },
            { id: 'ip', text: 'HTTPS noticed the IP address was wrong.', feedback: "The browser does not know which IP is 'right'. It checks the certificate against the name, and the certificate is what Mallory cannot forge." },
            { id: 'faster', text: 'The HTTPS request was faster than the poisoned answer.', feedback: 'Speed is not involved. The certificate check is what fails.' },
          ],
          explain: 'DNS has no built-in way to prove an answer is genuine. HTTPS does: a certificate ties the key to the name, and a copied page cannot supply one.',
        },
        {
          id: 'past-warning',
          kind: 'choice',
          prompt: 'The browser says "This server could not prove it is grades.example." Alice is in a hurry. What should she do?',
          options: [
            { id: 'stop', text: 'Stop, and report it to the district IT team.', correct: true },
            { id: 'advanced', text: 'Click Advanced and continue to the site.', feedback: 'That hands her password to whoever is impersonating the site.' },
            { id: 'http', text: 'Switch to the plain http:// version so the warning goes away.', feedback: 'That is exactly what the attacker wants: HTTP has no certificate check at all.' },
          ],
          explain: 'A certificate warning on a site that normally works is a signal that something is impersonating it. The safe move is to stop.',
        },
      ],
    },

    {
      id: 'detect',
      title: 'Something is wrong',
      body: md`
        Now you are the district's IT team. A poisoning is quiet: no alarm goes off, and the students who signed in saw a normal-looking page. You have to read the signs.

        The **Logs** tab is open. Look at two logs.

        - [[grades]], the real gradebook, keeps a **web access log**: one line per visit. All morning it had a steady stream. Scroll to the bottom: the visits **drop to nothing** right after 08:30. A busy site going silent is the clue.
        - [[resolver]] keeps a **DNS log**. Find the line where the record for \`${SITE}\` **changed**, and who the answer came from. Click that line to flag it.
      `,
      focus: ['resolver', 'grades'],
      open: 'logs',
      setup: ensurePoisoned,
      tools: [{ kind: 'logs', devices: ['resolver', 'grades'] }],
      goals: [
        {
          id: 'changed',
          label: 'Open the resolver log line where the gradebook record changed',
          hint: 'It is a "cached ... (was ...)" line. The "was" address is the real one it replaced.',
          check: openedLog((e) => e.source === 'dns' && e.msg.includes(SITE) && e.msg.includes('(was ')),
        },
      ],
      questions: [
        {
          id: 'hard-detect',
          kind: 'choice',
          prompt: 'Why is DNS poisoning harder to spot than a site that crashes?',
          options: [
            { id: 'looks-normal', text: 'Nothing looks broken. Victims reach a page that works, and the real server just sees fewer visitors.', correct: true },
            { id: 'encrypted', text: 'The attack is encrypted, so logs cannot record it.', feedback: 'The logs recorded it fine. The problem is that each line looks ordinary on its own.' },
            { id: 'nologs', text: 'DNS servers keep no logs.', feedback: 'This resolver logged the change. Someone has to notice and read it.' },
          ],
          explain: 'A crash is loud. Poisoning is silent: the clue is an absence (visits that stopped) and a single changed log line.',
        },
        {
          id: 'drop-meaning',
          kind: 'text',
          prompt: "The real gradebook's visits dropped to zero, but the server is up and healthy. In one or two sentences, explain where its visitors went.",
          lines: 3,
          minWords: 15,
        },
      ],
    },

    {
      id: 'fix',
      title: 'Fix it, and keep it fixed',
      body: md`
        Two jobs: end this poisoning, and stop the next one.

        Open the **Resolver defenses** card for [[resolver]].

        1. **Flush the cache.** The poisoned record sits there until its TTL runs out. Flushing removes it now, so the next lookup asks the name server again.
        2. **Turn on unpredictable query IDs and source ports.** Instead of a small fixed range, the resolver picks a random ticket number and a random port for every question. Now a forged burst would have to guess both, which it cannot.

        Then let Mallory try again, and send Alice back to the site.
      `,
      focus: ['resolver', 'evil', 'alice'],
      open: 'tools',
      setup: ensurePoisoned,
      tools: [{ kind: 'resolver-defense', device: 'resolver' }, { kind: 'dns-forge', device: 'evil', resolver: 'resolver' }],
      actions: [mallorysBurst, aliceSignsInHttps],
      goals: [
        {
          id: 'flush',
          label: 'Flush the poisoned record from [[resolver]]',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'config' && e.device === 'resolver' && e.what === 'resolver-flush'),
        },
        {
          id: 'harden',
          label: 'Turn on unpredictable query IDs',
          check: ({ sim }) => !!sim.dev('resolver').resolver!.hardened,
        },
        {
          id: 'real',
          label: 'Alice reaches the real gradebook again, with no warning',
          hint: 'Flush and harden first, then let Mallory try and send Alice back.',
          check: ({ sim, since }) => cachesReal(sim) && pageSince(sim, 'alice', since, (b) => b.status === 'loaded' && !b.fake),
        },
      ],
      questions: [
        {
          id: 'why-ids',
          kind: 'choice',
          prompt: 'Why do unpredictable query IDs and source ports stop the forged burst?',
          options: [
            { id: 'guess', text: 'The forger has to match the ID and the port. With a small fixed range it can cover every option; with a large random one it almost never guesses right before the real answer arrives.', correct: true },
            { id: 'block', text: 'They block packets from outside the school.', feedback: 'They do not block anything. They make the right ticket number too hard to guess.' },
            { id: 'encrypt', text: 'They encrypt the DNS answer.', feedback: 'The answer is not encrypted. The defense is that the matching number is unpredictable.' },
          ],
          explain: 'This is the real fix from 2008 (the Kaminsky attack): randomize the query ID and the source port so a forger cannot match both in time.',
        },
        {
          id: 'dnssec',
          kind: 'text',
          prompt: 'Unpredictable IDs make forging hard, but not impossible. A stronger fix, DNSSEC, has the name server sign its records so a resolver can reject any unsigned forgery. In your own words, why is a signature a stronger defense than a hard-to-guess number?',
          lines: 4,
          minWords: 25,
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Two kinds of poisoning',
      body: md`
        You poisoned a resolver's cache here. In an earlier lab, an attacker on a local network poisoned an ARP table. Both plant a false "this name (or address) lives here" record so traffic goes to the attacker. They differ in reach.
      `,
      questions: [
        {
          id: 'compare',
          kind: 'text',
          prompt: 'Compare DNS cache poisoning with ARP poisoning. What does each one change, and how many people does each one reach?',
          minWords: 40,
          lines: 6,
        },
        {
          id: 'layers',
          kind: 'choice',
          prompt: 'A school wants to protect its users from poisoning like this. Which combination helps most?',
          multi: true,
          options: [
            { id: 'ids', text: 'A resolver that uses unpredictable query IDs and source ports.', correct: true },
            { id: 'https', text: 'Users who stop at HTTPS certificate warnings instead of clicking past them.', correct: true },
            { id: 'dnssec', text: 'Signed DNS records (DNSSEC) so forgeries are rejected outright.', correct: true },
            { id: 'faster', text: 'A faster internet connection.', feedback: 'Speed does not change whether an answer can be forged.' },
          ],
          explain: 'No single layer is enough. A hardened resolver makes forging hard, DNSSEC makes it detectable, and HTTPS catches the impostor when a bad address still slips through.',
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
