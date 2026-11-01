# Log Detective (`logs`) — lesson script

The full lesson, as students see it, ready to translate into `index.ts`, `scenario.ts`, and `solution.ts`. Voice follows `docs/unit3/ARCHITECTURE.md`: short sentences, imperatives, bold on first use, no em dashes, no emoji.

## Changes from the plan

The plan's 12 steps, CodeHS lesson, and CED LOs are unchanged. This script fills in the specifics and makes three design decisions the plan left open. None of them change the plan's direction, so `PLAN.md` is not edited.

1. **Attacks are replayed live; indicators are seeded.** The three attacks a detector must *respond* to (the ARP poisoning, the 3 a.m. upload, the MAC flood) and the legitimate backup are injected by **Replay** buttons at the moment the student presses them, so the IDS, IPS, anomaly detector, and AI scorer judge them with the settings the student just chose. The indicators the student only *reads* (the overnight scan, the failed sign-ins, the broadcast pings, the C2 beacon, the SSH-on-443 connection) are seeded as backdated history. A replayed attack still carries its original overnight timestamp and fields, so the anomaly rule can see that the upload happened at 03:12 (see "The replay model").
2. **Concrete device list.** The plan's generic cast becomes twelve named devices, including a `backup` server (the plan's false-positive target), a `plant` controller (what the control room talks to), and an intruder laptop `mal` found plugged into a spare jack (the source of the ARP poisoning and MAC flood).
3. **Exact detection numbers.** Anomaly tolerance is a three-position control (Loose, Medium, Strict) with a deviation model below. AI scores are fixed per event and the threshold's good range is **0.70 to 0.75**. Both are chosen so the goals check counts and state, not exact slider values.

---

## Lab metadata

```
id: 'logs'
version: 1
title: 'Log Detective'
tagline: 'Read a night of logs and tune the detectors until the real attacks stand out from the noise.'
unit: 3
codehs: ['3.18 The Story in the Logs']
ced: ['3.5.A', '3.5.B', '3.5.C', '3.5.D', '3.5.E']
minutes: 45
clock: '08:00'
labelMacs: true
objectives:
  - 'Explain what a NIDS, a NIPS, and a SIEM each do with network logs.'
  - 'Compare signature-based and anomaly-based detection, including what each one misses.'
  - 'Judge a detector by false positives, false negatives, speed, and cost.'
  - 'Find indicators of compromise in a night of logs and choose a detection method for an organization.'
```

Home-page order is already set in `ARCHITECTURE.md`: `logs` is last.

---

## Scenario and map

Riverbend Water Utility runs the treatment plant for a small city. Its office network is small, quiet, and critical: if an attacker reaches the control room, they reach the plant. You are the new security analyst. You arrive for the morning shift at 08:00 and the overnight logs are waiting.

The canvas is 1000 x 600. Every center is at least 130 from its neighbors.

| id | label | sublabel | kind | icon | x | y | addresses |
|---|---|---|---|---|---|---|---|
| `internet` | Internet | | router | cloud | 900 | 300 | `203.0.113.1/24` (edge) |
| `fw` | Edge firewall | `10.10.20.1` | router | firewall | 740 | 300 | wan `203.0.113.2/24`, lan `10.10.20.1/24`, MAC of lan `02:00:0a:0a:14:01` |
| `sw` | Office switch | 12 ports | switch | switch | 500 | 300 | none (layer 2) |
| `nids` | NIDS sensor | mirror port | host | server | 500 | 110 | `10.10.20.9/24` |
| `siem` | SIEM server | log collector | host | server | 660 | 90 | `10.10.20.8/24` |
| `files` | Records server | `10.10.20.10` | host | server | 300 | 90 | `10.10.20.10/24`, services: SMB 445, SSH 22, HTTP 80 |
| `backup` | Backup server | `10.10.20.11` | host | server | 120 | 160 | `10.10.20.11/24`, service: backup 873 |
| `pc1` | Dana's PC | operator | host | desktop | 120 | 330 | `10.10.20.21/24` |
| `pc2` | Raj's PC | finance clerk | host | desktop | 120 | 500 | `10.10.20.22/24` |
| `control` | Control room PC | | host | desktop | 330 | 500 | `10.10.20.31/24` |
| `plant` | Plant controller | treatment plant | host | desktop | 560 | 500 | `10.10.20.40/24`, service: Modbus 502 |
| `mal` | Unknown laptop | on port 9 | host | attacker | 340 | 300 | `10.10.20.66/24`, MAC `0e:ba:d0:00:00:66`, `attacker: true` |

