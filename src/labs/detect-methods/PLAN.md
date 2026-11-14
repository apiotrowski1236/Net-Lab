# Spec: Pick Your Detector (`detect-methods`)

Split from `logs` (see `docs/unit3/SUITE-PLAN.md`). Slot 14 of 17, right after Log Detective.

- **Title:** Pick Your Detector
- **Tagline (draft):** Run three detection methods against three very different networks, count what each one catches and misses, and recommend one for each client within budget.
- **CodeHS:** 3.16 Choosing Between Detection Methods, 3.17 Evaluating Detection Methods (including 3.17.2 Signature vs Anomaly Simulation, 3.17.3 Alert Fatigue, 3.17.4 False Negatives, 3.17.6 to 3.17.8 Recommend a Detection Strategy, 3.17.9 Zero-Day Blindspot)
- **CED:** 3.5.C.1 to 3.5.C.4 and 3.5.D.1 to 3.5.D.4, all hands-on
- **Minutes:** 45. **Steps:** 10 or 11.
- **Prerequisites:** Log Detective (NIDS, NIPS, SIEM, signatures, baselines, false positives, the AI threshold). Don't re-define these; use them.

## Why this lab

Choosing a detection method (3.5.C) and judging its impact (3.5.D) are two learning objectives with eight EKs and two CodeHS lessons. Today they are one step of `logs` ("Pick a method", three choice questions). Speed (3.5.D.1) and cost (3.5.D.2) are one sentence. Hybrid (3.5.C.3) is one choice question. The CED's criteria are concrete and testable, so students can measure them instead of memorizing them:

- Volume: signature is more efficient and faster on high-volume networks (3.5.C.1, D.1).
- Consistency: anomaly needs consistent traffic and a baseline recorded on an uncompromised system, with a tolerance range (3.5.C.2).
- Criticality: hybrid for sensitive or critical networks; most expensive, most alerts (3.5.C.3, D.2).
- Novel attacks: signatures can't see a new attack; anomaly is preferred when hybrid costs too much (3.5.C.4). Signature databases must be updated (3.5.C.1).
- False positives cost time and cause alert fatigue (3.5.D.3); false negatives let adversaries through, and signatures are easier to bypass (3.5.D.4).

## Story

Students work at a small **managed security company** that watches other organizations' networks. Three clients each need a detection plan:

- **StreamCo**, a video streaming company: huge traffic volume that changes all day.
- **Riverbend Bottling**, a bottling plant's control network: the same machines send the same messages every few seconds, all day.
- **County 911 Dispatch**: critical; an outage could cost lives.

There is a monthly budget for all three. A **detection bench** replays a recorded day of each client's traffic through a chosen method and scores it.

## Steps (outline)

1. **Three clients** (tour). The three networks on the map (zones), the budget, the bench. Question: which client's traffic is most consistent?
2. **Signatures on StreamCo.** Run signature detection on StreamCo's day. Scoreboard: fast, cheap, almost no false positives, catches the two known attacks, misses one attack that is new. 3.5.C.1, D.1, D.3.
3. **Update the database.** Install last month's signature update. Rerun: an attack from last month is now caught; today's new one still isn't. Question: why signatures can never catch a brand-new attack (3.5.C.4, "zero-day").
4. **Learn normal at the plant.** Record a baseline on Riverbend's day, set a tolerance, run anomaly detection. It catches the new attack (a controller suddenly talking to the internet) with few false positives, because the traffic is steady. 3.5.C.2.
5. **A bad baseline.** A second baseline was recorded on a day the plant was already infected. Anomaly treats the infection as normal and misses it. Re-record on a clean day. Question: why baselines must come from an uncompromised system.
6. **Anomaly on StreamCo.** Run anomaly on StreamCo: slower, needs costlier hardware, and false positives pile up because the traffic varies so much. 3.5.C.1, D.1, D.2.
7. **Alert fatigue.** An analyst queue: the analyst has an hour and the queue fills with false positives. The real alert is in there. Show what happens when an analyst starts dismissing alerts without looking (one true alert dismissed). Students tune tolerance to bring false positives down and watch what that does to false negatives. 3.5.D.3, D.4.
8. **Both at once for 911.** Hybrid on 911 Dispatch: catches the known and the new attack; most expensive; most alerts. 3.5.C.3, D.2.
9. **Get past the signatures.** An attacker changes one detail of a known attack (a new port, a different file name). Signature misses it; anomaly flags it. Question: which method is easier to bypass, and what a false negative costs (3.5.D.4).
10. **Recommend.** Assign a method to each client within the budget. Goals check the plan fits the budget and meets each client's main criterion. Written justification per client, citing the bench's numbers (teacher-graded). This replaces Log Detective's "Pick a method" step.
11. **Review and submit.**

