# Spec: The Story in the Capture (`capture-analysis`)

**Status: built.** Code: `index.ts` (14 steps: 13 plus the optional Telnet challenge), `scenario.ts` (network, `dayTraffic`, the eight capture files in `FILES`, button replays), `solution.ts`, `lab.test.ts`. Shared features: `src/sim/tcp.ts` (flags, sessions, SYN scans, mirror port hooks in `sim.ts`), `src/sim/capfile.ts` (capture files, Endpoints, Conversations, I/O graph, follow stream, packet-list parsing), `src/labs/cite.ts` (cite-packets questions), goal helpers in `src/labs/helpers.ts` (`openedCapfile`, `openedPacket`, `sawStats`, `followed`, `fileFiltered`), the `capture-file` tool and `ui:*capfile*` events in `src/labs/types.ts`, the `capfile` answer-key move in `src/labs/solution.ts`, and the UI in `src/ui/CaptureFile.tsx` and `src/ui/inspector/MirrorPort.tsx`.

What changed from the outline below: step 3 cites one RST and asks attack-or-outage as a choice; step 5 asks the false-alarm question as a choice (true/false positive/negative); step 10 uses choice questions for the findings and IoCs plus mitigation choices for the smurf and ARP findings; step 11 replays the flood and the check-in with lesson buttons instead of re-running whole capture windows.

After the student panel (three rounds, Maya and Ethan): step 2 asks only for the top talker (its "why a baseline" question went, since the text says it); the IoC idea moved into step 9's text and step 10 dropped its IoC question, so step 10 asks for the attacks, CIA, and the two mitigations; spoofing, true/false positives and false negatives, MAC addresses, the MAC address table, `&&`, why port 4444 stands out, directed broadcast, static ARP entries, and the CIA triad are each taught before a question uses them; step 10 has the capture files again; step 11 is numbered sub-steps and its blocked-check-in goal needs a SYN the firewall denied. In the shared capture-file view, the file and the Statistics buttons share one row, and a click on an I/O Graph bar opens the Packet list at that second.

After the PR review: the Statistics tables (Endpoints, Conversations) draw only the rows on screen and sort once per column click, like the packet list, so the 14:00 file's 3,037 MACs open in about 20 ms instead of half a second; the sentence-length choice questions were reworded so the longest option is right about as often as chance; `cite-orders` turns away the server's "received" after the upload (a command reply has `cmd=`); `cite-flood` names the ordinary packet when one inside a range leaves too few flood frames; the outage feedback counts 20 SYNs per kiosk, three seconds apart; packet lists accept "412." "412 or 415" and "412/415"; `tcp.flags == 0x012` gets a hint for the one-flag-at-a-time filters.

Replaces Wireshark for Real in the suite (see `docs/unit3/SUITE-PLAN.md`). Slot 15 of 17, after `detect-methods` and before `watch-the-air`.

- **Title:** The Story in the Capture
- **Tagline (draft):** Open a day of packet captures from a bus depot, tell the broken from the malicious, and cite the packets that prove each attack.
- **CodeHS:** 3.18 The Story in the Logs (3.18.6 Packet Capture, 3.18.7 Packet Capture Lab: Reading Network Indicators, 3.18.8 Identifying Indicators of Compromise)
- **CED:** 3.5.E.3, 3.5.E.4, 3.5.E.6, 3.5.E.7 (hands-on); 3.1.C.1 (CIA per finding); 3.5.D.3 (a false alarm)
- **Minutes:** 50. **Steps:** 12 or 13.
- **Prerequisites students have:** packet-capture (columns, layers, display filters by address and protocol, encrypted vs plain), and the attack labs on-path, mac-flood, smurf, and logs. Don't re-teach the attacks; teach how each one *looks* in a capture.

## Why this lab

The CED says network IoCs are "discovered when analyzing network traffic, often in the form of packet capture files." No current lab asks students to find an attack in a capture and prove it. The exam's FRQ asks students to cite specific evidence and name the adversary. This lab is that skill on packets. It also does the "deeper" capture work Wireshark for Real was meant to: statistics views, conversations, TCP flags, follow stream, and telling a broken service from an attack.

## Story

Students are the new analyst for **Valley Transit**, a city bus company. The depot network has dispatch computers, a fare server, the fare kiosks, a camera recorder, a switch, and a router to the internet. The switch copies every frame to the analyst's laptop through a **mirror port** (define it: the switch sends a copy of all traffic to one port, so one computer can capture everything). Night shift left a ticket: "Network was weird all day. Kiosks failed in the morning, things were slow at lunch, and the camera recorder was talking to something at 2 a.m." Students get the day's capture files, one per time window, and work the ticket.

## Steps (outline; adjust as building teaches you)

