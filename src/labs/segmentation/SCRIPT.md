# Network Segmentation: Zones, VLANs, and Subnets (`segmentation`): lesson script

This is the whole lesson as students will see it, plus everything the implementer needs to turn it into `index.ts`, `scenario.ts`, and `solution.ts`. Student-facing text is final: copy it as written. Bodies are in fenced `md` blocks; inside the `md` template in `index.ts`, escape the backticks (`` \` ``).

Outline: [PLAN.md](PLAN.md). Conventions: [docs/unit3/ARCHITECTURE.md](../../../docs/unit3/ARCHITECTURE.md).

## Changes from PLAN.md

1. **Crew tablets are crew laptops.** The malware spreads through Windows-style file sharing on port 445. Laptops run that; tablets usually don't. Labels: Crew laptop 1, Crew laptop 2.
2. **Named every computer and gave it services.** Operations is Command, Navigation, and the chart server. Every inside computer has file sharing (445) open, left on by default. Fire control also takes target data (5001), Command takes status reports (5002), the chart server serves charts (443), and the media server serves the movie list (80).
3. **Two extra devices.** `shore` (Shore link) hangs off the firewall's port 4. It carries the story (the game came in over it), anchors step 9's screened-subnet questions, and shows the firewall at the network's edge (3.4.C). `personal` (Personal laptop) sits unplugged until step 8, where it goes into the spare jack.
4. **The malware also scans the subnets next to its own.** If it scanned only its own subnet, subnets alone would contain it and the zone policy would never be tested. Step 5 asks students to predict that subnets alone don't stop it, and the sim must make that true.
5. **One cable per VLAN, no trunk.** The firewall has three cables into the switch, one per zone. Step 5's setup adds the second and third. The map must draw parallel cables between the same two devices (see behavior S6). Step 5 tells students that bigger networks use a trunk.
6. **Step 5 split of work.** Setup re-addresses everything except Crew laptop 1 and the firewall's crew port. The student does those two and the VLAN of the firewall's crew cable (the plan allowed this).
7. **Step 3 uses a Zone plan card** (device to zone, zone to security level). The map draws the planned zones as students fill it in.
8. **Step 7 adds a log goal:** open a blocked probe in the firewall's log.
9. **Step 8:** students shut the spare port hands-on. Port security is covered by two questions (the plan allowed either).

PLAN.md is updated for items 1 and 4.

## Changes made while building

1. **VLAN state is `SwitchPort.vlan`**, beside mac-flood's per-port state (`switchSec`), not `Iface.vlan`. A switch needs `sim.configureSwitch` before `sim.setVlan`. The `switch-ports` inspector is unchanged; the VLANs section sits above it.
2. **`vlan` and `zone-policy` are not in `SETTING_TOOLS`.** Each gets a Toolkit pointer card (like mac-flood's port security card) that opens the device, so `Dock.tsx` needs no change.
3. **Lab data rides on the tool specs**, so the shared card and sections stay lab-agnostic: `vlan` carries the VLAN names, `zone-plan` carries the zones, each device's zone and job, and the level notes. The Crew row's Allow all warning is the crew zone's `allowWarning`.
4. **Step 1 says "Open ports"**, the inspector heading the firewall lab built, instead of "Services".
5. **Rule order.** The zone policy writes rules row by row (Weapons, Operations, Crew), then the shore rules. Same rules as S9; only the numbers of rules 1 to 6 differ. Crew to Weapons is still rule 7.
6. **Drawn zones.** A host is drawn in the zone whose VLAN its switch port is in, or else in its planned zone. So the Personal laptop shows up in Weapons in step 8. Nothing is drawn until the student starts the plan.
7. **No VLAN column in the MAC address table** (S2 allowed skipping it). The VLANs table shows each port's VLAN.
8. **Log lines** read `DENY TCP 10.0.30.31:49165 -> 10.0.10.11:445 zone Crew -> Weapons (rule 7)`, with `fields.rule` = `Crew to Weapons` and `fields.ruleNo`.
9. **Drop text** keeps the firewall lab's colon: `Core firewall blocked it: its zone policy denies Crew to Weapons.` An Only cell reads `its zone policy allows only port 5001 (target data) from Operations to Weapons`.
10. **Parallel cables** show `×3` in the map's port-tag style (`port-tag link-count`): `.pill` is an HTML style and doesn't draw in SVG.
11. **Malware section.** Patient zero's sentence comes from `sim.infect(id, how)`. The source address is the one it had when the copy came (`Infection.fromIp`). The time reads `Arrived at 12.34s on the network clock.`
12. **Outbreak result line** says `The malware is running on Crew laptop 1.`, then `It is spreading…`, then `The malware stopped. Infected: 3 of 8 computers.` (The line under the button doesn't know about the game.)
13. **Zone plan card** also says `Cleared. {Label} isn't in a zone.` when a select goes back to its prompt.

## Lab definition

| Field | Value |
|---|---|
| `id` | `segmentation` |
| `version` | `1` |
| `title` | `Network Segmentation: Zones, VLANs, and Subnets` |
| `tagline` | `Split a submarine’s flat network into zones with VLANs, subnets, and firewall rules, and watch the same malware stop at the zone boundary.` |
| `unit` | `3` |
| `codehs` | `['3.8 Network Segmentation']` |
| `ced` | `['3.1.B', '3.1.C', '3.3.A', '3.3.B', '3.4.C']` |
| `minutes` | `45` |
| `objectives` | `'Explain how malware moves laterally across a flat network.'`, `'Divide a network into zones with VLANs and subnets.'`, `'Set a different policy for each zone, and test it.'`, `'Explain what segmentation contains, and what it cannot.'` |
| `build` | `buildSub` (scenario.ts) |
| `map` | `{ ports: false, addresses: true, zones: subZones }` |
| `labelMacs` | `true` |
| `captureDevice`, `hostRoutes`, `clock` | not set |

Port tags stay off: about ten cables meet at the switch, and the VLANs table in the inspector names each port's device. Addresses stay on: students watch them change in step 5.

## Scenario and map

### Sim options

Use build-network's timings so packets are slow enough to follow and ARP gives up quickly:

```ts
new NetBuilder({ linkMs: 500, procMs: 100, l2Ms: 50, httpTimeoutMs: 15000, arpTimeoutMs: 4000, pingTimeoutMs: 12000 })
```

### Devices

All positions are on the 1000 x 600 canvas. The closest pairs are 140 apart.

| id | Label | Kind | Icon | x, y | Ports at the start | Services (firewall lab's `Device.services`) |
|---|---|---|---|---|---|---|
| `fire` | Fire control | host | desktop | 140, 190 | eth0 `10.0.0.11/24`, gw `10.0.0.1` | File sharing TCP 445; Target data TCP 5001 |
| `torpedo` | Torpedo room | host | desktop | 140, 370 | eth0 `10.0.0.12/24`, gw `10.0.0.1` | File sharing TCP 445 |
| `personal` | Personal laptop | host | laptop | 140, 540 | eth0, no address, no cable | none |
| `command` | Command | host | desktop | 360, 80 | eth0 `10.0.0.21/24`, gw `10.0.0.1` | File sharing TCP 445; Status reports TCP 5002 |
| `nav` | Navigation | host | desktop | 500, 80 | eth0 `10.0.0.22/24`, gw `10.0.0.1` | File sharing TCP 445 |
| `chart` | Chart server | host | server | 640, 80 | eth0 `10.0.0.23/24`, gw `10.0.0.1` | File sharing TCP 445; Charts TCP 443 (HTTPS) |
| `crew1` | Crew laptop 1 | host | laptop | 860, 190 | eth0 `10.0.0.31/24`, gw `10.0.0.1` | File sharing TCP 445 |
| `crew2` | Crew laptop 2 | host | laptop | 860, 370 | eth0 `10.0.0.32/24`, gw `10.0.0.1` | File sharing TCP 445 |
| `media` | Media server | host | server | 860, 540 | eth0 `10.0.0.33/24`, gw `10.0.0.1` | File sharing TCP 445; Movies TCP 80 (HTTP, see below) |
| `sw` | Main switch | switch | switch | 500, 290 | `ports: 12`, all VLAN 1 | |
| `fw` | Core firewall | router | firewall | 500, 460 | p1 `10.0.0.1/24`; p2, p3 no address; p4 `198.51.100.1/24` | none (answers pings to its own addresses) |
| `shore` | Shore link | host | cloud | 680, 540 | eth0 `198.51.100.2/24`, gw `198.51.100.1` | none |

The media server's movie list uses the existing `web` field, so the existing browser loads it:

```ts
web: { name: 'Media server', title: 'Crew movie list', https: false, page: 'Tonight in the crew mess: a double feature at 2000. Requests go to the morale officer.' }
```

The firewall engine (from `firewall`) is on `fw` from the start, stateful. Its zone policy (behavior S9) starts as Allow all between every pair of inside zones. Zones are tied to firewall ports: p1 Weapons, p2 Operations, p3 Crew, p4 Shore.

### Cables at the start

| Link | From | To |
|---|---|---|
| L1 | `fire` eth0 | `sw` p1 |
| L2 | `torpedo` eth0 | `sw` p2 |
| (none) | | `sw` p3 is the spare jack in the weapons compartment |
| L3 | `command` eth0 | `sw` p4 |
| L4 | `nav` eth0 | `sw` p5 |
| L5 | `chart` eth0 | `sw` p6 |
| L6 | `crew1` eth0 | `sw` p7 |
| L7 | `crew2` eth0 | `sw` p8 |
| L8 | `media` eth0 | `sw` p9 |
| L9 | `fw` p1 | `sw` p10 |
| L10 | `fw` p4 | `shore` eth0 |

Added later: step 5's setup cables `fw` p2 to `sw` p11 and `fw` p3 to `sw` p12. Step 8's action cables `personal` eth0 to `sw` p3.

### Zones, VLANs, and addresses

Constants for `scenario.ts`:

```ts
export type ZoneId = 'weapons' | 'operations' | 'crew';
export const INSIDE = ['fire', 'torpedo', 'command', 'nav', 'chart', 'crew1', 'crew2', 'media'];
export const ZONE_OF: Record<string, ZoneId> = {
  fire: 'weapons', torpedo: 'weapons',
  command: 'operations', nav: 'operations', chart: 'operations',
  crew1: 'crew', crew2: 'crew', media: 'crew',
};
export const VLAN: Record<ZoneId, number> = { weapons: 10, operations: 20, crew: 30 };
export const SW_PORTS: Record<ZoneId, string[]> = { weapons: ['p1', 'p2', 'p3'], operations: ['p4', 'p5', 'p6'], crew: ['p7', 'p8', 'p9'] };
export const FW_PORT: Record<ZoneId | 'shore', string> = { weapons: 'p1', operations: 'p2', crew: 'p3', shore: 'p4' };
export const FW_CABLE: Record<ZoneId, string> = { weapons: 'p10', operations: 'p11', crew: 'p12' }; // switch port for each firewall cable
export const NET = { flat: '10.0.0.0/24', weapons: '10.0.10.0/24', operations: '10.0.20.0/24', crew: '10.0.30.0/24', shore: '198.51.100.0/24' };
export const HOST_NUM: Record<string, number> = { fire: 11, torpedo: 12, command: 21, nav: 22, chart: 23, crew1: 31, crew2: 32, media: 33 };
export const PERSONAL_IP = '10.0.10.50';
```

| Device | Zone | Switch port | VLAN (from step 4) | Flat address | Segmented address (from step 5) | Gateway after step 5 |
|---|---|---|---|---|---|---|
| Fire control | Weapons | p1 | 10 | 10.0.0.11 | 10.0.10.11/24 | 10.0.10.1 |
| Torpedo room | Weapons | p2 | 10 | 10.0.0.12 | 10.0.10.12/24 | 10.0.10.1 |
| (spare jack) | Weapons | p3 | 10 | | Personal laptop gets 10.0.10.50/24 in step 8 | 10.0.10.1 |
| Command | Operations | p4 | 20 | 10.0.0.21 | 10.0.20.21/24 | 10.0.20.1 |
| Navigation | Operations | p5 | 20 | 10.0.0.22 | 10.0.20.22/24 | 10.0.20.1 |
| Chart server | Operations | p6 | 20 | 10.0.0.23 | 10.0.20.23/24 | 10.0.20.1 |
| Crew laptop 1 | Crew | p7 | 30 | 10.0.0.31 | 10.0.30.31/24 (student) | 10.0.30.1 (student) |
| Crew laptop 2 | Crew | p8 | 30 | 10.0.0.32 | 10.0.30.32/24 | 10.0.30.1 |
| Media server | Crew | p9 | 30 | 10.0.0.33 | 10.0.30.33/24 | 10.0.30.1 |
| Firewall port 1 | Weapons | p10 | 10 (step 5) | 10.0.0.1 | 10.0.10.1/24 | |
| Firewall port 2 | Operations | p11 | 20 (step 5) | | 10.0.20.1/24 | |
| Firewall port 3 | Crew | p12 | 30 (student, step 5) | | 10.0.30.1/24 (student) | |

The address plan: the third number matches the VLAN, and each device keeps its last number.

### Map zones (`map.zones`)

No zones show until the student starts the Zone plan in step 3. Then `subZones(sim)` returns one dashed rectangle per zone that has members:

- **Members of zone Z:** inside devices the Zone plan puts in Z, plus any host cabled to a switch port whose VLAN is `VLAN[Z]`. (That second rule pulls the Personal laptop into Weapons when it plugs into port 3 in step 8.)
- **Shape:** the bounding box of the members' centers, padded 90 left and right, 60 above, 100 below (room for the name and address lines). With the default positions: Weapons `{x: 50, y: 130, w: 180, h: 340}` (to y 610 with the Personal laptop), Operations `{x: 270, y: 20, w: 460, h: 160}`, Crew `{x: 770, y: 130, w: 180, h: 510}`.
- **Label:** the zone name, then ` · VLAN n` once every member's switch port is in that VLAN, then ` · High` (or Medium, Low) once a level is set. Example: `Weapons · VLAN 10 · High`.
- **Tone:** `bad` if any member is infected. Otherwise by level: High `good`, Medium `info`, Low `warn`, none `neutral`.
- `dashed: true` always (VLANs are logical walls).

The switch, the firewall, and the shore link are in no zone.

## Setup helpers (scenario.ts)

Reset network replays only the setups, so each step's setup rebuilds everything earlier steps built. Each helper is idempotent and keeps the student's valid choices.

| Helper | Does |
|---|---|
| `ensureClean(sim)` | `sim.cleanMalware()`: no device infected, no scan pending. |
| `warmArp(sim)` | `sim.prewarmArp([...INSIDE])`, so malware probes don't each start with an ARP broadcast. |
| `ensurePlan(sim)` | Every inside device's planned zone is `ZONE_OF[id]` (fixes wrong ones). Each zone's level: keep the student's; if unset, use Weapons High, Operations Medium, Crew Low. |
| `ensureVlans(sim)` | Ports in `SW_PORTS` get their zone's VLAN. Other ports untouched. |
| `ensureSubnets(sim, full)` | Cable `fw` p2 to `sw` p11 and `fw` p3 to `sw` p12 if missing. VLAN p10 = 10, p11 = 20. `fw` p1 = 10.0.10.1/24, p2 = 10.0.20.1/24. Every inside host except `crew1` gets its segmented address and gateway. With `full`, also: p12 = VLAN 30, `fw` p3 = 10.0.30.1/24, `crew1` = 10.0.30.31/24 with gateway 10.0.30.1. Then clear all hosts' ARP tables (old entries point at old addresses). |
| `ensurePolicy(sim)` | The zone policy matches the captain's orders (step 6). |

## Steps

### Step 1 `ship`: One big network

CED: 3.1.B (setting up lateral movement).

- **Setup:** `warmArp(sim)`. The ping then shows only its own path, with no ARP broadcast reaching the firewall.
- **Focus:** `['crew1', 'sw', 'fire']`
- **Tools:** none.

**Body**

```md
A navy submarine runs on three groups of computers:

- **Weapons**: [[fire]] and [[torpedo]] aim and launch the torpedoes.
- **Operations**: [[command]], [[nav]], and [[chart]] run the ship and plot its course.
- **Crew recreation**: [[crew1]], [[crew2]], and [[media]] are for the crew's time off: games, email, and movies.

All of them plug into one switch, [[sw]], and share one network, `10.0.0.0/24`. A network with no walls inside it is called a **flat network**.

[[fw]] is the ship's door to [[shore]], a satellite link that works only when the sub is near the surface. [[personal]] belongs to a sailor. It isn't plugged in.

1. Click [[fire]]. Its **Services** list shows the **port numbers** it answers on. A port number names one service on a computer. Port 445 is **file sharing**, which lets other computers copy files to and from this one. A port number is not a switch port. A switch port is a socket for a cable.
2. Click [[sw]]. Find which device each port leads to.
3. Press **Crew laptop 1 pings Fire control**. Watch the path the ping takes.
```

If the firewall lab names the services section something other than "Services", change the bold word to match.

**Actions**

| id | Label | Does |
|---|---|---|
| `ping-fire` | Crew laptop 1 pings Fire control | `sim.ping('crew1', sim.ipOf('fire'))` |

**Goals**

| id | Label | Hint | Done when |
|---|---|---|---|
| `fire` | Open [[fire]] and read its services | | `inspected('fire')` |
| `sw` | Open [[sw]] | | `inspected('sw')` |
| `ping` | [[crew1]] gets a reply from [[fire]] | Press **Crew laptop 1 pings Fire control**. | a `ping-reply` on `crew1` from `ipOf('fire')` since the step started |

**Question `problem`** (choice, `afterGoals`)

Prompt: Crew laptop 1 reached Fire control directly. Why is that a problem?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `reach` | Malware on a crew laptop could reach weapons too | yes | |
| `slow` | Pings slow down the weapons consoles while they work | | One ping is tiny. The worry is what else could take the same path. |
| `launch` | Crew laptop 1 can now launch a torpedo | | Reaching a computer isn't the same as controlling it. But it's the first thing an attacker needs. |
| `fw` | It isn't. The core firewall checks every packet. | | Watch the ping again. It went from the switch straight to Fire control and never passed the firewall. |

Explain: On a flat network, nothing stands between a crew laptop and a weapons console. Whatever takes over one device can reach all the others.

**Answer key**

```ts
ship: { moves: [{ inspect: 'fire' }, { inspect: 'sw' }, { press: 'ping-fire' }] },
```

---

### Step 2 `worm`: A game with a passenger

CED: 3.1.B.2 (lateral movement), 3.1.C.1 (CIA impact).

- **Setup:** `ensureClean(sim); warmArp(sim);`
- **Focus:** `['crew1', 'fire']`
- **Tools:** none.

**Body**

```md
Last night the sub came near the surface, and a sailor downloaded a free game onto [[crew1]] over the shore link. The game hides **malware**: software written to do harm. This kind is a **worm**, malware that spreads across a network on its own. Nobody has to click anything.

Once it runs, it knocks on port 445 at every address nearby. Every computer with file sharing open gets a copy, and each copy starts knocking too. Spreading from the first device that's taken over to other devices on the same network is called **lateral movement**.

Infected computers turn red, and so do the malware's probes. Real networks don't color anything. This simulator does so you can follow along. It also skips addresses where no device lives, so you don't have to wait.

> Everything in this lab happens inside a simulation. Releasing malware on a real network without permission is illegal.

1. Press **Crew laptop 1 installs a game**. Watch the map.
2. When the map goes quiet, click [[fire]]. Find where its copy came from.
```

**Actions**

| id | Label | Does |
|---|---|---|
| `install` | Crew laptop 1 installs a game | `sim.infect('crew1')`. Does nothing if `crew1` is already infected. |

**Goals**

| id | Label | Hint | Done when |
|---|---|---|---|
| `weapons` | The malware reaches a weapons console | Press **Crew laptop 1 installs a game** and watch the map. | a `malware-infected` event for `fire` or `torpedo` since the step started |
| `all` | The malware infects all eight computers | | every device in `INSIDE` is infected |
| `source` | Open [[fire]] and find where its copy came from | Wait until Fire control turns red, then click it. | `ev` is `ui:inspect` of `fire` and `fire` is infected |

With the scan order in behavior S7, Crew laptop 1 infects every other computer itself, Fire control first. The inspector on Fire control then reads: "Infected. The copy came from Crew laptop 1 (10.0.0.31) through file sharing, port 445."

**Question `how`** (choice, `afterGoals`)

Prompt: Nobody installed anything on Fire control. How did the malware get there?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `share` | Crew laptop 1 copied it in through file sharing | yes | |
| `shore` | It came in over the shore link, like the game did | | Fire control's copy came from 10.0.0.31, inside the ship. Click Fire control and read where its copy came from. |
| `fw` | The core firewall let it through | | The probes went through the switch only. On a flat network, traffic between computers never reaches the firewall. |
| `user` | A sailor installed the game on Fire control too | | The game was installed once, on Crew laptop 1. Fire control's copy arrived over the network. |

Explain: The worm used Crew laptop 1 as a base and reached every computer it could find on the same network. That's lateral movement, and on a flat network it can find them all.

**Question `cia`** (choice, `multi`, `afterGoals`)

Prompt: The malware now runs on Fire control. What could an adversary who controls it do?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `read` | Read the targeting data | yes | |
| `change` | Change the targeting data | yes | |
| `freeze` | Freeze the console during a drill | yes | |
| `wait` | Nothing until someone on board clicks on it | | A worm needs no clicks. Nobody touched Fire control, and the malware got in anyway. |

Explain: Those are the three goals of security: confidentiality (keep data secret), integrity (keep it correct), and availability (keep it working). Lateral movement puts all three at risk on every device it reaches.

**Answer key**

```ts
worm: { moves: [{ press: 'install' }, { inspect: 'fire' }] },
```

---

### Step 3 `plan`: Draw the lines

CED: 3.3.B.1, 3.3.B.2, 3.3.B.3 (segmentation, different policies per zone).

- **Setup:** `ensureClean(sim)`.
- **Focus:** none.
- **Open:** `'tools'`
- **Tools:** `{ kind: 'zone-plan', devices: INSIDE }` (new, behavior S4).

**Body**

```md
The crew wiped every computer and restored it from backups. Before the game comes back, plan some walls.

**Network segmentation** divides one network into smaller **segments** and keeps them apart, so an attack on one segment can't reach the others. Each segment here is a **zone**: a group of devices that do the same kind of job and follow the same rules.

Each zone also gets a **security level**: how much is at stake if an attacker takes it over, and so how closely to guard it.

- **High**: let in only the traffic it needs.
- **Medium**: trusted, but still guarded.
- **Low**: the least trusted. The other zones guard themselves against it.

Open the **Zone plan** in the Toolkit tab.

1. Put each computer in the zone that matches its job. The map draws each zone as you fill it in.
2. Give each zone a security level.
```

**Goals**

| id | Label | Hint | Done when |
|---|---|---|---|
| `assign` | Put every computer in the zone that matches its job | Fire control and Torpedo room handle weapons. Command, Navigation, and the chart server run the ship. The other three are for the crew. | every device in `INSIDE` has planned zone `ZONE_OF[id]` |
| `levels` | Give each zone a security level | | all three zones have a level |

The levels are the student's choice. Nothing later depends on them except labels.

**Zone plan messages** (one line under the card after each change)

| Change | Tone | Message |
|---|---|---|
| Device put in its job's zone | good | `Saved. Fire control is in Weapons.` |
| Device put in another zone | info | `Saved. {Label} {job}. It fits better in {right zone}.` Jobs: Fire control "aims the torpedoes", Torpedo room "launches the torpedoes", Command "is where officers run the ship", Navigation "steers the ship", Chart server "stores the charts Navigation uses", Crew laptop 1 and 2 "is a sailor's own laptop", Media server "stores movies for the crew". |
| Weapons set to Medium or Low | info | `Saved. Think about what an attacker could do from Fire control.` |
| Crew set to High | info | `Saved. Crew laptops run games and downloads. Would you trust them as much as Fire control?` |
| Any other level | good | `Saved. Operations is Medium.` |

**Question `strictest`** (choice)

Prompt: Which zone needs the strictest policy?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `weapons` | Weapons, because a takeover there does the most harm | yes | |
| `crew` | Crew, because it's where malware is most likely to get in | | Crew is the least trusted zone, so the other zones guard themselves against it. The zone that needs the closest guard is the one with the most at stake. |
| `ops` | Operations, because the captain works there | | Who uses a zone doesn't set its level. Ask what an attacker could do with each zone. |
| `same` (`last`) | All three, equally strict | | Then movie night would face the same rules as a torpedo launch. Different zones get different levels, so each one can do its job. |

Explain: A breach in Weapons could cost lives, so it gets the highest level. Segmentation lets each zone have its own policy, so Weapons can be strict without making movie night impossible.

**Question `purpose`** (choice)

Prompt: What is network segmentation for?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `contain` | Keeping a break-in inside one segment | yes | |
| `fast` | Making the network faster for everyone | | Smaller segments do cut down broadcast traffic. But speed isn't why the captain wants walls. |
| `outside` | Hiding the ship's network from the shore link | | The shore link is one door. Segmentation is about walls inside, between the ship's own zones. |
| `passwords` | Giving every computer its own password | | Passwords protect accounts. Segmentation decides which devices can reach each other at all. |

Explain: Segmentation isolates traffic. A break-in in one segment stays there, and each segment can get the policy it needs.

**Answer key**

```ts
plan: {
  moves: [
    ...INSIDE.map((d) => ({ tool: { type: 'set-zone', device: d, zone: ZONE_OF[d] } })),
    { tool: { type: 'set-zone-level', zone: 'weapons', level: 'high' } },
    { tool: { type: 'set-zone-level', zone: 'operations', level: 'medium' } },
    { tool: { type: 'set-zone-level', zone: 'crew', level: 'low' } },
  ],
},
```

---

### Step 4 `vlans`: One switch, three networks

CED: 3.3.A.3 (VLANs logically separate devices on shared switches).

- **Setup:** `ensureClean(sim); ensurePlan(sim);` then clear every host's ARP table (`sim.clearArp`) and the switch's MAC table (`sim.dev('sw').macTable = {}`), so the ARP request shows on the map.
- **Focus:** `['sw', 'crew1']`
- **Open:** `{ inspect: 'sw' }`
- **Tools:** `{ kind: 'vlan', device: 'sw' }` (new, behavior S2), `{ kind: 'ping' }`.

**Body**

```md
Your plan needs walls between the zones. New switches and new cables would take weeks to install on a submarine. A **VLAN** (virtual LAN) builds the walls with settings instead.

A VLAN is a group of switch ports that act like a switch of their own. A frame that comes in a port in VLAN 30 leaves only through other ports in VLAN 30. Broadcasts too. VLANs separate devices **logically**: by the switch's settings, not by its cables.

Every port starts in VLAN 1. That's why the whole ship is one network.

The computers and the switch have forgotten everything they learned so far.

1. Click [[sw]]. In its **VLANs** table, put each port in its zone's VLAN:
   - Weapons: VLAN 10. Include port 3, a spare jack in the weapons compartment with nothing plugged in.
   - Operations: VLAN 20.
   - Crew: VLAN 30.
2. Leave port 10, the firewall's cable, in VLAN 1 for now.
3. Press **Crew laptop 1 pings Fire control**. Watch where its ARP request goes.
4. Press **Crew laptop 1 pings the media server**.

Try other pairs with the **Ping** tool in the Toolkit tab.
```

**Actions**

| id | Label | Does |
|---|---|---|
| `ping-fire` | Crew laptop 1 pings Fire control | `sim.clearArp('crew1')`, then `sim.ping('crew1', sim.ipOf('fire'))`. Clearing first means the ARP request shows every time, even if the student pinged before setting the VLANs. Without it, a cached MAC would make the ping time out with no ARP request, and the `why-fail` answer would be wrong. |
| `ping-media` | Crew laptop 1 pings the media server | `sim.ping('crew1', sim.ipOf('media'))` |

**Goals**

| id | Label | Hint | Done when |
|---|---|---|---|
| `weapons` | Put the weapons ports, 1, 2, and 3, in VLAN 10 | Port 3 has no cable. It's the spare jack in the weapons compartment. | `sw` p1, p2, p3 are VLAN 10 |
| `ops` | Put the operations ports, 4, 5, and 6, in VLAN 20 | | `sw` p4, p5, p6 are VLAN 20 |
| `crew` | Put the crew ports, 7, 8, and 9, in VLAN 30 | | `sw` p7, p8, p9 are VLAN 30 |
| `cut` | [[crew1]] gets no answer from [[fire]] | Set the VLANs first. Then press **Crew laptop 1 pings Fire control**. | `ev` is a `ping-fail` from `crew1` to `ipOf('fire')` (reason `arp-timeout` or `timeout`), and at that moment p1, p2 are VLAN 10 and p7 is VLAN 30 |
| `media` | [[crew1]] still gets a reply from [[media]] | Set the crew ports first. Then press **Crew laptop 1 pings the media server**. | `ev` is a `ping-reply` on `crew1` from `ipOf('media')`, and at that moment p7 and p9 are VLAN 30 |

The failed ping's result line already reads: "Crew laptop 1 asked "Who has 10.0.0.11?" and nobody answered."

**Question `what`** (choice)

Prompt: What does a VLAN do, with no new hardware?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `split` | It splits one switch into separate local networks | yes | |
| `encrypt` | It encrypts traffic between devices in the same VLAN | | A VLAN doesn't encrypt anything. Devices in the same VLAN talk in the clear, as before. |
| `port` | It blocks file sharing on port 445 | | A VLAN doesn't look at port numbers or services. It decides which switch ports can hear each other. |
| `mac` | It gives each device a new MAC address | | MAC addresses stay the same. The switch changes only which ports a frame may leave through. |

Explain: VLANs logically separate devices on a shared switch. Same switch, same cables. A broadcast in one VLAN never reaches another.

**Question `why-fail`** (choice, `afterGoals`)

Prompt: Crew laptop 1 and Fire control are both still on 10.0.0.0/24. Why did the ping fail?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `arp` | Its ARP request never reached Fire control | yes | |
| `fw` | The core firewall blocked it | | The firewall isn't in this path. The ARP request never left VLAN 30. |
| `address` | Fire control got a new address when its VLAN changed | | Fire control still has 10.0.0.11. A VLAN changes which ports can hear each other, not any device's address. |
| `share` | Fire control turned off file sharing | | A ping doesn't use file sharing. It only needs Fire control to answer. |

Explain: Crew laptop 1 needed Fire control's MAC address first. Its ARP broadcast went only to the other VLAN 30 ports, so nobody who knew the answer heard the question.

**Answer key**

```ts
vlans: {
  moves: [
    ...(['weapons', 'operations', 'crew'] as const).flatMap((z) =>
      SW_PORTS[z].map((p) => ({ tool: { type: 'set-vlan', device: 'sw', iface: p, vlan: VLAN[z] } })),
    ),
    { press: 'ping-fire' },
    { press: 'ping-media' },
  ],
},
```

---

### Step 5 `subnets`: A subnet for each zone

CED: 3.3.A.2 (subnetting contains a breach), 3.4.C (a firewall for each segment).

- **Setup:** `ensureClean(sim); ensurePlan(sim); ensureVlans(sim); ensureSubnets(sim, false);`
- **Focus:** `['sw', 'fw', 'crew1']`
- **Open:** `{ inspect: 'sw' }`
- **Tools:**
  - `{ kind: 'ip-config', fixed: [FW_PIN, CREW1_PIN] }`, with a per-port pin (behavior S10):
    - `FW_PIN = { device: 'fw', iface: 'p3', cidr: '10.0.30.1/24', why: 'Crew laptop 2 and the media server already use 10.0.30.1 as their gateway. Type 10.0.30.1/24.' }`
    - `CREW1_PIN = { device: 'crew1', cidr: '10.0.30.31/24', why: "The ship's address plan keeps each device's last number and makes the third number match its VLAN. Type 10.0.30.31/24." }`
  - `{ kind: 'gateway' }`

**Body**

```md
The VLANs worked. Now no zone can reach any other, and some have to. Command has to send target data to Fire control.

The fix is to give each VLAN its own **subnet**: its own IP network, like `10.0.30.0/24`. Devices on different subnets can't talk directly. They hand everything for another subnet to their default gateway. Every zone's gateway is [[fw]], so traffic between zones has to pass through one place, where it can be checked.

The ship's address plan: the third number matches the VLAN, and each device keeps its last number. Fire control's `10.0.0.11` becomes `10.0.10.11`.

The ship's IT chief did most of the work. [[fw]] now has a cable into the switch for each zone: its port 1 goes to switch port 10, port 2 to port 11, and port 3 to port 12. Weapons, Operations, [[crew2]], and [[media]] already have their new addresses. Finish the crew zone:

1. Click [[sw]]. Put port 12 in VLAN 30.
2. Click [[fw]]. Give its port 3 the address `10.0.30.1/24`.
3. Click [[crew1]]. Change its address to `10.0.30.31/24` and its default gateway to `10.0.30.1`.
4. Press **Crew laptop 1 opens the movie list**. Then press **Crew laptop 1 pings Command**.

Bigger networks often carry every VLAN over one cable, called a **trunk**. This lab uses one cable per VLAN to keep things simple.
```

**Actions**

| id | Label | Does |
|---|---|---|
| `movies` | Crew laptop 1 opens the movie list | ``sim.browse('crew1', `http://${sim.ipOf('media')}/`)`` |
| `ping-command` | Crew laptop 1 pings Command | `sim.ping('crew1', sim.ipOf('command'))` |

**Goals**

| id | Label | Hint | Done when |
|---|---|---|---|
| `vlan` | Put switch port 12 in VLAN 30 | Port 12 is where the firewall's port 3 cable plugs in. | `sw` p12 is VLAN 30 |
| `fwport` | Give [[fw]] port 3 the address 10.0.30.1/24 | | `fw` p3 is `10.0.30.1/24` |
| `crew1` | Move [[crew1]] to 10.0.30.31/24, with gateway 10.0.30.1 | Give the firewall's port 3 its address first. A gateway has to be a router's address on the computer's own network. | `crew1` eth0 is `10.0.30.31/24` and its gateway is `10.0.30.1` |
| `movies` | The movie list loads on [[crew1]] | Crew laptop 1 and the media server are both in VLAN 30. Check that Crew laptop 1 has its new address. | `pageSince(sim, 'crew1', since, (b) => b.status === 'loaded' && b.from === sim.ipOf('media'))` |
| `cross` | [[crew1]] gets a reply from [[command]] through the firewall | If the ping stops at Crew laptop 1, check its gateway. If nobody answers at 10.0.30.1, check the VLAN of switch port 12. | a `ping-reply` on `crew1` from `ipOf('command')` since the step started, with `crew1` on 10.0.30.0/24 |

**Question `why-subnet`** (choice)

Prompt: The VLANs already keep the zones apart. What do separate subnets add?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `router` | A router can pass chosen traffic between zones | yes | |
| `space` | Room for many more addresses in each zone | | One /24 network already had room for 254 devices. The ship has eight. |
| `encrypt` | Encryption for everything that crosses between zones | | Subnets don't encrypt anything. They decide which traffic has to go through a router. |
| `novlan` | They make the VLANs unnecessary | | Without VLANs, every device would still hear every broadcast. A laptop could change its own address and reach Fire control directly, never touching the firewall. |

Explain: Subnetting puts a router between the zones. Traffic that has to cross goes through it, so a breach in one subnet can be stopped there instead of spreading.

**Question `predict`** (choice, `afterGoals`)

Prompt: The firewall now joins the three subnets, but it still lets everything through. If the game ran now, what would happen?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `cross` | It would spread to every zone, through the firewall | yes | |
| `stay` | It would stay in the crew zone, since the subnets differ | | Different subnets means the traffic needs a router. The firewall is that router, and right now it passes everything. |
| `stuck` | It couldn't leave Crew laptop 1 at all | | Crew laptop 1 reaches other subnets through its gateway. You used it to ping Command. |
| `switch` | It would spread as before, straight through the switch | | The VLANs still keep the zones apart on the switch. To reach another zone, a packet has to go through the firewall. |

Explain: Subnets alone don't stop anything. They make all traffic between zones pass through one point. Next you'll decide what that point allows.

A lab test must back this answer (see "Lab tests").

**Answer key**

```ts
subnets: {
  moves: [
    { tool: { type: 'set-vlan', device: 'sw', iface: 'p12', vlan: 30 } },
    { tool: { type: 'set-ip', device: 'fw', iface: 'p3', cidr: '10.0.30.1/24' } },
    { tool: { type: 'set-ip', device: 'crew1', iface: 'eth0', cidr: '10.0.30.31/24' } },
    { tool: { type: 'gateway', device: 'crew1', ip: '10.0.30.1' } },
    { press: 'movies' },
    { press: 'ping-command' },
  ],
},
```

---

### Step 6 `policy`: Rules between zones

CED: 3.3.B.3 (different policies per zone), 3.4.C.1 and 3.4.C.2 (a firewall for each segment).

- **Setup:** `ensureClean(sim); ensurePlan(sim); ensureVlans(sim); ensureSubnets(sim, true);`
- **Focus:** `['fw']`
- **Open:** `{ inspect: 'fw' }`
- **Tools:** `{ kind: 'zone-policy', device: 'fw' }` (new, behavior S9).

**Body**

```md
Every packet between zones now passes through [[fw]]. Tell it what to allow with a **zone policy**: a table of which zone may start a connection to which other zone, and for what.

The captain's orders:

1. Crew devices may not start a connection to Weapons or Operations.
2. Operations may send target data to Weapons, on port 5001. Nothing else.
3. Weapons may send status reports to Operations, on port 5002. Nothing else.
4. Anything these orders don't list is denied.

Ports 5001 and 5002 belong to the ship's own software.

Click [[fw]] and find its **Zone policy**. Each row is the zone a connection starts from. Each column is the zone it goes to. Your security levels from the plan show in the headings. A reply to an allowed connection always gets back.

Then press each test button. If the firewall stops a packet, a red tag on the map shows where.

Many networks put a separate firewall in front of each segment. Here one firewall does that job, with its own port and its own rules for each zone. The zone policy writes the firewall's rules for you. You'll write rules by hand in the Firewall Rules and Placement lab.
```

**The captain's orders as cells** (From row, To column)

| From \ To | Weapons | Operations | Crew |
|---|---|---|---|
| Weapons | same zone | Only status reports (port 5002) | Deny |
| Operations | Only target data (port 5001) | same zone | Deny |
| Crew | Deny | Deny | same zone |

Every cell starts as Allow all.

**Actions**

| id | Label | Does (firewall lab's service connection) |
|---|---|---|
| `target` | Command sends target data to Fire control | `command` connects to `ipOf('fire')`, TCP 5001 |
| `share` | Command opens Fire control's file share | `command` connects to `ipOf('fire')`, TCP 445 |
| `status` | Fire control sends a status report to Command | `fire` connects to `ipOf('command')`, TCP 5002 |
| `crew-share` | Crew laptop 1 opens Fire control's file share | `crew1` connects to `ipOf('fire')`, TCP 445 |

**Goals**

| id | Label | Hint | Done when |
|---|---|---|---|
| `orders` | Set all six cells to follow the captain's orders | Anything the orders don't list is Deny. Check Weapons to Crew and Operations to Crew too. | the policy equals the table above |
| `target` | Target data from [[command]] reaches [[fire]] | Set Operations to Weapons first. Then press **Command sends target data to Fire control**. | `ev` is a successful connection from `command` to `ipOf('fire')` port 5001, and at that moment the Operations to Weapons cell is Only target data |
| `share` | [[fw]] stops [[command]] from opening Fire control's file share | Press **Command opens Fire control's file share**. | `loggedSince(sim, 'fw', since, e => deny && src === ipOf('command') && dst === ipOf('fire') && dport === 445)` |
| `status` | A status report from [[fire]] reaches [[command]] | Set Weapons to Operations first. Then press **Fire control sends a status report to Command**. | `ev` is a successful connection from `fire` to `ipOf('command')` port 5002, and at that moment the Weapons to Operations cell is Only status reports |
| `crew` | [[fw]] stops [[crew1]] from opening Fire control's file share | Press **Crew laptop 1 opens Fire control's file share**. | `loggedSince(sim, 'fw', since, e => deny && src === ipOf('crew1') && dst === ipOf('fire') && dport === 445)` |

`deny` means `e.fields?.action === 'deny'` (match the firewall lab's field names).

**Question `least`** (choice)

Prompt: Why allow only target data from Operations to Weapons, instead of everything?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `limit` | Malware on Command could then reach only port 5001 | yes | |
| `speed` | Allowing everything would slow the whole firewall down | | Speed isn't the reason. Ask what a hacked operations console could reach. |
| `encrypted` | Target data is encrypted, and other traffic isn't | | The zone policy doesn't look at encryption. It decides by zone and port number. |
| `only` | Weapons consoles can't receive any other traffic | | They can. Fire control has file sharing open on port 445, the same door the worm used. |

Explain: This is least privilege: allow only what each zone needs. If Command is ever hacked, the attacker still can't open Fire control's file share.

**Answer key**

```ts
policy: {
  moves: [
    { tool: { type: 'set-zone-policy', device: 'fw', from: 'operations', to: 'weapons', value: 'only:5001' } },
    { tool: { type: 'set-zone-policy', device: 'fw', from: 'weapons', to: 'operations', value: 'only:5002' } },
    { tool: { type: 'set-zone-policy', device: 'fw', from: 'weapons', to: 'crew', value: 'deny' } },
    { tool: { type: 'set-zone-policy', device: 'fw', from: 'operations', to: 'crew', value: 'deny' } },
    { tool: { type: 'set-zone-policy', device: 'fw', from: 'crew', to: 'weapons', value: 'deny' } },
    { tool: { type: 'set-zone-policy', device: 'fw', from: 'crew', to: 'operations', value: 'deny' } },
    { press: 'target' },
    { press: 'share' },
    { press: 'status' },
    { press: 'crew-share' },
  ],
},
```

---

### Step 7 `contain`: Malware, again

CED: 3.3.A.2 (subnetting contains a breach), 3.3.B.1, 3.1.B.2.

- **Setup:** `ensureClean(sim); ensurePlan(sim); ensureVlans(sim); ensureSubnets(sim, true); ensurePolicy(sim); warmArp(sim);`
- **Focus:** `['crew1', 'fw']`
- **Tools:** `{ kind: 'logs', devices: ['fw'] }`

**Body**

```md
Months later, the sub comes near the surface again. The same sailor downloads the same game onto [[crew1]].

The malware hasn't changed. It knocks on port 445 at every address nearby: its own subnet first, then the subnets next to it.

1. Press **Crew laptop 1 installs the game**. Watch where the probes go.
2. When the map goes quiet, open the **Logs** tab. Click a line in [[fw]]'s log that shows a blocked probe.
```

**Actions**

| id | Label | Does |
|---|---|---|
| `install` | Crew laptop 1 installs the game | `sim.infect('crew1')`. Does nothing if `crew1` is already infected. |

What happens: Crew laptop 1 infects Crew laptop 2 and the media server through the switch. Its probes to 10.0.10.11, 10.0.10.12, 10.0.20.21, 10.0.20.22, and 10.0.20.23 go to the firewall and are denied. Crew laptop 2 and the media server then probe the same five addresses and are denied too: about 15 deny lines.

**Goals**

| id | Label | Hint | Done when |
|---|---|---|---|
| `crew` | The malware spreads to [[crew2]] | Press **Crew laptop 1 installs the game**. | a `malware-infected` event for `crew2` since the step started |
| `blocked` | [[fw]] turns away the malware's probes | | `loggedSince(sim, 'fw', since, e => deny && dport === 445 && src in 10.0.30.0/24)` |
| `clean` | Weapons and Operations stay clean | Wait for the malware to stop. If it got past the firewall, check the zone policy, then press **Reset network**. | a `malware-done` event since the step started, and none of `fire`, `torpedo`, `command`, `nav`, `chart` is infected |
| `log` | Open a blocked probe in [[fw]]'s log | In the **Logs** tab, click a DENY line with port 445. | `openedLog(e => e.device === 'fw' && deny && dport === 445 && src in 10.0.30.0/24)` |

**Question `contained`** (choice, `afterGoals`)

Prompt: Why did the malware stop at the edge of the crew zone?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `policy` | The firewall denied every probe from Crew | yes | |
| `own` | It only tries addresses on its own subnet | | Read the firewall's log. It tried 10.0.10.11 and 10.0.20.21 too. |
| `vlan` | The VLANs blocked it, with no help from the firewall | | The VLANs sent its probes to the firewall instead of straight to Fire control. The firewall's zone policy turned them away. |
| `patched` | The weapons consoles were patched after last time | | Nobody changed Fire control. It still has file sharing open on port 445. |

Explain: The VLANs and subnets forced every probe through the firewall, and the zone policy denied them. Each layer did part of the job. That's how subnetting contains a breach.

**Question `inside`** (choice, `afterGoals`)

Prompt: Crew laptop 2 and the media server were infected anyway. Why didn't the firewall stop that?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `same` | Traffic inside a zone never passes the firewall | yes | |
| `low` | The crew zone's security level was set too low | | The level is part of your plan. It doesn't change where packets go. Did the probes to Crew laptop 2 pass the firewall? |
| `cell` | The crew-to-crew cell was set to Allow | | There is no crew-to-crew cell in the zone policy. Why is that square greyed out? |
| `failed` | Segmentation failed, so the whole crew zone fell | | Segmentation did its job: it kept the damage to one zone. It was never meant to guard devices from others in the same zone. |

Explain: Segmentation contains a breach to one segment. It can't protect devices from each other inside that segment. For that, the crew could turn off file sharing they don't use and keep their laptops updated.

**Answer key**

```ts
contain: {
  moves: [
    { press: 'install' },
    {
      openLog: 'fw',
      where: (e) => e.fields?.action === 'deny' && e.fields?.dport === 445 && String(e.fields?.src).startsWith('10.0.30.'),
    },
  ],
},
```

---

### Step 8 `jack`: One more door

CED: 3.3.B.4 (port security), 3.1.B.3 (an open data port).

- **Setup:** `ensureClean(sim); ensurePlan(sim); ensureVlans(sim); ensureSubnets(sim, true); ensurePolicy(sim);` The crew zone comes back clean.
- **Focus:** `['sw', 'personal']`
- **Open:** `{ inspect: 'sw' }`
- **Tools:** mac-flood's switch port control on `sw` (shut down and turn on a port; behavior M1). Use whatever `ToolSpec` kind mac-flood defines.

**Body**

```md
Remember port 3, the spare jack in the weapons compartment? Nothing is plugged into it, but it's in VLAN 10. Anything plugged in there lands inside the weapons zone. Its traffic to Fire control goes through the switch and never passes the firewall.

1. Press **A sailor plugs a laptop into the spare jack**. Watch the weapons zone on the map.
2. Click [[sw]]. Shut down port 3.
3. Press **A sailor plugs a laptop into the spare jack** again.

Like most laptops, [[personal]] gets an address automatically from the network it joins. Here it gets one on the weapons subnet.

A switch has a second tool for ports that are in use. **Port security** limits how many MAC addresses a port accepts, and can name which ones. The questions compare the two.
```

**Actions**

| id | Label | Does |
|---|---|---|
| `plug` | A sailor plugs a laptop into the spare jack | If `personal` has no cable: `sim.connect({ device: 'personal' }, { device: 'sw', iface: 'p3' })`. If it has no address: `sim.setIp('personal', 'eth0', '10.0.10.50', 24); sim.setGateway('personal', '10.0.10.1')`. Then `personal` connects to `ipOf('fire')`, TCP 445 (firewall lab's service connection). Safe to press again. |

**Goals**

| id | Label | Hint | Done when |
|---|---|---|---|
| `in` | [[personal]] opens a file share on [[fire]] | Press the button before you shut the port. If you already shut it, turn port 3 back on, press the button, then shut it again. | a successful connection from `personal` to `ipOf('fire')` port 445 since the step started |
| `shut` | Shut down switch port 3 | Click the switch and find port 3 in its port settings. | `sw` p3 is shut down by an admin (mac-flood's port state) |
| `out` | [[personal]] can't reach [[fire]] anymore | Shut port 3 first. Then press **A sailor plugs a laptop into the spare jack** again. | `ev` is a failed connection (any reason) from `personal` to `ipOf('fire')` port 445, and at that moment p3 is shut down |

**Question `why-shut`** (choice)

Prompt: Why shut the spare port, instead of turning on port security with a limit of one MAC address?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `first` | A limit of one still lets the first device in | yes | |
| `flood` | Port security works only against MAC flooding | | Port security also limits which devices may use a port. But a limit of one still lets one device in, and nobody should use this port at all. |
| `vlan` | Port security would move the port out of VLAN 10 | | Port security doesn't change the VLAN. It counts and checks MAC addresses on the port. |
| `slow` | Port security slows down the whole switch | | Checking MAC addresses is quick work for a switch. The problem is what a limit of one still allows. |

Explain: An unused port has no device that belongs on it, so the safe setting is off. Shutting unused ports is part of most switch security policies.

**Question `swap`** (choice, `afterGoals`)

Prompt: The Torpedo room console's port is in use, so it can't be shut. What stops someone from unplugging the console and plugging in their own laptop?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `psec` | Port security, allowing only the console's MAC | yes | |
| `shut` | Shut the port down, and turn it on only when needed | | That would cut off the Torpedo room console too. A weapons console has to stay available. |
| `vlan` | Move the port to VLAN 30, the crew VLAN | | That would put the Torpedo room console in the crew zone. |
| `rule` | A firewall rule that blocks the laptop | | The laptop would be inside the weapons VLAN. Its traffic to Fire control goes through the switch and never reaches the firewall. |

Explain: Port security limits how many MAC addresses a port accepts, and can name which ones. A swapped-in laptop has a different MAC, so the switch shuts the port and logs it. The same limit stops MAC flooding. A skilled attacker can copy the console's MAC address, so the ship also keeps the compartment locked.

**Answer key**

```ts
jack: {
  moves: [
    { press: 'plug' },
    { tool: { type: '<mac-flood port shutdown>', device: 'sw', iface: 'p3' /* shut down */ } },
    { press: 'plug' },
  ],
},
```

---

### Step 9 `dmz`: A door to the outside

CED: 3.3.A.1 (screened subnet), 3.4.C (firewalls at each ingress and egress point).

- **Setup:** none.
- **Focus:** `['fw', 'shore']`
- **Tools:** none.

**Body**

```md
When the sub is near the surface, email for the crew arrives over [[shore]]. A **mail relay** is a server that accepts mail from outside and passes it on. It talks to the outside world all day, so it's the server most likely to be attacked.

A **screened subnet**, also called a **DMZ**, is a zone for servers like this. Firewall rules screen it from both sides. The outside can reach only those servers, and those servers can reach only a little of the inside. If an attacker takes over the mail relay, they're stuck in the screened subnet.

[[fw]] also guards [[shore]], the ship's only door to the outside. A network needs a firewall at every point where it meets the outside world, and one for each segment.
```

**Question `where`** (choice)

Prompt: Where should the ship's mail relay go?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `dmz` | In a screened subnet of its own | yes | |
| `crew` | In the crew zone, next to the media server | | Mail from outside can carry malware. A hacked relay in the crew zone could reach every crew laptop without passing the firewall. |
| `weapons` | In the weapons zone, the best-guarded zone | | Then the shore link would need a door straight into Weapons. Servers that face the outside go where a break-in hurts least. |
| `outside` | On the shore side, outside the firewall | | Then nothing would guard the relay at all. In a screened subnet, the firewall guards it too. |

Explain: A screened subnet holds the servers that face the outside, on their own firewall port with their own rules. A break-in there stays there.

**Question `deny`** (choice)

Prompt: The screened subnet gets its own row and column in the zone policy. Which of these cells should be Deny?

| id | Option | Correct | Feedback |
|---|---|---|---|
| `dmz-wpn` | Screened subnet to Weapons | yes | |
| `shore-dmz` | Shore link to screened subnet | | Then no mail could arrive. Allow only mail from the shore link to the relay. |
| `crew-dmz` | Crew to screened subnet | | The crew picks up their mail there. Allow only mail. |
| `ops-dmz` | Operations to screened subnet | | Command sends its reports to shore through the relay. Allow only mail. |

Explain: Outsiders can reach the screened subnet, so it's the zone most likely to be taken over. It gets no door into the zones that matter most.

**Answer key**

```ts
dmz: {},
```

---

### Step 10 `reflect`: Your recommendation

CED: 3.3.B.3, 3.4.C (the scenario's deliverable).

- **Setup:** none. **Tools:** none.

**Body**

```md
You split a flat network into zones and watched the same malware stop at a wall. Here is what you used:

- **VLANs** kept the zones apart on one shared switch.
- **Subnets** sent all traffic between zones through the firewall.
- A **zone policy** gave each zone its own rules.
- Shutting the spare port closed a door nobody should use. **Port security** guards the ports in use.
- A **screened subnet** keeps servers that face the outside away from everything else.
```

**Question `recommend`** (text, teacher-graded, `minWords: 45`, `lines: 8`)

Prompt: The captain asks for your recommendation. For each of the three LANs (weapons, operations, and crew recreation), give a security level and at least two security features, and explain why that LAN needs them.

Sample answer (for `solution.ts`):

> Weapons should be High. Keep it in its own VLAN and subnet and let in only target data from Operations, because a hacked weapons console could change or block targeting. Shut unused jacks like port 3 and turn on port security on the ports in use. Operations should be High or Medium. It gets its own VLAN and subnet, with only status reports coming in from Weapons and nothing from Crew, because it runs and steers the ship. Crew recreation should be Low. It gets its own VLAN and subnet with no connections into the other zones, because personal laptops and downloaded games are the most likely way malware gets aboard. Mail from shore should go through a relay in a screened subnet.

**Answer key**

```ts
reflect: { text: { recommend: '<the sample answer above>' } },
```

---

### Step 11 `submit`: Review and submit

`kind: 'submit'`. Copy build-network's body:

```md
Look over your summary on the right. You can go back to any step and change an answer, then hand in your work again.
```

## Simulator and interface behaviors

The script relies on these. "This lab" means `segmentation` builds it (put logic in `src/sim/<feature>.ts`, per ARCHITECTURE). The rest come from other labs or already exist.

### This lab builds

**S1. VLANs on switch ports** (sim, `src/sim/vlan.ts`)

- `Iface.vlan?: number` on switch ports. Missing means VLAN 1.
- A frame that comes in a port in VLAN v leaves only through linked ports in VLAN v. That holds for broadcasts, flooding to unknown MACs, and known unicast. If the MAC table points at a port in another VLAN, treat the MAC as unknown and flood inside v.
- Changing a port's VLAN removes MAC table entries that point at that port.
- `sim.setVlan(devId, ifaceId, vlan)`: emits `config` (`what: 'vlan'`, `detail: 'p7=30'`). New SimAction `{ type: 'set-vlan'; device; iface; vlan }`.
- Ports that mac-flood shuts down still drop everything, whatever their VLAN.
- Unit tests in `src/sim/vlan.test.ts`: a broadcast stays in its VLAN; unicast to a MAC in another VLAN is not delivered; a VLAN change flushes that port's entries.

**S2. VLANs inspector section** (UI, `src/ui/inspector/Vlans.tsx`, slot `settings`)

- On switches. Shown when the student has the `vlan` tool or any port is not VLAN 1.
- Heading "VLANs". One row per port, including ports with no cable: port, device it leads to (or "no cable"), VLAN. With the tool, the VLAN is a select: `1`, `10 Weapons`, `20 Operations`, `30 Crew`. A change dispatches `set-vlan` right away.
- Message line after a change: `Port 7 (Crew laptop 1) is now in VLAN 30.` For a port with no cable: `Port 3 has no cable. Its VLAN still counts: whatever plugs in later lands in VLAN 10.`
- The MAC address table section gains a VLAN column (the VLAN of the entry's port). That is a one-column edit to `Dock.tsx`; skip it if it can't stay small.
- New `ToolSpec` kind `{ kind: 'vlan'; device: string }`, added to `SETTING_TOOLS`. `TOOL_NAME`: `VLANs (in the inspector)`.

**S3. VLAN-aware helpers** (shared, `src/runtime/toolInput.ts`)

- `segmentIfaces` must continue through a switch only via ports in the same VLAN as the port it came in on. Without this, step 5's address check warns that Fire control "shares this local network" with Crew laptop 1. Small additive change.
- `prelearnSwitch` and `macsBehind` are not used by this lab. Leave them.

**S4. Zone plan** (sim state plus a Toolkit card, `src/ui/tools/ZonePlan.tsx`)

- State: each inside device's planned zone, and each zone's level (`'high' | 'medium' | 'low'`). Stored in the sim so it replays and resets. Suggested: `Device.zone?: ZoneId` and a `Sim` field for levels, both typed from `src/sim/zones.ts`.
- SimActions: `{ type: 'set-zone'; device; zone: ZoneId | null }` and `{ type: 'set-zone-level'; zone: ZoneId; level: Level | null }`.
- `ToolSpec`: `{ kind: 'zone-plan'; devices: string[] }`. `TOOL_NAME`: `Zone plan`.
- Card (`tool-card defend`): a table of the listed devices with a Zone select (`Choose a zone`, Weapons, Operations, Crew), then the three zones with a Level select (`Choose a level`, High, Medium, Low). Changes apply right away. Messages are in step 3.

**S5. Map zones** (`map.zones` in the lab; rules in "Map zones" above)

- Reads the zone plan, switch VLANs, and infections. Only `MapZone` from wave 0 is needed.

**S6. Parallel cables** (shared, `src/ui/NetworkCanvas.tsx`)

- Three links join `fw` and `sw` from step 5 on. Today they would be drawn on top of each other, which looks like one cable.
- Draw links between the same two devices as one line with a small `×3` pill at its middle (class `pill`). Packets ride the shared line. Keep the change additive: group links by device pair before the link loop.
- The cable tool is never handed out in this lab, so `checkCable`'s "already connected" rule can stay.

**S7. Malware that spreads** (sim, `src/sim/malware.ts`)

- State: `Device.malware?: { at: number; from?: string; via: 'install' | 'file-share' }`.
- `sim.infect(devId)`: patient zero (`via: 'install'`). No-op if already infected.
- About 1.5 s after a host is infected, it starts a scan. Targets: every host other than itself with an address in 10.0.0.0/16, its own subnet first, then by ascending address. Hosts with no address (the Personal laptop before step 8) and the shore link are not targets. Skip a target that is already infected when its turn comes. (A real worm would knock anyway. Skipping keeps the map readable.)
- One probe about every 300 ms: a TCP connection attempt to port 445, through the firewall lab's service connection, so firewalls filter and log it. Mark the frames (`Frame.malware?: true`) and draw them red, like forged frames.
- A probe that reaches an uninfected host with file sharing open infects it (`via: 'file-share'`, `from` = the prober), and the host replies.
- Events: `{ type: 'malware-infected'; device; from?: string; via }` and `{ type: 'malware-done'; infected: string[] }`. `malware-done` fires once no infected host has targets left and its last probe has been answered, dropped, or timed out.
- `sim.cleanMalware()`: clears every infection and cancels pending scans. Use a generation counter so scheduled jobs from before the clean do nothing.
- No randomness. Same actions, same infections, same order.
- Frame budget: the flat network sends 7 probes plus about 6 skipped; the segmented network sends about 17. Probes are spaced, so a few frames are in flight at once.
- Unit tests in `src/sim/malware.test.ts`: the flat network ends with all eight infected and Fire control's `from` is `crew1`; a host without port 445 is never infected; `cleanMalware` stops a scan mid-way; replay gives the same order.

**S8. Malware on screen** (UI)

- Map: an infected device's card turns red (add class `infected` next to `attacker` in `NetworkCanvas.tsx`) and gets a badge, tone `bad`, title `Infected`. Add a `bug` icon to `icons.tsx`, or reuse `warn`.
- Inspector section `src/ui/inspector/Malware.tsx` (slot `settings`, infected hosts only), heading "Malware":
  - patient zero: `Infected. The game a sailor installed carried it.`
  - others: `Infected. The copy came from Crew laptop 1 (10.0.0.31) through file sharing, port 445.`
  - plus the time it arrived.
- Nice to have: a result line under the install button, like the ping and browser lines in `Lesson.tsx`: `The game is running on Crew laptop 1.`, then `The malware stopped. Infected: 3 of 8 computers.` Skip it if it needs more than a small additive hook.

**S9. Zone policy** (sim, `src/sim/zonePolicy.ts`, on the firewall engine; UI, `src/ui/inspector/ZonePolicy.tsx`)

- State on `fw`: a zone for each firewall port (p1 Weapons, p2 Operations, p3 Crew, p4 Shore) and a value for each ordered pair of inside zones: `'allow' | 'deny' | 'only:<port>'`. All start `'allow'`.
- SimAction `{ type: 'set-zone-policy'; device; from: ZoneId; to: ZoneId; value }`. `sim.setZonePolicy(...)` rewrites the firewall's rules.
- Rules it writes (stateful mode, so replies to allowed connections pass). Per pair: `allow` gives ALLOW all from A to B. `deny` gives DENY all. `only:p` gives ALLOW tcp to port p, then DENY all. Match A and B by the firewall port a packet arrives on and leaves by, if the engine supports that. Otherwise match by each zone's subnet (the network on its firewall port). Shore: DENY everything from shore to inside, ALLOW inside to shore. With the captain's orders, the rules are:
  1. ALLOW tcp Operations to Weapons port 5001
  2. DENY all Operations to Weapons
  3. ALLOW tcp Weapons to Operations port 5002
  4. DENY all Weapons to Operations
  5. DENY all Weapons to Crew
  6. DENY all Operations to Crew
  7. DENY all Crew to Weapons
  8. DENY all Crew to Operations
  9. DENY all Shore to inside
  10. ALLOW all inside to Shore
- Each rule carries a note like `Crew to Weapons`, so deny log lines and drop text can name the pair: log `fields.rule = 'Crew to Weapons'`; drop text `Core firewall blocked it. Its zone policy denies Crew to Weapons.`
- Inspector section on `fw`, heading "Zone policy", shown when the student has the `zone-policy` tool:
  - A 3 by 3 table. The rows say `From Weapons` and so on. The column headings are the zone names with the plan's level under them (`Weapons`, `High`).
  - Same-zone cells are greyed and read `Same zone`, with the tooltip `Traffic inside a zone never reaches the firewall.`
  - Other cells are selects: `Allow all`, `Deny`, and `Only <service> (port n)` for each service in the To zone: Weapons gets target data 5001 and file sharing 445; Operations gets status reports 5002, file sharing 445, and charts 443; Crew gets movies 80 and file sharing 445.
  - Under the table: `Shore link: nothing from shore may start a connection inside.`
  - Optional: a "Show the rules this writes" disclosure with the read-only rule list.
  - Message after a change: `Saved. Crew to Weapons: Deny.` If a Crew row cell is set to Allow all: `Saved. Crew laptops run games and downloads. Allow all lets anything on them reach Weapons.`
- `ToolSpec`: `{ kind: 'zone-policy'; device: string }`, added to `SETTING_TOOLS`. `TOOL_NAME`: `Zone policy (in the inspector)`.

**S10. Per-port address pin** (shared, `src/labs/types.ts` and `src/runtime/toolInput.ts`)

- Add `iface?: string` to the `ip-config` tool's `fixed` items. `checkAddress` applies a pin only when the device matches and, if `iface` is set, the port matches too. Without this, pinning `fw` would block edits to its other ports with the wrong message. Small additive change.

**S11. Lab actions.** Listed in each step.

### From `firewall` (wave 1)

- **F1. Services on hosts** (`Device.services`) and the inspector list of open ports with their names. Step 1 sends students to read it.
- **F2. Service connections:** a client connects to an IP and TCP port and gets a reply if the service is open. Success and failure must be visible to goal checks (events), and to students as a result line under the lesson button, for example `Connected to Fire control on port 5001 (target data).` or the firewall's drop text. Steps 6 and 8 and the malware (S7) use it.
- **F3. Firewall engine** on `fw`: ordered rules, stateful mode, a drop reason with student text, and deny log lines (`source: 'firewall'`) with `fields` `action`, `proto`, `src`, `sport`, `dst`, `dport`, `rule`. S9 writes its rules. If the engine can't match on arriving and leaving port, prefix matching is enough.
- **F4.** The firewall answers pings to its own port addresses, like any router.

### From `mac-flood` (wave 1)

- **M1. Shut down and turn on a switch port** by an admin: a shut port drops every frame in and out. The state is readable for the step 8 goal, there is an inspector control for it, and a `ToolSpec` kind hands it out. Whether the laptop sees "no link" or "no answer" doesn't matter. The `out` goal accepts any failure.
- Port security itself is only discussed (step 8 questions). It doesn't need to be handed out.

### Already in the app

- Logs tab, `{ kind: 'logs' }`, `openedLog`, `loggedSince`; `MapZone`; tool and inspector registries (wave 0).
- `ping`, `ip-config`, `gateway` tools; the browser and `web` sites; `prewarmArp`, `clearArp`; `pageSince`, `happened`, `inspected`.

## Lab tests (`lab.test.ts`)

1. Flat network: `install` infects all eight; Fire control's `from` is `crew1`; `fw` logs nothing.
2. Step 4 state: Crew laptop 1's ARP request reaches Crew laptop 2 and the media server and no port outside VLAN 30. The ping to Fire control fails with `arp-timeout`. The ping to the media server gets a reply.
3. Step 5 state with Allow all (backs the `predict` answer): `install` infects devices in Weapons and Operations, and every one of those infections crossed the firewall.
4. Step 6 policy: Command to Fire control on 5001 connects; Command to Fire control on 445 is denied and logged; Fire control to Command on 5002 connects; Crew laptop 1 to Fire control on 445 is denied and logged; replies come back.
5. Step 7: `install` infects Crew laptop 2 and the media server and nothing else; each of the three crew devices has at least one deny line; `malware-done` fires.
6. Step 8: Personal laptop reaches Fire control on 445 with port 3 up, and fails with port 3 shut.
7. Address check: with Weapons on 10.0.10.0/24, setting Crew laptop 1 to 10.0.30.31/24 gives no "shares this local network" note (S3). The `fw` p3 pin rejects 10.0.30.5/24, and `fw` p1 accepts 10.0.10.1/24 without the pin message (S10).
8. Reset network in step 7, then `install`, still gives the result in test 5.

## Concerns

- **Other labs' APIs.** The script names connection results, firewall log fields, and the port shutdown loosely. The implementer must map them to what `firewall` and `mac-flood` actually merge. The step 8 answer-key move is a placeholder.
- **Shared-file edits.** S3 and S10 (`toolInput.ts`, `types.ts`), S6 and S8 (`NetworkCanvas.tsx`, `icons.tsx`), and optionally S2's MAC table column (`Dock.tsx`) and S8's result line (`Lesson.tsx`). Each is small and additive, but S6 touches the link-drawing loop that other labs may also edit.
- **Gateway message in step 5.** If a student sets Crew laptop 1's gateway before giving the firewall's port 3 its address, `checkGateway` says "No router has an address on 10.0.30.0/24 ... Check Crew laptop 1's IP address first." Here the fix is the firewall's port. The body orders the steps to avoid this, and the `crew1` goal hint says so. A clause like "or give a router a port on that network" in `checkGateway` would fix it for every lab.
- **Levels after a reset.** Reset drops the student's step 3 choices, and later setups fill in Weapons High, Operations Medium, Crew Low. The map labels may change after a reset in step 4 or later. Answers and goals are unaffected.
- **Step 8 order.** The `in` goal needs the laptop to connect before the port is shut. A student who shuts it first has to turn it back on. The hint says so.
- **Busy steps.** Step 5 (four settings, two tests) and step 6 (six cells, four tests, five goals) are the longest, about six minutes each. The whole lab should run 40 to 45 minutes.
- **Map crowding.** About ten cables meet at the switch, which is why port tags are off. Check the 1366 x 768 window. If the zone labels overflow their rectangles, widen the padding before shortening the labels.
- **CED source.** Facts are checked against the paraphrases in COVERAGE.md and the plan, not the CED text itself. Scenario 3C details (the three LANs and the deliverable) come from the plan.
