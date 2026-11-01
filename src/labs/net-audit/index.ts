import { entryRating, type FindingId } from '../../sim/audit';
import type { Sim } from '../../sim/sim';
import type { SimEvent } from '../../sim/types';
import { crack, reach } from '../../sim/wifi';
import { capturedSince, happened, inspected, isEncrypted, isTelnetLogin, openedFrame } from '../helpers';
import { md } from '../md';
import type { ActionDef, CheckCtx, LabDef, MapZone } from '../types';
import { buildOffice, HOME, homeProbe, IP, LOT, OFFICE, routerHardened, routerLogin, switchHardened, vpnHardened, wifiStrong } from './scenario';

// --- Step actions ---

const telnetLogin: ActionDef = { id: 'telnet-login', label: 'Log in over Telnet', run: (sim) => routerLogin(sim, 'telnet') };
const sshLogin: ActionDef = { id: 'ssh-login', label: 'Log in over SSH', run: (sim) => routerLogin(sim, 'ssh') };
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

/** The scan's report lists nothing high or moderate, by the scanner's severity or the auditor's own rating. */
const onlyLowLeft = scanned((_f, e, sim) => {
  const a = sim.dev('auditor').audit;
  const report = a?.reports.find((r) => r.id === e.report);
  return !!report && report.findings.every((f) => f.severity === 'low' && (rating(sim, f.id) ?? 'low') === 'low');
});

