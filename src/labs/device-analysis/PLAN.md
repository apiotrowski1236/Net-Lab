# Spec: Device Security Analysis (`device-analysis`)

**Status: built.** Code: `index.ts` (steps), `scenario.ts` (network, weekend logs, buttons, setups), `solution.ts` (answer key), `lab.test.ts`. The spec below is the plan as written; "As built" at the end lists where the lab differs.

New capstone (see `docs/unit3/SUITE-PLAN.md`). Slot 17 of 17, the last lab of the unit. Top priority of the new labs.

- **Title:** Device Security Analysis
- **Tagline (draft):** One web server, five sources of evidence. Read its firewall rules and logs, find two attacks, change the rules, and stop the next attack while it happens.
- **CodeHS:** 3.18 The Story in the Logs, 3.19 Securing Networks Quiz (review); also the firewall lessons 3.10 and 3.12 for rule tracing and writing
- **CED:** 3.4.B.1 to B.3 and 3.4.D.1 to D.3 (a host firewall); 3.5.A.3 (automated prevention); 3.5.E.7 (scan, known source); 3.1.C.1 (CIA); 3.2.A.1 (disable unneeded services)
- **Minutes:** 50. **Steps:** 11 or 12.
- **Prerequisites:** the whole unit, especially Firewall Rulebook and Log Detective.

## Why this lab

The exam's only free-response question (30% of the score, 50 minutes) is "Device Security Analysis." The sample in the CED (pages 157 to 165) gives several sources about one Ubuntu server:

- a host firewall table: rule number, action, source, destination, direction, port, protocol. Rule 1 denies SSH from one IP, then allows for FTP 21, HTTP 80, SMB 445, HTTPS 443, SSH 22 (from all), MySQL 3306 (from one IP), RDP 3389, VNC 5900 (from one IP), then rule 10 denies all inbound;
- `/var/log/auth.log` with failed FTP and SSH sign-ins for many invalid usernames from one IP (a password spray), and `[UFW BLOCK] IN=eth0 OUT= SRC=... DST=... PROTO=TCP PORT=25 SYN` lines (a port scan);
- an nginx access log with `curl` user agents and 404s;
- an acceptable use policy.

Students must: explain how part of a policy protects the device and how to change a rule to be more secure; describe the evidence of a password attack citing specific log entries and identify the adversary IP; explain how a firewall rule blocked a connection, citing the log; describe a rule change that would allow it and the impact of that change; determine another attack from the logs, describe its evidence, describe how an automated system could halt it in real time, and name a different countermeasure. Task verbs: Identify, Explain, Describe, Determine, Write (a command).

No NetLab lab has a host firewall, an sshd auth.log, UFW lines, an nginx log, or a typed firewall command. This lab builds all of them and runs the FRQ's moves on a live device, where students can see each claim hold up.

(File permissions and `chmod` are part of the sample FRQ but belong to a later unit. Leave them out. Note in PLAN.md that a permissions part can be added when that unit's labs are written.)

## Story

**Harbor Food Co-op** runs one Ubuntu web server, `web01`, for its online orders. A part-time admin, Jo, manages it from the office. A vendor updates the order database from their own network. Over the weekend, something hammered the server. Students have Jo's five sources and Jo's access to the server's terminal. (Pick different names and IPs from the CED's sample, so students practice the skill, not the answers.)

## Network

