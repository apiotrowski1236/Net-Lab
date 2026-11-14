# Smurf Attacks and Amplification (`smurf`)

Status: built

Tagline: Use a network's ping replies to knock a ticket site offline, then turn off the amplifier and filter at your own edge.

CodeHS: `3.3 Misdirected and Overwhelmed`. CED LOs: 3.1.A, 3.1.B, 3.1.C, 3.5.E.

## What students learn

- **ICMP** carries pings: an echo request and an echo reply. Every IPv4 network has a **broadcast address** (the last address, like `198.51.100.255` in a /24); a packet to it reaches every device on that network.
- A ping's source address can be forged. The replies go to whoever the forged address names.
- **Smurf attack** (3.1.A.4): ICMP requests carrying the victim's address, sent to a network's broadcast address. The gateway passes them to every device, and every device replies to the victim. One request becomes dozens of replies (amplification).
- **Denial of service (DoS)** makes a system unavailable to authorized users (availability in CIA, 3.1.C.1). A **distributed** DoS (DDoS) comes from many devices at once.
- Networks without firewalls, or with misconfigured ones, let these floods in (3.1.B.1). External ICMP left unblocked is a moderate risk (3.1.C.5).
- **Detection** (3.5.E.6, 3.5.E.7): a sudden spike in ICMP requests sent to a broadcast address, and unusual spikes or slowdowns in traffic.
- **Defenses**: routers that don't forward packets to a broadcast address from outside (the fix at the amplifier); hosts that ignore broadcast pings; firewall rules that block inbound ICMP at the edge (reuses `firewall`); upstream filtering, because a flood can fill the link before it reaches your firewall.

## Scenario and map

Hilltop Tickets sells seats for the state championship. Its web server sits behind its edge router on a link that holds a limited number of packets per second. A college campus network (a router and many computers, drawn as a few devices plus a "×30" group if that reads better) has a router that forwards directed broadcasts. Mallory is on the internet. Fans at home try to buy tickets.

## Step outline

1. **Echo**: tour. Ping the ticket server. Watch the request and the reply. Question: what ICMP is for.
2. **Everyone answers**: ping the campus network's broadcast address from outside. Every campus computer replies. Goal: count the replies. Question: how many replies one request caused.
3. **Return to sender**: Mallory's ping tool can forge the source address. Ping a campus computer with the ticket server's address as the source. The reply goes to the ticket server. Goal: the ticket server receives a reply to a ping it never sent.
4. **The storm**: put them together. Forged source (the ticket server) to the campus broadcast address, many times. The link to the ticket server fills, its queue overflows, and fans' purchases time out. Use aggregated bursts (`Frame.burst`) and a traffic meter. Goal: a fan's page fails while the flood runs. Question: which CIA goal.
5. **Many attackers**: press **Botnet joins in** to show DDoS from many sources, even without an amplifier. Question: DoS vs. DDoS, and why DDoS is harder to block.
6. **Read the spike**: the edge router's traffic meter and log show ICMP replies jump from near zero; the campus router's log shows echo requests to its broadcast address from outside. Goal: open the log line that shows the broadcast-address pings. Question: which evidence names the smurf attack.
7. **Silence the amplifier**: on the campus router, turn off forwarding of directed broadcasts. Mallory tries again: one request, no replies. Goal: attack fizzles.
8. **Guard your own edge**: add a firewall rule at Hilltop's edge to drop inbound ICMP echo traffic. Show the limit: the flood still crosses the upstream link before your firewall drops it. Question: why ISPs and DDoS protection services filter upstream.
9. **How risky?**: classify a few findings as high, moderate, or low risk, including "the external firewall doesn't block ICMP" (moderate).
10. **Reflect**: written, explain amplification and the one setting that stops this smurf attack at its source.
11. **Submit**.

## Core features this lab owns

- Directed broadcasts: a router forwards a packet addressed to a connected network's broadcast address onto that network (setting on by default here, off as the fix). Hosts reply to broadcast pings (with a per-host ignore option).
- Forged source IP on pings (a typed field on the ping tool or a separate attacker tool).
- Link capacity and queueing: a link carries a set number of packets per second; overflow drops with a new `DropReason` (`congestion`) and student text. Bursts count as their full size.
- A traffic-rate meter (packets per second per link or device, a small sparkline in the inspector or on the map).
- Reuses `Frame.burst` (`mac-flood`) and the firewall engine (`firewall`).

## Acceptance

- Walkthrough test passes. Lab tests: a broadcast ping gets one reply per host; a forged source sends replies to the victim; the storm makes a fan's request fail; turning off directed broadcasts stops it; replay is the same.
