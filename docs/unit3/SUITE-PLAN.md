# Unit 3 lab suite: audit and plan

Lab titles were renamed after the build; see README for the current names.

Written 2026-11-14. This plan reviews every AP Cybersecurity lab against the CED's Unit 3 text and the CodeHS Unit 3 module, decides what happens to each, and specs the labs that fill the gaps.

Sources:

- AP Cybersecurity CED (fall 2026), Unit 3, plus the exam section. https://apcentral.collegeboard.org/media/pdf/ap-cybersecurity-course-and-exam-description.pdf
- CodeHS AP Cybersecurity, module "Securing Networks", lessons 3.1 to 3.19. https://codehs.com/course/27705/module/39806
- Four lab audits (one per group of labs), read against both. Their findings are summarized here; the per-lab change lists below come from them.

## What the audit found

**1. Firewalls and detection are under-built for their weight.** The CED gives Topic 3.4 (firewalls) 8 of 26 class periods and Topic 3.5 (detection) 7. CodeHS gives each five lessons (3.9 to 3.13, 3.14 to 3.18). NetLab has one lab for each, and both run 10 to 20 minutes over their stated 45. Meanwhile Topic 3.1 (6 periods) has six or seven labs.

**2. Nothing rehearses the free-response question.** The exam's one FRQ (30% of the score, 50 minutes) is "Device Security Analysis": a host firewall rule table, auth.log with a password spray, UFW BLOCK lines showing a port scan, an nginx access log with probes, and a policy. Students must cite specific log rows, name the adversary IP, explain how a rule blocked a connection, describe a rule change and its impact, describe how an automated system halts an attack in real time, name another countermeasure, and write a command. No lab has a host firewall, an sshd auth.log, UFW lines, an nginx log, a typed firewall command, or a "cite the row" question.

**3. Packet captures are never analyzed as evidence.** CED 3.5.E.7 says network IoCs are "discovered when analyzing network traffic, often in the form of packet capture files." packet-capture and wireshark teach how to read packets; no lab asks students to find an attack in a capture and cite it. wireshark also needs installs and admin rights, can't run on Chromebooks, and repeats about 70% of packet-capture.

**4. Some labs teach against the CED.**
- Beacon frames: CED 3.2.A.4 and 3.2.B.1 say disable them. `wireless` calls hiding the name low-value ("The CED rates it a low-value control", which the CED does not say) and leaves it out of the policy key. `net-audit` tells students to accept the beacon risk.
- `on-path` says WPA2 makes the access point deliver frames only to their owner. Encryption is what protects, and with WPA2-Personal anyone with the password can decrypt.
- `net-audit` step 4 implies the beacon rates moderate; step 5 requires low. A student who follows step 4 fails step 5.
- The full list is per lab, below.

**5. Thin spots inside otherwise good labs.**
- Risk rating (3.1.C, the whole "Analyze Risk" exam skill) lives only in `net-audit`, which hands students the three CED examples instead of having them reason.
- Subnetting and CIDR are used by `firewall`, `segmentation`, and the FRQ, but only `build-network` (now optional) teaches them.
- Scenario 3C asks for per-LAN security features and a diagram; `segmentation` has neither.
- Choosing and evaluating a detection method (3.5.C, 3.5.D: eight EKs, two CodeHS lessons) is one step of `logs`.

**6. Pacing.** In the current home-page order, students do four lessons with no CED attack (home-network, packet-capture, wireshark, build-network) plus net-tools before their first attack lab: about 3.5 hours.

**7. route-hijack teaches no CED EK.** It adds about 15 new terms the exam never uses, and its HTTPS step repeats on-path and dns-spoof.

## Decisions

