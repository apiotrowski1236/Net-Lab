import { analystFound, planCost, type BenchRun } from '../../sim/bench';
import type { Sim } from '../../sim/sim';
import { inspected, openedLog } from '../helpers';
import { md } from '../md';
import type { ActionDef, LabDef } from '../types';
import {
  BEACON,
  BENCH,
  bench,
  BUDGET,
  buildDetect,
  DISPATCH,
  DISPATCH_BASE,
  LEAK,
  LOCKDOWN,
  OCT,
  PLANT,
  PLANT_CLEAN,
  PLANT_INFECTED,
  RENAMED,
  RENAMED_FILE,
  STREAM,
  STREAM_BASE,
  TODAY,
  zones,
} from './scenario';

// ---------------------------------------------------------------------------
// Goal checks: read the bench's runs, never the buttons
// ---------------------------------------------------------------------------

/** A run of `client` that started in this step, finished, and matches. */
const ranSince = (sim: Sim, since: number, client: string, pred: (r: BenchRun) => boolean = () => true) =>
  bench(sim).runs.some((r) => r.client === client && r.startedAt >= since && !!r.result && pred(r));

const caught = (r: BenchRun, attack: string) => !!r.result?.caught.some((c) => c.attack === attack);
const missed = (r: BenchRun, attack: string) => !!r.result?.missed.includes(attack);
const usesAnomaly = (r: BenchRun) => r.method !== 'signature';

// ---------------------------------------------------------------------------
// Setups: fill in what a step needs if the student skipped ahead, and keep
// the student's own choices otherwise
// ---------------------------------------------------------------------------

function anomalyOn(sim: Sim, client: string): void {
  if (bench(sim).settings[client].method === 'signature') sim.benchSet(BENCH, client, { method: 'anomaly' });
}

function baselineFrom(sim: Sim, client: string, day: string): void {
  if (!bench(sim).settings[client].baseline) sim.benchRecordBaseline(BENCH, client, day);
}

/** StreamCo's newest run left the copied shows closed unread. If not, set ±25% and run it. */
function fatigueRun(sim: Sim): void {
  anomalyOn(sim, STREAM);
  baselineFrom(sim, STREAM, STREAM_BASE);
  const b = bench(sim);
  const last = [...b.runs].reverse().find((r) => r.client === STREAM);
  const shows = last?.result?.alerts.find((a) => a.attack === LEAK);
  if (shows?.queue === 'closed') return;
  if (b.settings[STREAM].tolerance > 50) sim.benchSet(BENCH, STREAM, { tolerance: 25 });
  sim.benchRun(BENCH, STREAM);
}

// ---------------------------------------------------------------------------
// The lesson's button
// ---------------------------------------------------------------------------

const renameFile: ActionDef = {
  id: 'rename',
  label: 'Load the day with LockDown repacked',
  run: (sim) => sim.benchSetDay(BENCH, DISPATCH, RENAMED),
  outcome: (sim) =>
    bench(sim).settings[DISPATCH].day === RENAMED
      ? [{ tone: 'good', text: `The bench now replays Nov 12 with LockDown repacked. Its file’s hash is now ${RENAMED_FILE.replace('hash ', '')}.` }]
      : [{ tone: 'wait', text: 'Loading…' }],
};

const ALL = ['signature', 'anomaly', 'hybrid'] as const;

