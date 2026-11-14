import type { Sim } from '../../sim/sim';
import { distance, triangulate } from '../../sim/wifi';
import { settingsKey, WIDS_RULES, type WidsReplay } from '../../sim/wids';
import type { LogEntry } from '../../sim/types';
import { citedLogs, happened, inspected, openedLog } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, LabDef, MapZone, ToolSpec } from '../types';
import {
  BSSID,
  buildWatch,
  catchUp,
  CLOCK,
  GYM,
  isMovieNight,
  LOOKALIKE,
  MAC,
  MOVIE_CROWD,
  onReal,
  removeRogue,
  ROGUE_PORT,
  ROGUE_SSID,
  seedRogue,
  SERVER,
  setJam,
  SPOTS,
  SSID,
  STAFF,
  STAFF_PROFILE,
  TONIGHT,
  TWIN_POS,
} from './scenario';

// --- Tools ---

const SCAN: ToolSpec = { kind: 'wifi-scan', devices: ['desk'], watch: 'wap' };
const LOGS: ToolSpec = { kind: 'logs', devices: ['wap', 'lansw'] };
const CITE: ToolSpec = { kind: 'logs', devices: ['wap', 'lansw'], cite: true };

// --- Step actions ---

const label = (sim: Sim, id: string) => sim.dev(id).label;

/** Whether the copy now matches the real network: same name, WPA3, a per-person login. */
const copied = (sim: Sim) => {
  const w = sim.dev('twin').wifi!;
  return w.ssid === SSID && w.security === 'wpa3' && w.auth === 'eap';
};

const copyName: ActionDef = {
  id: 'copy-name',
  label: 'The radio copies the name and the security',
  // Sign-in first, then encryption, then the name, so no device sees a half-made copy.
  run: (sim) => {
    sim.setWifiAuth('twin', 'eap');
    sim.setWifiSecurity('twin', 'wpa3');
    sim.setWifiSsid('twin', SSID);
  },
  outcome: (sim): ActionLine[] => {
    if (!copied(sim)) return [{ tone: 'wait', text: 'Press the button and watch which devices move.' }];
    return [
      ...STAFF.map((id): ActionLine =>
        onReal(sim, id)
          ? { tone: 'good', text: `${label(sim, id)} stayed on the real network. Its profile wants ${SERVER}'s certificate, and the copy can't show it.` }
          : { tone: 'bad', text: `${label(sim, id)} is not on the real network.` },
      ),
      sim.dev('visitor').wifiClient?.joinedAp === 'twin'
        ? { tone: 'bad', text: `${label(sim, 'visitor')} moved to the copy, which is louder where he sits. His phone never checks the certificate, so it sent his login to the copy's sign-in server.` }
        : { tone: 'wait', text: `${label(sim, 'visitor')} is still on the real network.` },
    ];
  },
};

/** Whether the three readings put the copy at its hiding spot. */
const locatedTwin = (sim: Sim) => {
  const loc = triangulate(sim.wifiReadings.filter((r) => r.bssid === BSSID.twin));
  return !!loc && distance(loc, TWIN_POS) < 60;
};

const unplug: ActionDef = {
  id: 'unplug',
  label: 'Unplug the radio',
  // Nobody can unplug a radio before they know where it is.
  run: (sim) => {
    if (!sim.dev('twin').wifi!.off && locatedTwin(sim)) sim.setWifiOff('twin', true);
  },
  outcome: (sim) =>
    sim.dev('twin').wifi!.off
      ? [{ tone: 'good', text: `The copy is off the air. ${label(sim, 'visitor')} ${onReal(sim, 'visitor') ? 'is back on the real network.' : 'is not connected.'}` }]
      : [{ tone: 'wait', text: 'Find the radio first: measure it from all three spots in Signal triangulation.' }],
};

