# AP Cybersecurity Unit 3 coverage

Unit 3, Securing Networks (~26 class periods), has five topics in the College Board's Course and Exam Description (CED, fall 2026). This page maps every learning objective (LO) and essential knowledge statement (EK) to the NetLab lab that teaches it hands-on. The EK summaries are paraphrased. The CED itself is the authority.

Source: [AP Cybersecurity CED](https://apcentral.collegeboard.org/media/pdf/ap-cybersecurity-course-and-exam-description.pdf), Unit 3, pages 65 to 80.

## Labs

| Lab | id | Status | Main topics |
|---|---|---|---|
| Home Network: Switching, DHCP, and NAT | `home-network` | built (08b8853) | Prerequisite networking from the ground up: devices, packets, Wi-Fi, MAC and IP addresses, DHCP, switches, ARP, default gateway, NAT; 3.1.B Wi-Fi reach and open networks, 3.2.B WPA3 |
| Build a Network: Addresses, Gateways, and Routes | `build-network` | done | Prerequisite networking: cables, IP, MAC, ARP, switches, gateways, routes |
| On-Path Attacks: Sniffing and ARP Poisoning | `on-path` | done | 3.1 ARP poisoning, on-path, sniffing, 3.2 WPA2, 3.5 ARP detection |
| MAC Flooding and Port Security | `mac-flood` | built (08c5b30) | 3.1 MAC flooding and spoofing, 3.2 switch policy, 3.3 port security, 3.5 detection |
| DNS Cache Poisoning | `dns-spoof` | built (af47361) | 3.1 DNS poisoning and credential harvesting, 3.5 detection |
| Smurf Attacks and Amplification | `smurf` | built (b7305a1) | 3.1 smurf, DoS, DDoS, 3.5 ICMP spike detection |
| BGP Route Hijacking | `route-hijack` | done | 3.1 traffic redirection (BGP hijacking, beyond the CED) |
| Vulnerability Scan and Risk Assessment | `net-audit` | built (114f6f7) | 3.1.B.1 scanning, 3.1.C risk assessment and scanners, 3.2.A router, switch, and VPN policies |
| Wireless Security | `wireless` | built (4eb1488) | 3.1.B wireless threats, 3.2 wireless policy and configuration, rogue access point on a wall jack |
| Network Segmentation: Zones, VLANs, and Subnets | `segmentation` | built (5095c77) | 3.1.B lateral movement, 3.3 segmentation, VLANs, subnets, zone policy, 3.4.C firewall per segment |
| Firewall Rules and Placement | `firewall` | built (3bc65ec) | 3.4 ACLs, placement, configuration (3.4.A lightly: Firewalls A and B are stateful), 3.3 screened subnet, 3.1 open ports and risk, 3.5 firewall logs |
| Firewall Types: Stateless, Stateful, and Next-Gen | `firewall-types` | built (862d161) | 3.4.A stateless, stateful, and next-generation firewalls, where firewall software runs, 3.4.B.3 and 3.4.D.2 program rules, intrusion prevention (a bridge to 3.5.A.3), choosing a type under a budget |
| Log Analysis and Intrusion Detection | `logs` | built (6dd900f) | 3.5.A, 3.5.B, 3.5.D, 3.5.E: NIDS, NIPS, SIEM, AI detection, signatures and baselines, IoCs |
| Signature, Anomaly, and Hybrid Detection | `detect-methods` | built (8ab13a3) | 3.5.C choosing a detection method, 3.5.D speed, cost, false positives (alert fatigue), and false negatives |
| Finding Attacks in Packet Captures | `capture-analysis` | built (8f36d96) | 3.5.E.3, 3.5.E.4, 3.5.E.6, 3.5.E.7 network IoCs in packet captures, cited by packet number; 3.5.D.3 a false alarm; 3.1.C.1 CIA per finding |
| Wireless Intrusion Detection | `watch-the-air` | built (a80ca4b) | 3.5.E.1 rogue access point and evil twin, 3.5.E.2 jamming, 3.1.B.6 detective controls and their impact, 3.5.D.3 logs as evidence |
| Device Security Analysis | `device-analysis` | built (PR #19) | The exam's free-response question on one server: 3.4.B and 3.4.D a host firewall, 3.5.A.3 automated prevention (fail2ban), 3.5.E.7 a scan from a known source, 3.1.C.1 CIA, 3.2.A.1 disabling unneeded services |

The three CED unit scenarios each anchor a lab: 3A (Adams County Hospital) is `firewall`, 3B (shelter Wi-Fi) is `wireless`, and 3C (submarine LANs) is `segmentation`. Two more labs revisit them: `firewall-types` decides the type of 3A's Firewalls A and B, and `watch-the-air` is 3B's detective half (keeping watch over the shelter). `device-analysis` practices the exam's free-response question, Device Security Analysis.

Packet-capture analysis for CodeHS 3.18.6 to 3.18.8 (Packet Capture, Reading Network Indicators, Identifying Indicators of Compromise) is `capture-analysis`, so the Wireshark lab isn't needed for those lessons.

## Topic 3.1: Network Vulnerabilities and Attacks (skill: Analyze Risk)

| EK | Content (paraphrased) | Lab |
|---|---|---|
| 3.1.A.1 | ARP poisoning: forged ARP to the default gateway links the target's IP to the adversary's MAC. MAC spoofing. On-path (man-in-the-middle) attacks | `on-path`, `mac-flood` (spoofing) |
| 3.1.A.2 | MAC flooding: many frames with different source MACs force a switch to broadcast. Eavesdropping (sniffing) | `mac-flood` |
| 3.1.A.3 | DNS poisoning: pose as an authoritative name server, plant a fake record, redirect to a credential-harvesting site | `dns-spoof` |
| 3.1.A.4 | Smurf attack: ICMP requests with the victim's address sent to a broadcast address. DoS and DDoS | `smurf` |
| 3.1.B.1 | Malicious traffic floods (DoS), maps the internal network, or spoofs devices. Missing or misconfigured firewalls | `smurf`, `firewall`, `net-audit` |
| 3.1.B.2 | Lateral movement from one compromised LAN device to others | `segmentation` |
| 3.1.B.3 | A physical data port with no port security lets an adversary in for DoS, MAC flooding, or MAC spoofing | `mac-flood` |
| 3.1.B.4 | Wi-Fi signals and beacon frames that reach outside the building | `wireless`, `home-network` |
| 3.1.B.5 | Networks that don't authenticate devices and users are easy to join | `wireless`, `mac-flood`, `home-network` |
| 3.1.B.6 | Rogue access point plugged into an open port bypasses the firewall | `wireless`, `watch-the-air` (detective controls and their impact) |
| 3.1.B.7 | Breaking wireless encryption | `wireless` (also `on-path`) |
| 3.1.C.1 | Network vulnerabilities threaten confidentiality, integrity, and availability: interception, DoS, lateral movement | `net-audit`, `capture-analysis`, `device-analysis` (and every attack lab's CIA questions) |
| 3.1.C.2 | Automated vulnerability scanners report findings, severity, and mitigations | `net-audit` |
| 3.1.C.3 | Exploit difficulty affects likelihood | `net-audit` |
| 3.1.C.4 to 3.1.C.6 | High, moderate, and low risk examples: unsegmented network on weak Wi-Fi; ICMP not blocked at the external firewall; beacon frames broadcast | `net-audit` (also `smurf`, `wireless`) |

## Topic 3.2: Managerial Controls and Wireless Security (skill: Mitigate Risk)

| EK | Content (paraphrased) | Lab |
|---|---|---|
| 3.2.A.1 | Router security policy: no local accounts (approved authentication server), disable unneeded services such as Telnet, require a firewall | `net-audit`, `device-analysis` (unneeded services on a server) |
| 3.2.A.2 | Switch security policy: no local accounts, require port security, MAC filtering | `net-audit`, `mac-flood` |
| 3.2.A.3 | VPN policy: which roles may use it, authentication (keys or MFA), no split tunneling | `net-audit` |
| 3.2.A.4 | Wireless policy: EAP authentication to an approved server, AES encryption with a minimum key length, beacon frames disabled | `wireless` |
| 3.2.B.1 | Disable beacon broadcasting | `wireless` |
| 3.2.B.2 | Control a WAP's broadcast direction and signal strength | `wireless` |
| 3.2.B.3 | Strong encryption: WEP, WPS, and original WPA are insecure; WPA3 is strongest | `wireless`, `home-network` |
| 3.2.B.4 | MAC filtering and user authentication | `wireless`, `mac-flood` |

## Topic 3.3: Segmentation (skill: Mitigate Risk)

| EK | Content (paraphrased) | Lab |
|---|---|---|
| 3.3.A.1 | Screened subnet (DMZ) built with firewall zones and rules holds public-facing resources | `firewall` (also `segmentation`) |
| 3.3.A.2 | Subnetting contains a breach | `segmentation` |
| 3.3.A.3 | VLANs logically separate devices on shared switches | `segmentation` |
| 3.3.B.1 to 3.3.B.3 | Segmentation isolates traffic and allows different policies per zone | `segmentation` |
| 3.3.B.4 | Port security limits MAC addresses per port and stops MAC flooding | `mac-flood` |

## Topic 3.4: Firewalls (skill: Mitigate Risk)

| EK | Content (paraphrased) | Lab |
|---|---|---|
| 3.4.A.1 to 3.4.A.4 | Firewalls are software on a standalone device or a router. Stateless, stateful, and next-generation firewalls | `firewall-types` (also `firewall`, lightly) |
| 3.4.B.1 to 3.4.B.3 | ACLs: rules checked in order, first match wins. Each rule has a direction, criteria, and an action | `firewall`, `device-analysis` (a host firewall); `firewall-types` for 3.4.B.3 (rules that name a program) |
| 3.4.C.1 to 3.4.C.3 | A firewall for each segment and at each ingress and egress point to the internet | `firewall` (also `segmentation`) |
| 3.4.D.1 to 3.4.D.3 | Configure rules from requirements. Rule order changes the outcome | `firewall`, `device-analysis`; `firewall-types` for 3.4.D.2 |

## Topic 3.5: Detecting Network Attacks (skill: Detect Attacks)

| EK | Content (paraphrased) | Lab |
|---|---|---|
| 3.5.A.1 to 3.5.A.4 | Log sources, NIDS (alerts), NIPS (also blocks), SIEM (correlates many sources) | `logs`; `firewall-types` (intrusion prevention on a next-gen firewall) and `device-analysis` (fail2ban) for 3.5.A.3 |
| 3.5.B.1 to 3.5.B.4 | Too much data for people. AI classifies with a probability, and the organization sets the alert threshold | `logs` |
| 3.5.C.1 to 3.5.C.4 | Choosing a method: signature for high volume, anomaly for consistent traffic, hybrid for critical networks, anomaly for novel attacks | `detect-methods` |
| 3.5.D.1 to 3.5.D.4 | Judging a method: speed, cost, false positives (alert fatigue), false negatives | `detect-methods` (also `logs`; 3.5.D.3 false alarms in `capture-analysis` and `watch-the-air`) |
| 3.5.E.1 | Evil twin: scan for lookalike SSIDs, triangulate the signal | `watch-the-air` |
| 3.5.E.2 | Jamming: nobody can connect, plus EM noise | `watch-the-air` |
| 3.5.E.3 | ARP poisoning: duplicate-MAC ARP traffic, the gateway's ARP table | `on-path`, `logs`, `capture-analysis` (forged ARP replies, cited by packet number) |
| 3.5.E.4 | MAC flooding: a surge of frames from many MACs, the switch's MAC table | `mac-flood`, `logs`, `capture-analysis` (thousands of source MACs in Endpoints: Ethernet) |
| 3.5.E.5 | DNS poisoning: an unexplained drop in website traffic means check DNS records | `dns-spoof` |
| 3.5.E.6 | Smurf: a spike in ICMP requests to a broadcast address | `smurf`, `logs`, `capture-analysis` (echo requests to the broadcast address with a forged source) |
| 3.5.E.7 | Network IoCs: known malicious IPs, unauthorized scans, traffic spikes or slowdowns, mismatched port and application | `logs`, `capture-analysis` (a threat-list IP, a SYN scan, HTTP on port 4444, I/O Graph spikes), `device-analysis` (a scan in the ufw log) (also `firewall`) |
