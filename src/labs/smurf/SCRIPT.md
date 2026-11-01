# Echo Storm (`smurf`) — lesson script

This is the full lesson as students see it: scenario, map, every step's body, buttons, tools, goals,
questions, answer key, and the behaviors the implementer must build. An implementer turns this into
`index.ts`, `scenario.ts`, `solution.ts`, a sim feature or two, and a UI tool. Translate, don't redesign.

## What changed from PLAN.md

The plan stands. These are refinements, not a change of course, so `PLAN.md` is unchanged:

- Concrete device ids, addresses, and map coordinates (below).
- The amplification factor is fixed at **30** (30 computers on the campus LAN). Every "how many replies"
  answer and meter reading uses that number.
- The capacity-limited uplink is **isp ↔ edge**, Hilltop's access link, at **60 packets per second**. The
  internal edge ↔ web link is effectively unlimited. This is what makes the edge firewall's limit in step 8
  honest: the flood fills the uplink before it reaches the firewall.
- Step 8 gets one concrete action the plan only implied: **The ISP filters upstream**, with a goal that fans
  succeed only after it. Without it, the "why filter upstream" question has nothing on screen to point at.
- The direct flood used in step 8 is the botnet DDoS from step 5. By step 8 the smurf itself is already dead
  (step 7 removed the amplifier), so the flood the edge firewall can't fully stop has to be the un-amplified
  DDoS. This ties step 5 to step 8.
- Small reinforcing questions added to steps 3 and 7, which the plan left implicit.

CED LOs covered, all from the plan: **3.1.A** (3.1.A.4 smurf, DoS, DDoS), **3.1.B** (3.1.B.1 floods and
missing/misconfigured firewalls), **3.1.C** (3.1.C.1 availability; 3.1.C.5 open external ICMP is moderate
risk), **3.5.E** (3.5.E.6 spike in ICMP to a broadcast address; 3.5.E.7 traffic spikes as an IoC).
CodeHS: `3.3 Misdirected and Overwhelmed`.

---

## Scenario

Hilltop Tickets sells seats for the state championship, and the game sells out in minutes. The ticket
**web server** sits behind Hilltop's **edge router** on a single uplink to its internet provider. That uplink
carries only so many packets per second. Fans at home open the site to buy seats.

Mallory is out on the internet and wants the sale to fail. One attacker's pings are too few to matter. So
Mallory borrows an **amplifier**: Westfield College, whose router forwards pings sent to the whole campus at
once, and whose 30 computers all answer. Mallory forges each ping so every answer lands on the ticket server.

Students play Mallory first: send one ping, watch a network answer thirty times, forge the source so the
answers hit the victim, then build that into a flood that knocks the site offline. Then they switch to
Hilltop's and Westfield's defenders: read the evidence, shut the amplifier off at its source, guard Hilltop's
own edge, and see why the provider has to help upstream.

> Everything in this lab happens inside a simulation. Sending forged floods at a real network without
> permission is illegal.

