# Log Detective (`logs`)

Status: built (wave 2). 11 steps, registered in `src/labs/index.ts`. Follows `docs/unit3/ARCHITECTURE.md`. Full lesson in `SCRIPT.md` (its top section lists where the build departs from it). Code: `index.ts` (steps), `scenario.ts` (network and seeded history), `solution.ts` (answer key), `lab.test.ts`; detection engine in `src/sim/ids.ts`.

Tagline: Tune detection tools and read the logs to find attacks hiding in normal traffic.

CodeHS: `3.18 The Story in the Logs`. CED LOs: 3.5.A, 3.5.B, 3.5.C, 3.5.D, 3.5.E.

## What students learn

- **Where logs come from** (3.5.A.1): switches, routers, firewalls, servers, and user computers write logs. Automated tools analyze them.
- **NIDS** (3.5.A.2) watches traffic and raises an alert. **NIPS** (3.5.A.3) can also stop an attack: close a port, block an IP or MAC address, or reject a protocol. **SIEM** (3.5.A.4) collects logs from many sources, finds patterns, and raises alerts that analysts investigate, then resolve or escalate by procedure.
- **Too much to read** (3.5.B.1 to 3.5.B.4): a medium-sized network logs millions of events a day. **AI** models score each event with a probability that it's malicious. The organization sets the **threshold**: too high misses real attacks, too low buries the team in false alerts.
- **Detection methods** (3.5.C): **signature-based** compares against known **indicators of compromise (IoCs)**, runs fast, suits high traffic, and can't catch a new attack. **Anomaly-based** compares against a **baseline** recorded on a clean network, suits consistent traffic, and catches new attacks. **Hybrid** does both, costs most, and suits sensitive or critical networks.
- **Judging a method** (3.5.D): speed, cost, **false positives** (wasted time, **alert fatigue**), and **false negatives** (an attack gets through).
- **Reading the evidence** (3.5.E.3, 3.5.E.4, 3.5.E.6, 3.5.E.7): duplicate-MAC ARP replies (ARP poisoning), a surge of frames from many MACs (MAC flooding), a spike of ICMP requests to a broadcast address (smurf), connections to known malicious IPs, unauthorized scans, unusual spikes or slowdowns, and mismatched port and application.

## Scenario and map

Riverbend Water Utility's office network, a critical-infrastructure target: an edge firewall, a switch, a file server, staff PCs, the control-room PC that talks to the treatment plant, a NIDS sensor watching a mirror port on the switch, and a SIEM server collecting logs from the firewall, switch, servers, and sensor. The student is the new security analyst on the morning shift. Set `clock` to the shift start and seed overnight history with backdated log lines.

## Step outline

1. **Morning shift**: tour. Open the Logs tab: firewall, switch, server, and sensor logs, all in the SIEM. Goal: open one line from each source. Question: which devices write logs.
2. **A haystack**: the overnight log has thousands of lines. Use search and filters to find the failed sign-ins on the file server. Question: why people can't read it all.
3. **Signatures**: turn on the NIDS's signature set. Press **Replay last night's attack**: ARP poisoning against the gateway. The signature "ARP reply gives the gateway's IP a new MAC" fires. Goal: an alert names the attacker's MAC.
4. **Something new**: a new attack (data sent at 3 a.m. to an address no list knows) slips past the signatures. Goal: confirm no alert fired. Question: false negative.
5. **Baseline**: record a baseline on a clean week, set the tolerance, and switch on anomaly detection. The 3 a.m. upload trips it. So does Monday's scheduled backup. Goal: both alerts. Question: false positive and alert fatigue.
6. **From alarm to action**: switch the sensor from NIDS to NIPS, so it blocks a flagged source. A MAC flood starts on a switch port; the NIPS shuts the port. Then the backup's false positive blocks the backup server. Question: the trade-off of letting a tool block on its own.
7. **Connect the dots**: the SIEM correlates a firewall deny, a port scan alert, and failed sign-ins from one address into one incident. Triage it: real or false, then escalate or close. Goal: incident triaged correctly.
8. **Set the threshold**: an AI model scores the morning's events. Move the alert threshold: find a setting that catches all three real attacks with a workable number of false alerts. Goal: threshold in the good range. Question: what happens at each extreme.
9. **IoC hunt**: find the line for each: a connection to a known malicious IP, an unauthorized scan, an ICMP spike to a broadcast address, and SSH running on port 443. Goal: open each.
10. **Reflect**: written, FRQ style: name one attack you found, cite the log lines that show it, and say which detector flagged it or would have (a signature or the anomaly baseline). Ends with "Next lab: choosing a method for a network."
11. **Submit**.

Choosing a method moved to its own lab: the old step 10, **Pick a method**, is now Pick Your Detector (`src/labs/detect-methods/`), where students test signature, anomaly, and hybrid detection on three clients and recommend one for each. The lab's `version` went to 2 when the step came out. `SCRIPT.md` still shows the old step 10 as it was first written.

## Core features this lab owns

- IDS and IPS engine in `src/sim/ids.ts`: signature rules over network events and frames (built from what earlier labs emit: ARP updates, `mac-flood` bursts, `smurf` ICMP, `firewall` scans and denies), anomaly detection against a recorded baseline with a tolerance, hybrid mode, alerts as log lines (`source: 'ids'`, `level: 'alert'`), and prevention actions (block an IP or MAC, shut a port) when in NIPS mode.
- SIEM correlation: group alerts and log lines by source address and time window into incidents, with a triage state.
- AI scoring: a deterministic score per event, a threshold control, and counts of caught attacks and false alerts.
- Seeded history: realistic overnight log lines from a generator using `sim.rand`, backdated with `sim.log(..., at)`.
- Extends the Logs tab (alerts view, incident list) without breaking its basic use in other labs.

## Acceptance

- Walkthrough test passes. Lab tests: the signature fires on ARP poisoning and not on normal ARP; anomaly mode flags the upload and the backup; NIPS blocks the flood's port; the threshold changes the caught and false-alert counts; replay is the same.
