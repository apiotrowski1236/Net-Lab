import { aiCounts } from '../../sim/ids';
import type { Sim } from '../../sim/sim';
import type { LogEntry } from '../../sim/types';
import { loggedSince, openedLog } from '../helpers';
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
const scoreMorning: ActionDef = { id: 'score-morning', label: 'Score this morning’s events', run: (sim) => sim.aiScore('siem', AI_EVENTS) };

/** The incident the SIEM opened overnight from the scanner's lines. */
export const INCIDENT = 1041;

// ---------------------------------------------------------------------------
// Goal checks
// ---------------------------------------------------------------------------

const sensor = (sim: Sim) => sim.dev('nids').ids!.sensor!;
const siem = (sim: Sim) => sim.dev('siem').ids!.siem!;

/** The sensor wrote a line matching `pred` since the step started. */
const sensorLogged = (sim: Sim, since: number, pred: (e: LogEntry) => boolean) => loggedSince(sim, 'nids', since, pred);
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
  version: 2,
  title: 'Log Detective',
  tagline: 'Read a night of logs and tune the detectors until the real attacks stand out from the noise.',
  unit: 3,
  codehs: ['3.18 The Story in the Logs'],
  ced: ['3.5.A', '3.5.B', '3.5.D', '3.5.E'],
  minutes: 45,
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
        You are the new security analyst at Riverbend Water Utility. It runs the treatment plant for the whole city, so the office network is small but it matters. Break into the control room and you reach the plant.

        Every device keeps a **log**, a running record of what it did. [[fw]], [[sw]], the servers [[files]] and [[backup]], the staff computers, and [[plant]] all write lines. One place collects them all: the **SIEM** ([[siem]]), short for security information and event management. It is your console for the whole network.

        Everything here is a simulation of one night at the utility. The attacks already happened. Your job this morning is to find them.

        Open the **Logs** tab. Read a line from each kind of source so you know what each one looks like:

        1. A **firewall** line from [[fw]].
        2. A **switch** line from [[sw]].
        3. A **server** line from [[files]].
        4. A **sensor** line from [[nids]], the intrusion detection sensor on the switch's mirror port.

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
      title: 'A haystack',
      body: md`
        The overnight log holds hundreds of lines here, and a real utility's SIEM would hold millions a day. You cannot read them all. You search and filter instead.

        Something tried to break into [[files]] last night. Find it.

        1. Set the device filter to the Records server.
        2. Check **Warnings and alerts only** to hide the routine lines.
        3. Type \`fail\` in the search box.

        Open one of the failed sign-in lines. Notice they all come from the same address.
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
            { id: 'volume', text: 'A network logs far more lines each day than a person could ever read, so tools surface what matters.', correct: true },
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
        A **NIDS**, a network intrusion detection system, watches traffic and raises an **alert** when it sees something it knows is bad. [[nids]], on the switch's mirror port, is a NIDS. Its rules have been off since 02:00, when a signature update failed. That is why nothing caught the intruder overnight.

        Open the **Detection** controls on [[nids]] and turn on the **signature set**. A signature is a stored pattern for a known attack, the way antivirus knows a known virus.

        Then press **Replay last night's attack**. Watch the forged **ARP** replies cross the switch. An ARP reply tells a device which MAC address goes with an IP. Someone on the network told the other computers that the gateway \`${IP.gateway}\` lives at their MAC. The signature for that fires.
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
            { id: 'pattern', text: 'It matched the traffic against known attack patterns, and a forged ARP reply for the gateway is one of them.', correct: true },
            {
              id: 'learned',
              text: 'It learned the network’s normal behavior and noticed this looked different.',
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
        At 03:12 last night, [[pc2]] in finance sent a large upload to \`${EXFIL}\`. No staffer was in the building. No list of known-bad addresses has ever seen that IP.

        Press **Replay the 3 a.m. upload**. Watch the signature set. It stays silent.
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
            'Signatures only catch what they already know. A brand new attack leaves no known pattern, so it sails through. That gap is a false negative, and it is why networks add a second kind of detection.',
        },
      ],
    },

    {
      id: 'baseline',
      title: 'Baseline',
      body: md`
        **Anomaly-based** detection takes the other approach. First it records a **baseline**, a picture of the network on a clean, normal week: who talks to whom, how much, and at what hours. Then it flags whatever falls outside that picture.

        1. Press **Record a clean-week baseline**.
        2. Set the **tolerance** to **Medium**. Tolerance is how far from normal an event may drift before the sensor alerts. Loose lets more through; Strict flags more.
        3. Turn on **anomaly detection**.
        4. Press **Replay the 3 a.m. upload** again, then **Replay the 2 a.m. backup**.

        The upload trips the alert now: wrong hour, a destination the network never uses, far too much data. But the monthly backup to the offsite vault trips it too. The backup is normal. It runs at 02:00 and moves a lot of data, so it looks odd to the baseline.
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
          label: 'An anomaly alert names the backup',
          hint: 'Replay the 2 a.m. backup after anomaly detection is on.',
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
            { id: 'fatigue', text: 'Analysts burn time on harmless events and start tuning alerts out, so a real one slips past.', correct: true },
            { id: 'stops', text: 'The sensor stops logging until someone clears the alert.', feedback: 'The sensor keeps running. The cost is the analyst’s time and attention, not lost logging.' },
            { id: 'attacker', text: 'A false alert helps the attacker finish faster.', feedback: 'The attacker is not involved in the backup alert. The cost lands on the team watching the screen.' },
            { id: 'none', text: 'None, because the analyst can see it is the backup.', feedback: 'Spotting one is easy. Spotting the hundredth after a long shift is not. That is the real danger.' },
          ],
          explain:
            'Every false alert costs attention. Enough of them and the team learns to ignore the alert, which is called alert fatigue, and a real attack hides in the noise. Anomaly detection suits steady networks for this reason: the quieter the normal, the less it cries wolf.',
        },
      ],
    },

    {
      id: 'nips',
      title: 'From alarm to action',
      body: md`
        A NIDS only warns. A **NIPS**, a network intrusion prevention system, can also act. It can close a switch port, block an IP address or a MAC address, or reject a protocol. The same sensor can do both jobs. You decide whether it may act.

        Turn on **prevention mode**. Then press **Replay the MAC flood**. The intruder's laptop, [[mal]], floods [[sw]] with made-up MAC addresses to make it leak everyone's traffic. In prevention mode the sensor shuts the port the flood came from. The attack stops on its own.

        Now press **Replay the 2 a.m. backup** again. The backup still looks anomalous, so the NIPS blocks [[backup]] at the firewall. A normal backup failed, and no human decided that.
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
          label: 'The NIPS blocks the backup server on a false alert',
          hint: 'Replay the 2 a.m. backup with prevention on and watch what the sensor does to the backup server.',
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
            'Blocking automatically is fast and needs no analyst, which is its strength against a flood at 3 a.m. The cost is that a false positive now causes an outage instead of a wasted click. Teams tune a NIPS carefully and often let it block only the attacks it is most sure of.',
        },
      ],
    },

    {
      id: 'correlate',
      title: 'Connect the dots',
      body: md`
        The SIEM's real power is tying lines together. On their own, a blocked packet, a port scan, and a few failed sign-ins each look minor. The SIEM noticed all three came from one address, \`${SCANNER}\`, within twenty minutes, and opened a single **incident**.

        Open incident **${INCIDENT}** on [[siem]]: filter the Logs tab to the SIEM server and click the \`INCIDENT ${INCIDENT}\` line. Read its three parts: the firewall denies, the port-scan alert, and the failed sign-ins on [[files]] you found earlier.

        Then **triage** it. Decide whether it is a real attack or a false alarm, and whether to escalate it or close it. Pick a **Verdict** and an **Action**, then press **Save triage**. An analyst resolves or escalates every incident by procedure.
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
          label: `Triage incident ${INCIDENT} as a real attack and escalate it`,
          hint: 'One address scanned, got denied, then tried passwords. Is that a mistake or an attack?',
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
              text: 'One address scanned the network, got blocked, then tried passwords on the records server. Together that is a targeted attempt.',
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
            'Correlation turns weak single signals into one story. A scan, a deny, and failed logins from one external IP point at someone probing the utility. You escalate that, instead of closing three loose ends.',
        },
      ],
    },

    {
      id: 'threshold',
      title: 'Set the threshold',
      body: md`
        There is still too much to read by hand. An **AI** model helps: it gives every event a score from 0.00 to 1.00 for how likely it is to be malicious. You set the **threshold**. Any event scored at or above it becomes an alert.

        Press **Score this morning's events**. Then move the threshold slider in [[siem]]'s inspector. Watch the two counters: real attacks caught, and false alerts raised.

        Find a threshold that catches all three real attacks (the ARP poisoning, the 3 a.m. upload, and the overnight scan) without burying you in false alerts.
      `,
      open: { inspect: 'siem' },
      focus: ['siem'],
      tools: [{ kind: 'ai-threshold', device: 'siem' }],
      actions: [scoreMorning],
      goals: [
        { id: 'scored', label: 'Score this morning’s events', hint: 'Press Score this morning’s events.', check: ({ sim }) => !!siem(sim).ai },
        {
          id: 'good-threshold',
          label: 'Set a threshold that catches all three real attacks with few false alerts',
          hint: 'Too high and you miss the scan. Too low and the backup and more noise flood in. Try between 0.70 and 0.75.',
          check: ({ sim }) => {
            const q = siem(sim);
            if (!q.ai) return false;
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
          prompt: 'Set the threshold near 1.00. What happens?',
          options: [
            { id: 'misses', text: 'The sensor alerts on almost nothing, so real attacks get through.', correct: true },
            { id: 'perfect', text: 'It catches every attack and raises no false alarms.', feedback: 'A high bar is picky in the wrong direction: it ignores most events, including real ones.' },
            { id: 'blocks', text: 'It blocks every event to stay safe.', feedback: 'The threshold decides what to alert on, not what to block. A higher bar means fewer alerts.' },
            { id: 'twice', text: 'It scores each event twice to be sure.', feedback: 'The score does not change. Only the line you draw for an alert moves.' },
          ],
          explain: 'A high threshold trusts almost everything, so real attacks slip by as false negatives.',
        },
        {
          id: 'too-low',
          kind: 'choice',
          prompt: 'Now set it near 0.00. What happens?',
          options: [
            { id: 'drown', text: 'Nearly every event raises an alert, and the real attacks drown in false ones.', correct: true },
            { id: 'dangerous', text: 'Only the most dangerous events raise an alert.', feedback: 'A low bar is the opposite of picky. Almost everything clears it.' },
            { id: 'stops', text: 'The AI stops scoring to save effort.', feedback: 'It keeps scoring. You moved the alert line down to the floor.' },
            { id: 'blocks', text: 'It blocks the whole network.', feedback: 'The threshold raises alerts; it does not block. A low bar means far too many alerts.' },
          ],
          explain:
            'A low threshold alerts on everything, so the team drowns in false positives and misses the few that matter. The organization picks the threshold to balance the two, and a critical network like a water utility leans toward catching more and tolerating some false alerts.',
        },
      ],
    },

    {
      id: 'ioc-hunt',
      title: 'IoC hunt',
      body: md`
        An **indicator of compromise**, or IoC, is a fingerprint an attack leaves behind. Now that you know what the night held, hunt the logs for one line that shows each IoC. Use the device filter and the search box.

        Find and open:

        1. A connection to a **known malicious IP** (one the threat feed flagged).
        2. An **unauthorized scan** (one source hitting many ports).
        3. A **spike of ICMP** sent to the broadcast address \`${BROADCAST}\`.
        4. **SSH running on port 443**, where the service and the port do not match.
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
            { id: 'hiding', text: 'Port 443 is meant for HTTPS, so another service there is often hiding from simple port filters.', correct: true },
            { id: 'email', text: 'Port 443 is only ever used for email.', feedback: 'Port 443 is HTTPS, not email. The flag is that SSH is wearing the HTTPS port.' },
            { id: 'banned', text: 'SSH is banned on every network.', feedback: 'SSH is a normal admin tool. The problem is SSH pretending to be web traffic on 443.' },
            {
              id: 'ip',
              text: 'A service’s port must always match its IP address.',
              feedback: 'Ports and IP addresses are different things. The mismatch here is between the port number and the service using it.',
            },
          ],
          explain:
            'A port number is only a label. Attackers put tools on port 443 because basic firewalls wave HTTPS through. A mismatch between the port and the real application is a classic IoC, and a next-generation firewall that inspects the application catches it.',
        },
      ],
    },

    {
      id: 'reflect',
      title: 'Write it up',
      body: md`
        Write a short report for your shift lead.

        **Next lab:** choosing a method for a network. In Pick Your Detector you test signature, anomaly, and hybrid detection on three very different clients and recommend one for each.
      `,
      questions: [
        {
          id: 'writeup',
          kind: 'text',
          prompt:
            'Name one attack you found in the utility’s logs last night. Cite the exact log line or alert that shows it, with the address or MAC that gives it away. Then say which detector flagged it or would have, a signature or the anomaly baseline, and why.',
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
        Look over your summary on the right. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
  ],
};