Gateway for every internal host: `10.10.20.1` (the firewall's LAN side). DNS server: `10.10.20.1` (the firewall forwards it; not exercised in this lab). Internal broadcast address: `10.10.20.255`.

Links (all through the switch except the firewall uplink):

- `internet` wan `fw`
- `fw` lan `sw`
- `sw` to each of: `nids`, `siem`, `files`, `backup`, `pc1`, `pc2`, `control`, `plant`, `mal`

`mal` is plugged into the one switch port nobody set up (the plan's "spare jack"). The intruder got into the building overnight. `nids` sits on the switch's **mirror port**: it sees a copy of the office traffic. Model note for the implementer: the IDS engine reads simulator events and log lines, not a literal packet mirror, so `nids` does not need real mirrored frames (see "Simulator behaviors").

Optional map zones (`MapZone`): a `neutral` building rectangle around the internal devices labeled "Office LAN 10.10.20.0/24", and the switch-to-`mal` area can stay inside it (the point is that the jack is physically inside the building). Keep fills faint. Zones are not required for any goal.

### Names and addresses used in the logs

| Thing | Value |
|---|---|
| Gateway real MAC | `02:00:0a:0a:14:01` |
| Intruder (`mal`) MAC | `0e:ba:d0:00:00:66` |
| External scanner / brute-force source | `203.0.113.66` |
| 3 a.m. upload destination (unknown to every list) | `45.77.12.9:8443` |
| Known-malicious IP on the threat feed (C2) | `198.51.100.77:443` |
| SSH-over-443 destination | `203.0.113.90:443` |

---

## The log data

### The replay model

Seeded history is written in each step setup or the scenario with `sim.log(dev, line, at)` where `at` is negative (milliseconds before 08:00). Convert a wall-clock time to `at` with a helper in `scenario.ts`:

```
// ms before 08:00 for a time earlier the same night
const atNight = (h: number, m: number) => -((8 * 60 - (h * 60 + m)) * 60 * 1000);
```

The four **replayed** events (ARP poisoning, 3 a.m. upload, MAC flood, backup) are stored as small recorded scenarios the scenario module builds once. A **Replay** action feeds the recorded event through the sensor with its *current* settings and emits any alert at the current sim time, but the event keeps its original overnight fields (including `hour`) so the anomaly rule can judge it. The implementer can model each recorded event as a function `(sim) => void` that calls the real primitive (ARP spoof, outbound connection, MAC-flood burst, backup transfer) tagged with its overnight time; the IDS hooks fire as usual.

### Seeded overnight history

Generate benign noise with `sim.rand` so the log looks real and the student has to search. Backdate everything with `atNight`. Suggested volumes (a few hundred lines total, well under `MAX_LOG`):

| Device | Source | Lines | Pattern |
|---|---|---|---|
| `fw` | `firewall` | ~180 | Mostly `ALLOW out` for staff browsing (TCP 443, UDP 53), a few `ALLOW out` Modbus from `control` to the plant, scattered `DENY in` background scans from random internet IPs. Planted indicators mixed in. |
| `sw` | `switch` | ~60 | `MAC ... learned on port N`, `link up/down`, one `MAC table 60% full` notice. |
| `files` | `auth` | ~40 | `sign-in OK` for `dana` and `raj` during the day; the planted failed sign-ins at night. |
| `files` | `smb` | ~30 | `read \\records\\reports\\...` by staff during the day. |
| `pc1`, `pc2`, `control` | `host` | ~10 each | boot, update check, routine lines; one planted process line on `pc2`. |
| `plant` | `host` | ~15 | `poll OK from 10.10.20.31` every few minutes (control polling the plant). |
| `nids` | `ids` | ~6 | `signature set loaded`, heartbeats, and the planted overnight scan alert. |
| `siem` | `siem` | ~8 | `ingest OK ...` lines and the planted correlated incident. |

Make the generator deterministic: pick each timestamp and port with `sim.rand`/`sim.randInt`, never `Math.random`.

### Example lines in each device's real style

Write `msg` the way the device would, and put the facts in `fields` so filters and goals never parse text. Mirror the firewall lab's format (`ALLOW/DENY <dir> <proto> <src>:<sport> -> <dst>:<dport> rule <n>`).

```
firewall  info   ALLOW out TCP 10.10.20.21:50314 -> 140.82.113.21:443 rule 5
          fields { action: 'allow', dir: 'out', proto: 'tcp', src: '10.10.20.21', sport: 50314, dst: '140.82.113.21', dport: 443, rule: 5 }

firewall  info   ALLOW out UDP 10.10.20.21:51002 -> 10.10.20.1:53 rule 2
          fields { action: 'allow', dir: 'out', proto: 'udp', src: '10.10.20.21', sport: 51002, dst: '10.10.20.1', dport: 53, rule: 2 }

switch    info   MAC 1e:7c:9a:40:1b:02 learned on port 3
          fields { mac: '1e:7c:9a:40:1b:02', port: 3 }

auth      info   sign-in OK user=dana src=10.10.20.21
          fields { action: 'ok', user: 'dana', src: '10.10.20.21' }

smb       info   read \\records\\reports\\2026-10\\flow.csv user=raj
          fields { user: 'raj', path: '\\records\\reports\\2026-10\\flow.csv' }

host      info   poll OK from 10.10.20.31
          fields { src: '10.10.20.31', proto: 'modbus' }

ids       notice signature set loaded (248 rules)
          fields { rules: 248 }

siem      info   ingest OK: firewall, switch, records, backup, sensor
          fields { sources: 5 }
```

### Every planted indicator, with exact fields

Seeded unless marked "replayed". Times are wall clock; `at = atNight(h, m)`.

| # | Time | Device | source | level | msg | fields |
|---|---|---|---|---|---|---|
| I1 | 01:05 | `files` | `auth` | warn | `sign-in FAILED user=admin src=203.0.113.66` (x14, one per minute 01:05 to 01:18) | `{ action: 'fail', user: 'admin', src: '203.0.113.66' }` |
| I2 | 01:05 | `fw` | `firewall` | warn | `DENY in TCP 203.0.113.66:44001 -> 10.10.20.10:445 rule 9` (x~40, climbing dport, 60 seconds) | `{ action: 'deny', dir: 'in', proto: 'tcp', src: '203.0.113.66', dst: '10.10.20.10', dport: <22,80,139,445,...>, rule: 9 }` |
| I3 | 01:06 | `nids` | `ids` | alert | `ALERT port-scan: 203.0.113.66 hit 42 ports in 60s` | `{ signature: 'port-scan', src: '203.0.113.66', ports: 42, window: 60 }` |
| I4 | 01:20 | `siem` | `siem` | alert | `INCIDENT 1041 open: 3 event types from 203.0.113.66` | `{ incident: 1041, src: '203.0.113.66', kinds: 'scan,deny,auth-fail', triage: 'open' }` |
| I5 | 02:30 | (replayed) `mal` ARP | — | — | see Replay R1 | — |
| I6 | 03:11 | `pc2` | `host` | notice | `process start svc-update.exe user=raj` | `{ user: 'raj', proc: 'svc-update.exe' }` |
| I7 | 03:12 | (replayed) `pc2` upload | — | — | see Replay R2 | — |
| I8 | 03:40 | `fw` | `firewall` | warn | `DENY in ICMP 203.0.113.66 -> 10.10.20.255 echo-request` (x~24, 40 seconds) | `{ action: 'deny', dir: 'in', proto: 'icmp', src: '203.0.113.66', dst: '10.10.20.255', icmp: 'echo-request' }` |
| I9 | 04:20 | `fw` | `firewall` | notice | `ALLOW out TCP 10.10.20.22:49777 -> 198.51.100.77:443 rule 5 threat-feed=known-c2` | `{ action: 'allow', dir: 'out', proto: 'tcp', src: '10.10.20.22', dst: '198.51.100.77', dport: 443, rule: 5, threat: 'known-c2' }` |
| I10 | 05:00 | `fw` | `firewall` | notice | `ALLOW out TCP 10.10.20.22:50980 -> 203.0.113.90:443 app=ssh rule 5` | `{ action: 'allow', dir: 'out', proto: 'tcp', src: '10.10.20.22', dst: '203.0.113.90', dport: 443, app: 'ssh', rule: 5 }` |

Replayed events:

- **R1 ARP poisoning (step 3).** `mal` sends a forged ARP reply: `10.10.20.1` is at `0e:ba:d0:00:00:66`. Recorded overnight time 02:30. On replay the signature rule matches and `nids` logs an alert (see detection rules).
- **R2 3 a.m. upload (steps 4 and 5).** `pc2` opens an outbound TCP connection to `45.77.12.9:8443` and uploads ~90 MB. Recorded time 03:12. The firewall logs `ALLOW out TCP 10.10.20.22:52110 -> 45.77.12.9:8443 rule 5 bytes=94371840` with fields `{ action:'allow', dir:'out', proto:'tcp', src:'10.10.20.22', dst:'45.77.12.9', dport:8443, bytes:94371840, hour:3 }`. No signature matches it. The anomaly rule matches it at Medium or Strict.
- **R3 MAC flood (step 6).** `mal` sends a `Frame.burst` of ~200 frames with random source MACs into the switch. Recorded time 02:45. Builds on `mac-flood`. In prevention mode the NIPS shuts `mal`'s port.
- **R4 scheduled backup (steps 5 and 6).** `pc1` (or `files`) transfers ~40 MB to `backup` (`10.10.20.11:873`) at 02:00. Legitimate. The anomaly rule flags it at Medium or Strict (off hours, large). In prevention mode the NIPS blocks `backup`'s IP and the transfer fails.

---

## The detection rules

### Signatures (NIDS signature set)

Each rule matches a known pattern and, when it fires, writes an `nids` log line (`source: 'ids'`, `level: 'alert'`) with a `signature` field. Rules the set contains:

| signature | Fires when | Catches | CED |
|---|---|---|---|
| `arp-spoof` | An ARP reply maps the gateway IP `10.10.20.1` to a MAC other than `02:00:0a:0a:14:01` | ARP poisoning (R1) | 3.5.E.3 |
| `mac-flood` | More than 20 new source MACs appear on one switch port inside 5 seconds | MAC flooding (R3) | 3.5.E.4 |
| `port-scan` | One source hits more than 15 ports inside 60 seconds | the overnight scan (I2, I3) | 3.5.E.7 |
| `icmp-broadcast` | An ICMP echo-request is addressed to a broadcast address | smurf-style probe (I8) | 3.5.E.6 |
| `known-bad-ip` | A connection's remote IP is on the threat feed | the C2 beacon (I9) | 3.5.E.7 |

No signature matches R2 (the 03:12 upload): its destination is on no list and its pattern is new. That absence is the point of step 4.

Signature alert line, for example:

```
ids  alert  ALERT arp-spoof: 10.10.20.1 now claims MAC 0e:ba:d0:00:00:66 (was 02:00:0a:0a:14:01)
     fields { signature: 'arp-spoof', ip: '10.10.20.1', mac: '0e:ba:d0:00:00:66', was: '02:00:0a:0a:14:01' }
```

### Anomaly baseline and tolerance

The baseline is recorded on a clean week (a one-press action). It stores, per host: active hours 08:00 to 18:00, the set of known peers (addresses the host normally talks to), and a typical upload size. An event earns a **deviation** from how far it falls outside the baseline:

- off active hours: +1
- unknown peer (destination not in the host's known set): +1
- upload far above typical (more than about 10x): +1

Tolerance sets how much deviation is allowed before an alert:

| Tolerance | Alerts when deviation is | R2 upload (dev 3) | R4 backup (dev 2) | Normal-but-odd (dev 1) |
|---|---|---|---|---|
| Loose | greater than 3 | no alert | no alert | no alert |
| Medium | 2 or more | ALERT | ALERT | no alert |
| Strict | 1 or more | ALERT | ALERT | ALERT (noise) |

- R2 upload: off hours (+1), unknown peer `45.77.12.9` (+1), ~90 MB (+1) = deviation 3.
- R4 backup: off hours (+1), ~40 MB (+1), but `backup` is a known peer = deviation 2.
- A normal-but-odd event (for example Dana signing in at 07:40, one known peer, small) = deviation 1.

So **Loose misses the real upload** (a false negative, which nudges the student to tighten), **Medium catches the upload and the backup**, and **Strict adds harmless noise**. Step 5 asks for Medium.

Anomaly alert line, for example:

```
ids  alert  ALERT anomaly: 10.10.20.22 off-baseline (03:12, new peer 45.77.12.9, 90 MB)
     fields { signature: 'anomaly', host: '10.10.20.22', hour: 3, peer: '45.77.12.9', bytes: 94371840, deviation: 3 }
```

Hybrid mode is simply signatures on and anomaly on at the same time. The lesson does not need a separate control for it; the "pick a method" step teaches the idea.

### Prevention (NIDS to NIPS)

A prevention toggle turns the sensor from alert-only into one that acts. When an alert names a source the NIPS can reach, it takes the matching action and logs it (`source: 'ips'`, `level: 'alert'`):

- MAC flood on a switch port: shut that port. Log `IPS shut switch port 9 (mac-flood from many MACs)`, and the switch records the port down. R3 stops.
- A flagged internal IP (the backup false positive): block that IP at the firewall. Log `IPS blocked 10.10.20.11 (anomaly)`, and R4's transfer fails with the backup unreachable.

The trade-off: prevention stops R3 with no human in the loop, and it also cuts off the working backup server on a false alert. That is step 6's lesson.

### AI scores and threshold

Pressing "Score this morning's events" assigns each event a fixed probability that it is malicious. An alert is raised when a score is at or above the threshold.

| Event | Score | Truth |
|---|---|---|
| ARP poisoning (R1) | 0.95 | real attack |
| 3 a.m. upload (R2) | 0.90 | real attack |
| Overnight scan (I2, I3) | 0.75 | real attack |
| Dana's 07:40 maintenance login | 0.70 | false alarm |
| Scheduled backup (R4) | 0.65 | false alarm |
| Control-to-plant Modbus poll | 0.30 | normal |
| Staff file read | 0.15 | normal |

Threshold is a slider, 0.00 to 1.00 in 0.05 steps, showing live counts of real attacks caught and false alerts raised.

- **Good range: 0.70 to 0.75.** All three real attacks are caught (0.75, 0.90, 0.95). The backup (0.65) stays quiet. Dana's maintenance login (0.70) raises at most one false alert. The goal checks these counts, not the exact value.
- Above 0.75: the scan (0.75) is missed, then the upload, then everything. False negatives.
- Below 0.65: the backup and more normal noise raise alerts. Alert fatigue.

---

## Steps

Tools unlock cumulatively. Step 1 unlocks the Logs tab for every logging device; it stays unlocked. The Detection controls on `nids` reveal one group at a time: signatures (step 3), anomaly plus tolerance (step 5), prevention (step 6). The SIEM incident view unlocks in step 7, the AI threshold in step 8.

Logs tool device list (step 1):
`{ kind: 'logs', devices: ['fw', 'sw', 'files', 'backup', 'pc1', 'pc2', 'control', 'plant', 'nids', 'siem'] }`

---

### Step 1 — `shift` "Morning shift"

**Body:**

> You are the new security analyst at Riverbend Water Utility. It runs the treatment plant for the whole city, so the office network is small but it matters. Break into the control room and you reach the plant.
>
> Every device keeps a **log**, a running record of what it did. The firewall, the switch [[sw]], the servers [[files]] and [[backup]], the staff computers, and the plant controller [[plant]] all write lines. One place collects them all: the **SIEM** ([[siem]]), short for security information and event management. It is your console for the whole network.
>
> Everything here is a simulation of one night at the utility. The attacks already happened. Your job this morning is to find them.
>
> Open the **Logs** tab. Read a line from each kind of source so you know what each one looks like:
>
> 1. A **firewall** line from [[fw]].
> 2. A **switch** line from [[sw]].
> 3. A **server** line from [[files]].
> 4. A **sensor** line from [[nids]], the intrusion detection sensor on the switch's mirror port.
>
> Use the device filter at the top of the tab to jump between them. Click a line to open its fields.

**Open:** `logs`. **Focus:** `['siem', 'nids', 'fw', 'files']`.

**Tools:** `{ kind: 'logs', devices: [...] }` (list above).

**Goals:**

- `fw-line` — "Open a firewall line from [[fw]]" — hint: "Set the device filter to the Edge firewall, then click any line." — completes when the student opens a log entry with `source === 'firewall'`.
- `sw-line` — "Open a switch line from [[sw]]" — completes on opening an entry with `source === 'switch'`.
- `srv-line` — "Open a server line from [[files]]" — completes on opening an entry with `device === 'files'`.
- `ids-line` — "Open a sensor line from [[nids]]" — completes on opening an entry with `source === 'ids'`.

**Questions:**

- `what-siem` (choice) — "Every device already keeps its own log. Why does the utility also send copies to the SIEM?"
  - A. "So you can search every device's logs together and follow one attack across the network." **(correct)**
  - B. "So the firewall runs faster once its logs live somewhere else." — feedback: "Logging barely affects the firewall's speed. The SIEM is about seeing everything in one place."
  - C. "Because only the SIEM is allowed to store logs; the other devices delete theirs." — feedback: "Each device keeps its own log. The SIEM gathers copies so you do not have to open ten devices."
  - D. "So the SIEM can block attacks the firewall misses." — feedback: "A SIEM collects and connects logs. Blocking is a different job, and you will meet it later in this lab."
  - explain: "A SIEM pulls logs from many sources into one searchable place. One attack often touches the firewall, a server, and the sensor, and you only see the whole thing when their logs sit side by side."

**Answer-key moves:** `openLog` an `fw` firewall line, an `sw` switch line, a `files` line, an `nids` ids line (four `openLog` moves with the matching `where`).

---

### Step 2 — `haystack` "A haystack"

**Body:**

> The overnight log holds hundreds of lines here, and a real utility's SIEM would hold millions a day. You cannot read them all. You search and filter instead.
>
> Something tried to break into the [[files]] records server last night. Find it.
>
> 1. Set the device filter to the Records server.
> 2. Check **Warnings and alerts only** to hide the routine lines.
> 3. Type `fail` in the search box.
>
> Open one of the failed sign-in lines. Notice they all come from the same address.

**Open:** `logs`. **Focus:** `['files']`.

**Goals:**

- `found-fail` — "Open a failed sign-in on [[files]]" — hint: "Filter to the Records server, turn on Warnings and alerts only, and search for fail." — completes on opening an entry with `device === 'files' && source === 'auth' && fields.action === 'fail'`.

**Questions:**

- `why-tools` (choice) — "Why can't an analyst just read every log line by hand?"
  - A. "A network logs far more lines each day than a person could ever read, so tools surface what matters." **(correct)**
  - B. "The lines are encrypted, so only a tool can open them." — feedback: "These logs are plain text. The problem is how many there are, not that they are locked."
  - C. "Company policy forbids reading raw logs." — feedback: "Reading logs is the job. The trouble is the sheer number of them."
  - D. "Old lines are deleted before anyone can open them." — feedback: "Retention matters, but even today's lines are too many to read one by one."
  - explain: "A medium network logs millions of events a day. Nobody reads that. Filters, search, and later an AI model pick out the handful worth a human's time."

**Answer-key moves:** `openLog` a `files` auth line where `fields.action === 'fail'`.

---

### Step 3 — `signatures` "Signatures"

**Body:**

> A **NIDS**, a network intrusion detection system, watches traffic and raises an **alert** when it sees something it knows is bad. The sensor [[nids]] is a NIDS. Right now its rules are off.
>
> Open the **Detection** controls on [[nids]] and turn on the **signature set**. A signature is a stored pattern for a known attack, the way antivirus knows a known virus.
>
> Then press **Replay last night's attack**. Watch the forged **ARP** replies cross the switch. An ARP reply tells a device which MAC address goes with an IP. Someone on the network told the other computers that the gateway `10.10.20.1` lives at their MAC. The signature for that fires.

**Open:** `{ inspect: 'nids' }`. **Focus:** `['nids', 'sw', 'mal']`.

**Tools:** unlock the Detection section on `nids` with the signature toggle (see "Simulator behaviors" for the `ids` tool kind and inspector section).

**Actions:**

- `replay-arp` "Replay last night's attack" — runs recorded event R1 (the ARP poisoning) through the sensor.

**Goals:**

- `sig-on` — "Turn on the signature set on [[nids]]" — completes when `nids` device state has signatures enabled.
- `arp-alert` — "A signature names the attacker's MAC address" — hint: "Turn the signatures on first, then press Replay last night's attack." — completes when `nids` logged an alert since step start with `fields.signature === 'arp-spoof' && fields.mac === '0e:ba:d0:00:00:66'`.

**Questions:**

- `how-signature` (choice) — "How did the signature catch the ARP poisoning?"
  - A. "It matched the traffic against known attack patterns, and a forged ARP reply for the gateway is one of them." **(correct)**
  - B. "It learned the network's normal behavior and noticed this looked different." — feedback: "That is anomaly detection, which you turn on in two steps. A signature does not learn; it compares to a fixed list."
  - C. "It blocked the attacker's MAC the moment it appeared." — feedback: "A NIDS only warns. Blocking comes with a NIPS, later in this lab."
  - D. "It asked the SIEM whether other utilities had seen this MAC." — feedback: "Signatures match a local pattern. They do not phone other networks."
  - explain: "Signature detection compares traffic to a list of known indicators. It is fast and handles high volume, which is why it suits busy networks. Its weakness shows up next: it cannot catch an attack nobody has written a signature for."

**Answer-key moves:** `{ tool: { type: 'ids-signatures', device: 'nids', on: true } }`, `{ press: 'replay-arp' }`.

---

### Step 4 — `something-new` "Something new"

**Body:**

> At 03:12 last night, [[pc2]], Raj's PC in finance, sent a large upload to `45.77.12.9`. No staffer was in the building. No list of known-bad addresses has ever seen that IP.
>
> Press **Replay the 3 a.m. upload**. Watch the signature set. It stays silent.

**Focus:** `['pc2', 'fw', 'nids']`.

**Actions:**

- `replay-exfil` "Replay the 3 a.m. upload" — runs recorded event R2 with its 03:12 fields. The firewall logs the outbound connection. No signature matches.

**Goals:**

- `missed` — "The upload replays and no signature fires" — hint: "Press Replay the 3 a.m. upload and watch the sensor's alerts. Nothing new should appear." — completes when the upload's firewall line was written since step start (`fw` line with `fields.dst === '45.77.12.9'`) and `nids` logged no alert since step start.

**Questions:**

- `name-it` (choice, `afterGoals: true`) — "The sensor saw a real attack and said nothing. What is that called?"
  - A. "A false negative: a real attack the detector missed." **(correct)**
  - B. "A false positive: a harmless event the detector flagged." — feedback: "That is the opposite. Here the detector missed something real, it did not flag something harmless."
  - C. "A true positive, since the upload really happened." — feedback: "A true positive means the detector correctly flagged a real attack. This detector flagged nothing."
  - D. "A baseline drift the SIEM corrects on its own." — feedback: "There is no baseline yet. The signature simply has no pattern for this."
  - explain: "Signatures only catch what they already know. A brand new attack leaves no known pattern, so it sails through. That gap is a false negative, and it is why networks add a second kind of detection."

**Answer-key moves:** `{ press: 'replay-exfil' }`.

---

### Step 5 — `baseline` "Baseline"

**Body:**

> **Anomaly-based** detection takes the other approach. First it records a **baseline**, a picture of the network on a clean, normal week: who talks to whom, how much, and at what hours. Then it flags whatever falls outside that picture.
>
> 1. Press **Record a clean-week baseline**.
> 2. Set the **tolerance** to **Medium**. Tolerance is how far from normal an event may drift before the sensor alerts. Loose lets more through; Strict flags more.
> 3. Turn on **anomaly detection**.
> 4. Press **Replay the 3 a.m. upload** again, then **Run the scheduled backup**.
>
> The upload trips the alert now: wrong hour, a destination the network never uses, far too much data. But the Monday backup trips it too. The backup is normal. It just runs at 02:00 and moves a lot of data, so it looks odd to the baseline.

**Open:** `{ inspect: 'nids' }`. **Focus:** `['nids', 'pc2', 'backup']`.

**Tools:** reveal the anomaly toggle and the tolerance control (Loose, Medium, Strict) in the Detection section.

**Actions:**

- `record-baseline` "Record a clean-week baseline" — stores the baseline on `nids`.
- `replay-exfil` "Replay the 3 a.m. upload" (same action as step 4).
- `run-backup` "Run the scheduled backup" — runs recorded event R4.

**Goals:**

- `baseline-set` — "Record the clean-week baseline" — completes when `nids` has a stored baseline.
- `anomaly-on` — "Turn on anomaly detection at Medium tolerance" — hint: "If you leave it on Loose, the upload slips through again. Medium catches it." — completes when anomaly is on and tolerance is Medium or Strict.
- `catch-upload` — "An anomaly alert names Raj's PC upload" — completes when `nids` logged an alert since step start with `fields.signature === 'anomaly' && fields.host === '10.10.20.22'`.
- `catch-backup` — "An anomaly alert names the backup" — hint: "Run the scheduled backup after anomaly detection is on." — completes when `nids` logged an alert since step start with `fields.signature === 'anomaly' && fields.host === '10.10.20.11'`.

**Questions:**

- `false-alarm` (choice, `afterGoals: true`) — "The backup is normal work, but it raised an alert. Why do false alerts like this one matter?"
  - A. "Analysts burn time on harmless events and start tuning alerts out, so a real one slips past." **(correct)**
  - B. "The sensor stops logging until someone clears the alert." — feedback: "The sensor keeps running. The cost is the analyst's time and attention, not lost logging."
  - C. "A false alert helps the attacker finish faster." — feedback: "The attacker is not involved in the backup alert. The cost lands on the team watching the screen."
  - D. "None, because the analyst can see it is just the backup." — feedback: "Spotting one is easy. Spotting the hundredth after a long shift is not. That is the real danger."
  - explain: "Every false alert costs attention. Enough of them and the team learns to ignore the alert, which is called alert fatigue, and a real attack hides in the noise. Anomaly detection suits steady networks for this reason: the quieter the normal, the less it cries wolf."

**Answer-key moves:** `{ press: 'record-baseline' }`, `{ tool: { type: 'ids-anomaly', device: 'nids', on: true, tolerance: 'medium' } }`, `{ press: 'replay-exfil' }`, `{ press: 'run-backup' }`.

---

### Step 6 — `nips` "From alarm to action"

**Body:**

> A NIDS only warns. A **NIPS**, a network intrusion prevention system, can also act. It can close a switch port, block an IP address or a MAC address, or reject a protocol. The same sensor does both jobs; you just let it act.
>
> Turn on **prevention mode**. Then press **Replay the MAC flood**. The intruder's laptop [[mal]] floods the switch [[sw]] with made-up MAC addresses to make it leak everyone's traffic. In prevention mode the sensor shuts the port the flood came from. The attack stops on its own.
>
> Now press **Run the scheduled backup** again. The backup still looks anomalous, so the NIPS blocks the [[backup]] server. A normal backup just failed, and no human decided that.

**Open:** `{ inspect: 'nids' }`. **Focus:** `['nids', 'sw', 'mal', 'backup']`.

**Tools:** reveal the prevention toggle (NIDS to NIPS) in the Detection section.

**Actions:**

- `replay-flood` "Replay the MAC flood" — runs recorded event R3.
- `run-backup` "Run the scheduled backup" (same as step 5).

**Goals:**

- `prevent-on` — "Turn on prevention mode on [[nids]]" — completes when `nids` prevention is enabled.
- `port-shut` — "The NIPS shuts the flooded port" — hint: "Turn on prevention, then replay the MAC flood." — completes when `mal`'s switch port is shut (switch port state down) and an `ips` line records it since step start.
- `backup-blocked` — "The NIPS blocks the backup server on a false alert" — hint: "Run the scheduled backup with prevention on and watch what the sensor does to the backup server." — completes when an `ips` line since step start records `fields.blocked === '10.10.20.11'`.

**Questions:**

- `tradeoff` (choice, `afterGoals: true`) — "Prevention stopped the flood with no one watching. What is the risk of letting a tool block on its own?"
  - A. "One false alert can cut off a working system, like the backup, before anyone checks." **(correct)**
  - B. "It slows the network because it reads every packet twice." — feedback: "Reading traffic is not the issue. The risk is the tool acting on a wrong call."
  - C. "An attacker can switch the NIPS off from the internet." — feedback: "That is a separate worry. The trade-off here is what the NIPS does when it is wrong."
  - D. "It can block MAC addresses but never IP addresses." — feedback: "A NIPS can block IPs, MACs, and ports. It just blocked the backup server's IP."
  - explain: "Blocking automatically is fast and needs no analyst, which is its strength against a flood at 3 a.m. The cost is that a false positive now causes an outage instead of a wasted click. Teams tune a NIPS carefully and often let it block only the attacks it is most sure of."

**Answer-key moves:** `{ tool: { type: 'ids-prevention', device: 'nids', on: true } }`, `{ press: 'replay-flood' }`, `{ press: 'run-backup' }`.

---

### Step 7 — `correlate` "Connect the dots"

**Body:**

> The SIEM's real power is tying lines together. On their own, a blocked packet, a port scan, and a few failed sign-ins each look minor. The SIEM noticed all three came from one address, `203.0.113.66`, within twenty minutes, and opened a single **incident**.
>
> Open incident **1041** on [[siem]]. Read its three parts: a firewall deny, the port-scan alert, and the failed sign-ins on [[files]] you found earlier.
>
> Then **triage** it. Decide whether it is a real attack or a false alarm, and whether to escalate it or close it. An analyst resolves or escalates every incident by procedure.

**Open:** `logs`. **Focus:** `['siem', 'files', 'fw']`.

**Tools:** unlock the SIEM incident view and triage control (see "Simulator behaviors").

**Goals:**

- `open-incident` — "Open incident 1041 on [[siem]]" — hint: "Filter the Logs tab to the SIEM, or open the incident list." — completes when the student opens incident 1041.
- `triaged` — "Triage incident 1041 as a real attack and escalate it" — hint: "One address scanned, got denied, then tried passwords. Is that a mistake or an attack?" — completes when incident 1041's state is `verdict: 'real', action: 'escalate'`.

**Questions:**

- `why-correlate` (choice, `afterGoals: true`) — "Each line alone looked minor. Why did putting them together change the picture?"
  - A. "One address scanned the network, got blocked, then tried passwords on the records server. Together that is a targeted attempt." **(correct)**
  - B. "Three alerts always add up to a real attack." — feedback: "Count is not the logic. Three unrelated alerts can be three dead ends. These three share one source and one target."
  - C. "The SIEM blocked the address, which proves it was real." — feedback: "The SIEM correlates and alerts. It did not block anything. You judge the incident."
  - D. "Failed sign-ins are always an attack." — feedback: "Alone they might be a forgetful user. What makes these an attack is the scan and the deny from the same address."
  - explain: "Correlation turns weak single signals into one story. A scan, a deny, and failed logins from one external IP point at someone probing the utility. You escalate that, instead of closing three loose ends."

**Answer-key moves:** open incident 1041 (an `openLog`/incident-open move), `{ tool: { type: 'siem-triage', incident: 1041, verdict: 'real', action: 'escalate' } }`.

---

### Step 8 — `threshold` "Set the threshold"

**Body:**

> There is still too much to read by hand. An **AI** model helps: it gives every event a score from 0.00 to 1.00 for how likely it is to be malicious. You set the **threshold**. Any event scored at or above it becomes an alert.
>
> Press **Score this morning's events**. Then move the threshold slider. Watch the two counters: real attacks caught, and false alerts raised.
>
> Find a threshold that catches all three real attacks (the ARP poisoning, the 3 a.m. upload, and the overnight scan) without burying you in false alerts. Somewhere around **0.70 to 0.75** works.

**Open:** `{ inspect: 'siem' }`. **Focus:** `['siem']`.

**Tools:** unlock the AI threshold slider with live caught/false counters.

**Actions:**

- `score-morning` "Score this morning's events" — assigns the fixed scores from the table above.

**Goals:**

- `scored` — "Score this morning's events" — completes when scores are populated on `siem`.
- `good-threshold` — "Set a threshold that catches all three real attacks with few false alerts" — hint: "Too high and you miss the scan. Too low and the backup and more noise flood in. Try between 0.70 and 0.75." — completes when the threshold yields all three real attacks caught and no more than one false alert.

**Questions:**

- `too-high` (choice, `afterGoals: true`) — "Set the threshold near 1.00. What happens?"
  - A. "The sensor alerts on almost nothing, so real attacks get through." **(correct)**
  - B. "It catches every attack and raises no false alarms." — feedback: "A high bar is picky in the wrong direction: it ignores most events, including real ones."
  - C. "It blocks every event to stay safe." — feedback: "The threshold decides what to alert on, not what to block. A higher bar means fewer alerts."
  - D. "It scores each event twice to be sure." — feedback: "The score does not change. Only the line you draw for an alert moves."
  - explain: "A high threshold trusts almost everything, so real attacks slip by as false negatives."
- `too-low` (choice) — "Now set it near 0.00. What happens?"
  - A. "Nearly every event raises an alert, and the real attacks drown in false ones." **(correct)**
  - B. "Only the most dangerous events raise an alert." — feedback: "A low bar is the opposite of picky. Almost everything clears it."
  - C. "The AI stops scoring to save effort." — feedback: "It keeps scoring. You just moved the alert line down to the floor."
  - D. "It blocks the whole network." — feedback: "The threshold raises alerts; it does not block. A low bar means far too many alerts."
  - explain: "A low threshold alerts on everything, so the team drowns in false positives and misses the few that matter. The organization picks the threshold to balance the two, and a critical network like a water utility leans toward catching more and tolerating some false alerts."

**Answer-key moves:** `{ press: 'score-morning' }`, `{ tool: { type: 'ai-threshold', device: 'siem', value: 0.75 } }`.

---

### Step 9 — `ioc-hunt` "IoC hunt"

**Body:**

> An **indicator of compromise**, or IoC, is a fingerprint an attack leaves behind. Now that you know what the night held, hunt the logs for one line that shows each IoC. Use the device filter and the search box.
>
> Find and open:
>
> 1. A connection to a **known malicious IP** (one the threat feed flagged).
> 2. An **unauthorized scan** (one source hitting many ports).
> 3. A **spike of ICMP** sent to the broadcast address `10.10.20.255`.
> 4. **SSH running on port 443**, where the service and the port do not match.

**Open:** `logs`. **Focus:** `['fw', 'pc2']`.

**Goals:**

- `ioc-badip` — "Open the connection to a known malicious IP" — hint: "Search the firewall log for the threat feed tag, or for 198.51.100.77." — completes on opening an entry with `fields.dst === '198.51.100.77'` (threat-feed line I9).
- `ioc-scan` — "Open a line from the unauthorized scan" — hint: "One source hit dozens of ports. Search for 203.0.113.66." — completes on opening an entry where `fields.src === '203.0.113.66'` and it is a scan deny or the port-scan alert.
- `ioc-icmp` — "Open an ICMP line sent to the broadcast address" — hint: "Search for 10.10.20.255." — completes on opening an entry with `fields.proto === 'icmp' && fields.dst === '10.10.20.255'` (I8).
- `ioc-ssh443` — "Open the SSH-on-443 connection" — hint: "Look for a line where the app is ssh but the port is 443." — completes on opening an entry with `fields.app === 'ssh' && fields.dport === 443` (I10).

**Questions:**

- `why-mismatch` (choice) — "Why is SSH running on port 443 a red flag?"
  - A. "Port 443 is meant for HTTPS, so another service there is often hiding from simple port filters." **(correct)**
  - B. "Port 443 is only ever used for email." — feedback: "Port 443 is HTTPS, not email. The flag is that SSH is wearing the HTTPS port."
  - C. "SSH is banned on every network." — feedback: "SSH is a normal admin tool. The problem is SSH pretending to be web traffic on 443."
  - D. "A service's port must always match its IP address." — feedback: "Ports and IP addresses are different things. The mismatch here is between the port number and the service using it."
  - explain: "A port number is only a label. Attackers put tools on port 443 because basic firewalls wave HTTPS through. A mismatch between the port and the real application is a classic IoC, and a next-generation firewall that inspects the application catches it."

**Answer-key moves:** `openLog` on `fw` for each of I9, I2 (or I3 on `nids`), I8, I10 with the matching `where`.

---

### Step 10 — `pick-method` "Pick a method"

**Body:**

> You have seen both kinds of detection and their costs. Signature-based is fast and cheap and suits heavy traffic, but misses new attacks. Anomaly-based catches new attacks and suits steady traffic, but cries wolf. **Hybrid** runs both: the most coverage, the most cost.
>
> Three organizations ask you which to use. Match each to a method.

**Focus:** `[]`.

**Questions:**

- `org-stream` (choice) — "A video streaming service pushes enormous, ever-changing traffic and needs detection that keeps up. Which method?"
  - A. "Signature-based" **(correct)**
  - B. "Anomaly-based" — feedback: "A baseline on traffic this huge and this variable would flag normal spikes nonstop. The volume calls for speed."
  - C. "Hybrid" — feedback: "Running both over that firehose costs the most, and here raw speed matters more than catching every novel attack."
  - explain: "Signature detection is fast and scales to high volume, so it fits a service whose traffic is both massive and always shifting."
- `org-factory` (choice) — "A small factory has steady, predictable traffic and worries about new attacks nobody has a signature for yet. Which method?"
  - A. "Anomaly-based" **(correct)**
  - B. "Signature-based" — feedback: "Signatures miss any attack that is new, which is exactly this factory's worry. Its steady traffic makes odd behavior easy to spot."
  - C. "Hybrid" — feedback: "A small factory rarely needs the cost of both. Its consistent traffic is ideal for a baseline on its own."
  - explain: "Anomaly detection suits consistent traffic and catches novel attacks, so a quiet, predictable factory is a good fit."
- `org-hospital` (choice) — "A hospital holds sensitive patient records, faces every kind of threat, and has the budget to protect them. Which method?"
  - A. "Hybrid" **(correct)**
  - B. "Signature-based" — feedback: "Signatures alone would miss a brand new attack aimed at patient records, which is too big a gap for a hospital."
  - C. "Anomaly-based" — feedback: "Anomaly alone would miss known attacks a signature catches instantly. Sensitive data deserves both."
  - explain: "Hybrid costs the most but gives the most coverage, which fits a sensitive, critical network that can afford it."

**Answer-key moves:** none (choice only).

---

### Step 11 — `reflect` "Write it up"

**Body:**

> Write a short report for your shift lead.
>
> Name one attack you found in the utility's logs last night. Cite the exact log line or alert that shows it, with the address or MAC that gives it away. Then recommend a detection method for Riverbend Water Utility, and name one trade-off your choice brings.

**Questions:**

- `writeup` (text, teacher-graded) — prompt as above — `minWords: 45`, `lines: 7`.

**Sample answer (for `solution.ts`):**

> The 3 a.m. upload was a real attack. The firewall logged `ALLOW out TCP 10.10.20.22:52110 -> 45.77.12.9:8443 bytes=94371840`, which is Raj's PC sending 90 MB to an address the network never uses, at an hour when nobody was in the building. I would recommend hybrid detection for the utility. It is critical infrastructure, so it needs signatures to catch known attacks fast and anomaly detection to catch new ones like this upload. The trade-off is cost: hybrid runs two systems and produces more alerts, including false ones like the nightly backup, so the team has to tune it and spend time on triage.

---

### Step 12 — `submit` "Review and submit"

**Body:**

> Look over your summary on the right. You can go back to any step and change an answer, then hand in your work again.

**kind:** `'submit'`.

---

## Simulator and interface behaviors for the implementer

### This lab's own (build in `src/labs/logs/` and the shared slots)

1. **IDS/IPS engine — `src/sim/ids.ts`.** Owns a `Device.ids` state on `nids`: `{ signatures: boolean, anomaly: boolean, tolerance: 'loose'|'medium'|'strict', prevention: boolean, baseline?: Baseline }`. Signature rules (table above) run over simulator events and recorded attacks; each match calls `sim.log('nids', { source:'ids', level:'alert', ... })` with a `signature` field. Anomaly rules use the deviation model against the recorded baseline. In prevention mode, a match also performs an action (shut a switch port via the `mac-flood` API, or block an IP at the firewall via the `firewall` API) and logs `source:'ips'`. Keep hooks in `sim.ts` tiny and in one `// --- ids (logs) ---` section. Unit-test in `src/sim/ids.test.ts`.
2. **Baseline + seeded history generator.** A deterministic generator (uses `sim.rand`, never `Math.random`) that writes the benign overnight lines and the seeded indicators with backdated `at`. Lives in `scenario.ts`.
3. **Recorded attacks R1 to R4.** Functions in `scenario.ts` that replay each attack through the live sensor carrying its original overnight fields (`hour`, `bytes`, `src`, `dst`). The Replay buttons are `ActionDef`s that call them.
4. **SIEM correlation + incidents.** A `Device.siem` state holding incidents (a group of log lines sharing a source address and time window) with a triage state `{ verdict?: 'real'|'false', action?: 'escalate'|'close' }`. Incident 1041 is pre-built from the seeded scan/deny/auth-fail lines. New `SimAction`: `{ type:'siem-triage', incident, verdict, action }`.
5. **AI scoring + threshold.** A per-event score map (fixed values in the table), a threshold on `Device.siem`, and live counts of real-caught and false-raised. New `SimAction`: `{ type:'ai-threshold', device, value }`. The "Score this morning's events" action populates the scores.
6. **New `SimAction`s** (add to `src/runtime/actions.ts`, `applyAction`, and the `assertTypable` default-ok path in `src/labs/solution.ts`): `ids-signatures`, `ids-anomaly` (carries `tolerance`), `ids-prevention`, `siem-triage`, `ai-threshold`. None take typed addresses, so `assertTypable` needs no new address checks. Baseline recording and the replays are `step-action`s, so no new action type.
7. **New `Move` variant for opening an incident** (or reuse `openLog` if incidents surface as log lines). Add to `src/labs/solution.ts`.
8. **Detection controls UI.** A `ToolSpec` kind `{ kind: 'ids'; device: 'nids' }` that unlocks a Detection inspector section (`src/ui/inspector/Detection.tsx`, listed in `INSPECTOR_SECTIONS`) with the signature, anomaly, tolerance, and prevention controls revealed progressively. Add its name to `TOOL_NAME` in `src/ui/Guide.tsx`.
9. **SIEM incident view + AI threshold UI.** Either inspector sections on `siem` or Toolkit cards. The incident view lists incident 1041 with its member lines and the triage buttons. The threshold is a slider with the two counters. If surfaced in the Logs tab, extend `LogsView` with an alerts/incidents panel without breaking its plain use in other labs.
10. **Logs tab extension (alerts view).** Optional: a toggle in the Logs tab to show only `level:'alert'` lines, or a compact alerts panel. Must not change the tab's behavior for labs that only read device logs.
11. **`log` fields used by goals:** `signature`, `host`, `mac`, `src`, `dst`, `dport`, `proto`, `app`, `action`, `blocked`, `threat`, `incident`. Keep these in `fields` so no goal parses `msg`.

### From other labs (wave 1 and 2, merged before implementation)

- **`firewall`:** services and ports on hosts, the port-scan primitive, the firewall engine, and firewall log lines (`source:'firewall'`, ALLOW/DENY with direction, proto, addresses, ports, rule). Needed for the scan, the exfil and C2 allow-out lines, the SSH-on-443 line, the SIEM deny, and the NIPS "block an IP at the firewall" action. The app-identification field (`app`) that tags SSH-on-443 comes from the NGFW mode.
- **`mac-flood`:** `Frame.burst`, the MAC-flooding action, the switch MAC table and limit, port security, and shutting a switch port (plus switch log lines). Needed for R3 and the NIPS "shut the port" action.
- **`dns-spoof`:** web/access log lines (`source:'web'`) if the records server's HTTP access is logged. Minor; the exfil evidence is a firewall line, so this is optional.
- **`smurf`:** directed-broadcast ICMP and forged source IP, and the traffic-rate idea. Needed for the ICMP-to-broadcast indicator I8 (seeded, so a plain firewall line suffices if `smurf` is not merged yet).
- **base simulator:** ARP spoofing (`sim.arpSpoof`) and `arp-update` events for R1 and the `arp-spoof` signature; `sim.log` and the Logs tab (already present).

If a wave-1 or wave-2 primitive is missing at implementation time, seed the indicator as a plain firewall/switch log line (the IoC-hunt and correlation steps only read lines) and wire the live replays (R1 to R4) once the owning feature merges.

---

## Concerns

1. **Dependency load.** This lab leans on five other labs' features. Everything the student *reads* is just seeded log lines and works with no dependencies. Only the four live replays (ARP, upload, MAC flood, backup) need merged primitives. If merges slip, the IoC hunt, correlation, threshold, and method steps still stand on seeded data alone; the three detection-demo steps (3, 5, 6) are the ones that need the primitives.
2. **The mirror port is abstracted.** The NIDS reads simulator events, not literally mirrored frames. That is a simplification worth one sentence to students if it ever shows; the body already says the sensor "sees a copy of the office traffic." Keep the lie small and consistent.
3. **Line volume vs. the story.** The story says millions of lines a night; the sim shows a few hundred. Step 2's body is honest about this ("hundreds here, millions at a real utility"). Do not seed thousands: `MAX_LOG` is 2000 per device and the walkthrough test replays every lab.
4. **Step 4's "no alert" goal.** It completes on the presence of the upload line plus the absence of a new alert. Make sure the check only looks at alerts raised since the step started, so a leftover alert from step 3 does not block it. Resetting the network re-runs the setup, not the replay, so the goal starts clean.
5. **Anomaly Loose as a teaching trap.** Loose deliberately misses the real upload, which mirrors the threshold lesson. If testers find it confusing that a detector setting can be "too relaxed," the step body already names Medium as the answer and says Loose lets the upload through.
6. **Twelve devices on the map.** Spacing is at least 130, checked above, but verify at 1366x768 that the bottom row (`pc2`, `control`, `plant`) and the labels do not collide with the dock. Nudge y down to 520 if needed.