const saveProfile: ActionDef = {
  id: 'save-profile',
  label: "Give Mr. Okafor a new login and save the profile",
  run: (sim) => sim.setWifiProfile('visitor', { ...STAFF_PROFILE }),
  outcome: (sim) =>
    sim.dev('visitor').wifiClient?.profile
      ? [{ tone: 'good', text: `The desk reset his login, so the one the copy took no longer works. ${label(sim, 'visitor')} now has the profile, so a copy can't pull it away again.` }]
      : [{ tone: 'wait', text: 'Not saved yet.' }],
};

const movieNight: ActionDef = {
  id: 'movie-night',
  label: 'Movie night starts',
  run: (sim) => sim.setWifiCrowd('wap', MOVIE_CROWD),
  outcome: (sim) =>
    (sim.dev('wap').wids?.crowd ?? 0) >= MOVIE_CROWD
      ? [{ tone: 'good', text: `${online(sim)} phones and laptops are online, and pages load slowly. Now check the air.` }]
      : [{ tone: 'wait', text: 'Not started yet.' }],
};

/** Devices online at the access point, counted the way its noise line counts them. */
function online(sim: Sim): number {
  return Object.values(sim.devices).filter((d) => d.wifiClient?.joinedAp === 'wap').length + (sim.dev('wap').wids?.crowd ?? 0);
}

// --- Setups (idempotent) ---

/** From the lookalike step on, the rogue box is off the wall and the lookalike radio is on (until it's unplugged). */
function setupLookalike(sim: Sim): void {
  seedRogue(sim);
  removeRogue(sim);
  catchUp(sim, TONIGHT.lookalike);
  const twin = sim.dev('twin').wifi!;
  const heard = sim.dev('wap').wids!.heard[BSSID.twin];
  if (twin.off && !heard) sim.setWifiOff('twin', false);
}

/** From the find step on, the radio has copied the exact name (so its log lines exist), until it's unplugged. */
function setupCopied(sim: Sim): void {
  setupLookalike(sim);
  if (!sim.dev('twin').wifi!.off && !copied(sim)) copyName.run(sim);
}

/** From the jamming step on, the lookalike is gone and Mr. Okafor's phone is set up properly. */
function setupAfterTwin(sim: Sim): void {
  setupCopied(sim);
  if (!sim.dev('twin').wifi!.off) sim.setWifiOff('twin', true);
  if (!sim.dev('visitor').wifiClient!.profile) sim.setWifiProfile('visitor', { ...STAFF_PROFILE });
}

// --- Goal helpers ---

const scannedSince = (sim: Sim, since: number) => happened(sim, since, (e) => e.type === 'wifi' && e.what === 'scan' && e.device === 'desk');
const marks = (sim: Sim) => sim.dev('wap').wids!.marks;
const noiseLine = (e: LogEntry) => e.device === 'wap' && e.fields?.action === 'noise';

/** The newest replay, if it ran with the alarm settings that are on now. */
function currentReplay(sim: Sim): WidsReplay | undefined {
  const w = sim.dev('wap').wids!;
  const last = w.replays[w.replays.length - 1];
  return last && last.settings === settingsKey(w) ? last : undefined;
}

