import type { Sim } from '../../sim/sim';
import type { SimEvent } from '../../sim/types';
import { happened, inspected, openedLog, pageSince } from '../helpers';
import type { ActionLine, CheckCtx, LabDef } from '../types';
import {
  buildEchoStorm,
  CAMPUS_BCAST,
  deniesInboundIcmp,
  ensureEdgeFirewall,
  FAN,
  ispFilterUpstream,
  LAN_HOSTS,
  PC1,
  smurfZones,
  startSmurfFlood,
  STORM_COUNT,
  TICKETS,
  UPLINK_CAP,
  uplinkId,
  WEB,
} from './scenario';

/** The uplink carries only so many packets per second; a flood past that drops the fan's purchase. */
const BOTNET_RATE = 300;

/** The fan's purchase was dropped because a flood filled Hilltop's uplink. */
const fanFloodFailed = ({ sim, since }: CheckCtx): boolean =>
  happened(sim, since, (e) => e.type === 'drop' && e.reason === 'congestion' && e.pkt?.app.kind === 'http-req' && e.pkt.src === FAN);

type Reply = Extract<SimEvent, { type: 'ping-reply' }>;

/** Replies to Mallory's broadcast pings since `t` that landed on the ticket server, counting each burst at its full size. */
function repliesAtWeb(sim: Sim, t: number): number {
  const seqs = new Set<number>();
  let n = 0;
  for (const e of sim.events) {
    if (e.t < t) continue;
    if (e.type === 'ping-sent' && e.device === 'mallory' && e.to === CAMPUS_BCAST) seqs.add(e.seq);
    else if (e.type === 'ping-reply' && e.device === 'web' && e.seq !== undefined && seqs.has(e.seq)) n += (e as Reply).count ?? 1;
  }
  return n;
}

/** One line about Hilltop's uplink: its load against what it carries. */
function uplinkLine(sim: Sim): ActionLine {
  const pps = sim.linkPps(uplinkId(sim));
  return pps > UPLINK_CAP
    ? { tone: 'bad', text: `Hilltop's uplink: ${pps} packets a second, but it carries only ${UPLINK_CAP}. The rest are dropped.` }
    : { tone: 'good', text: `Hilltop's uplink: ${pps} packets a second, under its limit of ${UPLINK_CAP}.` };
}

/** Lesson buttons shared across steps (same behavior wherever they appear). */
const buyTicket = {
  id: 'fan-buy',
  label: 'Fan buys a ticket',
  run: (sim: Sim) => sim.browse('fan', `https://${TICKETS}/checkout`),
  outcome: (sim: Sim, t: number): ActionLine[] => {
    const b = sim.dev('fan').browser;
    if (!b || b.startedAt < t) return [];
    const jammed = happened(sim, t, (e) => e.type === 'drop' && e.reason === 'congestion' && e.pkt?.app.kind === 'http-req' && e.pkt.src === FAN);
    if (b.status === 'loaded') return [{ tone: 'good', text: 'The ticket page loaded. The fan bought her seat.' }];
    if (jammed) return [{ tone: 'bad', text: "The purchase failed. Hilltop's uplink is full of flood traffic, so her request was dropped before it reached Hilltop." }];
    if (b.status === 'failed') return [{ tone: 'bad', text: `The purchase failed. ${b.error ?? ''}`.trim() }];
    return [{ tone: 'wait', text: 'The ticket page is loading…' }];
  },
};
const botnetFlood = {
  id: 'botnet',
  label: 'Botnet joins in',
  run: (sim: Sim) => {
    sim.setLinkFlood(uplinkId(sim), 'botnet', BOTNET_RATE);
    // One aggregated burst stands for hundreds of bots, each pinging the server from its own real address.
    sim.echo('botnet', WEB, { burst: { count: BOTNET_RATE } });
  },
  outcome: (sim: Sim): ActionLine[] => [{ tone: 'bad', text: `Hundreds of bots are pinging the ticket server straight from their own addresses.` }, uplinkLine(sim)],
};

