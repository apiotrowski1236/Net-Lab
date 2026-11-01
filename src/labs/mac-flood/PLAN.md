# Flood the Switch (`mac-flood`)

Status: built (wave 1). Follows `docs/unit3/ARCHITECTURE.md`. Code: `index.ts` (steps), `scenario.ts` (network), `solution.ts` (answer key), `lab.test.ts`.

Tagline: Overflow a switch's memory so it repeats everyone's traffic to you, then lock its ports.

CodeHS: none confirmed (`codehs: []`). CED LOs: 3.1.A, 3.1.B, 3.2.A, 3.2.B, 3.3.B, 3.5.E.

## What students learn

- A switch remembers which port leads to each MAC address (review from `build-network`), and its table has a size limit.
- **MAC flooding** (3.1.A.2): frames from many made-up source MACs fill the table. Real entries get pushed out, and the switch floods frames for unknown destinations out every port, like a hub. That makes **eavesdropping** possible.
- An open wall jack is a way in (3.1.B.3). A network that doesn't check who plugs in is easy to join (3.1.B.5).
- **Port security** (3.3.B.4) limits how many MACs a port may use and shuts the port (or drops frames) on a violation. Shutting unused ports closes the door entirely.
- **MAC filtering** (3.2.B.4) allows only listed MACs, but **MAC spoofing** (3.1.A.1) defeats it: every frame shows its From MAC, and software can change it.
- **Detection** (3.5.E.4): table-full log lines that each learned 20 MACs on one port, dozens of MACs on one port in the port table, and link up/down lines when a device is swapped.
- A **switch security policy** (3.2.A.2): admin logins through the district's authentication server (no shared local accounts), port security on user ports, unused ports shut, MAC filtering for devices that never move.

## Scenario and map

The front office of Lincoln High at 10:15 (`clock: '10:15'`). One 8-port switch (`sw`, table size 32) connects the District router (p1), the Records server (p2, plain HTTP, `records.lhs`), Ms. Ortiz the attendance clerk (p3), Mr. Chen the counselor (p4), and the Lobby printer (p5, MAC on a sticker in its notes). Port 7 is a wall jack in the lobby; ports 6 and 8 are spare. Mallory, a visitor, sits in the lobby with a laptop and starts unplugged.

Zones: the office (staff only), the lobby (open to visitors, warn tone), and a "Wall jack, port 7" plaque that turns from red to green when port 7 is shut. The switch log is seeded with this morning's restart and link lines (negative times), so the log has history before the lab starts. Map ports are tagged (`map.ports`).

The 32-entry table is stated in the lesson as a simplification: real switches hold thousands, and real floods send thousands of frames a second. The sim evicts the oldest entry when full; the lesson says real switches stop learning and let entries age out, with the same result.

## Steps (as built)

1. **The front office** (tour): inspect the switch's MAC table and Mallory. Question: where a frame for the records server goes (out port 2 only).
2. **A jack in the lobby**: press "Mallory plugs into the lobby jack", turn on Packet capture, press "Ms. Ortiz sends attendance". Mallory sees only the ARP broadcast. Goal checks that the upload reached the server while Mallory was capturing on port 7. Question: why Mallory got no copy.
3. **Fill the table**: MAC flooder (1, 3, or 5 bursts of 20 frames). One burst is not enough; the table fills on the second. Goals: table full, records server's MAC pushed out. Question: what the switch does with a frame for an unknown MAC (floods it).
4. **Everything, everywhere**: Ms. Ortiz sends again; Mallory captures `GET /attendance`. Goals: captured, opened. Questions: CIA (confidentiality), and a typed answer (which student has a doctor's appointment).
5. **Spot the flood** (switch sides): open a TABLE_FULL line in the Logs tab and the switch's port table. Questions: which clue shows flooding, and which port (typed, accepts 7, port 7, p7).
6. **Port security**: in the switch's "Ports and port security" section, port 7 gets most MACs 1, shut down on violation. "Mallory floods again" shuts the port at the first extra MAC; the table keeps the five real entries; Ms. Ortiz's upload stays private. Question: why that stops flooding.
7. **Only known devices**: read the printer's MAC, turn on MAC filtering on port 5 (allow only the printer, drop on violation). Mallory takes the printer's cable and pings the records server: dropped. She changes her MAC to the printer's with the MAC changer and pings again: reply. Question: why MAC filtering is not enough on its own.
8. **Close the doors**: the printer is back. Search the Logs for port 5 and open the "changed state to down" warning from the swap. Shut every empty port (6, 7, 8) on purpose, including port 7, which port security had shut. Question: what would stop a copied MAC (a port that makes a device prove who it is; 802.1X named as beyond the course).
9. **The switch policy**: multi-select the four rules that belong (authentication server, port security, unused ports shut, MAC filtering for fixed devices).
10. **Reflect**: written, at least 40 words: which control to turn on first, and why.
11. **Submit**.

The plan's step 7 goal ("Mallory gets an address") became a ping reply through port 5, since the sim has no DHCP in this lab. Step 8's "printer port violation action" was folded into step 7 (restrict) and replaced by the log-reading goal, which gives 3.5.E a second detection moment.

## Core features this lab owns (shared, see ARCHITECTURE)

- `src/sim/switchsec.ts`: switch MAC table limit with oldest-first eviction, port security (max MACs, `shutdown` or `restrict`, allowed list, sticky), admin and violation shutdown, and Cisco-style log lines (`%SW_MATM-4-TABLE_FULL`, `%PORT_SECURITY-2-PSECURE_VIOLATION`, `%PM-4-ERR_DISABLE`, `%LINK-3-UPDOWN`, `%LINK-5-CHANGED`). Opt in with `sim.configureSwitch(id, { tableSize })`; switches without it behave as before.
- `src/sim/burst.ts`: `Frame.burst` (`count`, `vary: 'src-mac' | 'src-ip' | 'none'`, `seed`). One in-flight frame stands for N; switches learn all N; the map draws a stack with "×N". Works for any frame type (`sim.sendBurst`).
- `Sim`: `configureSwitch`, `sendBurst`, `macFlood`, `setMac`, `setPortSecurity`, `setPortShutdown`. Events `mac-overflow` and `port-security`; drop reasons `port-shutdown` and `port-security`.
- SimActions `mac-flood`, `set-mac`, `port-security`, `port-shutdown`; input checks in `src/runtime/switchInput.ts`.
- Inspector section `switch-ports` (MAC table meter, per-port MACs, frames in, state, and the port editor with the `port-security` tool). Toolkit cards: MAC flooder, MAC changer, Port security.

## Acceptance

- Walkthrough test passes. `lab.test.ts` covers: only the ARP broadcast before the flood; one burst is not enough; the flood evicts the server and Mallory captures the upload; at most 36 frames in flight during a 5-burst flood; reload gives the same table; reset in step 4 refloods; port security shuts port 7 and keeps the real entries; MAC filtering blocks Mallory until she spoofs; step 8 has its log evidence after a reset; shutting only port 7 is not enough; input checks.
- The flood stays smooth in the browser: about 16.7 ms per frame (60 fps) at 1366x768 during a 3-burst flood.