| Lab | Decision | Why |
|---|---|---|
| home-network | KEEP | Already taught. The baseline vocabulary. |
| packet-capture | KEEP | Already taught. Filters and layers. |
| wireshark | OPTIONAL (take-home) | Replaced by **capture-analysis**. Keep it for students with their own laptop. |
| build-network | OPTIONAL (remediation) | Good routing practice, no Unit 3 content, repeats home-network. Its CIDR teaching moves into segmentation. |
| net-tools | MODIFY, move later | Cut the two IT tickets to one warm-up and refocus on recon (nmap, netstat IoCs). Move it before net-audit so it feeds the audit. |
| on-path | MODIFY (fixes) | Best attack lab. Fix WPA2, HTTPS, and static ARP; add capture-based detection. |
| mac-flood | KEEP, small edits | Closest to the CED wording. |
| dns-spoof | MODIFY | Fix the cache contradiction and the staged evidence. |
| smurf | KEEP, small edits | Most exam-aligned question set. |
| route-hijack | OPTIONAL (enrichment) | No CED content. |
| net-audit | MODIFY | Fix the beacon contradiction; add unscaffolded risk rating; fix split tunneling. |
| wireless | SPLIT | Keep attack and configuration as "Signals Past the Walls"; detection moves to **watch-the-air**. |
| segmentation | MODIFY | Per-LAN features and a diagram (scenario 3C); real subnetting practice and CIDR. |
| firewall | SPLIT | Keep rules, placement, and order as "Firewall Rulebook"; firewall types move to **firewall-types**. |
| logs | MODIFY, trim | Keep tools, SIEM, AI, IoCs; method choice moves to **detect-methods**. |
| *new* capture-analysis | BUILD | Packet captures as evidence (3.5.E.3, E.4, E.6, E.7). Replaces wireshark. |
| *new* firewall-types | BUILD | Stateless, stateful, NGFW, firewalls in routers (3.4.A). |
| *new* detect-methods | BUILD | Choosing and judging detection methods (3.5.C, 3.5.D). |
| *new* watch-the-air | BUILD | Wireless detection and scenario 3B's detective controls (3.5.E.1, E.2). |
| *new* device-analysis | BUILD | The FRQ rehearsal and unit capstone. |

## The suite, in order

Seventeen labs in sequence, two of them already taught. "CodeHS" is the lesson each lab goes with. Minutes are targets.

| # | Lab | id | CodeHS | CED focus | Min |
|---|---|---|---|---|---|
| 1 | Who Gets the Packet? | home-network | 3.1 | foundations, 3.1.B.4, 3.2.B.3 | 40 |
| 2 | What's in a Packet? | packet-capture | 3.1 | foundations, captures | 45 |
| 3 | Traffic in the Wrong Hands | on-path | 3.2 | 3.1.A.1, 3.5.E.3 | 45 |
| 4 | Flood the Switch | mac-flood | 3.2, 3.4.1 | 3.1.A.2, 3.1.B.3, 3.3.B.4, 3.5.E.4 | 45 |
| 5 | Wrong Directions | dns-spoof | 3.3 | 3.1.A.3, 3.5.E.5 | 45 |
| 6 | Echo Storm | smurf | 3.3, 3.5.2 | 3.1.A.4, 3.1.C.4 to C.6, 3.5.E.6 | 45 |
| 7 | Clues from the Command Line | net-tools | 3.3.2, 3.4 | 3.1.B.1, 3.5.E.7 | 45 |
| 8 | The Network Audit | net-audit | 3.5, 3.6 | 3.1.C, 3.2.A.1 to A.3 | 45 |
| 9 | Signals Past the Walls | wireless | 3.4.2, 3.7 | 3.1.B.4 to B.7, 3.2.A.4, 3.2.B | 45 |
| 10 | Walls Inside the Network | segmentation | 3.8 | 3.3, 3.1.B.2, 3.4.C.1 to C.2 | 45 |
| 11 | Firewall Rulebook | firewall | 3.10 to 3.12 | 3.4.B, 3.4.C, 3.4.D, 3.3.A.1 | 45 |
| 12 | **Smarter Firewalls** | firewall-types | 3.9 | 3.4.A | 45 |
| 13 | Log Detective | logs | 3.14, 3.15 | 3.5.A, 3.5.B, 3.5.E | 45 |
| 14 | **Pick Your Detector** | detect-methods | 3.16, 3.17 | 3.5.C, 3.5.D | 45 |
| 15 | **The Story in the Capture** | capture-analysis | 3.18.6 to 3.18.8 | 3.5.E.3, E.4, E.6, E.7 | 50 |
| 16 | **Watch the Air** | watch-the-air | 3.18.5, 3.14 | 3.5.E.1, E.2, 3.1.B.6, scenario 3B | 45 |
| 17 | **Device Security Analysis** | device-analysis | 3.18, 3.19 | FRQ: 3.4.B, 3.4.D, 3.5.A.3, 3.5.E.7 | 50 |

Optional, listed in their own group on the home page: **Wireshark for Real** (take-home), **From Cable to Web Page** (remediation for routing and addressing), **Advertise a Bad Route** (enrichment).

