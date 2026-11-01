# Flood the Switch (`mac-flood`)

Status: planned, wave 1. Follow `docs/unit3/ARCHITECTURE.md`.

Tagline: Overflow a switch's memory so it repeats everyone's traffic to you, then lock its ports.

CodeHS: none confirmed yet (leave `codehs: []` unless you find the lesson). CED LOs: 3.1.A, 3.1.B, 3.2.A, 3.2.B, 3.3.B, 3.5.E.

## What students learn

- A switch remembers which port leads to each MAC address (review from `build-network`), and its table has a size limit.
- **MAC flooding** (3.1.A.2): frames from thousands of made-up source MACs fill the table. Real entries get pushed out, and the switch floods frames for unknown destinations out every port, like a hub. That makes **eavesdropping** possible.
- An open wall jack is a way in (3.1.B.3). A network that doesn't check who plugs in is easy to join (3.1.B.5).
- **Port security** (3.3.B.4) limits how many MACs a port may use and shuts the port (or drops frames) on a violation. Shutting unused ports closes the door entirely.
- **MAC filtering** (3.2.B.4) allows only listed MACs, but **MAC spoofing** (3.1.A.1) defeats it: MACs are sent in the clear and are easy to change.
- **Detection** (3.5.E.4): a surge of frames from many different MACs, a full MAC table with many MACs on one port, and port-security log lines.
- A **switch security policy** (3.2.A.2): logins through an approved authentication server (no local accounts), port security required, MAC filtering.

## Scenario and map

The front office of Lincoln High. One switch (`sw`, about 8 ports) connects: two staff PCs (Ms. Ortiz, the attendance clerk, and Mr. Chen, the counselor), a network printer, the student-records server (plain HTTP inside the office, which is itself a finding), and the router to the district network. Port 7 is a wall jack in the lobby with nothing plugged in. Mallory, a "visitor", sits in the lobby with a laptop. Use a building zone for the office and a smaller one for the lobby so the open jack reads as physically reachable.

Pick a switch table size small enough to fill visibly with one burst, for example 32 entries (say so: real switches hold thousands, and attackers send far more).

## Step outline

1. **The front office**: inspect the switch's MAC address table (prelearned). Question: why a switch sends a frame out one port, not all.
2. **A jack in the lobby**: as Mallory, plug into the lobby jack (cable tool, limited to that move). Turn on capture. Ms. Ortiz uploads attendance; Mallory captures only broadcasts. Question: why Mallory sees nothing private.
3. **Fill the table**: the MAC flooder tool sends bursts of frames with random source MACs. Watch the table fill and real entries get pushed out. Goal: table full, and a staff PC's entry gone.
4. **Everything, everywhere**: Ms. Ortiz uploads again. The switch floods it out every port; Mallory captures the record. Goal: open the captured upload. Question on CIA (confidentiality).
5. **Spot the flood**: switch logs (table full, many new MACs on one port), the MAC table (dozens of MACs on port 7), and frame counts. Goal: open the log line or table evidence pointing at port 7. Question: which evidence points to MAC flooding rather than a busy office.
6. **Port security**: in the switch's inspector, set port 7 to a maximum of 1 MAC with violation action "shut down". Flood again. The port shuts and logs a violation, and the table keeps the real entries. Goal: attack blocked and attendance upload goes only to the server.
7. **Only known devices**: turn on MAC filtering for the printer's port (allow only the printer's MAC). Mallory unplugs the printer, sets her laptop's MAC to the printer's (MAC spoofing tool, typed MAC, which she reads from her earlier capture), and plugs in. She's in. Goal: Mallory gets an address or reaches the router through the printer's port. Question: why MAC filtering alone isn't enough.
8. **Close the doors**: shut unused ports (the lobby jack) and set the printer port's violation action so a link change or a second MAC is caught. Discuss physical security and authentication (802.1X in one sentence, labeled as beyond the course). Goal: no open ports with no device behind them.
9. **The switch policy** (3.2.A.2): multi-select which rules belong in a switch security policy (include logins through an authentication server instead of local accounts).
10. **Reflect**: written, CIA impact of MAC flooding and which control you'd turn on first, and why.
11. **Submit**.

## Core features this lab owns (shared, see ARCHITECTURE)

- Switch MAC table limit and eviction policy (oldest first is fine; document it). Log lines when the table is full.
- `Frame.burst`: one in-flight frame that stands for N frames with different source MACs. The switch learns all N (deterministic MACs from `sim.rand`). The map draws it as a stack with a count ("×200"). `smurf` will reuse it for ICMP floods, so make it general (any frame type, a count, and how to derive each copy's varying field).
- MAC flooding action (attacker host sends K bursts), changing a host's MAC (`setMac`), port security per switch port (max MACs, violation `shutdown` or `restrict`, allowed or sticky MACs), port shut down by violation or by an admin, with a way to re-enable it. Switch log lines like a real switch (`%PORT_SECURITY-2-PSECURE_VIOLATION ...`, simplified).
- Inspector section for switch port security and port status. Toolkit cards for the flooder and the MAC changer.

## Acceptance

- Walkthrough test passes. Lab tests cover: the flood evicts a real entry and Mallory then captures a unicast frame; port security shuts the port on the first extra MAC; a spoofed allowed MAC passes MAC filtering; reload and replay give the same table.
- The flood stays smooth in the browser (no hundreds of SVG packets).