1. **The ticket** (tour). Inspect the depot devices and the mirror port. Open the 07:00 capture file (normal traffic). Learn the numbered rows and relative time. Question: why capture at the mirror port instead of on one computer?
2. **What normal looks like.** Statistics: Endpoints and Conversations on the normal capture. Find the top talker (the fare server and kiosks). Question: why an analyst records normal first (ties to baselines from logs).
3. **A broken kiosk, not an attack.** 08:00 capture: kiosks can't reach the fare server. Follow the TCP handshake: SYN, then RST from the server (the fare service crashed, port closed). Define **SYN**, **SYN-ACK**, **ACK**, **RST** in plain words. Question: attack or outage, and which packet proves it? Diagnosis step: not every problem is an attack.
4. **Slow at lunch, part 1.** 12:00 capture with an I/O graph spike. Filter `icmp`. Find echo requests to the depot's broadcast address with a source that isn't a depot device. Cite packet numbers. Question: is the source IP the attacker? (No: forged; it's the victim. The depot is the amplifier.) 3.5.E.6.
5. **Slow at lunch, part 2.** A second spike in the same window is the nightly backup run early: big, steady, one known pair, TCP to the backup port. Question: which spike is the attack, and why the other is a false alarm (3.5.D.3).
6. **One MAC, two addresses.** 13:00 capture. Filter ARP replies (`arp.opcode == 2`). Find unsolicited replies where one MAC claims the gateway's IP. Use the ARP sender fields. Cite packets, name the attacker's MAC, find which device owns it (Endpoints or the switch table). 3.5.E.3.
7. **Many MACs, one minute.** 14:00 capture. Endpoints shows thousands of source MACs in seconds; the I/O graph surges. Cite a range of packets. Question: what the switch's MAC table would show (3.5.E.4).
8. **Knocking on every door.** 15:00 capture. One outside IP sends SYNs to many ports on the fare server; closed ports answer RST, one open port answers SYN-ACK. Conversations sorted by port count. Cite packets; name the scanner's IP; which port is open. (Unauthorized scan, 3.5.E.7.)
9. **Wrong port, wrong program.** 02:00 capture. The camera recorder opens HTTP to an outside IP on port 4444, and that IP is on the threat list in the ticket. Follow the stream: plain HTTP text on a non-web port. Cite packets. Two IoCs: known malicious IP and mismatched port and application (3.5.E.7).
10. **The incident report.** For each finding (smurf, ARP poisoning, MAC flood, scan, C2 traffic): attack name, adversary address (or "forged"), packet numbers, the part of CIA at risk, and the best mitigation (choice from a short list per finding). Mix of short-answer checks and choices. The outage and the backup are listed as "not attacks."
11. **Fix and capture again.** Apply two mitigations on the live depot network: port security on the port the MAC flood came from, and an edge firewall rule denying the threat-list IP (or the student's choice from a short menu). Re-run the afternoon and night traffic and capture again. The IoCs are gone or show as blocked. (Defend and retry.)
12. **Reflect.** Written, about 40 words: one finding, the packets that prove it, and why the capture was better evidence than a user's complaint.
13. **Review and submit.**

An optional extra challenge after submit: a capture with a Telnet sign-in; follow the stream and find the password (confidentiality).

## Questions that must be in the lab (FRQ shape)

- Cite packet numbers for at least four findings, checked automatically (see "cite" below).
- Name the adversary IP for the scan and the C2 traffic. For the smurf, recognize the forged source.
- One "attack or not?" judgment with evidence (the outage, the backup).
- A mitigation choice per finding, with feedback that teaches.

## Features to build (this lab owns them)

Put logic in `src/sim/capfile.ts` (or similar) and keep sim and UI edits additive.

1. **Capture files.** A step can hand students one or more named capture files ("07:00 depot.pcap"). A file is a list of frames generated *deterministically* by running scripted traffic through a sim (not hand-written rows), so the frames have real headers. Opening one shows it in the capture panel without a live run. The panel must handle 3,000+ rows smoothly (virtualized list), with packet numbers and time since the file's start.
2. **Bursts expand in files.** A `Frame.burst` becomes its individual frames inside a capture file (with the varied source MACs or IPs), so Endpoints counts and filters work on a flood.
3. **Statistics views.** Endpoints (by MAC and by IP: packets, bytes), Conversations (pairs, packets, ports used), and an I/O graph (packets per second, optionally by the current display filter). Clicking a row applies a filter.
4. **TCP flags.** Model SYN, SYN-ACK, ACK, RST, FIN on TCP packets at least as far as captures show them (an optional field on the packet). Filters: `tcp.flags.syn == 1`, `tcp.flags.reset == 1`, and friends. A connection to a closed port answers RST. A port scan shows as SYNs and RSTs.
5. **ARP fields in filters.** `arp.src.proto_ipv4`, `arp.src.hw_mac`, `arp.dst.proto_ipv4` (Wireshark names).
6. **Follow stream.** For a conversation, show the request and reply text in order, the way Wireshark's Follow TCP Stream does.
7. **Cite packets.** A way for a question to take packet numbers ("Which packets show it? Type their numbers, like 412, 415") and check each one against a predicate on the frame in a named capture file. Feedback names the number that doesn't fit and why ("Packet 415 is a reply from the gateway's real MAC"). Work it into `TextQuestion.verify` or a new question kind, whichever fits; it must show in the Guide and the report.

Reuse: the capture panel and display-filter engine from packet-capture, `Frame.burst`, `sim.arpSpoof`, `sim.echo` with a forged source, the port scan in `src/sim/services.ts`, port security, the firewall engine, `isPlainLogin`, `openedFrame`, `capturedSince`.

These features will be reused by `watch-the-air` and later labs, so document them in ARCHITECTURE-style comments at the top of the module.

## Out of scope

Saving or downloading real .pcap files. Wireshark's coloring rules. TLS decryption. Exact TCP sequence numbers (flags only).

## Done means

- All the checks in the authoring skill pass: typecheck, unit tests, `lab.test.ts`, the walkthrough, the playthrough (light, dark, small), and the click-through at 4× and 1×.
- Screenshots of every step read at 1366x768 with no overlaps; the 3,000-row file scrolls smoothly.
- `/avoid-ai-writing` run on the student text.
- PLAN.md in `src/labs/capture-analysis/` (copy this spec in and keep it current), set to "Status: built" at the end.
