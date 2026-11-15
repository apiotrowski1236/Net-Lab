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
  PLACES,
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

/** "A", "A and B", or "A, B, and C". */
const listOf = (names: string[]) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`);

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
    const stayed = STAFF.filter((id) => onReal(sim, id)).map((id) => label(sim, id));
    return [
      // One line for every device whose profile turned the copy down, so the same sentence isn't read three times.
      ...(stayed.length
        ? [{ tone: 'good', text: `${listOf(stayed)} asked the copy to prove it is ${SERVER}. They got no proof, so they sent no login and stayed on the real network.` } satisfies ActionLine]
        : []),
      ...STAFF.filter((id) => !onReal(sim, id)).map((id): ActionLine => ({ tone: 'bad', text: `${label(sim, id)} is not on the real network.` })),
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
      : locatedTwin(sim)
        ? [{ tone: 'wait', text: 'The readings found the radio. Press Unplug the radio.' }]
        : [{ tone: 'wait', text: 'Find the radio first: measure it from all three spots in Signal triangulation.' }],
};

const saveProfile: ActionDef = {
  id: 'save-profile',
  label: "Give Mr. Okafor a new login and save the profile",
  run: (sim) => sim.setWifiProfile('visitor', { ...STAFF_PROFILE }),
  outcome: (sim) =>
    sim.dev('visitor').wifiClient?.profile
      ? [{ tone: 'good', text: `The desk reset his login, so the one the copy took no longer works. ${label(sim, 'visitor')} now has the profile, so a copy can't get his login again.` }]
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

/**
 * The triangulation readings on the map, while the lookalike radio is on the air: a dot at each spot
 * measured from, and a dashed circle as far out as the reading says. The circles can run past the map's
 * edge (fit: false), so they don't shrink it. Only the newest network measured is drawn.
 */
function readingCircles(sim: Sim): MapZone[] {
  if (sim.dev('twin').wifi!.off || !sim.wifiReadings.length) return [];
  const bssid = sim.wifiReadings[sim.wifiReadings.length - 1].bssid;
  // One color per reading, so three overlapping circles stay distinct.
  const tones = ['info', 'good', 'warn'] as const;
  return sim.wifiReadings
    .filter((r) => r.bssid === bssid)
    .flatMap((r, i): MapZone[] => {
      const spot = SPOTS.find((s) => s.x === r.x && s.y === r.y);
      const tone = tones[i % tones.length];
      return [
        { id: `reach-${i}`, shape: { kind: 'circle', cx: r.x, cy: r.y, r: r.dist }, tone, dashed: true, fit: false },
        { id: `spot-${i}`, shape: { kind: 'circle', cx: r.x, cy: r.y, r: 14 }, tone, label: spot ? `measured from ${spot.label}` : undefined },
      ];
    });
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

/** A desk scan after movie night started in this step (in event order: a scan in the same instant, before the button, doesn't count). */
function scannedInMovieNight(sim: Sim, since: number): boolean {
  let scanned = false;
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t >= since; i--) {
    const e = sim.events[i];
    if (e.type === 'wids' && e.what === 'crowd' && e.device === 'wap') return scanned && Number(e.detail) >= MOVIE_CROWD;
    if (e.type === 'wifi' && e.what === 'scan' && e.device === 'desk') scanned = true;
  }
  return false;
}

/** The newest replay, if it ran with the alarm settings that are on now. */
function currentReplay(sim: Sim): WidsReplay | undefined {
  const w = sim.dev('wap').wids!;
  const last = w.replays[w.replays.length - 1];
  return last && last.settings === settingsKey(w) ? last : undefined;
}

