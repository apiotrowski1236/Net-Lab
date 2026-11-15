import { aiCounts } from '../../sim/ids';
import type { Sim } from '../../sim/sim';
import type { LogEntry } from '../../sim/types';
import { happened, loggedSince, openedLog } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import {
  AI_EVENTS,
  BASELINE,
  BROADCAST,
  buildUtility,
  C2,
  EXFIL,
  IP,
  LOG_DEVICES,
  MAC,
  PORT,
  replayArp,
  replayBackup,
  replayFlood,
  replayUpload,
  SCANNER,
  zones,
} from './scenario';

// ---------------------------------------------------------------------------
// The lesson's buttons: recorded traffic from the night, replayed live
// ---------------------------------------------------------------------------

const replayArpAction: ActionDef = { id: 'replay-arp', label: 'Replay last night’s attack', run: replayArp };
const replayUploadAction: ActionDef = { id: 'replay-exfil', label: 'Replay the 3 a.m. upload', run: replayUpload };
const replayBackupAction: ActionDef = { id: 'run-backup', label: 'Replay the 2 a.m. backup', run: replayBackup };
const replayFloodAction: ActionDef = { id: 'replay-flood', label: 'Replay the MAC flood', run: replayFlood };
const recordBaseline: ActionDef = { id: 'record-baseline', label: 'Record a clean-week baseline', run: (sim) => sim.idsRecordBaseline('nids', BASELINE) };
const scoreNight: ActionDef = { id: 'score-morning', label: 'Score the night’s events', run: (sim) => sim.aiScore('siem', AI_EVENTS) };

/** The incident the SIEM opened overnight from the scanner's lines. */
export const INCIDENT = 1041;

// ---------------------------------------------------------------------------
// Goal checks
// ---------------------------------------------------------------------------

const sensor = (sim: Sim) => sim.dev('nids').ids!.sensor!;
const siem = (sim: Sim) => sim.dev('siem').ids!.siem!;

/** The sensor wrote a line matching `pred` since the step started. */
const sensorLogged = (sim: Sim, since: number, pred: (e: LogEntry) => boolean) => loggedSince(sim, 'nids', since, pred);
/** Since the step started and after the events were scored, the student set the AI threshold to a value matching `pred`. */
function triedThreshold(sim: Sim, since: number, pred: (v: number) => boolean): boolean {
  const ai = siem(sim).ai;
  if (!ai) return false;
  const from = Math.max(since, ai.scoredAt);
  return happened(sim, from, (e) => e.type === 'config' && e.device === 'siem' && e.what === 'ai-threshold' && pred(Number(e.detail)));
}
const alertFor = (signature: string, pred: (e: LogEntry) => boolean = () => true) => (e: LogEntry) =>
  e.level === 'alert' && e.fields?.signature === signature && pred(e);

// ---------------------------------------------------------------------------
// Step setups. Each puts the sensor where its step needs it if the student
// skipped ahead or turned something off, and leaves it alone otherwise.
// ---------------------------------------------------------------------------

function signaturesOn(sim: Sim): void {
  sim.idsSetSignatures('nids', true);
}

function anomalyAtMedium(sim: Sim): void {
  signaturesOn(sim);
  const s = sensor(sim);
  if (!s.baseline) sim.idsRecordBaseline('nids', BASELINE);
  if (!s.anomaly || s.tolerance === 'loose') sim.idsSetAnomaly('nids', true, s.tolerance === 'loose' ? 'medium' : s.tolerance);
}