export const smurfLab: LabDef = {
  id: 'smurf',
  version: 2,
  title: 'Smurf Attacks and Amplification',
  tagline: "Use a network's ping replies to knock a ticket site offline, then turn off the amplifier and filter at your own edge.",
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
      body: `[[fan]] wants a seat for Friday's game. She will buy it from [[web]], the Hilltop ticket server. First, a
simpler message.

A **ping** is a tiny "Are you there?" message. It uses **ICMP**, the protocol computers use to check on each
other and report problems. A ping is two packets: an **echo request** goes out, and an **echo reply** comes
back. If the reply arrives, the two devices can reach each other.

Press **Fan pings the ticket server**. Watch the request cross to [[web]] and the reply come back.

Then click [[campus]], the router for a college network. Find its **Directed broadcasts** setting. It is on.
You will see why that matters in the next two steps.

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
        { id: 'campus', label: 'Open [[campus]] and find **Directed broadcasts**', check: inspected('campus') },
      ],
      questions: [
        {
          id: 'what-icmp',
          kind: 'choice',
          prompt: 'What does a ping (an ICMP echo) do?',
          options: [
            { id: 'reach', text: 'Checks whether you can reach another device.', correct: true },
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
      body: `The campus network is \`198.51.100.0/24\`. The **/24** means the first three numbers name the network, so
its addresses run from \`198.51.100.0\` to \`198.51.100.255\`.

The last address, **\`198.51.100.255\`**, is the network's **broadcast address**. A packet sent there is meant
for every device on the network at once. When a ping for that address arrives from outside, Westfield's router
hands it to every campus computer. This is a **directed broadcast**.

You are Mallory now, out on the internet. In the **Echo tool**, ping \`198.51.100.255\`. Leave the source box
blank. Count the replies.`,
      focus: ['mallory', 'isp', 'campus', 'pc1', 'pc2', 'pc3'],
      open: 'tools',
      tools: [{ kind: 'echo-tool', device: 'mallory' }],
      goals: [
        {
          id: 'send',
          label: 'Ping the campus broadcast address from [[mallory]]',
          hint: 'In the Echo tool, type `198.51.100.255` in the **ping** box. Leave the source blank.',
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
      body: `A ping carries the sender's address in its **source** field, so the reply knows where to go. Most networks
never check that the source is true, so Mallory can write any address there. This is a **forged** (fake)
source address. The map labels forged packets FAKE and draws them in red. Real networks don't.

1. In the Echo tool, type [[pc1]]'s address, \`198.51.100.11\`, in the **ping** box.
2. Type the ticket server's address, \`192.0.2.10\`, in the **source** box. Press **Send**.

Watch where [[pc1]]'s reply goes. (The campus switch copies this first ping to all three computers until it
learns where [[pc1]] is. The other two see it isn't for them and ignore it.)`,
      focus: ['mallory', 'pc1', 'web'],
      open: 'tools',
      tools: [{ kind: 'echo-tool', device: 'mallory' }],
      goals: [
        {
          id: 'forge',
          label: "Ping [[pc1]] with the ticket server's address as the source",
          hint: 'Ping box `198.51.100.11`. Source box `192.0.2.10`, the ticket server.',
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
          afterGoals: true,
          prompt: 'The reply landed on the ticket server, which never pinged anyone. Why did the campus computer send it there?',
          options: [
            { id: 'source', text: "The request carried the ticket server's address as its source.", correct: true },
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
      body: `Now put the two tricks together. That is a **smurf attack**. Mallory puts the victim's address in the source
field. She sends the ping to a network's broadcast address. She does it over and over. Each forged request
becomes thirty replies, all aimed at the victim.

Hilltop's **uplink** is the link from [[isp]] to [[edge]]. It carries only 60 packets per second (**pps**).
When more arrive, the extra packets are **dropped**: there is no room for them. This is **congestion**.

1. Press **Launch the storm**. Watch the **Traffic meter** card in the Toolkit.
2. Press **Fan buys a ticket** while the storm runs.

Security teams sort harm into three goals, the **CIA triad**: **confidentiality** (secrets stay secret),
**integrity** (data stays correct), and **availability** (people can use the system when they need it).`,
      focus: ['mallory', 'campus', 'isp', 'edge', 'web', 'fan'],
      open: 'tools',
      tools: [{ kind: 'traffic-meter', device: 'edge' }],
      setup: (sim) => {
        sim.clearFloods();
        sim.setDirectedBroadcast('campus', true);
      },
      actions: [
        {
          id: 'storm',
          label: 'Launch the storm',
          run: (sim) => {
            startSmurfFlood(sim);
            // A wave of forged echo requests (the victim as source) to the campus broadcast, each amplified ×30.
            sim.echo('mallory', CAMPUS_BCAST, { source: WEB, burst: { count: STORM_COUNT } });
          },
          outcome: (sim, t) => {
            const n = repliesAtWeb(sim, t);
            if (!n) return [{ tone: 'wait', text: `Mallory sent ${STORM_COUNT} forged pings to the campus broadcast address…` }];
            return [{ tone: 'bad', text: `${STORM_COUNT} forged pings became ${n} replies, all sent to the ticket server. Mallory got none.` }, uplinkLine(sim)];
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
          hint: 'Press **Launch the storm** and watch the Traffic meter pass 60.',
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
          prompt: "The ticket site is still online and its pages are unchanged, but fans can't reach it. Which part of the CIA triad is under attack?",
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
      body: `The smurf used a trick to turn one attacker into many. Another way is to start with many attackers. A
**botnet** is a crowd of computers an attacker controls, often without their owners knowing. The map draws
the [[botnet]] as one box.

1. Press **Botnet joins in**. Hundreds of bots ping the ticket server from their own addresses. They forge
   nothing and use no amplifier.
2. Press **Fan buys a ticket**.

A flood from one attacker is a **denial-of-service (DoS)** attack. A flood from many attacking computers at
once is a **distributed denial-of-service (DDoS)**. A smurf sits in between: one attacker, with thirty campus
computers tricked into sending the flood for her.`,
      focus: ['botnet', 'isp', 'edge', 'web', 'fan'],
      open: 'tools',
      tools: [{ kind: 'traffic-meter', device: 'edge' }],
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
          prompt: 'The botnet flood comes straight from hundreds of computers. Why is that harder to stop than one attacker?',
          options: [
            { id: 'many', text: 'It comes from many addresses at once, so blocking one does almost nothing.', correct: true },
            { id: 'fast', text: 'Each bot sends faster than a single attacker could.', feedback: "Speed isn't the point. It's the number of sources, all at once." },
            { id: 'crypt', text: "The botnet encrypts its traffic so the firewall can't read it.", feedback: 'These are plain pings. The problem is how many senders there are.' },
            { id: 'move', text: "The botnet changes the ticket server's address.", feedback: "The server's address stays put. The traffic arrives from everywhere." },
          ],
          explain:
            'A DoS from one source can be stopped by blocking that source. A **DDoS** comes from hundreds or thousands of sources, so there is no single address to block.',
        },
      ],
    },
    {
      id: 'read-the-spike',
      title: 'Read the spike',
      body: `Switch sides. You are now defending. An attack like this leaves signs in two places.

1. **The symptom**, at Hilltop. Click [[edge]] and read its **Traffic meter**. The uplink was near zero before
   the attack. Now it is stuck at its limit.
2. **The cause**, at Westfield. Hilltop's admin calls Westfield, and Westfield's admin shares the campus
   router's log. Open the **Logs** tab and click the [[campus]] line for pings sent to \`198.51.100.255\`.
   Its source (src) is the ticket server's address. Mallory forged it, so the log can't point to her.

A sign like these is an **indicator of compromise (IoC)**: evidence that an attack is happening or has
happened. Nobody broke in here. The signs point to an attack on availability.`,
      focus: ['edge', 'campus'],
      open: 'logs',
      tools: [
        { kind: 'logs', devices: ['edge', 'campus'] },
        { kind: 'traffic-meter', device: 'edge' },
      ],
      setup: (sim) => {
        // Leave the uplink pegged so the edge meter reads a spike, and make sure the campus line exists to open.
        sim.setDirectedBroadcast('campus', true);
        startSmurfFlood(sim);
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
        { id: 'meter', label: 'Open [[edge]] and read its Traffic meter', check: inspected('edge') },
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
          afterGoals: true,
          prompt: 'Which sign points to a smurf attack in particular, not just to some flood?',
          options: [
            { id: 'broadcast', text: 'Echo requests sent to a broadcast address from outside the network.', correct: true },
            { id: 'meter', text: 'The uplink meter stuck at its limit.', feedback: 'That shows a flood, but not which kind. Many attacks fill a link.' },
            { id: 'slow', text: 'The ticket site loads slowly for fans.', feedback: "That's the symptom of any denial of service. It doesn't single out smurf." },
            { id: 'cpu', text: 'The web server is working hard.', feedback: 'A busy server fits many problems. Look for the broadcast pings.' },
          ],
          explain:
            "A traffic spike tells you there's a flood. Echo requests aimed at a broadcast address, from outside, are the fingerprint of a smurf attack.",
        },
      ],
    },
    {
      id: 'silence-the-amplifier',
      title: 'Silence the amplifier',
      body: `The real fix is at the amplifier. A router has no good reason to pass pings from the internet to a whole
network at once. Modern routers don't, unless someone turns it on.

1. Click [[campus]]. Under **Directed broadcasts**, switch it **off**.
2. Press **Mallory tries again**. One forged ping goes to the campus broadcast address.`,
      focus: ['campus', 'mallory', 'web'],
      open: { inspect: 'campus' },
      tools: [{ kind: 'directed-broadcast', device: 'campus' }],
      setup: (sim) => {
        // Enter with the amplifier on and a flood running, so turning the setting off is what stops it.
        sim.clearLinkFlood('botnet');
        sim.setDirectedBroadcast('campus', true);
        startSmurfFlood(sim);
      },
      actions: [
        {
          id: 'retry',
          label: 'Mallory tries again',
          run: (sim) => sim.echo('mallory', CAMPUS_BCAST, { source: WEB }),
          outcome: (sim, t) => {
            if (happened(sim, t, (e) => e.type === 'drop' && e.device === 'campus' && e.reason === 'no-broadcast'))
              return [{ tone: 'good', text: 'The campus router dropped the ping at the door, so no campus computer replied.' }];
            const n = repliesAtWeb(sim, t);
            if (n) return [{ tone: 'bad', text: `The campus router passed it on, and ${n} replies hit the ticket server. Switch directed broadcasts off, then try again.` }];
            return [{ tone: 'wait', text: 'The forged ping is on its way to the campus router…' }];
          },
        },
      ],
      goals: [
        {
          id: 'off',
          label: 'Turn off directed broadcasts on [[campus]]',
          hint: 'Click [[campus]] and switch **Directed broadcasts** off.',
          check: ({ sim }) => sim.dev('campus').directedBroadcast === false,
        },
        {
          id: 'fizzle',
          label: "Mallory's ping gets no replies",
          hint: 'Turn the setting off first, then press **Mallory tries again**.',
          // The latest drop at the door counts, even if an earlier press (before the fix) got replies.
          check: ({ sim, since }) => {
            const drop = [...sim.events].reverse().find((e) => e.t >= since && e.type === 'drop' && e.device === 'campus' && e.reason === 'no-broadcast');
            return !!drop && !happened(sim, drop.t, (e) => e.type === 'ping-reply' && e.device === 'web');
          },
        },
      ],
      questions: [
        {
          id: 'whose-network',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Turning that setting off stopped the attack. But the campus network belongs to Westfield, not Hilltop. What does that mean for Hilltop?',
          options: [
            { id: 'depends', text: "Hilltop depends on other networks to fix this, and can't force them.", correct: true },
            { id: 'own', text: 'Hilltop can turn the setting off on its own router instead.', feedback: "That keeps Hilltop from being an amplifier, but it doesn't stop a flood that uses some other network." },
            { id: 'over', text: 'Nothing. Once one amplifier is fixed, smurf attacks are over.', feedback: 'There are many open networks. An attacker can pick a different amplifier.' },
            { id: 'back', text: 'Hilltop should flood the campus network back.', feedback: 'Flooding back is illegal and pointless.' },
          ],
          explain:
            "The best fix sits on a network you may not control. That's why defenders also guard their own edge and ask their provider for help. No single fix covers every case.",
        },
      ],
    },
    {
      id: 'guard-your-edge',
      title: 'Guard your own edge',
      body: `Westfield fixed its router. But the next attacker can find another amplifier, or use a botnet. Hilltop has
to guard its own edge too.

[[edge]] has a **firewall**: a list of allow and deny rules. It checks each packet against the rules from the
top, and the first rule that matches decides.

1. In [[edge]]'s firewall, add the rule **DENY in ICMP (ping) from any to any**. Move it above the rule that
   allows ping.
2. Press **Botnet joins in**, then **Fan buys a ticket**. Read both results.
3. Your **ISP** (internet service provider) is the company that connects Hilltop to the internet. It sits one
   hop before your uplink. Press **The ISP filters upstream**, then **Fan buys a ticket** again.

(This firewall blocks all ICMP with one rule. Real firewalls can block only echo requests and keep the ICMP
messages a network needs.)`,
      focus: ['isp', 'edge', 'web', 'fan', 'botnet'],
      open: { inspect: 'edge' },
      tools: [
        { kind: 'firewall-rules', devices: ['edge'] },
        { kind: 'traffic-meter', device: 'edge' },
      ],
      setup: (sim) => {
        sim.clearFloods();
        // The edge firewall ships open to ping (the weakness); the student adds the deny above it.
        ensureEdgeFirewall(sim);
        sim.setDirectedBroadcast('campus', false);
      },
      actions: [
        botnetFlood,
        buyTicket,
        {
          id: 'isp-filter',
          label: 'The ISP filters upstream',
          run: (sim) => ispFilterUpstream(sim),
          outcome: (sim) => [{ tone: 'good', text: 'The provider now drops pings headed for Hilltop, before they reach the uplink.' }, uplinkLine(sim)],
        },
      ],
      goals: [
        {
          id: 'rule',
          label: 'Add a rule to [[edge]] that drops inbound ICMP',
          hint: 'Action DENY, direction in, protocol ICMP (ping), from any. Move it above the rule that allows ping.',
          check: ({ sim }) => deniesInboundIcmp(sim, 'edge'),
        },
        {
          id: 'still-fails',
          label: "See that fans still can't buy, even with the rule",
          hint: 'Press **Botnet joins in**, then **Fan buys a ticket**.',
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
          afterGoals: true,
          prompt: "Your edge firewall drops the pings, but fans can't buy tickets until the ISP filters them. Why?",
          options: [
            { id: 'fills', text: 'The flood fills the uplink before it reaches your firewall.', correct: true },
            { id: 'match', text: "Edge firewalls can't match on ICMP.", feedback: 'They can. Your rule worked: the map showed the pings denied at your edge.' },
            { id: 'faster', text: "The ISP's firewall is faster than yours.", feedback: "Speed isn't it. The ISP sits before the full link, so it drops the flood in time." },
            { id: 'order', text: 'Your rule was in the wrong order.', feedback: "Your rule was on top and it worked. The uplink was already full before your firewall." },
          ],
          explain:
            'A firewall can only act on packets that reach it. This flood does its harm on the uplink, before your firewall. The ISP sits before that link. Many ISPs also drop packets whose source address could not belong to their own customers, which stops forged pings where they start.',
        },
      ],
    },
    {
      id: 'how-risky',
      title: 'How risky?',
      body: `A security review grades each weakness by how much harm it could cause on its own:

- **High risk**: an outsider can reach important data or systems directly.
- **Moderate risk**: it helps an attacker or adds to an attack, but opens no direct way to the data.
- **Low risk**: it tells an attacker a little and opens nothing.

Grade each weakness by itself, not the whole attack it was part of.`,
      focus: ['edge', 'campus'],
      questions: [
        {
          id: 'open-icmp',
          kind: 'choice',
          prompt: "Before you added the rule, Hilltop's edge firewall allowed ping from anywhere. What risk is that?",
          options: [
            { id: 'high', text: 'High risk.', feedback: 'It helped the attack, but it gave no one the data or control. And blocking it at the edge did not save the uplink. It is a moderate risk.' },
            { id: 'mod', text: 'Moderate risk.', correct: true },
            { id: 'low', text: 'Low risk.', feedback: 'It does more than give away a little information: it lets outsiders probe your network and add to floods. It is a moderate risk.' },
          ],
          explain:
            'Ping left open at an external firewall is a moderate risk: useful to an attacker, but not a direct path to the data. Blocking it is cheap, so most networks do.',
        },
        {
          id: 'wifi-flat',
          kind: 'choice',
          prompt:
            'At a different school, every computer, including the server that stores grades, sits on one network with nothing dividing it (a **flat network**). Its Wi-Fi has a weak password, so anyone in range can join. What risk is that?',
          options: [
            { id: 'high', text: 'High risk.', correct: true },
            { id: 'mod', text: 'Moderate risk.', feedback: 'An outsider can join and reach the grade server directly. That is a direct path to data: high risk.' },
            { id: 'low', text: 'Low risk.', feedback: 'This opens a direct path from outside to the grades. That is a high risk.' },
          ],
          explain: 'Weak Wi-Fi lets an outsider in, and a flat network puts the grade server within reach. Together that is a high risk.',
        },
        {
          id: 'beacons',
          kind: 'choice',
          prompt:
            "Last one: the school's Wi-Fi access points (the boxes that send the Wi-Fi signal) send out **beacon frames**, short radio messages that announce the network's name to anyone nearby. Nobody replies to them, so they can't amplify anything. What risk is that?",
          options: [
            { id: 'high', text: 'High risk.', feedback: 'A beacon gives no way in and no data. That is a low risk.' },
            { id: 'mod', text: 'Moderate risk.', feedback: 'Beacons only announce that a network exists, which anyone nearby could notice anyway. That is a low risk.' },
            { id: 'low', text: 'Low risk.', correct: true },
          ],
          explain: "Beacon frames tell nearby devices a network exists. That helps an attacker a little, but it opens nothing. It's a low risk.",
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
            "Explain how a smurf attack turns one attacker's pings into a flood big enough to knock a site offline. Then name the setting that stops it at the amplifier, and the device that setting is on.",
        },
      ],
    },
    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: `Look over your summary. You can go back to any step and change an answer, then hand in your work again.`,
    },
  ],
};
