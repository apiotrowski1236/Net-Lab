import type { Sim } from '../../sim/sim';
import { crack, reach } from '../../sim/wifi';
import { capturedSince, happened, inspected, isPlainLogin, pageSince } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef, MapZone } from '../types';
import { buildShelter, FAMILIES, GYM, LOT, MAC, STRONG_PASS, LOGIN_BODY } from './scenario';

// --- Step actions ---

const familySignin: ActionDef = {
  id: 'family-signin',
  label: 'A family signs in',
  run: (sim) => sim.browse('phone1', 'http://checkin.example/login', LOGIN_BODY),
  outcome: (sim, since) => {
    if (capturedSince(sim, 'mallory', since, isPlainLogin)) return [{ tone: 'good', text: "Mallory's capture caught the login. Open the Capture tab to read it." }];
    if (!sim.dev('mallory').sniffing) return [{ tone: 'bad', text: "Packet capture isn't on, so Mallory missed it. Turn it on and press the button again." }];
    // Capture came on after the login went by: the page is done, and nothing was caught.
    if (pageSince(sim, 'phone1', since, (b) => b.doneAt !== undefined))
      return [{ tone: 'bad', text: 'Capture came on after the login went by, so Mallory missed it. Press the button again.' }];
    return [{ tone: 'wait', text: 'The Rivera phone is sending the login...' }];
  },
};

/** Mallory runs her Wi-Fi cracker against the shelter network. The result line reads the crack this press made. */
const tryCrack: ActionDef = {
  id: 'mallory-crack',
  label: 'Mallory tries to crack it',
  run: (sim) => sim.wifiCrack('mallory', 'wap'),
  outcome: (sim, since) => {
    const e = [...sim.events].reverse().find((x) => x.t >= since && x.type === 'wifi' && x.what === 'crack' && x.device === 'mallory');
    if (!e || e.type !== 'wifi') return [{ tone: 'wait', text: 'Mallory is trying to break in...' }];
    if (e.ok) return [{ tone: 'bad', text: `Broken: ${e.detail}.` }];
    // Mallory's guessing tool can't beat a long WPA passphrase, but the original WPA has other known flaws.
    if (sim.dev('wap').wifi?.security === 'wpa')
      return [{ tone: 'wait', text: `Mallory's guesses failed (${e.detail}), but the original WPA has other known flaws. Pick WPA2 or WPA3.` }];
    return [{ tone: 'good', text: `Held: ${e.detail}.` }];
  },
};

const copyMac: ActionDef = {
  id: 'mallory-copy-mac',
  label: "Mallory copies the Rivera phone's MAC",
  // She copies a MAC only once the filter stands in her way, so students see the filter block her first.
  run: (sim) => {
    if (sim.dev('wap').wifi?.macFilter?.on) sim.setMac('mallory', MAC.phone1);
  },
  outcome: (sim) => {
    const ap = sim.dev('wap').wifi!;
    const on = sim.dev('mallory').wifiClient?.joinedAp === 'wap';
    if (sim.dev('mallory').ifaces[0].mac !== MAC.phone1)
      return ap.macFilter?.on
        ? [{ tone: 'wait', text: "The filter turned Mallory away. Press the button again, and she copies the Rivera phone's MAC." }]
        : [{ tone: 'wait', text: 'Nothing stops Mallory yet, so she has no reason to copy a MAC. Turn on the MAC filter first, then press the button again.' }];
    if (ap.auth === 'eap') return [{ tone: 'good', text: "Mallory uses the Rivera phone's MAC, but she has no login of her own, so she stays off." }];
    return on
      ? [{ tone: 'good', text: "Mallory is back on. The filter sees the Rivera phone's MAC and lets her in." }]
      : [{ tone: 'wait', text: 'Mallory is trying to join again with the copied MAC.' }];
  },
};

// --- Setups (idempotent: safe to run again after a reset) ---

/** Mallory fits a high-gain antenna, so she can reach the shelter from the lot. */
function armMallory(sim: Sim): void {
  const m = sim.dev('mallory').wifiClient!;
  if (!m.antennaBoost) m.antennaBoost = 50;
  sim.recomputeWifi();
}

/** By the "who gets in" step the air is encrypted, and Mallory checked in as a guest, so the desk handed her the key. */
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

