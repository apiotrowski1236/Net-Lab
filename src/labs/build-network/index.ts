import type { Sim } from '../../sim/sim';
import { happened, inspected, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import {
  ADDR,
  breakBen,
  buildParts,
  cabled,
  dataCenter,
  dcServerIp,
  forwardRoute,
  gateways,
  hostOn,
  ipToward,
  linkUp,
  NET,
  officeLan,
  officeLanIp,
  officeRouter,
  returnRoute,
  routerLink,
  routesVia,
  SITE_URL,
  WEB_IP,
  WEB_PIN,
} from './scenario';

const alicePingsBen: ActionDef = {
  id: 'ping-ben',
  label: 'Alice pings Ben',
  run: (sim) => sim.ping('alice', sim.dev('ben').ifaces[0].ip ?? ADDR.ben),
};

const aliceOpens: ActionDef = { id: 'open', label: 'Alice opens the website', run: (sim) => sim.browse('alice', SITE_URL) };
const benOpens: ActionDef = { id: 'open-ben', label: 'Ben opens the website', run: (sim) => sim.browse('ben', SITE_URL) };

const plugged = (a: string, b: string) => ({ sim }: { sim: Sim }) => !!sim.linkBetween(a, b);

/** `device` got a ping reply from `fromIp` (when there is one) since the step started. */
const pinged = (sim: Sim, since: number, device: string, fromIp: string | undefined) =>
  !!fromIp && happened(sim, since, (e) => e.type === 'ping-reply' && e.device === device && e.from === fromIp);

const loaded = (device: string) => ({ sim, since }: { sim: Sim; since: number }) =>
  pageSince(sim, device, since, (b) => b.status === 'loaded' && b.from === WEB_IP);

const gatewayIsRouter = (device: string) => ({ sim }: { sim: Sim }) => {
  const gw = officeLanIp(sim);
  return !!gw && sim.dev(device).gateway === gw;
};

/** At least `n` of the three faults on Ben's computer are fixed: cable, address, gateway. */
const bensFixes = (n: number) => ({ sim }: { sim: Sim }) =>
  [plugged('ben', 'sw')({ sim }), hostOn(sim, 'ben', NET.office), gatewayIsRouter('ben')({ sim })].filter(Boolean).length >= n;

export const buildNetworkLab: LabDef = {
  id: 'build-network',
  version: 1,
  title: 'From Cable to Web Page',
  tagline: "Plug in the cables, hand out addresses, and teach the routers the way until Alice's browser loads the page.",
  unit: 3,
  codehs: ['3.1 How Network Traffic Moves'],
  ced: ['3.1.A', '3.1.B'],
  minutes: 45,
  objectives: [
    'Connect computers, a switch, and routers into a working network.',
    'Give devices IP addresses, and explain the network part and the host part.',
    'Explain what a default gateway and a static route do.',
    'Troubleshoot a network one layer at a time, starting with the cable.',
  ],
  build: buildParts,
  map: { ports: true, addresses: true },
  hostRoutes: true,
  steps: [
    {
      id: 'parts',
      title: 'The parts of a network',
      body: md`
        Every network is built from a few kinds of parts. They're all on the map, but nothing is plugged in yet.

        - [[alice]] and [[ben]] are **hosts**: computers that send and receive data.
        - [[sw]] is a **switch**. It connects the devices on one local network.
        - [[office]] and [[dc]] are **routers**. A router connects different networks and passes packets between them.
        - [[web]] is a **server**: a host that answers requests. This one serves the company website.

        Your job: get Alice's browser to load the page on the web server. You will plug in the cables, give each device an address, and teach the routers the way.

        Click [[alice]], then [[office]]. Compare their ports. A computer's port is often named **eth0**, short for its first Ethernet port. Router and switch ports are numbered.
      `,
      focus: ['alice', 'office'],
      goals: [
        { id: 'alice', label: 'Open [[alice]]', check: inspected('alice') },
        { id: 'office', label: 'Open [[office]]', check: inspected('office') },
      ],
      questions: [
        {
          id: 'switch-job',
          kind: 'choice',
          prompt: 'What does the switch do?',
          options: [
            { id: 'local', text: 'Connects the devices on one local network', correct: true },
            { id: 'between', text: 'Connects different networks, like the office and the data center', feedback: "That's a router's job." },
            { id: 'store', text: 'Stores the website', feedback: 'The web server stores the website.' },
            { id: 'address', text: 'Gives each computer its IP address', feedback: 'In this lab, you will type the addresses yourself.' },
          ],
          explain: 'A switch passes data between the devices plugged into it. It never leaves its own local network.',
        },
        {
          id: 'router-ports',
          kind: 'choice',
          prompt: 'Alice has one port. The office router has two. Why does a router need more than one?',
          options: [
            { id: 'networks', text: 'Each port connects to a different network', correct: true },
            { id: 'send-receive', text: 'One port sends and the other one receives', feedback: 'Every port both sends and receives.' },
            { id: 'spare', text: 'The second port is a spare in case one breaks', feedback: 'Both ports will be in use once the network is built. Where will each cable go?' },
          ],
          explain: 'A router sits where networks meet. It needs one port on each network it connects, and it passes packets between them.',
        },
      ],
    },

    {
      id: 'cables',
      title: 'Plug in the cables',
      body: md`
        Networks are built in **layers**. Each layer does one job and relies on the layer below it. The bottom one is the **physical layer**: cables, radio signals, and the ports they plug into. Nothing else works until it does.

        1. On the map, drag from [[alice]] to [[sw]] and let go. That plugs in a cable.
        2. Do the same for [[ben]].
        3. Press **Alice pings Ben**.

        A **ping** is a tiny message that asks "Are you there?" If the other device answers, the path between them works in both directions. The result shows under the button. If the ping stops on the way, a red tag on the map shows where.

        A packet that leaves takes a few seconds to cross the map. The speed buttons above the map change how fast.
      `,
      focus: ['alice', 'ben', 'sw'],
      tools: [{ kind: 'cable' }],
      actions: [alicePingsBen],
      goals: [
        { id: 'alice', label: 'Plug [[alice]] into [[sw]]', hint: 'Press on Alice, drag to the switch, and let go.', check: plugged('alice', 'sw') },
        { id: 'ben', label: 'Plug [[ben]] into [[sw]]', check: plugged('ben', 'sw') },
        {
          id: 'ping',
          label: 'Alice tries to ping Ben',
          hint: 'Plug in both cables first, then press Alice pings Ben.',
          check: ({ sim, since }) =>
            !!sim.linkBetween('alice', 'sw') &&
            happened(sim, since, (e) => e.type === 'ping-fail' && e.device === 'alice' && e.reason === 'no-ip'),
        },
      ],
      questions: [
        {
          id: 'why-fail',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The cables work, but the ping still failed. Why were cables alone not enough?',
          options: [
            { id: 'no-ip', text: 'A packet also needs addresses that say who sent it and where it goes', correct: true },
            { id: 'ports', text: 'The cables are plugged into the wrong switch ports', feedback: 'A switch treats all its ports the same. Any free port works.' },
            { id: 'ben', text: "Ben's computer turned the ping away when it arrived", feedback: 'The ping never left Alice. Read the result under the button.' },
            { id: 'switch', text: 'The switch needs its own IP address before it can work', feedback: 'A switch passes data along without one. Read the result under the button: who is missing an address?' },
          ],
          explain: 'Cables carry signals, but a packet also needs a sender address and a destination address. That is the next layer up.',
        },
      ],
    },

    {
      id: 'addresses',
      title: 'Give each computer an address',
      body: md`
        An **IP address** names a device on a network, the way a street address names a house. It has two parts:

        - The **network part** says which network the device is on. Every device on one local network shares it.
        - The **host part** picks out one device on that network.

        Computers store each address as 32 **bits**, binary digits that are each 0 or 1. Each of the four numbers is 8 bits. The **prefix length** after the slash says how many bits are the network part, so \`/24\` means the first three numbers. In \`192.168.10.11/24\`, the network part is \`192.168.10\` and the host part is \`11\`. The whole network is written \`192.168.10.0/24\`.

        1. Click [[alice]]. In the Inspect tab, type \`192.168.10.11/24\` as her IP address and save it.
        2. Give [[ben]] a different address on the same network, like \`192.168.10.12/24\`.
        3. Use the **Ping** tool in the Toolkit tab to ping Ben's address from Alice.

        Watch the map. Another kind of packet, labeled ARP, goes out before the ping. The next step explains it.
      `,
      setup: cabled,
      focus: ['alice', 'ben', 'sw'],
      open: { inspect: 'alice' },
      tools: [{ kind: 'ip-config', fixed: [WEB_PIN] }, { kind: 'ping' }],
      goals: [
        { id: 'alice', label: '[[alice]] has an address on 192.168.10.0/24', check: ({ sim }) => hostOn(sim, 'alice', NET.office) },
        { id: 'ben', label: '[[ben]] has a different address on 192.168.10.0/24', check: ({ sim }) => hostOn(sim, 'ben', NET.office) },
        {
          id: 'ping',
          label: 'Alice gets a reply from Ben',
          hint: "In the Ping tool, choose Alice, then type Ben's IP address.",
          check: ({ sim, since }) => pinged(sim, since, 'alice', sim.dev('ben').ifaces[0].ip),
        },
      ],
      questions: [
        {
          id: 'other-net',
          kind: 'choice',
          prompt: 'Suppose Ben had 192.168.20.12/24 instead. Could Alice reach him directly through the switch?',
          options: [
            { id: 'no', text: 'No. Ben would be on a different network, so Alice would need a router.', correct: true },
            {
              id: 'same-switch',
              text: "Yes. They're plugged into the same switch.",
              feedback: "The cables work, but Alice checks the network part first. 192.168.20 isn't her network, so she won't deliver to Ben directly.",
            },
            { id: 'host-part', text: 'Yes, because the host parts are different.', feedback: 'The host parts are supposed to differ. Which part has to match?' },
          ],
          explain: 'Devices talk directly only when they share a network part. Anything else goes to a router.',
        },
      ],
    },

    {
      id: 'mac',
      title: 'How the switch finds Ben',
      body: md`
        The switch doesn't read IP addresses. Every port has a second address, a **MAC address**, built into the hardware. On one local network, data goes from MAC address to MAC address.

        So before Alice can ping Ben, she needs his MAC address. She sends an **ARP** request as a **broadcast**, a message to every device on the network: "Who has this IP address?" Ben answers with his MAC address.

        Everything sent on a local network carries its sender's MAC address. Watch which switch port each packet comes in on.

        The computers and the switch have forgotten everything they learned in the last step.

        1. Set the speed to 0.5× so you can follow each packet.
        2. Press **Alice pings Ben**. Watch for the ARP packets before the ping.
        3. Click [[sw]] and read its **MAC address table**.
      `,
      setup: (sim) => {
        officeLan(sim);
        sim.clearArp('alice');
        sim.clearArp('ben');
        sim.dev('sw').macTable = {};
      },
      focus: ['alice', 'ben', 'sw'],
      actions: [alicePingsBen],
      goals: [
        {
          id: 'ping',
          label: 'Alice gets a reply from Ben',
          check: ({ sim, since }) => pinged(sim, since, 'alice', sim.dev('ben').ifaces[0].ip),
        },
        {
          id: 'switch',
          label: "Open [[sw]] after the ping and find Alice's and Ben's MAC addresses",
          check: ({ sim, ev }) => {
            if (ev?.type !== 'ui:inspect' || ev.device !== 'sw') return false;
            const table = sim.dev('sw').macTable;
            return ['alice', 'ben'].every((d) => table[sim.dev(d).ifaces[0].mac]);
          },
        },
      ],
      questions: [
        {
          id: 'mac-learn',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Nobody typed in the MAC address table. How did the switch learn which port leads to Alice?',
          options: [
            { id: 'sender', text: "It read the sender's MAC address on data that came in that port", correct: true },
            { id: 'ip', text: 'Alice told it her IP address', feedback: 'A switch works with MAC addresses, not IP addresses. Look at the columns of its table.' },
            { id: 'typed', text: 'It came from the settings you typed', feedback: 'You typed IP addresses into the computers. Nobody set up the switch.' },
            {
              id: 'asked',
              text: 'It sent a broadcast asking where Alice is',
              feedback: "Alice sent the broadcast: an ARP request asking who has Ben's address. The switch learned from it on the way through.",
            },
          ],
          explain: "Everything sent on a local network carries its sender's MAC address. The switch writes down the port each one came in on, so it knows where to send replies.",
        },
      ],
    },

    {
      id: 'router',
      title: 'Connect the office router',
      body: md`
        Alice and Ben can reach each other. They can't reach anything else. For that, the office network needs a router.

        A router has a separate address on each network it connects to. Each port is its own door onto one network.

        1. Plug a port of [[office]] into [[sw]].
        2. Click [[office]]. Give the port you plugged in an address on the office network. Routers often take the first one: \`192.168.10.1/24\`.
        3. Ping the router's address from Alice.
      `,
      setup: officeLan,
      focus: ['office', 'sw'],
      tools: [{ kind: 'cable' }, { kind: 'ip-config', fixed: [WEB_PIN] }, { kind: 'ping' }],
      goals: [
        { id: 'cable', label: 'Plug [[office]] into [[sw]]', check: plugged('office', 'sw') },
        {
          id: 'address',
          label: "Give the office router's switch port an address on 192.168.10.0/24",
          hint: 'In the Addresses table, the "Cable goes to" column shows which port is plugged into the switch.',
          check: ({ sim }) => !!officeLanIp(sim),
        },
        {
          id: 'ping',
          label: 'Alice gets a reply from the office router',
          check: ({ sim, since }) => pinged(sim, since, 'alice', officeLanIp(sim)),
        },
      ],
      questions: [
        {
          id: 'connected',
          kind: 'choice',
          afterGoals: true,
          prompt: "Open the office router's routing table. Why is 192.168.10.0/24 in it, even though you never typed a route?",
          options: [
            { id: 'own', text: 'A router knows every network its own ports are on', correct: true },
            { id: 'switch', text: 'The switch told the router about it', feedback: "Switches don't know about IP networks." },
            { id: 'ping', text: 'Alice told the router when she pinged it', feedback: 'The row appeared the moment you saved the address, before any ping.' },
          ],
          explain: 'These are called connected routes. Give a port an address, and the router knows that whole network is out that port.',
        },
      ],
    },

    {
      id: 'gateway',
      title: 'Set the default gateway',
      body: md`
        Alice knows her own network. Any address that starts with 192.168.10 is local, so she delivers it herself. What about every other address?

        A computer hands everything that isn't on its own network to one router: its **default gateway**. The gateway has to be on the computer's own network, so the computer can reach it directly.

        1. Click [[alice]]. Set her default gateway to the office router's address on her network. A gateway is one address, with no slash.
        2. Do the same for [[ben]].
        3. Set the speed to 0.5×. Press **Alice opens the website**. The page won't load yet, because you'll build the web server's network, \`203.0.113.0/24\`, in the next step. Watch how far the request gets.

        Her browser will say **Not secure**. This site uses plain HTTP, so nothing it sends is encrypted. More on that at the end.
      `,
      setup: officeRouter,
      focus: ['alice', 'ben', 'office'],
      open: { inspect: 'alice' },
      tools: [{ kind: 'gateway' }],
      actions: [aliceOpens],
      goals: [
        { id: 'alice', label: "Set [[alice]]'s default gateway to the office router", check: gatewayIsRouter('alice') },
        { id: 'ben', label: "Set [[ben]]'s default gateway to the office router", check: gatewayIsRouter('ben') },
        {
          id: 'reach',
          label: "Alice's request reaches [[office]]",
          hint: 'Set the gateway first, then press Alice opens the website.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'drop' && e.device === 'office' && e.pkt?.dst === WEB_IP),
        },
      ],
      questions: [
        {
          id: 'why-drop',
          kind: 'choice',
          afterGoals: true,
          prompt: "The office router dropped Alice's request. Why?",
          options: [
            { id: 'no-route', text: "It has no route to the web server's network", correct: true },
            { id: 'gateway', text: "Alice's gateway points to the wrong router", feedback: 'The request reached the router, so the gateway worked.' },
            { id: 'server', text: 'The web server is turned off right now', feedback: 'The request never got near the web server. Where did it stop?' },
            { id: 'blocked', text: 'Routers always block requests for websites', feedback: 'Passing packets between networks is the router\'s whole job. It needs to know where to pass this one.' },
          ],
          explain: "The router knows only the networks its own ports are on. It can't send a packet toward a network it has never heard of. Next, you'll build that network.",
        },
      ],
    },

    {
      id: 'datacenter',
      title: 'Build the server network',
      body: md`
        The web server sits in a data center on its own network, \`203.0.113.0/24\`. Build that side the same way you built the office.

        1. Plug [[web]] into a port of [[dc]].
        2. Give that router port \`203.0.113.1/24\`.
        3. Give [[web]] its address, \`203.0.113.80/24\`. Set its default gateway to the data center router.
        4. Ping the data center router from the web server.

        You typed Alice's address by hand to see how addressing works. Most laptops get one automatically each time they join a network, so Alice's could change tomorrow and nothing would break. A server keeps one **static address** for years, because other computers need to know where to find it.
      `,
      setup: gateways,
      focus: ['dc', 'web'],
      tools: [{ kind: 'cable' }, { kind: 'ip-config', fixed: [WEB_PIN] }, { kind: 'gateway' }, { kind: 'ping' }],
      goals: [
        { id: 'cable', label: 'Plug [[web]] into [[dc]]', check: plugged('web', 'dc') },
        {
          id: 'router',
          label: "Give the data center router's server port an address on 203.0.113.0/24",
          check: ({ sim }) => !!dcServerIp(sim),
        },
        { id: 'web', label: 'Give [[web]] the address 203.0.113.80/24', check: ({ sim }) => sim.dev('web').ifaces[0].ip === WEB_IP },
        {
          id: 'gateway',
          label: "Set the web server's default gateway to the data center router",
          check: ({ sim }) => !!dcServerIp(sim) && sim.dev('web').gateway === dcServerIp(sim),
        },
        {
          id: 'ping',
          label: 'The web server gets a reply from the data center router',
          hint: 'In the Ping tool, choose Web server, then type the router port address you just set.',
          check: ({ sim, since }) => pinged(sim, since, 'web', dcServerIp(sim)),
        },
      ],
      questions: [
        {
          id: 'static',
          kind: 'choice',
          prompt: 'Why does the web server need to keep the address 203.0.113.80?',
          options: [
            { id: 'findable', text: 'Other computers look for the site at that address', correct: true },
            { id: 'factory', text: "A server's address is set at the factory", feedback: 'Every address on this map was typed by you.' },
            {
              id: 'secure',
              text: 'Static addresses are harder to attack',
              feedback: 'A fixed address is easier to find, for attackers too. Static addresses are about being findable.',
            },
          ],
          explain: "If the address changed, visitors would go to the wrong place. It would break every bookmark, link, and setting that points to it.",
        },
      ],
    },

    {
      id: 'link',
      title: 'Connect the two routers',
      body: md`
        The two routers need a cable between them. That cable is a tiny network of its own, with only two devices on it: one port from each router.

        1. Plug the free port of [[office]] into the free port of [[dc]].
        2. Give both ends addresses on one network. Use \`10.0.0.1/24\` for the office router and \`10.0.0.2/24\` for the data center router.
        3. Ping \`10.0.0.2\` from the office router.
      `,
      setup: dataCenter,
      focus: ['office', 'dc'],
      tools: [{ kind: 'cable' }, { kind: 'ip-config', fixed: [WEB_PIN] }, { kind: 'ping' }],
      goals: [
        { id: 'cable', label: 'Plug [[office]] into [[dc]]', check: plugged('office', 'dc') },
        {
          id: 'addresses',
          label: 'Give both ends of that cable addresses on the same network',
          hint: 'Click each router. Find the port whose cable goes to the other router.',
          check: ({ sim }) => linkUp(sim),
        },
        {
          id: 'ping',
          label: 'The office router gets a reply from the data center router',
          check: ({ sim, since }) => pinged(sim, since, 'office', ipToward(sim, 'dc', 'office')),
        },
      ],
      questions: [
        {
          id: 'office-knows',
          kind: 'choice',
          afterGoals: true,
          multi: true,
          prompt: "Open the office router's routing table. Which networks does it know how to reach now?",
          options: [
            { id: 'office', text: 'The office network, 192.168.10.0/24', correct: true },
            { id: 'link', text: 'The network on the cable between the two routers', correct: true },
            {
              id: 'servers',
              text: 'The server network, 203.0.113.0/24',
              feedback: 'The office router has no port on the server network, 203.0.113.0/24, and nobody has told it about that network yet.',
            },
          ],
          explain: 'A router learns only the networks its own ports are plugged into. The server network is one router further away.',
        },
      ],
    },

    {
      id: 'route',
      title: 'Teach the office router the way',
      body: md`
        The office router already has a **connected route** for each network its own ports are on. To reach the server network, it needs a **static route**: a rule you type in that says "send packets for this network to that neighbor." A route has two parts:

        - The **destination**: the network the packets are going to, \`203.0.113.0/24\`.
        - The **next hop**: the address of the neighbor router to hand them to. It has to be on a network the router is plugged into.

        1. Click [[office]]. Below its routing table, add a route to \`203.0.113.0/24\`. For the next hop, use the data center router's address on the network the two routers share.
        2. Press **Alice opens the website** and follow the request, and then the reply.
      `,
      setup: routerLink,
      focus: ['office', 'dc', 'web'],
      open: { inspect: 'office' },
      tools: [{ kind: 'static-route' }],
      actions: [aliceOpens],
      goals: [
        {
          id: 'route',
          label: '[[office]] sends packets for 203.0.113.0/24 to the data center router',
          hint: "The next hop is the data center router's address on the cable between the two routers.",
          check: ({ sim }) => routesVia(sim, 'office', WEB_IP, 'dc'),
        },
        {
          id: 'request',
          label: "Alice's request reaches [[web]]",
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'http-request' && e.device === 'web'),
        },
      ],
      questions: [
        {
          id: 'stuck',
          kind: 'choice',
          afterGoals: true,
          prompt: "The web server got the request, but Alice's page never loaded. Where did the reply stop?",
          options: [
            { id: 'dc', text: 'At the data center router. It has no route back to 192.168.10.0/24.', correct: true },
            { id: 'web', text: "At the web server. It doesn't know where Alice is.", feedback: 'The web server sent the reply to its gateway. Follow it one more hop.' },
            { id: 'office', text: 'At the office router. It drops replies.', feedback: 'The reply never got back to the office router. Where did the marker appear?' },
            { id: 'alice', text: "At Alice's laptop. Her browser rejected it.", feedback: 'The reply never reached Alice.' },
          ],
          explain: 'The data center router knows its own two networks. Alice\'s network isn\'t one of them.',
        },
      ],
    },

    {
      id: 'return',
      title: 'Routes go both ways',
      body: md`
        Every request needs a reply, and the reply makes its own trip back. Routers don't remember where a packet came from. Each router looks up every packet's destination on its own.

        1. Click [[dc]]. Add a route back to the office network, \`192.168.10.0/24\`. For the next hop, use the office router's address on the network the two routers share.
        2. Press **Alice opens the website**.
        3. Press **Ben opens the website**.
      `,
      setup: forwardRoute,
      focus: ['dc', 'office'],
      open: { inspect: 'dc' },
      tools: [{ kind: 'static-route' }],
      actions: [aliceOpens, benOpens],
      goals: [
        {
          id: 'route',
          label: '[[dc]] sends packets for 192.168.10.0/24 to the office router',
          check: ({ sim }) => !!sim.dev('alice').ifaces[0].ip && routesVia(sim, 'dc', sim.dev('alice').ifaces[0].ip!, 'office'),
        },
        { id: 'alice', label: "The page loads in Alice's browser", check: loaded('alice') },
        { id: 'ben', label: "The page loads in Ben's browser", check: loaded('ben') },
      ],
      questions: [
        {
          id: 'both-ways',
          kind: 'text',
          prompt: 'Before you added this route, the office router could already reach the server network. Explain why a ping from Alice to the web server would still have failed.',
          minWords: 20,
        },
      ],
    },

    {
      id: 'fix',
      title: "Troubleshoot Ben's computer",
      body: md`
        Someone moved Ben's desk over the weekend. Now his computer can't reach anything.

        Troubleshoot from the bottom up, one layer at a time:

        1. **Cable**: Is Ben plugged in?
        2. **Address**: Is his IP address on the office network?
        3. **Gateway**: Does his gateway point to the office router?

        Use pings, the buttons, and the inspector to find each fault. Fix them until Ben can load the website.
      `,
      setup: (sim) => {
        returnRoute(sim);
        breakBen(sim);
      },
      focus: ['ben'],
      tools: [{ kind: 'cable' }, { kind: 'ip-config', fixed: [WEB_PIN] }, { kind: 'gateway' }, { kind: 'ping' }],
      actions: [benOpens],
      // The goals count fixes without naming them: finding the faults is the point.
      goals: [
        {
          id: 'one',
          label: "Find and fix one of Ben's problems",
          hint: 'Press **Ben opens the website**. The result under the button says why his computer can\'t send.',
          check: bensFixes(1),
        },
        {
          id: 'two',
          label: 'Find and fix a second problem',
          hint: "Next layer up: is Ben's IP address on the office network? Compare it with Alice's, number by number. After each fix, press **Ben opens the website** again.",
          check: bensFixes(2),
        },
        {
          id: 'three',
          label: 'Find and fix a third problem',
          hint: 'Click [[ben]] and compare his settings with [[alice]]\'s. Which device actually uses his gateway address?',
          check: bensFixes(3),
        },
        { id: 'loaded', label: "The page loads in Ben's browser", check: loaded('ben') },
      ],
      questions: [
        {
          id: 'faults',
          kind: 'choice',
          afterGoals: true,
          multi: true,
          prompt: "Which faults did you find on Ben's computer?",
          options: [
            { id: 'cable', text: 'The cable was unplugged', correct: true },
            { id: 'address', text: 'His IP address was on the wrong network', correct: true },
            { id: 'gateway', text: 'His gateway pointed to an address no router uses', correct: true },
            { id: 'port', text: 'The switch port was broken', feedback: 'Any free switch port works.' },
            { id: 'mac', text: 'His MAC address was wrong', feedback: "A MAC address is built into the hardware. Ben's never changed." },
          ],
          explain: 'Working from the cable up means each fix shows you the next problem, instead of guessing at all of them at once.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'What could go wrong on purpose?',
      body: md`
        Every part you set up can be misused.

        - An unused switch port is an open door. Anyone who plugs into it joins the office network. Many offices turn off ports nobody uses.
        - Routers trust their routes. Someone who can change a router's settings can add a route that sends traffic through a computer they control.
        - This website uses plain HTTP. Every device on the path could read the page, and anything Alice typed into it.
      `,
      questions: [
        {
          id: 'bad-route',
          kind: 'choice',
          prompt:
            'An attacker breaks into the office router. They add a route that sends 203.0.113.0/24 to a laptop they plugged into the office switch. What happens to Alice\'s web traffic?',
          options: [
            { id: 'detour', text: "It goes to the attacker's laptop first. If the laptop passes it on, Alice may never notice.", correct: true },
            {
              id: 'gateway',
              text: "Nothing changes. Alice's gateway still points to the real router.",
              feedback: 'Alice still sends to the office router. The router then follows the attacker\'s route.',
            },
            {
              id: 'reject',
              text: "The router refuses, because the laptop isn't a router",
              feedback: 'A real router sends packets to whatever next hop the route names. It doesn\'t check what kind of device is there.',
            },
          ],
          explain: "A route decides who gets the traffic. That's why router settings sit behind strong passwords, and why HTTPS matters even on your own network.",
        },
        {
          id: 'trace',
          kind: 'text',
          prompt:
            "Trace Alice's request to the web server. List each device it passes through. For each router, say which route it used, and whether that was a connected route or a static route you added.",
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
