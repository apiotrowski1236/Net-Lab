# The Network Audit (`net-audit`)

Status: planned, wave 2 (after wave 1 merges). Follow `docs/unit3/ARCHITECTURE.md`.

Tagline: Scan a small office for weaknesses, rate each risk, and write the policies that fix them.

CodeHS: none confirmed yet. CED LOs: 3.1.B, 3.1.C, 3.2.A.

## What students learn

- **Authorization first**: scanning a network you don't own or have written permission to test is illegal. The audit starts with a signed scope.
- An **automated vulnerability scanner** (3.1.C.2) probes devices for known weaknesses and reports each one with a severity and a suggested fix. It also shows what an adversary mapping the network would learn (3.1.B.1).
- **Risk** = likelihood and impact. Likelihood drops when an exploit needs advanced skill (3.1.C.3). Vulnerabilities threaten confidentiality, integrity, and availability (3.1.C.1).
- The CED's risk levels (3.1.C.4 to 3.1.C.6): **high**, an unsegmented network reachable over weak Wi-Fi with a key server on it; **moderate**, an external firewall that doesn't block ICMP; **low**, access points broadcasting beacon frames.
- **Managerial controls** (3.2.A) are written policies that set minimum configurations:
  - Router policy (3.2.A.1): no local user accounts (log in through an approved authentication server), disable unneeded services such as **Telnet** (which sends passwords in the clear; use SSH), require a firewall.
  - Switch policy (3.2.A.2): no local accounts, port security on, MAC filtering.
  - VPN policy (3.2.A.3): which roles may use the **VPN**, how they authenticate (keys or MFA), and no **split tunneling**.

## Scenario and map

Harbor Food Bank's office: a router with a firewall to the internet, a switch, a file server with donor records, two staff PCs, a Wi-Fi access point, and a bookkeeper who works from home over a VPN. The student is an outside auditor with a signed scope letter and a scanner laptop plugged into the office switch.

## Step outline

1. **The engagement**: read the scope letter (what may be scanned, when). Tour the office. Question: why the signed scope matters.
2. **Run the scan**: start the scanner. Watch its probes cross the map. The report lists findings with severity and fix: Telnet open on the router, a local `admin` account with a default password, switch port security off, Wi-Fi on WEP with beacons on, the edge firewall answering pings from the internet, the VPN allowing split tunneling, an old web admin page on the file server. Goal: report finished.
3. **See it for yourself**: the office manager logs in to the router over Telnet. Capture it: the password is readable. Then over SSH: unreadable. Goal: open the Telnet frame with the password. Question: why disabling Telnet is in the router policy.
4. **How likely?** Question set on likelihood: which findings need little skill to exploit, which need a lot.
5. **Rate the risks**: in the risk register, set likelihood and impact for each finding; the register computes the rating. Goal: the three CED examples rated high, moderate, and low, and every finding rated. Question naming the CIA goal each high risk threatens.
6. **Router policy**: pick the policy statements that belong (multi-select), then apply them on the router: Telnet off, SSH on, local account removed in favor of the authentication server, firewall required. Goal: router passes a re-scan.
7. **Switch policy**: same for the switch: port security on unused and user ports, MAC filtering, authentication server. Reuse `mac-flood`'s port security. Goal: switch passes.
8. **Working from home**: the bookkeeper's VPN uses split tunneling: office traffic goes through the tunnel, everything else goes straight to the internet from her home network. Show what that risks (a compromised home device or network reaches the office through her laptop). Turn off split tunneling and require MFA. Question on VPN policy items.
9. **Re-scan**: the report shrinks to accepted low risks. Goal: no high or moderate findings. Question: why some low risks are accepted rather than fixed.
10. **Reflect**: written, the audit summary for the food bank's director: the top risk, its rating and why, and the control that fixes it.
11. **Submit**.

## Core features this lab owns

- Vulnerability scanner: probes hosts and services (uses `firewall`'s services and port scan), checks device settings against a findings catalog, and produces a report (finding, device, severity, evidence, fix). Re-scans reflect fixes.
- Telnet and SSH services: a login that is plain text over Telnet and encrypted over SSH, visible in the capture.
- Router and switch hardening settings (Telnet, SSH, local accounts versus an authentication server) in the inspector.
- VPN tunnel with split tunneling: traffic through the tunnel is encrypted and enters at the office; with split tunneling, other traffic leaves directly. Draw both paths.
- Risk register UI (likelihood, impact, rating) as a Toolkit card.
- Reuses `mac-flood` (port security), `wireless` (WAP settings), and `firewall` (edge rules).

## Acceptance

- Walkthrough test passes. Lab tests: the first scan finds every seeded finding; each fix removes its finding from a re-scan; Telnet login is plain text in the capture and SSH isn't; replay is the same.