/**
 * A scan from Mallory after the name was hidden (and it is still hidden). A name hidden before the
 * step began, say while exploring step 3, counts from the step's start. "After" goes by place in the
 * event list, not time, so a scan made at the same moment but before the hide (while paused) doesn't count.
 */
function scannedHidden(sim: Sim, since: number): boolean {
  if (sim.dev('wap').wifi?.beacon !== false) return false;
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i];
    if (e.t < since) return false;
    if (e.type === 'config' && e.what === 'wifi-beacon' && e.device === 'wap') return false;
    if (e.type === 'wifi' && e.what === 'scan' && e.device === 'mallory') return true;
  }
  return false;
}

export const wirelessLab: LabDef = {
  id: 'wireless',
  version: 5,
  title: 'Wireless Security',
  tagline: "Secure an emergency shelter's Wi-Fi against snoopers in the parking lot and a rogue box on a wall jack.",
  unit: 3,
  codehs: ['3.7 Locking Down the Airwaves'],
  ced: ['3.1.B', '3.1.C', '3.2.A', '3.2.B'],
  minutes: 50,
  objectives: [
    'Explain why a wireless signal reaches past the walls of a building.',
    'Compare open, WEP, WPA2, and WPA3, and the role of WPS and passphrase strength.',
    'Explain why MAC filtering is weaker than per-user authentication.',
    'Find a rogue access point with a Wi-Fi scan and cut it off the network.',
    'Write a wireless security policy for a shelter network.',
  ],
  build: buildShelter,
  captureDevice: 'mallory',
  labelMacs: true,
  // The inspector's port, address, and MAC tables have nothing to do with this lab, and their "Cable goes to" column reads Wi-Fi as a cable.
  deviceTables: false,
  clock: '14:00',
  map: {
    zones: (sim): MapZone[] => {
      const zones: MapZone[] = [
        { id: 'gym', shape: { kind: 'rect', ...GYM }, label: 'Gym shelter', tone: 'neutral' },
        { id: 'lot', shape: { kind: 'rect', ...LOT }, label: 'Parking lot', tone: 'bad' },
      ];
      const wap = sim.dev('wap').wifi;
      // The reach circle runs off the map's edge rather than shrinking the map, and changing the power doesn't re-zoom it.
      if (wap && !wap.off) zones.push({ id: 'reach', shape: { kind: 'circle', cx: sim.dev('wap').x, cy: sim.dev('wap').y, r: reach(wap) }, label: 'Wi-Fi reach', tone: 'info', dashed: true, fit: false });
      return zones;
    },
  },
  steps: [
    {
      id: 'tour',
      title: 'The shelter network',
      body: md`
        The storm knocked out power across Ridgeview, and the high school gym is now an emergency shelter. A satellite dish on the roof gives internet. You are the National Guard technician setting up Wi-Fi so families can reach relatives and fill out forms.

        The **access point** (the [[wap]]) is already on. Many times a second it sends **beacon frames**: short radio messages that announce its **SSID** (the network name) and how to join. Any device nearby can hear them.

        Right now the network is **open**: no password and no encryption. The radio is turned up high.

        Click [[wap]] and read its Wi-Fi settings. Most of them come up later in the lab. For now, find the network name and the word **Open**. The dashed circle on the map shows how far its signal carries.

        > Everything here is a simulation. In it, the signal fades only with distance. Real walls weaken a signal, sometimes a lot, but they rarely stop it.
      `,
      focus: ['wap', 'mallory'],
      goals: [{ id: 'look', label: 'Open [[wap]] and read its Wi-Fi settings', check: inspected('wap') }],
      questions: [
        {
          id: 'reach',
          kind: 'choice',
          prompt: "The dashed circle reaches into the parking lot. Why can [[mallory]]'s laptop out there hear the shelter network?",
          options: [
            { id: 'radio', text: 'Radio passes through walls and keeps going until it fades.', correct: true },
            { id: 'wire', text: 'A network cable runs from the gym out to her car.', feedback: 'Wi-Fi uses radio, not cables, to reach devices.' },
            { id: 'open', text: 'The network is open, so the signal goes farther.', feedback: 'A password would scramble the traffic, but the signal would still reach the lot.' },
            { id: 'power-only', text: "She can't hear it, so she must be inside the gym.", feedback: 'Look at the map. Her car is in the lot, inside the circle.' },
          ],
          explain: 'A wireless signal spreads out in every direction and passes through walls. A password hides what the traffic says, but the radio still reaches anyone in range.',
        },
      ],
    },

    {
      id: 'heard',
      title: 'What the car can hear',
      body: md`
        [[mallory]] is parked in the lot with a laptop. In this step you act as Mallory, to see what an open network gives away.

        1. In the **Toolkit**, the **Wi-Fi scanner** is set to Mallory. Press **Scan from Mallory**. She hears the shelter's beacon: its name, that it is open, and a signal weaker than inside the gym but strong enough to use.
        2. Turn on **packet capture** for Mallory.
        3. Press **A family signs in**. The [[phone1]] sends a name and password to the check-in page over plain **HTTP**, which is not encrypted.
        4. Open the **Capture** tab and find the login.

        Every Wi-Fi frame reaches every device in range. On an open network nothing is encrypted, so Mallory can read the family's frames even though they weren't sent to her.

        Some pages use **HTTPS**, the encrypted version of HTTP. HTTPS scrambles what a page says, but each frame still shows which website it is going to.
      `,
      focus: ['mallory', 'wap', 'phone1'],
      open: 'tools',
      tools: [
        { kind: 'wifi-scan', devices: ['mallory', 'desk'] },
        { kind: 'sniffer', device: 'mallory' },
      ],
      actions: [familySignin],
      goals: [
        { id: 'scan', label: 'Scan the air from [[mallory]]', hint: 'In the Wi-Fi scanner card, press **Scan from Mallory**.', check: ({ sim, since }) => scannedFrom('mallory')(sim, since) },
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
          id: 'https-q',
          kind: 'choice',
          prompt: 'Suppose the check-in page used HTTPS, but the Wi-Fi stayed open. What could Mallory read then?',
          options: [
            { id: 'site', text: 'Which website the phone visited, but not the password.', correct: true },
            { id: 'pass', text: 'The password, because the Wi-Fi is still open.', feedback: 'HTTPS scrambles the page between the phone and the website, so the password is unreadable even on open Wi-Fi.' },
            { id: 'nothing', text: 'Nothing at all, not even which website it was.', feedback: 'HTTPS hides what the page says. The frames still show which website they are going to.' },
            { id: 'join', text: 'The password, but only after she joins the network.', feedback: 'Joining does not help her. HTTPS keeps the password scrambled the whole way to the website.' },
          ],
          explain: 'On open Wi-Fi, anything a page does not encrypt itself can be read from the air. HTTPS protects what a page says, but not where it goes. Encrypting the Wi-Fi itself, later in this lab, covers everything in the air between the phone and the access point.',
        },
      ],
    },

    {
      id: 'inside',
      title: 'Keep it inside',
      body: md`
        Shrink the signal so it covers the gym but not the lot.

        Open [[wap]] and lower its **Signal strength**. Watch the dashed circle on the map. You want every family device inside it and [[mallory]]'s car outside it.

        If you turn it down too far, some family devices, like the [[phonelot]], drop off. If that happens, turn it back up one level.

        Mallory's laptop has an ordinary Wi-Fi card. An attacker can also buy a **high-gain antenna**, a bigger antenna that picks up fainter signals from farther away.
      `,
      focus: ['wap', 'phonelot', 'mallory'],
      open: { inspect: 'wap' },
      tools: [{ kind: 'wifi-config', device: 'wap' }],
      goals: [
        {
          id: 'inside',
          label: 'Cover every family device, but not the parking lot',
          hint: "Lower the access point's signal strength. Keep all four shelter devices in range and push Mallory out.",
          check: ({ sim }) => familiesInRange(sim) && sim.dev('mallory').wifiClient?.joinedAp === undefined,
        },
      ],
      questions: [
        {
          id: 'antenna',
          kind: 'choice',
          prompt: 'You turned the signal strength down, and Mallory can no longer join. What could still let her reach the shelter network from the lot?',
          options: [
            { id: 'antenna', text: 'A high-gain antenna on her laptop.', correct: true },
            { id: 'off', text: 'Turning her own Wi-Fi off and on again.', feedback: 'Restarting her Wi-Fi card does not make it hear a fainter signal.' },
            { id: 'never', text: 'Nothing. A weaker signal makes it impossible.', feedback: 'A better antenna can pull in a faint signal. A weaker signal helps, but it is not a wall.' },
            { id: 'walls', text: 'Parking behind a thick wall of the gym.', feedback: 'A wall between her and the access point weakens the signal. It would not help her hear it.' },
          ],
          explain: 'Turning down the signal strength is a good first step, and it belongs in the plan. Still, a determined attacker with a better antenna can pick up a faint signal, so it makes an attack harder but does not stop it.',
        },
      ],
    },

    {
      id: 'hide',
      title: 'Hide the name',
      body: md`
        Some people hide the network name so attackers can't find it. Try it.

        1. Open [[wap]] and turn **Broadcast the name** off. Families still join, because their phones remember the network.
        2. In the Toolkit, scan from [[mallory]] again, and read the row for the shelter network.

        The dashed circle shows where a device can join. A scanner also hears weaker signals outside it, so Mallory's scan still picks up the shelter, even though she can't join.
      `,
      focus: ['wap', 'mallory'],
      open: { inspect: 'wap' },
      tools: [{ kind: 'wifi-config', device: 'wap' }, { kind: 'wifi-scan', devices: ['mallory', 'desk'] }],
      goals: [
        { id: 'hidden', label: 'Hide the network name on [[wap]]', check: ({ sim }) => sim.dev('wap').wifi?.beacon === false },
        { id: 'rescan', label: 'Scan from [[mallory]] after the name is hidden', hint: 'Open the Toolkit and press **Scan from Mallory**.', check: ({ sim, since }) => scannedHidden(sim, since) },
      ],
      questions: [
        {
          id: 'weak',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Why is hiding the network name weak protection on its own?',
          options: [
            { id: 'patient', text: 'Phones ask for the network by name, and a scanner hears them.', correct: true },
            { id: 'strong', text: 'It is strong protection, and nothing else is needed.', feedback: 'The scanner found it anyway. Hiding the name is not encryption.' },
            { id: 'blocks', text: 'It stops the families from joining the network.', feedback: 'Families still join a network they remember.' },
            { id: 'illegal', text: 'Hiding a network name breaks the law.', feedback: 'Hiding a name is allowed. The point is that it barely helps.' },
          ],
          explain: 'A hidden name stops only a casual look. Phones that know the network ask for it by name, and a scanner picks that up. Hiding the name is not encryption, so it is worth very little alone.',
        },
      ],
    },

    {
      id: 'lock',
      title: 'Lock the air',
      body: md`
        Now encrypt the traffic. Mallory added a high-gain antenna and is back in range. She also has a **Wi-Fi cracker**, a tool that tries to break a network's passphrase.

        For each setting, open [[wap]], pick it under **Security**, type a passphrase, and press **Save**. Families can't join until a passphrase is saved, and each new one you save reaches them on their own. Then press **Mallory tries to crack it** here.

        1. **WEP**, with a short passphrase like \`shelter1\`. WEP is an old, broken lock.
        2. **WPA2** with a different short passphrase, like \`shelter2\`. Mallory learned the WEP one when she broke in, so it has to be new.
        3. **WPA2** with a long passphrase nobody could guess, like four words that have nothing to do with each other. **WPS** is still on. WPS lets a device join with an 8-digit PIN instead of the passphrase.
        4. Turn **WPS** off and crack again.
        5. The PIN gave Mallory your passphrase, so she still gets in. Save a new long passphrase and crack once more.

        Leave the network with a lock Mallory cannot break, using a passphrase that isn't a common password: **WPA3** (the newest: an attacker cannot test guesses against a recording of a device joining), or WPA2 with a long passphrase. Either way, WPS must be off.
      `,
      setup: armMallory,
      focus: ['wap', 'mallory'],
      open: { inspect: 'wap' },
      tools: [{ kind: 'wifi-config', device: 'wap' }],
      actions: [tryCrack],
      goals: [
        { id: 'tried', label: 'Try the cracker against the network at least once', hint: 'Set WEP first, then press **Mallory tries to crack it**.', check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'wifi' && e.what === 'crack' && e.device === 'mallory') },
        {
          id: 'holds',
          label: 'Leave a lock Mallory cannot break, with every family still connected',
          hint: 'WPA3, or WPA2 with a long passphrase, and WPS off either way. If Mallory broke in before, save a new passphrase. Families get it automatically.',
          check: ({ sim }) => {
            const ap = sim.dev('wap').wifi;
            // The first WPA counts as weak here, as the lesson teaches, even where the cracker can't break it.
            const modern = ap?.security === 'wpa2' || ap?.security === 'wpa3';
            return !!ap && modern && !crack(ap, sim.dev('mallory').wifiClient?.passphrase).ok && familiesInRange(sim);
          },
        },
      ],
      questions: [
        {
          id: 'wps-q',
          kind: 'choice',
          afterGoals: true,
          prompt: 'WPA2 with a long passphrase, but WPS still on: what did the cracker do?',
          options: [
            { id: 'pin', text: 'It broke in by guessing the WPS PIN.', correct: true },
            { id: 'held', text: 'It held, because the passphrase is long.', feedback: 'WPS skips the passphrase. A device that has the PIN gets the passphrase handed to it, and a short PIN can be guessed.' },
            { id: 'wpa2', text: 'It broke the WPA2 encryption itself.', feedback: 'WPA2 with a long passphrase holds. The cracker went around it, through the WPS PIN.' },
            { id: 'open', text: 'It turned the network back to open.', feedback: 'The cracker changes nothing on the access point. It only tries to get the key.' },
          ],
          explain: 'From weakest to strongest: open, WEP, WPA (the first version, also weak), WPA2, WPA3. WPA2 needs a long passphrase that is hard to guess. WPS undoes any passphrase, so it stays off, and once the PIN is guessed the attacker has the passphrase, so it has to change too.',
        },
      ],
    },

    {
      id: 'who',
      title: 'Who gets in',
      body: md`
        Mallory checks in at the shelter desk as a visitor, and the desk hands her the new passphrase like everyone else. Then she goes back to her car. Everyone shares one passphrase, so you need another way to limit who can join.

        Every network card has a **MAC address**, a hardware address like \`0a:21:fa:00:00:11\` that it sends in every frame.

        1. Open [[wap]] and turn on the **MAC filter**. Only the families' devices may join, so Mallory's laptop is turned away.
        2. Press **Mallory copies the Rivera phone's MAC**. She read an allowed address out of the air and set her card to it. Watch her get back on.
        3. Switch **Who may join** to **Per-user login (EAP)**. Each family signs in to an **authentication server** (a computer that checks accounts) with its own account. The desk makes accounts only for families staying at the shelter, so Mallory, a visitor, has none.
      `,
      setup: setupWhoJoins,
      focus: ['wap', 'mallory'],
      open: { inspect: 'wap' },
      tools: [{ kind: 'wifi-config', device: 'wap' }],
      actions: [copyMac],
      goals: [
        { id: 'filter', label: 'Turn on the MAC filter on [[wap]]', check: ({ sim }) => !!sim.dev('wap').wifi?.macFilter?.on },
        {
          id: 'copied',
          label: 'See Mallory get past the MAC filter with a copied MAC',
          hint: "With the MAC filter on and **Who may join** set to **Shared passphrase**, press **Mallory copies the Rivera phone's MAC**.",
          check: ({ sim }) => {
            const ap = sim.dev('wap').wifi;
            return !!ap?.macFilter?.on && ap.auth === 'psk' && sim.dev('mallory').ifaces[0].mac === MAC.phone1 && sim.dev('mallory').wifiClient?.joinedAp === 'wap';
          },
        },
        {
          id: 'out',
          label: 'Switch to per-user login (EAP), so Mallory is off and the families stay on',
          hint: 'Set **Who may join** to **Per-user login (EAP)**. Mallory has no account, so her copied MAC gets her nowhere.',
          check: ({ sim }) => sim.dev('wap').wifi?.auth === 'eap' && sim.dev('mallory').wifiClient?.joinedAp === undefined && familiesInRange(sim),
        },
      ],
      questions: [
        {
          id: 'why-eap',
          kind: 'choice',
          prompt: 'Why does a per-user login stop Mallory when a MAC filter and a shared passphrase did not?',
          options: [
            { id: 'account', text: 'She has the passphrase and a copied MAC, but no account.', correct: true },
            { id: 'faster', text: 'EAP checks devices faster than a MAC filter does.', feedback: 'Speed is not the point. EAP checks who you are.' },
            { id: 'hides', text: 'EAP hides the network name from her scanner.', feedback: 'That is the Broadcast the name setting, a different one.' },
            { id: 'mac', text: 'EAP gives every device a new MAC address.', feedback: 'EAP checks accounts, not hardware addresses.' },
          ],
          explain: 'A shared secret (a password or an allowed MAC) protects no one once it leaks or is copied. Per-user logins tie access to each person, and the shelter can turn off one account without changing anyone else.',
        },
      ],
    },

    {
      id: 'rogue',
      title: 'A box in the hallway',
      body: md`
        A volunteer finds a small wireless router, the [[rogue]], plugged into a **hallway wall jack**. The jack's cable runs to port 2 in the [[lansw]], part of the shelter's wired network, the **LAN** (local area network).

        The box sends out its own open network. Anyone who joins it lands on the LAN and skips every setting you configured. A box like this, set up by someone who isn't in charge of the network, is a **rogue access point**.

        1. Scan the air from the [[desk]]. You will see a network you never set up, marked **not yours**.
        2. In the Toolkit, use **Cables** to unplug the Unknown box's cable. Leave the Shelter Wi-Fi's cable alone.
      `,
      setup: (sim) => sim.setWifiOff('rogue', false),
      focus: ['rogue', 'desk', 'lansw'],
      open: 'tools',
      tools: [
        { kind: 'wifi-scan', devices: ['desk', 'mallory'] },
        { kind: 'cable', refuse: [{ between: ['mallory', '*'], text: 'Mallory is out in the parking lot. There is no jack out there to plug into.' }] },
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
            { id: 'bridge', text: 'It is an open door onto the LAN that skips your settings.', correct: true },
            { id: 'power', text: 'It draws too much power from the wall jack.', feedback: 'The danger is the back door into the network, not the power it uses.' },
            { id: 'slow', text: 'It makes the shelter Wi-Fi slower for families.', feedback: 'Speed is not the threat. The open back door into the LAN is.' },
            { id: 'name', text: 'It copies the shelter network name to trick phones.', feedback: 'That would be an evil twin, a fake network that copies a real name. This rogue uses its own name but is wired into your LAN.' },
          ],
          explain: 'Every control you built lives on your access point. A rogue box offers its own door into the same wired network and follows none of them. Finding and removing rogues is a core part of wireless defense.',
        },
      ],
    },

    {
      id: 'policy',
      title: 'The wireless policy',
      body: md`
        Write the shelter's **wireless security policy**: the rules every shelter Wi-Fi follows from now on. Pick the ones that belong.
      `,
      questions: [
        {
          id: 'policy2',
          kind: 'choice',
          multi: true,
          prompt: 'Which rules belong in the shelter wireless security policy?',
          options: [
            { id: 'eap', text: 'Require a per-user login (EAP) to an approved authentication server.', correct: true },
            { id: 'wpa', text: 'Encrypt with WPA3 or WPA2, never open, WEP, or the first WPA.', correct: true },
            { id: 'wps', text: 'Turn WPS off.', correct: true },
            { id: 'power', text: 'Turn the signal down so it covers the building and little more.', correct: true },
            { id: 'rogue', text: 'Scan for access points nobody set up, and unplug them.', correct: true },
            { id: 'hide', text: 'Hide the network name, so attackers cannot find it.', feedback: 'Hiding the name does not keep attackers out, because a scanner still finds a hidden network.' },
            { id: 'open', text: 'Leave the network open so guests can join without a password.', feedback: 'Open Wi-Fi lets everyone in range read the traffic. That is what started this lab.' },
            { id: 'poster', text: 'Post one shared password on the wall for everyone.', feedback: 'A shared secret on a wall is no better than a copied MAC.' },
          ],
          explain: 'A good wireless policy requires strong encryption, per-user logins to an approved server, WPS off, a signal kept inside the building, and regular scans for rogue access points. A weaker signal does not stop a high-gain antenna, but it shrinks the area an attacker can work from. Open networks, shared secrets, and a hidden name as the only protection do not belong.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        You started with an open network that anyone in the parking lot could read, and ended with one that strangers cannot join.

        Wi-Fi encryption protects the trip between a device and the access point. Past the access point, the check-in page still uses plain HTTP, so the shelter should move it to HTTPS too.
      `,
      questions: [
        {
          id: 'summary',
          kind: 'text',
          prompt: 'Describe the shelter Wi-Fi settings you ended with. Name each setting you changed and the attack it stops.',
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
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.

        > **Next: keeping watch.** A rogue box can show up long after setup is done. Two weeks later, in the Wireless Intrusion Detection lab, you keep watch over this shelter. You catch a lookalike network and a jammer, then choose the alarms that catch the next one.
      `,
    },
  ],
};