The reflection can fold into step 10.

## Features to build (this lab owns them)

1. **Detection bench** (`src/sim/bench.ts` or an additive section of `src/sim/ids.ts`): a pure, deterministic model. A "day" is a labeled list of traffic events (normal and attack, each with features the methods use). Run signature, anomaly, or hybrid with settings (signature database version; baseline day; tolerance). Return detections with times, true and false positives, false negatives, time to detect, and a relative hardware cost. Unit-test it.
2. **Bench and scoreboard UI.** A Toolkit card to pick a client, method, and settings and run, and an inspector or panel scoreboard. The map shows the three client networks as zones, with alert markers on the devices that triggered.
3. **Analyst queue** for step 7: a short list of alerts the student (or a simulated tired analyst) works through, showing what fatigue does.
4. **Actions** for each change (method, database version, baseline, tolerance, run), recorded and replayable.

Reuse: the IDS engine's signature list and anomaly scoring in `src/sim/ids.ts`, `src/ui/inspector/Detection.tsx`, `src/ui/tools/DetectionCards.tsx`, map zones, the Logs tab for alerts. `device-analysis` is being built at the same time and adds an automated ban to `ids.ts`; keep your edits additive.

## Parent-lab trim (do this in the same branch)

- In `src/labs/logs/index.ts`, remove step `pick-method` and its answer-key entries and tests. Bump the logs lab's `version`.
- Point Log Detective's write-up step at this lab ("Next lab: choosing a method for a network") and drop its "recommend a method" part if it depends on the removed step.
- Update the logs lab's `PLAN.md` to match. Make no other changes to the logs lab: its other improvements are a separate pass.

## Done means

All checks in the authoring skill pass (typecheck, tests including bench unit tests, walkthrough, playthrough in light, dark, and small, click-through at 4× and 1×) for this lab and the trimmed logs lab. `/avoid-ai-writing` run on the student text. PLAN.md in `src/labs/detect-methods/`, set to "Status: built".

## As built

Status: built. Code: `index.ts`, `scenario.ts`, `solution.ts`, `lab.test.ts` here; the bench model in `src/sim/bench.ts` (tests in `bench.test.ts`); the cards in `src/ui/tools/Bench.tsx`. `src/sim/ids.ts` is untouched.

Where the build differs from the outline above:

- **Step 2** runs with the September 2026 database, so signatures catch only StuffBot (1 of 3). Step 3's October update adds VidJack; the copied shows (the zero-day) stay missed. This gives step 3 something to change.
- **Step 6** has two questions, speed and cost, instead of one.
- **Step 7**: the analyst is simulated. They check alerts in order, 5 minutes each, and after 5 false alarms in a row close the rest unread. At ±25% the copied-shows alert (14:20, Content library) is closed unread; at ±100% the analyst finds it; at ±200% the bench misses it. The queue sits inside the bench card (`queue: true` on the `bench` tool) rather than in its own card, so it stays above the fold. The step's setup makes a ±25% run if the student's newest StreamCo run doesn't already show the closed alert.
- **Step 9**: the changed detail is the file name (`dispatch_patch.exe`), loaded with a lesson button. Students open the anomaly alert in the Logs tab and type its time (10:42).
- **Step 10** folds in the reflection: the write-up (60 words) names a method and a bench number per client and one remaining risk. There is no separate reflect step, so the lab has 11 steps.
- The only plan that meets every client's need within $5,400 is signature / anomaly / hybrid ($5,200). `lab.test.ts` pins this and the other teaching numbers (false alarms 60/40/22/4/0 across the tolerances, detection times, the infected baseline's miss).
- The scoreboard is a table in the bench card, not an inspector section. Map markers show each run's alert count and missed attacks on the device involved.
