import { prefixContains } from '../../sim/addr';
import type { Conn } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { LogEntry } from '../../sim/types';
import { happened, inspected, loggedSince, openedLog, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef, ToolSpec } from '../types';
import {
  buildSub,
  ensureClean,
  ensurePlan,
  ensurePolicy,
  ensureSubnets,
  ensureVlans,
  ifaceIs,
  INSIDE,
  isInfected,
  NET,
  ordersSet,
  plugPersonal,
  policyIs,
  portsIn,
  subZones,
  SW_PORTS,
  VLAN,
  warmArp,
  ZONE_NAME,
  ZONE_OF,
  ZONES,
} from './scenario';

// ---------------------------------------------------------------------------
// The lesson's buttons
// ---------------------------------------------------------------------------

const connect = (from: string, to: string, port: number) => (sim: Sim) => void sim.connectService(from, sim.ipOf(to), port);

const pingFire: ActionDef = { id: 'ping-fire', label: 'Crew laptop 1 pings Fire control', run: (sim) => void sim.ping('crew1', sim.ipOf('fire')) };
const install = (label: string): ActionDef => ({ id: 'install', label, run: (sim) => sim.infect('crew1', 'The game a sailor installed carried it.') });

// ---------------------------------------------------------------------------
// Goal checks
// ---------------------------------------------------------------------------

const deny = (e: LogEntry) => e.fields?.action === 'deny';
const fromCrew = (e: LogEntry) => prefixContains(NET.crew, String(e.fields?.src ?? ''));
const blockedProbe = (e: LogEntry) => deny(e) && e.fields?.dport === 445 && fromCrew(e);

/** The event is a connection from `device` to `to` on `port` that ended, and it matches. */
const connEnded = (ev: unknown, sim: Sim, device: string, to: string, port: number, pred: (c: Conn) => boolean): boolean => {
  const e = ev as { type?: string; device?: string; conn?: Conn };
  return e?.type === 'conn-result' && e.device === device && !!e.conn && e.conn.to === sim.ipOf(to) && e.conn.port === port && pred(e.conn);
};

const fwDenied = (sim: Sim, since: number, from: string, to: string, port: number) =>
  loggedSince(sim, 'fw', since, (e) => deny(e) && e.fields?.src === sim.ipOf(from) && e.fields?.dst === sim.ipOf(to) && e.fields?.dport === port);

const WEAPONS_OPS = ['fire', 'torpedo', 'command', 'nav', 'chart'];

/** What the zone plan card says when a computer goes in another zone (step 3). */
const JOB: Record<string, string> = {
  fire: 'aims the torpedoes',
  torpedo: 'launches the torpedoes',
  command: 'is where officers run the ship',
  nav: 'steers the ship',
  chart: 'stores the charts Navigation uses',
  crew1: 'is a sailor’s own laptop',
  crew2: 'is a sailor’s own laptop',
  media: 'stores movies for the crew',
};
const PLAN_FIT = Object.fromEntries(INSIDE.map((id) => [id, { zone: ZONE_OF[id], job: JOB[id] }]));
const WEAPONS_LOW = 'Think about what an attacker could do from Fire control.';
const LEVEL_NOTES = {
  weapons: { medium: WEAPONS_LOW, low: WEAPONS_LOW },
  crew: { high: 'Crew laptops run games and downloads. Would you trust them as much as Fire control?' },
};

/** Port shutdown (mac-flood) and its inspector, for step 8. */
const PORT_TOOL: ToolSpec = { kind: 'port-security', device: 'sw' };