`web01` (the device, with a host firewall), the office network (Jo's laptop), the vendor's network, the internet, and one attacker address that does the spray and a second that scans. Keep it small: the evidence is the point.

## Steps (outline)

1. **The case** (tour). Inspect `web01`: its services (`ss -tuln` in the Terminal: listening ports) and its firewall table, shaped like the FRQ's (about 10 numbered rules, an explicit final "Deny all inbound"). Read the co-op's server policy (a short source in the step body or a policy panel). Question: which rule lets customers reach the order site?
2. **Trace the table.** Four connection attempts (a customer on 443, Jo on 22, an outside IP on 3389, the attacker's IP on 22). For each, predict the rule number and the verdict, then test it. Goals check the tests ran; questions check the predictions.
3. **The weekend's auth.log.** Logs tab: real-format sshd lines (`Failed password for invalid user admin from 203.0.113.x port 51234 ssh2`, `Accepted publickey for jo from ...`). Many usernames, one or two passwords, one source: a **password spray** (define it, and how it differs from brute force). Questions: the adversary IP (typed; any reasonable format), and which line numbers show the spray (cite rows, checked).
4. **Blocked at the door.** UFW lines (`[UFW BLOCK] IN=eth0 OUT= SRC=... DST=... PROTO=TCP SPT=... DPT=25 SYN`) from a second IP probing many ports in seconds. Questions: which rule blocked them (the final deny), the scanner's IP, and which rows show a scan (3.5.E.7, unauthorized scan).
5. **The web log.** nginx combined-format lines: normal customers, then `curl` requests for `/.env`, `/wp-login.php`, `/phpmyadmin`, all 404. Question: what the attacker was doing (looking for weak spots to attack: reconnaissance), citing rows. Connect to the scanner IP if it's the same source.
6. **Write the command.** In the Terminal, block the spray's source. `ufw deny from <ip>` appends the rule *after* the Allow SSH rule, so the spray still works: the test shows it. Students then use `ufw insert 1 deny from <ip>` (or delete and re-add) and test again. Teaches rule order with the exact command the FRQ's "Write" verb wants. Typed checks explain mistakes in this lab's terms.
7. **Change a rule, predict the impact.** The policy says remote administration only from the office network, and no unencrypted file transfer. Students find the rules that break the policy (SSH from anywhere; FTP 21 open to all; maybe RDP). Change SSH to the office network only and remove FTP. Before testing, a question asks who loses access (impact). Then test: Jo still works and the internet can't reach SSH, but the vendor's nightly upload (SFTP, which runs over SSH from the vendor's network) now fails. Students add an allow for the vendor's network above the final deny and test again. Text question: describe the change and its impact on allowed and denied traffic. The surprise is the lesson: a rule change has side effects you have to predict.
8. **Stop it while it happens.** Turn on automated prevention: after 5 failed sign-ins from one IP within a minute, ban that IP at the host firewall (the way fail2ban works). Replay the spray from a new IP. Watch the ban rule appear at the top of the table mid-attack, and the attack stop. Question: describe how this automated system halts the attack in real time (3.5.A.3).
9. **Another countermeasure.** Choice or multi-select: SSH keys only (turn off password sign-in), MFA, a VPN for admin access, rate limiting. Students apply one hands-on (turn off password authentication) and see the spray fail even before the ban.
10. **The write-up.** A short FRQ-style pair, teacher-graded, with the weekend's rule table in the step: (A) how one weekend connection was blocked, citing the log and the rule, and the impact of a rule change that would allow it; (B) one attack (the spray or the traversal), its rows and address, how an automated system halts it, and another countermeasure. `minWords` 25 each. (The panel cut the policy and spray-only parts for time: step 9 and step 3 already cover them.)
11. **Review and submit.**

## Features to build (this lab owns them)

1. **Host-based firewall.** A firewall attached to an end device: NetBuilder host option, an inbound check where packets are delivered to the host, an outbound check where the host originates packets, with direction relative to the host. Numbered rules with an explicit final rule shown as a row. Today `src/sim/firewall.ts` only runs on firewall boxes and routers (`src/sim/build.ts:66`); the router `guardSelf` branch may help but is untested for hosts.
2. **UFW log format.** A firewall option to write deny lines in UFW's kernel format. Keep the existing format the default for other labs.
3. **sshd and nginx logs generated live.** An SSH service that writes real-format auth.log lines for each sign-in attempt (failed, invalid user, accepted password, accepted publickey), and a web server option that writes nginx combined-format access lines (client IP, time, request, status, size, user agent). Back-dated history for the weekend (the `seedHistory` pattern in `src/labs/logs/scenario.ts`), plus live lines when students replay attacks.
4. **Attacker actions:** a password spray (many usernames, few passwords, one source) and a port scan against the host, as lesson buttons whose `run` is deterministic.
5. **Terminal commands** in `src/sim/terminal.ts`: `ss -tuln`, `ufw status numbered`, `ufw deny from <ip>`, `ufw insert <n> deny from <ip> [to any port <p>]`, `ufw allow from <cidr> to any port <p>`, `ufw delete <n>`, and `grep <text> /var/log/auth.log` (`tail` too, if cheap). Each change is a recorded `SimAction`. Typed checks with plain-words messages.
6. **Automated ban** (fail2ban-style) as an additive option in `src/sim/ids.ts` or its own module: threshold, window, ban action on the host firewall, and a log line for the ban.
7. **Citing log rows:** a check that takes row numbers from a named log view and tests each against a predicate. `capture-analysis` builds a packet version and `watch-the-air` a WAP-log version at the same time; build yours in its own module and note in your report which pieces could merge.

`firewall-types` is being built at the same time and also edits `src/sim/firewall.ts` and `src/ui/inspector/FirewallRules.tsx` (it adds an application criterion). Keep your edits additive: new optional fields, new cases, no reformatting.

Reuse: the firewall engine and rule editor, `src/runtime/firewallInput.ts`, the Terminal tool (`src/ui/tools/Terminal.tsx`, `src/sim/terminal.ts`, `src/ui/termText.ts`), services and `connectService`, the Logs tab and its search, `TextQuestion.verify`.

## Done means

All checks in the authoring skill pass (typecheck, tests, walkthrough, playthrough in light, dark, and small, click-through at 4× and 1×). The Terminal commands are covered by unit tests with exact messages. The logs read like real Ubuntu logs to someone who knows them. `/avoid-ai-writing` run on the student text. PLAN.md in `src/labs/device-analysis/`, set to "Status: built".

## As built

12 steps: case, trace, auth, ufw-log, command, fail2ban, keys, policy, write-up, submit, and two optional extra challenges after submit (close remote desktop; the web log). 55 minutes, so it runs past one 45-minute period: the panel's required times were 44 to 66 with the web log in, and that step comes out of the required time.

- **The web log is an optional extra challenge.** Directory traversal isn't a Unit 3 CED EK, and reconnaissance from a known address (3.5.E.7) is covered by the port scan in ufw.log. Moving it after submit took about 5 minutes out of a lab that ran long. Write-up part B now asks about the spray only.
- **The bot can always reach SSH in steps 6 and 7.** The bot and botnet share 203.0.113.0/24 with the sprayer. If a student's step 5 rule denies the whole network, or anything else keeps the bot from port 22, the fail2ban and keys setups narrow the deny to 203.0.113.77 and put back SSH from Anywhere (`ensureBotReachesSsh`).

- **Step order changed.** The spec puts the policy change (step 7) before fail2ban and keys. Built order: command, fail2ban, keys, policy. Once SSH is office-only, the bot and botnet can't reach sshd, so the fail2ban and keys demos would show nothing. The policy fix comes last, and the rule numbers in its text account for the rules added earlier (fail2ban's ban at the top, the student's deny for .77).
- **Five evidence sources became four.** The firewall rules, auth.log, ufw.log, and access.log (plus fail2ban.log once fail2ban is on). The tagline says "four kinds of evidence".
- **Botnet.** Each press of **The botnet tries again** moves Unknown C to the next address and makes 3 guesses, under fail2ban's maxretry of 5, so fail2ban never bans it. Only turning off password sign-in stops it.
- **Log rows.** Every log line goes through `sim.log` with `fields.file`; row N is the Nth entry for that file. The weekend history is a pure generator (`weekend()`), so the row constants (`ROWS`) are fixed at module load and the tests check them.
- **Typed rows.** `src/runtime/citeRows.ts` reads "11-24", "11 to 24", "11–24", "11, 12, 13" and explains a wrong citation ("Row 9 isn't part of the spray: ..."). capture-analysis and watch-the-air check citations too; the three could share this module.
- **Left out for later.** File permissions (`chmod`, `ls -l`) and the update policy (rule 4) have no step. A permissions part could be added to the write-up later.
- **Map.** One router, "Internet", joins the co-op server, the office, Bayline Farms, a customer, and a switch for the three unknown addresses.
