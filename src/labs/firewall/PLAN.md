# Firewall Rules and Placement (`firewall`)

Status: built. Follow `docs/unit3/ARCHITECTURE.md`.

Tagline: Place two firewalls in a hospital network and write the rules that let patients in and keep attackers out.

CodeHS: `3.10 The Rules of the Firewall`, `3.12 Writing the Rulebooks`. CED LOs: 3.1.B, 3.1.C, 3.3.A, 3.4.A, 3.4.B, 3.4.C, 3.4.D. Also EK 3.5.E.7 (a firewall log as a source of evidence), in steps 7 and 8.

Version 2 moved the firewall-type steps (stateless, fake replies, next-generation) to *Firewall Types: Stateless, Stateful, and Next-Gen* (`src/labs/firewall-types/`). 3.4.A (firewall types) is taught there now. Objective 4 dropped its firewall-type half and now reads "Read a firewall log for signs of attack, and explain what the firewalls still let through." The lab's `ced` list still names 3.4.A until the README and COVERAGE pass decides how to count it.

Version 3 (student panel, six rounds) sped the network up (`linkMs` 120, `procMs` 40, `httpTimeoutMs` 2500, `pingTimeoutMs` 2800; the slowest allowed round trip, the nurse station's ping through both firewalls, is 2080 ms, and a test keeps the ping timeout above it), set `minutes` to 50, made the nurse station open the web app on 443 instead of SSH, added a nurse ping to 10.0.1.1 so a TCP-only Firewall B rule fails requirement 1, required the coworker's deny rule to survive step 5, and split the reflection into two numbered parts (30 words). After an implicit deny, `nearMissText` in `src/ui/firewallText.ts` names a rule that would have matched but for its direction or its protocol.

## What students learn

- **Ports** name the programs on a server: 22 SSH, 443 HTTPS, 445 file sharing (SMB). A packet's protocol, addresses, and ports are what a simple firewall can see.
- With no firewall, an attacker can **scan** to map the network and reach anything (3.1.B.1). Answering pings from the internet is a moderate risk (3.1.C.5).
- **Placement** (3.4.C): a firewall where the internal network meets the internet, and one in front of each segment. Two firewalls make a **screened subnet (DMZ)** for the public web server (3.3.A.1).
- An **ACL** (3.4.B): rules checked from the top, **first match wins**, each with a direction (in or out), criteria (protocol, addresses, ports), and an action (allow or deny). A packet that matches no rule is denied (the **implicit deny**, shown as the last row).
- **Rule order** changes the result (3.4.D.3): deny-all-TCP above the clinic's SSH allow blocks the clinic; swapped, the clinic gets in.
- Firewall types (3.4.A) are the next lab, *Firewall Types: Stateless, Stateful, and Next-Gen*. Firewalls A and B stay stateful here.

## Scenario and map

CED unit scenario 3A, Adams County Hospital. The hospital's ISP router ("Internet") connects a patient at home, Lakeside Clinic (its admins manage the web server over SSH, and it hosts a staff portal on HTTPS), and an attacker. Inside: a server switch with the web server (443, 22), the hospital router, and a staff switch with the nurse station and the file server (22, 445, "PatientRecords"). Firewall A and Firewall B start unplugged in a "New firewalls" zone. Once both are placed, map zones show the internet, the screened subnet (DMZ), and the internal network.

Simplification, said in step 2: the internet reaches the hospital's 10.x addresses directly (no NAT).

## Steps as built

1. **Adams County Hospital**: inspect the web server's and file server's open ports. Question: which port the admin login (SSH) uses.
2. **Wide open**: as the attacker, scan 10.0.1.0/24 and 10.0.2.0/24, then connect to the file server's 445. Questions: why open ping is a moderate risk, then (after the goals) which CIA goal the records break. Step 2 also names 10.0.1.1 as the ISP's router and says a router has an address on each network it joins.
3. **Where do the firewalls go?**: place A and B on cables. Every cable has feedback for each firewall. Right answer: A on Internet–Server switch, B on either cable between the server switch and the staff switch. Question: why the web server sits in a screened subnet.
4. **The first rule**: A starts with one rule (out, any). Add ALLOW in TCP any → 10.0.1.10:443. Test the patient (works), the attacker's SSH and ping (blocked). Question: why ping was blocked with no ping rule (implicit deny).
5. **Order matters**: a coworker added DENY in TCP any above ALLOW in TCP 198.51.100.0/24 → 10.0.1.10:22. Move the clinic rule up (or the deny down); the goal needs the deny rule kept. Question: a two-rule ACL from 3.4.D.3.
6. **Firewall B**: write ALLOW out any from 10.0.2.0/24. The nurse station opens the web app and pings 10.0.1.1 (a TCP-only rule fails the ping), the hacked web server can't reach the records. Questions: why keep the web server from the records, and why same-switch traffic never crosses B.
7. **The firewall's log**: rescan both networks as the attacker (the goal needs scans covering both /24s; only 443 on the web server answers), then open a DENY line from 203.0.113.66 in Firewall A's log. Questions: what a scan looks like in a log, and what the attacker can still find.
8. **Defend your design**: a choice question (visitor Wi-Fi needs its own firewall), then a written FRQ-style answer in two numbered parts (30 words): placement, and the coworker's two rules on A by number and what goes wrong if the deny rule were above the clinic's rule.
9. **Submit**. The last line points to the next lab, *Firewall Types: Stateless, Stateful, and Next-Gen*.

Goals that test a defense use "test after your last change": they need a matching event after `FirewallState.changedAt`, so an old test from before an edit doesn't count.

## Shared APIs this lab added

- `src/sim/services.ts`: `Device.services`, well-known ports (`WELL_KNOWN`, `portInfo`, `appForPort`, `appName`), connections (`Device.conns`, `Sim.connectService`), scans (`Sim.scan`, `scanFindings`).
- `src/sim/firewall.ts`: the engine, documented at the top. `Device.firewall` on a firewall device or a router; ordered rules, first match, implicit deny, modes `stateless`, `stateful`, `ngfw`; `evaluate`/`firstMatch` (pure), `ruleText`, log lines with fields, `FirewallState.changedAt`. Placement on a cable (`Sim.placeFirewall`, `unplaceFirewall`).
- `src/runtime/firewallInput.ts`: typed checks with friendly messages for scan targets and rules.
- Sim actions in `src/runtime/actions.ts`: `scan`, `connect`, `fw-place`, `fw-unplace`, `fw-add-rule`, `fw-edit-rule`, `fw-delete-rule`, `fw-move-rule`, `fw-mode`.
- UI: tools `port-scan`, `firewall-place`, `firewall-rules`; inspector sections `services` (open ports) and `firewall-rules` (the rulebook editor and connection table); `src/ui/firewallText.ts` for every sentence that explains a decision.

## Acceptance

- Walkthrough test passes. Firewall unit tests (`src/sim/firewall.test.ts`) cover first match, implicit deny, rule order, stateless vs. stateful replies, forged replies, NGFW app mismatch, a firewall inside a router, placement and removal, scans behind a firewall, a firewall on a switch branch, and replay giving the same connection table. `lab.test.ts` checks the hospital network and every step setup. The tests for the removed type steps moved to `src/labs/firewall-types/lab.test.ts`.