export const logsLab: LabDef = {
  id: 'logs',
  version: 3,
  title: 'Log Analysis and Intrusion Detection',
  tagline: 'Read a night of logs, turn on IDS signatures and anomaly detection, and tune them so real attacks stand out from false alarms.',
  unit: 3,
  codehs: ['3.18 The Story in the Logs'],
  ced: ['3.5.A', '3.5.B', '3.5.D', '3.5.E'],
  minutes: 50,
  objectives: [
    'Explain what a NIDS, a NIPS, and a SIEM each do with network logs.',
    'Compare signature-based and anomaly-based detection, including what each one misses.',
    'Judge a detector by its false positives and false negatives.',
    'Find indicators of compromise in a night of logs and explain which detector would flag each one.',
  ],
  build: buildUtility,
  map: { zones },
  clock: '08:00',
  labelMacs: true,
  steps: [
    {
      id: 'shift',
      title: 'Morning shift',
      body: md`
        You are the new security analyst at Riverbend Water Utility. It runs the city's water treatment plant. An attacker who gets into the office network can reach the control room, and from there the plant.

        Every device keeps a **log**, a running record of what it did. [[fw]], [[sw]], the servers, the staff computers, and [[plant]] all write lines. The **SIEM** ([[siem]]), short for security information and event management, collects a copy of every log in one place.

        Everything here is a simulation of one night at the utility. The attacks already happened. Your job this morning is to find them.

        Open the **Logs** tab and read one line from each kind of source:

        1. A **firewall** line from [[fw]].
        2. A **switch** line from [[sw]].
        3. A **server** line from [[files]].
        4. A **sensor** line from [[nids]], the intrusion detection sensor. It plugs into the switch's **mirror port**, which sends it a copy of every **frame**, or message, that crosses the switch.

        Use the device filter at the top of the tab to jump between them. Click a line to open its fields.
      `,
      open: 'logs',
      focus: ['siem', 'nids', 'fw', 'files'],
      tools: [{ kind: 'logs', devices: LOG_DEVICES }],
      goals: [
        {
          id: 'fw-line',
          label: 'Open a firewall line from [[fw]]',
          hint: 'Set the device filter to the Edge firewall, then click any line.',
          check: openedLog((e) => e.device === 'fw' && e.source === 'firewall'),
        },
        { id: 'sw-line', label: 'Open a switch line from [[sw]]', hint: 'Set the device filter to the Office switch.', check: openedLog((e) => e.device === 'sw') },
        { id: 'srv-line', label: 'Open a server line from [[files]]', hint: 'Set the device filter to the Records server.', check: openedLog((e) => e.device === 'files') },
        {
          id: 'ids-line',
          label: 'Open a sensor line from [[nids]]',
          hint: 'Set the device filter to the NIDS sensor.',
          check: openedLog((e) => e.device === 'nids' && (e.source === 'ids' || e.source === 'ips')),
        },
      ],
      questions: [
        {
          id: 'what-siem',
          kind: 'choice',
          prompt: 'Every device already keeps its own log. Why does the utility also send copies to the SIEM?',
          options: [
            { id: 'together', text: 'So you can search every device’s logs together and follow one attack across the network.', correct: true },
            { id: 'faster', text: 'So the firewall runs faster once its logs live somewhere else.', feedback: 'Logging barely affects the firewall’s speed. The SIEM is about seeing everything in one place.' },
            {
              id: 'only',
              text: 'Because only the SIEM is allowed to store logs; the other devices delete theirs.',
              feedback: 'Each device keeps its own log. The SIEM gathers copies so you do not have to open ten devices.',
            },
            { id: 'block', text: 'So the SIEM can block attacks the firewall misses.', feedback: 'A SIEM collects and connects logs. Blocking is a different job, and you will meet it later in this lab.' },
          ],
          explain:
            'A SIEM pulls logs from many sources into one searchable place. One attack often touches the firewall, a server, and the sensor, and you only see the whole thing when their logs sit side by side.',
        },
      ],
    },

    {
      id: 'haystack',
      title: 'Too many lines',
      body: md`
        The overnight log holds hundreds of lines here, and a real utility's SIEM would hold millions a day. You cannot read them all. You search and filter instead.

        Something tried to break into [[files]] last night. Find it.

        1. Set the device filter to the Records server.
        2. Check **Warnings and alerts only** to hide the routine lines.
        3. Type \`fail\` in the search box.

        Open one of the failed sign-in lines. They all come from the same outside address, over **SSH**, a remote login program. Rule 1 on [[fw]] lets SSH in to this server so a vendor can do remote support. That open door is how the sign-in attempts got through.
      `,
      open: 'logs',
      focus: ['files'],
      goals: [
        {
          id: 'found-fail',
          label: 'Open a failed sign-in on [[files]]',
          hint: 'Filter to the Records server, turn on Warnings and alerts only, and search for fail.',
          check: openedLog((e) => e.device === 'files' && e.source === 'auth' && e.fields?.action === 'fail'),
        },
      ],
      questions: [
        {
          id: 'why-tools',
          kind: 'choice',
          prompt: 'Why can’t an analyst read every log line by hand?',
          options: [
            { id: 'volume', text: 'A network logs far more lines each day than a person could ever read, so tools pick out what matters.', correct: true },
            { id: 'encrypted', text: 'The lines are encrypted, so only a tool can open them.', feedback: 'These logs are plain text. The problem is how many there are, not that they are locked.' },
            { id: 'policy', text: 'Company policy forbids reading raw logs.', feedback: 'Reading logs is the job. The trouble is the sheer number of them.' },
            { id: 'deleted', text: 'Old lines are deleted before anyone can open them.', feedback: 'Retention matters, but even today’s lines are too many to read one by one.' },
          ],
          explain:
            'A medium network logs millions of events a day. Nobody reads that. Filters, search, and later an AI model pick out the handful worth a human’s time.',
        },
      ],
    },

    {
      id: 'signatures',
      title: 'Signatures',
      body: md`
        A **NIDS**, a network intrusion detection system, watches traffic and raises an **alert** when it sees something it knows is bad. [[nids]] is a NIDS. Its rules have been off since 02:00, when a signature update failed. That is why nothing caught the intruder overnight.

        Click [[nids]] and find the **Detection** section in its inspector. Turn on the **signature set**. A signature is a stored pattern for a known attack, the way antivirus knows a known virus.

        Then press **Replay last night's attack**. It plays the recorded traffic again now, so the alert carries this morning's time.

        Some terms for what you will see:

        - A **MAC address** is a network card's hardware ID.
        - The **gateway** is [[fw]] at \`${IP.gateway}\`, the office's door to the internet.
        - An **ARP** reply tells a computer which MAC address goes with an IP address.

        [[mal]] sends fake ARP replies that say the gateway's IP belongs to the laptop's MAC. This attack is called **ARP spoofing**, or ARP poisoning. One signature is "an ARP reply gives the gateway's IP a different MAC than the one on file". Watch for its alert.
      `,
      open: { inspect: 'nids' },
      focus: ['nids', 'sw', 'mal'],
      tools: [{ kind: 'ids', device: 'nids', controls: ['signatures'] }],
      actions: [replayArpAction],
      goals: [
        { id: 'sig-on', label: 'Turn on the signature set on [[nids]]', hint: 'Click the sensor and find Detection in its inspector.', check: ({ sim }) => sensor(sim).signatures },
        {
          id: 'arp-alert',
          label: 'A signature names the attacker’s MAC address',
          hint: 'Turn the signatures on first, then press Replay last night’s attack.',
          check: ({ sim, since }) => sensorLogged(sim, since, alertFor('arp-spoof', (e) => e.fields?.mac === MAC.mal)),
        },
      ],
      questions: [
        {
          id: 'how-signature',
          kind: 'choice',
          prompt: 'How did the signature catch the ARP poisoning?',
          options: [
            { id: 'pattern', text: 'It matched the traffic against known attack patterns, and a fake ARP reply for the gateway is one of them.', correct: true },
            {
              id: 'learned',
              text: 'It recorded a week of normal traffic and noticed this looked different.',
              feedback: 'That is anomaly detection, which you turn on in two steps. A signature does not learn; it compares to a fixed list.',
            },
            { id: 'blocked', text: 'It blocked the attacker’s MAC the moment it appeared.', feedback: 'A NIDS only warns. Blocking comes with a NIPS, later in this lab.' },
            { id: 'asked', text: 'It asked the SIEM whether other utilities had seen this MAC.', feedback: 'Signatures match a local pattern. They do not phone other networks.' },
          ],
          explain:
            'Signature detection compares traffic to a list of known indicators. It is fast and handles high volume, which is why it suits busy networks. Its weakness shows up next: it cannot catch an attack nobody has written a signature for.',
        },
      ],
    },

    {
      id: 'something-new',
      title: 'Something new',
      body: md`
        At 03:12 last night, [[pc2]] in finance sent a large upload to \`${EXFIL}\`. Nobody was at work. No list of known-bad addresses has ever seen that IP.

        Press **Replay the 3 a.m. upload**. Watch the signature set. It stays silent.

        A detector can be wrong in two ways. A **false positive** is an alert on something harmless. A **false negative** is a real attack that raises no alert.
      `,
      setup: signaturesOn,
      focus: ['pc2', 'fw', 'nids'],
      tools: [{ kind: 'ids', device: 'nids', controls: ['signatures'] }],
      actions: [replayUploadAction],
      goals: [
        {
          id: 'missed',
          label: 'The upload replays and no signature fires',
          hint: 'Keep the signature set on, press Replay the 3 a.m. upload, and watch the sensor’s alerts. Nothing new should appear.',
          check: ({ sim, since }) =>
            sensor(sim).signatures && loggedSince(sim, 'fw', since, (e) => e.fields?.dst === EXFIL) && !sensorLogged(sim, since, (e) => e.level === 'alert'),
        },
      ],
      questions: [
        {
          id: 'name-it',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The sensor saw a real attack and said nothing. What is that called?',
          options: [
            { id: 'fn', text: 'A false negative: a real attack the detector missed.', correct: true },
            { id: 'fp', text: 'A false positive: a harmless event the detector flagged.', feedback: 'That is the opposite. Here the detector missed something real; it did not flag something harmless.' },
            { id: 'tp', text: 'A true positive, since the upload really happened.', feedback: 'A true positive means the detector correctly flagged a real attack. This detector flagged nothing.' },
            { id: 'drift', text: 'A baseline drift the SIEM corrects on its own.', feedback: 'There is no baseline yet. The signature set has no pattern for this.' },
          ],
          explain:
            'Signatures only catch what they already know. A brand new attack matches no known pattern, so it gets past them. That gap is a false negative, and it is why networks add a second kind of detection.',
        },
      ],
    },

    {
      id: 'baseline',
      title: 'Baseline',
      body: md`
        **Anomaly-based** detection works the other way. First it records a **baseline**, a picture of the network on a clean, normal week: who talks to whom, how much, and at what hours. Then it gives each connection a **deviation** score, a count of how far it is from that picture, and alerts when the score is high.

        1. Press **Record a clean-week baseline** below.
        2. In [[nids]]'s **Detection** section, set the **tolerance** to **Medium**. The tolerance is the deviation that sets off an alert.
        3. Turn on **anomaly detection** there too.
        4. Press **Replay the 3 a.m. upload** again, then **Replay the 2 a.m. backup**.

        The backup is normal work. Every afternoon [[backup]] sends a small copy of the records to a backup site outside the utility. Once a month, at 2 a.m., it sends the full 40 MB. Watch which replays raise an alert.
      `,
      setup: signaturesOn,
      open: { inspect: 'nids' },
      focus: ['nids', 'pc2', 'backup'],
      tools: [{ kind: 'ids', device: 'nids', controls: ['signatures', 'anomaly'] }],
      actions: [recordBaseline, replayUploadAction, replayBackupAction],
      goals: [
        { id: 'baseline-set', label: 'Record the clean-week baseline', hint: 'Press Record a clean-week baseline.', check: ({ sim }) => !!sensor(sim).baseline },
        {
          id: 'anomaly-on',
          label: 'Turn on anomaly detection at Medium tolerance',
          hint: 'If you leave it on Loose, the upload slips through again. Medium catches it.',
          check: ({ sim }) => sensor(sim).anomaly && sensor(sim).tolerance !== 'loose',
        },
        {
          id: 'catch-upload',
          label: 'An anomaly alert names Raj’s PC upload',
          hint: 'With anomaly detection on at Medium, press Replay the 3 a.m. upload.',
          check: ({ sim, since }) => sensorLogged(sim, since, alertFor('anomaly', (e) => e.fields?.host === IP.pc2)),
        },
        {
          id: 'catch-backup',
          label: 'Replay the 2 a.m. backup with anomaly detection on',
          hint: 'With anomaly detection on at Medium, press Replay the 2 a.m. backup and watch what the sensor does.',
          check: ({ sim, since }) => sensorLogged(sim, since, alertFor('anomaly', (e) => e.fields?.host === IP.backup)),
        },
      ],
      questions: [
        {
          id: 'false-alarm',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The backup is normal work, but it raised an alert. Why do false alerts like this one matter?',
          options: [
            { id: 'fatigue', text: 'Analysts waste time on harmless events and start to ignore alerts, so a real one gets missed.', correct: true },
            { id: 'stops', text: 'The sensor stops logging until someone clears the alert.', feedback: 'The sensor keeps running. The cost is the analyst’s time and attention, not lost logging.' },
            { id: 'attacker', text: 'A false alert helps the attacker finish faster.', feedback: 'The attacker is not involved in the backup alert. The cost lands on the team watching the screen.' },
            { id: 'none', text: 'None, because the analyst can see it is the backup.', feedback: 'Spotting one is no problem. Spotting the hundredth after a long shift is hard. That is the danger.' },
          ],
          explain:
            'Every false alert costs attention. Enough of them and the team learns to ignore the alert, which is called alert fatigue, and a real attack gets lost among the false ones. Anomaly detection suits steady networks for this reason: the steadier normal traffic is, the fewer false alerts it raises.',
        },
      ],
    },

    {
      id: 'nips',
      title: 'From alarm to action',
      body: md`
        A NIDS only warns. A **NIPS**, a network intrusion prevention system (IPS for short), can also act. It can close a switch port, block an IP address or a MAC address, or reject a protocol. [[nids]] only gets copies of traffic, so it cannot drop a packet itself. In **prevention mode** it tells [[sw]] to close a port, or adds a block rule at the top of [[fw]]'s list, so the block becomes rule 1.

        1. Turn on **Prevention mode** in [[nids]]'s Detection section.
        2. Press **Replay the MAC flood**. [[mal]] sends [[sw]] frames from many made-up MAC addresses. The switch keeps an **address table** of which MAC is on which port. When the table fills up, the switch forgets the real devices and sends their frames out every port, so the laptop sees everyone's traffic.
        3. Press **Replay the 2 a.m. backup** again.

        Watch what the sensor does to each one.
      `,
      setup: anomalyAtMedium,
      open: { inspect: 'nids' },
      focus: ['nids', 'sw', 'mal', 'backup'],
      tools: [{ kind: 'ids', device: 'nids', controls: ['signatures', 'anomaly', 'prevention'] }],
      actions: [replayFloodAction, replayBackupAction],
      goals: [
        { id: 'prevent-on', label: 'Turn on prevention mode on [[nids]]', hint: 'Find Prevention mode under Detection in the sensor’s inspector.', check: ({ sim }) => sensor(sim).prevention },
        {
          id: 'port-shut',
          label: 'The NIPS shuts the flooded port',
          hint: 'Turn on prevention, then replay the MAC flood.',
          check: ({ sim, since }) =>
            !!sim.dev('sw').switchSec?.ports[PORT.mal]?.shutdown && sensorLogged(sim, since, (e) => e.source === 'ips' && e.fields?.port === PORT.mal),
        },
        {
          id: 'backup-blocked',
          label: 'Replay the 2 a.m. backup with prevention on',
          hint: 'With prevention on, press Replay the 2 a.m. backup and watch what the sensor does to the backup server.',
          check: ({ sim, since }) => sensorLogged(sim, since, (e) => e.source === 'ips' && e.fields?.blocked === IP.backup),
        },
      ],
      questions: [
        {
          id: 'tradeoff',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Prevention stopped the flood with no one watching. What is the risk of letting a tool block on its own?',
          options: [
            { id: 'outage', text: 'One false alert can cut off a working system, like the backup, before anyone checks.', correct: true },
            { id: 'slow', text: 'It slows the network because it reads every packet twice.', feedback: 'Reading traffic is not the issue. The risk is the tool acting on a wrong call.' },
            { id: 'remote', text: 'An attacker can switch the NIPS off from the internet.', feedback: 'That is a separate worry. The trade-off here is what the NIPS does when it is wrong.' },
            { id: 'mac-only', text: 'It can block MAC addresses but never IP addresses.', feedback: 'A NIPS can block IPs, MACs, and ports. It blocked the backup server’s IP a moment ago.' },
          ],
          explain:
            'Blocking automatically is fast and needs no analyst, which is its strength against a flood in the middle of the night. The cost is that a false positive now causes an outage instead of a wasted click. Teams tune a NIPS carefully and often let it block only the attacks it is most sure of.',
        },
      ],
    },

    {
      id: 'correlate',
      title: 'Connect the dots',
      body: md`
        The SIEM's real power is tying lines together. On their own, a blocked packet, a port scan, and a few failed sign-ins each look minor. The SIEM noticed all three came from one address, \`${SCANNER}\`, within twenty minutes, and opened a single **incident**.

        Open incident **${INCIDENT}** on [[siem]]: filter the Logs tab to the SIEM server, search for \`${INCIDENT}\`, and click the \`INCIDENT ${INCIDENT}\` line. Read its three parts: the firewall denies, the port-scan alert, and the failed sign-ins on [[files]] you found earlier.

        Then **triage** it, which means sorting it by how serious it is:

        - **Verdict**: is it a real attack or a false alarm?
        - **Action**: **escalate** it, which hands it to the incident response team to act on, or **close** it, which means no more work is needed.

        The **Verdict** and **Action** buttons are at the bottom of the line's details. Pick one of each, then press **Save triage**.
      `,
      open: 'logs',
      focus: ['siem', 'files', 'fw'],
      tools: [{ kind: 'siem', device: 'siem' }],
      goals: [
        {
          id: 'open-incident',
          label: `Open incident ${INCIDENT} on [[siem]]`,
          hint: 'Filter the Logs tab to the SIEM server, or open Incidents in its inspector.',
          check: openedLog((e) => e.device === 'siem' && e.fields?.incident === INCIDENT),
        },
        {
          id: 'triaged',
          label: `Triage incident ${INCIDENT} correctly`,
          hint: 'One address scanned, got denied, then tried passwords. Is that a mistake or an attack? And should someone act on it?',
          check: ({ sim }) => {
            const inc = siem(sim).incidents.find((i) => i.id === INCIDENT);
            return inc?.verdict === 'real' && inc.action === 'escalate';
          },
        },
      ],
      questions: [
        {
          id: 'why-correlate',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Each line alone looked minor. Why did putting them together change the picture?',
          options: [
            {
              id: 'story',
              text: 'One address scanned, was blocked, then tried passwords through the one open port. That is a targeted attack.',
              correct: true,
            },
            {
              id: 'three',
              text: 'Three alerts always add up to a real attack.',
              feedback: 'Count is not the logic. Three unrelated alerts can be three dead ends. These three share one source and one target.',
            },
            { id: 'blocked', text: 'The SIEM blocked the address, which proves it was real.', feedback: 'The SIEM correlates and alerts. It did not block anything. You judge the incident.' },
            {
              id: 'fails',
              text: 'Failed sign-ins are always an attack.',
              feedback: 'Alone they might be a forgetful user. What makes these an attack is the scan and the deny from the same address.',
            },
          ],
          explain:
            'Correlation turns weak single signals into one story. A scan, a deny, and failed sign-ins from one outside IP show someone testing the utility’s defenses. You escalate that as one attack instead of closing three small events.',
        },
      ],
    },

    {
      id: 'threshold',
      title: 'Set the threshold',
      body: md`
        There is still too much to read by hand. An **AI** model helps: it gives every event a score from 0.00 to 1.00 for how likely it is to be an attack. You set the **threshold**. Any event scored at or above it becomes an alert.

        1. Press **Score the night's events**. The scores appear in [[siem]]'s inspector.
        2. Drag the threshold slider to **1.00** and watch the two counters: real attacks caught, and false alerts.
        3. Drag it to **0.00** and watch again.
        4. Find a threshold that catches all three real attacks in the score table with at most one false alert, and leave it there.
      `,
      open: { inspect: 'siem' },
      focus: ['siem'],
      tools: [{ kind: 'ai-threshold', device: 'siem' }],
      actions: [scoreNight],
      goals: [
        { id: 'scored', label: 'Score the night’s events', hint: 'Press Score the night’s events.', check: ({ sim }) => !!siem(sim).ai },
        {
          id: 'tried-high',
          label: 'Try a threshold of 0.95 or higher',
          hint: 'Score the events first, then drag the slider all the way right.',
          check: ({ sim, since }) => triedThreshold(sim, since, (v) => v >= 0.95),
        },
        {
          id: 'tried-low',
          label: 'Try a threshold of 0.05 or lower',
          hint: 'Score the events first, then drag the slider all the way left.',
          check: ({ sim, since }) => triedThreshold(sim, since, (v) => v <= 0.05),
        },
        {
          id: 'good-threshold',
          label: 'Leave the threshold where it catches all three attacks with at most one false alert',
          hint: 'Try both ends first. Then look at the scores of the three real attacks and the harmless events right below them. Try between 0.70 and 0.75.',
          check: ({ sim, since }) => {
            const q = siem(sim);
            if (!q.ai || !triedThreshold(sim, since, (v) => v >= 0.95) || !triedThreshold(sim, since, (v) => v <= 0.05)) return false;
            const c = aiCounts(q);
            return c.caught === c.attacks && c.falseAlerts <= 1;
          },
        },
      ],
      questions: [
        {
          id: 'too-high',
          kind: 'choice',
          afterGoals: true,
          prompt: 'What happened with the threshold at 1.00?',
          options: [
            { id: 'misses', text: 'No event became an alert, so the real attacks went unnoticed.', correct: true },
            { id: 'perfect', text: 'It caught every attack and raised no false alarms.', feedback: 'A high bar is picky in the wrong direction: it ignores most events, including real ones.' },
            { id: 'blocks', text: 'It blocked every event to stay safe.', feedback: 'The threshold decides what to alert on, not what to block. A higher bar means fewer alerts.' },
            { id: 'twice', text: 'It scored each event twice to be sure.', feedback: 'The score does not change. Only the line you draw for an alert moves.' },
          ],
          explain: 'A high threshold trusts almost everything, so real attacks go unnoticed. Each one is a false negative.',
        },
        {
          id: 'too-low',
          kind: 'choice',
          afterGoals: true,
          prompt: 'And at 0.00?',
          options: [
            { id: 'drown', text: 'Every event raised an alert, and the real attacks were lost among false ones.', correct: true },
            { id: 'dangerous', text: 'Only the most dangerous events raised an alert.', feedback: 'A low bar is the opposite of picky. Almost everything clears it.' },
            { id: 'stops', text: 'The AI stopped scoring to save effort.', feedback: 'It keeps scoring. You moved the alert line down to the floor.' },
            { id: 'blocks', text: 'It blocked the whole network.', feedback: 'The threshold raises alerts; it does not block. A low bar means far too many alerts.' },
          ],
          explain:
            'A low threshold alerts on everything, so the team gets buried in false positives and misses the few that matter. The organization picks the threshold to balance the two. On a critical network like a water utility, a missed attack costs much more than a false alert.',
        },
      ],
    },

    {
      id: 'ioc-hunt',
      title: 'IoC hunt',
      body: md`
        An **indicator of compromise**, or IoC, is a clue an attack leaves in the logs. Two of these clues come from [[pc2]], which points to malware on Raj's PC.

        Clear your filters, then search for one line of each IoC and open it:

        1. A connection to a **known malicious IP**. A **threat feed** is a shared list of bad addresses. [[fw]] tags a match \`threat-feed\` but still lets it through. This one is \`known-c2\`, a server that sends orders to computers an attacker controls.
        2. An **unauthorized scan**: one outside address trying many ports in a row.
        3. Pings sent to the **broadcast address** \`${BROADCAST}\`, which reaches every device on the network. Ping uses the **ICMP** protocol.
        4. **SSH** on port **443**. Port 443 is the usual port for HTTPS, secure web traffic.

        Signatures have a rule for the first three. The fourth takes a firewall that checks which program is really talking, not only the port number. An attack with no known pattern, like Raj's 3 a.m. upload, needs the anomaly baseline.
      `,
      open: 'logs',
      focus: ['fw', 'pc2'],
      goals: [
        {
          id: 'ioc-badip',
          label: 'Open the connection to a known malicious IP',
          hint: `Search the firewall log for threat-feed, or for ${C2}.`,
          check: openedLog((e) => e.fields?.dst === C2),
        },
        {
          id: 'ioc-scan',
          label: 'Open a line from the unauthorized scan',
          hint: `One source hit dozens of ports. Search for ${SCANNER}.`,
          check: openedLog(
            (e) =>
              e.fields?.src === SCANNER &&
              ((e.source === 'firewall' && e.fields?.action === 'deny' && e.fields?.proto === 'tcp') || (e.source === 'ids' && e.fields?.signature === 'port-scan')),
          ),
        },
        {
          id: 'ioc-icmp',
          label: 'Open an ICMP line sent to the broadcast address',
          hint: `Search for ${BROADCAST}.`,
          check: openedLog((e) => e.fields?.proto === 'icmp' && e.fields?.dst === BROADCAST),
        },
        {
          id: 'ioc-ssh443',
          label: 'Open the SSH-on-443 connection',
          hint: 'Look for a line where the app is ssh but the port is 443. Try searching for app=ssh.',
          check: openedLog((e) => e.fields?.app === 'ssh' && e.fields?.dport === 443),
        },
      ],
      questions: [
        {
          id: 'why-mismatch',
          kind: 'choice',
          prompt: 'Why is SSH running on port 443 a red flag?',
          options: [
            { id: 'hiding', text: 'Port 443 is meant for HTTPS, so another program there is often hiding from firewalls that only check ports.', correct: true },
            { id: 'email', text: 'Port 443 is only ever used for email.', feedback: 'Port 443 is HTTPS, not email. The flag is that SSH is wearing the HTTPS port.' },
            { id: 'banned', text: 'SSH is banned on every network.', feedback: 'SSH is a normal admin tool. The problem is SSH pretending to be web traffic on 443.' },
            {
              id: 'ip',
              text: 'A service’s port must always match its IP address.',
              feedback: 'Ports and IP addresses are different things. The mismatch here is between the port number and the service using it.',
            },
          ],
          explain:
            'A port number is only a label. Attackers put tools on port 443 because basic firewalls let HTTPS through. A mismatch between the port and the real program is a classic IoC. A firewall that looks inside the traffic to see which program is talking catches it.',
        },
        {
          id: 'which-detector',
          kind: 'choice',
          prompt: `Raj's PC connected to ${C2}, an address on the threat feed. At 03:12 it uploaded 90 MB to ${EXFIL}, an address on no list. Which detector fits each?`,
          options: [
            { id: 'split', text: 'The threat-feed match: a signature. The upload to an unknown address: the anomaly baseline.', correct: true },
            {
              id: 'both-sig',
              text: 'Both: a signature, because both addresses are outside the utility.',
              feedback: 'A signature needs a known pattern. No list named the upload address, which is why the signature set missed it in Something new.',
            },
            {
              id: 'both-anomaly',
              text: 'Both: the anomaly baseline, because a threat feed is a kind of baseline.',
              feedback: 'A baseline is a record of this network’s own normal traffic. A threat feed is a list of known-bad addresses, so matching it is signature work.',
            },
            { id: 'swapped', text: 'The threat-feed match: the anomaly baseline. The upload: a signature.', feedback: 'That is backward. A signature matches what is already known, like an address on a list.' },
          ],
          explain:
            'Signatures catch what someone has already seen and written down: a listed address, a scan pattern, a ping to a broadcast address. The anomaly baseline catches what is new or odd for this network, at the cost of some false alerts.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Write it up',
      body: md`
        Write a short report for your supervisor about one attack from last night. Cover three things:

        1. Which attack it was.
        2. The log line or alert that shows it, copied from the Logs tab or a replay's result, with the address or MAC that points to the attacker. An alert from one of this morning's replays counts.
        3. Which detector flagged it, or would have, a signature or the anomaly baseline, and why.
      `,
      open: 'logs',
      questions: [
        {
          id: 'writeup',
          kind: 'text',
          prompt: 'Your report: the attack, the line that shows it, and which detector catches it and why.',
          minWords: 45,
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

        **Next lab:** choosing a method for a network. You test signature, anomaly, and **hybrid** detection, which runs both at once, on three very different clients and recommend one for each.
      `,
    },
  ],
};
