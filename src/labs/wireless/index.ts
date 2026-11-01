import type { Sim } from '../../sim/sim';
import { crack, reach, triangulate } from '../../sim/wifi';
import { capturedSince, happened, inspected, isPlainLogin } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef, MapZone } from '../types';
import { BSSID, buildShelter, FAMILIES, GYM, LOT, MAC, SPOTS, SSID, STRONG_PASS, LOGIN_BODY } from './scenario';

// --- Step actions ---

const familySignin: ActionDef = {
  id: 'family-signin',
  label: 'A family signs in',
  run: (sim) => sim.browse('phone1', 'http://checkin.example/login', LOGIN_BODY),
};

const copyMac: ActionDef = {
  id: 'mallory-copy-mac',
  label: "Mallory copies the Rivera phone's MAC",
  run: (sim) => sim.setMac('mallory', MAC.phone1),
};

// --- Setups (idempotent: safe to run again after a reset) ---

/** Mallory fits a high-gain antenna, so she can reach the shelter from the lot. */
function armMallory(sim: Sim): void {
  const m = sim.dev('mallory').wifiClient!;
  if (!m.antennaBoost) m.antennaBoost = 50;
  sim.recomputeWifi();
}

/** By the "who gets in" step the air is encrypted, and Mallory is a sheltering guest who was handed the key. */
function setupWhoJoins(sim: Sim): void {
  armMallory(sim);
  const ap = sim.dev('wap').wifi!;
  if (ap.security === 'open') {
    sim.setWifiSecurity('wap', 'wpa2', STRONG_PASS);
    sim.setWifiWps('wap', false);
  }
  sim.dev('mallory').wifiClient!.passphrase = ap.passphrase;
  sim.recomputeWifi();
}

// --- Goal helpers ---

const familiesInRange = (sim: Sim) => FAMILIES.every((f) => sim.dev(f).wifiClient?.joinedAp === 'wap');
const scannedFrom = (device: string) => (sim: Sim, since: number) =>
  happened(sim, since, (e) => e.type === 'wifi' && e.what === 'scan' && e.device === device);

