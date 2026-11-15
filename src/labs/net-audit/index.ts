import { entryRating, type FindingId, type RiskLevel } from '../../sim/audit';
import type { Sim } from '../../sim/sim';
import type { Frame, SimEvent } from '../../sim/types';
import { crack, reach } from '../../sim/wifi';
import { capturedSince, happened, inspected, isEncrypted, isTelnetLogin, openedFrame } from '../helpers';
import { md } from '../md';
import type { ActionDef, ActionLine, CheckCtx, LabDef, MapZone } from '../types';
import { buildOffice, deskPortsFiltered, HOME, homeProbe, IP, LOT, OFFICE, routerHardened, routerLogin, switchHardened, vpnHardened, wifiStrong } from './scenario';

// --- Step actions ---

/** What a login button reports: logging in, then whether the capture caught it. */
const loginOutcome =
  (row: string, pred: (f: Frame) => boolean) =>
  (sim: Sim, since: number): ActionLine[] => {
    const c = sim.dev('auditor').conns?.find((x) => x.t === since);
    if (!c || c.status === 'pending') return [{ tone: 'wait', text: 'Logging in…' }];
    if (c.status !== 'open') return [{ tone: 'bad', text: 'The router did not answer the login.' }];
    if (capturedSince(sim, 'auditor', since, pred)) return [{ tone: 'good', text: `Logged in. The capture caught it: open the Capture tab and click the ${row} row.` }];
    return [{ tone: 'bad', text: 'Logged in, but packet capture was off, so nothing was recorded. Turn on Packet capture in the Toolkit, then press this button again.' }];
  };

const telnetLogin: ActionDef = { id: 'telnet-login', label: 'Log in over Telnet', run: (sim) => routerLogin(sim, 'telnet'), outcome: loginOutcome('TELNET', isTelnetLogin) };
const sshLogin: ActionDef = { id: 'ssh-login', label: 'Log in over SSH', run: (sim) => routerLogin(sim, 'ssh'), outcome: loginOutcome('SSH', isEncrypted) };
const probe: ActionDef = { id: 'home-probe', label: 'Home device probes the office', run: homeProbe };

// --- Goal helpers ---

type ScanDone = Extract<SimEvent, { type: 'scan-complete' }>;

/** A scan finished since the step started, and its findings pass `pred`. */
const scanned =
  (pred: (findings: string[], e: ScanDone, sim: Sim) => boolean) =>
  ({ sim, since }: CheckCtx): boolean =>
    happened(sim, since, (e) => e.type === 'scan-complete' && e.device === 'auditor' && pred(e.findings, e, sim));

const without = (...ids: FindingId[]) => scanned((f) => ids.every((id) => !f.includes(id)));

const rating = (sim: Sim, id: FindingId) => entryRating(sim.dev('auditor').audit?.register[id]);

/** A register row has exactly this likelihood and impact. */
const ratedAs =
  (id: FindingId, likelihood: RiskLevel, impact: RiskLevel) =>
  ({ sim }: CheckCtx): boolean => {
    const e = sim.dev('auditor').audit?.register[id];
    return e?.likelihood === likelihood && e.impact === impact;
  };

/** The scan's report lists nothing high or moderate, by the scanner's severity or the auditor's own rating. */
const onlyLowLeft = scanned((_f, e, sim) => {
  const a = sim.dev('auditor').audit;
  const report = a?.reports.find((r) => r.id === e.report);
  return !!report && report.findings.every((f) => f.severity === 'low' && (rating(sim, f.id) ?? 'low') === 'low');
});

