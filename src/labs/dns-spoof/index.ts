import { freshEntry, PREDICTABLE_IDS } from '../../sim/dns';
import { happened, inspected, loggedSince, openedLog, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import { ALICE_LOGIN, buildDistrict, ensurePoisoned, IP, primeAndExpire, primeCache, SITE, TEACHER_LOGIN } from './scenario';

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

const GUESSES = PREDICTABLE_IDS.length;

/** The address the resolver held for the gradebook just before time t, from its answers and flushes. */
function heldBefore(sim: Parameters<ActionDef['run']>[0], t: number): string | undefined {
  let ip: string | undefined;
  for (const e of sim.events) {
    if (e.t >= t) break;
    if (e.type === 'dns-answer' && e.device === 'resolver' && e.name === SITE) ip = e.ip ?? undefined;
    if (e.type === 'config' && e.device === 'resolver' && e.what === 'resolver-flush') ip = undefined;
  }
  return ip;
}

const mallorysBurst: ActionDef = {
  id: 'forge-again',
  label: 'Mallory sends another forged burst',
  run: (sim) => sim.forgeDnsAnswer('evil', 'resolver', SITE, IP.evil),
  outcome: (sim, since) => {
    const asked = loggedSince(sim, 'resolver', since, (e) => e.source === 'dns' && e.msg.startsWith(`query ${SITE} `));
    const ans = sim.events.find((e) => e.t >= since && e.type === 'dns-answer' && e.device === 'resolver' && e.name === SITE);
    const ip = ans?.type === 'dns-answer' ? ans.ip : undefined;
    if (!asked && !ans) {
      if (heldBefore(sim, since) === IP.evil) {
        return [{ tone: 'bad', text: `The resolver asked nothing, because it already has a fresh answer for ${SITE}: Mallory's. Flush the cache first.` }];
      }
      return [{ tone: 'good', text: `The resolver already had a fresh answer for ${SITE}, so it asked nothing. All ${GUESSES} forged answers were thrown away.` }];
    }
    if (!ans) return [{ tone: 'wait', text: `The resolver asked the name server. Mallory's ${GUESSES} forged answers are racing the real one.` }];
    if (ip === IP.evil) return [{ tone: 'bad', text: `A forged answer matched the ticket number and port. ${SITE} points at Mallory again. Flush again, and turn on unpredictable query IDs first.` }];
    return [{ tone: 'good', text: `None of the ${GUESSES} forged answers matched the random ticket number and port. The real answer won.` }];
  },
};

/** The resolver is currently handing out Mallory's address for the gradebook. */
const poisoned = (sim: Parameters<ActionDef['run']>[0]) => sim.dev('resolver').resolver!.cache[SITE]?.ip === IP.evil;
const cachesReal = (sim: Parameters<ActionDef['run']>[0]) => {
  const e = freshEntry(sim.dev('resolver').resolver!, SITE, sim.t);
  return e?.ip === IP.grades;
};

export const dnsSpoofLab: LabDef = {
  id: 'dns-spoof',
  version: 2,
  title: 'DNS Cache Poisoning',
  tagline: "Poison a DNS server's cache and send a whole school to a fake sign-in page, then make the attack harder.",
  unit: 3,
  codehs: ['3.3 Misdirected and Overwhelmed'],
  ced: ['3.1.A', '3.1.B', '3.1.C', '3.5.E'],
  minutes: 50,
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
        People type names. Computers need numbers. **DNS**, the Domain Name System, turns a name like \`${SITE}\` into an IP address like \`${IP.grades}\`.

        This is Maple Grove School District, first thing in the morning.

        - [[alice]], [[ben]], and [[teacher]] use the online gradebook.
        - [[resolver]] is the district's **DNS resolver**. Every computer in the school asks it to look up names.
        - [[ns]] is the **authoritative name server** for \`${SITE}\`: the one server that holds the real address for that name.
        - [[grades]] is the real gradebook. [[evil]] belongs to Mallory, the attacker. You will meet it in step 4.

        Click [[resolver]] and find its **DNS cache**, the list of answers it remembers. It is empty, because nobody has looked anything up yet. (The orange **predictable** tag is a weakness you will use in step 5.) Then click [[ns]] and scroll down to **Name server records**.
      `,
      focus: ['alice', 'resolver', 'ns', 'grades'],
      open: { inspect: 'resolver' },
      goals: [
        { id: 'resolver', label: 'Open [[resolver]] and find its DNS cache', check: inspected('resolver') },
        { id: 'ns', label: 'Open [[ns]] and find its record for the gradebook', check: inspected('ns') },
      ],
      questions: [
        {
          id: 'what-dns',
          kind: 'choice',
          prompt: 'What does a DNS lookup do?',
          options: [
            { id: 'name-to-ip', text: 'It finds the IP address that goes with a name.', correct: true },
            { id: 'password', text: "It checks a site's password before the page loads.", feedback: 'DNS has nothing to do with passwords. It matches names to addresses.' },
            { id: 'encrypt', text: 'It encrypts the connection to a website.', feedback: 'That is the job of HTTPS. DNS only finds the address.' },
            { id: 'route', text: 'It picks which routers a packet travels through.', feedback: 'Routing picks the path. DNS finds the address at the end of it.' },
          ],
          explain: "DNS is the internet's address book: it turns a name into the number a computer needs before it can send anything.",
        },
      ],
    },

    {
      id: 'lookup',
      title: 'A lookup',
      body: md`
        Here is what a lookup does:

        1. Alice's laptop asks [[resolver]]: "What is the address of \`${SITE}\`?"
        2. The resolver does not know yet, so it asks [[ns]].
        3. The answer comes back: \`${IP.grades}\`. The resolver **caches** it, which means it writes the answer down along with a **TTL** (time to live): the number of seconds it may keep that answer. In the cache, the **Expires in** column is the TTL counting down.
        4. The resolver tells Alice, and her browser loads the real gradebook.

        > Real DNS asks a couple more servers first (a root server, then a \`.example\` server). This lab shows only the last one.

        Press **Alice opens http://${SITE}** and follow the packets. If they feel slow, press **2×** above the map. Then open [[resolver]] and watch its cache fill in.
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
            { id: 'faster', text: 'So the next lookup for that name is answered right away, with no trip to the name server.', correct: true },
            { id: 'secure', text: 'Because an answer that is written down is harder for an attacker to fake.', feedback: 'Caching is about speed, not safety. You are about to see a cached answer get faked.' },
            { id: 'legal', text: 'Because the name server is only allowed to answer each question one time.', feedback: 'The name server answers as many times as it is asked. Caching saves the trips.' },
          ],
          explain: 'A resolver might serve thousands of students. Caching means one trip to the name server answers everyone until the TTL runs out.',
        },
      ],
    },

    {
      id: 'cache',
      title: 'One answer, everyone',
      body: md`
        A little later, Ben opens the same site. Before you press the button, guess: will the resolver ask [[ns]] again?

        Press **Ben opens http://${SITE}** and watch where the question stops.
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
          afterGoals: true,
          prompt: "A wrong record on one student's laptop affects that one laptop. Why would a wrong record in the resolver's cache be much worse?",
          options: [
            { id: 'everyone', text: 'Every computer in the school asks that one resolver, so they would all get it.', correct: true },
            { id: 'permanent', text: "A record in the resolver's cache can never be removed or changed.", feedback: 'It can be removed, and it expires on its own when the TTL runs out. The danger is how many people it reaches first.' },
            { id: 'faster', text: 'The resolver sends its answers out faster than a laptop can check them.', feedback: 'Speed is not the problem. Reach is: one resolver answers the whole school.' },
          ],
          explain: 'One cached answer serves the whole school. That is the point of a resolver, and also its weakness: a wrong answer in the cache reaches everyone who asks until it expires.',
        },
      ],
    },

    {
      id: 'impostor',
      title: 'A perfect copy',
      body: md`
        Now look at it from Mallory's side. Mallory is the attacker, and [[evil]] runs a copy of the gradebook's sign-in page. It looks exactly the same. The only difference is the address: \`${IP.evil}\`, not \`${IP.grades}\`.

        Press **Alice opens ${EVIL_URL}** to open Mallory's page by its address. Compare it with the real gradebook Alice loaded in step 2.

        Nobody types \`${IP.evil}\` into a browser, so the copy does nothing on its own. Mallory needs people to end up there while they think they are at \`${SITE}\`. The resolver's cache can make that happen.

        > Everything in this lab happens inside a simulation. Sending fake (forged) DNS answers on a real network without permission is illegal.
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
            { id: 'steal', text: 'To save the username and password that people type into it.', correct: true },
            { id: 'slow', text: 'To slow the real gradebook down so students give up on it.', feedback: 'A copy of a page does nothing to the real site. It collects what visitors type.' },
            { id: 'virus', text: 'To install a virus on every laptop that opens the page.', feedback: 'This page does one thing: it saves whatever is typed into it.' },
          ],
          explain: 'This is called credential harvesting: collecting usernames and passwords. The page looks real, so visitors hand over their passwords.',
        },
      ],
    },

    {
      id: 'poison',
      title: 'Guess the ticket number',
      body: md`
        Ten minutes have passed. Open [[resolver]]: the gradebook record says **expired**, because its TTL ran out. While a record is fresh, the resolver asks nobody and throws away any answer that comes in. Now the next lookup makes the resolver ask [[ns]] again, and Mallory has a chance.

        Here is the race:

        1. The resolver asks [[ns]] a question. It marks the question with a **query ID**, like a numbered ticket, and sends it from a **port**: a numbered door where the answer has to come back.
        2. The resolver accepts the first answer with the right ticket number at the right port, as long as the answer says it is from the name server.
        3. Mallory sends a **burst**: many fake answers at once, all saying they are from \`${IP.ns}\`. This is a **forged source address**, like a false return address on an envelope. If one fake has the right ticket and port and arrives before the real answer, the resolver caches it. (The answers all leave at the same moment, so on the map they can look like one packet.)

        This resolver's query IDs are **predictable**: it uses only ${GUESSES} ticket numbers, always from the same port. One burst can cover them all.

        Use the **DNS forger** in the Toolkit. Make \`${SITE}\` point at Mallory's address, \`${IP.evil}\`. (A real attacker has to trick a computer in the school into asking for the name. The forger does that part for you.)
      `,
      focus: ['evil', 'resolver', 'ns'],
      open: 'tools',
      setup: primeAndExpire,
      tools: [{ kind: 'dns-forge', device: 'evil', resolver: 'resolver' }],
      goals: [
        {
          id: 'poisoned',
          label: `[[resolver]] now caches ${SITE} as Mallory's address`,
          hint: `Open the resolver after the burst. The address in its cache should be ${IP.evil}.`,
          check: ({ sim }) => poisoned(sim),
        },
      ],
      questions: [
        {
          id: 'why-worked',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The forged answer came from Mallory, not the name server. Why did the resolver accept it?',
          options: [
            { id: 'match', text: 'It had the expected ticket number and port, and it arrived first.', correct: true },
            { id: 'trusted', text: "Mallory's server is on a list of servers that the resolver has been told to trust.", feedback: 'There is no such list. The resolver trusts any answer with the right ticket number and port that says it is from the name server.' },
            { id: 'password', text: 'Mallory guessed the password that the name server uses when it sends answers.', feedback: 'DNS answers carry no password. The resolver checks only the ticket number, the port, and the return address.' },
          ],
          explain: 'Nothing in a plain DNS answer proves who sent it. The resolver checks the ticket number and port and believes the return address, and a forger can supply all three.',
        },
      ],
    },

    {
      id: 'harvest',
      title: 'A whole school, redirected',
      body: md`
        The cache is poisoned. Now everyone who looks up \`${SITE}\` is sent to Mallory. Nobody does anything wrong: they type the real name into the real browser, as always.

        Press both buttons. Watch each request go to [[evil]] instead of [[grades]]. Then click [[evil]] and scroll down to **Stolen passwords**. Mallory's page shows a normal-looking message after it saves the password, so nobody suspects.

        (In a real school, every laptop shares the school's one internet address, so Mallory would see that address. The lab shows each laptop's own address to keep it clear.)
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
          prompt: 'Alice checks the address bar. It shows the real name. What, if anything, did she do wrong?',
          options: [
            { id: 'nothing', text: 'Nothing. She typed the right name, and the resolver gave out the wrong address.', correct: true },
            { id: 'typo', text: 'She typed the name wrong, so her browser went to a different site.', feedback: 'She typed the correct name. The lie was one layer down, in the resolver.' },
            { id: 'clicked', text: 'She clicked a bad link in an email instead of typing the name.', feedback: 'No link was involved. She used the name she always uses.' },
          ],
          explain: 'The name a careful user checks is exactly right. The wrong address hides underneath it. The only warning was the "Not secure" label, and the real gradebook showed it too, because both used plain HTTP. Step 7 shows what HTTPS adds.',
        },
      ],
    },

    {
      id: 'https',
      title: 'HTTPS says no',
      body: md`
        Press the button. Alice signs in over **HTTPS** this time. The resolver is still poisoned, so her browser still goes to Mallory.

        An HTTPS site has to show a **certificate**, like an ID card for the site. A company that browsers trust gives it out and **signs** it: it adds a stamp that only that company can make and anyone can check. The certificate names the site it belongs to, and only the real site has the secret **key** that goes with it.

        Mallory can copy the page, and even the real certificate, but not the secret key. No trusted company will give Mallory a certificate for \`${SITE}\`, because Mallory does not own that name.

        Alice's browser has no idea the address is wrong. It checks the certificate before she types anything, sees that this server cannot prove it is \`${SITE}\`, and stops. The server is an **impostor**: it pretends to be a site it is not.

        DNS sent Alice to the wrong server. HTTPS noticed that the server could not prove its name.
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
            { id: 'cert', text: 'The browser checks the certificate against the name, and Mallory has no valid one.', correct: true },
            { id: 'ip', text: 'The browser noticed that the IP address it got was not the real one.', feedback: "The browser does not know which IP is 'right'. It checks the certificate against the name, and the certificate is what Mallory cannot fake." },
            { id: 'faster', text: 'The HTTPS request reached the real server before the poisoned answer did.', feedback: 'Speed is not involved. The certificate check is what fails.' },
          ],
          explain: 'Plain DNS has no way to prove an answer is real. HTTPS does: a signed certificate ties the site to its name, and only the real site holds the key that proves it.',
        },
        {
          id: 'past-warning',
          kind: 'choice',
          prompt: `The browser says "This server could not prove it is ${SITE}." Alice is in a hurry. What should she do?`,
          options: [
            { id: 'stop', text: 'Stop, and tell the district IT team about the warning.', correct: true },
            { id: 'advanced', text: 'Click Advanced and continue, since the address bar is right.', feedback: 'That hands her password to whoever is pretending to be the site.' },
            { id: 'http', text: 'Switch to the http:// version so the warning goes away.', feedback: 'That is exactly what the attacker wants: HTTP has no certificate check at all.' },
          ],
          explain: 'A certificate warning on a site that normally works means something may be pretending to be it. The safe move is to stop.',
        },
      ],
    },

    {
      id: 'detect',
      title: 'Something is wrong',
      body: md`
        Now you are the district's IT team. Nobody notices a poisoning: no alarm goes off, and the people who signed in saw a page that worked. You have to read the logs.

        The **Logs** tab is open. Use its device filter to read one log at a time.

        - [[resolver]] keeps a **DNS log**. Find the **notice** line where the record for \`${SITE}\` **changed** to a new address. It ends in \`(was ...)\`. Click it to open it. Note the time, and who the answer says it came from.
        - [[grades]], the real gradebook, keeps a **web access log**: one line per visit (\`GET /\` means someone opened the home page). Visits come in steadily, then stop after the time the record changed. A busy site going quiet is the clue.
      `,
      focus: ['resolver', 'grades'],
      open: 'logs',
      setup: ensurePoisoned,
      tools: [{ kind: 'logs', devices: ['resolver', 'grades'] }],
      goals: [
        {
          id: 'changed',
          label: 'Open the resolver log line where the gradebook record changed',
          hint: 'It is a "notice" line: "cached ... (was ...)". The "was" address is the real one it replaced.',
          check: openedLog((e) => e.source === 'dns' && e.msg.includes(`${SITE} -> ${IP.evil} (was `)),
        },
      ],
      questions: [
        {
          id: 'claimed-from',
          kind: 'choice',
          prompt: `The changed line says the answer came from ${IP.ns}, the real name server. Does that mean the name server sent the wrong address?`,
          options: [
            { id: 'forged', text: 'No. Mallory forged that return address, and the log wrote down what it was told.', correct: true },
            { id: 'hacked', text: "Yes. Mallory broke into the name server and changed the gradebook's record.", feedback: `The name server's own record never changed. Open the name server to check: it still says ${IP.grades}.` },
            { id: 'mistake', text: 'Yes. The name server made a mistake and sent out the wrong address.', feedback: 'The name server only ever sent the real address. The wrong answer came from Mallory, with a fake return address.' },
          ],
          explain: 'A forged source address fools the log too. That is why the clue is the change itself: a record that suddenly points somewhere new, and a real site that goes quiet.',
        },
        {
          id: 'drop-meaning',
          kind: 'text',
          prompt: "The real gradebook's visits dropped to zero, but the server is still running. In one or two sentences, explain where its visitors went.",
          lines: 3,
          minWords: 15,
        },
      ],
    },

    {
      id: 'fix',
      title: 'Fix it, and keep it fixed',
      body: md`
        Two jobs: end this poisoning, and stop the next one. Use the **Resolver defenses** card in the Toolkit.

        1. **Flush the cache.** Flushing empties it. Otherwise the poisoned record stays until its TTL runs out.
        2. **Turn on unpredictable query IDs and source ports.** The resolver then picks a random ticket number (out of 65,536) and a random port for every question. A forged burst would have to guess both. Even thousands of guesses almost never match before the real answer arrives.

        Then press **Mallory sends another forged burst**, and send Alice back with **Alice signs in at https://${SITE}**.

        A stronger fix is **DNSSEC**: the name server signs each record, like the certificate in step 7. Only the real name server can make that signature, so the resolver can reject any answer that is not signed, no matter how good the guess.
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
            { id: 'guess', text: 'The forger must guess two random numbers from a huge range, and almost never does in time.', correct: true },
            { id: 'block', text: 'They block every packet that comes into the school from outside, including the forged answers.', feedback: 'They do not block anything. They make the right ticket number too hard to guess.' },
            { id: 'encrypt', text: 'They encrypt each DNS answer, so a forger cannot read the real one or make a copy of it.', feedback: 'The answer is not encrypted. The defense is that the matching numbers are unpredictable.' },
          ],
          explain: 'Resolvers have used random query IDs for a long time. After the Kaminsky attack in 2008 showed how fast forgers could keep trying, resolvers also began picking a random source port, so a forger has to guess both.',
        },
        {
          id: 'dnssec',
          kind: 'text',
          prompt: 'In your own words, why is a signature (DNSSEC) a stronger defense than a hard-to-guess number?',
          lines: 4,
          minWords: 15,
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Two kinds of poisoning',
      body: md`
        You poisoned a resolver's cache. The On-Path lab showed a different kind, **ARP poisoning**:

        - Every device on a local network keeps an **ARP table**: which device (which MAC address) has each IP address.
        - An attacker on that network sends fake ARP replies that say "that IP address is at my MAC address."
        - Nearby devices then send their traffic to the attacker. It only works on that one local network.

        Both attacks plant a false record so traffic goes to the attacker. They differ in what they change and how far they reach: one resolver can answer for many networks, like every school in a district.
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
          prompt: 'A school wants to protect its users from poisoning like this. Which of these help?',
          multi: true,
          options: [
            { id: 'ids', text: 'A resolver that uses unpredictable query IDs and source ports.', correct: true },
            { id: 'https', text: 'Users who stop at HTTPS certificate warnings instead of clicking past them.', correct: true },
            { id: 'dnssec', text: 'Signed DNS records (DNSSEC), so the resolver rejects forgeries.', correct: true },
            { id: 'faster', text: 'A faster internet connection, so real answers always arrive first.', feedback: 'A faster connection does not change whether an answer can be forged. Mallory sends the burst the moment the resolver asks, and one matching fake is enough.' },
          ],
          explain: 'No single defense is enough. Random IDs and ports make forging hard, DNSSEC lets the resolver reject a forgery, and HTTPS catches the impostor when a bad address still gets through.',
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
