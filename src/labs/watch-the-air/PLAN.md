# Spec: Watch the Air (`watch-the-air`)

Status: built. The code is in `src/labs/watch-the-air/` (`index.ts`, `scenario.ts`, `solution.ts`, `lab.test.ts`). Follow `docs/unit3/ARCHITECTURE.md`. See "Built" at the end for what changed from this spec.

Split from `wireless` (see `docs/unit3/SUITE-PLAN.md`). Slot 16 of 17, after The Story in the Capture.

- **Title:** Watch the Air
- **Tagline (draft):** Keep watch over the shelter's Wi-Fi: catch a rogue access point, a lookalike network, and a jammer, then choose the alarms that will catch the next one.
- **CodeHS:** 3.18.5 Locating a Rogue AP with Signal Triangulation; 3.14 The Automated Detectors; 3.4.2 Wireless Attacks (review)
- **CED:** 3.5.E.1 and 3.5.E.2 (hands-on); 3.1.B.6 detection; scenario 3B's second half ("Recommend a collection of detective controls to monitor the network and raise an alert for any potential malicious activity" and "Describe the impact of the detective control recommendations"); 3.5.D.3 (false alarms)
- **Minutes:** 45. **Steps:** 10 or 11.
- **Prerequisites:** Signals Past the Walls (the shelter, WAP settings, WPA3, EAP, the rogue AP attack, the scanner), Log Detective (alerts, false positives), and The Story in the Capture (citing evidence).

## Why this lab

`wireless` runs 55 to 65 minutes and covers three CED topics. Its last content steps (evil twin, jamming) are detection, which CodeHS teaches much later (3.18.5). Scenario 3B's detective half (recommend detective controls, describe their impact) is in no lab. The CED's 3.5.E header says "by analyzing log files," and the wireless lab never shows a log, although the sim writes WAP log lines. And the evil twin has a bug: a phone with a saved WPA3 or EAP network joins an open twin because it's louder, which real phones refuse to do.

## Story

Two weeks after the shelter opened (the same shelter as Signals Past the Walls). The Wi-Fi is locked down. The National Guard technician now has to keep watch: families report odd things, and the technician needs alarms that catch problems without crying wolf.

## Steps (outline)

1. **Two weeks later** (tour). Setup applies Signals Past the Walls' finished configuration (WPA3, EAP for staff, power lowered, beacons off). Inspect the WAP and the **authorized access point list** (an inventory: name, MAC/BSSID, channel, location). Question: why keep an inventory.
2. **Sweep the air.** Run a scan from the gym. Compare each access point to the inventory; the student marks the one that isn't on it (the scanner must not label it for them). Then find it on the wired side: the switch log shows a new MAC on a jack that used to be unused. Cite the log row. Shut the port with port security. 3.1.B.6 detection, 3.1.B.3.
3. **A name that's almost right.** A lookalike network appears ("Shelter-WiFi" vs "Shelter_WiFi", open). Staff phones with the saved WPA3/EAP profile ignore it; a visitor's phone with no saved profile joins it and gets a fake sign-in page. Question: why the saved profile protected staff (what the twin can't fake). 3.5.E.1.
4. **Find the box.** Triangulate the lookalike from three spots and walk to it. 3.5.E.1.
5. **Read the WAP's log.** Cite the rows that show the twin's effect: the visitor's device disassociating from the real network, a burst of deauthentication messages before it (if modeled), and the same device MAC now seen on the twin. Question: which rows are the evidence, and what they show.
6. **Nobody can connect.** Every device in the gym drops at once. The WAP is still up on the wire (it answers ping, its link is up), and its log shows retries and failures. Scan for noise: the noise level in the gym is far above normal. 3.5.E.2.
7. **Jammer or a crowd?** Movie night: 120 people online, everything is slow, but devices stay connected and the noise level is normal. Question: is this jamming? Which two signs tell them apart (a false alarm to avoid).
8. **Choose your alarms.** Turn on wireless detection rules: alert on an access point not in the inventory, alert on a lookalike name, alert when noise passes a threshold, alert on a new MAC on a switch port. Replay the two weeks; read the alerts. Tune one threshold that fires on movie night (false positive) without missing the jammer.
9. **Describe the impact.** Scenario 3B's deliverable: recommend the set of detective controls and describe their impact (staff time, false alarms, cost, families' privacy). Teacher-graded written answer, plus a multi-select.
10. **Reflect** (or fold into step 9).
11. **Review and submit.**

## Features to build (this lab owns them)

1. **Saved-profile check for Wi-Fi clients** in `src/sim/wifi.ts` (`clientPasses`): a client with a saved profile (security type and, for EAP, the server) refuses a network with the same or a lookalike name that doesn't match the profile. Clients with no profile behave as now. Keep the existing wireless lab's behavior working (its twin step moves here; see the trim below).
2. **Authorized-AP inventory** in the Wi-Fi scanner: a list the lab defines; students mark unknown entries themselves. Don't auto-label "not yours" in this lab (an option on the tool spec, so other labs can keep the old behavior).
3. **Wireless detection rules** (a small wireless IDS): new BSSID not in inventory, lookalike SSID (a simple similarity check), noise above a threshold, new MAC on a switch port. Alerts go to the Logs tab like other alerts.
4. **WAP and switch log lines** students can cite: association, disassociation, deauthentication (if modeled), retries, noise, new MAC on port. Reuse the `wifi` log source in `src/sim/sim.ts` and the switch's `link` and `mac-table` sources.
5. **A citation check** for log rows. `capture-analysis` is building a "cite packet numbers" check at the same time. Build a small log-row version here (or a text question with `verify`), and keep it separate so the two merge cleanly.

