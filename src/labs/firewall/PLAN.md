# Firewall Rulebook (`firewall`)

Status: planned, wave 1. Follow `docs/unit3/ARCHITECTURE.md`.

Tagline: Place two firewalls in a hospital network, then write the rules that let patients in and keep attackers out.

CodeHS: `3.10 The Rules of the Firewall`, `3.12 Writing the Rulebooks`. CED LOs: 3.1.B, 3.1.C, 3.3.A, 3.4.A, 3.4.B, 3.4.C, 3.4.D.

## What students learn

- **Ports** name services: 22 SSH, 25 SMTP, 53 DNS, 80 HTTP, 443 HTTPS, and one for file sharing (445). A packet's protocol, addresses, and ports are what a simple firewall can see.
- With no firewall, an attacker can **scan** to map the network and reach anything (3.1.B.1). External ICMP left open is a moderate risk (3.1.C.5).
- **Placement** (3.4.C): a firewall at every point where the internal network meets the internet, and one for each segment. Two firewalls make a **screened subnet (DMZ)** for public servers (3.3.A.1).
- An **ACL** (3.4.B): rules checked in order, **first match wins**, each with a direction (inbound or outbound), criteria (protocol, address, port), and an action (allow or deny). Anything that matches no rule is denied (an **implicit deny**; show it as the last row).
- **Rule order** changes the result (3.4.D.3): "ALLOW in TCP 22 from ALL" then "DENY in TCP ALL from ALL" allows SSH; reversed, it blocks SSH.
- **Firewall types** (3.4.A): software on a standalone device or inside a router. **Stateless** filters each packet by its header. **Stateful** tracks connections, so a reply is allowed only if someone inside started that conversation. A **next-generation firewall (NGFW)** adds deep packet inspection, intrusion prevention, and filtering by application.

## Scenario and map

CED unit scenario 3A. Adams County Hospital has a public web app (patients book appointments and pay bills) on a web server, and an internal file server with patient records. Staff PCs sit on the internal LAN. An attacker sits on the internet, and so does a patient at home. Two firewalls arrive: Firewall A and Firewall B. Use map zones for the internet, the screened subnet, and the internal LAN once the firewalls are placed.

## Step outline

1. **The hospital**: tour. Inspect the servers' open ports (the web server: 443, 80, and SSH 22 for admins; the file server: 445 and 22).
2. **Wide open**: no firewalls. The attacker runs a ping sweep and port scan and lists every server and open port, then opens the file server's share. Goal: scan finished. Question: which CIA goal is at risk, and the CED risk level of open ICMP.
3. **Where do the firewalls go?** Choose a cable for Firewall A and one for Firewall B. Feedback on each choice. The right answer: A between the internet and the web server's network, and B between the web server's network and the internal LAN. The web server's network becomes the screened subnet. Goal: both placed correctly. Question: why the web server sits between the two firewalls.
4. **First rule**: Firewall A starts with only the implicit deny. Everything stops, even the patient. Write "ALLOW inbound TCP 443 to the web server from ALL". Test buttons: patient books an appointment (works), attacker SSH to the web server (denied), attacker ping (denied). The tool says which rule matched each packet. Goal: patient in, attacker out.
5. **Order matters**: admins at a partner clinic need SSH (22) to the web server from their network only. The rulebook has the deny-all-TCP rule above the allow. Fix the order. Goal: admin SSH works and the attacker's SSH still fails.
6. **Firewall B**: only staff PCs may reach the file server on 445. The web server may not (so a hacked web server can't reach records). Goal: tests pass for staff, the web server, and the attacker.
7. **Fake replies**: Firewall A is stateless, with a rule letting in replies from web servers (source port 443) so staff can browse. The attacker sends packets from port 443 that answer nothing. They get through. Switch A to stateful. Now only real replies get in. Goal: forged replies blocked, staff browsing still works. Question: stateless vs. stateful.
8. **Not really web traffic**: the attacker tunnels a remote-control tool over port 443. Stateful allows it (the port looks right). Turn on the NGFW application filter, which sees it isn't HTTPS. Goal: blocked. Question: mismatched port and application.
9. **The firewall's log**: find the attacker's denied scan in Firewall A's log. Goal: open a deny line from the attacker. Question: what the log tells a defender.
10. **Reflect**: written, justify the placement and the order of Firewall A's rules (FRQ style: cite the rules).
11. **Submit**.

## Core features this lab owns (shared, see ARCHITECTURE)

- **Services**: `Device.services` (port, protocol, name, and what it answers). A client connection to a service is a request and a reply with source and destination ports, shown in the capture and on the map. Map well-known ports to names in one place. HTTP and HTTPS keep working through the existing browser.
- **Scanning**: a ping sweep and a port scan from a host, with results the tool can show and log lines a firewall writes.
- **Firewall engine** in `src/sim/firewall.ts`: `Device.firewall` on any router or firewall device. Ordered rules (direction, protocol, source and destination address or prefix or ALL, destination port or ALL, optional source port, action), first match, implicit deny, modes `stateless`, `stateful` (connection table), `ngfw` (adds application identification on packets that carry it). Define inbound and outbound clearly: give each firewall an outside interface; inbound means arriving from the outside. A pure function that says which rule matches a packet, used by both the sim and the UI's explanations. Log lines (`source: 'firewall'`) for denies, and allows when asked.
- **Firewall placement** on a chosen cable (insert a two-port firewall into a link).
- **Rule editor** inspector section: add, edit, delete, and reorder rules, with the implicit deny shown last. Typed fields checked with friendly messages. **Test traffic** buttons in the lesson, and a "which rule matched" explanation.

Design these as the shared API that `segmentation`, `smurf`, `net-audit`, and `logs` will build on. Document it at the top of `src/sim/firewall.ts`.

## Acceptance

- Walkthrough test passes. Firewall unit tests: first match, implicit deny, rule order, stateless lets forged replies through and stateful doesn't, NGFW catches the mismatched app, replay gives the same connection table.
