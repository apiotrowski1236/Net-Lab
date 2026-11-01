# Walls Inside the Network (`segmentation`)

Status: built (wave 2). Follows `docs/unit3/ARCHITECTURE.md`. Code: `index.ts` (steps), `scenario.ts` (network and setup helpers), `solution.ts` (answer key), `lab.test.ts`. Feature code: `src/sim/vlan.ts`, `src/sim/malware.ts`, `src/sim/zonePolicy.ts`, `src/sim/zones.ts`. Interface: `src/ui/inspector/Vlans.tsx`, `ZonePolicy.tsx`, `Malware.tsx`; `src/ui/tools/ZonePlan.tsx`, `VlanCard.tsx`, `ZonePolicyCard.tsx`. Full lesson: [SCRIPT.md](SCRIPT.md) (its top sections list where it departs from this plan, and what changed while building).

Tagline: Split a submarine's flat network into zones and watch malware hit a wall.

CodeHS: `3.8 Network Segmentation`. CED LOs: 3.1.B, 3.1.C, 3.3.A, 3.3.B, 3.4.C.

## What students learn

- **Lateral movement** (3.1.B.2, 3.1.C.1): once one device on a flat network is compromised, the adversary (or a worm) can reach every other device on it.
- **Network segmentation** (3.3.B.1, 3.3.B.2) divides a network into smaller, isolated segments, so an attack on one doesn't reach the others.
- **VLANs** (3.3.A.3) separate devices logically on the same physical switch. **Subnetting** (3.3.A.2) gives each segment its own IP network, so traffic between segments must pass a router, where policy can be enforced.
- Different segments get **different security levels and policies** (3.3.B.3, 3.4.C.1, 3.4.C.2): a firewall for each segment, each set independently.
- A **screened subnet (DMZ)** (3.3.A.1) is one kind of segment: public-facing, lower security. One question ties back to it (taught hands-on in `firewall`).

Topic 3.3 comes before firewalls (3.4) in the CED. So policies here are a simple zone-to-zone allow or deny matrix, built on the firewall engine but without writing ACL rules.

## Scenario and map

CED unit scenario 3C. A naval submarine has three groups of computers: weapons systems (two consoles), naval operations (two consoles and a chart server), and crew recreation (two crew laptops and a media server). At the start, all of them share one switch and one subnet. Use map zones to show the three groups and later the VLANs.

## Step outline

1. **One big network**: tour. Every device is on `10.0.0.0/24` on one switch. A crew laptop pings a weapons console. Question: what could go wrong.
2. **A game with a passenger**: press **Crew laptop 1 installs a game**. The malware knocks on port 445 at every address on its network and copies itself to every computer with file sharing open, Fire control first. Infected devices and the probes turn red. Goals: it reaches a weapons console, then all eight; open Fire control to see where its copy came from. Questions: lateral movement, and confidentiality, integrity, and availability.
3. **Draw the lines**: reset. In the **Zone plan** card, assign each device to a zone (weapons, operations, crew) and pick a security level for each. The map draws the zones. Questions: which zone needs the strictest policy, and what segmentation is for.
4. **VLANs**: set each switch port's VLAN (10 weapons, 20 operations, 30 crew). A crew laptop's broadcast no longer reaches the other ports. Goal: ARP from the crew laptop reaches only crew ports. Question: what a VLAN does without new hardware.
5. **Subnets**: each VLAN gets its own subnet (`10.0.10.0/24`, `10.0.20.0/24`, `10.0.30.0/24`) and its own cable to a firewall port (one cable per VLAN, no trunk). Setup does Weapons, Operations, Crew laptop 2, and the media server. The student puts switch port 12 in VLAN 30, gives the firewall's port 3 `10.0.30.1/24`, and moves Crew laptop 1 to `10.0.30.31/24` with gateway `10.0.30.1`. Goals: the movie list loads; Crew laptop 1 pings Command through the firewall. Question: predict that subnets alone don't stop the malware.
6. **Rules between zones**: set the zone policy matrix in the firewall's inspector: crew to anything else denied; operations to weapons only target data (5001); weapons to operations only status reports (5002); weapons and operations to crew denied. Four test buttons. Goal: allowed pairs connect, denied pairs are blocked and logged.
7. **Malware, again**: the crew laptop installs the game again. It spreads to the other crew devices, the firewall denies and logs its probes to the other zones, and it stops. Goals: weapons and operations stay clean; open a blocked probe in the firewall's log. Questions: why segmentation contained it, and why the crew segment still got hurt.
8. **One more door**: an unused port in the weapons VLAN. A personal laptop plugs in and opens Fire control's file share without passing the firewall. The student shuts the port (`mac-flood`'s port shutdown), and the laptop can't get in. Port security is covered by two questions (3.3.B.4).
9. **The DMZ connection**: question on screened subnets, using the sub's shore link mail relay as the example.
10. **Reflect**: written, recommend security features for each of the three LANs (the scenario's deliverable).
11. **Submit**.

## Core features this lab owns

- VLANs on switches: each port has a VLAN ID (`SwitchPort.vlan`, beside mac-flood's port state), and frames (including broadcasts and flooding) stay within one VLAN. Access ports only, no trunks (step 5 says bigger networks use them). Shown in the switch's **VLANs** inspector section and on the map (zone labels name the VLAN once every member's port is in it).
- Malware that spreads (simulated only): an infected host tries port 445 at every address in `10.0.0.0/16`, its own subnet first (so subnets alone don't contain it; the zone policy does), and infects hosts it reaches with file sharing open, through `firewall`'s service connections. Deterministic, quick, visible: red devices and probes, an "infected" marker, a **Malware** inspector section, and firewall deny lines.
- Zone policy matrix (the firewall's **Zone policy** inspector section) that writes firewall-engine rules underneath, one note per zone pair, and names the pair in deny log lines and drop text.

## Acceptance

- Walkthrough test passes. Lab tests (`lab.test.ts`, all passing): flat network lets malware reach every device and the firewall sees none of it; VLANs keep Crew laptop 1's ARP request in VLAN 30; with subnets but Allow all, the malware crosses the firewall into Weapons and Operations; the policy matrix allows only what the orders list and blocks crew to weapons; segmented malware infects only crew devices; the spare jack lets a laptop in until the port is shut; the address checks follow VLANs and port pins; Reset network in step 7 gives the same result. Unit tests: `src/sim/vlan.test.ts`, `malware.test.ts`, `zonePolicy.test.ts`.