(The "it's a simulation, this is illegal" line appears in step 1's body, per the attack-lab rule.)

---

## Map

Canvas is 1000 x 600. Centers are at least ~130 apart. `autoArp: true` in the build options: the attacks here
are at the IP/ICMP layer, so ARP would be noise (same choice on-path makes for internet routing).

| id | label | kind | icon | x | y | addresses / ports | notes |
|---|---|---|---|---|---|---|---|
| `mallory` | Mallory | host | attacker | 150 | 110 | `203.0.113.66/24`, gw `203.0.113.1` | the attacker, on the internet |
| `fan` | Fan at home | host | laptop | 150 | 300 | `203.0.120.40/24`, gw `203.0.120.1` | buys a ticket; the "authorized user" |
| `isp` | The internet | router | cloud | 470 | 200 | `pub 203.0.113.1/24`, `home 203.0.120.1/24`, `hilltop 100.64.0.1/30`, `campus 100.64.0.5/30` | the provider / backbone |
| `edge` | Hilltop edge router | router | router | 710 | 200 | `wan 100.64.0.2/30`, `lan 192.0.2.1/24` | runs a stateless firewall (empty at first) |
| `web` | Ticket server | host | server | 900 | 200 | `192.0.2.10/24`, gw `192.0.2.1`; serves `tickets.hilltop.example` (HTTPS, port 443) | the victim |
| `campus` | Westfield College router | router | router | 470 | 430 | `wan 100.64.0.6/30`, `lan 198.51.100.1/24` | forwards directed broadcasts (on by default) |
| `pc1` | Westfield PC | host | desktop | 220 | 470 | `198.51.100.11/24`, gw `198.51.100.1` | a real host (step 3 pings it directly) |
| `pc2` | Westfield PC | host | desktop | 370 | 540 | `198.51.100.12/24`, gw `198.51.100.1` | real host |
| `pc3` | Westfield PC | host | desktop | 630 | 520 | `198.51.100.13/24`, gw `198.51.100.1` | real host |

The campus LAN `198.51.100.0/24` has **30** computers. Only `pc1`–`pc3` are drawn; the other 27 are
represented by the zone label and by the campus router's host count (see behaviors). Broadcast address of the
campus LAN: **`198.51.100.255`**.

### Cables and link capacities

Use `NetBuilder.link(a, b, { capacity })`, capacity in packets per second. Omit `capacity` for "effectively
unlimited" (a big number). A burst frame counts as its full size against capacity (see behaviors).

| link | capacity (pps) | why |
|---|---|---|
| `mallory` ↔ `isp` (pub) | unlimited | attacker's own access |
| `fan` ↔ `isp` (home) | unlimited | fan's home line is not the bottleneck |
| `isp` ↔ `edge` (Hilltop uplink) | **60** | the bottleneck. The flood fills this before the edge firewall sees it. |
| `isp` ↔ `campus` (campus uplink) | 300 | wide enough that the amplified replies leave campus freely |
| `edge` ↔ `web` | unlimited | internal, not the bottleneck |
| `campus` ↔ `pc1` / `pc2` / `pc3` | unlimited | LAN |

Routing (all static / connected; `isp` carries routes into both customer networks):

- `isp`: connected to all four of its ports; static `192.0.2.0/24 via 100.64.0.2`, `198.51.100.0/24 via 100.64.0.6`.
- `edge`: connected `192.0.2.0/24`, `100.64.0.0/30`; default `0.0.0.0/0 via 100.64.0.1`.
- `campus`: connected `198.51.100.0/24`, `100.64.0.4/30`; default `0.0.0.0/0 via 100.64.0.5`.
- `mallory` default `via 203.0.113.1`; `fan` default `via 203.0.120.1`; `web` gateway `192.0.2.1`.
- `hostsFile`: `tickets.hilltop.example -> 192.0.2.10` (so the fan can browse by name without a DNS lab).

### Map zones (`LabDef.map.zones`)

- **Hilltop Tickets**: rect around `edge` and `web`. `x: 660, y: 120, w: 320, h: 170`, tone `good`. Label "Hilltop Tickets".
- **Westfield College · 30 computers**: rect around the campus. `x: 120, y: 400, w: 580, h: 180`, tone `info`, `dashed: true`. Label carries the "× 30" so the three drawn PCs read as a stand-in for thirty.
- **The internet**: rect behind `mallory`, `fan`, `isp`. `x: 60, y: 60, w: 520, h: 300`, tone `neutral`, `dashed: true`. Label "The internet". Keep the fill faint so it sits under the Westfield zone where they meet.

`focus` per step spotlights the devices in play (listed in each step).

---

## LabDef header

```
id: 'smurf'
version: 1
title: 'Echo Storm'
tagline: 'Turn a network's own echoes into a flood that knocks a ticket site offline, then shut the amplifier down.'
unit: 3
codehs: ['3.3 Misdirected and Overwhelmed']
ced: ['3.1.A', '3.1.B', '3.1.C', '3.5.E']
minutes: 45
objectives:
  - 'Explain what ICMP echo (ping) does and what a broadcast address is.'
  - 'Describe how a smurf attack forges a source address and amplifies pings into a flood.'
  - 'Tell a denial-of-service attack from a distributed one, and relate both to availability.'
  - 'Choose defenses: stop forwarding directed broadcasts, filter at the edge, and filter upstream.'
captureDevice: 'mallory'   (lets students see the echo traffic Mallory sends and receives)
clock: '19:00'             (game night; log timestamps read like the evening of the sale)
```

---

## Steps

Eleven steps, following the plan. Each one below gives: body (final student-facing markdown), focus, open
tab, actions, tools, goals (label / hint / what completes it), questions, and the answer-key moves.

---

### Step 1 — `echo` · "An echo and a reply"

**Body:**
```
[[fan]] wants a seat for Friday's game. Her browser will open [[web]], the Hilltop ticket server, out past
[[isp]] and Hilltop's [[edge]] router. First, a simpler message.

A **ping** is a tiny "Are you there?" message. It uses **ICMP**, the protocol computers use to check each
other and report problems. A ping is two packets: an **echo request** goes out, and an **echo reply** comes
back. If the reply arrives, the two devices can reach each other.

Press **Fan pings the ticket server**. Watch the request cross to [[web]] and the reply come back. Set the
speed to 0.5x if it goes too fast.

Then click [[web]] and [[campus]] on the map to look inside them.

> Everything in this lab happens inside a simulation. Sending forged floods at a real network without
> permission is illegal.
```

**focus:** `['fan', 'web', 'isp', 'edge']`
**open:** none (map)
**actions:**
- `fan-ping` — label **Fan pings the ticket server** — `sim.ping('fan', '192.0.2.10')`

**goals:**
- `ping` — "Fan gets a reply from the ticket server" — hint: "Press **Fan pings the ticket server** and watch the reply come back." — completes when a `ping-reply` event fires at `fan` from `192.0.2.10` since the step started.
- `web` — "Open [[web]]" — completes on `ui:inspect` of `web`.
- `campus` — "Open [[campus]]" — completes on `ui:inspect` of `campus`.

**questions:**
- `what-icmp` (choice) — prompt: "What does a ping (an ICMP echo) do?"
  - ✅ `reach` "Checks whether another device is online." *(correct)*
  - `page` "Carries a web page from a server to a browser." — feedback: "That's HTTP. A ping carries no page, only a tiny 'Are you there?'."
  - `name` "Turns a name like tickets.hilltop.example into an IP address." — feedback: "That's DNS. A ping already needs the address."
  - `encrypt` "Scrambles traffic so no one in the middle can read it." — feedback: "A ping does nothing with encryption. It only checks reachability."
  - explain: "A ping is an ICMP echo request and the echo reply that answers it. It tells you one thing: can these two devices reach each other right now."

**answer key:** moves `[{ press: 'fan-ping' }, { inspect: 'web' }, { inspect: 'campus' }]`. Choice `reach`.

---

### Step 2 — `everyone` · "Everyone answers"

**Body:**
```
Every network has one **broadcast address**: the last address in its range. For the campus network
`198.51.100.0/24`, that is **`198.51.100.255`**. A packet sent to the broadcast address is meant for every
device on that network at once.

Westfield's router still does something many networks did for years: when a ping arrives for its broadcast
address, it hands that ping to every computer on the campus. This is a **directed broadcast**.

You are Mallory now, out on the internet. Open the **Echo tool** in the Toolkit. Leave the source blank for
now. Ping the campus broadcast address `198.51.100.255` and count the replies.
```

**focus:** `['mallory', 'isp', 'campus', 'pc1', 'pc2', 'pc3']`
**open:** `'tools'`
**tools:** `{ kind: 'echo-tool', device: 'mallory' }` *(this lab's tool — see behaviors)*

**goals:**
- `send` — "Ping the campus broadcast address from [[mallory]]" — hint: "In the Echo tool, type `198.51.100.255` as the target. Leave the source blank." — completes when an `echo`/`ping-sent` from `mallory` to `198.51.100.255` happened this step.
- `replies` — "Watch every campus computer reply" — hint: "One request to the broadcast address reaches all thirty computers." — completes when a reply burst with `count >= 2` reaches `mallory` this step (in practice `count === 30`). See the `count` field in behaviors.

**questions (afterGoals):**
- `how-many` (choice) — prompt: "You sent one echo request to the broadcast address. How many replies came back?"
  - ✅ `each` "One from each computer on the network, thirty in all." *(correct)*
  - `router` "Just one, from the campus router." — feedback: "The router didn't answer. It passed your ping to every computer, and each one replied."
  - `none` "None. A broadcast can't be answered." — feedback: "Check the tool. Thirty replies came back."
  - `two` "Two: the router and the ticket server." — feedback: "The ticket server isn't on this network. Every campus computer answered."
  - explain: "One request to the broadcast address became thirty replies. Sending one packet and getting many back is called **amplification**, and it is the engine of a smurf attack."

**answer key:** moves `[{ tool: { type: 'echo', device: 'mallory', target: '198.51.100.255' } }]`. Choice `each`.

---

### Step 3 — `return-to-sender` · "Return to sender"

**Body:**
```
A ping carries the sender's address in its **source** field, so the reply knows where to go. Nothing checks
that the source is true. Mallory can write any address there. This is a **forged source address**.

Watch what that does. In the Echo tool, set the source to the ticket server's address, `192.0.2.10`, and ping
one campus computer, [[pc1]] at `198.51.100.11`. The computer answers, but the reply does not come back to
Mallory. It goes to whatever address the ping claimed to be from.

Forged packets are drawn in red so you can follow them. Real networks don't color them.
```

**focus:** `['mallory', 'pc1', 'web']`
**open:** `'tools'`
**tools:** carries `echo-tool` forward.

**goals:**
- `forge` — "Ping [[pc1]] with the ticket server's address as the source" — hint: "Target `198.51.100.11`. Source `192.0.2.10`, the ticket server." — completes when an echo from `mallory` with forged source `192.0.2.10` to `198.51.100.11` happened this step.
- `landed` — "The ticket server gets a reply to a ping it never sent" — hint: "Watch where [[pc1]]'s reply goes. It follows the forged source, not Mallory." — completes when a `ping-reply` event fires at `web` from `198.51.100.11` this step (and `web` sent no echo request).

**questions:**
- `why-there` (choice) — prompt: "The reply landed on the ticket server, which never pinged anyone. Why did the campus computer send it there?"
  - ✅ `source` "The request carried the ticket server's address as its source, so the reply went to that address." *(correct)*
  - `lookup` "The computer looked the ticket server up by name." — feedback: "It did no lookup. It copied the source address straight off the request."
  - `router` "The campus router rewrote the reply's destination." — feedback: "The router only forwarded it. The destination came from the forged source."
  - `asked` "The ticket server had asked the campus computer for a reply earlier." — feedback: "It never sent a thing. That is the whole trick."
  - explain: "A reply always goes to the request's source address. Forge the source, and you choose who gets flooded with replies."

**answer key:** moves `[{ tool: { type: 'echo', device: 'mallory', target: '198.51.100.11', source: '192.0.2.10' } }]`. Choice `source`.

---

### Step 4 — `the-storm` · "The storm"

**Body:**
```
Now put the two tricks together. That is a **smurf attack**: forge the victim's address as the source, send
to a network's broadcast address, and do it over and over. One forged request becomes thirty replies, all
aimed at the victim. Enough of them, and the victim's link fills up.

Watch Hilltop's uplink. The link from [[isp]] to [[edge]] carries only 60 packets each second. When more than
that arrive, the extra packets are **dropped**: the link is full, so there is no room for them. This is
**congestion**.

1. Press **Launch the storm**. Mallory sends a wave of forged requests to the campus broadcast address.
   Open [[edge]] and watch its uplink meter climb.
2. Press **Fan buys a ticket** while the storm runs. Her purchase has to cross the same full uplink.
```

**focus:** `['mallory', 'campus', 'isp', 'edge', 'web', 'fan']`
**open:** `{ inspect: 'edge' }` (so the traffic meter is in view)
**actions:**
- `storm` — label **Launch the storm** — fires a wave of 8 forged echo requests from `mallory` to `198.51.100.255` with source `192.0.2.10`, closely spaced (each becomes a 30-reply burst → ~240 reply-packets toward `web` across the uplink in about a second, well over 60). Deterministic (no `Math.random`; use `sim.rand`/fixed spacing).
- `fan-buy` — label **Fan buys a ticket** — `sim.browse('fan', 'https://tickets.hilltop.example/checkout')`.

**tools:** carries `echo-tool`.

**goals:**
- `launch` — "Launch the storm" — completes when the storm wave went out this step (a forged echo from `mallory` to the broadcast with source `192.0.2.10`).
- `congested` — "Fill Hilltop's uplink" — hint: "Press **Launch the storm** and watch the [[edge]] uplink meter pass 60." — completes when a `drop` with reason `congestion` happened on the `isp`↔`edge` link this step.
- `fan-fails` — "A fan's purchase fails during the flood" — hint: "Press **Fan buys a ticket** while the storm is running." — completes when `fan`'s browser finished this step with status `failed` and the failure is a congestion drop on the uplink (see `webTraffic` plumbing in behaviors).

**questions (afterGoals):**
- `which-cia` (choice) — prompt: "The ticket site is still up and its pages are unchanged, but fans can't reach it. Which part of the CIA triad is under attack?"
  - ✅ `avail` "Availability." *(correct)*
  - `conf` "Confidentiality." — feedback: "Nothing was read or leaked. The data stayed private."
  - `integ` "Integrity." — feedback: "No data changed. The pages are still correct."
  - `all` "All three, equally." — feedback: "Only one is hit: fans can't reach a site that is otherwise fine. That's availability." — `last: true`
  - explain: "Making a system unreachable to its real users is a **denial-of-service (DoS)** attack. It strikes availability, the A in CIA, without touching confidentiality or integrity."

**answer key:** moves `[{ press: 'storm' }, { press: 'fan-buy' }]`. Choice `avail`.

---

### Step 5 — `many-attackers` · "Many attackers"

**Body:**
```
The smurf used a trick to turn one attacker into many. There is a blunter way: use many attackers to start
with. A **botnet** is a crowd of computers an attacker controls, often without their owners knowing.

Press **Botnet joins in**. Hundreds of bots ping the ticket server straight on, no amplifier needed. The
uplink fills the same way.

A flood from one source is a **denial-of-service (DoS)** attack. A flood from many sources at once is a
**distributed denial-of-service (DDoS)**.
```

**focus:** `['isp', 'edge', 'web', 'fan']`
**open:** `{ inspect: 'edge' }`
**actions:**
- `botnet` — label **Botnet joins in** — fires a direct ICMP flood at `192.0.2.10` from many forged/varied sources (one aggregated burst standing for hundreds, drawn ×N), saturating the uplink. No amplifier involved. Deterministic.
- `fan-buy` — carried from step 4.

**goals:**
- `ddos` — "Start the botnet flood" — hint: "Press **Botnet joins in**." — completes when the botnet flood went out this step (a congestion drop on the uplink driven by the botnet burst).
- `fan-fails` — "The fan's purchase fails again" — same check as step 4's `fan-fails`.

**questions:**
- `dos-vs-ddos` (choice) — prompt: "The botnet flood comes straight from hundreds of computers, with no amplifier. Why is that harder to stop than one attacker?"
  - ✅ `many` "It comes from many addresses at once, so blocking one does almost nothing." *(correct)*
  - `fast` "Each bot sends faster than a single attacker could." — feedback: "Speed isn't the point. It's the number of sources, all at once."
  - `crypt` "The botnet encrypts its traffic so the firewall can't read it." — feedback: "These are plain pings. The problem is how many senders there are."
  - `move` "The botnet changes the ticket server's address." — feedback: "The server's address stays put. The traffic just arrives from everywhere."
  - explain: "A DoS from one source can be blocked by blocking that source. A **DDoS** spreads across thousands of sources, so there is no single address to block. The smurf faked that spread with one amplifier."

**answer key:** moves `[{ press: 'botnet' }, { press: 'fan-buy' }]`. Choice `many`.

---

### Step 6 — `read-the-spike` · "Read the spike"

**Body:**
```
Switch sides. You are now defending. An attack like this leaves tracks in two places.

1. **The symptom**, at Hilltop. Open [[edge]]. Its uplink meter, near zero before the game, is pegged at its
   limit. A sudden spike in traffic is an **indicator of compromise**: a sign something is wrong.
2. **The cause**, at Westfield. Open [[campus]] and read its log. During the attack it recorded echo requests
   sent to its **broadcast address** from an outside address. Normal traffic almost never does that.

Open the campus router's log line that shows the broadcast-address pings.
```

**focus:** `['edge', 'campus']`
**open:** `'logs'`
**tools:** `{ kind: 'logs', devices: ['edge', 'campus'] }` *(unlocks the Logs tab; reused infrastructure)*

**goals:**
- `meter` — "Open [[edge]] and read its uplink traffic meter" — completes on `ui:inspect` of `edge`. (The meter is in the edge inspector.)
- `logline` — "Open the campus log line for the broadcast-address pings" — hint: "In the Logs tab, pick the campus line whose destination is `198.51.100.255`." — completes on `ui:open-log` of a `campus` line with `fields.dst === '198.51.100.255'` and `fields.proto === 'icmp'`.

**questions:**
- `names-it` (choice) — prompt: "Several signs show up during the attack. Which one points to a smurf attack in particular, not just to some flood?"
  - ✅ `broadcast` "Echo requests sent to a broadcast address from outside the network." *(correct)*
  - `meter` "The uplink meter pegged at its limit." — feedback: "That shows a flood, but not which kind. Many attacks fill a link."
  - `slow` "The ticket site loads slowly for fans." — feedback: "That's the symptom of any denial of service. It doesn't single out smurf."
  - `cpu` "The web server is working hard." — feedback: "A busy server fits many problems. Look for the broadcast pings."
  - explain: "A traffic spike tells you there's a flood. Echo requests aimed at a broadcast address, from outside, are the fingerprint of a smurf attack. That's the ICMP-to-broadcast indicator defenders watch for."

**answer key:** moves `[{ inspect: 'edge' }, { openLog: 'campus', where: (e) => e.fields?.dst === '198.51.100.255' && e.fields?.proto === 'icmp' }]`. Choice `broadcast`.

---

### Step 7 — `silence-the-amplifier` · "Silence the amplifier"

**Body:**
```
The real fix is at the amplifier. A router has no good reason to forward pings from the internet to a whole
network at once. Modern routers don't, by default.

Open [[campus]]. In its settings, turn **off** forwarding of directed broadcasts. Then press **Mallory tries
again**. One forged request goes in, and the campus router drops it at the door. No replies, no flood.
```

**focus:** `['campus', 'mallory', 'web']`
**open:** `{ inspect: 'campus' }`
**actions:**
- `retry` — label **Mallory tries again** — fires one forged echo from `mallory` to `198.51.100.255`, source `192.0.2.10` (same as a single storm pulse).

**tools:** directed-broadcast toggle lives in the campus router inspector (this lab's inspector section — see behaviors). No Toolkit card.

**goals:**
- `off` — "Turn off directed-broadcast forwarding on [[campus]]" — hint: "Open [[campus]] and switch directed broadcasts off." — completes when `campus`'s directed-broadcast setting is off.
- `fizzle` — "Mallory's ping gets no replies" — hint: "Turn the setting off first, then press **Mallory tries again**." — completes when, this step, the forged request to `198.51.100.255` is dropped at `campus` (a `drop` at `campus` for the broadcast destination) and no reply burst reaches `web`.

**questions:**
- `whose-network` (choice) — prompt: "Turning that setting off stopped the attack. But the campus network belongs to Westfield, not Hilltop. What does that mean for Hilltop?"
  - ✅ `depends` "Hilltop depends on other networks to fix this, and can't force them." *(correct)*
  - `own` "Hilltop can just turn the setting off on its own router instead." — feedback: "That keeps Hilltop from being an amplifier, but it doesn't stop a flood that uses some other network."
  - `over` "Nothing. Once one amplifier is fixed, smurf attacks are over." — feedback: "There are many open networks. An attacker can pick a different amplifier."
  - `back` "Hilltop should flood the campus network back." — feedback: "Flooding back is illegal and pointless."
  - explain: "The best fix sits on a network you may not control. That's why defenders also guard their own edge and lean on their provider. No single fix covers every case."

**answer key:** moves `[{ tool: { type: 'directed-broadcast', device: 'campus', on: false } }, { press: 'retry' }]`. Choice `depends`.

---

### Step 8 — `guard-your-edge` · "Guard your own edge"

**Body:**
```
Westfield fixed its router. But the next attacker will find another amplifier, or just use a botnet like you
saw in step 5. Hilltop has to defend its own edge too.

[[edge]] runs a **firewall**. Add a rule that drops inbound ICMP echo traffic from the internet, so pings from
outside never reach the ticket server. Then test it against the botnet flood.

1. In [[edge]]'s firewall, add a rule: **deny inbound ICMP from ALL**.
2. Press **Botnet joins in**, then **Fan buys a ticket**. Read the result. The pings no longer reach the
   server, but fans still can't get through.
3. The flood fills the uplink before it ever reaches your firewall. Press **The ISP filters upstream**: now
   the provider drops the flood one hop earlier, before Hilltop's uplink. Press **Fan buys a ticket** again.
```

**focus:** `['isp', 'edge', 'web', 'fan']`
**open:** `{ inspect: 'edge' }`
**actions:**
- `botnet` — carried from step 5.
- `fan-buy` — carried.
- `isp-filter` — label **The ISP filters upstream** — adds an inbound-ICMP-deny rule to `isp` on the port toward Hilltop (reuses the firewall engine on a router), standing in for a provider's scrubbing/filtering. Dropped packets never enter the `isp`↔`edge` link, so the uplink clears.

**tools:** firewall rule editor on `edge` (reused from the `firewall` lab — its inspector section + Toolkit card). The student types/picks the rule.

**goals:**
- `rule` — "Add a rule to [[edge]] that drops inbound ICMP" — hint: "Direction inbound, protocol ICMP, source ALL, action deny." — completes when `edge`'s firewall has an enabled inbound rule matching ICMP from any source with action deny.
- `still-fails` — "See that fans still can't buy, even with the rule" — hint: "Press **Botnet joins in**, then **Fan buys a ticket**. The uplink is already full." — completes when, after the rule exists, the botnet flood still causes a `congestion` drop on the uplink and `fan`'s purchase fails this step. (The ICMP is dropped at `edge`, but only after crossing the full uplink.)
- `upstream-fixes` — "After the ISP filters upstream, a fan's purchase goes through" — hint: "Press **The ISP filters upstream**, then **Fan buys a ticket**." — completes when, after `isp-filter`, `fan`'s browser loads `tickets.hilltop.example` this step (no congestion drop on the uplink during that attempt).

**questions:**
- `why-upstream` (choice) — prompt: "Your edge firewall drops the flood, but fans can't buy tickets until the ISP filters it upstream. Why?"
  - ✅ `fills` "The flood fills the uplink before it reaches your firewall." *(correct)*
  - `match` "Edge firewalls can't match on ICMP." — feedback: "They can. Your rule worked: the pings were dropped at your edge."
  - `faster` "The ISP's firewall is faster than yours." — feedback: "Speed isn't it. The ISP sits upstream of the full link, so it drops the flood before the bottleneck."
  - `order` "Your rule was in the wrong order." — feedback: "Order didn't matter here. The uplink was already saturated upstream of your firewall."
  - explain: "A firewall can only act on traffic that reaches it. In a volumetric flood, the harm is the full uplink, which is upstream of your edge. Providers and DDoS-scrubbing services filter there, before the bottleneck."

**answer key:** moves `[{ tool: { type: 'fw-rule', device: 'edge', rule: { dir: 'in', proto: 'icmp', src: 'ALL', action: 'deny' } } }, { press: 'botnet' }, { press: 'fan-buy' }, { press: 'isp-filter' }, { press: 'fan-buy' }]`. Choice `fills`.

*(The `fw-rule` move shape is the firewall lab's; match whatever it ships. If the firewall rule SimAction isn't
merged at implementation time, see the stand-in note in behaviors.)*

---

### Step 9 — `how-risky` · "How risky?"

**Body:**
```
A security review grades each weakness by how much harm it could cause. Many use three levels: **high**,
**moderate**, and **low** risk. Grade three findings.
```

**focus:** `['edge', 'campus']`
**open:** none

**questions:**
- `open-icmp` (choice) — prompt: "Before you added the rule, Hilltop's edge firewall allowed inbound ICMP from anywhere. What risk is that?"
  - ✅ `mod` "Moderate risk." *(correct)*
  - `high` "High risk." — feedback: "It helps an attacker probe and adds to a flood, but on its own it hands over no data or control. Open external ICMP is a moderate risk."
  - `low` "Low risk." — feedback: "It's more than cosmetic: it enables ping sweeps and feeds floods. It's a moderate risk."
  - `none` "No risk at all." — feedback: "Leaving ICMP open has real downsides. It's a moderate risk."
  - explain: "Open inbound ICMP at an external firewall is a moderate risk: useful to an attacker, but not a direct path to the data. Blocking it is cheap, so most networks do."
- `wifi-flat` (choice) — prompt: "Another finding: the campus has one flat network with its grade server on it, and anyone in range can join over weak Wi-Fi. What risk is that?"
  - ✅ `high` "High risk." *(correct)*
  - `mod` "Moderate risk." — feedback: "Worse than open ICMP. An outsider can join and reach the grade server directly. That's a high risk."
  - `low` "Low risk." — feedback: "Low is for things like access points sending beacon frames. Here an outsider can reach a key server. That's a high risk."
  - explain: "Weak Wi-Fi lets an outsider in, and a flat network puts the key server within reach. Together that is a high risk."
- `beacons` (choice) — prompt: "Last one: the campus Wi-Fi access points broadcast beacon frames that announce the network's name. What risk is that?"
  - ✅ `low` "Low risk." *(correct)*
  - `mod` "Moderate risk." — feedback: "Beacons only announce that a network exists. Anyone nearby could find it anyway. That's a low risk."
  - `high` "High risk." — feedback: "A beacon gives no way in and no data. That's a low risk."
  - explain: "Beacon frames tell nearby devices a network exists. That helps an attacker a little, but it opens nothing. It's a low risk."

**answer key:** choices `mod`, `high`, and `low`. No moves.

*(Orchestrator edit: the second question originally rated "forwarding directed broadcasts" as high. That rating isn't in the CED, so the step now grades the CED's three anchor examples instead: open external ICMP is moderate, an unsegmented network on weak Wi-Fi with a key server is high, beacon frames are low.)*

---

### Step 10 — `reflect` · "Reflect"

**Body:**
```
Pull it together in your own words.
```

**focus:** none
**open:** none

**questions:**
- `explain-smurf` (text, teacher-graded) — `minWords: 40`, `lines: 6` — prompt: "Explain how a smurf attack turns one attacker's pings into a flood big enough to knock a site offline. Then name the one setting, and on which device, that stops this smurf attack at its source."
  - (Sample answer in the key.)

**answer key:** sample text (below). No moves.

---

### Step 11 — `submit` · "Review and submit"

`kind: 'submit'`

**Body:**
```
Look over your summary on the right. You can go back to any step and change an answer, then hand in your work
again.
```

---

## Sample answers (for `solution.ts`)

```
echo:                 (no text questions)
everyone:             (choice only)
return-to-sender:     (choice only)
the-storm:            (choice only)
many-attackers:       (choice only)
read-the-spike:       (choice only)
silence-the-amplifier:(choice only)
guard-your-edge:      (choice only)
how-risky:            (choice only)

reflect:
  explain-smurf:
    "The attacker sends ping requests to a network's broadcast address, so the router hands each one to every
     computer on that network. Thirty computers means thirty replies for one request, which is the
     amplification. The attacker also forges the source address to be the victim's, so all those replies pour
     onto the victim instead of back to the attacker. Enough forged requests fill the victim's uplink and real
     users can't get through. The fix at the source is to turn off directed-broadcast forwarding on the
     amplifying network's router, so a ping to the broadcast address is dropped instead of copied to every
     host."
```

The written answer should name: amplification (one request → many replies via the broadcast address), the
forged source aiming replies at the victim, the result (uplink fills, availability lost), and the source-side
fix (directed-broadcast forwarding **off** on the **campus router**). Full marks need both the amplification
idea and the correct setting-plus-device.

---

## Behaviors the implementer must build

Grouped by owner. "This lab's own" features must be designed as the shared APIs the plan promises (`logs`
reuses directed broadcasts, forged source, and the traffic meter). Put each in its own module and hook it in
with small calls, per `ARCHITECTURE.md`.

### This lab's own (build here)

1. **Directed broadcasts** — `src/sim/broadcast.ts` (suggested).
   - A router config flag, default **on** here: `Device.directedBroadcast?: boolean` (or per-iface). A per-LAN
     **host count** so one router can stand for 30 computers without 30 devices: `Iface.lanHosts?: number`
     (set `30` on the campus router's `lan` iface).
   - When a router forwards an IP packet whose destination is the **broadcast address of one of its own
     connected networks** (`198.51.100.255` for `198.51.100.0/24`): if `directedBroadcast` is on, deliver it
     to that LAN as a broadcast. For an ICMP echo request, generate **`lanHosts` echo replies** back toward the
     packet's **source address**, aggregated into one `Frame.burst` of count `lanHosts` (reuse `mac-flood`'s
     burst). Real drawn hosts (`pc1`–`pc3`) may also reply; keep the total deterministic at `lanHosts`.
   - If `directedBroadcast` is **off**, drop the packet at the router with a new `DropReason: 'no-broadcast'`
     (or reuse `no-route` with distinct student text) and log it. This is the step 7 fix.
   - Hosts answer directed-broadcast pings by default. A per-host "ignore broadcast pings" option is mentioned
     in the plan as a secondary host-side defense; it is **not** used by any step here, so it's optional. If
     you skip it, say so; don't let it block the walkthrough.
   - Public method: `sim.setDirectedBroadcast(deviceId, on)`. SimAction `{ type: 'directed-broadcast'; device; on }`
     with an `applyAction` case. (No typed student input, so no `assertTypable` entry needed.)
   - **Detection log**: when the campus router forwards a directed broadcast, write
     `sim.log('campus', { source: 'router', level: 'warn', msg: 'ICMP echo request to 198.51.100.255 (directed broadcast)', fields: { src: '192.0.2.10', dst: '198.51.100.255', proto: 'icmp', count: 30 } })`.
     Step 6's goal and answer key select by `fields.dst` and `fields.proto`, not by text.

2. **Forged source IP on echo** — extend the ICMP/echo path.
   - `sim.echo(deviceId, targetIp, { source?: Ip })`: send an ICMP echo request; when `source` is set, that is
     the packet's source field (the reply goes there). Draw forged packets with `Frame.forged = true` (red),
     like `arpSpoof` already does. Without `source`, behaves like a normal `sim.ping` to that target.
   - SimAction `{ type: 'echo'; device; target; source? }` with `applyAction` and, since the student types the
     addresses, an `assertTypable` case using a new `checkEcho` in `toolInput.ts`:
     - target: valid IP (allow the broadcast `.255`); reject the device's own address.
     - source: optional; if present, valid IP; a friendly nudge if it's Mallory's own real address
       (`"A smurf aims the replies at the victim, not at yourself. Use the ticket server's address, 192.0.2.10."`).
   - When an unsolicited echo **reply** is delivered to a host that has no matching pending ping (the forged
     case), still emit `ping-reply` for that device (the current `deliver` already emits regardless of a pending
     entry — keep that). Step 3's goal reads a `ping-reply` at `web`.
   - **Amplified reply count**: extend `SimEvent` `ping-reply` (and `ping-sent`) with an optional
     `count?: number` so a burst of replies reports as one event carrying `30`. Step 2's `replies` goal and the
     Echo tool's readout use it. (Alternative: emit 30 separate events; the single-event-with-count path keeps
     `runUntilIdle` and the event cap cheap, so prefer it.)

3. **Link capacity and congestion drops** — `src/sim/congestion.ts` (suggested).
   - `Link.capacityPps?: number`, set via `NetBuilder.link(a, b, { capacity })`. Only the `isp`↔`edge` uplink
     (60) and campus uplink (300) need finite values; others are unlimited.
   - Track packets crossing each link in a sliding ~1s window, **counting a `Frame.burst` as its full count**.
     In `transmit` (or when a frame is about to enter a link), if admitting this frame would exceed the link's
     capacity for the current window, drop it with new `DropReason: 'congestion'` and emit a `drop` event
     attributed to the sending device with the link identified (so the UI can mark the link and the fan's
     browser can explain it). Keep it deterministic: derive the window from `sim.t`, never wall-clock.
   - New `DropReason: 'congestion'`. Student text:
     - `describe.ts` `dropText`/`pingFailText`: "The link to Hilltop is full, so the {request|reply} was
       dropped. A flood is using up the link."
     - `CANT_SEND['congestion']`: "This site can't be reached. The link to it is full right now." So the fan's
       browser fails with that message (the `drop`→`failBrowser` plumbing already fires for
       `http-req`; congestion drops of the fan's request must reach that path — the dropped packet is the fan's
       own `http-req`, so pass it through `drop(dev, 'congestion', pkt, frame)` with the fan's `reqId` intact).
   - Step 4/5/8 `fan-fails` goals reuse the existing `ActionOutcome`/`webTraffic` logic in `Lesson.tsx`, which
     already matches a lost web request to a browser still failing — extend `webTraffic`/`dropText` to cover a
     `congestion` drop on the uplink carrying the fan's `reqId`.

4. **Traffic-rate meter** — a small pps readout + sparkline.
   - `sim.linkPps(linkId)` (and/or `sim.devicePps(deviceId)`), derived from the same sliding window as
     congestion. A new inspector section `src/ui/inspector/TrafficMeter.tsx` shows, for a router, each link's
     current packets/second and a tiny sparkline, highlighting any link at or over capacity. Returns null for
     hosts/switches. Register in `INSPECTOR_SECTIONS`.
   - On the map, color a congested link (over capacity this window) with a "congested" style. Append CSS under
     a `/* smurf */` comment in `src/features.css` (meter bars, sparkline, `.link.congested`). Reuse the
     `Frame.burst` ×N stack drawing from `mac-flood` for the reply/flood bursts.

5. **Echo tool card** — `src/ui/tools/EchoTool.tsx`, `ToolSpec { kind: 'echo-tool'; device }`.
   - Fields: fixed source **device** (Mallory), a **target** text input, and an optional **source to forge**
     text input (labelled so a blank source means "my own address"). A **Send** button dispatches
     `{ type: 'echo', ... }`. Show results like the Ping card does (reply count, including the ×30 amplified
     burst). Use the `checkEcho` messages for bad input. Register in `TOOL_CARDS`; add `'Echo tool'` to
     `TOOL_NAME` in `Guide.tsx`. Add `'echo-tool'` to the `ToolSpec` union in `labs/types.ts`.

6. **Directed-broadcast toggle** in the campus router inspector — a `Toggle` (from `tools/parts.tsx`) wired to
   `sim.setDirectedBroadcast`. Can live in the same new inspector section as the traffic meter or its own.
   Disabled while `replaying`.

### Reused from other labs (depend on; don't rebuild)

- **`Frame.burst`** aggregated frames and their ×N map drawing — from `mac-flood`. Used for the 30-reply
  amplified burst, the storm waves, and the botnet flood. Keep flood traffic to a few burst frames, never
  hundreds of real ones (the walkthrough test plays this lab).
- **Firewall engine + rule editor + "which rule matched"** — from `firewall`. Used in step 8 on `edge`
  (student rule) and `isp` (the upstream filter, applied by the `isp-filter` action). Needs: a stateless ACL on
  a router, an inbound rule matching `proto: icmp, src: ALL, action: deny`, applied on the direction arriving
  from the outside interface, with a firewall log line on deny. The `fw-rule` SimAction/move shape and the
  rule-editor tool are the firewall lab's; use them as shipped.
- **Logs tab + `logs` tool + `loggedSince`/`openedLog`** and **map zones** and `sim.rand` — orchestrator
  (wave 0). Step 6 uses the Logs tab.

### Stand-in note

If, at implementation time, the firewall engine (step 8) or `Frame.burst` (floods) has not merged, build the
**smallest** stand-in inside `src/labs/smurf/` or `src/sim/` to make this lab's own steps work, and flag it in
the report so it's reconciled after the merge. Prefer waiting for the real APIs; the plan sequences this lab in
wave 2, after both land.

### Events / drop reasons / fields summary (for the `SimEvent` union and `DropReason`)

- New `DropReason`: `'congestion'` (always), `'no-broadcast'` (optional; else reuse `no-route` with distinct text).
- Extend `ping-reply` and `ping-sent` with optional `count?: number`.
- New SimActions: `{ type: 'echo'; device; target; source? }`, `{ type: 'directed-broadcast'; device; on }`.
  (The storm/botnet/isp-filter are **lesson actions** in `index.ts`, recorded as `step-action`; they don't
  need their own SimAction types.)
- Log fields used by goals: `dst`, `proto` (campus directed-broadcast line), and the firewall deny line's
  fields from the firewall lab.

---

## Concerns / open questions for the implementer and reviewers

1. **Firewall engine coupling (step 8).** This lab leans on the firewall lab's ACL on both `edge` and `isp`,
   including applying a rule on the direction arriving from an outside interface. If that engine's "inbound /
   outside interface" model differs from what step 8 assumes, adjust the rule the student types but keep the
   lesson: edge rule drops ICMP yet the uplink stays full; the upstream filter clears it. Confirm the engine
   can sit on `isp` (a plain router), not only on a dedicated firewall device.
2. **Congestion determinism.** The sliding-window congestion check must be a pure function of `sim.t` and the
   recorded actions so replay and the walkthrough test reproduce the same drops. Pick fixed storm/botnet burst
   sizes and spacing (8 forged requests per storm press; one botnet burst of a few hundred) and document them
   next to the actions.
3. **Amplified reply as one event with `count`.** If reviewers prefer N discrete `ping-reply` events over one
   with `count`, that's fine for correctness but watch the `MAX_EVENTS` cap (4000) across repeated storm
   presses. The single-event path is the safer default.
4. **"Fan still fails" goal in step 8 (`still-fails`).** It must fire while the edge rule already exists, to
   make the point that the rule didn't save the uplink. Make sure the goal distinguishes "ICMP dropped at edge
   but fan's HTTP lost to congestion on the uplink" from "fan reached the server." Order of button presses in
   the step body and answer key matters; keep the hint explicit.
5. **Host-count fiction.** Thirty replies come from a `lanHosts` count on the campus router, while only three
   PCs are drawn. One sentence in step 2 already frames the three PCs as a stand-in for thirty; if a reviewer
   finds the map misleading, consider drawing a faint "× 30" stack behind the PCs rather than adding devices.
6. **COVERAGE/README (orchestrator, after merge).** No change needed to COVERAGE's mapping; this lab delivers
   3.1.A.4, 3.1.B.1, 3.1.C.1, 3.1.C.5, 3.5.E.6, 3.5.E.7 as mapped. README's lab table can move `smurf` from
   "coming soon" to done with CodeHS `3.3` and 11 steps / ~45 min.