export const netAuditLab: LabDef = {
  id: 'net-audit',
  version: 4,
  title: 'Vulnerability Scan and Risk Assessment',
  tagline: 'Scan a small office for weaknesses, rate each risk high, moderate, or low, and write the policies that fix them.',
  unit: 3,
  codehs: [],
  ced: ['3.1.B', '3.1.C', '3.2.A'],
  minutes: 55,
  objectives: [
    'Run an automated vulnerability scanner and read its report of findings, severity, and fixes.',
    'Rate each risk by likelihood and impact, using exploit difficulty and the CIA triad.',
    'Write router, switch, and VPN security policies and apply them as device settings.',
    'Explain why some low risks are accepted while high and moderate risks are fixed.',
  ],
  build: buildOffice,
  captureDevice: 'auditor',
  labelMacs: true,
  clock: '09:00',
  map: {
    zones: (sim): MapZone[] => {
      const zones: MapZone[] = [
        { id: 'office', shape: { kind: 'rect', ...OFFICE }, label: 'Food bank office', tone: 'neutral' },
        { id: 'lot', shape: { kind: 'rect', ...LOT }, label: 'Parking lot', tone: 'warn' },
        { id: 'home', shape: { kind: 'rect', ...HOME }, label: 'Bookkeeper’s home', tone: 'neutral' },
      ];
      const wap = sim.dev('wap');
      if (wap.wifi && !wap.wifi.off) {
        zones.push({ id: 'wifi', shape: { kind: 'circle', cx: wap.x, cy: wap.y, r: reach(wap.wifi) }, label: 'Wi-Fi reach', tone: crack(wap.wifi).ok ? 'warn' : 'info', dashed: true });
      }
      return zones;
    },
  },
  steps: [
    {
      id: 'engagement',
      title: 'Your audit job',
      body: md`
        Harbor Food Bank hired you to audit its office network. Before you touch anything, read the **scope letter**: the written permission that says what you may test, and when.

        - **Who:** you, the outside auditor.
        - **What:** every device on the office network, \`192.168.50.0/24\` (every address that starts \`192.168.50.\`), and the bookkeeper's VPN.
        - **When:** today, 09:00 to 17:00.
        - **Not allowed:** changing donor records, or testing anything outside the list.

        Your audit laptop, [[auditor]], is already plugged into the office switch. Look around first. Click [[router]], then [[fileserver]], then [[wap]]. Read the top of each panel: what the device is and what it does. You can skip the tables for now. Later steps point you to the parts you need.

        > Everything in this lab happens inside a simulation. Running a vulnerability scanner against a network you do not own or have written permission to test is illegal.
      `,
      focus: ['router', 'fileserver', 'wap'],
      goals: [
        { id: 'router', label: 'Open [[router]]', check: inspected('router') },
        { id: 'fileserver', label: 'Open [[fileserver]]', hint: 'Look at its open services: a donor web app on port 80, file sharing on 445, and SSH on 22.', check: inspected('fileserver') },
        { id: 'wap', label: 'Open [[wap]]', check: inspected('wap') },
      ],
      questions: [
        {
          id: 'why-scope',
          kind: 'choice',
          prompt: 'The food bank signed a scope letter before you plugged in. Why does that signature matter?',
          options: [
            { id: 'legal', text: "Without permission, running a scanner on someone's network is a crime.", correct: true },
            { id: 'pay', text: 'It proves the food bank will pay your invoice.', feedback: 'A scope letter is about permission, not payment.' },
            { id: 'more', text: 'It makes the scan find more vulnerabilities.', feedback: 'Permission does not change what the scan finds. It changes whether you are allowed to run it.' },
            { id: 'skip', text: 'It lets you skip the parts of the network you dislike.', feedback: 'The scope says what you may test. It is a limit, not a shortcut.' },
          ],
          explain: "A scan tests other people's systems. Doing that without written authorization is illegal, even when you mean well. The scope letter sets what you may test and when.",
        },
      ],
    },

    {
      id: 'scan',
      title: 'Run the scan',
      body: md`
        An **automated vulnerability scanner** looks for known weaknesses on a network. It sends small test messages, called **probes**, to every device. It checks which devices answer, which services each one runs, and whether their settings are safe. Then it writes a **report**: each weakness (a **finding**), its **severity** (how serious it is), and a suggested fix.

        1. Open the **Toolkit** tab and press **Run scan** on the scanner.
        2. Watch the probes cross the map from [[auditor]] to each device. The labels that pop up on the map, like ARP, TCP, and "learned a MAC", name network messages and what each device learned. You do not need them for this lab.
        3. Read the report below the scanner. Click a finding to see its evidence and fix.
      `,
      focus: ['auditor'],
      open: 'tools',
      tools: [{ kind: 'scanner', device: 'auditor' }],
      goals: [
        { id: 'scanned', label: 'Run the scan and get a report', hint: 'Press **Run scan** in the Toolkit tab.', check: scanned((f) => f.length > 0) },
        { id: 'read', label: 'Open a finding in the report', hint: 'Click any row in the report to read its evidence.', check: ({ ev }) => ev?.type === 'ui:open-finding' && ev.device === 'auditor' },
      ],
      questions: [
        {
          id: 'report-contents',
          kind: 'choice',
          prompt: "The scanner's report lists three things about each weakness. Which three?",
          options: [
            { id: 'right', text: 'The finding, how severe it is, and a suggested fix.', correct: true },
            { id: 'who', text: "The attacker's name, their location, and their motive.", feedback: 'A scanner checks settings and services. It cannot name a person.' },
            { id: 'when', text: 'The finding, the exact date it will be exploited, and by whom.', feedback: 'No scanner predicts the future. It reports what is weak now.' },
            { id: 'bill', text: 'A bill, a contract, and a signature.', feedback: 'That is paperwork, not a scan report.' },
          ],
          explain: 'An automated scanner reports each weakness with a severity and a suggested fix. Severity is a starting point. You still judge the real risk yourself.',
        },
        {
          id: 'mapping',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The scan did more than point out weak settings. What else could an attacker learn from a scan like this?',
          options: [
            { id: 'map', text: 'A map of the office: which devices exist and what each one runs.', correct: true },
            { id: 'decrypt', text: 'The donor records, decrypted from the file server.', feedback: 'The scanner reads open ports and settings. It broke no encryption.' },
            { id: 'passwords', text: 'Every staff member’s email password.', feedback: 'The scanner tested one factory login on the router. It did not collect anyone’s passwords.' },
            { id: 'nothing', text: 'Nothing. A scan only helps defenders.', feedback: 'Attackers run the same scanners. The list of devices and services helps them as much as you.' },
          ],
          explain: 'The same probing that finds weak settings also maps the network: every device and service. That map is the first thing an attacker builds.',
        },
      ],
    },

    {
      id: 'telnet',
      title: 'See it for yourself',
      body: md`
        The report says [[router]] still runs **Telnet**, an old way to log in to a device over the network. The scope letter lets you confirm it. The scanner already found the password: \`admin\` / \`admin\`, the factory default that comes on every router of this model. Default passwords are printed in manuals and posted online, so anyone can look them up.

        1. In the **Toolkit**, turn on **Packet capture** for [[auditor]].
        2. Press **Log in over Telnet**. You sign in to the router.
        3. Open the **Capture** tab and click the Telnet packet you sent. Read the password. The router's reply below it shows its login prompt. On a real router, that prompt comes first.
        4. Press **Log in over SSH** and open that packet. Compare the two.

        **SSH** does the same job as Telnet, but it encrypts the session.

        (To keep the map clear, it shows each login as one packet each way. A real login has more packets. To capture a login on a real office network, an attacker has to be somewhere the traffic passes, such as the Wi-Fi.)
      `,
      focus: ['auditor', 'router'],
      open: 'tools',
      tools: [{ kind: 'sniffer', device: 'auditor' }],
      actions: [telnetLogin, sshLogin],
      goals: [
        { id: 'capture-on', label: 'Turn on packet capture for [[auditor]]', check: ({ sim }) => sim.dev('auditor').sniffing },
        { id: 'telnet-caught', label: 'Capture the Telnet login', hint: 'Turn capture on, then press **Log in over Telnet**.', check: ({ sim, since }) => capturedSince(sim, 'auditor', since, isTelnetLogin) },
        { id: 'telnet-open', label: 'Open the Telnet packet and read the password', hint: 'In the Capture tab, click the row marked **TELNET**.', check: openedFrame('auditor', isTelnetLogin) },
        { id: 'ssh-open', label: 'Open the SSH packet and see that it is scrambled', hint: 'Press **Log in over SSH** first, then click the row marked **SSH**.', check: openedFrame('auditor', isEncrypted) },
      ],
      questions: [
        {
          id: 'telnet-why',
          kind: 'choice',
          prompt: 'You read the admin password straight out of the Telnet capture. SSH showed only scrambled text. Why should the router turn Telnet off?',
          options: [
            { id: 'plain', text: 'Telnet sends the login as plain text, so anyone on the path can read the password.', correct: true },
            { id: 'slow', text: 'Telnet is slower than SSH.', feedback: 'Speed is not the issue. Compare what you could read in each capture.' },
            { id: 'port', text: 'Telnet uses the wrong port number.', feedback: 'A port number is not a weakness. What crossed the wire in the clear?' },
            { id: 'hide', text: 'SSH hides the router from scanners.', feedback: 'SSH still shows as an open port. It protects the contents, not the fact that the service exists.' },
          ],
          explain: 'Telnet carries everything, including passwords, as readable text. SSH encrypts the session. A router security policy, which you write in a later step, turns off unneeded, insecure services like Telnet.',
        },
        {
          id: 'default-pw',
          kind: 'text',
          prompt: 'You logged in with `admin` / `admin`, the factory default. In a sentence or two, say why a default password is a finding even after Telnet is turned off.',
          minWords: 15,
          lines: 2,
        },
      ],
    },

    {
      id: 'likelihood',
      title: 'How likely, and how bad?',
      body: md`
        Every finding is a risk. **Risk** has two parts: how **likely** it is that someone uses the weakness to cause harm, and how much **impact** (damage) that would do.

        **Likelihood** depends on how hard the weakness is to reach and how much skill it takes. To **exploit** a weakness means to use it to break in or cause harm. Well-known exploits that take little skill get used more, because more people can do them. For example, the office Wi-Fi uses **WEP**, an old kind of Wi-Fi encryption that a free tool cracks in under a minute. A weakness that needs rare skill is less likely.

        **Impact** depends on what an attacker could break. Security teams use the **CIA triad** (a set of three) to name it:

        - **Confidentiality:** only the right people can read the data.
        - **Integrity:** nobody changes the data without permission.
        - **Availability:** the system works when people need it.

        The risk register in the next step combines the two parts with this table. Find the likelihood row, then the impact column. For example, moderate likelihood and high impact gives High.

        | Likelihood ↓ / Impact → | Low | Moderate | High |
        | --- | --- | --- | --- |
        | **Low** | Low | Low | Moderate |
        | **Moderate** | Low | Moderate | High |
        | **High** | Moderate | High | High |
      `,
      tools: [{ kind: 'scanner', device: 'auditor' }],
      questions: [
        {
          id: 'low-skill',
          kind: 'choice',
          multi: true,
          prompt: 'Which of these attacks on the food bank need very little skill?',
          options: [
            { id: 'sniff', text: 'Reading the Telnet password with a free packet capture tool.', correct: true },
            { id: 'default', text: 'Logging in with the default admin password.', correct: true },
            { id: 'wep', text: 'Cracking the WEP Wi-Fi from the parking lot with a free tool.', correct: true },
            { id: 'newbug', text: 'Finding a brand-new flaw in the router’s SSH software that nobody has found before.', feedback: 'Finding a new flaw takes rare skill and a lot of time, so its likelihood is low.' },
          ],
          explain: 'How hard a weakness is to exploit changes its likelihood. Well-known attacks that take little skill are more likely, so they push a risk up. Telnet, the default password, and WEP all have free tools and step-by-step guides online.',
        },
        {
          id: 'combine',
          kind: 'choice',
          prompt: 'A finding takes little skill to exploit, but using it hurts the food bank only a little. How should that shape its rating?',
          options: [
            { id: 'middle', text: 'High likelihood, low impact, so a moderate risk.', correct: true },
            { id: 'always', text: 'Anything that takes little skill is always a high risk.', feedback: 'Likelihood is only half of it. A harmless weakness is still low impact.' },
            { id: 'zero', text: 'Low impact means the risk is zero.', feedback: 'Low is not zero. You still record it.' },
            { id: 'only', text: 'Once you know the likelihood, impact stops mattering.', feedback: 'Risk needs both. The register combines them.' },
          ],
          explain: 'Risk combines likelihood and impact. In the table, high likelihood and low impact give a moderate risk. The router answering pings (small "are you there?" messages) from the internet is this case. You rate it in the next step.',
        },
      ],
    },

    {
      id: 'register',
      title: 'Rate the risks',
      body: md`
        Open the **risk register** in the Toolkit: the auditor's list of every finding and its rating. For each finding, set the **likelihood** and the **impact**. The register combines them into a rating, using the table from the last step.

        Three findings match examples from the AP Cybersecurity course. Rate them to match:

        - **Weak Wi-Fi encryption** (WEP): the high example. A free tool cracks it, so likelihood is high. The office is a **flat network**: every device is on one network, so anyone who cracks the Wi-Fi can reach the donor server. Impact is high.
        - The router **answering pings from the internet** (a ping is a small "are you there?" message): the moderate example. It takes no skill, so likelihood is high. It only tells an outsider the office is there, so impact is low.
        - The **Wi-Fi beacon**: the low example. The beacon is the message the Wi-Fi sends out to announce its name. Anyone can see the name, but a name alone is not a way in, so harm is unlikely: likelihood is low. Impact is low too.

        The other four have no single right answer. Rate them with your own judgment. You will see the VPN finding up close in a later step.
      `,
      open: 'tools',
      tools: [{ kind: 'risk-register', device: 'auditor' }],
      goals: [
        {
          id: 'wep',
          label: 'Rate **Weak Wi-Fi encryption**: high likelihood, high impact',
          hint: 'A free tool cracks WEP, so likelihood is high. The donor server is on the same network, so impact is high.',
          check: ratedAs('wifi-weak', 'high', 'high'),
        },
        {
          id: 'pings',
          label: 'Rate **Answers pings from the internet**: high likelihood, low impact',
          hint: 'Pings take no skill, so likelihood is high. They only show that the office is there, so impact is low.',
          check: ratedAs('edge-icmp', 'high', 'low'),
        },
        {
          id: 'beacon',
          label: 'Rate **Wi-Fi beacon broadcast**: low likelihood, low impact',
          hint: 'A name alone is not a way in, so likelihood is low. Impact is low too.',
          check: ratedAs('wifi-beacon', 'low', 'low'),
        },
        {
          id: 'all-rated',
          label: 'Rate every finding',
          hint: 'Each row needs both a likelihood and an impact.',
          check: ({ sim }) => {
            const a = sim.dev('auditor').audit;
            const seen = new Set(a?.reports.flatMap((r) => r.findings.map((f) => f.id)));
            return seen.size > 0 && [...seen].every((id) => rating(sim, id) !== undefined);
          },
        },
      ],
      questions: [
        {
          id: 'cia',
          kind: 'choice',
          afterGoals: true,
          prompt: 'You rated the WEP Wi-Fi finding high. An attacker who cracks it can open the donor records on the server. Which part of the CIA triad does that break first?',
          options: [
            { id: 'c', text: 'Confidentiality.', correct: true },
            { id: 'i', text: 'Integrity.', feedback: 'Integrity is about changing data. Reading it breaks confidentiality first.' },
            { id: 'a', text: 'Availability.', feedback: 'Availability is about keeping the service up. Reading records does not take it down.' },
            { id: 'none', text: 'None. Reading data is not a security problem.', feedback: 'Donor records are private. Reading them is a confidentiality breach.', last: true },
          ],
          explain: 'Network weaknesses threaten confidentiality, integrity, and availability. Reading private data breaks confidentiality, changing records breaks integrity, and taking a service down breaks availability.',
        },
      ],
    },

    {
      id: 'router-policy',
      title: 'Write the router policy',
      body: md`
        A **control** is anything that lowers a risk. A **managerial control** is a written policy that sets the minimum standard for how devices are set up. The settings that carry it out are **technical controls**.

        First, pick the statements that belong in a **router security policy**. Then click [[router]] to jump to its **Security settings**, apply them, and run the scanner again.

        - Turn **Telnet** off and keep **SSH** on.
        - Send **logins** to the **authentication server**, one approved computer (not on this map) that checks every login. That removes the **local account** (a login stored on the router itself) with the factory password.
        - Switch on **Drop pings from the internet**. It adds a rule to the top of the router's firewall, under **Firewall rules**. The old rule that answers pings stays below it, but the router follows the first rule that matches.
      `,
      focus: ['router'],
      open: { inspect: 'router' },
      tools: [
        { kind: 'hardening', device: 'router' },
        { kind: 'firewall-rules', devices: ['router'] },
        { kind: 'scanner', device: 'auditor' },
      ],
      goals: [
        {
          id: 'apply',
          label: 'Apply the router policy: Telnet off, SSH on, logins through the authentication server, and pings from the internet dropped',
          hint: 'In the Security settings of [[router]], check all four: Telnet off, SSH on, logins through the authentication server, and Drop pings on.',
          check: ({ sim }) => routerHardened(sim),
        },
        { id: 'rescan', label: 'Re-scan and clear the router’s findings', hint: 'Apply the settings first, then press **Run scan again** in the Toolkit.', check: without('telnet', 'default-admin', 'edge-icmp') },
      ],
      questions: [
        {
          id: 'policy-pick',
          kind: 'choice',
          multi: true,
          prompt: 'Which statements belong in the router security policy?',
          options: [
            { id: 'aaa', text: 'Ban local accounts for everyday logins. They go through the approved authentication server.', correct: true },
            { id: 'services', text: 'Disable services the router does not need, such as Telnet.', correct: true },
            { id: 'firewall', text: 'Require a firewall, and set it to drop traffic that should not reach the router.', correct: true },
            { id: 'share', text: 'Share the admin password with every staff member so they can help.', feedback: 'A shared password is the opposite of a policy, and the policy bans local accounts anyway.' },
            { id: 'logs', text: 'Turn off logging to save disk space.', feedback: 'Logs are how you detect attacks. A policy never turns them off.' },
            { id: 'longer', text: 'Keep Telnet, but pick a longer password.', feedback: 'Telnet sends the password in the clear whatever its length. Disable it.' },
          ],
          explain: 'A router security policy may ban local accounts, disable unneeded services like Telnet, and require a firewall. It sets the minimum every router must meet. Many policies also keep one emergency local account, locked away, for when the authentication server is down.',
        },
      ],
    },

    {
      id: 'switch-policy',
      title: 'Write the switch policy',
      body: md`
        Now [[sw]]. The report found no **port security**. It also found a **wall jack** (a network socket in the wall) in the lobby, on port 7. Nothing is plugged in, so the switch's port table says "no cable". The port is not shut, though, so anyone could plug in a laptop and join the office network.

        Every network card has a **MAC address**, a hardware ID that the switch sees in every message. The switch settings use it two ways:

        - **Port security** limits how many devices a port accepts. Here it is one: a second MAC address shuts the port down.
        - **MAC filtering** names which device each port accepts: only the computer plugged in now.

        Pick the statements that belong in a **switch security policy**. Then click [[sw]] to jump to its **Security settings**, turn on port security and MAC filtering, **shut the ports nobody uses**, send **logins** to the **authentication server**, and re-scan.
      `,
      focus: ['sw'],
      open: { inspect: 'sw' },
      tools: [{ kind: 'hardening', device: 'sw' }, { kind: 'scanner', device: 'auditor' }],
      goals: [
        {
          id: 'apply',
          label: 'Turn on port security and MAC filtering, shut the empty ports, and send logins to the authentication server',
          hint: 'Open [[sw]] and use the Security settings section.',
          check: ({ sim }) => switchHardened(sim) && deskPortsFiltered(sim),
        },
        { id: 'rescan', label: 'Re-scan and clear the switch finding', hint: 'Apply the settings first, then press **Run scan again**.', check: without('switch-open') },
      ],
      questions: [
        {
          id: 'policy-pick',
          kind: 'choice',
          multi: true,
          prompt: 'Which statements belong in the switch security policy?',
          options: [
            { id: 'aaa', text: 'Ban local accounts for everyday logins. They go through the authentication server.', correct: true },
            { id: 'port-sec', text: 'Turn on port security so each port accepts only a limited set of MAC addresses.', correct: true },
            { id: 'mac', text: 'Use MAC filtering to allow only known devices.', correct: true },
            { id: 'unplug', text: 'Unplug the switch overnight.', feedback: 'That stops the office, not an attacker during the day.' },
            { id: 'closet', text: 'Hide the switch in a locked closet instead of setting port security.', feedback: 'This choice says "instead of" port security. A locked closet does not stop someone at the lobby wall jack, so the policy still needs port security.' },
            { id: 'public', text: 'Give the switch a public internet address so admins can manage it from home.', feedback: 'That exposes management to the whole internet. Hardening points the other way.' },
          ],
          explain: 'A switch security policy may ban local accounts, require port security, and use MAC filtering.',
        },
        {
          id: 'mac-weak',
          kind: 'choice',
          prompt: 'The policy lists MAC filtering. A MAC address can be copied. Why keep MAC filtering in the policy anyway?',
          options: [
            { id: 'layer', text: 'It raises the effort and blocks casual devices, as one layer among several.', correct: true },
            { id: 'cannot', text: 'A MAC address cannot actually be copied.', feedback: 'It can. It is sent as readable text and can be changed in a few clicks, which is why filtering is not enough on its own.' },
            { id: 'encrypt', text: 'MAC filtering encrypts the network.', feedback: 'It decides who may connect. It does not encrypt anything.' },
            { id: 'only', text: 'It is the only control a switch needs.', feedback: 'On its own it is weak. Port security and shut ports back it up.' },
          ],
          explain: 'No single control is enough. MAC filtering stops casual devices and adds a layer. Port security and shutting unused ports cover what it misses.',
        },
      ],
    },

    {
      id: 'wifi',
      title: 'Close the Wi-Fi',
      body: md`
        Next is the Wi-Fi, the course's high example. [[wap]] uses **WEP**, an old encryption that a free tool cracks in under a minute. Its signal reaches the parking lot. The office is one flat network, so once someone is on the Wi-Fi they can reach [[fileserver]] and its donor records.

        1. Click [[wap]] and change its security from WEP to **WPA3**, the strongest setting.
        2. Re-scan.

        WPA3 closes the quick way in. The network is still flat, so a break-in could still spread. Splitting it into zones is a separate project: that is **network segmentation**, a later lab.
      `,
      focus: ['wap'],
      open: { inspect: 'wap' },
      tools: [{ kind: 'wifi-config', device: 'wap' }, { kind: 'scanner', device: 'auditor' }],
      goals: [
        { id: 'wpa3', label: 'Replace WEP on [[wap]] with WPA3', hint: 'Open [[wap]] and change the security mode. WEP is broken; pick WPA3.', check: ({ sim }) => wifiStrong(sim) },
        { id: 'rescan', label: 'Re-scan and clear the high finding', hint: 'Change the setting first, then press **Run scan again**.', check: without('wifi-weak') },
      ],
      questions: [
        {
          id: 'still-flat',
          kind: 'choice',
          afterGoals: true,
          prompt: 'You switched the Wi-Fi to WPA3. The office is still one flat network with the donor server on it. Why did the high finding clear anyway?',
          options: [
            { id: 'residual', text: 'Strong encryption closes the quick way in, so the leftover risk is no longer high.', correct: true },
            { id: 'never', text: 'The flat network was never a problem.', feedback: 'A flat network still lets a break-in spread. That is why segmentation is a separate project.' },
            { id: 'zones', text: 'WPA3 split the network into zones.', feedback: 'Encryption does not segment a network. It protects the radio link.' },
            { id: 'beacons', text: 'Beacons carry the encryption, so WPA3 turned the beacons off.', feedback: 'Beacons still broadcast. That is the low finding you will accept.' },
          ],
          explain: 'The high rating came from weak encryption plus a sensitive server on an open network. Strong encryption removes the weak-encryption part, so the leftover risk drops below high. Segmentation would lower it further.',
        },
      ],
    },

    {
      id: 'vpn',
      title: 'Working from home',
      body: md`
        The bookkeeper works from home on [[bookkeeper]], over a **VPN**: an encrypted tunnel into the office network, drawn as a dashed line on the map. The VPN allows **split tunneling**: only office traffic goes through the tunnel. The laptop stays on the home network at the same time, and everything else goes straight to the internet.

        That makes the laptop a bridge between two networks. The family shares [[homedev]], and it may be infected. Malware on it can reach the laptop, then use the laptop's tunnel to reach the office. (In real life the malware would first break into the laptop. The map skips that step.)

        1. Press **Home device probes the office**. Follow the path with split tunneling on.
        2. Click [[router]] and find **VPN** in its **Security settings**. Turn split tunneling off. Set sign-in to **Password + MFA**: a code from a phone as well as the password, so a stolen password is not enough. The VPN already lets in only the Bookkeeper role.
        3. Press **Home device probes the office** again.

        With split tunneling off, all of the laptop's traffic goes through the tunnel and the office firewall. This VPN also blocks traffic from the home network, so the bridge is gone. This does not help if the laptop itself is infected.
      `,
      focus: ['homedev', 'bookkeeper', 'router'],
      tools: [{ kind: 'hardening', device: 'router', vpn: true }],
      actions: [probe],
      goals: [
        {
          id: 'see-risk',
          label: 'Watch the home device reach [[fileserver]] through the tunnel',
          hint: 'Press **Home device probes the office** while split tunneling is still on.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'homedev' && e.from === IP.fileserver),
        },
        { id: 'fix', label: 'Turn split tunneling off and require more than a password', hint: 'Click [[router]] and find VPN under Security settings. Pick **Password + MFA**.', check: ({ sim }) => vpnHardened(sim) },
        {
          id: 'blocked',
          label: 'Press the probe again and watch it fail to reach the office',
          hint: 'Change the VPN settings first, then press **Home device probes the office** again.',
          check: ({ sim, since }) => vpnHardened(sim) && happened(sim, since, (e) => e.type === 'ping-fail' && e.device === 'homedev' && e.reason === 'vpn-split-off'),
        },
      ],
      questions: [
        {
          id: 'vpn-policy',
          kind: 'choice',
          multi: true,
          prompt: 'Which items belong in the VPN security policy?',
          options: [
            { id: 'roles', text: 'List which roles may use the VPN.', correct: true },
            { id: 'auth', text: 'Require strong authentication, such as keys or MFA.', correct: true },
            { id: 'split', text: 'Ban split tunneling.', correct: true },
            { id: 'fast', text: "Allow split tunneling so the bookkeeper's home videos load faster.", feedback: 'You watched split tunneling open a path from a home device into the office. Speed is not worth that.' },
            { id: 'wifi', text: 'Let anyone with the office Wi-Fi password connect to the VPN.', feedback: 'A VPN policy names roles and requires strong authentication, not a shared password.' },
          ],
          explain: 'A VPN policy may list the roles allowed to use it, require strong authentication like keys or MFA, and ban split tunneling.',
        },
        {
          id: 'split-why',
          kind: 'text',
          prompt: 'Explain in your own words why split tunneling raised the risk. Use what the home device and the bookkeeper’s laptop did.',
          minWords: 20,
          lines: 4,
        },
      ],
    },

    {
      id: 'rescan',
      title: 'The final re-scan',
      body: md`
        Run the scanner one last time. The high and moderate findings should be gone. One low finding remains: the Wi-Fi still sends its beacon.

        You do not have to fix every finding. A **low risk** that costs more to fix than the harm it could cause can be **accepted**: written down, and kept by choice. The beacon is one. The fix would be to hide the Wi-Fi name, but a patient scanner still finds a hidden network, and staff have a harder time joining it.

        (This scanner checks seven things, to keep the lab short. A real scanner checks thousands. It would also report that the donor records web page on [[fileserver]] has no encryption.)
      `,
      focus: ['auditor'],
      open: 'tools',
      tools: [{ kind: 'scanner', device: 'auditor' }],
      goals: [
        {
          id: 'clean',
          label: 'Re-scan and show no high or moderate findings',
          hint: 'Press **Run scan again**. If a high or moderate finding is still listed, go back and apply its fix.',
          check: onlyLowLeft,
        },
      ],
      questions: [
        {
          id: 'accept-low',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The re-scan still lists the beacon finding. Why accept it instead of fixing it?',
          options: [
            { id: 'cost', text: 'It is low risk, and hiding the Wi-Fi name causes more trouble than it prevents.', correct: true },
            { id: 'cannot', text: 'A scanner cannot detect beacons, so there is nothing to fix.', feedback: 'The scanner did detect it. That is why it is on the report.' },
            { id: 'ignore', text: 'Low risks are not real, so you ignore them.', feedback: 'Low is not zero. Accepting a risk means recording it and choosing to live with it, not ignoring it.' },
            { id: 'break', text: 'Fixing it would break the router.', feedback: 'A beacon is a Wi-Fi setting, not a router one, and the network would keep working either way.' },
          ],
          explain: 'Leftover low risks are often accepted when the fix costs more than the risk. Accepting is a decision you record, which is different from missing it.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Write the summary',
      body: md`
        Write the audit summary for the food bank's director, who is not technical.

        - Name the **top risk** you found: one you rated high.
        - Give its **rating** and why it earned that rating (likelihood and impact).
        - Name the **control** (the setting or policy) that fixes it.

        Keep it to a few plain sentences. You can start with: "The biggest risk we found is…" Your risk register is in the **Toolkit** if you want to check your ratings.
      `,
      questions: [
        {
          id: 'summary',
          kind: 'text',
          prompt: 'Your audit summary for the director: the top risk, its rating and why, and the control that fixes it.',
          minWords: 40,
          lines: 6,
        },
      ],
      tools: [{ kind: 'risk-register', device: 'auditor' }],
    },

    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your answers in the summary. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
  ],
};
