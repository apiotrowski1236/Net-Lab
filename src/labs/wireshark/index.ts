import type { NoteSpec } from '../../demos/types';
import { md } from '../md';
import type { LabDef, TextQuestion } from '../types';
import {
  addressInReply,
  all,
  COUNT,
  countOf,
  DNS_REPLY_RE,
  dnsServerNotAnswer,
  firstIp,
  FROM_DRAWING,
  IP_ANY,
  MAC_RE,
  me,
  myIp,
  notAnAddress,
  notDrawing,
  PORT_FROM_DRAWING,
  router,
  summaryEnds,
  SYN_ACK_RE,
  SYN_RE,
  synAckMatches,
  threeProtocols,
} from './answers';
import { ABOUT, DETAIL_MENU, HANDSHAKE, PIC, ROW_MENU, settings, SPLIT, SPLIT_NUM, terminal, UNSAVED, WELCOME, wsWindow } from './pictures';

/**
 * Wireshark for Real (AP Cybersecurity, lab 3). A lesson with no network:
 * students capture on their own computer with the real Wireshark, then paste
 * what it shows. The stage shows drawings of what to look for. Plan: PLAN.md.
 * Answer checks: answers.ts.
 */

const IPV6_HINT = { match: /\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}/i, text: 'That looks like an IPv6 address, with colons. Find the IPv4 address: four numbers with dots between them.' };

/** A note card on the stage holding one drawing, with a line under it. */
const pic = (id: string, title: string, html: string, caption = 'The drawings use made-up example addresses. Yours will be different.'): NoteSpec => ({
  kind: 'note',
  id,
  title,
  md: `${html}\n\n${caption}`,
});

/** "Packets: n" and "Displayed: n" questions in step 9. */
const countQ = (id: string, prompt: string, field: 'Packets' | 'Displayed', verify?: TextQuestion['verify']): TextQuestion => ({
  id,
  kind: 'text',
  prompt,
  placeholder: 'Type a number',
  expect: COUNT,
  expectHint: `Type the number after **${field}:** in the status bar at the bottom of Wireshark.`,
  verify: (v, a) => (countOf(v, field) === undefined ? `Type the number after ${field}:.` : verify?.(v, a)),
});