export const watchTheAirLab: LabDef = {
  id: 'watch-the-air',
  version: 1,
  title: 'Watch the Air',
  tagline: "Keep watch over the shelter's Wi-Fi: catch a rogue access point, a lookalike network, and a jammer, then choose the alarms that will catch the next one.",
  unit: 3,
  codehs: ['3.18.5 Locating a Rogue AP with Signal Triangulation', '3.14 The Automated Detectors', '3.4.2 Wireless Attacks'],
  ced: ['3.5.E', '3.1.B', '3.5.D'],
  minutes: 45,
  objectives: [
    'Find a rogue access point by comparing a scan with an inventory, and trace it to a switch port.',
    'Explain how a saved network profile protects a device from an evil twin, and locate the twin by triangulation.',
    'Tell jamming from a crowded channel using noise levels and log lines, and cite log lines as evidence.',
    'Recommend detective controls for a wireless network and describe their impact, including false alarms.',
  ],
  build: buildWatch,
  labelMacs: true,
  clock: CLOCK,
  map: {
    zones: (): MapZone[] => [{ id: 'gym', shape: { kind: 'rect', ...GYM }, label: 'Gym shelter', tone: 'neutral' }],
    // The rogue box and the lookalike radio are on the map only while their radios are on.
    hide: (sim) => (['rogue', 'twin'] as const).filter((id) => sim.dev(id).wifi!.off),
  },
  steps: [
    {
      id: 'tour',
      title: 'Two weeks later',
      body: md`
        The emergency shelter in the Ridgeview High gym has been open for two weeks. Its Wi-Fi is locked down: **WPA3** encryption scrambles everything sent over the air, each person signs in with their own login, and the signal is turned down so it doesn't reach far past the walls.

        Your job is different now. You **keep watch**. Tonight, people report strange things on the Wi-Fi. You will check each report, collect evidence, and then choose alarms that catch the next problem for you.

        The map shows a few of the gym's phones and laptops, not all of them.

        Start with what belongs here. Click [[wap]] and find **Approved access points**. This list is an **inventory**: every access point the shelter put up, with its name, its radio address (the **BSSID**), its channel, and where it hangs.

        > Everything in this lab happens inside a simulation. Setting up a fake access point or a jammer outside a lab like this one is illegal. The radio model is simple: the signal fades with distance, and walls don't block it.
      `,
      focus: ['wap', 'wap2'],
      open: { inspect: 'wap' },
      goals: [{ id: 'look', label: 'Open [[wap]] and read its approved access points', check: inspected('wap') }],
      questions: [
        {
          id: 'why-list',
          kind: 'choice',
          prompt: 'Why does the technician keep a list of approved access points?',
          options: [
            { id: 'compare', text: 'It shows which radios in a scan belong to the shelter.', correct: true },
            { id: 'block', text: 'The list stops other access points from ever turning on.', feedback: "A list can't switch anything off. It tells you what belongs, so you can spot what doesn't." },
            { id: 'speed', text: 'Devices on the list get faster and steadier Wi-Fi.', feedback: "The list doesn't change speed. It's a record for the people who keep watch." },
            { id: 'password', text: 'It keeps the Wi-Fi password safe from attackers.', feedback: 'Logins are checked by the sign-in server. The list records which radios the shelter owns.' },
          ],
          explain: "You can only spot something that doesn't belong if you know what does. An up-to-date inventory turns \"a network I don't recognize\" into something you can check.",
        },
      ],
    },

    {
      id: 'sweep',
      title: 'Sweep the air',
      body: md`
        A volunteer says a new network showed up on her phone last night. **Sweep the air**: scan from the [[desk]] and check every network against the approved list.

        1. In the Wi-Fi scanner, press **Scan from Volunteer desk**.
        2. Compare each network's BSSID with the list on [[wap]]. Mark it **On the list** or **Not on it**. The scanner won't decide for you.

        A network that isn't on the list could be a **rogue access point**: a box someone plugged into the shelter's wired network. To find where it's plugged in, look at the wired side. The [[lansw]] switch writes a log line when a port comes up and when a new device appears on it.

        3. Open the **Logs** tab. Click a switch line that shows the box arriving, then press **Cite this line as evidence**. Each switch line starts with a code: **LINK** means a port came up or went down, and **MAC_NEW** means a new device appeared on a port. Either line about the box's port works.
        4. Click [[lansw]], press **Edit** on that port, then press **Shut port down**.

        (The map shows the box on its jack because this is a simulation. On a real network you only have the scan and the switch log.)
      `,
      setup: seedRogue,
      focus: ['desk', 'rogue', 'lansw'],
      open: 'tools',
      tools: [SCAN, CITE, { kind: 'port-security', device: 'lansw' }],
      goals: [
        {
          id: 'marked',
          label: 'Mark each network the [[desk]] hears',
          hint: 'Two of the three are on the approved list. Compare each BSSID with the list on [[wap]].',
          check: ({ sim }) => {
            const m = marks(sim);
            return m[BSSID.wap] === 'approved' && m[BSSID.wap2] === 'approved' && m[BSSID.rogue] === 'unknown';
          },
        },
        {
          id: 'cited',
          label: 'Cite the switch line that shows the box on its port',
          hint: 'In the Logs tab, choose Wiring closet. Look for a line about port 7 from last night.',
          check: ({ sim, since }) => citedLogs(sim, since, (e) => e.device === 'lansw' && e.fields?.port === ROGUE_PORT).length > 0,
        },
        {
          id: 'shut',
          label: 'Shut the port the box is plugged into',
          hint: 'Port 7 on [[lansw]]. Press Edit on it, then Shut port down.',
          check: ({ sim }) => !!sim.dev('lansw').switchSec?.ports[ROGUE_PORT]?.shutdown,
        },
      ],
      questions: [
        {
          id: 'rogue-risk',
          kind: 'choice',
          afterGoals: true,
          prompt: `The shelter Wi-Fi uses WPA3. Why does the open "${ROGUE_SSID}" box on a wall jack still matter?`,
          options: [
            { id: 'bridge', text: 'It is wired in, so joining it skips WPA3 and the logins.', correct: true },
            { id: 'read', text: 'It can read the scrambled WPA3 traffic right out of the air.', feedback: "WPA3 traffic stays scrambled. The danger is the open door into the wired network." },
            { id: 'slow', text: 'It slows the real Wi-Fi down for everyone in the gym.', feedback: "It's on a different channel. The danger is the open door, not speed." },
            { id: 'pass', text: 'It changes the shelter Wi-Fi password without anyone knowing.', feedback: "A box on a jack can't change the access point's settings. It offers its own way in." },
          ],
          explain: 'Every protection you set up lives on the approved access point. A rogue box is a second door into the same wired network, with none of those protections.',
        },
      ],
    },

    {
      id: 'lookalike',
      title: "A name that's almost right",
      body: md`
        A volunteer unplugged the box and locked it in the office. A few minutes later, a new network appears: **${LOOKALIKE}**. Look closely. The real one is **${SSID}**, with a dash. This one has an underscore and is open: no encryption and no sign-in. A network built to pass for yours is an **evil twin**.

        1. Scan from the [[desk]] again and mark the new network.
        2. Press **The radio copies the name and the security**. Now the copy has the exact name, WPA3, and its own sign-in server. Scan again, and watch which devices move.

        A phone hops to the louder of two radios with the same name and security. That's how it roams around a big building. What it can still check is the sign-in server, **${SERVER}**. The server proves who it is with a **certificate**, a digital ID card only the real server has.

        Every device set up at the desk, for staff and families alike, has a **saved profile** that names the sign-in server. It checks the certificate before it sends a login. Mr. Okafor arrived this afternoon. A volunteer typed his login in by hand and skipped the profile, so his phone never checks.
      `,
      setup: setupLookalike,
      focus: ['twin', 'visitor', 'phone1', 'desk'],
      open: 'tools',
      tools: [SCAN, LOGS],
      actions: [copyName],
      goals: [
        {
          id: 'marked',
          label: 'Mark the new network',
          hint: `Its BSSID, ${BSSID.twin}, is not on the approved list.`,
          check: ({ sim }) => marks(sim)[BSSID.twin] === 'unknown',
        },
        {
          id: 'copied',
          label: 'See which devices join the exact copy',
          hint: 'Press The radio copies the name and the security, then read the lines under it.',
          check: ({ sim }) => copied(sim) && sim.dev('visitor').wifiClient?.joinedAp === 'twin' && STAFF.every((id) => onReal(sim, id)),
        },
      ],
      questions: [
        {
          id: 'why-stay',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The copy used the exact name and WPA3, and some devices with a profile heard it louder than the real network. Why did they stay?',
          options: [
            { id: 'profile', text: `Their profile checks for ${SERVER}'s certificate.`, correct: true },
            { id: 'name', text: 'They noticed the underscore in the network name.', feedback: 'By then the copy used the exact name. Anyone can copy a name.' },
            { id: 'louder', text: 'The real network was louder for every staff device.', feedback: 'Not for all of them. A staff device can hear the copy louder and still refuse it.' },
            { id: 'mac', text: 'The copy blocked their MAC addresses from joining.', feedback: 'The copy wants everyone to join. The devices turned it down themselves.' },
          ],
          explain: "Anyone can copy a name, the security type, and a strong signal. Nobody else can show the sign-in server's certificate. That's why the desk saves a profile on every device it sets up, including a newcomer's.",
        },
      ],
    },

    {
      id: 'find',
      title: 'Find the radio',
      body: md`
        The scan tells you the copy is out there, but not where. **Triangulation** finds it. Each signal reading tells you how far away the radio is, but not in which direction. So each reading puts the radio somewhere on a circle around the spot you measured from. Circles from three spots cross at one point. (Finding a place from distances is also called trilateration. Most people say triangulation.)

        1. In **Signal triangulation**, choose the network whose BSSID is not on the approved list.
        2. Measure it from all three spots.
        3. When the card says where the radio is, press **Unplug the radio**.
        4. The copy's server kept Mr. Okafor's login, so it has to change. Press **Give Mr. Okafor a new login and save the profile**.

        (The map already shows the radio because this is a simulation. In a real building you only have the readings.)
      `,
      setup: setupCopied,
      focus: ['twin', 'desk'],
      open: 'tools',
      tools: [{ kind: 'triangulate', scanner: 'desk', spots: SPOTS }, SCAN],
      actions: [unplug, saveProfile],
      goals: [
        {
          id: 'located',
          label: 'Triangulate the copy to its hiding spot',
          hint: 'Pick the network with BSSID ' + BSSID.twin + ' and measure from all three spots.',
          check: ({ sim }) => locatedTwin(sim),
        },
        { id: 'off', label: 'Unplug the radio', check: ({ sim }) => !!sim.dev('twin').wifi!.off },
        { id: 'profile', label: "Give Mr. Okafor a new login and save the profile", check: ({ sim }) => !!sim.dev('visitor').wifiClient?.profile && onReal(sim, 'visitor') },
      ],
      questions: [
        {
          id: 'three',
          kind: 'choice',
          prompt: 'Why does triangulation need readings from three spots?',
          options: [
            { id: 'circles', text: 'A reading gives a distance, not a direction.', correct: true },
            { id: 'strength', text: 'Three weak readings add up to one strong, clear signal.', feedback: 'Each reading is separate. Together they narrow down the place, not the strength.' },
            { id: 'answer', text: 'The radio only answers every third reading that you take.', feedback: 'The radio broadcasts all the time. The number of spots is about geometry.' },
            { id: 'rule', text: 'Two would work fine. A third is only a safety rule.', feedback: 'Two circles usually cross in two places, so two readings leave you with two guesses.' },
          ],
          explain: 'A signal reading gives a distance, not a direction. Each distance draws a circle around a spot. Two circles cross at two points, and the third circle picks one.',
        },
      ],
    },

    {
      id: 'evidence',
      title: "Read the access point's log",
      body: md`
        The shelter director asks what happened to Mr. Okafor, and how you know. Your answer needs **evidence**: log lines that show it.

        The [[wap]] logs what it hears in the air. Open the **Logs** tab and choose **Shelter Wi-Fi** in the device list. Cite the three lines that tell the story:

        1. The access point first heard the lookalike network, **${LOOKALIKE}**.
        2. Mr. Okafor's phone left the real network.
        3. His phone was seen talking to a radio that isn't on the approved list.
      `,
      setup: setupCopied,
      focus: ['wap', 'visitor'],
      open: 'logs',
      tools: [CITE],
      goals: [
        {
          id: 'heard',
          label: 'Cite the line where the lookalike network was first heard',
          hint: `Search the log for "${LOOKALIKE}". Cite the "new network heard" line.`,
          check: ({ sim, since }) => citedLogs(sim, since, (e) => e.device === 'wap' && e.fields?.bssid === BSSID.twin && e.fields?.action === 'heard').length > 0,
        },
        {
          id: 'left',
          label: "Cite the line where Mr. Okafor's phone left the real network",
          hint: 'Search the log for "Okafor".',
          check: ({ sim, since }) => citedLogs(sim, since, (e) => e.device === 'wap' && e.fields?.action === 'left' && e.fields?.mac === MAC.visitor).length > 0,
        },
        {
          id: 'stray',
          label: 'Cite the line that shows his phone on a radio that is not approved',
          hint: 'Search the log for "approved list".',
          check: ({ sim, since }) => citedLogs(sim, since, (e) => e.fields?.action === 'stray' && e.fields?.mac === MAC.visitor).length > 0,
        },
      ],
      questions: [
        {
          id: 'which-line',
          kind: 'choice',
          prompt: "Which line proves Mr. Okafor's phone was on the copy, and not only offline?",
          options: [
            { id: 'stray', text: 'The line that shows his phone talking to a radio not on the list.', correct: true },
            { id: 'left', text: 'The line that says his phone left the real shelter network tonight.', feedback: 'Leaving only shows his phone dropped off. A dead battery would log the same line.' },
            { id: 'heard', text: 'The line that says a new network was first heard in the gym.', feedback: 'That shows the copy existed. It says nothing about who joined it.' },
            { id: 'joined', text: 'The line that says his phone joined the shelter network.', feedback: "That's after you unplugged the copy, when he came back." },
          ],
          explain: 'Good evidence shows the claim directly. Each line answers one question: the copy appeared, his phone left, and his phone was on the copy.',
        },
      ],
    },

    {
      id: 'jam',
      title: 'Nobody can connect',
      body: md`
        Later that evening, every device in the gym drops off the Wi-Fi at once, and none can get back on. Families are lining up at the desk.

        Is the access point broken? Collect evidence before you decide.

        1. Click [[lansw]] and check the state of port 1, where the access point is plugged in.
        2. Scan from the [[desk]]. Read the noise on each channel. A quiet channel reads about 5.
        3. In the Logs tab, open the [[wap]]'s newest noise line.
      `,
      setup: (sim) => {
        setupAfterTwin(sim);
        catchUp(sim, TONIGHT.jam);
        setJam(sim, true);
      },
      focus: ['wap', 'lansw', 'desk'],
      open: 'tools',
      tools: [SCAN, LOGS],
      goals: [
        { id: 'port', label: 'Check the access point\'s port on [[lansw]]', check: inspected('lansw') },
        { id: 'scan', label: 'Scan from the [[desk]] and read the noise', check: ({ sim, since }) => scannedSince(sim, since) },
        { id: 'log', label: 'Open the newest noise line in the log', hint: 'Search the log for "noise".', check: openedLog((e) => noiseLine(e) && Number(e.fields?.noise) > 50) },
      ],
      questions: [
        {
          id: 'what',
          kind: 'choice',
          afterGoals: true,
          prompt: "The access point's port is up, and its radio still shows in the scan. The noise on channel 6 is 88. What is going on?",
          options: [
            { id: 'jam', text: 'A radio is drowning out channel 6.', correct: true },
            { id: 'broken', text: 'The access point broke and stopped sending.', feedback: 'A broken access point goes quiet. This one is up on the wire and still on the air. The noise is the problem.' },
            { id: 'crowd', text: 'Too many people are online at once tonight.', feedback: 'A crowd slows things down, but devices stay connected. Here nobody is connected.' },
            { id: 'password', text: 'Someone changed the Wi-Fi password today.', feedback: 'That would show sign-in failures in the log, not noise at 88.' },
          ],
          explain: "**Jamming** drowns out a channel with noise. The access point still works, and a scanner still catches its name. But the noise drowns out the messages going back and forth, so no device can stay connected. A radio that is still on the air plus very high noise points to a jammer. Jamming is against the law, so the shelter would report it.",
        },
      ],
    },

    {
      id: 'crowd',
      title: 'Jammer or a crowd?',
      body: md`
        The noise stopped as suddenly as it started. A van drove out of the parking lot at the same moment, and every device reconnected.

        Half an hour later, movie night starts, and lots of families stream at once. Someone at the desk asks, "It's slow again. Is the jammer back?"

        1. Press **Movie night starts**.
        2. Scan from the [[desk]] and read the noise.
        3. Open the [[wap]]'s newest noise line in the Logs tab. Compare it with the line from the jamming.

        (Real Wi-Fi tools show a crowd as a busy channel, with little free time left to send. This lab puts a crowd and a jammer on one noise scale to keep it simple.)
      `,
      setup: (sim) => {
        setupAfterTwin(sim);
        // A student who skipped the jamming step still gets its log line to compare against.
        if (!sim.dev('wap').logs.some((e) => noiseLine(e) && Number(e.fields?.noise) > 50)) {
          catchUp(sim, TONIGHT.jam);
          setJam(sim, true);
        }
        catchUp(sim, TONIGHT.movie);
        setJam(sim, false);
      },
      focus: ['wap', 'desk'],
      open: 'tools',
      tools: [SCAN, LOGS],
      actions: [movieNight],
      goals: [
        { id: 'busy', label: 'Start movie night', check: ({ sim }) => (sim.dev('wap').wids?.crowd ?? 0) >= MOVIE_CROWD },
        { id: 'scan', label: 'Scan from the [[desk]] during movie night', check: ({ sim, since }) => (sim.dev('wap').wids?.crowd ?? 0) >= MOVIE_CROWD && scannedSince(sim, since) },
        { id: 'log', label: 'Open the noise line from movie night', hint: 'Search the log for "noise". Pick the newest line.', check: openedLog((e) => noiseLine(e) && Number(e.fields?.noise) > 10 && Number(e.fields?.noise) <= 50) },
      ],
      questions: [
        {
          id: 'signs',
          kind: 'choice',
          multi: true,
          afterGoals: true,
          prompt: 'Pick the two signs that show this is a crowd and not a jammer.',
          options: [
            { id: 'noise', text: 'The noise is a little above quiet, far below 88.', correct: true },
            { id: 'connected', text: 'Devices stay connected, and more are online.', correct: true },
            { id: 'slow', text: 'Pages load slowly for everyone in the gym tonight.', feedback: 'A crowd and a jammer both make things slow, so slowness alone can\'t tell them apart.' },
            { id: 'evening', text: "It's evening, when most families are back in the gym.", feedback: 'The jammer struck in the evening too.' },
          ],
          explain: 'A jammer pins the noise near the top and knocks everyone off. A crowd raises the noise a little and keeps everyone on. An alarm that fires whenever the Wi-Fi is slow would go off every movie night. That is a **false alarm**.',
        },
      ],
    },

    {
      id: 'alarms',
      title: 'Choose your alarms',
      body: md`
        Checking by hand worked tonight, but nobody can watch the air all night. A **wireless intrusion detection system** watches for you and raises an **alert** when something looks wrong.

        The [[wap]] can run four alarm rules. Three watch the air. The fourth reads the [[lansw]] switch's log, because a rogue box shows up on the wire too. The access point also saved a record of the last 14 days, so you can test your choices before you trust them.

        1. In **Wireless alarms**, turn on all four rules.
        2. Press **Replay the last 14 days** and read the results.
        3. Pick a noise alarm level that catches the jammer but stays quiet on movie nights. Replay again.
        4. Open one of the alert lines in the Logs tab.

        An alarm that goes off when nothing is wrong is a **false alarm**, also called a false positive. An attack that raises no alarm is a **miss**.
      `,
      setup: setupAfterTwin,
      focus: ['wap'],
      open: 'tools',
      tools: [{ kind: 'wids', device: 'wap' }, LOGS],
      goals: [
        { id: 'rules', label: 'Turn on all four alarm rules', check: ({ sim }) => WIDS_RULES.every((r) => sim.dev('wap').wids!.rules[r]) },
        {
          id: 'catch',
          label: 'Replay with settings that catch all three attacks',
          hint: 'The jammer only sets off the noise alarm. Keep the noise rule on, with a level below 88.',
          check: ({ sim }) => currentReplay(sim)?.missed.length === 0,
        },
        {
          id: 'quiet',
          label: 'Replay with no alarm on movie night, and no attack missed',
          hint: 'Movie nights reached a noise level of 17. The jammer reached 88. Choose a level between them, then replay.',
          check: ({ sim }) => {
            const r = currentReplay(sim);
            return !!r && r.missed.length === 0 && !r.falseAlarms.some(isMovieNight);
          },
        },
        { id: 'read', label: 'Open an alert line in the Logs tab', hint: 'Check Alerts only in the Logs tab.', check: openedLog((e) => e.device === 'wap' && e.source === 'wids' && e.level === 'alert') },
      ],
      questions: [
        {
          id: 'laptop',
          kind: 'choice',
          afterGoals: true,
          prompt: "With every rule on, the replay still raises one false alarm: a volunteer plugged her new laptop into port 4 on day 5 and took it home that night. What should the shelter do about it?",
          options: [
            { id: 'keep', text: 'Keep the rule, and check each new device.', correct: true },
            { id: 'off', text: 'Turn off the rule for new devices on a switch port.', feedback: 'That rule also caught the rogue box on the wired side. Without it, a box with its radio off would slip past.' },
            { id: 'ignore', text: 'Keep the rule, but ignore every alert from the switch.', feedback: 'An alert nobody reads is the same as no alarm.' },
            { id: 'ban', text: 'Ban volunteers from bringing their own laptops.', feedback: 'That costs the shelter help and still leaves the alarm with nothing to tell apart.' },
          ],
          explain: 'Every alarm has a cost: someone has to check it. A rule that raises a few false alarms is worth keeping when it also catches real attacks. The rogue box showed up the same way the laptop did, as a new device on a switch port. Turning the rule off to stop the noise also stops it catching the next box.',
        },
      ],
    },

    {
      id: 'recommend',
      title: 'Describe the impact',
      body: md`
        The shelter director wants your recommendation in writing. Pick the **detective controls** the shelter should run. A detective control finds a problem once it starts, so people can respond. It doesn't block the attack.

        Then describe the impact of your plan: the work it gives the staff and what it changes for the people there. Checking one alert takes a volunteer about 5 minutes. Some controls watch the air. Others watch what people do, and that costs them privacy.
      `,
      questions: [
        {
          id: 'controls',
          kind: 'choice',
          multi: true,
          prompt: 'Which detective controls should the shelter run?',
          options: [
            { id: 'sweep', text: 'A weekly scan of the air, compared with the approved list.', correct: true },
            { id: 'rules', text: 'Alarms for unknown radios, lookalikes, and new devices on ports.', correct: true },
            { id: 'noise', text: 'A noise alarm set between movie night and the jammer.', correct: true },
            { id: 'review', text: 'Someone reads the alerts every day and notes what each was.', correct: true },
            { id: 'low', text: 'A noise alarm at 10, so that not even a small change slips past.', feedback: 'It would go off every movie night, and staff would learn to ignore it.' },
            { id: 'sites', text: 'A log of every website each family visits on the Wi-Fi.', feedback: 'That watches people, not the air. It costs families their privacy and would catch none of tonight\'s attacks.' },
            { id: 'off', text: 'Turn the Wi-Fi off each night so there is nothing to watch.', feedback: 'That is not detection, and families need the Wi-Fi at night.' },
          ],
          explain: 'A good set of detective controls covers each attack you saw: an inventory and sweeps for rogue boxes, name and address rules for evil twins, a tuned noise alarm for jammers, and a person who reads the alerts. Controls that watch what people do cost privacy without adding protection. Even the alarms keep a little about people: which device joined and when.',
        },
        {
          id: 'impact',
          kind: 'text',
          prompt: "Describe the impact of your recommendation. Cover the staff time it takes each day, the false alarms it will raise, and what it means for families' privacy.",
          minWords: 40,
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