**If time is short**, drop in this order: net-tools (net-audit and device-analysis cover scanning), firewall-types (fold its MCQs into the CodeHS 3.9 lesson), watch-the-air (CodeHS 3.18.5 covers triangulation). Keep device-analysis whatever else goes: it is the only FRQ practice.

**Why firewall-types comes after the Rulebook**, though CodeHS teaches types first (3.9): stateless and stateful only make sense once students can write a rule. The CodeHS 3.9 lesson works as the reading; the lab comes after 3.12.

**Why capture-analysis sits in the detection block** rather than in wireshark's old slot: the attack labs (3 to 6) already teach capture as they go, and capture analysis needs students to know the attacks it finds. The CED puts captures under 3.5.E.7, and CodeHS under 3.18.

### Where each EK is taught (after the plan)

| Topic | Hands-on in |
|---|---|
| 3.1.A attacks | on-path, mac-flood, dns-spoof, smurf |
| 3.1.B vulnerabilities | mac-flood (ports), segmentation (lateral), wireless (wireless, rogue AP), net-tools and firewall (scans, open ports) |
| 3.1.C risk | net-audit (rate new risks, document them), smurf (CED anchors), CIA questions in every attack lab |
| 3.2.A policies | net-audit (router, switch, VPN), wireless (wireless policy), mac-flood (switch policy) |
| 3.2.B wireless config | wireless |
| 3.3 segmentation | segmentation, firewall (screened subnet), mac-flood (3.3.B.4) |
| 3.4.A types | firewall-types |
| 3.4.B, D rules | firewall, device-analysis |
| 3.4.C placement | firewall, segmentation |
| 3.5.A, B tools and AI | logs |
| 3.5.C, D methods | detect-methods |
| 3.5.E indicators | on-path, mac-flood, dns-spoof, smurf (each attack's own cue), capture-analysis (all network cues in captures), watch-the-air (evil twin, jamming, rogue AP), logs and device-analysis (log files) |

## The FRQ thread through the suite

Every lab from 3 on should have at least one question in the FRQ's shape. These are the moves, and where students practice them:

| FRQ move | Practiced in |
|---|---|
| Cite a specific log row or packet as evidence | mac-flood, dns-spoof, smurf, logs, capture-analysis, watch-the-air, device-analysis |
| Name the adversary's IP, and spot a forged source | smurf, dns-spoof, capture-analysis, device-analysis |
| Trace a packet through a rule table (rule number and verdict) | firewall, device-analysis |
| Describe a rule change and its impact on traffic | net-audit, smurf, firewall, logs, device-analysis |
| How an automated system halts the attack in real time | logs, firewall-types, device-analysis |
| Name another countermeasure | every attack lab's defense step, device-analysis |
| Write a command | device-analysis (ufw) |

## Shared conventions for the new labs

- Follow `.claude/skills/netlab-lab-authoring/SKILL.md` and `docs/unit3/ARCHITECTURE.md`. Run `/avoid-ai-writing` on the student text.
- Assume home-network and packet-capture vocabulary. Don't re-teach ports 80 and 443, what a log is, or how to filter by address or protocol.
- Every attack or detection step uses the arc: see it, find the evidence, defend, retry.
- At least two FRQ-shaped questions per lab (table above).
- CIDR: segmentation will teach `/24` as "the first three numbers are the network." New labs may use `/24` freely, with a one-line reminder the first time.
- Optional steps say "Optional extra challenge" and earn no points. Never "extra credit" or "bonus".
- Don't edit README.md, COVERAGE.md, ARCHITECTURE.md, or other labs' folders, except the parent-lab trim your spec names. Put README and COVERAGE text in your final report.

### Who builds which shared feature

The five new labs are built at the same time on separate branches. Edits to shared files stay additive (new fields, union members, cases, functions). Each feature has one owner:

| Feature | Owner | Also used by |
|---|---|---|
| Capture files: load a generated capture without a live run; 3,000+ rows; Statistics (Endpoints, Conversations, I/O graph); follow stream; TCP flags and ARP sender fields in filters; a "cite packet numbers" check | capture-analysis | watch-the-air, device-analysis (later) |
| Host-based firewall on an end device (inbound and outbound checks, numbered table with an explicit final rule, UFW log format); sshd auth.log and nginx access-log lines generated live; `ufw`, `ss`, and `grep` in the Terminal; automated ban after repeated failures | device-analysis | |
| Firewall rules that name an application (`FwRule.app`); NGFW identifies the application whatever the port; NGFW deep-packet inspection and intrusion prevention; router-hosted firewall shown in the inspector | firewall-types | device-analysis (later) |
| Detection bench: replay a labeled day of traffic through signature, anomaly, or hybrid detection and score speed, cost, true and false positives, false negatives; signature database versions; baselines; analyst alert queue | detect-methods | logs (later) |
| Wi-Fi: a client with a saved WPA3 or EAP profile refuses an open lookalike; authorized-AP inventory in the scanner (no automatic "not yours" label); wireless IDS rules (new BSSID, lookalike SSID, noise level); AP log lines students cite | watch-the-air | |

Both firewall-types and device-analysis edit `src/sim/firewall.ts` and `src/ui/inspector/FirewallRules.tsx`. firewall-types owns the `app` criterion; device-analysis owns attaching a firewall to a host and the UFW format. Keep both changes additive so the second merge is mechanical.

## Changes to existing labs (phase 2)

These come from the audits, in priority order within each lab. Bump `version` where a change breaks saved progress.

**on-path**
1. WPA2 (index.ts:220, question at 252 to 265): the protection is encryption, not delivery. Move the defense to WPA3, and say why a shared WPA2 password doesn't keep Mallory out.
2. HTTPS (408): credit the certificate. Mallory can't prove she's the bank, so the browser warns.
3. Static ARP (455 to 479) locks only Alice's table; the router stays poisoned. Lock both, or ask about it.
4. Add capture-based detection in step 11: filter `arp.opcode == 2` on the router's capture, cite the packets where one MAC claims two IPs (3.5.E.3).
5. One integrity beat: Mallory changes a transfer amount, plus a CIA question.
6. Smaller: a MAC address does not always "go wherever the laptop goes" (87 to 91).

**mac-flood**
1. Set `codehs` to 3.2. Use the CED's term "broadcast mode" in steps 3 and 4.
2. Step 5: a text question that quotes one log line's time and message and says what is abnormal.
3. Optional: a question on the "frames in" surge (3.5.E.4's first cue).

**dns-spoof**
1. Step 5 contradicts step 3: the cache holds a fresh record, yet the forgery replaces it. Let the record expire and have Mallory ask right then, with one sentence explaining.
2. Make the 3.5.E.5 evidence real: keep visits running until the poisoning; students find the last real visit and match it to the resolver's "(was ...)" line.
3. Ask: "The log says the answer came from the name server. Did the name server send it?"
4. Add a CIA question, the simulation-and-law notice, and `lab.test.ts`. Remove three "just"s. Fix the Kaminsky sentence (the 2008 fix added a random source port).
5. Merge the two HTTPS questions.

**smurf**
1. Remove "Set the speed to 0.5x" (70) and three "just"s.
2. Step 6: "The campus log says the pings came from 192.0.2.10. Is that the attacker?"
3. One sentence: the CED calls a smurf a DoS attack.
4. Show the ICMP rate rising at the campus router over time, not one line.
5. Step 8: "What legitimate traffic does the new rule stop?"

**net-tools** (move to slot 7, before net-audit)
1. Cut tickets 1 and 2 to one warm-up step (ping, nslookup on a bad record, traceroute as one demo). Target 45 minutes.
2. Reframe netstat as IoCs (3.5.E.7): unknown external IP, nonstandard port, mismatched program. Ask the adversary IP and the CIA impact.
3. Add a defender view: after the nmap scan, open the target's firewall log and cite the rows that show a scan.
4. Keep the permission letter and nmap here; net-audit points back to them instead of repeating its own letter.
5. Fix line 316 ("Destination host unreachable" is not only an ARP failure).

**net-audit**
1. Beacon contradiction: remove the beacon from the "least skill" options in step 4, rewrite the `combine` explanation, and say the CED's wireless policy disables beacons. Use a different accepted low risk in step 10, or accept the beacon only until the wireless policy applies.
2. New step "Rate new risks" after step 5: four or five short scenarios with no anchors given (SNMP that reveals device models: moderate; a hospital's flat network over WPA: high; a finding that needs a rare exploit chain: low). Students pick the level and the reason (skill needed, which part of CIA). Require a one-line written justification for each high finding in the register.
3. Re-script split tunneling: a home device infects the laptop, and the laptop's malware reaches the office through the tunnel. Make MFA matter (a stolen-password VPN login that MFA blocks).
4. Step 6: "Rule 1 now drops inbound ICMP. What legitimate traffic stops working?"
5. A "spot the gap" question: find the missing required item in a draft policy (CodeHS 3.6.4). Fill `codehs` with 3.5 and 3.6.

**wireless** (after the split: steps tour through rogue, then policy, reflect, submit)
1. Remove the twin and jam steps (watch-the-air takes them). The watch-the-air build does this trim.
2. Beacons: delete "The CED rates it a low-value control" (222). Teach that hiding the name is one layer, and that the CED's policy requires it. Add "disable beacon frames" and "AES" to the policy key (454 to 463).
3. Rogue AP: shut the switch port with port security instead of pulling the cable; tie it to 3.1.B.3.
4. Add a direction or antenna option to the WAP settings (3.2.B.2), or at least a defender question on it.
5. Fix the body at 127: every Wi-Fi frame reaches everyone in range; an open network means they can be read.
6. Target 45 minutes.

**segmentation**
1. Per-LAN features and a diagram (scenario 3C): extend the Zone plan card so each zone gets security-feature chips (zone firewall rules, port security, shut unused ports, physically separate switch, no shore access, NIDS sensor, disable unused services, patching). Draw the chosen features on the map zones, so the annotated map is the diagram, and include it in the report. Require more for the high zone. The reflection refers to the diagram.
2. Subnetting: a short block on what `/24` means. Unpin crew1's address: accept any free 10.0.30.x with the matching gateway. Two MCQs: "Which address belongs in the crew subnet?" and "A rule denies 10.0.30.0/24. Which devices does it cover?"
3. A dedicated-versus-VLAN question for the weapons LAN.
4. Trim step 1's body. If time runs over, step 8's port shutdown can become a question (three other labs teach it).

**firewall** (after the split: steps hospital through inner, then log, reflect, submit)
1. Remove stateless, fake, and ngfw (firewall-types takes them). The firewall-types build does this trim.
2. Add "Trace the ACL": an 8-row table shaped like the FRQ's (Deny SSH from one IP above Allow SSH, allows for 21, 80, 443, 445, 3306, 3389, an explicit final Deny all). Four or five test packets; students predict the rule number and verdict before testing.
3. Rewrite step 6 as requirements to rules, with no dictated fields. Goals check behavior, not exact rules.
4. Step 10: text questions for the denying rule number, the adversary IP, and how the lines show a scan.
5. Reflection: "Describe one rule change and its impact on allowed and denied traffic."
6. Fix 265 (Firewall B's outside faces the screened subnet). Define CIDR in one line. Replace step 1's repeated 443 question.

**logs** (after the trim: pick-method moves to detect-methods)
1. Accuracy: a failed signature update leaves old signatures running (192); the IPS here acts through the firewall and switch, where a real one sits inline (332); the threshold belongs to the AI on the SIEM (472); don't claim anomaly detection misses known attacks (616).
2. Turn the 14 auth failures into a password spray (one IP, many usernames, one or two passwords). Ask: spray or brute force, and which lines show it.
3. "Close the hole" after correlate: edit rule 1 (SSH from any) to the vendor's network, replay, describe the change and its impact.
4. IoC hunt: a text answer per IoC (source IP and the line's time).
5. Remove the 0.70 to 0.75 range from the threshold hint (456).
6. Reflect on the logs as the evidence that leads into detect-methods.

**build-network, wireshark, route-hijack** (optional group)
- Add an "Optional labs" group to the cyber home page (`src/curricula.ts`), after the core labs and before the answer sheets.
- build-network: fix line 610 ("Ben's never changed" his MAC), and drop `3.1.A` from `ced`.
- route-hijack: add a one-line note that BGP route choice is simplified; cut or shorten the HTTPS step; add PLAN.md and tests if it stays.

**Docs** (after merging)
- README: new rows, new order, optional group.
- COVERAGE.md: the "Where each EK is taught" table above, and add net-tools, packet-capture, and the new labs.
- ARCHITECTURE.md: the home-page order and the new shared APIs.

## New lab specs

One spec per lab, in `docs/unit3/specs/`:

- [capture-analysis](specs/capture-analysis.md): The Story in the Capture
- [firewall-types](specs/firewall-types.md): Smarter Firewalls
- [detect-methods](specs/detect-methods.md): Pick Your Detector
- [watch-the-air](specs/watch-the-air.md): Watch the Air
- [device-analysis](specs/device-analysis.md): Device Security Analysis
