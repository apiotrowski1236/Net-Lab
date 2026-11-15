import type { Sim } from '../../sim/sim';
import { crack, reach } from '../../sim/wifi';
import { capturedSince, happened, inspected, isPlainLogin } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef, MapZone } from '../types';
import { buildShelter, FAMILIES, GYM, LOT, MAC, STRONG_PASS, LOGIN_BODY } from './scenario';

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
  outcome: (sim) => {
    const ap = sim.dev('wap').wifi!;
    const on = sim.dev('mallory').wifiClient?.joinedAp === 'wap';
    if (ap.auth === 'eap') return [{ tone: 'good', text: "Mallory uses the Rivera phone's MAC, but she has no login of her own, so she stays off." }];
    if (!ap.macFilter?.on) return [{ tone: 'wait', text: "Mallory now uses the Rivera phone's MAC. Turn on the MAC filter to see why that matters." }];
    return on
      ? [{ tone: 'bad', text: "Mallory is back on. The filter sees the Rivera phone's MAC and lets her in." }]
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

/** A scan from Mallory after the name was hidden (and it is still hidden). */
function scannedHidden(sim: Sim, since: number): boolean {
  if (sim.dev('wap').wifi?.beacon !== false) return false;
  let hidAt = -1;
  for (const e of sim.events) {
    if (e.t < since) continue;
    if (e.type === 'config' && e.what === 'wifi-beacon' && e.device === 'wap' && !e.on) hidAt = e.t;
    else if (hidAt >= 0 && e.t >= hidAt && e.type === 'wifi' && e.what === 'scan' && e.device === 'mallory') return true;
  }
  return false;
}

export const wirelessLab: LabDef = {
  id: 'wireless',
  version: 3,
  title: 'Wireless Security',
  tagline: "Secure an emergency shelter's Wi-Fi against snoopers in the parking lot and a rogue box on a wall jack.",
  unit: 3,
  codehs: ['3.7 Locking Down the Airwaves'],
  ced: ['3.1.B', '3.1.C', '3.2.A', '3.2.B'],
  minutes: 45,
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
  clock: '14:00',
  map: {
    zones: (sim): MapZone[] => {
      const zones: MapZone[] = [
        { id: 'gym', shape: { kind: 'rect', ...GYM }, label: 'Gym shelter', tone: 'neutral' },
        { id: 'lot', shape: { kind: 'rect', ...LOT }, label: 'Parking lot', tone: 'bad' },
      ];
      const wap = sim.dev('wap').wifi;
      if (wap && !wap.off) zones.push({ id: 'reach', shape: { kind: 'circle', cx: sim.dev('wap').x, cy: sim.dev('wap').y, r: reach(wap) }, label: 'Wi-Fi reach', tone: 'info', dashed: true });
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

        Click [[wap]] and read its Wi-Fi settings. The dashed circle on the map shows how far its signal carries.

        > Everything here is a simulation. In it, the signal fades only with distance. Real walls weaken a signal a little, but they don't stop it.
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
          id: 'clear',
          kind: 'choice',
          prompt: 'Mallory read the password without joining the network or breaking anything. What made that possible?',
          options: [
            { id: 'clear', text: 'Nothing was encrypted: open Wi-Fi and a plain HTTP page.', correct: true },
            { id: 'guess', text: 'She guessed the family password from their last name.', feedback: 'She guessed nothing. The password was in the captured frame, word for word.' },
            { id: 'screen', text: "She could see the phone's screen from her car.", feedback: 'She is outside the gym. She read the password from a captured frame, not from a screen.' },
            { id: 'asked', text: 'The access point sent her a copy because she asked.', feedback: 'She asked for nothing. Radio reaches every device in range, and her card kept what it heard.' },
          ],
          explain: 'Open Wi-Fi helps an eavesdropper (someone listening in) twice: the radio reaches past the walls, and with no encryption anyone who hears a frame can read it.',
        },
      ],
    },

    {
      id: 'inside',
      title: 'Keep it inside',
      body: md`
        Shrink the signal so it covers the gym but not the lot.

        Open [[wap]] and lower its **Signal strength**. Watch the dashed circle on the map. You want every family device inside it and [[mallory]]'s car outside it.

        If you turn it down too far, the [[phonelot]] at the far end of the gym drops off. If that happens, turn it back up one level.

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
          prompt: 'You turned the power down and Mallory fell out of range. What could still let her reach the shelter network from the lot?',
          options: [
            { id: 'antenna', text: 'A high-gain antenna on her laptop.', correct: true },
            { id: 'off', text: 'Turning her own Wi-Fi off and on again.', feedback: 'Restarting her Wi-Fi card does not make it hear a fainter signal.' },
            { id: 'never', text: 'Nothing. Lower power makes it impossible.', feedback: 'A better antenna can pull in a faint signal. Lower power helps, but it is not a wall.' },
            { id: 'walls', text: 'Moving her car closer to a thick wall.', feedback: 'Walls weaken a signal a little. They would not help her hear it.' },
          ],
          explain: 'Turning down power is a good first step, and it belongs in the plan. Still, a determined attacker with a better antenna can pick up a faint signal, so it makes an attack harder but does not stop it.',
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
          explain: 'A hidden name stops only a casual look. Phones that know the network ask for it by name, and a scanner picks that up. Hiding the name is quieter, but it is not encryption, so it is worth very little alone.',
        },
      ],
    },

    {
      id: 'lock',
      title: 'Lock the air',
      body: md`
        Now encrypt the traffic. Mallory has fitted a high-gain antenna and is back in range, and she brought a **Wi-Fi cracker**: a tool that tries to break a network's password.

        For each setting, open [[wap]], pick it under **Security**, type a passphrase, and press **Save**. Then press **Try to crack** in the cracker card in the Toolkit.

        1. **WEP**, with any passphrase. WEP is an old, broken lock.
        2. **WPA2** with a short passphrase, like \`shelter1\`.
        3. **WPA2** with a long passphrase nobody could guess, like four words that have nothing to do with each other. **WPS** is still on. WPS lets a device join with an 8-digit PIN instead of the passphrase.
        4. Turn **WPS** off and crack again.

        Leave the network with a lock Mallory cannot break: WPA3, or WPA2 with a long passphrase. Either way, WPS must be off.
      `,
      setup: armMallory,
      focus: ['wap', 'mallory'],
      open: 'tools',
      tools: [
        { kind: 'wifi-config', device: 'wap' },
        { kind: 'wifi-crack', attacker: 'mallory' },
      ],
      goals: [
        { id: 'tried', label: 'Try the cracker against the network at least once', hint: 'Set WEP first, then press **Try to crack** in the cracker card.', check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'wifi' && e.what === 'crack' && e.device === 'mallory') },
        {
          id: 'holds',
          label: 'Leave a lock Mallory cannot break, with every family still connected',
          hint: 'WPA3, or WPA2 with a long passphrase, and WPS off either way. Families get the new key automatically.',
          check: ({ sim }) => {
            const ap = sim.dev('wap').wifi;
            return !!ap && !crack(ap).ok && familiesInRange(sim);
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
          explain: 'From weakest to strongest: open, WEP, WPA (the first version, also broken), WPA2, WPA3. WPA2 needs a long passphrase that is hard to guess. WPS undoes any passphrase, so it stays off.',
        },
      ],
    },

    {
      id: 'who',
      title: 'Who gets in',
      body: md`
        Mallory came inside to shelter for the night, and the desk gave her the passphrase like every other guest. Everyone shares one passphrase, so you need another way to limit who can join.

        Every network card has a **MAC address**, a hardware address like \`0a:21:fa:00:00:11\` that it sends in every frame.

        1. Open [[wap]] and turn on the **MAC filter**. Only the families' devices may join, so Mallory's laptop is turned away.
        2. Press **Mallory copies the Rivera phone's MAC**. She read an allowed address out of the air and set her card to it. Watch her get back on.
        3. Switch **Who may join** to **Per-user login (EAP)**. Each family signs in to an **authentication server** (a computer that checks accounts) with its own account. A copied MAC is not enough now.
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
        A volunteer finds a small wireless router plugged into a **hallway wall jack**. The jack is wired to the shelter's wired network, the **LAN** (local area network). The box sends out its own open network, so anyone who joins it lands on the LAN and skips every setting you configured. A box like this, set up by someone who isn't in charge of the network, is a **rogue access point**.

        1. Scan the air from the [[desk]]. You will see a network you never set up, marked **not yours**.
        2. In the Toolkit, use **Cables** to unplug the cable from the [[rogue]]. Leave the Shelter Wi-Fi's cable alone.
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
            { id: 'bridge', text: 'It is an open door onto the LAN that skips your settings.', correct: true },
            { id: 'power', text: 'It draws too much power from the wall jack.', feedback: 'The danger is the back door into the network, not the power it uses.' },
            { id: 'slow', text: 'It makes the shelter Wi-Fi slower for families.', feedback: 'Speed is not the threat. The open back door into the LAN is.' },
            { id: 'name', text: 'It copies the shelter network name to trick phones.', feedback: 'That is an evil twin. This rogue uses its own name but is wired into your LAN.' },
          ],
          explain: 'Every control you built lives on your access point. A rogue box offers its own door into the same wired network and honors none of them. Finding and removing rogues is a core part of wireless defense.',
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
            { id: 'hide', text: 'Hide the network name, so attackers cannot find it.', feedback: 'A scanner still finds a hidden network. It can be part of a plan, but it does not keep attackers out.' },
            { id: 'open', text: 'Leave the network open so guests connect without fuss.', feedback: 'Open Wi-Fi lets everyone in range read the traffic. That is what started this lab.' },
            { id: 'poster', text: 'Post one shared password on the wall for everyone.', feedback: 'A shared secret on a wall is no better than a copied MAC.' },
          ],
          explain: 'A good wireless policy requires strong encryption, per-user logins to an approved server, WPS off, a signal kept inside the building, and regular scans for rogue access points. Lowering the power does not stop a high-gain antenna, but it shrinks the area an attacker can work from. Open networks, shared secrets, and a hidden name as the only protection do not belong.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Reflect',
      body: md`
        You started with an open network that leaked into the parking lot and ended with one that keeps strangers off the air.

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