export const wirelessLab: LabDef = {
  id: 'wireless',
  version: 1,
  title: 'Signals Past the Walls',
  tagline: "Secure an emergency shelter's Wi-Fi against snoopers in the parking lot, evil twins, and jammers.",
  unit: 3,
  codehs: ['3.7 Locking Down the Airwaves'],
  ced: ['3.1.B', '3.1.C', '3.2.A', '3.2.B', '3.5.E'],
  minutes: 50,
  objectives: [
    'Explain why a wireless signal reaches past the walls of a building.',
    'Compare open, WEP, WPA2, and WPA3, and the role of WPS and passphrase strength.',
    'Explain why MAC filtering is weaker than per-user authentication.',
    'Find a rogue access point and an evil twin, and recognize jamming.',
    'Write a wireless security policy for a shelter network.',
  ],
  build: buildShelter,
  captureDevice: 'mallory',
  labelMacs: true,
  clock: '14:00',
  map: {
    zones: (sim): MapZone[] => {
      const zones: MapZone[] = [
        { id: 'gym', shape: { kind: 'rect', ...GYM }, label: 'Gym shelter', tone: 'neutral' },
        { id: 'lot', shape: { kind: 'rect', ...LOT }, label: 'Parking lot', tone: 'bad' },
      ];
      const wap = sim.dev('wap').wifi;
      if (wap && !wap.off) zones.push({ id: 'reach', shape: { kind: 'circle', cx: sim.dev('wap').x, cy: sim.dev('wap').y, r: reach(wap) }, label: 'Wi-Fi reach', tone: 'info', dashed: true });
      const twin = sim.dev('twin');
      if (twin.wifi && !twin.wifi.off) zones.push({ id: 'twin', shape: { kind: 'circle', cx: twin.x, cy: twin.y, r: reach(twin.wifi) }, label: 'Evil twin', tone: 'bad', dashed: true });
      return zones;
    },
  },
  steps: [
    {
      id: 'tour',
      title: 'The shelter network',
      body: md`
        The storm knocked out power across Ridgeview, and the high school gym is now an emergency shelter. A satellite dish on the roof gives internet. You are the National Guard technician setting up Wi-Fi so families can reach relatives and fill out forms.

        The **access point** (the [[wap]]) is already on. It sends out **beacon frames** many times a second that announce its **SSID**, the network name, and how to join. Any device nearby can hear them.

        Right now the network is **open**: no password, no encryption, and the radio is turned up to its highest power.

        Click [[wap]] on the map and read its Wi-Fi settings.

        > Everything here is a simulation. The radio model is simplified: the signal just fades with distance, and walls don't block it. Real radio bounces, fades, and leaks in ways that are harder to predict.
      `,
      focus: ['wap', 'mallory'],
      open: { inspect: 'wap' },
      goals: [{ id: 'look', label: 'Open [[wap]] and read its Wi-Fi settings', check: inspected('wap') }],
      questions: [
        {
          id: 'reach',
          kind: 'choice',
          prompt: "The dashed circle shows how far the signal carries. It reaches into the parking lot. Why can [[mallory]]'s laptop out there hear the shelter network?",
          options: [
            { id: 'radio', text: "Radio waves pass through walls and keep going until they fade. The building doesn't stop them.", correct: true },
            { id: 'wire', text: 'A cable must run out to the lot.', feedback: 'Wi-Fi uses radio, not cables, to reach devices.' },
            { id: 'open', text: 'Only because the network is open.', feedback: 'A password would scramble the traffic, but the signal would still reach the lot.' },
            { id: 'power-only', text: "It can't. She must be inside.", feedback: 'Look at the map. Her car is in the lot, inside the circle.' },
          ],
          explain: 'A wireless signal spreads out in every direction and passes through walls. Turning on a password hides the contents, but the radio still reaches anyone in range.',
        },
      ],
    },

    {
      id: 'heard',
      title: 'What the car can hear',
      body: md`
        [[mallory]] is parked in the lot with a laptop. Play her for a moment to see what an open network gives away.

        1. In the **Toolkit**, run the **Wi-Fi scanner** from Mallory's spot. She sees the shelter's beacon: its name, that it is open, and a strong signal.
        2. Turn on **packet capture** for Mallory.
        3. Press **A family signs in**. The [[phone1]] sends a name and password to the check-in page over plain **HTTP**.
        4. Open the **Capture** tab and find the login.

        An open network floods every frame to everyone in range, so Mallory's card receives the family's traffic even though it wasn't meant for her.
      `,
      focus: ['mallory', 'wap', 'phone1'],
      open: 'tools',
      tools: [
        { kind: 'wifi-scan', devices: ['desk', 'mallory'] },
        { kind: 'sniffer', device: 'mallory' },
      ],
      actions: [familySignin],
      goals: [
        { id: 'scan', label: 'Scan the air from [[mallory]]', hint: 'Use the Wi-Fi scanner card and scan from Mallory.', check: ({ sim, since }) => scannedFrom('mallory')(sim, since) },
        { id: 'sniff', label: 'Turn on packet capture for [[mallory]]', check: ({ sim }) => sim.dev('mallory').sniffing },
        {
          id: 'caught',
          label: "Capture a family's login from the lot",
          hint: 'Turn capture on, then press **A family signs in**.',
          check: ({ sim, since }) => capturedSince(sim, 'mallory', since, isPlainLogin),
        },
      ],
      questions: [
        {
          id: 'walls',
          kind: 'choice',
          prompt: 'The families are inside the gym and Mallory is outside in a car. Why did that not keep her out of their traffic?',
          options: [
            { id: 'both', text: 'The signal reaches the lot, and an open network has no key, so she both hears it and can read it.', correct: true },
            { id: 'distance', text: 'She was too far to matter.', feedback: 'She still captured the password. Distance alone did not protect the family.' },
            { id: 'mac', text: 'Her laptop faked a MAC address.', feedback: 'She changed nothing. Open Wi-Fi simply hands every frame to everyone in range.' },
            { id: 'cable', text: 'She tapped a cable.', feedback: 'She used radio from the parking lot, not a cable.' },
          ],
          explain: 'Open Wi-Fi gives two gifts to an eavesdropper: the radio reaches well past the walls, and with no encryption the contents are in the clear.',
        },
      ],
    },

    {
      id: 'inside',
      title: 'Keep it inside',
      body: md`
        First, shrink the signal so it covers the gym but not the lot.

        Open [[wap]] and lower its **signal strength**. Watch the dashed circle on the map. You want every family device inside it and [[mallory]]'s car outside it.

        If you turn it down too far, a device at the far end of the gym (the [[phonelot]], near the lot-side wall) drops off. Find a level that covers the room and no more.
      `,
      focus: ['wap', 'phonelot', 'mallory'],
      open: { inspect: 'wap' },
      tools: [{ kind: 'wifi-config', device: 'wap' }],
      goals: [
        {
          id: 'inside',
          label: 'Cover every family device, but not the parking lot',
          hint: "Lower the WAP's signal strength. Keep all four shelter devices in range and push Mallory out.",
          check: ({ sim }) => familiesInRange(sim) && sim.dev('mallory').wifiClient?.joinedAp === undefined,
        },
      ],
      questions: [
        {
          id: 'antenna',
          kind: 'choice',
          prompt: 'You turned the power down and Mallory fell out of range. What could still let her reach the shelter network from the lot?',
          options: [
            { id: 'antenna', text: 'A high-gain or directional antenna that hears a weaker signal from farther away.', correct: true },
            { id: 'password', text: 'Guessing the password.', feedback: 'There is no password yet, and range is about the radio, not the key.' },
            { id: 'never', text: 'Nothing. Lower power makes it impossible.', feedback: 'A better antenna can pull in a faint signal. Range cuts both ways.' },
            { id: 'walls', text: 'Thicker walls.', feedback: 'Walls would reduce the signal, not help Mallory.' },
          ],
          explain: 'Turning down power is a good first step, but a determined attacker with a better antenna can still reach a faint signal. Lowering power raises the bar; it does not close the door.',
        },
      ],
    },

    {
      id: 'hide',
      title: 'Hide the name',
      body: md`
        Some people suggest hiding the network name so attackers can't find it. Try it: open [[wap]] and turn off **broadcasting the name**.

        Families already set up with the network can still join, because their phones remember it. But your scanner is the patient kind, and it still finds the network.
      `,
      focus: ['wap'],
      open: { inspect: 'wap' },
      goals: [{ id: 'hidden', label: 'Turn off beacon broadcasting on [[wap]]', check: ({ sim }) => sim.dev('wap').wifi?.beacon === false }],
      questions: [
        {
          id: 'weak',
          kind: 'choice',
          prompt: 'Why is hiding the network name weak protection on its own?',
          options: [
            { id: 'patient', text: "Devices still name the network when they look for it, and a patient scanner picks it up. It isn't encrypted; it's just quieter.", correct: true },
            { id: 'strong', text: 'It is strong protection and nothing else is needed.', feedback: 'A scanner found it anyway. Hiding the name is not encryption.' },
            { id: 'blocks', text: 'It blocks devices from joining.', feedback: 'Families still join a network they remember.' },
            { id: 'illegal', text: 'It is against the rules.', feedback: 'Hiding a name is allowed. The point is that it barely helps.' },
          ],
          explain: 'A hidden SSID stops only the most casual look. Phones broadcast the names they are searching for, and scanners catch the network in use. The CED rates it a low-value control for that reason.',
        },
      ],
    },

    {
      id: 'lock',
      title: 'Lock the air',
      body: md`
        Now encrypt the traffic so no one in range can read it. [[mallory]] has fitted a stronger antenna and is back in range, and she brought a cracker. Play her again to see which locks hold.

        Open [[wap]] and work through the choices. After each one, use the **Wi-Fi cracker** to see how long Mallory would need.

        - **WEP** is old and broken. It falls in under a minute.
        - **WPA2** with a short passphrase falls to guessing. With a long passphrase it holds.
        - **WPS** lets a device join with a short PIN that can be guessed, so it undoes a strong passphrase. Turn it off.
        - **WPA3** is the strongest.

        Leave the network with a lock Mallory cannot break: WPA3, or WPA2 with a long passphrase and WPS off.
      `,
      setup: armMallory,
      focus: ['wap', 'mallory'],
      open: 'tools',
      tools: [
        { kind: 'wifi-config', device: 'wap' },
        { kind: 'wifi-crack', attacker: 'mallory' },
      ],
      goals: [
        { id: 'tried', label: 'Try the cracker against the network at least once', hint: 'Set WEP first, then press Try to crack in the cracker card.', check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'wifi' && e.what === 'crack' && e.device === 'mallory') },
        {
          id: 'holds',
          label: 'Leave a lock Mallory cannot break, with every family still connected',
          hint: 'WPA3, or WPA2 with a long passphrase and WPS off. Families get the new key automatically.',
          check: ({ sim }) => {
            const ap = sim.dev('wap').wifi;
            return !!ap && !crack(ap).ok && familiesInRange(sim);
          },
        },
      ],
      questions: [
        {
          id: 'rank',
          kind: 'choice',
          prompt: 'Of these four, which gives the strongest protection for the shelter Wi-Fi?',
          options: [
            { id: 'wpa3', text: 'WPA3', correct: true },
            { id: 'wpa2', text: 'WPA2', feedback: 'WPA2 is strong with a long passphrase, but WPA3 resists guessing even better.' },
            { id: 'wep', text: 'WEP', feedback: 'WEP is broken. It falls in under a minute.' },
            { id: 'open', text: 'Open', feedback: 'Open has no encryption at all.' },
          ],
          explain: 'From weakest to strongest: Open, WEP, WPA, WPA2, WPA3. WPA3 is the current best. WPA2 with a long passphrase and WPS off is still a solid choice.',
        },
      ],
    },

    {
      id: 'who',
      title: 'Who gets in',
      body: md`
        The air is encrypted, but everyone shares one passphrase, and anyone sheltering here was handed it, including [[mallory]]. You want to limit who can actually join.

        First try a **MAC filter**: open [[wap]] and turn it on. Only the devices you list may join, so Mallory's laptop is turned away.

        Then press **Mallory copies the Rivera phone's MAC**. She read an allowed address out of the air and set her card to match it. Watch her get back on.

        A MAC address is easy to copy. Switch **who may join** to **per-user login (EAP)**: each family signs in to an authentication server with its own account. Now a copied MAC is not enough.
      `,
      setup: setupWhoJoins,
      focus: ['wap', 'mallory'],
      open: { inspect: 'wap' },
      tools: [{ kind: 'wifi-config', device: 'wap' }],
      actions: [copyMac],
      goals: [
        { id: 'eap', label: 'Switch [[wap]] to per-user login (EAP)', check: ({ sim }) => sim.dev('wap').wifi?.auth === 'eap' },
        {
          id: 'out',
          label: 'Keep Mallory out while the families stay connected',
          hint: 'With EAP on, Mallory has no account, so her copied MAC gets her nowhere.',
          check: ({ sim }) => sim.dev('mallory').wifiClient?.joinedAp === undefined && familiesInRange(sim),
        },
      ],
      questions: [
        {
          id: 'why-eap',
          kind: 'choice',
          prompt: 'Why does a per-user login stop Mallory when a MAC filter and a shared passphrase did not?',
          options: [
            { id: 'account', text: 'Each person has their own account to prove. Mallory can copy a MAC and knows the shared password, but she has no valid account.', correct: true },
            { id: 'faster', text: 'EAP is faster.', feedback: 'Speed is not the point. EAP checks who you are.' },
            { id: 'hides', text: 'EAP hides the network name.', feedback: 'That is beacon broadcasting, a different setting.' },
            { id: 'mac', text: 'EAP changes every device MAC.', feedback: 'EAP checks accounts, not hardware addresses.' },
          ],
          explain: 'A shared secret (a password or an allow-listed MAC) protects no one once it leaks or is copied. Per-user logins tie access to each person, and they can be revoked one at a time.',
        },
      ],
    },

    {
      id: 'rogue',
      title: 'A box in the hallway',
      body: md`
        A volunteer finds a small wireless router someone plugged into a **hallway wall jack**. It broadcasts its own open network, and because it is wired straight into the shelter LAN, anyone who joins it skips every setting you just configured. That is a **rogue access point**.

        1. Scan the air from the [[desk]]. You will see a network you never set up, marked as not yours.
        2. It is wired into the hallway jack. Shut that jack: in the Toolkit, use **Cables** to unplug the [[rogue]].
      `,
      setup: (sim) => sim.setWifiOff('rogue', false),
      focus: ['rogue', 'desk', 'lansw'],
      open: 'tools',
      tools: [
        { kind: 'wifi-scan', devices: ['desk', 'mallory'] },
        { kind: 'cable' },
      ],
      goals: [
        { id: 'spotted', label: 'Scan from the [[desk]] and find the network you did not set up', hint: 'Use the Wi-Fi scanner from the desk. The rogue is flagged "not yours".', check: ({ sim, since }) => scannedFrom('desk')(sim, since) },
        {
          id: 'removed',
          label: 'Cut the rogue box off the wired network',
          hint: 'Unplug the [[rogue]] with the Cables tool.',
          check: ({ sim }) => !Object.values(sim.links).some((l) => !l.wireless && (l.a.device === 'rogue' || l.b.device === 'rogue')),
        },
      ],
      questions: [
        {
          id: 'rogue-q',
          kind: 'choice',
          prompt: 'Why is a rogue access point plugged into a wall jack so dangerous?',
          options: [
            { id: 'bridge', text: 'It bridges an open, unsecured network straight onto the wired LAN, skipping the encryption and logins you set up.', correct: true },
            { id: 'power', text: 'It uses too much electricity.', feedback: 'The danger is the network back door, not the power draw.' },
            { id: 'slow', text: 'It slows the Wi-Fi down.', feedback: 'Speed is not the threat. The open back door into the LAN is.' },
            { id: 'name', text: 'It copies your network name.', feedback: "That is an evil twin. A rogue here uses its own name but wires into your LAN." },
          ],
          explain: 'Every control you built lives on your access point. A rogue box offers its own door into the same wired network and honors none of them. Finding and removing rogues is a core part of wireless defense.',
        },
      ],
    },

    {
      id: 'twin',
      title: 'The twin',
      body: md`
        Now [[mallory]] sets up her own radio in the lot and gives it the **same name** as yours, "${SSID}", with a stronger signal. A phone near the lot-side wall prefers the louder signal and joins **her** instead of you. That is an **evil twin**.

        A scan shows two radios answering to the same name. The real one is yours; the other is the twin. To find where the twin sits, measure its signal from three spots and let the math cross the circles.

        1. Scan from the [[desk]] and notice the duplicate name.
        2. Use **Signal triangulation**: pick the twin (the one whose radio address, the BSSID, you don't recognize) and take a reading from each of the three spots.
      `,
      setup: (sim) => sim.setWifiOff('twin', false),
      focus: ['twin', 'phonelot', 'desk'],
      open: 'tools',
      tools: [
        { kind: 'wifi-scan', devices: ['desk', 'mallory'] },
        { kind: 'triangulate', scanner: 'desk', spots: SPOTS },
      ],
      goals: [
        { id: 'scanned', label: 'Scan from the [[desk]] and spot the duplicate name', check: ({ sim, since }) => scannedFrom('desk')(sim, since) },
        {
          id: 'located',
          label: 'Triangulate the twin to the parking lot',
          hint: 'In the triangulation card, pick the twin and measure from all three spots.',
          check: ({ sim }) => {
            const loc = triangulate(sim.wifiReadings.filter((r) => r.bssid === BSSID.twin));
            return !!loc && loc.x >= LOT.x && loc.x <= LOT.x + LOT.w && loc.y >= LOT.y && loc.y <= LOT.y + LOT.h;
          },
        },
      ],
      questions: [
        {
          id: 'tell-apart',
          kind: 'choice',
          prompt: 'Two radios answer to the name "' + SSID + '". How do you tell the twin from your real access point?',
          options: [
            { id: 'bssid', text: 'They share a name but have different radio addresses (BSSIDs). The twin is the unfamiliar BSSID, and its signal is strongest out in the lot.', correct: true },
            { id: 'name', text: 'The names are spelled differently.', feedback: 'An evil twin copies the name exactly. You cannot tell them apart by name.' },
            { id: 'speed', text: 'The twin is always slower.', feedback: 'Speed is not a reliable tell, and the twin is often stronger.' },
            { id: 'channel', text: 'The twin uses no channel.', feedback: 'Both use a channel. The giveaways are the BSSID and where the signal is strongest.' },
          ],
          explain: 'Each radio has its own BSSID even when the SSID matches. A second BSSID for your network name, strongest from a place you did not put an access point, is the evil twin.',
        },
      ],
    },

    {
      id: 'jam',
      title: 'Nobody can connect',
      body: md`
        Suddenly every device near the desk drops off, and nothing can reconnect. [[mallory]] has switched on a **jammer**: a radio that blasts noise across the channel so no real signal gets through.

        Scan from the [[desk]]. Instead of networks, you see heavy noise on the channel.
      `,
      setup: (sim) => sim.setWifiJam('mallory', true, 6),
      focus: ['mallory', 'wap', 'desk'],
      open: 'tools',
      tools: [{ kind: 'wifi-scan', devices: ['desk', 'mallory'] }],
      goals: [
        {
          id: 'detected',
          label: 'Scan from the [[desk]] and find the noise',
          hint: 'Run the Wi-Fi scanner from the desk while the air is jammed.',
          check: ({ sim, since }) => scannedFrom('desk')(sim, since) && sim.jam.on,
        },
      ],
      questions: [
        {
          id: 'jam-q',
          kind: 'choice',
          prompt: 'No device can connect and the channel is full of noise. What is happening, and what do you do?',
          options: [
            { id: 'jam', text: "It's jamming: a radio is drowning out the channel. Locate the source (the same triangulation trick) and remove it, or get help.", correct: true },
            { id: 'broken', text: 'The access point is broken, so replace it.', feedback: 'A broken AP goes quiet. This channel is full of noise, which points to a jammer.' },
            { id: 'reboot', text: 'Reboot every phone.', feedback: 'The phones are fine. The air itself is being flooded with noise.' },
            { id: 'password', text: 'Change the Wi-Fi password.', feedback: 'A new password cannot cut through radio noise.' },
          ],
          explain: 'A broken access point falls silent; a jammer fills the air with noise. When no one can connect and a scan shows noise across the band, suspect jamming, find the source, and remove it.',
        },
      ],
    },

    {
      id: 'policy',
      title: 'The wireless policy',
      body: md`
        Write the shelter's **wireless security policy**: the rules every shelter Wi-Fi should follow from now on. Pick the ones that belong.
      `,
      questions: [
        {
          id: 'policy',
          kind: 'choice',
          multi: true,
          prompt: 'Which rules belong in the shelter wireless security policy?',
          options: [
            { id: 'eap', text: 'Require a per-user login (EAP) to an approved authentication server.', correct: true },
            { id: 'wpa', text: 'Use WPA2 or WPA3 with strong encryption and a minimum key length.', correct: true },
            { id: 'wps', text: 'Turn WPS off.', correct: true },
            { id: 'power', text: 'Keep the signal inside the building by limiting power.', correct: true },
            { id: 'open', text: 'Leave the network open so guests connect without fuss.', feedback: 'Open Wi-Fi hands every frame to everyone in range. That is what started this lab.' },
            { id: 'poster', text: 'Post one shared password on the wall for everyone.', feedback: 'A shared secret on a wall is no better than a copied MAC.' },
            { id: 'wps-on', text: 'Leave WPS on so people can join with a PIN.', feedback: 'The WPS PIN can be guessed; it undoes a strong passphrase.' },
          ],
          explain: 'A good wireless policy requires strong encryption, per-user authentication to an approved server, WPS off, and signal kept inside the space. Open networks and shared secrets do not belong in it.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        You started with an open network that leaked into the parking lot and ended with one that keeps families' traffic to themselves.

        In a few sentences, describe the shelter's final configuration. Name each setting you changed and the attack it stops.
      `,
      questions: [
        {
          id: 'summary',
          kind: 'text',
          prompt: "Describe the shelter Wi-Fi's final configuration. Name each setting you changed and the attack it stops.",
          minWords: 40,
          lines: 7,
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