export const wiresharkLab: LabDef = {
  id: 'wireshark',
  version: 1,
  title: 'Wireshark for Real',
  tagline: "Capture your own computer's traffic on the school Wi-Fi with Wireshark, and copy real DNS, web, TCP, and TLS packets out of it.",
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves'],
  ced: ['3.1.A'],
  minutes: 50,
  objectives: [
    'Check your Wireshark install, capture on the right interface, and follow the rules for capturing with permission.',
    "Find your computer's IP and MAC addresses, filter a capture, and copy values out of Wireshark.",
    'Read real DNS, HTTP, TCP, and TLS packets, and explain what each one does.',
    'Explain what a capture shows in plain text, what encryption hides, and why your capture misses other computers\u2019 traffic.',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'install',
      title: 'Check your Wireshark',
      body: md`
        > **How this lab works.** You do each task in **Wireshark** on your computer, then copy what it shows into this page. Do it all on that computer, with this page and Wireshark side by side. The checker reads what you paste, so paste it the way Wireshark shows it.

        In the last lab you captured packets on a pretend network. Today you'll capture real ones: the packets your own computer sends and receives on the school Wi-Fi. You'll use **Wireshark**, the free program network technicians and security analysts use.

        **The rules.** Your teacher has the school's permission for this class to capture on the school Wi-Fi during this lab. That permission covers only this:

        - Capture only on your own computer, on the school Wi-Fi.
        - Keep Wireshark's normal settings. Don't turn on **monitor mode**, a setting that tries to pick up other devices' Wi-Fi.
        - Don't try to see anyone else's traffic, and don't save or share your capture.

        Capturing other people's traffic without permission breaks school rules and the law.

        Your teacher asked you to install Wireshark before class. Open it, then open its **About** window: **Help > About Wireshark** on Windows, or **Wireshark > About Wireshark** on a Mac.

        **Not installed yet?** Go to **wireshark.org** and press **Download**. Use only that site. On **Windows**, keep the installer's choices, and install **Npcap** when it offers it: Wireshark captures through it. On a **Mac**, drag Wireshark into Applications, then double-click **Install ChmodBPF** in the same window: it lets Wireshark read the network card. Wireshark doesn't run on Chromebooks. If an installer asks for a password you don't have, ask your teacher.
      `,
      demos: [pic('about', 'The About window', ABOUT, 'Your version number may be newer.')],
      questions: [
        {
          id: 'version',
          kind: 'text',
          prompt: 'What version of Wireshark did you install? Copy the number after **Version** in the About window.',
          placeholder: 'Like 1.2.3',
          expect: /\b[3-9]\.\d{1,2}(?:\.\d{1,2})?\b/,
          wrong: [{ match: /\b[12]\.\d/, text: "That's an old version. Download the newest one from wireshark.org." }],
          expectHint: 'Find the number with dots right after **Version**, at the top of the About window.',
          verify: (v) => (/0f2a1c2/.test(v) ? FROM_DRAWING : undefined),
          explain: 'Wireshark is installed. Close the About window.',
        },
        {
          id: 'permission',
          kind: 'choice',
          prompt: "Which capture does this lab's permission cover?",
          options: [
            { id: 'mine', text: 'Your own computer, on the school Wi-Fi, during this lab', correct: true },
            {
              id: 'friend',
              text: "A classmate's laptop, if you're helping them",
              feedback: 'The permission covers your own computer. If a classmate needs help, they run Wireshark on their computer while you point.',
            },
            {
              id: 'cafe',
              text: "A coffee shop's Wi-Fi, because anyone can join it",
              feedback: "Anyone can join, but nobody gave you permission to capture there. The network's owner decides that.",
            },
            {
              id: 'later',
              text: 'The school Wi-Fi, any time this year',
              feedback: 'The permission is for this lab, in class. Another time needs permission again.',
            },
          ],
          explain: 'Your own computer, on this network, for this lab. Anything else needs permission from whoever owns the device or the network.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'first-capture',
      title: 'Your first real capture',
      body: md`
        When Wireshark opens, it lists your computer's **interfaces**: its network connections, like Wi-Fi. Next to each is a small line. A moving line means packets are going by.

        1. Double-click **Wi-Fi**. On a Mac it may say **Wi-Fi: en0**. If your computer uses a network cable, pick **Ethernet**. Packets start filling the list.
        2. Wait about 30 seconds. Don't touch the computer.
        3. Press **Stop**, the red square at the top left.

        You didn't do anything, but your computer still sent and received packets. Apps check for messages and updates in the background, and other devices on the Wi-Fi send some packets to everyone.

        The bar along the bottom of the window is the **status bar**. It counts your packets. The **Protocol** column in the list says what kind each packet is.
      `,
      demos: [
        pic('welcome', 'Pick an interface', WELCOME, 'Your list may have other names. Pick the one with a moving line.'),
        pic(
          'window',
          'After you press Stop',
          wsWindow({
            label: "A drawing of Wireshark's window after a capture. The Protocol column of the packet list is ringed, and so is the status bar, which says Packets: 1482.",
            rows: [
              ['tcp', 1, '0.000000', PIC.me, '198.51.100.7', '', 96, ''],
              ['udp', 2, '0.412318', PIC.me, PIC.dns, '', 82, ''],
              ['arp', 3, '0.881020', 'Dell_44:10:2c', 'Broadcast', '', 60, ''],
              ['udp', 4, '1.204413', '192.0.2.61', '224.0.0.251', '', 87, ''],
              ['tcp', 5, '1.559802', PIC.me, '198.51.100.7', '', 54, ''],
            ],
            fog: true,
            status: { packets: 1482 },
            hi: { status: 'Packets: is the count' },
            hiHead: 'Protocol',
          }),
          'The drawing hides the Protocol and Info columns. Read them in your own Wireshark.',
        ),
      ],
      questions: [
        {
          id: 'count',
          kind: 'text',
          prompt: 'How many packets did you capture? Read the number after **Packets:** in the status bar.',
          placeholder: 'Type a number',
          expect: COUNT,
          expectHint: 'Type the number after **Packets:** in the status bar at the bottom of Wireshark.',
          verify: (v) => {
            const n = countOf(v, 'Packets') ?? 0;
            if (n === 1482) return FROM_DRAWING;
            if (n < 10)
              return "That's very few for 30 seconds on the school Wi-Fi. Check that you picked the interface with a moving line (Wi-Fi), then capture for another 30 seconds and read Packets: again.";
            return undefined;
          },
          explain: 'All of that in 30 seconds, with nobody using the computer.',
        },
        {
          id: 'protocols',
          kind: 'text',
          prompt: 'Name three different protocols from the **Protocol** column.',
          placeholder: 'Three names, with commas between them',
          expect: /\S+[\s,]+\S+[\s,]+\S+/,
          expectHint: 'Write three names from the Protocol column, with commas between them.',
          verify: threeProtocols,
          explain: "You'll meet the most common ones in this lab: DNS, HTTP, TCP, and TLS.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'you',
      title: 'Find your computer',
      body: md`
        Every packet your computer sends carries two of its addresses. Its **IP address** names your computer on the school network. Its **MAC address** names its network card, for the first hop to the router.

        **1. Find your IP address** in your computer's settings:

        - **Windows**: press the Windows key, type **cmd**, and press Enter. In the black window (**Command Prompt**), type \`ipconfig\` and press Enter. Under **Wireless LAN adapter Wi-Fi**, find **IPv4 Address**.
        - **Mac**: open **System Settings**, then **Wi-Fi**. Press **Details** next to your network, then **TCP/IP**. Find **IP address**.

        Keep that window open. You'll need it again.

        **2. Find your MAC address** in Wireshark, inside a packet your computer sent:

        - Click the **filter bar** above the packet list. Type \`ip.src == 192.0.2.25\` with your own IP address in place of 192.0.2.25, and press Enter. The bar turns green, and the list shows only packets from your computer. (A red bar means a typo.)
        - Click any packet. Its layers show in the pane under the list. Click the arrow next to **Ethernet II** to open it.
        - Right-click **Source** (on a Mac, you can also hold Control and click). Choose **Copy**, then **Value**: that gives the whole address, without the card maker's name in front.
      `,
      demos: [
        pic(
          'ipconfig',
          'Windows: ipconfig',
          terminal(
            'Command Prompt',
            "A drawing of Command Prompt after typing ipconfig. Under Wireless LAN adapter Wi-Fi, the line IPv4 Address 192.0.2.25 is ringed.",
            ['C:\\> ipconfig', '', 'Wireless LAN adapter Wi-Fi:', '', `   IPv4 Address. . . . . . . . . . . : ${PIC.me}`, '   Subnet Mask . . . . . . . . . . . : 255.255.255.0', `   Default Gateway . . . . . . . . . : ${PIC.router}`],
            [4, 'Your IP address'],
          ),
        ),
        pic(
          'mac-settings',
          'Mac: Wi-Fi Details, TCP/IP',
          settings('Wi-Fi > Details > TCP/IP', 'A drawing of the Mac TCP/IP settings. The line IP address 192.0.2.25 is ringed.', [
            ['Configure IPv4', 'Using DHCP'],
            ['IP address', PIC.me, 'Your IP address'],
            ['Subnet mask', '255.255.255.0'],
            ['Router', PIC.router],
          ]),
        ),
        pic(
          'copy-mac',
          'Wireshark: copy the Source',
          wsWindow({
            label: `A drawing of Wireshark with the filter ip.src == ${PIC.me}. A packet is selected. Its Ethernet II layer is open, and the Source line is ringed. A right-click menu is open at Copy, with Value ringed.`,
            filter: `ip.src == ${PIC.me}`,
            rows: [
              ['tcp', 41, '3.220187', PIC.me, '198.51.100.7', 'TLSv1.3', 96, 'Application Data'],
              ['udp', 44, '3.502210', PIC.me, PIC.dns, 'DNS', 82, 'Standard query 0x1f2e A mail.example.com'],
            ],
            selected: 0,
            details: [
              { text: 'Frame 41: 96 bytes on wire (768 bits), 96 bytes captured (768 bits)', open: false },
              { text: `Ethernet II, Src: Apple_5c:21:9f (${PIC.mac}), Dst: Cisco_6e:0a:01 (${PIC.routerMac})`, open: true },
              { text: `Destination: Cisco_6e:0a:01 (${PIC.routerMac})`, depth: 1, open: false },
              { text: `Source: Apple_5c:21:9f (${PIC.mac})`, depth: 1, open: false, hi: 'Right-click' },
              { text: 'Type: IPv4 (0x0800)', depth: 1 },
              { text: `Internet Protocol Version 4, Src: ${PIC.me}, Dst: 198.51.100.7`, open: false },
              { text: 'Transmission Control Protocol, Src Port: 52114, Dst Port: 443', open: false },
            ],
            menu: DETAIL_MENU,
            status: { packets: 1482, displayed: 1104 },
            hi: { filter: 'Filter bar' },
          }),
        ),
      ],
      questions: [
        {
          id: 'my-ip',
          kind: 'text',
          prompt: "What is your computer's IP address?",
          placeholder: 'Four numbers with dots',
          expect: IP_ANY,
          wrong: [IPV6_HINT],
          expectHint: 'Type the IPv4 address from ipconfig (Windows) or the TCP/IP window (Mac): four numbers with dots between them.',
          verify: all(notDrawing, (v) => notAnAddress(firstIp(v))),
          explain: "Every packet your computer sends on this network carries this address as its Source. It's a private address: the school's router swaps in the school's own public address before packets go out to the internet.",
        },
        {
          id: 'my-mac',
          kind: 'text',
          prompt: "Paste your computer's MAC address, from the **Source** line of **Ethernet II**.",
          placeholder: 'Six pairs, like 1a:2b:3c:4d:5e:6f',
          expect: MAC_RE,
          wrong: [
            { match: /^[a-z0-9]+_[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/i, text: "That's the short form, with the maker's name. Right-click Source, then choose Copy, then Value, to get all six pairs." },
            { match: IP_ANY, text: "That's an IP address. Open the Ethernet II layer and copy its Source: six pairs of letters and numbers with colons." },
          ],
          expectHint: 'Open **Ethernet II** in a packet your computer sent. Right-click **Source**, then choose **Copy**, then **Value**.',
          verify: all(notDrawing, (v) => {
            const mac = v.match(MAC_RE)![0].toLowerCase().replace(/-/g, ':');
            if (mac === 'ff:ff:ff:ff:ff:ff') return "That's the broadcast address, which means everyone. Use the Source of a packet your computer sent.";
            if (parseInt(mac.slice(0, 2), 16) & 1) return "That's a group (multicast) address, which no network card owns. Use the Source of a packet your computer sent.";
            return undefined;
          }),
          explain: 'Packets carry this MAC address only as far as the router. Your IP address stays on them across the school network.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'dns',
      title: 'Name lookups',
      body: md`
        To reach wikipedia.org, your computer needs its IP address. It asks a **DNS server**, which turns names into addresses. You'll make your computer ask, and catch the question and the answer.

        1. Press the blue shark fin (**Start**) at the top left to start a new capture. When Wireshark asks whether to save the old one, choose **Continue without Saving**.
        2. In Command Prompt (Windows) or Terminal (Mac), type \`nslookup wikipedia.org\` and press Enter. It prints the address it got. (To open Terminal on a Mac, press Command and the space bar, type **Terminal**, and press Enter.)
        3. Press **Stop**. Type \`dns\` in the filter bar and press Enter.
        4. Find the **response**: its Info starts with **Standard query response** and ends with an address. Skip any that say **No such name**. Windows sometimes tries the name with the school's ending added first.
        5. Right-click that row. Choose **Copy**, then **Summary as Text**. Paste it below.

        DNS sends each question and answer in one **UDP** packet: UDP sends a packet without opening a connection first. The number after **Standard query**, like ${PIC.txid}, is the lookup's **Transaction ID**. The question and its answer have the same one.
      `,
      demos: [
        pic(
          'nslookup',
          'nslookup on Windows',
          terminal(
            'Command Prompt',
            'A drawing of Command Prompt after typing nslookup wikipedia.org. It shows the DNS server, then the answer: an IPv6 address and an IPv4 address.',
            ['C:\\> nslookup wikipedia.org', 'Server:   dns.school.example', `Address:  ${PIC.dns}`, '', 'Non-authoritative answer:', 'Name:     wikipedia.org', 'Addresses:  2001:db8::224', `           ${PIC.wikiIp}`],
          ),
          'A Mac shows almost the same thing. The drawings use made-up example addresses. Yours will be different.',
        ),
        pic(
          'dns',
          'Wireshark: copy the response',
          wsWindow({
            label: `A drawing of Wireshark with the filter dns. Four rows: a query and a response for an A record, then for AAAA. The A response, Standard query response ${PIC.txid} A wikipedia.org A ${PIC.wikiIp}, is ringed, with a right-click menu open at Copy, Summary as Text.`,
            filter: 'dns',
            rows: [
              ['udp', 12, '0.000000', PIC.me, PIC.dns, 'DNS', 73, `Standard query ${PIC.txid} A wikipedia.org`],
              ['udp', 13, '0.018322', PIC.dns, PIC.me, 'DNS', 89, `Standard query response ${PIC.txid} A wikipedia.org A ${PIC.wikiIp}`],
              ['udp', 14, '0.019004', PIC.me, PIC.dns, 'DNS', 73, 'Standard query 0x7a11 AAAA wikipedia.org'],
              ['udp', 15, '0.036870', PIC.dns, PIC.me, 'DNS', 101, 'Standard query response 0x7a11 AAAA wikipedia.org AAAA 2001:db8::224'],
            ],
            selected: 1,
            hiRow: [1, 'Right-click'],
            menu: ROW_MENU,
            status: { packets: 214, displayed: 4 },
          }),
        ),
      ],
      questions: [
        {
          id: 'reply',
          kind: 'text',
          prompt: "Paste the summary of the DNS server's response for wikipedia.org.",
          lines: 2,
          placeholder: 'Right-click the row, then Copy, then Summary as Text',
          expect: DNS_REPLY_RE,
          wrong: [
            { match: /No such name/i, text: 'That response says No such name: the lookup with the school\u2019s ending added. Find the response for wikipedia.org that ends with an address.' },
            { match: /Standard query 0x/i, text: "That's the query, your computer's question. Paste the response, the answer: its Info starts with Standard query response." },
            { match: /AAAA/, text: 'That response has an IPv6 address (AAAA). Find the one that says A wikipedia.org and ends with an address with dots.' },
            { match: /Standard query response/i, text: "That's a lookup for another name. Find the response for wikipedia.org." },
          ],
          expectHint: 'Filter `dns`. Right-click the row whose Info starts with **Standard query response** and ends with an address. Choose **Copy**, then **Summary as Text**.',
          verify: all(notDrawing, summaryEnds(/Standard query/i, undefined, me)),
          explain: 'The answer came back in one small UDP packet, readable by anyone who can see it.',
        },
        {
          id: 'address',
          kind: 'text',
          prompt: 'What IP address did the DNS server give for wikipedia.org?',
          placeholder: 'Four numbers with dots',
          expect: IP_ANY,
          wrong: [IPV6_HINT],
          expectHint: 'Copy the address at the end of the response, after the last **A**.',
          verify: all(notDrawing, dnsServerNotAnswer, addressInReply),
          explain: 'Your browser connects to this address when you visit wikipedia.org.',
        },
        {
          id: 'why-id',
          kind: 'choice',
          prompt: 'A question and its answer share a **Transaction ID**. What is it for?',
          options: [
            { id: 'match', text: 'It lets your computer match each answer to the question it asked', correct: true },
            { id: 'who', text: 'It tells the DNS server which computer is asking', feedback: 'Your IP address does that, in the IP layer. The ID is a number your computer picks for each question.' },
            { id: 'lock', text: 'It locks the lookup so nobody else can read it', feedback: 'DNS is not encrypted: you read the whole answer in your capture. The ID only matches answers to questions.' },
            { id: 'site', text: "It's wikipedia.org's number on the DNS server", feedback: 'Look up the same name twice and you get two different IDs. Your computer picks a new one each time.' },
          ],
          explain: 'Your computer can have several questions out at once. Each answer carries its question\u2019s ID, so it lands in the right place. In a later lab, an attacker guesses these IDs to slip in fake answers.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'http',
      title: 'Plain web traffic',
      body: md`
        Most websites use **HTTPS**, which locks what they send. A few still use plain **HTTP**, with no lock. **neverssl.com** does on purpose: people use it to test networks.

        1. Start a new capture (**Continue without Saving**).
        2. In the browser on the computer running Wireshark, go to \`http://neverssl.com\`. Type the http:// part too. If the browser warns that the site isn't secure, choose to continue to the site. The page then moves you to a new, made-up name, like calmquietmorning.neverssl.com.
        3. When the page has loaded, press **Stop**. Filter \`http\`. (Nothing shows? Load the page again while capturing.)
        4. Find a **GET** request: your browser asking for a page. Right-click it, choose **Copy**, then **Summary as Text**, and paste it below.
        5. Click the same row. Open **Hypertext Transfer Protocol** in the pane under the list. Find the **Host** line: the name of the site the browser asked for. (The \`\\r\\n\` at the end only marks the end of the line.)
      `,
      demos: [
        pic(
          'http',
          'Wireshark: an HTTP request',
          wsWindow({
            label: `A drawing of Wireshark with the filter http. Rows: GET /, 200 OK, GET /online, 301 Moved Permanently, GET /online/, 200 OK. The GET /online request is selected. Its Hypertext Transfer Protocol layer is open, and the Host line, Host: ${PIC.neverssl}, is ringed.`,
            filter: 'http',
            rows: [
              ['http', 8, '0.104233', PIC.me, PIC.neversslIp, 'HTTP', 403, 'GET / HTTP/1.1'],
              ['http', 10, '0.191540', PIC.neversslIp, PIC.me, 'HTTP', 1102, 'HTTP/1.1 200 OK  (text/html)'],
              ['http', 19, '0.388129', PIC.me, PIC.neversslIp, 'HTTP', 418, 'GET /online HTTP/1.1'],
              ['http', 21, '0.470211', PIC.neversslIp, PIC.me, 'HTTP', 559, 'HTTP/1.1 301 Moved Permanently  (text/html)'],
              ['http', 23, '0.471802', PIC.me, PIC.neversslIp, 'HTTP', 419, 'GET /online/ HTTP/1.1'],
              ['http', 25, '0.552960', PIC.neversslIp, PIC.me, 'HTTP', 2311, 'HTTP/1.1 200 OK  (text/html)'],
            ],
            selected: 2,
            details: [
              { text: 'Ethernet II', open: false },
              { text: `Internet Protocol Version 4, Src: ${PIC.me}, Dst: ${PIC.neversslIp}`, open: false },
              { text: `Transmission Control Protocol, Src Port: ${PIC.port}, Dst Port: 80`, open: false },
              { text: 'Hypertext Transfer Protocol', open: true },
              { text: 'GET /online HTTP/1.1\\r\\n', depth: 1, open: false },
              { text: `Host: ${PIC.neverssl}\\r\\n`, depth: 1, hi: 'Host' },
              { text: 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) …\\r\\n', depth: 1 },
            ],
            status: { packets: 388, displayed: 6 },
          }),
        ),
      ],
      questions: [
        {
          id: 'get',
          kind: 'text',
          prompt: 'Paste the summary of a **GET** request to neverssl.com.',
          lines: 2,
          placeholder: 'Right-click the row, then Copy, then Summary as Text',
          expect: /\bGET\s+\/\S*\s+HTTP\/1\.[01]/,
          wrong: [
            { match: /HTTP\/1\.[01]\s+\d{3}/, text: "That's the server's answer. Paste the request: its Info starts with GET." },
            { match: /\bget\b/i, text: 'Copy the row with Copy > Summary as Text, so the capitals and spaces stay the way Wireshark writes them.' },
          ],
          expectHint: 'Filter `http`. Right-click a row whose Info starts with **GET**, then choose **Copy**, then **Summary as Text**.',
          verify: all(notDrawing, summaryEnds(/\bGET\s/, me)),
          explain: 'Your browser asked for the page in plain text, as an HTTP GET request.',
        },
        {
          id: 'host',
          kind: 'text',
          prompt: 'What does that request\u2019s **Host** line say?',
          placeholder: 'The name after Host:',
          expect: /\b(?:[a-z0-9-]+\.)*neverssl\.com\b/i,
          wrong: [{ match: /\.[a-z]{2,}/i, text: "That's another site. Use a GET request to neverssl.com." }],
          expectHint: 'Click the GET request. Open **Hypertext Transfer Protocol** in the pane under the list, and copy the name after **Host:**.',
          verify: notDrawing,
          explain: 'One web server can hold many sites. The Host line tells it which one the browser wants.',
        },
        {
          id: 'who-reads',
          kind: 'choice',
          prompt: 'neverssl.com uses plain HTTP. Who could read this page as it traveled to you?',
          options: [
            { id: 'path', text: 'Anyone who could see the packets on the way, like whoever runs a network they crossed', correct: true },
            { id: 'nobody', text: 'Nobody, because the Wi-Fi password scrambles it', feedback: "Wi-Fi's lock lasts only from your computer to the access point. From there, the packets cross other networks as plain text." },
            { id: 'site', text: 'Only you and the website, because HTTP is private', feedback: 'You read it in your own capture. Nothing in HTTP hides the page from anyone else who sees the packets.' },
            { id: 'wireshark', text: 'Only people who have Wireshark installed', feedback: 'Wireshark is one tool. Any device that carries the packets, like a router, can read plain HTTP.' },
          ],
          explain: 'Plain HTTP has no lock, so a password typed into an HTTP page would travel as readable text. That\u2019s why sites use HTTPS.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'handshake',
      title: 'Opening a connection',
      body: md`
        Before the GET, your browser and the web server opened a **connection** with three small **TCP** packets. This is the **handshake**:

        1. **[SYN]**: your computer asks to connect.
        2. **[SYN, ACK]**: the server agrees.
        3. **[ACK]**: your computer confirms. Now the GET can go.

        Each TCP packet names two **ports**. A port says which program on a computer the packet is for. Web servers listen on port 80 for HTTP. Your computer picks a big temporary port for each connection, so the replies find their way back to it.

        Use the same capture. Filter \`tcp.port == 80\`. Wireshark writes the ports in Info with an arrow: **52114 → 80** means from port 52114 to port 80. Copy each packet's summary, the way you did in the last step.
      `,
      demos: [
        pic('shake', 'The handshake', HANDSHAKE, 'The port numbers in your capture will be different.'),
        pic(
          'list',
          'Wireshark: tcp.port == 80',
          wsWindow({
            label: `A drawing of Wireshark with the filter tcp.port == 80. Rows: ${PIC.port} → 80 [SYN], 80 → ${PIC.port} [SYN, ACK], ${PIC.port} → 80 [ACK], then GET / HTTP/1.1.`,
            filter: 'tcp.port == 80',
            rows: [
              ['http', 5, '0.061870', PIC.me, PIC.neversslIp, 'TCP', 66, `${PIC.port} → 80 [SYN] Seq=0 Win=64240 Len=0 MSS=1460 WS=256 SACK_PERM`],
              ['http', 6, '0.103112', PIC.neversslIp, PIC.me, 'TCP', 66, `80 → ${PIC.port} [SYN, ACK] Seq=0 Ack=1 Win=26883 Len=0 MSS=1460 SACK_PERM WS=128`],
              ['http', 7, '0.103301', PIC.me, PIC.neversslIp, 'TCP', 54, `${PIC.port} → 80 [ACK] Seq=1 Ack=1 Win=131328 Len=0`],
              ['http', 8, '0.104233', PIC.me, PIC.neversslIp, 'HTTP', 403, 'GET / HTTP/1.1'],
            ],
            status: { packets: 388, displayed: 31 },
          }),
        ),
      ],
      questions: [
        {
          id: 'syn',
          kind: 'text',
          prompt: 'Paste the summary of a **[SYN]** your computer sent to port 80.',
          lines: 2,
          placeholder: 'Right-click the row, then Copy, then Summary as Text',
          expect: SYN_RE,
          wrong: [
            { match: /\[SYN,\s*ACK\]/i, text: "That's the server's answer. Paste the [SYN] your computer sent before it." },
            { match: /(→|->|>)\s*443\b/, text: 'That connection goes to port 443, which is HTTPS. Filter `tcp.port == 80` and find a [SYN] to port 80.' },
          ],
          expectHint: 'Filter `tcp.port == 80`. Copy a row whose Info has **→ 80 [SYN]** in it.',
          verify: all(notDrawing, (v) => (v.includes(PIC.port) ? PORT_FROM_DRAWING : undefined), summaryEnds(SYN_RE, me)),
          explain: 'The number before the arrow is the temporary port your computer picked. Port 80 is the web server.',
        },
        {
          id: 'syn-ack',
          kind: 'text',
          prompt: 'Paste the summary of the **[SYN, ACK]** that answered it.',
          lines: 2,
          placeholder: 'Right-click the row, then Copy, then Summary as Text',
          expect: SYN_ACK_RE,
          wrong: [
            { match: /\[SYN\]/i, text: "That's your computer's [SYN] again. The answer is marked [SYN, ACK]." },
            { match: /\[ACK\]/i, text: 'That one is marked [ACK] only: the third packet. Find the one marked [SYN, ACK].' },
          ],
          expectHint: 'Find the row right after your [SYN] whose Info has **80 →** and **[SYN, ACK]** in it.',
          verify: all(notDrawing, (v) => (v.includes(PIC.port) ? PORT_FROM_DRAWING : undefined), synAckMatches, summaryEnds(SYN_ACK_RE, undefined, me)),
          explain: 'The server answered from port 80 to the same temporary port your [SYN] came from. Open the site in a second tab and you may get a second connection, with a different temporary port.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'tls',
      title: 'Locked web traffic',
      body: md`
        **HTTPS** is HTTP inside **TLS** (Transport Layer Security), which **encrypts** it: it scrambles the page so only your browser and the server can read it. But first the browser has to say which site it wants. Its first TLS message, the **Client Hello**, carries the site's name.

        1. Start a new capture (**Continue without Saving**).
        2. In the browser on the computer running Wireshark, go to \`https://www.wikipedia.org\`.
        3. When it loads, press **Stop**. Filter \`tls.handshake.type == 1\`. Type 1 means Client Hello, so the list shows every site your browser said hello to. (If the Protocol column says QUIC, skip that row: pick one that says TLS.)
        4. Find the one whose Info says \`Client Hello (SNI=www.wikipedia.org)\`. **SNI** stands for Server Name Indication: the site's name. Copy its summary.
        5. Filter \`tls\`. Click a row whose Info says **Application Data**, and open **Transport Layer Security**. You'll see **Encrypted Application Data**: the locked page.

        HTTPS goes to port 443, the way plain HTTP goes to port 80.
      `,
      demos: [
        pic(
          'hello',
          'Wireshark: Client Hellos',
          wsWindow({
            label: `A drawing of Wireshark with the filter tls.handshake.type == 1. Three Client Hello rows, each with a site name after SNI=. The first, for www.wikipedia.org, is selected, and its Server Name line is ringed in the layers below.`,
            filter: 'tls.handshake.type == 1',
            rows: [
              ['tcp', 31, '0.000000', PIC.me, PIC.wikiIp, 'TLSv1.3', 571, 'Client Hello (SNI=www.wikipedia.org)'],
              ['tcp', 58, '0.240133', PIC.me, '198.51.100.240', 'TLSv1.3', 583, 'Client Hello (SNI=upload.wikimedia.org)'],
              ['tcp', 77, '0.511920', PIC.me, '203.0.113.80', 'TLSv1.3', 602, 'Client Hello (SNI=www.example.org)'],
            ],
            selected: 0,
            details: [
              { text: `Transmission Control Protocol, Src Port: ${PIC.port}, Dst Port: 443`, open: false },
              { text: 'Transport Layer Security', open: true },
              { text: 'TLSv1.3 Record Layer: Handshake Protocol: Client Hello', depth: 1, open: true },
              { text: 'Extension: server_name (len=22) name=www.wikipedia.org', depth: 2, open: true },
              { text: 'Server Name: www.wikipedia.org', depth: 3, hi: "The site's name" },
            ],
            status: { packets: 903, displayed: 3 },
          }),
        ),
      ],
      questions: [
        {
          id: 'hello',
          kind: 'text',
          prompt: 'Paste the summary of the **Client Hello** for wikipedia.org.',
          lines: 2,
          placeholder: 'Right-click the row, then Copy, then Summary as Text',
          expect: /Client Hello[\s\S]*wiki[mp]edia\.org/i,
          wrong: [
            { match: /Server Hello/i, text: "That's the server's answer. Paste the Client Hello your browser sent." },
            {
              match: /^(?![\s\S]*SNI=)[\s\S]*Client Hello/i,
              text: "Your Wireshark doesn't show the name in Info. Open Transport Layer Security, then the Client Hello, then Extension: server_name. Copy the Server Name and paste it after the summary.",
            },
            { match: /Client Hello/i, text: "That Client Hello is for another site. Find the one that says wikipedia.org." },
          ],
          expectHint: 'Filter `tls.handshake.type == 1`. Copy the row whose Info says **Client Hello (SNI=www.wikipedia.org)**.',
          verify: all(notDrawing, summaryEnds(/Client Hello/i, me)),
          explain: 'The site\u2019s name traveled in plain view, before the lock was set up.',
        },
        {
          id: 'still-see',
          kind: 'choice',
          prompt: 'Someone running the network has a capture of your visit. What can they learn?',
          options: [
            { id: 'site', text: 'That you visited wikipedia.org, but not which pages you read', correct: true },
            { id: 'nothing', text: 'Nothing, because HTTPS hides the whole visit', feedback: 'You read the site name in the Client Hello, and the addresses are in plain view. Only the pages are locked.' },
            { id: 'pages', text: 'Which articles you read, since they see every packet', feedback: 'They see the packets, but the pages are inside Application Data, which is encrypted.' },
            { id: 'password', text: 'Your password, if you sign in', feedback: 'What you type goes inside the encrypted part, like the pages.' },
          ],
          explain: 'HTTPS hides what you read and type. It doesn\u2019t hide which site you talked to, when, or how much.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'not-mine',
      title: "What your capture can't see",
      body: md`
        Your computer shares the school Wi-Fi with dozens of others. Does your capture show their traffic? Count to find out. Use the capture you have open, from the last step.

        1. Read **Packets:** in the status bar: the whole capture.
        2. Filter \`ip.addr == 192.0.2.25\`, with your address from step 3 in place of 192.0.2.25. This shows every packet to or from your computer. Read **Displayed:**.
        3. Filter \`!(ip.addr == 192.0.2.25)\`, again with your address. The \`!\` means "not". Read **Displayed:** again.

        Click a few packets in the second list. Many are sent to every device (**broadcast**) or to a group of devices (**multicast**). This list can also hold some of your own packets: **IPv6** ones, with long addresses and colons, because \`ip.addr\` only matches addresses with dots.

        Is anything there a classmate's web page?
      `,
      demos: [
        pic('split', 'Two filters, one capture', SPLIT),
        pic(
          'others',
          'Wireshark: not your address',
          wsWindow({
            label: `A drawing of Wireshark with the filter !(ip.addr == ${PIC.me}). Rows: an ARP broadcast, two MDNS packets, and an SSDP packet, all from other devices.`,
            filter: `!(ip.addr == ${PIC.me})`,
            rows: [
              ['arp', 112, '9.881020', 'Dell_44:10:2c', 'Broadcast', 'ARP', 60, `Who has ${PIC.router}? Tell 192.0.2.77`],
              ['udp', 140, '11.204413', '192.0.2.61', '224.0.0.251', 'MDNS', 87, 'Standard query 0x0000 PTR _googlecast._tcp.local'],
              ['udp', 151, '12.003118', '192.0.2.88', '239.255.255.250', 'SSDP', 216, 'M-SEARCH * HTTP/1.1'],
              ['udp', 166, '13.517640', 'fe80::1c2b:3aff:fe4d:5e6f', 'ff02::fb', 'MDNS', 107, 'Standard query 0x0000 PTR _companion-link._tcp.local'],
            ],
            status: { packets: SPLIT_NUM.total, displayed: SPLIT_NUM.others },
            hi: { status: 'Displayed:' },
          }),
        ),
      ],
      questions: [
        countQ('total', 'How many packets are in the whole capture? (**Packets:**)', 'Packets', (v) => (countOf(v, 'Packets') === SPLIT_NUM.total ? FROM_DRAWING : undefined)),
        countQ('mine', 'How many show with `ip.addr ==` your address? (**Displayed:**)', 'Displayed', (v, a) => {
          const n = countOf(v, 'Displayed')!;
          const total = countOf(a('not-mine', 'total'), 'Packets');
          if (n === SPLIT_NUM.mine) return FROM_DRAWING;
          if (total !== undefined && n > total) return `That's more than the ${total} packets in the whole capture. Read the number after Displayed, not Packets.`;
          return undefined;
        }),
        countQ('others', 'How many show with the "not" filter, `!(ip.addr == ...)`? (**Displayed:**)', 'Displayed', (v, a) => {
          const n = countOf(v, 'Displayed')!;
          const total = countOf(a('not-mine', 'total'), 'Packets');
          const mine = countOf(a('not-mine', 'mine'), 'Displayed');
          if (n === SPLIT_NUM.others) return FROM_DRAWING;
          if (total === undefined || mine === undefined || mine + n === total) return undefined;
          return `${mine} + ${n} = ${mine + n}, but the whole capture has ${total}. The two lists should add up to the whole capture. Use the same capture for all three numbers, and read the number after Displayed after each filter.`;
        }),
        {
          id: 'why',
          kind: 'choice',
          prompt: "Why doesn't your capture show your classmates' web pages?",
          options: [
            { id: 'card', text: 'Your Wi-Fi card keeps only packets for your computer or for everyone', correct: true },
            { id: 'encrypted', text: 'Wireshark hides encrypted packets', feedback: 'Your capture has plenty of encrypted packets: your own TLS. Your classmates\u2019 packets never reached Wireshark at all.' },
            { id: 'one-site', text: 'Wireshark shows one website at a time', feedback: 'Your capture had many sites and kinds of packets at once. Wireshark shows whatever reaches your card.' },
            { id: 'blocked', text: "Your classmates' computers block Wireshark", feedback: "Their computers don't do anything special. Their packets aren't addressed to yours." },
          ],
          explain: "Your Wi-Fi card keeps only packets addressed to your computer or to everyone, and each device's Wi-Fi traffic is locked with its own key. To capture someone else's packets, an attacker has to trick the network, like in later labs. Doing that here would break the rules from step 1.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'reflect',
      title: 'Reflect and clean up',
      body: md`
        You captured your own traffic and read real packets: DNS, HTTP, TCP, and TLS.

        Your capture also holds other devices' broadcasts, so don't keep it. When you finish the lab (and any extra credit), quit Wireshark: **File > Quit** on Windows, **Wireshark > Quit Wireshark** on a Mac. When it asks whether to save, choose **Quit without Saving**.
      `,
      demos: [pic('unsaved', 'When you quit', UNSAVED, 'Wireshark asks this when a capture has not been saved.')],
      questions: [
        {
          id: 'advice',
          kind: 'text',
          prompt:
            'A friend thinks HTTPS makes them invisible on the school Wi-Fi. Using what you saw today, explain what someone running the network could learn about their visit to a website, and what stays hidden. Name at least two kinds of packets you saw.',
          minWords: 40,
          lines: 5,
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.
      `,
    },

    // -----------------------------------------------------------------------
    {
      id: 'ping',
      title: 'Extra credit: ping your router',
      extra: true,
      body: md`
        A **ping** asks a computer "are you there?" and waits for an answer. Wireshark calls ping packets **ICMP**. You'll ping your router, the **default gateway**: your network's way out to the internet.

        Find its address in the window from step 3. On Windows, \`ipconfig\` shows it as **Default Gateway**. On a Mac, the TCP/IP window shows it as **Router**.

        1. Open Wireshark again if you closed it, and start a capture on Wi-Fi.
        2. **Windows**: in Command Prompt, type \`ping 192.0.2.1\` with your router's address in place of 192.0.2.1. **Mac**: in Terminal, type \`ping -c 4 192.0.2.1\` the same way. Either one sends four pings.
        3. When it finishes, press **Stop**. Filter \`icmp\`.

        Each **Echo (ping) request** from your computer should get an **Echo (ping) reply** from the router. If the command says **Request timed out** (Windows) or **Request timeout** (Mac), the network blocks pings. Then copy a request instead. Its Info ends with **(no response found!)**.
      `,
      demos: [
        pic(
          'ping',
          'Windows: ping',
          terminal(
            'Command Prompt',
            `A drawing of Command Prompt after typing ping ${PIC.router}: four lines that start with Reply from ${PIC.router}.`,
            [`C:\\> ping ${PIC.router}`, '', `Pinging ${PIC.router} with 32 bytes of data:`, ...[3, 2, 4, 2].map((t) => `Reply from ${PIC.router}: bytes=32 time=${t}ms TTL=64`)],
          ),
        ),
        pic(
          'ping-mac',
          'Mac: ping',
          terminal(
            'Terminal',
            `A drawing of a Mac Terminal after typing ping -c 4 ${PIC.router}: four lines that start with 64 bytes from ${PIC.router}.`,
            [`% ping -c 4 ${PIC.router}`, `PING ${PIC.router} (${PIC.router}): 56 data bytes`, ...[3.1, 2.4, 4.0, 2.2].map((t, i) => `64 bytes from ${PIC.router}: icmp_seq=${i} ttl=64 time=${t.toFixed(3)} ms`)],
          ),
        ),
        pic(
          'icmp',
          'Wireshark: icmp',
          wsWindow({
            label: `A drawing of Wireshark with the filter icmp: four Echo (ping) requests from ${PIC.me} to ${PIC.router}, each followed by an Echo (ping) reply from ${PIC.router}. The first reply is ringed.`,
            filter: 'icmp',
            rows: [1, 2, 3, 4].flatMap((n, i): ['icmp', number, string, string, string, string, number, string][] => [
              ['icmp', 3 + i * 4, `${i}.00${i}118`, PIC.me, PIC.router, 'ICMP', 74, `Echo (ping) request  id=0x0001, seq=${n}/${n * 256}, ttl=128 (reply in ${4 + i * 4})`],
              ['icmp', 4 + i * 4, `${i}.00${i}902`, PIC.router, PIC.me, 'ICMP', 74, `Echo (ping) reply    id=0x0001, seq=${n}/${n * 256}, ttl=64 (request in ${3 + i * 4})`],
            ]),
            hiRow: [1, 'A reply'],
            status: { packets: 97, displayed: 8 },
          }),
        ),
      ],
      questions: [
        {
          id: 'gateway',
          kind: 'text',
          prompt: "What is your router's IP address (the default gateway)?",
          placeholder: 'Four numbers with dots',
          expect: IP_ANY,
          wrong: [{ ...IPV6_HINT, text: 'That looks like an IPv6 address. Windows sometimes lists one first. Use the one with four numbers and dots.' }],
          expectHint: 'Use **Default Gateway** from `ipconfig` (Windows), or **Router** in the TCP/IP window (Mac).',
          verify: all(notDrawing, (v, a) => {
            const ip = firstIp(v);
            if (ip === myIp(a)) return "That's your own computer's address, from step 3. Find Default Gateway (Windows) or Router (Mac).";
            return notAnAddress(ip);
          }),
          explain: 'Every packet headed out to the internet goes to this address first.',
        },
        {
          id: 'reply',
          kind: 'text',
          prompt: 'Paste the summary of one **Echo (ping) reply**. If your pings timed out, paste a request instead.',
          lines: 2,
          placeholder: 'Right-click the row, then Copy, then Summary as Text',
          expect: /Echo \(ping\) reply|Echo \(ping\) request[\s\S]*no response found/i,
          wrong: [{ match: /Echo \(ping\) request/i, text: "That's a request, from your computer. Paste a reply, from the router. (Paste a request only if your pings timed out: its Info ends with (no response found!).)" }],
          expectHint: 'Filter `icmp`. Right-click a row whose Info starts with **Echo (ping) reply**, then choose **Copy**, then **Summary as Text**.',
          verify: all(notDrawing, (v, a) => (/reply/i.test(v) ? summaryEnds(/Echo/i, router, me) : summaryEnds(/Echo/i, me, router))(v, a)),
          explain: 'The reply came straight back from your router.',
        },
        {
          id: 'no-port',
          kind: 'choice',
          prompt: 'Open a ping packet. It has an IP layer but no TCP or UDP layer, so no ports. Why doesn\u2019t a ping need a port?',
          options: [
            { id: 'computer', text: 'The computer itself answers a ping, not a program like a web server', correct: true },
            { id: 'plain', text: 'Ports are only for encrypted traffic', feedback: 'Plain HTTP used port 80, and DNS used a port too. Ports pick a program, whether or not the data is locked.' },
            { id: 'router', text: 'The router removes the port before it answers', feedback: 'Your own request had no port either. Open one of the requests your computer sent.' },
            { id: 'small', text: 'Pings are too small to fit a port number', feedback: 'A port number takes two bytes. Pings leave it out because no program needs to get them.' },
          ],
          explain: 'ICMP is the network checking on itself. The computer\u2019s own networking software answers, so there\u2019s no program to pick.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'user-agent',
      title: 'Extra credit: what your browser says about you',
      extra: true,
      body: md`
        Every web request carries a **User-Agent** line: your browser telling the site what it is. With HTTPS only the site reads it. With plain HTTP, anyone who sees the packets can read it too.

        1. Open Wireshark again if you closed it, and start a capture on Wi-Fi.
        2. Go to \`http://neverssl.com\` again. When it loads, press **Stop**, and filter \`http\`.
        3. Click a GET request and open **Hypertext Transfer Protocol**, as in step 5. Right-click the **User-Agent** line, choose **Copy**, then **Value**.

        (On Windows 11 it still says Windows NT 10.0.) When you're done, quit Wireshark without saving, then hand in your work again.
      `,
      demos: [pic('http', 'Where the User-Agent is', wsWindow({
        label: 'A drawing of an HTTP request in Wireshark. Its Hypertext Transfer Protocol layer is open, and the User-Agent line is ringed.',
        filter: 'http',
        rows: [['http', 19, '0.388129', PIC.me, PIC.neversslIp, 'HTTP', 418, 'GET /online HTTP/1.1']],
        selected: 0,
        details: [
          { text: 'Hypertext Transfer Protocol', open: true },
          { text: 'GET /online HTTP/1.1\\r\\n', depth: 1, open: false },
          { text: `Host: ${PIC.neverssl}\\r\\n`, depth: 1 },
          { text: 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …\\r\\n', depth: 1, hi: 'User-Agent' },
        ],
        status: { packets: 388, displayed: 6 },
      }))],
      questions: [
        {
          id: 'agent',
          kind: 'text',
          prompt: 'Paste your **User-Agent** line.',
          lines: 2,
          expect: /Mozilla\/5\.0\s*\(/i,
          expectHint: 'Right-click the **User-Agent** line in **Hypertext Transfer Protocol**, then choose **Copy**, then **Value**. Browsers start it with Mozilla/5.0.',
          verify: (v) => (/AppleWebKit\/537\.36 …/.test(v) ? FROM_DRAWING : undefined),
          explain: 'Nearly every browser starts with Mozilla/5.0, for old reasons. The rest names your browser and system.',
        },
        {
          id: 'agent-says',
          kind: 'text',
          prompt: 'What does your User-Agent tell about your computer, to every site you visit and, with plain HTTP, to anyone watching? Why could that matter?',
          minWords: 25,
          lines: 3,
        },
      ],
    },
  ],
};