export const detectMethodsLab: LabDef = {
  id: 'detect-methods',
  version: 1,
  title: 'Pick Your Detector',
  tagline: 'Run three detection methods against three very different networks, count what each one catches and misses, and recommend one for each client within budget.',
  unit: 3,
  codehs: ['3.16 Choosing Between Detection Methods', '3.17 Evaluating Detection Methods'],
  ced: ['3.5.C', '3.5.D'],
  minutes: 45,
  objectives: [
    'Run signature, anomaly, and hybrid detection on recorded traffic and compare what each one catches and misses.',
    'Explain why a signature database needs updates and why a baseline must come from an uncompromised day.',
    'Judge a detection method by speed, cost, false positives, and false negatives, including alert fatigue.',
    'Recommend a detection method for a network from its traffic volume, its consistency, and how critical it is.',
  ],
  build: buildDetect,
  map: { zones, addresses: false },
  deviceTables: false,
  steps: [
    {
      id: 'clients',
      title: 'Three clients',
      body: md`
        You work at **Harbor Light Security**, a **managed security company**: other organizations pay it to watch their networks for attacks. Three new clients each need a detection plan, and your boss has **$5,400 a month** to run detection for all three.

        Each client's network is on the map. A sensor plugged into each network's switch gets a copy of all its traffic and records whole days of it.

        - [[sc-net]]: StreamCo streams shows to about 2 million viewers.
        - [[rb-net]]: Riverbend Bottling runs the machines on a bottling line.
        - [[cd-net]]: County 911 Dispatch answers emergency calls.

        Your company's [[bench]] replays a recorded day through a detection method and scores it. You will test methods there before you spend any client's money.

        Click each client's network on the map and read its notes. Then click [[bench]].
      `,
      focus: ['sc-net', 'rb-net', 'cd-net', BENCH],
      goals: [
        { id: 'stream', label: 'Read about [[sc-net]]', check: inspected('sc-net') },
        { id: 'plant', label: 'Read about [[rb-net]]', check: inspected('rb-net') },
        { id: 'dispatch', label: 'Read about [[cd-net]]', check: inspected('cd-net') },
        { id: 'bench', label: 'Read about [[bench]]', check: inspected(BENCH) },
      ],
      questions: [
        {
          id: 'steady',
          kind: 'choice',
          prompt: 'Which client’s traffic looks the most alike from one hour to the next?',
          options: [
            {
              id: 'stream',
              text: 'StreamCo',
              feedback: 'StreamCo’s traffic swings all day. A new season or a big game can double it in an hour.',
            },
            { id: 'plant', text: 'Riverbend Bottling', correct: true },
            {
              id: 'dispatch',
              text: 'County 911 Dispatch',
              feedback: 'Calls come in waves, so 911’s traffic rises and falls. The bottling machines send the same messages every few seconds, all day.',
            },
            { id: 'same', text: 'All three are about the same', feedback: 'Read the notes again. One network is machines repeating themselves, and one changes by the hour.' },
          ],
          explain:
            'Riverbend’s machines repeat the same messages all day, every day. Keep that in mind: how steady a network’s traffic is decides which detection method works there.',
        },
      ],
    },

    {
      id: 'signatures',
      title: 'Signatures on StreamCo',
      body: md`
        Start with the method you used in Log Detective. **Signature-based detection** compares traffic with a database of known **indicators of compromise** (IoCs): details that known attacks leave behind, such as a file's **hash** (a fingerprint computed from every byte of the file), a program name, or a web address. A match raises an alert.

        StreamCo's sensor sees about 900,000 connections a minute. The [[bench]] has StreamCo's recording from Nov 12, a day with three attacks in it.

        In the bench card, press **Run signature on Nov 12**. Read the result: which attacks it caught and how fast, how many false alarms it raised, and what it costs.
      `,
      open: 'tools',
      focus: [BENCH, 'sc-net'],
      tools: [{ kind: 'bench', device: BENCH, clients: [STREAM], methods: ['signature'], controls: [] }],
      goals: [
        {
          id: 'run',
          label: 'Run signature detection on StreamCo’s day',
          hint: 'Press Run signature on Nov 12 in the bench card.',
          check: ({ sim, since }) => ranSince(sim, since, STREAM, (r) => r.method === 'signature'),
        },
      ],
      questions: [
        {
          id: 'quiet',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Signature detection raised no false alarms on StreamCo, even with 900,000 connections a minute. Why so few?',
          options: [
            { id: 'match', text: 'It alerts only on a known attack’s details, and normal traffic almost never has them.', correct: true },
            { id: 'skip', text: 'It skips most of the traffic so it can keep up with StreamCo.', feedback: 'It checks every connection. Looking up a detail in a list is quick, so it keeps up anyway.' },
            {
              id: 'calm',
              text: 'StreamCo’s traffic happened to stay normal all day on Nov 12.',
              feedback: 'Nov 12 had big swings in traffic. Signature detection doesn’t care how much traffic there is, only whether a detail matches.',
            },
            { id: 'off', text: 'The bench turns off alerts on very busy networks.', feedback: 'Alerts stay on however busy the network is. It caught StuffBot within seconds.' },
          ],
          explain:
            'A signature matches one specific detail of a known attack, so ordinary traffic almost never sets it off. (A badly written signature can still raise false alarms.) That makes signature detection quiet and fast, even at high volume.',
        },
      ],
    },

    {
      id: 'update',
      title: 'Update the database',
      body: md`
        Two attacks slipped through. One was **VidJack**, a video player attack first seen in October. The bench still has the **September 2026** database, so it has no signature for VidJack.

        A signature database only knows the attacks someone has already found and described. It has to be **updated** to keep up.

        1. Press **Install the October 2026 update**.
        2. Run signature detection again, and compare the new row in the table with the first.
      `,
      open: 'tools',
      focus: [BENCH],
      tools: [{ kind: 'bench', device: BENCH, clients: [STREAM], methods: ['signature'], controls: ['db'] }],
      goals: [
        { id: 'install', label: 'Install the October 2026 update', hint: 'The button is next to the signature database.', check: ({ sim }) => bench(sim).db === OCT },
        {
          id: 'rerun',
          label: 'Run signature detection with the October database',
          hint: 'Press Run signature on Nov 12 again.',
          check: ({ sim, since }) => ranSince(sim, since, STREAM, (r) => r.method === 'signature' && r.db === OCT),
        },
      ],
      questions: [
        {
          id: 'zero-day',
          kind: 'choice',
          afterGoals: true,
          prompt: 'With the October update, the bench still missed the unreleased shows being copied out of the content library. Why can’t any signature catch this one yet?',
          options: [
            { id: 'new', text: 'Nobody has seen this attack before, so no signature describes it.', correct: true },
            {
              id: 'size',
              text: 'The database is too small. A bigger one would have it.',
              feedback: 'A signature is written after someone finds and studies an attack. No database has one for an attack nobody has seen.',
            },
            { id: 'slow', text: 'Signature detection is too slow for StreamCo’s traffic.', feedback: 'It caught the other two attacks in 6 seconds. Speed isn’t the problem.' },
            { id: 'night', text: 'The bench turns signatures off at night to save money.', feedback: 'Signatures run all day. StuffBot came in the morning and was caught within seconds.' },
          ],
          explain:
            'A signature only exists after someone finds and studies an attack, so a brand-new attack has none yet. The best-known case is a **zero-day**: an attack on a software flaw that nobody knew about until attackers used it. Updates help with last month’s attacks, not today’s new ones.',
        },
      ],
    },

    {
      id: 'baseline',
      title: 'Learn normal at the plant',
      body: md`
        **Anomaly-based detection** works the other way around. First it records a **baseline**: how much of each kind of traffic is normal, measured on a day when nothing was wrong.

        Then it alerts on two things: any kind of traffic the baseline never saw, and traffic outside a **tolerance range** around normal. A tolerance of ±25% means up to 25% more or less than normal is fine.

        Riverbend's machines send the same messages all day. The [[bench]] has two older recordings of the plant, from Sep 14 and Nov 9.

        1. Under **Record a baseline from**, press **Sep 14**.
        2. Press **Run anomaly on Nov 12**. (The tolerance is set to ±25%.)
      `,
      setup: (sim) => anomalyOn(sim, PLANT),
      open: 'tools',
      focus: [BENCH, 'rb-net'],
      tools: [{ kind: 'bench', device: BENCH, clients: [PLANT], methods: ['anomaly'], controls: ['baseline'] }],
      goals: [
        {
          id: 'record',
          label: 'Record Riverbend’s baseline from Sep 14',
          hint: 'In the bench card, under Record a baseline from, press Sep 14.',
          check: ({ sim }) => bench(sim).settings[PLANT].baseline?.day === PLANT_CLEAN,
        },
        {
          id: 'catch',
          label: 'Run anomaly detection on Riverbend and catch the new attack',
          hint: 'Press Run anomaly on Nov 12 after recording the Sep 14 baseline.',
          check: ({ sim, since }) => ranSince(sim, since, PLANT, (r) => r.baselineDay === PLANT_CLEAN && caught(r, BEACON)),
        },
      ],
      questions: [
        {
          id: 'why-caught',
          kind: 'choice',
          afterGoals: true,
          prompt: 'No signature describes this attack, but anomaly detection caught the filler controller calling an outside server. What made it stand out?',
          options: [
            { id: 'new', text: 'On Sep 14 the controller never talked to the internet, so this traffic was new.', correct: true },
            { id: 'big', text: 'It sent far more data than the controller usually sends.', feedback: 'Read the alert in the run: it says “new kind of traffic.” It stood out because it was new, not because it was big.' },
            { id: 'port', text: 'Port 4444 is on a list of ports that attackers use.', feedback: 'A list of known bad details is a signature. Anomaly detection has no list, only the baseline.' },
            { id: 'name', text: 'The outside server’s address matched a known attacker.', feedback: 'Matching a known address is how a signature works. Anomaly detection compared the day with the baseline.' },
          ],
          explain:
            'Anomaly detection asks “is this normal for this network?” instead of “is this a known attack?” On a network as steady as Riverbend’s, anything new stands out, so it can catch an attack nobody has a signature for.',
        },
      ],
    },

    {
      id: 'bad-baseline',
      title: 'A newer baseline',
      body: md`
        A coworker says the **Nov 9** recording is newer, so it should make a better baseline. Before you decide, here's what Riverbend's IT team found later: the [[rb-filler]] was infected on **Nov 3**.

        1. Record a baseline from **Nov 9**.
        2. Run anomaly detection and compare the result with your Sep 14 run.
      `,
      setup: (sim) => anomalyOn(sim, PLANT),
      open: 'tools',
      focus: [BENCH, 'rb-filler'],
      tools: [{ kind: 'bench', device: BENCH, clients: [PLANT], methods: ['anomaly'], controls: ['baseline'] }],
      goals: [
        {
          id: 'nov9',
          label: 'Run with the Nov 9 baseline',
          hint: 'Press Nov 9 under Record a baseline from, then run.',
          check: ({ sim, since }) => ranSince(sim, since, PLANT, (r) => r.baselineDay === PLANT_INFECTED),
        },
      ],
      questions: [
        {
          id: 'why-missed',
          kind: 'choice',
          afterGoals: true,
          prompt: 'The Nov 9 baseline missed the attack. Why?',
          options: [
            { id: 'infected', text: 'The controller was already infected on Nov 9, so the baseline learned the attack as normal.', correct: true },
            { id: 'recent', text: 'A baseline from the same month as the attack doesn’t count.', feedback: 'The date doesn’t matter. What matters is whether the network was clean that day.' },
            { id: 'tight', text: 'The tolerance was too tight for the Nov 9 baseline.', feedback: 'Both runs used ±25%. Only the baseline day changed.' },
            { id: 'short', text: 'The Nov 9 recording was too short to learn from.', feedback: 'Both recordings are full days. The Nov 9 one already had the attacker’s traffic in it.' },
          ],
          explain:
            'The controller was infected on Nov 3, so the Nov 9 baseline already had the attacker’s traffic in it as “normal.” A baseline must come from a time when the systems were **uncompromised**, or anomaly detection learns to ignore the attack.',
        },
      ],
    },

    {
      id: 'anomaly-stream',
      title: 'Anomaly on StreamCo',
      body: md`
        Anomaly detection worked well at the plant. Now try it on StreamCo.

        1. Choose **Anomaly**.
        2. Record a baseline from **Nov 5**, a clean day.
        3. Set the tolerance to ±25% and run it.

        Compare the new row in the table with your signature runs. Anomaly detection has to add up each kind of traffic over time and compare the totals with the baseline before a change counts as unusual. Signatures check each connection as it passes.
      `,
      open: 'tools',
      focus: [BENCH, 'sc-net'],
      tools: [{ kind: 'bench', device: BENCH, clients: [STREAM], methods: ['signature', 'anomaly'], controls: ['baseline', 'tolerance'] }],
      goals: [
        {
          id: 'run',
          label: 'Run anomaly detection on StreamCo with the Nov 5 baseline',
          hint: 'Choose Anomaly, record the Nov 5 baseline, pick ±25%, and run.',
          check: ({ sim, since }) => ranSince(sim, since, STREAM, (r) => r.method === 'anomaly' && r.tolerance <= 50 && r.baselineDay === STREAM_BASE),
        },
      ],
      questions: [
        {
          id: 'speed',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Signatures flagged StuffBot within 6 seconds. Anomaly detection took almost 8 minutes to flag the copied shows. Why is it so much slower on StreamCo?',
          options: [
            {
              id: 'work',
              text: 'It has to add up traffic over time and compare the totals with the baseline.',
              correct: true,
            },
            { id: 'analyst', text: 'It waits for an analyst to approve each alert first.', feedback: 'Neither method waits for a person. The time is the computer’s work.' },
            { id: 'hidden', text: 'The copied shows were hidden better than StuffBot was.', feedback: 'The copy was large, so it showed up in the totals. The delay comes from adding up traffic before the totals look unusual.' },
            { id: 'old', text: 'Anomaly detection runs on older computers than signatures.', feedback: 'It runs on more expensive computers, not older ones, and it is still slower.' },
          ],
          explain:
            'A signature check happens as each connection passes. Anomaly detection has to collect traffic for a while before a total looks unusual, and on a network as busy as StreamCo’s that adds minutes. Notice what it missed, too: StreamCo’s sign-in traffic swings so much that StuffBot’s extra logins stayed inside ±25%.',
        },
        {
          id: 'cost',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Anomaly detection costs StreamCo $9,000 a month. Signatures cost $2,000. Why the difference?',
          options: [
            { id: 'hardware', text: 'Measuring that much traffic against a baseline needs more powerful, costlier computers.', correct: true },
            { id: 'newer', text: 'Anomaly detection is newer, so companies charge more for it.', feedback: 'Both methods are decades old. The cost comes from the computing power it needs.' },
            { id: 'alerts', text: 'The client pays a fee for every false alarm.', feedback: 'False alarms cost analyst time, not a fee. The monthly price is for the hardware.' },
            { id: 'daily', text: 'The baseline has to be recorded again every single day.', feedback: 'A baseline is recorded once and reused. The price is the hardware that compares traffic with it.' },
          ],
          explain: 'On this bench, anomaly detection needs more powerful computers to keep up with StreamCo’s traffic, so it costs more. The busier the network, the bigger the gap.',
        },
      ],
    },

    {
      id: 'fatigue',
      title: 'Alert fatigue',
      body: md`
        Every alert goes to an analyst, who checks it before anyone acts. Checking one takes about 5 minutes. Most of StreamCo's alerts were **false positives**: normal swings in traffic that crossed the tolerance line. A **false negative** is the opposite: a real attack that raised no alert.

        The **Analyst queue** in the bench card shows what happened to your newest StreamCo run. After five false alarms in a row, the analyst started closing alerts without reading them. This is **alert fatigue**.

        1. In the queue, find the 14:20 alert from [[sc-library]], marked **closed unread**, and click it.
        2. Change the tolerance and run again until the analyst finds the copied shows.
        3. Then try ±200%.
      `,
      setup: fatigueRun,
      open: 'tools',
      focus: [BENCH, 'sc-library'],
      tools: [
        { kind: 'bench', device: BENCH, clients: [STREAM], methods: ['anomaly'], controls: ['tolerance'], queue: true },
        { kind: 'logs', devices: [BENCH] },
      ],
      goals: [
        {
          id: 'closed',
          label: 'Open the real alert the analyst closed unread',
          hint: 'In the analyst queue, click the 14:20 Content library row marked closed unread.',
          check: openedLog((e) => e.device === BENCH && e.fields?.attack === LEAK && e.fields?.queue === 'closed'),
        },
        {
          id: 'found',
          label: 'Run at a tolerance where the analyst finds the copied shows',
          hint: 'Fewer false alarms means the analyst keeps reading. Try a wider tolerance.',
          check: ({ sim, since }) => ranSince(sim, since, STREAM, (r) => usesAnomaly(r) && !!r.result && analystFound(r.result, LEAK)),
        },
        {
          id: 'too-wide',
          label: 'Run at a tolerance so wide the bench misses the copied shows',
          hint: 'Try ±200%.',
          check: ({ sim, since }) => ranSince(sim, since, STREAM, (r) => usesAnomaly(r) && missed(r, LEAK)),
        },
      ],
      questions: [
        {
          id: 'why-closed',
          kind: 'choice',
          afterGoals: true,
          prompt: 'At ±25%, the bench caught the copied shows, but the analyst closed that alert unread. Why?',
          options: [
            { id: 'fatigue', text: 'Dozens of false alarms came first, so the analyst stopped reading alerts.', correct: true },
            { id: 'none', text: 'The bench never raised an alert for the copied shows.', feedback: 'It did, at 14:20. The bench caught it, and the person missed it.' },
            { id: 'late', text: 'The alert came in after the analyst’s shift had ended.', feedback: 'The analyst was still working the queue. They had stopped reading alerts.' },
            { id: 'low', text: 'The bench marked the alert as low priority.', feedback: 'Every alert looked the same in the queue. After many false ones in a row, the analyst stopped checking.' },
          ],
          explain:
            'False positives cost time, and too many of them cause **alert fatigue**: people stop checking, and a real alert gets closed with the rest. A wider tolerance cuts false alarms, until it gets so wide that it misses the attack.',
        },
        {
          id: 'false-negative',
          kind: 'choice',
          afterGoals: true,
          prompt: 'At ±200%, the bench raised no false alarms and missed the copied shows. What is that miss called, and what does it cost?',
          options: [
            { id: 'fp-time', text: 'A false positive: the analyst wastes 5 minutes on it.', feedback: 'A false positive is an alert with no attack. This is the opposite: an attack with no alert.' },
            { id: 'fn-time', text: 'A false negative: the analyst wastes 5 minutes on it.', feedback: 'It is a false negative, but there is no alert to check. The cost is the attack itself.' },
            { id: 'fn-loss', text: 'A false negative: the shows leak out, and nobody knows.', correct: true },
            { id: 'fp-loss', text: 'A false positive: the shows leak out, and nobody knows.', feedback: 'The cost is right. An attack with no alert is a false negative.' },
          ],
          explain:
            'A **false negative** is an attack the detector missed. It costs the most: the attacker gets past, and the result can be loss, harm, or disruption that nobody notices until too late.',
        },
      ],
    },

    {
      id: 'hybrid',
      title: 'Both at once for 911',
      body: md`
        County 911 can't afford to miss anything. **Ransomware**, malware that locks a computer's files until someone pays, could lock the dispatch server and delay police, fire, and ambulances. **Hybrid detection** runs signature and anomaly detection together.

        1. Run **Signature** on Nov 12.
        2. Choose **Anomaly**, record a baseline from **Nov 4**, and run.
        3. Choose **Hybrid** and run.
        4. Compare the three rows in the table.
      `,
      open: 'tools',
      focus: [BENCH, 'cd-net'],
      tools: [{ kind: 'bench', device: BENCH, clients: [DISPATCH], methods: [...ALL], controls: ['baseline', 'tolerance'] }],
      goals: [
        {
          id: 'baseline',
          label: 'Record County 911’s baseline from Nov 4',
          hint: 'Choose Anomaly to see the baseline buttons, then press Nov 4.',
          check: ({ sim }) => bench(sim).settings[DISPATCH].baseline?.day === DISPATCH_BASE,
        },
        ...ALL.map((m) => ({
          id: m,
          label: `Run ${m} detection on County 911`,
          hint: `Choose ${m[0].toUpperCase() + m.slice(1)}, then press Run.`,
          check: ({ sim, since }: { sim: Sim; since: number }) =>
            ranSince(sim, since, DISPATCH, (r) => r.method === m && r.day === TODAY && (m === 'signature' || r.baselineDay === DISPATCH_BASE)),
        })),
      ],
      questions: [
        {
          id: 'hybrid-cost',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Hybrid caught both attacks, and caught LockDown in about a second. What did it cost compared with the other two?',
          options: [
            { id: 'most', text: 'The most per month, and the most alerts to check.', correct: true },
            { id: 'shared', text: 'Less than anomaly, because the two share hardware.', feedback: 'Check the Cost column. Hybrid runs both methods, so it costs the most.' },
            { id: 'same', text: 'The same as signature, with fewer alerts.', feedback: 'Check the table: hybrid costs more than either, and raises every alert both methods raise.' },
            { id: 'quiet', text: 'The most per month, but the fewest alerts.', feedback: 'The cost is right. But hybrid raises every alert either method raises, so it has the most.' },
          ],
          explain:
            'Hybrid combines the two: signatures catch known attacks in seconds, and anomaly detection catches new ones. It raises every alert either method raises, so one attack can raise two alerts. It is the most expensive method and raises the most alerts, which suits a sensitive or critical network that can afford it.',
        },
      ],
    },

    {
      id: 'bypass',
      title: 'Get past the signatures',
      body: md`
        An attacker who knows about a signature can change the detail it looks for. LockDown's signature matches its file's hash. Changing a few bytes and repacking the file gives it a new hash, even though the program does the same thing.

        Press **Load the day with LockDown repacked**. Then:

        1. Run **Signature** on it.
        2. Run **Anomaly** or **Hybrid** on it.
        3. Open the **Logs** tab, check **Alerts only**, and click the anomaly alert from the [[cd-console]] on port 445.
      `,
      setup: (sim) => baselineFrom(sim, DISPATCH, DISPATCH_BASE),
      actions: [renameFile],
      open: 'tools',
      focus: [BENCH, 'cd-console'],
      tools: [
        { kind: 'bench', device: BENCH, clients: [DISPATCH], methods: [...ALL], controls: ['tolerance'] },
        { kind: 'logs', devices: [BENCH] },
      ],
      goals: [
        {
          id: 'renamed-sig',
          label: 'Run signature detection on the repacked attack',
          hint: 'Press the button in the lesson first, then choose Signature and run.',
          check: ({ sim, since }) => ranSince(sim, since, DISPATCH, (r) => r.day === RENAMED && r.method === 'signature'),
        },
        {
          id: 'renamed-anom',
          label: 'Catch the repacked attack with anomaly or hybrid detection',
          hint: 'Choose Anomaly or Hybrid and run.',
          check: ({ sim, since }) => ranSince(sim, since, DISPATCH, (r) => r.day === RENAMED && usesAnomaly(r) && caught(r, LOCKDOWN)),
        },
        {
          id: 'open',
          label: 'Open the alert that caught LockDown in the Logs tab',
          hint: 'Check Alerts only, then click the newest anomaly alert that names the Dispatcher console and port 445.',
          check: openedLog((e) => e.device === BENCH && e.fields?.attack === LOCKDOWN && e.fields?.day === RENAMED),
        },
      ],
      questions: [
        {
          id: 'easier',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Which method takes less work for an attacker to get past, and why?',
          options: [
            { id: 'sig', text: 'Signature: changing one detail, like a few bytes of the file, is enough.', correct: true },
            { id: 'anom-rename', text: 'Anomaly: repacking a file makes the traffic look normal.', feedback: 'A new hash didn’t change what the program did, so anomaly detection still caught it.' },
            { id: 'sig-fast', text: 'Signature: it runs too fast to look at every file.', feedback: 'It looks at every file. It missed this one because no signature matches the new hash.' },
            { id: 'anom-tol', text: 'Anomaly: its tolerance lets most attacks through.', feedback: 'Tolerance lets normal swings through. LockDown’s traffic to the dispatch server was a kind the baseline had never seen.' },
          ],
          explain:
            'Signatures take less work to get past: an attacker changes the detail the signature looks for, and the attack becomes a false negative. Anomaly detection watches what the traffic does, which is harder to disguise.',
        },
        {
          id: 'when',
          kind: 'text',
          prompt: 'In the alert you opened, at what time on Nov 12 did anomaly detection catch LockDown? The time is in the message, after the word anomaly. (The Time column shows when the bench wrote the line, not the time on Nov 12.) Answer as hh:mm.',
          afterGoals: true,
          expect: /^\D*10\s*[:.h ]?\s*42\b/i,
          expectHint: 'Open the anomaly alert for the Dispatcher console in the Logs tab. The time comes right after the word anomaly.',
          lines: 1,
        },
      ],
    },

    {
      id: 'recommend',
      title: 'Recommend a plan',
      body: md`
        Time to choose. In the **Detection plan** card, pick one method for each client. The total has to fit the $5,400 budget.

        Use what the bench showed you. Think about each network's traffic: how much there is, how steady it is, and how bad a missed attack would be. The bench card has every run you made if you want to look again.

        Then write your recommendation for your boss.
      `,
      open: 'tools',
      focus: [BENCH],
      tools: [
        { kind: 'bench-plan', device: BENCH },
        { kind: 'bench', device: BENCH, clients: [STREAM, PLANT, DISPATCH], methods: [...ALL], controls: ['baseline', 'tolerance'] },
      ],
      goals: [
        {
          id: 'budget',
          label: 'Choose a method for every client, within the $5,400 budget',
          check: ({ sim }) => {
            const b = bench(sim);
            return b.config.clients.every((c) => b.plan[c.id]) && planCost(b) <= BUDGET;
          },
        },
        {
          id: 'stream',
          label: 'StreamCo’s method fits its traffic volume',
          hint: 'Compare StreamCo’s runs: false alarms, time to detect, and cost.',
          check: ({ sim }) => bench(sim).plan[STREAM] === 'signature',
        },
        {
          id: 'plant',
          label: 'Riverbend’s method fits how steady its traffic is',
          hint: 'Which method caught the filler controller calling out?',
          check: ({ sim }) => bench(sim).plan[PLANT] === 'anomaly' || bench(sim).plan[PLANT] === 'hybrid',
        },
        {
          id: 'dispatch',
          label: 'County 911’s method fits how critical it is',
          hint: 'Which method caught LockDown in a second and the radio leak too?',
          check: ({ sim }) => bench(sim).plan[DISPATCH] === 'hybrid',
        },
      ],
      questions: [
        {
          id: 'writeup',
          kind: 'text',
          prompt:
            'Write your recommendation. For each client, name the method you chose and give one reason, with a number from the bench: attacks caught or missed, false alarms, time to detect, or cost.',
          minWords: 45,
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

