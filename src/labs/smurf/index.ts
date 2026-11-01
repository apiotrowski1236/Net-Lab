import { happened, inspected, openedLog, pageSince } from '../helpers';
import type { CheckCtx, LabDef } from '../types';
import {
  buildEchoStorm,
  CAMPUS_BCAST,
  deniesInboundIcmp,
  ensureEdgeFirewall,
  FAN,
  ispFilterUpstream,
  LAN_HOSTS,
  PC1,
  SMURF_RATE,
  smurfZones,
  STORM_COUNT,
  TICKETS,
  uplinkId,
  WEB,
} from './scenario';

/** The uplink carries only so many packets per second; a flood past that drops the fan's purchase. */
const BOTNET_RATE = 300;

/** The fan's purchase was dropped because a flood filled Hilltop's uplink. */
const fanFloodFailed = ({ sim, since }: CheckCtx): boolean =>
  happened(sim, since, (e) => e.type === 'drop' && e.reason === 'congestion' && e.pkt?.app.kind === 'http-req' && e.pkt.src === FAN);

/** Lesson buttons shared across steps (same behavior wherever they appear). */
const buyTicket = { id: 'fan-buy', label: 'Fan buys a ticket', run: (sim: ReturnType<typeof buildEchoStorm>) => sim.browse('fan', `https://${TICKETS}/checkout`) };
const botnetFlood = {
  id: 'botnet',
  label: 'Botnet joins in',
  run: (sim: ReturnType<typeof buildEchoStorm>) => {
    sim.setLinkFlood(uplinkId(sim), 'botnet', BOTNET_RATE);
    // One aggregated burst from made-up sources stands for hundreds of bots pinging the server straight on.
    sim.echo('mallory', WEB, { burst: { count: BOTNET_RATE, vary: 'src-ip' } });
  },
};