export const netAuditLab: LabDef = {
  id: 'net-audit',
  version: 1,
  title: 'The Network Audit',
  tagline: 'Scan a small office for weaknesses, rate each risk high, moderate, or low, and write the policies that fix them.',
  unit: 3,
  codehs: [],
  ced: ['3.1.B', '3.1.C', '3.2.A'],
  minutes: 45,
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
      title: 'The engagement',
      body: md`
        Harbor Food Bank hired you to audit its office network. Before you touch anything, read the **scope letter**: the written permission that says what you may test, and when.

        - **Who:** you, the outside auditor.
        - **What:** every device on the office network, \`192.168.50.0/24\`, and the bookkeeper's VPN.
        - **When:** today, 09:00 to 17:00.
        - **Not allowed:** changing donor records, or testing anything outside the list.

        Your audit laptop, [[auditor]], is already plugged into the office switch. Look around first. Click [[router]], then [[fileserver]], then [[wap]]. Note what each one is and what it runs.

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
          explain: "A scan probes other people's systems. Doing that without written authorization is illegal, even when you mean well. The scope letter sets what you may test and when.",
        },
      ],
    },

    {
      id: 'scan',
      title: 'Run the scan',
      body: md`
        An **automated vulnerability scanner** probes a network for known weaknesses. It checks which devices answer, which services each one runs, and whether their settings are safe. Then it writes a **report**: each weakness, how severe it is, and a suggested fix.

        1. Open the **Toolkit** tab and press **Run scan** on the scanner.
        2. Watch the probes cross the map from [[auditor]] to each device.
        3. Read the report below the scanner. Click a finding to see its evidence and fix.

        One probe goes out to the internet and back, to test what the edge router shows the outside world.
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
          explain: 'An automated scanner reports each weakness with a severity and a mitigation. Severity is a starting point. You still judge the real risk yourself.',
        },
        {
          id: 'mapping',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The scan did more than flag weak settings. What else did it show an attacker could do?',
          options: [
            { id: 'map', text: 'Map the office: which devices exist and what each one runs.', correct: true },
            { id: 'decrypt', text: 'Decrypt the donor records on the file server.', feedback: 'The scanner reads open ports and settings. It broke no encryption.' },
            { id: 'delete', text: 'Delete the findings so no one else sees them.', feedback: 'A scanner reports what it finds. It does not change the target.' },
            { id: 'install', text: 'Install a firewall by itself.', feedback: 'A scanner recommends fixes. A person still applies them.' },
          ],
          explain: 'The same probing that finds weak settings also maps the network: every device and service. That map is the first thing an adversary builds.',
        },
      ],
    },

    {
      id: 'telnet',
      title: 'See it for yourself',
      body: md`
        The report says [[router]] still runs **Telnet**, an old way to log in to a device over the network. The scope letter lets you confirm it. The scanner already found the password: the factory default \`admin\` / \`foodbank\`.

        1. In the **Toolkit**, turn on **Packet capture** for [[auditor]].
        2. Press **Log in over Telnet**. You sign in to the router.
        3. Open the **Capture** tab and click the Telnet packet. Read the password.
        4. Press **Log in over SSH** and open that packet. Compare the two.

        **SSH** does the same job as Telnet, but it encrypts the session.
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
          prompt: 'You read the admin password straight out of the Telnet capture. SSH showed only scrambled text. Why does the router policy ban Telnet?',
          options: [
            { id: 'plain', text: 'Telnet sends the login in plaintext, so anyone on the path can read the password.', correct: true },
            { id: 'slow', text: 'Telnet is slower than SSH.', feedback: 'Speed is not the issue. Compare what you could read in each capture.' },
            { id: 'port', text: 'Telnet uses the wrong port number.', feedback: 'A port number is not a weakness. What crossed the wire in the clear?' },
            { id: 'hide', text: 'SSH hides the router from scanners.', feedback: 'SSH still shows as an open port. It protects the contents, not the fact that the service exists.' },
          ],
          explain: 'Telnet carries everything, including passwords, as readable text. SSH encrypts the session. The router policy disables unneeded, insecure services like Telnet.',
        },
        {
          id: 'default-pw',
          kind: 'text',
          prompt: 'You logged in with `admin` / `foodbank`, the factory default. In a sentence or two, say why a default password is a finding even after Telnet is turned off.',
          minWords: 15,
          lines: 2,
        },
      ],
    },

    {
      id: 'likelihood',
      title: 'How likely?',
      body: md`
        Every finding is a risk. **Risk** has two parts: how **likely** the weakness is to be used, and how much **impact** it would have.

        Likelihood depends on skill. A weakness with an easy, well-known exploit gets used more often, because more people can pull it off. A weakness that needs rare skill is less likely, even when the impact would be large.

        Sort this office's findings by how hard they are to exploit. The scanner's report is still in the **Toolkit** if you want to look again.
      `,
      questions: [
        {
          id: 'easy',
          kind: 'choice',
          multi: true,
          prompt: 'Which of these needs the least skill to exploit? Choose all that apply.',
          options: [
            { id: 'sniff', text: 'Reading the Telnet password with a free sniffer.', correct: true },
            { id: 'default', text: 'Logging in with the default admin password.', correct: true },
            { id: 'beacon', text: 'Picking up the Wi-Fi beacon from the parking lot.', correct: true },
            { id: 'https', text: 'Breaking strong encryption to read an HTTPS session.', feedback: 'No known shortcut exists for that. It needs rare skill, so its likelihood is low.' },
          ],
          explain: 'Exploit difficulty changes likelihood. Easy, well-documented attacks are more likely, so they push a risk up.',
        },
        {
          id: 'combine',
          kind: 'choice',
          prompt: 'A finding is easy to exploit but, if exploited, barely affects the food bank. How should that shape its rating?',
          options: [
            { id: 'middle', text: 'High likelihood, low impact, so a middling risk.', correct: true },
            { id: 'always', text: 'Easy to exploit always means high risk.', feedback: 'Likelihood is only half of it. A harmless weakness is still low impact.' },
            { id: 'zero', text: 'Low impact means the risk is zero.', feedback: 'Low is not zero. You still record it.' },
            { id: 'only', text: 'Once you know the likelihood, impact stops mattering.', feedback: 'Risk needs both. The register combines them.' },
          ],
          explain: 'Risk combines likelihood and impact. Easy but harmless lands in the middle. The open-ping finding is exactly this case.',
        },
      ],
    },

    {
      id: 'register',
      title: 'Rate the risks',
      body: md`
        Open the **risk register** in the Toolkit. It lists every finding. For each one, set the **likelihood** and the **impact**. The register combines them into a rating: low, moderate, or high.

        Three of these findings match examples from the course framework. Rate them to match:

        - The **weak Wi-Fi encryption** (WEP) on the flat network with the donor server: this is the high example.
        - The edge firewall **answering pings from the internet**: this is the moderate example.
        - The **Wi-Fi beacon broadcast**: this is the low example.

        Rate the other four with your own judgment from the last step.
      `,
      open: 'tools',
      tools: [{ kind: 'risk-register', device: 'auditor' }],
      goals: [
        {
          id: 'anchors',
          label: 'Rate the three framework examples high, moderate, and low',
          hint: 'WEP is trivial to crack and the records are sensitive. A ping reveals the device but little else. A beacon leaks only the network name and its encryption type.',
          check: ({ sim }) => rating(sim, 'wifi-weak') === 'high' && rating(sim, 'edge-icmp') === 'moderate' && rating(sim, 'wifi-beacon') === 'low',
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
          prompt: 'You rated the WEP Wi-Fi finding high. An attacker who cracks it can read the donor records as they cross the network. Which part of the CIA triad does that break first?',
          options: [
            { id: 'c', text: 'Confidentiality.', correct: true },
            { id: 'i', text: 'Integrity.', feedback: 'Integrity is about changing data. Reading it breaks confidentiality first.' },
            { id: 'a', text: 'Availability.', feedback: 'Availability is about keeping the service up. Reading records does not take it down.' },
            { id: 'none', text: 'None. Reading data is not a security problem.', feedback: 'Donor records are private. Reading them is a confidentiality breach.', last: true },
          ],
          explain: 'Network vulnerabilities threaten confidentiality, integrity, and availability. Eavesdropping breaks confidentiality, altering records breaks integrity, and a denial of service breaks availability.',
        },
      ],
    },

    {
      id: 'router-policy',
      title: 'Write the router policy',
      body: md`
        A **managerial control** is a written policy that sets a minimum standard for how devices are configured. Start with [[router]].

        First, pick the statements that belong in a **router security policy**. Then apply them in the router's **Security settings** and run the scanner again.

        - Turn **Telnet** off and keep **SSH** on.
        - Send **logins** to the **authentication server**, one approved place that checks every login. That removes the local account with the factory password.
        - Switch on **Drop pings from the internet**. It adds a rule to the top of the router's firewall. You can see it under **Firewall rules** in the same inspector.
      `,
      focus: ['router'],
      open: { inspect: 'router' },
      tools: [
        { kind: 'hardening', device: 'router' },
        { kind: 'firewall-rules', devices: ['router'] },
      ],
      goals: [
        {
          id: 'apply',
          label: 'Apply the router policy: Telnet off, SSH on, logins through the authentication server, and pings from the internet dropped',
          hint: 'Open [[router]] and use the Security settings section.',
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
            { id: 'aaa', text: 'Ban local accounts. All router logins go through the approved authentication server.', correct: true },
            { id: 'services', text: 'Disable services the router does not need, such as Telnet.', correct: true },
            { id: 'firewall', text: 'Require a firewall, and set it to drop traffic that should not reach the router.', correct: true },
            { id: 'share', text: 'Share the admin password with every staff member so they can help.', feedback: 'A shared password is the opposite of a policy, and the policy bans local accounts anyway.' },
            { id: 'logs', text: 'Turn off logging to save disk space.', feedback: 'Logs are how you detect attacks. A policy never turns them off.' },
            { id: 'longer', text: 'Keep Telnet, but pick a longer password.', feedback: 'Telnet sends the password in the clear whatever its length. Disable it.' },
          ],
          explain: 'A router security policy may ban local accounts, disable unneeded services like Telnet, and require a firewall. It sets the minimum every router must meet.',
        },
        {
          id: 'where-logins',
          kind: 'choice',
          afterGoals: true,
          prompt: 'After the re-scan, the local admin finding is gone. Where do router logins go now?',
          options: [
            { id: 'aaa', text: 'To the approved authentication server.', correct: true },
            { id: 'nowhere', text: 'Nowhere. The router cannot be managed anymore.', feedback: 'You can still log in, through the authentication server instead of a local account.' },
            { id: 'local', text: 'To a local account with a longer password.', feedback: 'The policy removed local accounts entirely.' },
            { id: 'fw', text: 'To the firewall.', feedback: 'A firewall filters traffic. It does not hold logins.' },
          ],
          explain: 'Central authentication means one place to add, remove, and audit accounts, instead of a local password on every device.',
        },
      ],
    },

    {
      id: 'switch-policy',
      title: 'Write the switch policy',
      body: md`
        Now [[sw]]. The report found no **port security**, and a live wall jack in the lobby, port 7. Anyone could plug a laptop into it and join the office network.

        Pick the statements that belong in a **switch security policy**, then apply them in the switch's **Security settings** and re-scan.

        - Turn on **port security** for the desk ports, so each one accepts only one device.
        - Turn on **MAC filtering**, so each desk port accepts only the computer plugged in now.
        - **Shut the ports nobody uses**, including the lobby jack.
        - Send **logins** to the **authentication server**.
      `,
      focus: ['sw'],
      open: { inspect: 'sw' },
      tools: [{ kind: 'hardening', device: 'sw' }],
      goals: [
        {
          id: 'apply',
          label: 'Turn on port security, shut the empty ports, and send logins to the authentication server',
          hint: 'Open [[sw]] and use the Security settings section.',
          check: ({ sim }) => switchHardened(sim),
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
            { id: 'aaa', text: 'Ban local accounts. Switch logins go through the authentication server.', correct: true },
            { id: 'port-sec', text: 'Turn on port security so each port accepts only a limited set of MAC addresses.', correct: true },
            { id: 'mac', text: 'Use MAC filtering to allow only known devices.', correct: true },
            { id: 'unplug', text: 'Unplug the switch overnight.', feedback: 'That stops the office, not an attacker during the day.' },
            { id: 'closet', text: 'Hide the switch in a locked closet instead of setting port security.', feedback: 'A locked closet does not help against the open jack out in the lobby. Do both.' },
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
            { id: 'cannot', text: 'A MAC address cannot actually be copied.', feedback: 'It can. It is sent in the clear and easy to change, which is why filtering is not enough on its own.' },
            { id: 'encrypt', text: 'MAC filtering encrypts the network.', feedback: 'It decides who may connect. It does not encrypt anything.' },
            { id: 'only', text: 'It is the only control a switch needs.', feedback: 'On its own it is weak. Port security and authentication back it up.' },
          ],
          explain: 'No single control is enough. MAC filtering stops casual devices and adds a layer; port security and user authentication cover what it misses.',
        },
      ],
    },

    {
      id: 'wifi',
      title: 'Close the Wi-Fi',
      body: md`
        The highest-rated finding is the Wi-Fi. [[wap]] uses **WEP**, an encryption that takes seconds to crack. Its signal reaches the parking lot. The office is one flat network, so once someone is on the Wi-Fi they can reach [[fileserver]] and its donor records.

        1. Open [[wap]] and change its security from WEP to **WPA3**, the strongest setting.
        2. Re-scan.

        WPA3 closes the easy way in. The network is still flat, so a break-in could still spread. Splitting it into zones is a separate project: that is **network segmentation**, a later lab.
      `,
      focus: ['wap'],
      open: { inspect: 'wap' },
      tools: [{ kind: 'wifi-config', device: 'wap' }],
      goals: [
        { id: 'wpa3', label: 'Set [[wap]] to WPA2 or WPA3', hint: 'Open [[wap]] and change the security mode. WEP is broken; pick WPA3.', check: ({ sim }) => wifiStrong(sim) },
        { id: 'rescan', label: 'Re-scan and clear the high finding', hint: 'Change the setting first, then press **Run scan again**.', check: without('wifi-weak') },
      ],
      questions: [
        {
          id: 'still-flat',
          kind: 'choice',
          afterGoals: true,
          prompt: 'You switched the Wi-Fi to WPA3. The office is still one flat network with the donor server on it. Why did the high finding clear anyway?',
          options: [
            { id: 'residual', text: 'Strong encryption closes the easy way in, so the leftover risk is no longer high.', correct: true },
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
        The bookkeeper works from home on [[bookkeeper]], over a **VPN**: an encrypted tunnel into the office network, drawn as a dashed line on the map. The VPN allows **split tunneling**: office traffic goes through the tunnel, and everything else goes straight to the internet from the home network.

        The family shares [[homedev]], and it may be infected.

        1. Press **Home device probes the office**. Follow the path with split tunneling on.
        2. In [[router]]'s **Security settings**, under **VPN**, turn split tunneling off and set sign-in to **Password + MFA** (a second login step beyond the password).
        3. Press **Home device probes the office** again.

        This simulation keeps the VPN simple: with split tunneling on, devices on the bookkeeper's home network can ride the laptop into the office. With it off, only the laptop's own office traffic uses the tunnel.
      `,
      focus: ['homedev', 'bookkeeper', 'router'],
      tools: [{ kind: 'hardening', device: 'router', vpn: true }],
      actions: [probe],
      goals: [
        {
          id: 'see-risk',
          label: 'Watch a home device reach [[fileserver]] through the tunnel',
          hint: 'Press **Home device probes the office** while split tunneling is still on.',
          check: ({ sim, since }) => happened(sim, since, (e) => e.type === 'ping-reply' && e.device === 'homedev' && e.from === IP.fileserver),
        },
        { id: 'fix', label: 'Turn split tunneling off and require MFA', hint: 'Open [[router]] and find VPN under Security settings.', check: ({ sim }) => vpnHardened(sim) },
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
            { id: 'split', text: 'Prohibit split tunneling.', correct: true },
            { id: 'fast', text: "Allow split tunneling so the bookkeeper's home streaming stays fast.", feedback: 'You just watched split tunneling open a path from a home device into the office. Speed is not worth that.' },
            { id: 'wifi', text: 'Let anyone with the office Wi-Fi password dial in.', feedback: 'A VPN policy names roles and requires strong authentication, not a shared password.' },
          ],
          explain: 'A VPN policy may list the roles allowed to use it, require strong authentication like keys or MFA, and prohibit split tunneling.',
        },
        {
          id: 'split-why',
          kind: 'text',
          prompt: 'Explain in your own words why split tunneling raised the risk, using what the home device did.',
          minWords: 20,
          lines: 4,
        },
      ],
    },

    {
      id: 'rescan',
      title: 'The final re-scan',
      body: md`
        Run the scanner one last time. The high and moderate findings should be gone. One low finding remains: the Wi-Fi still broadcasts its beacon.

        You do not have to fix every finding. A **low risk** that costs more to fix than it would ever cause can be **accepted**: written down, and lived with on purpose.
      `,
      focus: ['auditor'],
      open: 'tools',
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
          prompt: 'The re-scan still lists the beacon finding. Why accept it instead of fixing it?',
          options: [
            { id: 'cost', text: 'It is low risk, and hiding the Wi-Fi name costs more hassle than it saves.', correct: true },
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

        - Name the **top risk** you found.
        - Give its **rating** and why it earned that rating (likelihood and impact).
        - Name the one **control** that fixes it.

        Keep it to a few plain sentences the director can act on.
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
