# AP Cybersecurity Unit 3 coverage

Unit 3, Securing Networks (~26 class periods), has five topics in the College Board's Course and Exam Description (CED, fall 2026). This page maps every learning objective (LO) and essential knowledge statement (EK) to the NetLab lab that teaches it hands-on. The EK summaries are paraphrased. The CED itself is the authority.

Source: [AP Cybersecurity CED](https://apcentral.collegeboard.org/media/pdf/ap-cybersecurity-course-and-exam-description.pdf), Unit 3, pages 65 to 80.

## Labs

| Lab | id | Status | Main topics |
|---|---|---|---|
| From Cable to Web Page | `build-network` | done | Prerequisite networking: cables, IP, MAC, ARP, switches, gateways, routes |
| Traffic in the Wrong Hands | `on-path` | done | 3.1 ARP poisoning, on-path, sniffing, 3.2 WPA2, 3.5 ARP detection |
| Flood the Switch | `mac-flood` | planned, wave 1 | 3.1 MAC flooding and spoofing, 3.2 switch policy, 3.3 port security, 3.5 detection |
| Wrong Directions | `dns-spoof` | planned, wave 1 | 3.1 DNS poisoning and credential harvesting, 3.5 detection |
| Echo Storm | `smurf` | planned, wave 2 | 3.1 smurf, DoS, DDoS, 3.5 ICMP spike detection |
| Advertise a Bad Route | `route-hijack` | done | 3.1 traffic redirection (BGP hijacking, beyond the CED) |
| The Network Audit | `net-audit` | planned, wave 2 | 3.1.C risk assessment and scanners, 3.2.A router, switch, and VPN policies |
| Signals Past the Walls | `wireless` | planned, wave 1 | 3.1.B wireless threats, 3.2 wireless policy and configuration, 3.5 evil twin and jamming |
| Walls Inside the Network | `segmentation` | planned, wave 2 | 3.1.B lateral movement, 3.3 segmentation, VLANs, subnets |
| Firewall Rulebook | `firewall` | planned, wave 1 | 3.4 firewall types, ACLs, placement, configuration, 3.3 screened subnet |
| Log Detective | `logs` | planned, wave 2 | 3.5 NIDS, NIPS, SIEM, AI detection, detection methods, IoCs |

The three CED unit scenarios each anchor a lab: 3A (Adams County Hospital) is `firewall`, 3B (shelter Wi-Fi) is `wireless`, and 3C (submarine LANs) is `segmentation`.

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
| 3.1.B.4 | Wi-Fi signals and beacon frames that reach outside the building | `wireless` |
| 3.1.B.5 | Networks that don't authenticate devices and users are easy to join | `wireless`, `mac-flood` |
| 3.1.B.6 | Rogue access point plugged into an open port bypasses the firewall | `wireless` |
| 3.1.B.7 | Breaking wireless encryption | `wireless` (also `on-path`) |
| 3.1.C.1 | Network vulnerabilities threaten confidentiality, integrity, and availability: interception, DoS, lateral movement | `net-audit` (and every attack lab's CIA questions) |
| 3.1.C.2 | Automated vulnerability scanners report findings, severity, and mitigations | `net-audit` |
| 3.1.C.3 | Exploit difficulty affects likelihood | `net-audit` |
| 3.1.C.4 to 3.1.C.6 | High, moderate, and low risk examples: unsegmented network on weak Wi-Fi; ICMP not blocked at the external firewall; beacon frames broadcast | `net-audit` (also `smurf`, `wireless`) |

## Topic 3.2: Managerial Controls and Wireless Security (skill: Mitigate Risk)

| EK | Content (paraphrased) | Lab |
|---|---|---|
| 3.2.A.1 | Router security policy: no local accounts (approved authentication server), disable unneeded services such as Telnet, require a firewall | `net-audit` |
| 3.2.A.2 | Switch security policy: no local accounts, require port security, MAC filtering | `net-audit`, `mac-flood` |
| 3.2.A.3 | VPN policy: which roles may use it, authentication (keys or MFA), no split tunneling | `net-audit` |
| 3.2.A.4 | Wireless policy: EAP authentication to an approved server, AES encryption with a minimum key length, beacon frames disabled | `wireless` |
| 3.2.B.1 | Disable beacon broadcasting | `wireless` |
| 3.2.B.2 | Control a WAP's broadcast direction and signal strength | `wireless` |
| 3.2.B.3 | Strong encryption: WEP, WPS, and original WPA are insecure; WPA3 is strongest | `wireless` |
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
| 3.4.A.1 to 3.4.A.4 | Firewalls are software on a standalone device or a router. Stateless, stateful, and next-generation firewalls | `firewall` |
| 3.4.B.1 to 3.4.B.3 | ACLs: rules checked in order, first match wins. Each rule has a direction, criteria, and an action | `firewall` |
| 3.4.C.1 to 3.4.C.3 | A firewall for each segment and at each ingress and egress point to the internet | `firewall` (also `segmentation`) |
| 3.4.D.1 to 3.4.D.3 | Configure rules from requirements. Rule order changes the outcome | `firewall` |

## Topic 3.5: Detecting Network Attacks (skill: Detect Attacks)

| EK | Content (paraphrased) | Lab |
|---|---|---|
| 3.5.A.1 to 3.5.A.4 | Log sources, NIDS (alerts), NIPS (also blocks), SIEM (correlates many sources) | `logs` |
| 3.5.B.1 to 3.5.B.4 | Too much data for people. AI classifies with a probability, and the organization sets the alert threshold | `logs` |
| 3.5.C.1 to 3.5.C.4 | Choosing a method: signature for high volume, anomaly for consistent traffic, hybrid for critical networks, anomaly for novel attacks | `logs` |
| 3.5.D.1 to 3.5.D.4 | Judging a method: speed, cost, false positives (alert fatigue), false negatives | `logs` |
| 3.5.E.1 | Evil twin: scan for lookalike SSIDs, triangulate the signal | `wireless` |
| 3.5.E.2 | Jamming: nobody can connect, plus EM noise | `wireless` |
| 3.5.E.3 | ARP poisoning: duplicate-MAC ARP traffic, the gateway's ARP table | `on-path`, `logs` |
| 3.5.E.4 | MAC flooding: a surge of frames from many MACs, the switch's MAC table | `mac-flood`, `logs` |
| 3.5.E.5 | DNS poisoning: an unexplained drop in website traffic means check DNS records | `dns-spoof` |
| 3.5.E.6 | Smurf: a spike in ICMP requests to a broadcast address | `smurf`, `logs` |
| 3.5.E.7 | Network IoCs: known malicious IPs, unauthorized scans, traffic spikes or slowdowns, mismatched port and application | `logs` (also `firewall`) |