export const segmentationLab: LabDef = {
  id: 'segmentation',
  version: 1,
  title: 'Network Segmentation: Zones, VLANs, and Subnets',
  tagline: 'Split a submarine’s flat network into zones with VLANs, subnets, and firewall rules, and watch the same malware stop at the zone boundary.',
  unit: 3,
  codehs: ['3.8 Network Segmentation'],
  ced: ['3.1.B', '3.1.C', '3.3.A', '3.3.B', '3.4.C'],
  minutes: 45,
  objectives: [
    'Explain how malware moves laterally across a flat network.',
    'Divide a network into zones with VLANs and subnets.',
    'Set a different policy for each zone, and test it.',
    'Explain what segmentation contains, and what it cannot.',
  ],
  build: buildSub,
  map: { ports: false, addresses: true, zones: subZones },
  labelMacs: true,
  steps: [
    {
      id: 'ship',
      title: 'One big network',
      setup: (sim) => warmArp(sim),
      body: md`
        A navy submarine runs on three groups of computers:

        - **Weapons**: [[fire]] and [[torpedo]] aim and launch the torpedoes.
        - **Operations**: [[command]], [[nav]], and [[chart]] run the ship and plot its course.
        - **Crew recreation**: [[crew1]], [[crew2]], and [[media]] are for the crew's time off: games, email, and movies.

        All of them plug into one switch, [[sw]], and share one network, \`10.0.0.0/24\`. A network with no walls inside it is called a **flat network**.

        [[fw]] is the ship's door to [[shore]], a satellite link that works only when the sub is near the surface. [[personal]] belongs to a sailor. It isn't plugged in.

        1. Click [[fire]]. Its **Open ports** list shows the **port numbers** it answers on. A port number names one service on a computer. Port 445 is **file sharing**, which lets other computers copy files to and from this one. A port number is not a switch port. A switch port is a socket for a cable.
        2. Click [[sw]]. Find which device each port leads to.
        3. Press **Crew laptop 1 pings Fire control**. Watch the path the ping takes.
      `,
      focus: ['crew1', 'sw', 'fire'],
      actions: [pingFire],
      goals: [
        { id: 'fire', label: 'Open [[fire]] and read its services', check: inspected('fire') },
        { id: 'sw', label: 'Open [[sw]]', check: inspected('sw') },
        {
          id: 'ping',
          label: '[[crew1]] gets a reply from [[fire]]',
          hint: 'Press **Crew laptop 1 pings Fire control**.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'crew1' && e.from === sim.ipOf('fire')),
        },
      ],
      questions: [
        {
          id: 'problem',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Crew laptop 1 reached Fire control directly. Why is that a problem?',
          options: [
            { id: 'reach', text: 'Malware on a crew laptop could reach weapons too', correct: true },
            { id: 'slow', text: 'Pings slow down the weapons consoles while they work', feedback: 'One ping is tiny. The worry is what else could take the same path.' },
            { id: 'launch', text: 'Crew laptop 1 can now launch a torpedo', feedback: 'Reaching a computer isn’t the same as controlling it. But it’s the first thing an attacker needs.' },
            { id: 'fw', text: 'It isn’t. The core firewall checks every packet.', feedback: 'Watch the ping again. It went from the switch straight to Fire control and never passed the firewall.' },
          ],
          explain: 'On a flat network, nothing stands between a crew laptop and a weapons console. Whatever takes over one device can reach all the others.',
        },
      ],
    },

    {
      id: 'worm',
      title: 'A game with a passenger',
      setup: (sim) => {
        ensureClean(sim);
        warmArp(sim);
      },
      body: md`
        Last night the sub came near the surface, and a sailor downloaded a free game onto [[crew1]] over the shore link. The game hides **malware**: software written to do harm. This kind is a **worm**, malware that spreads across a network on its own. Nobody has to click anything.

        Once it runs, it knocks on port 445 at every address nearby. Every computer with file sharing open gets a copy, and each copy starts knocking too. Spreading from the first device that's taken over to other devices on the same network is called **lateral movement**.

        Infected computers turn red, and so do the malware's probes. Real networks don't color anything. This simulator does so you can follow along. It also skips addresses where no device lives, so you don't have to wait.

        > Everything in this lab happens inside a simulation. Releasing malware on a real network without permission is illegal.

        1. Press **Crew laptop 1 installs a game**. Watch the map.
        2. When the map goes quiet, click [[fire]]. Find where its copy came from.
      `,
      focus: ['crew1', 'fire'],
      actions: [install('Crew laptop 1 installs a game')],
      goals: [
        {
          id: 'weapons',
          label: 'The malware reaches a weapons console',
          hint: 'Press **Crew laptop 1 installs a game** and watch the map.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'malware-infected' && (e.device === 'fire' || e.device === 'torpedo')),
        },
        { id: 'all', label: 'The malware infects all eight computers', check: ({ sim }) => INSIDE.every((id) => isInfected(sim, id)) },
        {
          id: 'source',
          label: 'Open [[fire]] and find where its copy came from',
          hint: 'Wait until Fire control turns red, then click it.',
          check: ({ sim, ev }) => ev?.type === 'ui:inspect' && ev.device === 'fire' && isInfected(sim, 'fire'),
        },
      ],
      questions: [
        {
          id: 'how',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Nobody installed anything on Fire control. How did the malware get there?',
          options: [
            { id: 'share', text: 'Crew laptop 1 copied it in through file sharing', correct: true },
            { id: 'shore', text: 'It came in over the shore link, like the game did', feedback: 'Fire control’s copy came from 10.0.0.31, inside the ship. Click Fire control and read where its copy came from.' },
            { id: 'fw', text: 'The core firewall let it through', feedback: 'The probes went through the switch only. On a flat network, traffic between computers never reaches the firewall.' },
            { id: 'user', text: 'A sailor installed the game on Fire control too', feedback: 'The game was installed once, on Crew laptop 1. Fire control’s copy arrived over the network.' },
          ],
          explain: 'The worm used Crew laptop 1 as a base and reached every computer it could find on the same network. That’s lateral movement, and on a flat network it can find them all.',
        },
        {
          id: 'cia',
          kind: 'choice',
          multi: true,
          afterGoals: true,
          prompt: 'The malware now runs on Fire control. What could an adversary who controls it do?',
          options: [
            { id: 'read', text: 'Read the targeting data', correct: true },
            { id: 'change', text: 'Change the targeting data', correct: true },
            { id: 'freeze', text: 'Freeze the console during a drill', correct: true },
            { id: 'wait', text: 'Nothing until someone on board clicks on it', feedback: 'A worm needs no clicks. Nobody touched Fire control, and the malware got in anyway.' },
          ],
          explain:
            'Those are the three goals of security: confidentiality (keep data secret), integrity (keep it correct), and availability (keep it working). Lateral movement puts all three at risk on every device it reaches.',
        },
      ],
    },

    {
      id: 'plan',
      title: 'Draw the lines',
      setup: (sim) => ensureClean(sim),
      body: md`
        The crew wiped every computer and restored it from backups. Before the game comes back, plan some walls.

        **Network segmentation** divides one network into smaller **segments** and keeps them apart, so an attack on one segment can't reach the others. Each segment here is a **zone**: a group of devices that do the same kind of job and follow the same rules.

        Each zone also gets a **security level**: how much is at stake if an attacker takes it over, and so how closely to guard it.

        - **High**: let in only the traffic it needs.
        - **Medium**: trusted, but still guarded.
        - **Low**: the least trusted. The other zones guard themselves against it.

        Open the **Zone plan** in the Toolkit tab.

        1. Put each computer in the zone that matches its job. The map draws each zone as you fill it in.
        2. Give each zone a security level.
      `,
      open: 'tools',
      tools: [{ kind: 'zone-plan', devices: INSIDE, zones: ZONES.map((z) => ({ id: z, label: ZONE_NAME[z] })), fit: PLAN_FIT, levelNotes: LEVEL_NOTES }],
      goals: [
        {
          id: 'assign',
          label: 'Put every computer in the zone that matches its job',
          hint: 'Fire control and Torpedo room handle weapons. Command, Navigation, and the chart server run the ship. The other three are for the crew.',
          check: ({ sim }) => INSIDE.every((id) => sim.devices[id].zone === ZONE_OF[id]),
        },
        { id: 'levels', label: 'Give each zone a security level', check: ({ sim }) => ZONES.every((z) => !!sim.zoneLevels[z]) },
      ],
      questions: [
        {
          id: 'strictest',
          kind: 'choice',
          prompt: 'Which zone needs the strictest policy?',
          options: [
            { id: 'weapons', text: 'Weapons, because a takeover there does the most harm', correct: true },
            {
              id: 'crew',
              text: 'Crew, because it’s where malware is most likely to get in',
              feedback: 'Crew is the least trusted zone, so the other zones guard themselves against it. The zone that needs the closest guard is the one with the most at stake.',
            },
            { id: 'ops', text: 'Operations, because the captain works there', feedback: 'Who uses a zone doesn’t set its level. Ask what an attacker could do with each zone.' },
            {
              id: 'same',
              text: 'All three, equally strict',
              last: true,
              feedback: 'Then movie night would face the same rules as a torpedo launch. Different zones get different levels, so each one can do its job.',
            },
          ],
          explain: 'A breach in Weapons could cost lives, so it gets the highest level. Segmentation lets each zone have its own policy, so Weapons can be strict without making movie night impossible.',
        },
        {
          id: 'purpose',
          kind: 'choice',
          prompt: 'What is network segmentation for?',
          options: [
            { id: 'contain', text: 'Keeping a break-in inside one segment', correct: true },
            { id: 'fast', text: 'Making the network faster for everyone', feedback: 'Smaller segments do cut down broadcast traffic. But speed isn’t why the captain wants walls.' },
            { id: 'outside', text: 'Hiding the ship’s network from the shore link', feedback: 'The shore link is one door. Segmentation is about walls inside, between the ship’s own zones.' },
            { id: 'passwords', text: 'Giving every computer its own password', feedback: 'Passwords protect accounts. Segmentation decides which devices can reach each other at all.' },
          ],
          explain: 'Segmentation isolates traffic. A break-in in one segment stays there, and each segment can get the policy it needs.',
        },
      ],
    },

    {
      id: 'vlans',
      title: 'One switch, three networks',
      setup: (sim) => {
        ensureClean(sim);
        ensurePlan(sim);
        // Forget what everyone learned, so the ARP request shows on the map.
        for (const d of Object.values(sim.devices)) if (d.kind === 'host' && Object.keys(d.arp).length) sim.clearArp(d.id);
        sim.dev('sw').macTable = {};
      },
      body: md`
        Your plan needs walls between the zones. New switches and new cables would take weeks to install on a submarine. A **VLAN** (virtual LAN) builds the walls with settings instead.

        A VLAN is a group of switch ports that act like a switch of their own. A frame that comes in a port in VLAN 30 leaves only through other ports in VLAN 30. Broadcasts too. VLANs separate devices **logically**: by the switch's settings, not by its cables.

        Every port starts in VLAN 1. That's why the whole ship is one network.

        The computers and the switch have forgotten everything they learned so far.

        1. Click [[sw]]. In its **VLANs** table, put each port in its zone's VLAN:
           - Weapons: VLAN 10. Include port 3, a spare jack in the weapons compartment with nothing plugged in.
           - Operations: VLAN 20.
           - Crew: VLAN 30.
        2. Leave port 10, the firewall's cable, in VLAN 1 for now.
        3. Press **Crew laptop 1 pings Fire control**. Watch where its ARP request goes.
        4. Press **Crew laptop 1 pings the media server**.

        Try other pairs with the **Ping** tool in the Toolkit tab.
      `,
      focus: ['sw', 'crew1'],
      open: { inspect: 'sw' },
      tools: [{ kind: 'vlan', device: 'sw', vlans: ZONES.map((z) => ({ id: VLAN[z], name: ZONE_NAME[z] })) }, { kind: 'ping' }],
      actions: [
        {
          id: 'ping-fire',
          label: 'Crew laptop 1 pings Fire control',
          // Forget Fire control's MAC first, so the ARP request shows every time.
          run: (sim) => {
            sim.clearArp('crew1');
            sim.ping('crew1', sim.ipOf('fire'));
          },
        },
        { id: 'ping-media', label: 'Crew laptop 1 pings the media server', run: (sim) => void sim.ping('crew1', sim.ipOf('media')) },
      ],
      goals: [
        {
          id: 'weapons',
          label: 'Put the weapons ports, 1, 2, and 3, in VLAN 10',
          hint: 'Port 3 has no cable. It’s the spare jack in the weapons compartment.',
          check: ({ sim }) => portsIn(sim, SW_PORTS.weapons, VLAN.weapons),
        },
        { id: 'ops', label: 'Put the operations ports, 4, 5, and 6, in VLAN 20', check: ({ sim }) => portsIn(sim, SW_PORTS.operations, VLAN.operations) },
        { id: 'crew', label: 'Put the crew ports, 7, 8, and 9, in VLAN 30', check: ({ sim }) => portsIn(sim, SW_PORTS.crew, VLAN.crew) },
        {
          id: 'cut',
          label: '[[crew1]] gets no answer from [[fire]]',
          hint: 'Set the VLANs first. Then press **Crew laptop 1 pings Fire control**.',
          check: ({ sim, ev }) =>
            ev?.type === 'ping-fail' &&
            ev.device === 'crew1' &&
            ev.to === sim.ipOf('fire') &&
            (ev.reason === 'arp-timeout' || ev.reason === 'timeout') &&
            portsIn(sim, ['p1', 'p2'], VLAN.weapons) &&
            portsIn(sim, ['p7'], VLAN.crew),
        },
        {
          id: 'media',
          label: '[[crew1]] still gets a reply from [[media]]',
          hint: 'Set the crew ports first. Then press **Crew laptop 1 pings the media server**.',
          check: ({ sim, ev }) => ev?.type === 'ping-reply' && ev.device === 'crew1' && ev.from === sim.ipOf('media') && portsIn(sim, ['p7', 'p9'], VLAN.crew),
        },
      ],
      questions: [
        {
          id: 'what',
          kind: 'choice',
          prompt: 'What does a VLAN do, with no new hardware?',
          options: [
            { id: 'split', text: 'It splits one switch into separate local networks', correct: true },
            { id: 'encrypt', text: 'It encrypts traffic between devices in the same VLAN', feedback: 'A VLAN doesn’t encrypt anything. Devices in the same VLAN talk in the clear, as before.' },
            { id: 'port', text: 'It blocks file sharing on port 445', feedback: 'A VLAN doesn’t look at port numbers or services. It decides which switch ports can hear each other.' },
            { id: 'mac', text: 'It gives each device a new MAC address', feedback: 'MAC addresses stay the same. The switch changes only which ports a frame may leave through.' },
          ],
          explain: 'VLANs logically separate devices on a shared switch. Same switch, same cables. A broadcast in one VLAN never reaches another.',
        },
        {
          id: 'why-fail',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Crew laptop 1 and Fire control are both still on 10.0.0.0/24. Why did the ping fail?',
          options: [
            { id: 'arp', text: 'Its ARP request never reached Fire control', correct: true },
            { id: 'fw', text: 'The core firewall blocked it', feedback: 'The firewall isn’t in this path. The ARP request never left VLAN 30.' },
            { id: 'address', text: 'Fire control got a new address when its VLAN changed', feedback: 'Fire control still has 10.0.0.11. A VLAN changes which ports can hear each other, not any device’s address.' },
            { id: 'share', text: 'Fire control turned off file sharing', feedback: 'A ping doesn’t use file sharing. It only needs Fire control to answer.' },
          ],
          explain: 'Crew laptop 1 needed Fire control’s MAC address first. Its ARP broadcast went only to the other VLAN 30 ports, so nobody who knew the answer heard the question.',
        },
      ],
    },

    {
      id: 'subnets',
      title: 'A subnet for each zone',
      setup: (sim) => {
        ensureClean(sim);
        ensurePlan(sim);
        ensureVlans(sim);
        ensureSubnets(sim, false);
      },
      body: md`
        The VLANs worked. Now no zone can reach any other, and some have to. Command has to send target data to Fire control.

        The fix is to give each VLAN its own **subnet**: its own IP network, like \`10.0.30.0/24\`. Devices on different subnets can't talk directly. They hand everything for another subnet to their default gateway. Every zone's gateway is [[fw]], so traffic between zones has to pass through one place, where it can be checked.

        The ship's address plan: the third number matches the VLAN, and each device keeps its last number. Fire control's \`10.0.0.11\` becomes \`10.0.10.11\`.

        The ship's IT chief did most of the work. [[fw]] now has a cable into the switch for each zone: its port 1 goes to switch port 10, port 2 to port 11, and port 3 to port 12. Weapons, Operations, [[crew2]], and [[media]] already have their new addresses. Finish the crew zone:

        1. Click [[sw]]. Put port 12 in VLAN 30.
        2. Click [[fw]]. Give its port 3 the address \`10.0.30.1/24\`.
        3. Click [[crew1]]. Change its address to \`10.0.30.31/24\` and its default gateway to \`10.0.30.1\`.
        4. Press **Crew laptop 1 opens the movie list**. Then press **Crew laptop 1 pings Command**.

        Bigger networks often carry every VLAN over one cable, called a **trunk**. This lab uses one cable per VLAN to keep things simple.
      `,
      focus: ['sw', 'fw', 'crew1'],
      open: { inspect: 'sw' },
      tools: [
        {
          kind: 'ip-config',
          fixed: [
            {
              device: 'fw',
              iface: 'p3',
              cidr: '10.0.30.1/24',
              why: 'Crew laptop 2 and the media server already use 10.0.30.1 as their gateway. Type 10.0.30.1/24.',
            },
            {
              device: 'crew1',
              cidr: '10.0.30.31/24',
              why: 'The ship’s address plan keeps each device’s last number and makes the third number match its VLAN. Type 10.0.30.31/24.',
            },
          ],
        },
        { kind: 'gateway' },
        { kind: 'vlan', device: 'sw', vlans: ZONES.map((z) => ({ id: VLAN[z], name: ZONE_NAME[z] })) },
        { kind: 'ping' },
      ],
      actions: [
        { id: 'movies', label: 'Crew laptop 1 opens the movie list', run: (sim) => sim.browse('crew1', `http://${sim.ipOf('media')}/`) },
        { id: 'ping-command', label: 'Crew laptop 1 pings Command', run: (sim) => void sim.ping('crew1', sim.ipOf('command')) },
      ],
      goals: [
        { id: 'vlan', label: 'Put switch port 12 in VLAN 30', hint: 'Port 12 is where the firewall’s port 3 cable plugs in.', check: ({ sim }) => portsIn(sim, ['p12'], VLAN.crew) },
        { id: 'fwport', label: 'Give [[fw]] port 3 the address 10.0.30.1/24', check: ({ sim }) => ifaceIs(sim, 'fw', 'p3', '10.0.30.1/24') },
        {
          id: 'crew1',
          label: 'Move [[crew1]] to 10.0.30.31/24, with gateway 10.0.30.1',
          hint: 'Give the firewall’s port 3 its address first. A gateway has to be a router’s address on the computer’s own network.',
          check: ({ sim }) => ifaceIs(sim, 'crew1', 'eth0', '10.0.30.31/24') && sim.dev('crew1').gateway === '10.0.30.1',
        },
        {
          id: 'movies',
          label: 'The movie list loads on [[crew1]]',
          hint: 'Crew laptop 1 and the media server are both in VLAN 30. Check that Crew laptop 1 has its new address.',
          check: ({ sim, since }) => pageSince(sim, 'crew1', since, (b) => b.status === 'loaded' && b.from === sim.ipOf('media')),
        },
        {
          id: 'cross',
          label: '[[crew1]] gets a reply from [[command]] through the firewall',
          hint: 'If the ping stops at Crew laptop 1, check its gateway. If nobody answers at 10.0.30.1, check the VLAN of switch port 12.',
          check: ({ sim, since }) =>
            prefixContains(NET.crew, sim.ipOf('crew1')) &&
            happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'crew1' && e.from === sim.ipOf('command')),
        },
      ],
      questions: [
        {
          id: 'why-subnet',
          kind: 'choice',
          prompt: 'The VLANs already keep the zones apart. What do separate subnets add?',
          options: [
            { id: 'router', text: 'A router can pass chosen traffic between zones', correct: true },
            { id: 'space', text: 'Room for many more addresses in each zone', feedback: 'One /24 network already had room for 254 devices. The ship has eight.' },
            { id: 'encrypt', text: 'Encryption for everything that crosses between zones', feedback: 'Subnets don’t encrypt anything. They decide which traffic has to go through a router.' },
            {
              id: 'novlan',
              text: 'They make the VLANs unnecessary',
              feedback: 'Without VLANs, every device would still hear every broadcast. A laptop could change its own address and reach Fire control directly, never touching the firewall.',
            },
          ],
          explain: 'Subnetting puts a router between the zones. Traffic that has to cross goes through it, so a breach in one subnet can be stopped there instead of spreading.',
        },
        {
          id: 'predict',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The firewall now joins the three subnets, but it still lets everything through. If the game ran now, what would happen?',
          options: [
            { id: 'cross', text: 'It would spread to every zone, through the firewall', correct: true },
            { id: 'stay', text: 'It would stay in the crew zone, since the subnets differ', feedback: 'Different subnets means the traffic needs a router. The firewall is that router, and right now it passes everything.' },
            { id: 'stuck', text: 'It couldn’t leave Crew laptop 1 at all', feedback: 'Crew laptop 1 reaches other subnets through its gateway. You used it to ping Command.' },
            { id: 'switch', text: 'It would spread as before, straight through the switch', feedback: 'The VLANs still keep the zones apart on the switch. To reach another zone, a packet has to go through the firewall.' },
          ],
          explain: 'Subnets alone don’t stop anything. They make all traffic between zones pass through one point. Next you’ll decide what that point allows.',
        },
      ],
    },

    {
      id: 'policy',
      title: 'Rules between zones',
      setup: (sim) => {
        ensureClean(sim);
        ensurePlan(sim);
        ensureVlans(sim);
        ensureSubnets(sim, true);
      },
      body: md`
        Every packet between zones now passes through [[fw]]. Tell it what to allow with a **zone policy**: a table of which zone may start a connection to which other zone, and for what.

        The captain's orders:

        1. Crew devices may not start a connection to Weapons or Operations.
        2. Operations may send target data to Weapons, on port 5001. Nothing else.
        3. Weapons may send status reports to Operations, on port 5002. Nothing else.
        4. Anything these orders don't list is denied.

        Ports 5001 and 5002 belong to the ship's own software.

        Click [[fw]] and find its **Zone policy**. Each row is the zone a connection starts from. Each column is the zone it goes to. Your security levels from the plan show in the headings. A reply to an allowed connection always gets back.

        Then press each test button. If the firewall stops a packet, a red tag on the map shows where.

        Many networks put a separate firewall in front of each segment. Here one firewall does that job, with its own port and its own rules for each zone. The zone policy writes the firewall's rules for you. You'll write rules by hand in the Firewall Rules and Placement lab.
      `,
      focus: ['fw'],
      open: { inspect: 'fw' },
      tools: [{ kind: 'zone-policy', device: 'fw' }],
      actions: [
        { id: 'target', label: 'Command sends target data to Fire control', run: connect('command', 'fire', 5001) },
        { id: 'share', label: 'Command opens Fire control’s file share', run: connect('command', 'fire', 445) },
        { id: 'status', label: 'Fire control sends a status report to Command', run: connect('fire', 'command', 5002) },
        { id: 'crew-share', label: 'Crew laptop 1 opens Fire control’s file share', run: connect('crew1', 'fire', 445) },
      ],
      goals: [
        {
          id: 'orders',
          label: 'Set all six cells to follow the captain’s orders',
          hint: 'Anything the orders don’t list is Deny. Check Weapons to Crew and Operations to Crew too.',
          check: ({ sim }) => ordersSet(sim),
        },
        {
          id: 'target',
          label: 'Target data from [[command]] reaches [[fire]]',
          hint: 'Set Operations to Weapons first. Then press **Command sends target data to Fire control**.',
          check: ({ sim, ev }) => connEnded(ev, sim, 'command', 'fire', 5001, (c) => c.status === 'open') && policyIs(sim, 'operations', 'weapons', 'only:5001'),
        },
        {
          id: 'share',
          label: '[[fw]] stops [[command]] from opening Fire control’s file share',
          hint: 'Press **Command opens Fire control’s file share**.',
          check: ({ sim, since }) => fwDenied(sim, since, 'command', 'fire', 445),
        },
        {
          id: 'status',
          label: 'A status report from [[fire]] reaches [[command]]',
          hint: 'Set Weapons to Operations first. Then press **Fire control sends a status report to Command**.',
          check: ({ sim, ev }) => connEnded(ev, sim, 'fire', 'command', 5002, (c) => c.status === 'open') && policyIs(sim, 'weapons', 'operations', 'only:5002'),
        },
        {
          id: 'crew',
          label: '[[fw]] stops [[crew1]] from opening Fire control’s file share',
          hint: 'Press **Crew laptop 1 opens Fire control’s file share**.',
          check: ({ sim, since }) => fwDenied(sim, since, 'crew1', 'fire', 445),
        },
      ],
      questions: [
        {
          id: 'least',
          kind: 'choice',
          prompt: 'Why allow only target data from Operations to Weapons, instead of everything?',
          options: [
            { id: 'limit', text: 'Malware on Command could then reach only port 5001', correct: true },
            { id: 'speed', text: 'Allowing everything would slow the whole firewall down', feedback: 'Speed isn’t the reason. Ask what a hacked operations console could reach.' },
            { id: 'encrypted', text: 'Target data is encrypted, and other traffic isn’t', feedback: 'The zone policy doesn’t look at encryption. It decides by zone and port number.' },
            { id: 'only', text: 'Weapons consoles can’t receive any other traffic', feedback: 'They can. Fire control has file sharing open on port 445, the same door the worm used.' },
          ],
          explain: 'This is least privilege: allow only what each zone needs. If Command is ever hacked, the attacker still can’t open Fire control’s file share.',
        },
      ],
    },

    {
      id: 'contain',
      title: 'Malware, again',
      setup: (sim) => {
        ensureClean(sim);
        ensurePlan(sim);
        ensureVlans(sim);
        ensureSubnets(sim, true);
        ensurePolicy(sim);
        warmArp(sim);
      },
      body: md`
        Months later, the sub comes near the surface again. The same sailor downloads the same game onto [[crew1]].

        The malware hasn't changed. It knocks on port 445 at every address nearby: its own subnet first, then the subnets next to it.

        1. Press **Crew laptop 1 installs the game**. Watch where the probes go.
        2. When the map goes quiet, open the **Logs** tab. Click a line in [[fw]]'s log that shows a blocked probe.
      `,
      focus: ['crew1', 'fw'],
      tools: [{ kind: 'logs', devices: ['fw'] }, { kind: 'zone-policy', device: 'fw' }],
      actions: [install('Crew laptop 1 installs the game')],
      goals: [
        {
          id: 'crew',
          label: 'The malware spreads to [[crew2]]',
          hint: 'Press **Crew laptop 1 installs the game**.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'malware-infected' && e.device === 'crew2'),
        },
        { id: 'blocked', label: '[[fw]] turns away the malware’s probes', check: ({ sim, since }) => loggedSince(sim, 'fw', since, blockedProbe) },
        {
          id: 'clean',
          label: 'Weapons and Operations stay clean',
          hint: 'Wait for the malware to stop. If it got past the firewall, check the zone policy, then press **Reset network**.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'malware-done') && !WEAPONS_OPS.some((id) => isInfected(sim, id)),
        },
        {
          id: 'log',
          label: 'Open a blocked probe in [[fw]]’s log',
          hint: 'In the **Logs** tab, click a DENY line with port 445.',
          check: openedLog((e) => e.device === 'fw' && blockedProbe(e)),
        },
      ],
      questions: [
        {
          id: 'contained',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Why did the malware stop at the edge of the crew zone?',
          options: [
            { id: 'policy', text: 'The firewall denied every probe from Crew', correct: true },
            { id: 'own', text: 'It only tries addresses on its own subnet', feedback: 'Read the firewall’s log. It tried 10.0.10.11 and 10.0.20.21 too.' },
            { id: 'vlan', text: 'The VLANs blocked it, with no help from the firewall', feedback: 'The VLANs sent its probes to the firewall instead of straight to Fire control. The firewall’s zone policy turned them away.' },
            { id: 'patched', text: 'The weapons consoles were patched after last time', feedback: 'Nobody changed Fire control. It still has file sharing open on port 445.' },
          ],
          explain: 'The VLANs and subnets forced every probe through the firewall, and the zone policy denied them. Each layer did part of the job. That’s how subnetting contains a breach.',
        },
        {
          id: 'inside',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Crew laptop 2 and the media server were infected anyway. Why didn’t the firewall stop that?',
          options: [
            { id: 'same', text: 'Traffic inside a zone never passes the firewall', correct: true },
            { id: 'low', text: 'The crew zone’s security level was set too low', feedback: 'The level is part of your plan. It doesn’t change where packets go. Did the probes to Crew laptop 2 pass the firewall?' },
            { id: 'cell', text: 'The crew-to-crew cell was set to Allow', feedback: 'There is no crew-to-crew cell in the zone policy. Why is that square greyed out?' },
            {
              id: 'failed',
              text: 'Segmentation failed, so the whole crew zone fell',
              feedback: 'Segmentation did its job: it kept the damage to one zone. It was never meant to guard devices from others in the same zone.',
            },
          ],
          explain:
            'Segmentation contains a breach to one segment. It can’t protect devices from each other inside that segment. For that, the crew could turn off file sharing they don’t use and keep their laptops updated.',
        },
      ],
    },

    {
      id: 'jack',
      title: 'One more door',
      setup: (sim) => {
        ensureClean(sim);
        ensurePlan(sim);
        ensureVlans(sim);
        ensureSubnets(sim, true);
        ensurePolicy(sim);
      },
      body: md`
        Remember port 3, the spare jack in the weapons compartment? Nothing is plugged into it, but it's in VLAN 10. Anything plugged in there lands inside the weapons zone. Its traffic to Fire control goes through the switch and never passes the firewall.

        1. Press **A sailor plugs a laptop into the spare jack**. Watch the weapons zone on the map.
        2. Click [[sw]]. Shut down port 3.
        3. Press **A sailor plugs a laptop into the spare jack** again.

        Like most laptops, [[personal]] gets an address automatically from the network it joins. Here it gets one on the weapons subnet.

        A switch has a second tool for ports that are in use. **Port security** limits how many MAC addresses a port accepts, and can name which ones. The questions compare the two.
      `,
      focus: ['sw', 'personal'],
      open: { inspect: 'sw' },
      tools: [PORT_TOOL],
      actions: [{ id: 'plug', label: 'A sailor plugs a laptop into the spare jack', run: plugPersonal }],
      goals: [
        {
          id: 'in',
          label: '[[personal]] opens a file share on [[fire]]',
          hint: 'Press the button before you shut the port. If you already shut it, turn port 3 back on, press the button, then shut it again.',
          check: ({ sim, since }) => (sim.dev('personal').conns ?? []).some((c) => c.t >= since && c.status === 'open' && c.to === sim.ipOf('fire') && c.port === 445),
        },
        {
          id: 'shut',
          label: 'Shut down switch port 3',
          hint: 'Click the switch. In **Ports and port security**, choose **Edit** on port 3, then **Shut port down**.',
          check: ({ sim }) => sim.dev('sw').switchSec?.ports.p3?.shutdown === 'admin',
        },
        {
          id: 'out',
          label: '[[personal]] can’t reach [[fire]] anymore',
          hint: 'Shut port 3 first. Then press **A sailor plugs a laptop into the spare jack** again.',
          check: ({ sim, ev }) => connEnded(ev, sim, 'personal', 'fire', 445, (c) => c.status !== 'open') && !!sim.dev('sw').switchSec?.ports.p3?.shutdown,
        },
      ],
      questions: [
        {
          id: 'why-shut',
          kind: 'choice',
          prompt: 'Why shut the spare port, instead of turning on port security with a limit of one MAC address?',
          options: [
            { id: 'first', text: 'A limit of one still lets the first device in', correct: true },
            {
              id: 'flood',
              text: 'Port security works only against MAC flooding',
              feedback: 'Port security also limits which devices may use a port. But a limit of one still lets one device in, and nobody should use this port at all.',
            },
            { id: 'vlan', text: 'Port security would move the port out of VLAN 10', feedback: 'Port security doesn’t change the VLAN. It counts and checks MAC addresses on the port.' },
            { id: 'slow', text: 'Port security slows down the whole switch', feedback: 'Checking MAC addresses is quick work for a switch. The problem is what a limit of one still allows.' },
          ],
          explain: 'An unused port has no device that belongs on it, so the safe setting is off. Shutting unused ports is part of most switch security policies.',
        },
        {
          id: 'swap',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The Torpedo room console’s port is in use, so it can’t be shut. What stops someone from unplugging the console and plugging in their own laptop?',
          options: [
            { id: 'psec', text: 'Port security, allowing only the console’s MAC', correct: true },
            { id: 'shut', text: 'Shut the port down, and turn it on only when needed', feedback: 'That would cut off the Torpedo room console too. A weapons console has to stay available.' },
            { id: 'vlan', text: 'Move the port to VLAN 30, the crew VLAN', feedback: 'That would put the Torpedo room console in the crew zone.' },
            { id: 'rule', text: 'A firewall rule that blocks the laptop', feedback: 'The laptop would be inside the weapons VLAN. Its traffic to Fire control goes through the switch and never reaches the firewall.' },
          ],
          explain:
            'Port security limits how many MAC addresses a port accepts, and can name which ones. A swapped-in laptop has a different MAC, so the switch shuts the port and logs it. The same limit stops MAC flooding. A skilled attacker can copy the console’s MAC address, so the ship also keeps the compartment locked.',
        },
      ],
    },

    {
      id: 'dmz',
      title: 'A door to the outside',
      body: md`
        When the sub is near the surface, email for the crew arrives over [[shore]]. A **mail relay** is a server that accepts mail from outside and passes it on. It talks to the outside world all day, so it's the server most likely to be attacked.

        A **screened subnet**, also called a **DMZ**, is a zone for servers like this. Firewall rules screen it from both sides. The outside can reach only those servers, and those servers can reach only a little of the inside. If an attacker takes over the mail relay, they're stuck in the screened subnet.

        [[fw]] also guards [[shore]], the ship's only door to the outside. A network needs a firewall at every point where it meets the outside world, and one for each segment.
      `,
      focus: ['fw', 'shore'],
      questions: [
        {
          id: 'where',
          kind: 'choice',
          prompt: 'Where should the ship’s mail relay go?',
          options: [
            { id: 'dmz', text: 'In a screened subnet of its own', correct: true },
            { id: 'crew', text: 'In the crew zone, next to the media server', feedback: 'Mail from outside can carry malware. A hacked relay in the crew zone could reach every crew laptop without passing the firewall.' },
            { id: 'weapons', text: 'In the weapons zone, the best-guarded zone', feedback: 'Then the shore link would need a door straight into Weapons. Servers that face the outside go where a break-in hurts least.' },
            { id: 'outside', text: 'On the shore side, outside the firewall', feedback: 'Then nothing would guard the relay at all. In a screened subnet, the firewall guards it too.' },
          ],
          explain: 'A screened subnet holds the servers that face the outside, on their own firewall port with their own rules. A break-in there stays there.',
        },
        {
          id: 'deny',
          kind: 'choice',
          prompt: 'The screened subnet gets its own row and column in the zone policy. Which of these cells should be Deny?',
          options: [
            { id: 'dmz-wpn', text: 'Screened subnet to Weapons', correct: true },
            { id: 'shore-dmz', text: 'Shore link to screened subnet', feedback: 'Then no mail could arrive. Allow only mail from the shore link to the relay.' },
            { id: 'crew-dmz', text: 'Crew to screened subnet', feedback: 'The crew picks up their mail there. Allow only mail.' },
            { id: 'ops-dmz', text: 'Operations to screened subnet', feedback: 'Command sends its reports to shore through the relay. Allow only mail.' },
          ],
          explain: 'Outsiders can reach the screened subnet, so it’s the zone most likely to be taken over. It gets no door into the zones that matter most.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Your recommendation',
      body: md`
        You split a flat network into zones and watched the same malware stop at a wall. Here is what you used:

        - **VLANs** kept the zones apart on one shared switch.
        - **Subnets** sent all traffic between zones through the firewall.
        - A **zone policy** gave each zone its own rules.
        - Shutting the spare port closed a door nobody should use. **Port security** guards the ports in use.
        - A **screened subnet** keeps servers that face the outside away from everything else.
      `,
      questions: [
        {
          id: 'recommend',
          kind: 'text',
          prompt:
            'The captain asks for your recommendation. For each of the three LANs (weapons, operations, and crew recreation), give a security level and at least two security features, and explain why that LAN needs them.',
          minWords: 45,
          lines: 8,
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
