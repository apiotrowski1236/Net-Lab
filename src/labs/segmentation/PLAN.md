# Walls Inside the Network (`segmentation`)

Status: planned, wave 2 (after `firewall` and `mac-flood` merge). Follow `docs/unit3/ARCHITECTURE.md`.

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

CED unit scenario 3C. A naval submarine has three groups of computers: weapons systems (two consoles), naval operations (two consoles and a chart server), and crew recreation (two crew tablets and a media server). At the start, all of them share one switch and one subnet. Use map zones to show the three groups and later the VLANs.

## Step outline

1. **One big network**: tour. Every device is on `10.0.0.0/24` on one switch. A crew tablet pings a weapons console. Question: what could go wrong.
2. **A game with a passenger**: press **Crew tablet installs a game**. The malware scans its network, finds open file-sharing ports, and spreads to an operations console and then a weapons console. Infected devices turn red. Goal: watch it spread. Question: lateral movement.
3. **Draw the lines**: reset. Assign each device to a zone (weapons, operations, crew) and pick a security level for each. Question: which zone needs the strictest policy, and why.
4. **VLANs**: set each switch port's VLAN (10 weapons, 20 operations, 30 crew). A crew tablet's broadcast no longer reaches the other ports. Goal: ARP from the crew tablet reaches only crew ports. Question: what a VLAN does without new hardware.
5. **Subnets**: give each VLAN its own subnet (`10.0.10.0/24`, `10.0.20.0/24`, `10.0.30.0/24`) and connect each to its own router port (or firewall port). Re-address devices with the IP tool from `build-network`, or have setup do most of it and the student do one. Goal: each segment reaches its gateway; crew reaches the media server.
6. **Rules between zones**: set the zone policy matrix: crew to anything else denied; operations to weapons only for one service; weapons to operations for status reports. Goal: allowed pairs work, denied pairs fail.
7. **Malware, again**: the crew tablet installs the game again. It spreads to the other crew tablet and stops. Goal: weapons and operations stay clean. Question: why segmentation contained it (and why the crew segment still got hurt).
8. **One more door**: an unused port in the weapons VLAN. Turn on port security or shut it (reuse `mac-flood`'s feature). Question tying to 3.3.B.4.
9. **The DMZ connection**: question on screened subnets, using the sub's shore link mail relay as the example.
10. **Reflect**: written, recommend security features for each of the three LANs (the scenario's deliverable).
11. **Submit**.

## Core features this lab owns

- VLANs on switches: each port has a VLAN ID, and frames (including broadcasts and flooding) stay within one VLAN. Access ports only. Skip trunks unless needed, and say so if you skip them. Show VLANs in the switch inspector and on the map (port tags or zones).
- Malware that spreads: an infected host scans its subnet and infects hosts it can reach on an open file-sharing port (use `firewall`'s services and connections). Deterministic, quick, visible (red devices, log lines).
- Zone policy matrix UI that writes firewall-engine rules underneath.

## Acceptance

- Walkthrough test passes. Lab tests: flat network lets malware reach every device; VLANs stop broadcasts across VLANs; the policy matrix blocks crew to weapons; segmented malware infects only crew devices; replay is the same.