export const watchTheAirLab: LabDef = {
  id: 'watch-the-air',
  version: 3,
  title: 'Wireless Intrusion Detection',
  tagline: "Monitor the shelter's Wi-Fi: find a rogue access point, a lookalike network, and a jammer, then choose alerts that catch the next one.",
  unit: 3,
  codehs: ['3.18.5 Locating a Rogue AP with Signal Triangulation', '3.14 The Automated Detectors', '3.4.2 Wireless Attacks'],
  ced: ['3.5.E', '3.1.B', '3.5.D'],
  minutes: 50,
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
    zones: (sim): MapZone[] => [{ id: 'gym', shape: { kind: 'rect', ...GYM }, label: 'Gym shelter', tone: 'neutral' }, ...readingCircles(sim)],
    // The rogue box and the lookalike radio are on the map only while their radios are on.
    hide: (sim) => (['rogue', 'twin'] as const).filter((id) => sim.dev(id).wifi!.off),
  },
  steps: [
    {
      id: 'tour',
      title: 'Two weeks later',
      body: md`
        The emergency shelter in the Ridgeview High gym has been open for two weeks. Its Wi-Fi is well protected. **WPA3** encryption scrambles what people send over the air. Each person signs in with their own login. The signal is turned down so it doesn't reach far past the building.

        Now you **keep watch**. Tonight, people report strange things on the Wi-Fi. Check each report, collect evidence, and choose alarms that catch the next problem. (The map shows a few of the gym's phones and laptops, not all of them.)

        Start with what belongs here. Click [[wap]] and find **Approved access points**. This list is an **inventory**: every access point the shelter put up, with its name, its radio address (the **BSSID**), its channel, and where it hangs.

        > Everything in this lab happens inside a simulation. Setting up a fake access point or a jammer outside a lab like this one is illegal. The radio model is simple: the signal fades with distance, and walls don't block it.
      `,
      focus: ['wap', 'wap2'],
      goals: [{ id: 'look', label: 'Open [[wap]] and read its approved access points', check: inspected('wap') }],
      questions: [
        {
          id: 'why-list',
          kind: 'choice',
          prompt: 'Why does the shelter keep a list of approved access points?',
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

        A network that isn't on the list could be a **rogue access point**: a box someone plugged into the shelter's wired network. Anyone can join an open box without a password. (The map shows the box on its wall jack, Hallway jack, because this is a simulation. On a real network you only have the scan and the switch log.)

        3. Open the **Logs** tab and choose [[lansw]]. Click the **MAC_NEW** line for the box's port, then press **Cite this line as evidence**.
           - A **LINK** line only says a port came up. It doesn't say what was plugged in, so it doesn't count.
           - A **MAC_NEW** line names a new device and its port. On the wire, a device's address is called its **MAC**. In this lab the box's MAC matches its BSSID.
        4. Click [[lansw]], press **Edit** on that port, then press **Shut port down**. It takes effect at once, so you don't need to press Save.
      `,
      setup: seedRogue,
      focus: ['desk', 'rogue', 'lansw'],
      open: 'tools',
      tools: [SCAN, CITE, { kind: 'port-security', device: 'lansw' }],
      goals: [
        {
          id: 'marked',
          label: 'Mark each network the [[desk]] hears',
          hint: 'Two of the three are on the approved list. Compare each BSSID with the list on [[wap]]. The last few characters are enough to tell them apart.',
          check: ({ sim }) => {
            const m = marks(sim);
            return m[BSSID.wap] === 'approved' && m[BSSID.wap2] === 'approved' && m[BSSID.rogue] === 'unknown';
          },
        },
        {
          id: 'cited',
          label: 'Cite the switch line that names the box on its port',
          hint: "In the Logs tab, choose Wiring closet. The MAC_NEW line names the box's address and its port. (On real gear the MAC and the BSSID are usually close, not the same.)",
          // The MAC_NEW line, not the LINK line: only it names the box, so only it proves what is on the port.
          check: ({ sim, since }) => citedLogs(sim, since, (e) => e.device === 'lansw' && e.fields?.action === 'new-mac' && e.fields?.port === ROGUE_PORT).length > 0,
        },
        {
          id: 'shut',
          label: 'Shut the port the box is plugged into',
          hint: 'Port 7 on [[lansw]]. Press **Edit** on it, then **Shut port down**.',
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
            { id: 'read', text: 'It can read the scrambled WPA3 traffic right out of the air.', feedback: "WPA3 traffic stays scrambled. The danger is that anyone can join the box and reach the wired network." },
            { id: 'slow', text: 'It slows the real Wi-Fi down for everyone in the gym.', feedback: "It's on a different channel. The danger is a way into the wired network, not speed." },
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
        A volunteer unplugged the box and locked it in the office. A few minutes later, a new network appears: **${LOOKALIKE}**. The real one is **${SSID}**, with a dash. This one has an underscore and is open. A network made to look like yours is an **evil twin**. The map calls it Lookalike radio.

        1. Scan from the [[desk]] again and mark the new network.
        2. Press **The radio copies the name and the security**. The copy now has the exact name and WPA3, and its stronger radio is louder in parts of the gym. Read the lines under the button. Scan again to see the copy.

        How a device decides:

        - It moves to the louder of two radios with the same name and security.
        - With a **saved profile**, it first asks the sign-in server, **${SERVER}**, for its **certificate**, a digital ID card. Anyone can copy the card. Only the real server has the secret key that proves the card is its own.
        - The desk saves a profile on every device it sets up. Mr. Okafor's login was typed in by hand with no profile, so his phone never checks.

        (A real device joins the copy for a moment to ask for proof, then comes back. The simulation skips that.)
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
          hint: 'Press **The radio copies the name and the security**, then read the lines under it.',
          check: ({ sim }) => copied(sim) && sim.dev('visitor').wifiClient?.joinedAp === 'twin' && STAFF.every((id) => onReal(sim, id)),
        },
      ],
      questions: [
        {
          id: 'why-stay',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The copy used the exact name and WPA3, and some devices with a profile heard it louder than the real network. Why did they stay on the real network?',
          options: [
            { id: 'profile', text: `Their profile checks for ${SERVER}'s certificate.`, correct: true },
            { id: 'name', text: 'They noticed the underscore in the network name.', feedback: 'By then the copy used the exact name. Anyone can copy a name.' },
            { id: 'louder', text: 'The real network was louder for every device with a profile.', feedback: 'Not for all of them. A device can hear the copy louder and still refuse it.' },
            { id: 'mac', text: 'The copy blocked their MAC addresses from joining.', feedback: 'The copy wants everyone to join. The devices turned it down themselves.' },
          ],
          explain: "Anyone can copy a name, the security type, a strong signal, and even the certificate. Only the real sign-in server has the secret key that proves the certificate is its own. That's why the desk saves a profile on every device it sets up, including a newcomer's.",
        },
      ],
    },

    {
      id: 'find',
      title: 'Find the radio',
      body: md`
        The scan tells you the copy is out there, but not where. **Triangulation** finds it. A signal reading tells you how far away the radio is, but not which way. So the radio is somewhere on a circle around the spot you measured from. Two circles usually cross at two points, and a third circle picks one of them.

        1. In the Toolkit, find **Signal triangulation**. Two networks are now named ${SSID}. Choose the one whose BSSID is not on the approved list.
        2. Measure it from all three spots. The map draws a circle for each reading.
        3. When the card names the place where the circles meet, press **Unplug the radio**.
        4. The copy's server kept Mr. Okafor's login, so it has to change. Press **Give Mr. Okafor a new login and save the profile**.

        (The map already shows the radio because this is a simulation. In a real building you only have the readings. The card also knows how loud the copy is. A real tool has to guess, so its answer is rougher.)
      `,
      setup: setupCopied,
      focus: ['twin', 'desk'],
      open: 'tools',
      tools: [{ kind: 'triangulate', scanner: 'desk', spots: SPOTS, places: PLACES }],
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
          afterGoals: true,
          prompt: 'Why does triangulation need readings from three spots?',
          options: [
            { id: 'circles', text: 'A reading gives a distance, not a direction.', correct: true },
            { id: 'strength', text: 'Three weak readings add up to one strong, clear signal.', feedback: 'Each reading is separate. Together they narrow down the place, not the strength.' },
            { id: 'answer', text: 'The radio only answers every third reading that you take.', feedback: 'The radio broadcasts all the time. The number of spots is about geometry.' },
            { id: 'rule', text: 'Two would work fine. A third is only a safety rule.', feedback: 'Two circles usually cross in two places, so two readings leave you with two guesses.' },
          ],
          explain: 'A signal reading gives a distance, not a direction. Each distance draws a circle around a spot. Two circles cross at two points, and the third circle picks one. (Finding a place from distances is strictly called trilateration. Most people say triangulation.)',
        },
      ],
    },

    {
      id: 'evidence',
      title: "Read the access point's log",
      body: md`
        The shelter director asks what happened to Mr. Okafor, and how you know. Your answer needs **evidence**: log lines that show it.

        The [[wap]] logs what it hears in the air. Open the **Logs** tab and choose **Shelter Wi-Fi** in the device list. Cite the two lines that tell the story:

        1. Mr. Okafor's phone left the real network.
        2. His phone was seen talking to a radio that isn't on the approved list.
      `,
      setup: setupCopied,
      focus: ['wap', 'visitor'],
      open: 'logs',
      tools: [CITE],
      goals: [
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
          id: 'battery',
          kind: 'choice',
          afterGoals: true,
          prompt: "If Mr. Okafor's battery had died, his phone would have left the Wi-Fi too. Which of your two lines would a dead battery also leave in the log?",
          options: [
            { id: 'left', text: 'The line that says his phone left the real network.', correct: true },
            { id: 'stray', text: 'The line that shows his phone on a radio not on the list.', feedback: 'A dead phone talks to no radio at all. Only a phone on the copy leaves this line, which is why it is the proof.' },
            { id: 'both', text: 'Both lines. A dead phone would leave each of them.', feedback: 'A dead phone stops talking. It would not show up on a second radio.' },
            { id: 'neither', text: 'Neither line. A dead battery leaves nothing in the log.', feedback: 'The access point notices when a phone goes quiet, and it logs that the phone left.' },
          ],
          explain: "Good evidence shows the claim directly. \"Left\" only shows his phone went away, and a dead battery would log the same line. The line about a radio that isn't approved proves his phone was on the copy.",
        },
      ],
    },

    {
      id: 'jam',
      title: 'Nobody can connect',
      body: md`
        Later that evening, every device in the gym loses the Wi-Fi at once, and none can get back on. Is the access point broken? Collect evidence before you decide.

        **Noise** is radio energy on a channel that isn't a Wi-Fi message, like the hiss on a car radio between stations. A quiet channel reads about 5 on a scale of 0 to 100. A **jammer** is a radio that fills a channel with noise, so other radios can't be heard.

        1. Click [[lansw]] and check the state of port 1, where the access point is plugged in.
        2. Scan from the [[desk]] and read the noise on each channel.
        3. Open the **Logs** tab and click the newest noise line from Shelter Wi-Fi.

        (The scan can still list Shelter-WiFi, because a scanner only needs to hear the access point sometimes. Staying connected needs most messages to get through.)
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
        { id: 'log', label: 'Open the newest noise line in the log', hint: 'In the Logs tab, type "noise" in the search box. Uncheck **Warnings and alerts only** if it is checked.', check: openedLog((e) => noiseLine(e) && Number(e.fields?.noise) > 50) },
      ],
      questions: [
        {
          id: 'what',
          kind: 'choice',
          afterGoals: true,
          prompt: "Use your three pieces of evidence. What is going on?",
          options: [
            { id: 'jam', text: 'A jammer is filling channel 6 with noise.', correct: true },
            { id: 'broken', text: 'The access point broke and stopped sending.', feedback: 'A broken access point goes quiet. This one is up on the wire and still writing its log. The noise is the problem.' },
            { id: 'crowd', text: 'Too many people are online at once tonight.', feedback: 'A crowd slows things down, but devices stay connected. Here nobody is connected.' },
            { id: 'password', text: 'Someone changed the Wi-Fi password today.', feedback: 'That would show sign-in failures in the log, not noise at 88.' },
          ],
          explain: "The access point still works: its port is up, and it keeps writing its log. But the noise covers the messages going back and forth, so no device can stay connected. A working access point plus very high noise points to a jammer. Jamming is against the law, so the shelter would report it.",
        },
      ],
    },

    {
      id: 'crowd',
      title: 'Jammer or a crowd?',
      body: md`
        The noise stopped when a van drove out of the parking lot, and every device reconnected.

        Twenty minutes later, movie night starts, and many families get online at once. Someone at the desk asks, "It's slow again. Is the jammer back?"

        1. Press **Movie night starts**.
        2. Scan from the [[desk]] and read the noise.
        3. Open the newest noise line from Shelter Wi-Fi in the Logs tab. It is a notice, so make sure **Warnings and alerts only** is off. Compare it with the line from the jamming.

        (Real Wi-Fi tools show a crowd as a busy channel, not as noise. This lab shows a crowd and a jammer on one noise scale to keep it simple.)
      `,
      setup: (sim) => {
        setupAfterTwin(sim);
        // A student who skipped the jamming step still gets its log line to compare against.
        if (!sim.dev('wap').logs.some((e) => noiseLine(e) && Number(e.fields?.noise) > 50)) {
          catchUp(sim, TONIGHT.jam);
          setJam(sim, true);
        }
        // The van drives off ten minutes in, and the jam ends. Movie night starts twenty minutes later.
        catchUp(sim, TONIGHT.jamEnds);
        setJam(sim, false);
        catchUp(sim, TONIGHT.movie);
      },
      focus: ['wap', 'desk'],
      open: 'tools',
      tools: [SCAN, LOGS],
      actions: [movieNight],
      goals: [
        { id: 'busy', label: 'Start movie night', check: ({ sim }) => (sim.dev('wap').wids?.crowd ?? 0) >= MOVIE_CROWD },
        { id: 'scan', label: 'Scan from the [[desk]] during movie night', check: ({ sim, since }) => scannedInMovieNight(sim, since) },
        { id: 'log', label: 'Open the noise line from movie night', hint: 'Search the log for "noise" and pick the newest line. It is a notice, so make sure **Warnings and alerts only** is unchecked.', check: openedLog((e) => noiseLine(e) && Number(e.fields?.noise) > 10 && Number(e.fields?.noise) <= 50) },
      ],
      questions: [
        {
          id: 'signs',
          kind: 'choice',
          multi: true,
          afterGoals: true,
          prompt: 'Which signs show this is a crowd and not a jammer?',
          options: [
            { id: 'noise', text: 'The noise is a little above quiet, far below 88.', correct: true },
            { id: 'connected', text: 'Devices stay connected, and more are online.', correct: true },
            { id: 'slow', text: 'Pages load slowly for everyone in the gym tonight.', feedback: "Slow pages have many causes, so slowness alone can't tell a crowd from a jammer." },
            { id: 'evening', text: "It's evening, when most families are back in the gym.", feedback: 'The jammer came in the evening too.' },
          ],
          explain: 'A jammer pushes the noise near the top, and every device loses its connection. A crowd raises the reading a little (a real tool would show a busier channel) and keeps everyone on. An alarm that raises an alert whenever the Wi-Fi is slow would raise one every movie night. That is a **false alarm**.',
        },
      ],
    },

    {
      id: 'alarms',
      title: 'Choose your alarms',
      body: md`
        Checking by hand worked tonight, but nobody can watch the air all night. An **intrusion** is someone getting into a network who shouldn't. A **wireless intrusion detection system** watches the air for one and raises an **alert** when something looks wrong.

        The [[wap]] can run four alarm rules. Three watch the air. The fourth reads the [[lansw]] switch's log, because a rogue box shows up on the wire too. The access point also saved a record of the last 14 days, so you can test your choices before you trust them. It may also hold an attack nobody noticed at the time.

        An alarm that rings when nothing is wrong is a **false alarm**, also called a false positive. An attack that raises no alarm is a **miss**.

        1. In **Wireless alarms**, turn on all four rules.
        2. Press **Replay the last 14 days** and read the results.
        3. Pick a noise alarm level that catches the jammer (88) but stays quiet on movie nights (up to 17). Replay again. Other false alarms can stay. The question below asks about them.
        4. Open one of the alert lines in the Logs tab.
      `,
      setup: setupAfterTwin,
      focus: ['wap'],
      open: 'tools',
      tools: [{ kind: 'wids', device: 'wap' }, LOGS],
      goals: [
        { id: 'rules', label: 'Turn on all four alarm rules', check: ({ sim }) => WIDS_RULES.every((r) => sim.dev('wap').wids!.rules[r]) },
        {
          id: 'catch',
          label: 'Replay with settings that catch every attack',
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
        { id: 'read', label: 'Open an alert line in the Logs tab', hint: 'In the Logs tab, check the **Alerts only** box.', check: openedLog((e) => e.device === 'wap' && e.source === 'wids' && e.level === 'alert') },
      ],
      questions: [
        {
          id: 'laptop',
          kind: 'choice',
          afterGoals: true,
          prompt: "With every rule on, the replay still raises one false alarm: a volunteer plugged her new laptop into port 4 on day 5 and took it home that night. What should the shelter do about it?",
          options: [
            { id: 'keep', text: 'Keep the rule, and check each new device.', correct: true },
            { id: 'off', text: 'Turn off the rule for new devices on a switch port.', feedback: 'Replay with that rule off and look at the misses. The wired box on day 8 had no radio, so only the switch rule could see it.' },
            { id: 'ignore', text: 'Keep the rule, but ignore every alert from the switch.', feedback: 'An alert nobody reads is the same as no alarm.' },
            { id: 'ban', text: 'Ban volunteers from bringing their own laptops.', feedback: "That costs the shelter help, and the alarm still can't tell a rogue box from any other new device." },
          ],
          explain: 'Every alarm has a cost: someone has to check it. A rule that raises a few false alarms is worth keeping when it also catches real attacks. The wired box on day 8 showed up the same way the laptop did, as a new device on a switch port, and no air rule could hear it. Turning the rule off to stop the false alarms would miss the next box like it.',
        },
      ],
    },

    {
      id: 'recommend',
      title: 'Describe the impact',
      body: md`
        The shelter director wants your recommendation in writing. Pick the **detective controls** the shelter should run. A detective control finds a problem once it starts, so people can respond. It doesn't block the attack.

        Then describe the impact of your plan: the work it gives the staff and what it changes for the people there. Some facts to use:

        - The alarms only hear radios near the access points. A weekly sweep walks the whole building with a scanner, and it takes about 20 minutes.
        - With the alarms tuned, a normal week brings about 2 alerts. Looking at the alert list on a day with none takes almost no time. Reading and checking one alert takes about 5 minutes.
        - Some controls watch the air. Others watch what people do, and that costs them privacy.
      `,
      questions: [
        {
          id: 'controls',
          kind: 'choice',
          multi: true,
          prompt: 'Which detective controls should the shelter run?',
          options: [
            { id: 'sweep', text: 'A weekly scan of the air, compared with the approved list.', correct: true, missed: 'The alarms only hear radios near the access points. What covers the rest of the building?' },
            { id: 'rules', text: 'Alarms for unknown radios, lookalikes, and new devices on ports.', correct: true },
            { id: 'noise', text: 'A noise alarm set between movie night and the jammer.', correct: true },
            { id: 'review', text: 'Someone checks for alerts every day and notes what each was.', correct: true, missed: 'Who looks at the alerts once they appear?' },
            { id: 'low', text: 'A noise alarm at 10, so it catches even a small change.', feedback: 'It would raise an alert every movie night, and staff would learn to ignore it.' },
            { id: 'sites', text: 'A log of every website each family visits on the Wi-Fi.', feedback: 'That watches people, not the air. It costs families their privacy and would catch none of tonight\'s attacks.' },
            { id: 'off', text: 'Turn the Wi-Fi off each night so there is nothing to watch.', feedback: 'That is not detection, and families need the Wi-Fi at night.' },
          ],
          explain: "A good set of detective controls covers each attack you saw: an inventory and sweeps for rogue boxes, name and address rules for evil twins, a tuned noise alarm for jammers, and a person who reads the alerts. Controls that watch what people do cost a lot of privacy and wouldn't catch any of tonight's attacks. Even the alarms keep a little about people: which device joined and when.",
        },
        {
          id: 'impact',
          kind: 'text',
          prompt: "Describe the impact of your recommendation. Cover the staff time it takes each week, the false alarms it will raise, and what it means for families' privacy.",
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
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
  ],
};