Reuse: `src/sim/wifi.ts` (`signalAt`, `reach`, `triangulate`), `setWifiJam`, `wifiScan`, `wifiMeasure`, `src/ui/tools/WifiScanner.tsx`, `Triangulate.tsx`, port security from `src/sim/switchsec.ts`, the Logs tab.

## Parent-lab trim (do this in the same branch)

- In `src/labs/wireless/index.ts`, remove steps `twin` and `jam`, and their answer-key entries and tests. Bump the wireless lab's `version`. Keep its rogue AP step.
- Point the wireless lab's last content step at this lab ("Next: keeping watch").
- Update the wireless lab's `PLAN.md` to match. Make no other changes to the wireless lab (its beacon and policy fixes are a separate pass).

## Done means

All checks in the authoring skill pass (typecheck, tests, walkthrough, playthrough in light, dark, and small, click-through at 4× and 1×) for this lab and the trimmed wireless lab. Watch the map's height: the Wi-Fi reach circles grow it (see "Map layout gotchas"). `/avoid-ai-writing` run on the student text. PLAN.md in `src/labs/watch-the-air/`, set to "Status: built".

## Built

Shipped as 10 steps, 45 minutes, version 1: `tour`, `sweep`, `lookalike`, `find`, `evidence`, `jam`, `crowd`, `alarms`, `recommend` (the multi-select and the written impact; the reflection is folded in), `submit`. CED `3.5.E`, `3.1.B`, `3.5.D`. Registered in `src/labs/index.ts` and the cyber course in `src/curricula.ts`, after `logs`.

Deltas from the outline:

- **Network.** `buildWatch()` starts locked down (WPA3, EAP with server `radius.shelter`, beacons off, power 2), so the tour needs no setup. A second approved AP (`wap2`, the office, channel 1) makes the inventory a list. Staff devices carry the saved profile; Mr. Okafor's phone (`visitor`) has none.
- **Sweep.** The rogue box went in last night: `seedRogue` backdates the switch's `%LINK-3-UPDOWN` and `%SW_MATM-6-MAC_NEW` lines on port 7 and the AP's "new network heard" line. The student marks each scan row **On the list** or **Not on it**, cites the switch line, and shuts port 7 in the switch's inspector.
- **Lookalike.** The copy appears as `Shelter_WiFi` (open), then **The radio copies the name and the security** gives it the exact name, WPA3, and its own sign-in server that accepts any login. A phone roams only between radios with the same name and security, so matching both is what lets the copy pull in a phone. Staff devices refuse it because their profile names `radius.shelter` and the copy can't show that certificate. Mr. Okafor's login was typed in by hand with no profile, so his phone roams to the louder copy and sends his login to its server (student panel round 1: an open copy pulling in a phone that had joined the WPA3 network taught a wrong idea). The map shows the rogue box and the copy only while their radios are on (`map.hide`). **Unplug the radio** does nothing until the three readings have located the copy. **Give Mr. Okafor a new login and save the profile** covers both fixes: the copy's server kept his old login.
- **Clock.** Step setups move the clock forward (`catchUp`, `TONIGHT`): the lookalike at 18:05, the jammer at 19:30, movie night at 20:00, so the log matches the story and the record's day-14 entries (student panel round 2).
- **Evidence.** Deauthentication is not modeled. The three cited lines are "new network heard", the visitor "left Shelter-WiFi", and the visitor "seen talking to ... not on the approved list" (the stray line).
- **Jam.** The jammer has no map device: `setJam` sets `sim.jam` on channel 6 and the AP logs noise 88. The student checks port 1 on the switch (up), scans (the AP still shows, noise by channel), and opens the newest noise line. The step text mentions no ping.
- **Crowd.** Movie night is 140 devices (the noise formula needs more than 120 to clear 10): noise 17, everyone stays connected.
- **Alarms.** Four rules and six noise levels (10 to 95) on the **Wireless alarms** card. Replay scores the 14-day `RECORD`: attacks caught, missed, false alarms. Levels 20 to 80 catch all three attacks with no movie-night alarm; every setting still flags the volunteer's laptop on day 5, which the step's question discusses.

Shared APIs added (all additive):

- `src/sim/wids.ts`: approved list, marks, rules, `noiseLevel`, `looksLike`, `alertsFor`, `replayRecord`, `RULE_TEXT`. `Device.wids`, SimEvents `wids` and `log-cite`.
- `src/sim/wifi.ts`: `WifiProfile`, `WifiClient.profile`, `matchesProfile`, join reason `'profile'`, `WifiAp.server`.
- `Sim` (section "wireless watch (watch-the-air)"): `configureWids`, `channelNoise`, `widsMark`, `widsSetRule`, `widsSetThreshold`, `widsReplay`, `setWifiCrowd`, `setWifiProfile`, `citeLog`, `logCites`.
- SimActions `wids-mark`, `wids-rule`, `wids-threshold`, `wids-replay`, `log-cite`; answer-key move `{ citeLog, where }`; helper `citedLogs` in `src/labs/helpers.ts`.
- ToolSpecs: `wifi-scan` gets `watch` (marks, channel column, noise line, no auto flags); `logs` gets `cite`; new `wids` card (`src/ui/tools/WidsCard.tsx`). Inspector section "Approved access points" (`ApprovedAps.tsx`). Log citation UI in `src/ui/LogCite.tsx` (kept apart from capture-analysis's packet citations).
- `LabDef.map.hide` (`src/labs/types.ts`, `src/ui/NetworkCanvas.tsx`): devices to leave off the map for now.
- Click-through drivers for Wi-Fi, alarms, ports, cables, and log lines in `.claude/skills/netlab-lab-authoring/drivers.mjs`; `EACH=1` also saves each step after its moves.