export const smurfLab: LabDef = {
  id: 'smurf',
  version: 1,
  title: 'Echo Storm',
  tagline: "Turn a network's own echoes into a flood that knocks a ticket site offline, then shut the amplifier down.",
  unit: 3,
  codehs: ['3.3 Misdirected and Overwhelmed'],
  ced: ['3.1.A', '3.1.B', '3.1.C', '3.5.E'],
  minutes: 45,
  objectives: [
    'Explain what ICMP echo (ping) does and what a broadcast address is.',
    'Describe how a smurf attack forges a source address and amplifies pings into a flood.',
    'Tell a denial-of-service attack from a distributed one, and relate both to availability.',
    'Choose defenses: stop forwarding directed broadcasts, filter at the edge, and filter upstream.',
  ],
  build: buildEchoStorm,
  captureDevice: 'mallory',
  clock: '19:00',
  map: { zones: smurfZones },
  steps: [
    {
      id: 'echo',
      title: 'An echo and a reply',
      body: `[[fan]] wants a seat for Friday's game. Her browser will open [[web]], the Hilltop ticket server, out past
[[isp]] and Hilltop's [[edge]] router. First, a simpler message.

A **ping** is a tiny "Are you there?" message. It uses **ICMP**, the protocol computers use to check each
other and report problems. A ping is two packets: an **echo request** goes out, and an **echo reply** comes
back. If the reply arrives, the two devices can reach each other.

Press **Fan pings the ticket server**. Watch the request cross to [[web]] and the reply come back. Set the
speed to 0.5x if it goes too fast.

Then click [[web]] and [[campus]] on the map to look inside them.

> Everything in this lab happens inside a simulation. Sending forged floods at a real network without
> permission is illegal.`,
      focus: ['fan', 'web', 'isp', 'edge'],
      actions: [{ id: 'fan-ping', label: 'Fan pings the ticket server', run: (sim) => sim.ping('fan', WEB) }],
      goals: [
        {
          id: 'ping',
          label: 'Fan gets a reply from the ticket server',
          hint: 'Press **Fan pings the ticket server** and watch the reply come back.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'fan' && e.from === WEB),
        },
        { id: 'web', label: 'Open [[web]]', check: inspected('web') },
        { id: 'campus', label: 'Open [[campus]]', check: inspected('campus') },
      ],
      questions: [
        {
          id: 'what-icmp',
          kind: 'choice',
          prompt: 'What does a ping (an ICMP echo) do?',
          options: [
            { id: 'reach', text: 'Checks whether another device is online.', correct: true },
            { id: 'page', text: 'Carries a web page from a server to a browser.', feedback: "That's HTTP. A ping carries no page, only a tiny 'Are you there?'." },
            { id: 'name', text: 'Turns a name like tickets.hilltop.example into an IP address.', feedback: "That's DNS. A ping already needs the address." },
            { id: 'encrypt', text: 'Scrambles traffic so no one in the middle can read it.', feedback: 'A ping does nothing with encryption. It only checks reachability.' },
          ],
          explain:
            'A ping is an ICMP echo request and the echo reply that answers it. It tells you one thing: can these two devices reach each other right now.',
        },
      ],
    },
    {
      id: 'everyone',
      title: 'Everyone answers',
      body: `Every network has one **broadcast address**: the last address in its range. For the campus network
\`198.51.100.0/24\`, that is **\`198.51.100.255\`**. A packet sent to the broadcast address is meant for every
device on that network at once.

Westfield's router still does something many networks did for years: when a ping arrives for its broadcast
address, it hands that ping to every computer on the campus. This is a **directed broadcast**.

You are Mallory now, out on the internet. Open the **Echo tool** in the Toolkit. Leave the source blank for
now. Ping the campus broadcast address \`198.51.100.255\` and count the replies.`,
      focus: ['mallory', 'isp', 'campus', 'pc1', 'pc2', 'pc3'],
      open: 'tools',
      tools: [{ kind: 'echo-tool', device: 'mallory' }],
      goals: [
        {
          id: 'send',
          label: 'Ping the campus broadcast address from [[mallory]]',
          hint: 'In the Echo tool, type `198.51.100.255` as the target. Leave the source blank.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-sent' && e.device === 'mallory' && e.to === CAMPUS_BCAST),
        },
        {
          id: 'replies',
          label: 'Watch every campus computer reply',
          hint: 'One request to the broadcast address reaches all thirty computers.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'mallory' && (e.count ?? 1) >= 2),
        },
      ],
      questions: [
        {
          id: 'how-many',
          kind: 'choice',
          afterGoals: true,
          prompt: 'You sent one echo request to the broadcast address. How many replies came back?',
          options: [
            { id: 'each', text: 'One from each computer on the network, thirty in all.', correct: true },
            { id: 'router', text: 'Just one, from the campus router.', feedback: "The router didn't answer. It passed your ping to every computer, and each one replied." },
            { id: 'none', text: "None. A broadcast can't be answered.", feedback: 'Check the tool. Thirty replies came back.' },
            { id: 'two', text: 'Two: the router and the ticket server.', feedback: "The ticket server isn't on this network. Every campus computer answered." },
          ],
          explain:
            'One request to the broadcast address became thirty replies. Sending one packet and getting many back is called **amplification**, and it is the engine of a smurf attack.',
        },
      ],
    },
    {
      id: 'return-to-sender',
      title: 'Return to sender',
      body: `A ping carries the sender's address in its **source** field, so the reply knows where to go. Nothing checks
that the source is true. Mallory can write any address there. This is a **forged source address**.

Watch what that does. In the Echo tool, set the source to the ticket server's address, \`192.0.2.10\`, and ping
one campus computer, [[pc1]] at \`198.51.100.11\`. The computer answers, but the reply does not come back to
Mallory. It goes to whatever address the ping claimed to be from.

Forged packets are drawn in red so you can follow them. Real networks don't color them.`,
      focus: ['mallory', 'pc1', 'web'],
      open: 'tools',
      goals: [
        {
          id: 'forge',
          label: "Ping [[pc1]] with the ticket server's address as the source",
          hint: 'Target `198.51.100.11`. Source `192.0.2.10`, the ticket server.',
          check: ({ sim, since }) =>
            happened(sim, since, (e) => e.type === 'ping-sent' && e.device === 'mallory' && e.to === PC1 && e.from === WEB && !!e.forged),
        },
        {
          id: 'landed',
          label: 'The ticket server gets a reply to a ping it never sent',
          hint: "Watch where [[pc1]]'s reply goes. It follows the forged source, not Mallory.",
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'web' && e.from === PC1),
        },
      ],
      questions: [
        {
          id: 'why-there',
          kind: 'choice',
          prompt: 'The reply landed on the ticket server, which never pinged anyone. Why did the campus computer send it there?',
          options: [
            { id: 'source', text: "The request carried the ticket server's address as its source, so the reply went to that address.", correct: true },
            { id: 'lookup', text: 'The computer looked the ticket server up by name.', feedback: 'It did no lookup. It copied the source address straight off the request.' },
            { id: 'router', text: "The campus router rewrote the reply's destination.", feedback: 'The router only forwarded it. The destination came from the forged source.' },
            { id: 'asked', text: 'The ticket server had asked the campus computer for a reply earlier.', feedback: 'It never sent a thing. That is the whole trick.' },
          ],
          explain: "A reply always goes to the request's source address. Forge the source, and you choose who gets flooded with replies.",
        },
      ],
    },
    {
      id: 'the-storm',
      title: 'The storm',
      body: `Now put the two tricks together. That is a **smurf attack**: forge the victim's address as the source, send
to a network's broadcast address, and do it over and over. One forged request becomes thirty replies, all
aimed at the victim. Enough of them, and the victim's link fills up.

Watch Hilltop's uplink. The link from [[isp]] to [[edge]] carries only 60 packets each second. When more than
that arrive, the extra packets are **dropped**: the link is full, so there is no room for them. This is
**congestion**.

1. Press **Launch the storm**. Mallory sends a wave of forged requests to the campus broadcast address.
   Open [[edge]] and watch its uplink meter climb.
2. Press **Fan buys a ticket** while the storm runs. Her purchase has to cross the same full uplink.`,
      focus: ['mallory', 'campus', 'isp', 'edge', 'web', 'fan'],
      open: { inspect: 'edge' },
      setup: (sim) => {
        sim.clearFloods();
        sim.setDirectedBroadcast('campus', true);
      },
      actions: [
        {
          id: 'storm',
          label: 'Launch the storm',
          run: (sim) => {
            sim.setLinkFlood(uplinkId(sim), 'smurf', SMURF_RATE);
            // A wave of forged echo requests (the victim as source) to the campus broadcast, each amplified ×30.
            sim.echo('mallory', CAMPUS_BCAST, { source: WEB, burst: { count: STORM_COUNT } });
          },
        },
        buyTicket,
      ],
      goals: [
        {
          id: 'launch',
          label: 'Launch the storm',
          check: ({ sim, since }) =>
            happened(sim, since, (e) => e.type === 'ping-sent' && e.device === 'mallory' && e.to === CAMPUS_BCAST && e.from === WEB && !!e.forged),
        },
        {
          id: 'congested',
          label: "Fill Hilltop's uplink",
          hint: 'Press **Launch the storm** and watch the [[edge]] uplink meter pass 60.',
          check: ({ sim }) => sim.linkPps(uplinkId(sim)) > 60,
        },
        {
          id: 'fan-fails',
          label: "A fan's purchase fails during the flood",
          hint: 'Press **Fan buys a ticket** while the storm is running.',
          check: fanFloodFailed,
        },
      ],
      questions: [
        {
          id: 'which-cia',
          kind: 'choice',
          afterGoals: true,
          prompt: "The ticket site is still up and its pages are unchanged, but fans can't reach it. Which part of the CIA triad is under attack?",
          options: [
            { id: 'avail', text: 'Availability.', correct: true },
            { id: 'conf', text: 'Confidentiality.', feedback: 'Nothing was read or leaked. The data stayed private.' },
            { id: 'integ', text: 'Integrity.', feedback: 'No data changed. The pages are still correct.' },
            { id: 'all', text: 'All three, equally.', feedback: "Only one is hit: fans can't reach a site that is otherwise fine. That's availability.", last: true },
          ],
          explain:
            'Making a system unreachable to its real users is a **denial-of-service (DoS)** attack. It strikes availability, the A in CIA, without touching confidentiality or integrity.',
        },
      ],
    },
    {
      id: 'many-attackers',
      title: 'Many attackers',
      body: `The smurf used a trick to turn one attacker into many. There is a blunter way: use many attackers to start
with. A **botnet** is a crowd of computers an attacker controls, often without their owners knowing.

Press **Botnet joins in**. Hundreds of bots ping the ticket server straight on, no amplifier needed. The
uplink fills the same way.

A flood from one source is a **denial-of-service (DoS)** attack. A flood from many sources at once is a
**distributed denial-of-service (DDoS)**.`,
      focus: ['isp', 'edge', 'web', 'fan'],
      open: { inspect: 'edge' },
      setup: (sim) => sim.clearFloods(),
      actions: [botnetFlood, buyTicket],
      goals: [
        {
          id: 'ddos',
          label: 'Start the botnet flood',
          hint: 'Press **Botnet joins in**.',
          check: ({ sim }) => sim.linkPps(uplinkId(sim)) > 60,
        },
        { id: 'fan-fails', label: "The fan's purchase fails again", hint: 'Press **Botnet joins in**, then **Fan buys a ticket**.', check: fanFloodFailed },
      ],
      questions: [
        {
          id: 'dos-vs-ddos',
          kind: 'choice',
          prompt: 'The botnet flood comes straight from hundreds of computers, with no amplifier. Why is that harder to stop than one attacker?',
          options: [
            { id: 'many', text: 'It comes from many addresses at once, so blocking one does almost nothing.', correct: true },
            { id: 'fast', text: 'Each bot sends faster than a single attacker could.', feedback: "Speed isn't the point. It's the number of sources, all at once." },
            { id: 'crypt', text: "The botnet encrypts its traffic so the firewall can't read it.", feedback: 'These are plain pings. The problem is how many senders there are.' },
            { id: 'move', text: "The botnet changes the ticket server's address.", feedback: "The server's address stays put. The traffic just arrives from everywhere." },
          ],
          explain:
            'A DoS from one source can be blocked by blocking that source. A **DDoS** spreads across thousands of sources, so there is no single address to block. The smurf faked that spread with one amplifier.',
        },
      ],
    },
    {
      id: 'read-the-spike',
      title: 'Read the spike',
      body: `Switch sides. You are now defending. An attack like this leaves tracks in two places.

1. **The symptom**, at Hilltop. Open [[edge]]. Its uplink meter, near zero before the game, is pegged at its
   limit. A sudden spike in traffic is an **indicator of compromise**: a sign something is wrong.
2. **The cause**, at Westfield. Open [[campus]] and read its log. During the attack it recorded echo requests
   sent to its **broadcast address** from an outside address. Normal traffic almost never does that.

Open the campus router's log line that shows the broadcast-address pings.`,
      focus: ['edge', 'campus'],
      open: 'logs',
      tools: [{ kind: 'logs', devices: ['edge', 'campus'] }],
      setup: (sim) => {
        // Leave the uplink pegged so the edge meter reads a spike, and make sure the campus line exists to open.
        sim.setDirectedBroadcast('campus', true);
        sim.setLinkFlood(uplinkId(sim), 'smurf', SMURF_RATE);
        const campus = sim.dev('campus');
        if (!campus.logs.some((e) => e.fields?.dst === CAMPUS_BCAST && e.fields?.proto === 'icmp')) {
          sim.log('campus', {
            source: 'router',
            level: 'warn',
            msg: `ICMP echo request to ${CAMPUS_BCAST} (directed broadcast) relayed to ${LAN_HOSTS} hosts`,
            fields: { src: WEB, dst: CAMPUS_BCAST, proto: 'icmp', count: LAN_HOSTS },
          });
        }
      },
      goals: [
        { id: 'meter', label: 'Open [[edge]] and read its uplink traffic meter', check: inspected('edge') },
        {
          id: 'logline',
          label: 'Open the campus log line for the broadcast-address pings',
          hint: 'In the Logs tab, pick the campus line whose destination is `198.51.100.255`.',
          check: openedLog((e) => e.fields?.dst === CAMPUS_BCAST && e.fields?.proto === 'icmp'),
        },
      ],
      questions: [
        {
          id: 'names-it',
          kind: 'choice',
          prompt: 'Several signs show up during the attack. Which one points to a smurf attack in particular, not just to some flood?',
          options: [
            { id: 'broadcast', text: 'Echo requests sent to a broadcast address from outside the network.', correct: true },
            { id: 'meter', text: 'The uplink meter pegged at its limit.', feedback: 'That shows a flood, but not which kind. Many attacks fill a link.' },
            { id: 'slow', text: 'The ticket site loads slowly for fans.', feedback: "That's the symptom of any denial of service. It doesn't single out smurf." },
            { id: 'cpu', text: 'The web server is working hard.', feedback: 'A busy server fits many problems. Look for the broadcast pings.' },
          ],
          explain:
            "A traffic spike tells you there's a flood. Echo requests aimed at a broadcast address, from outside, are the fingerprint of a smurf attack. That's the ICMP-to-broadcast indicator defenders watch for.",
        },
      ],
    },
    {
      id: 'silence-the-amplifier',
      title: 'Silence the amplifier',
      body: `The real fix is at the amplifier. A router has no good reason to forward pings from the internet to a whole
network at once. Modern routers don't, by default.

Open [[campus]]. In its settings, turn **off** forwarding of directed broadcasts. Then press **Mallory tries
again**. One forged request goes in, and the campus router drops it at the door. No replies, no flood.`,
      focus: ['campus', 'mallory', 'web'],
      open: { inspect: 'campus' },
      tools: [{ kind: 'directed-broadcast', device: 'campus' }],
      setup: (sim) => {
        // Enter with the amplifier on and a flood running, so turning the setting off is what stops it.
        sim.clearLinkFlood('botnet');
        sim.setDirectedBroadcast('campus', true);
        sim.setLinkFlood(uplinkId(sim), 'smurf', SMURF_RATE);
      },
      actions: [
        { id: 'retry', label: 'Mallory tries again', run: (sim) => sim.echo('mallory', CAMPUS_BCAST, { source: WEB }) },
      ],
      goals: [
        {
          id: 'off',
          label: 'Turn off directed-broadcast forwarding on [[campus]]',
          hint: 'Open [[campus]] and switch directed broadcasts off.',
          check: ({ sim }) => sim.dev('campus').directedBroadcast === false,
        },
        {
          id: 'fizzle',
          label: "Mallory's ping gets no replies",
          hint: 'Turn the setting off first, then press **Mallory tries again**.',
          check: ({ sim, since }) =>
            happened(sim, since, (e) => e.type === 'drop' && e.device === 'campus' && e.reason === 'no-broadcast') &&
            !happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'web'),
        },
      ],
      questions: [
        {
          id: 'whose-network',
          kind: 'choice',
          prompt: 'Turning that setting off stopped the attack. But the campus network belongs to Westfield, not Hilltop. What does that mean for Hilltop?',
          options: [
            { id: 'depends', text: "Hilltop depends on other networks to fix this, and can't force them.", correct: true },
            { id: 'own', text: 'Hilltop can just turn the setting off on its own router instead.', feedback: "That keeps Hilltop from being an amplifier, but it doesn't stop a flood that uses some other network." },
            { id: 'over', text: 'Nothing. Once one amplifier is fixed, smurf attacks are over.', feedback: 'There are many open networks. An attacker can pick a different amplifier.' },
            { id: 'back', text: 'Hilltop should flood the campus network back.', feedback: 'Flooding back is illegal and pointless.' },
          ],
          explain:
            "The best fix sits on a network you may not control. That's why defenders also guard their own edge and lean on their provider. No single fix covers every case.",
        },
      ],
    },
    {
      id: 'guard-your-edge',
      title: 'Guard your own edge',
      body: `Westfield fixed its router. But the next attacker will find another amplifier, or just use a botnet like you
saw in step 5. Hilltop has to defend its own edge too.

[[edge]] runs a **firewall**. Add a rule that drops inbound ICMP echo traffic from the internet, so pings from
outside never reach the ticket server. Then test it against the botnet flood.

1. In [[edge]]'s firewall, add a rule: **deny inbound ICMP from ALL**. Put it above the rule that lets ping in.
2. Press **Botnet joins in**, then **Fan buys a ticket**. Read the result. The pings no longer reach the
   server, but fans still can't get through.
3. The flood fills the uplink before it ever reaches your firewall. Press **The ISP filters upstream**: now
   the provider drops the flood one hop earlier, before Hilltop's uplink. Press **Fan buys a ticket** again.`,
      focus: ['isp', 'edge', 'web', 'fan'],
      open: { inspect: 'edge' },
      tools: [{ kind: 'firewall-rules', devices: ['edge'] }],
      setup: (sim) => {
        sim.clearFloods();
        // The edge firewall ships open to ping (the weakness); the student adds the deny above it.
        ensureEdgeFirewall(sim);
        sim.setDirectedBroadcast('campus', false);
      },
      actions: [
        botnetFlood,
        buyTicket,
        { id: 'isp-filter', label: 'The ISP filters upstream', run: (sim) => ispFilterUpstream(sim) },
      ],
      goals: [
        {
          id: 'rule',
          label: 'Add a rule to [[edge]] that drops inbound ICMP',
          hint: 'Direction inbound, protocol ICMP, source ALL, action deny. Place it above the rule that allows ping.',
          check: ({ sim }) => deniesInboundIcmp(sim, 'edge'),
        },
        {
          id: 'still-fails',
          label: "See that fans still can't buy, even with the rule",
          hint: 'Press **Botnet joins in**, then **Fan buys a ticket**. The uplink is already full.',
          check: (c) => deniesInboundIcmp(c.sim, 'edge') && fanFloodFailed(c),
        },
        {
          id: 'upstream-fixes',
          label: "After the ISP filters upstream, a fan's purchase goes through",
          hint: 'Press **The ISP filters upstream**, then **Fan buys a ticket**.',
          check: ({ sim, since }) => !!sim.dev('isp').firewall && pageSince(sim, 'fan', since, (b) => b.status === 'loaded' && b.host === TICKETS),
        },
      ],
      questions: [
        {
          id: 'why-upstream',
          kind: 'choice',
          prompt: "Your edge firewall drops the flood, but fans can't buy tickets until the ISP filters it upstream. Why?",
          options: [
            { id: 'fills', text: 'The flood fills the uplink before it reaches your firewall.', correct: true },
            { id: 'match', text: "Edge firewalls can't match on ICMP.", feedback: 'They can. Your rule worked: the pings were dropped at your edge.' },
            { id: 'faster', text: "The ISP's firewall is faster than yours.", feedback: "Speed isn't it. The ISP sits upstream of the full link, so it drops the flood before the bottleneck." },
            { id: 'order', text: 'Your rule was in the wrong order.', feedback: "Order didn't matter here. The uplink was already saturated upstream of your firewall." },
          ],
          explain:
            'A firewall can only act on traffic that reaches it. In a volumetric flood, the harm is the full uplink, which is upstream of your edge. Providers and DDoS-scrubbing services filter there, before the bottleneck.',
        },
      ],
    },
    {
      id: 'how-risky',
      title: 'How risky?',
      body: `A security review grades each weakness by how much harm it could cause. Many use three levels: **high**,
**moderate**, and **low** risk. Grade three findings.`,
      focus: ['edge', 'campus'],
      questions: [
        {
          id: 'open-icmp',
          kind: 'choice',
          prompt: "Before you added the rule, Hilltop's edge firewall allowed inbound ICMP from anywhere. What risk is that?",
          options: [
            { id: 'mod', text: 'Moderate risk.', correct: true },
            { id: 'high', text: 'High risk.', feedback: 'It helps an attacker probe and adds to a flood, but on its own it hands over no data or control. Open external ICMP is a moderate risk.' },
            { id: 'low', text: 'Low risk.', feedback: "It's more than cosmetic: it enables ping sweeps and feeds floods. It's a moderate risk." },
            { id: 'none', text: 'No risk at all.', feedback: "Leaving ICMP open has real downsides. It's a moderate risk." },
          ],
          explain:
            'Open inbound ICMP at an external firewall is a moderate risk: useful to an attacker, but not a direct path to the data. Blocking it is cheap, so most networks do.',
        },
        {
          id: 'wifi-flat',
          kind: 'choice',
          prompt: 'Another finding: the campus has one flat network with its grade server on it, and anyone in range can join over weak Wi-Fi. What risk is that?',
          options: [
            { id: 'high', text: 'High risk.', correct: true },
            { id: 'mod', text: 'Moderate risk.', feedback: "Worse than open ICMP. An outsider can join and reach the grade server directly. That's a high risk." },
            { id: 'low', text: 'Low risk.', feedback: "Low is for things like access points sending beacon frames. Here an outsider can reach a key server. That's a high risk." },
          ],
          explain: 'Weak Wi-Fi lets an outsider in, and a flat network puts the key server within reach. Together that is a high risk.',
        },
        {
          id: 'beacons',
          kind: 'choice',
          prompt: "Last one: the campus Wi-Fi access points broadcast beacon frames that announce the network's name. What risk is that?",
          options: [
            { id: 'low', text: 'Low risk.', correct: true },
            { id: 'mod', text: 'Moderate risk.', feedback: "Beacons only announce that a network exists. Anyone nearby could find it anyway. That's a low risk." },
            { id: 'high', text: 'High risk.', feedback: "A beacon gives no way in and no data. That's a low risk." },
          ],
          explain:
            "Beacon frames tell nearby devices a network exists. That helps an attacker a little, but it opens nothing. It's a low risk.",
        },
      ],
    },
    {
      id: 'reflect',
      title: 'Reflect',
      body: 'Pull it together in your own words.',
      questions: [
        {
          id: 'explain-smurf',
          kind: 'text',
          minWords: 40,
          lines: 6,
          prompt:
            "Explain how a smurf attack turns one attacker's pings into a flood big enough to knock a site offline. Then name the one setting, and on which device, that stops this smurf attack at its source.",
        },
      ],
    },
    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: `Look over your summary on the right. You can go back to any step and change an answer, then hand in your work
again.`,
    },
  ],
};
