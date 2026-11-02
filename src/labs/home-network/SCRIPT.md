# Who Gets the Packet? (`home-network`): lesson script

This is the full lesson as students see it: scenario, map, every step's body, buttons, tools, goals,
questions, and the behaviors the simulator must have. `index.ts`, `scenario.ts`, `solution.ts`, and the
DHCP and NAT features translate it.

Student text follows the lab's voice rules: short sentences, every term bold and defined on first use,
no em dashes, no emoji. `[[id]]` is a device chip. Button names are bold, exactly as labeled.

## What changed from PLAN.md

The plan stands. These are refinements of the step details:

- **Step 1 has a lesson button.** **Watch a packet** sends a test packet across the internet (school
  website to video site and back), so students try the speed and pause controls on something moving
  before any of the home works.
- **Step 3 offers WPA2 and WPA3 only (no Open).** An open access point runs as a hub in the simulator,
  which would undo step 6's lesson (the switch sends each packet only toward its device). The neighbor
  instead guesses common passwords, so a weak password lets the neighbor in. That keeps the "a password
  that's hard to guess" lesson without an open network.
- **Step 4 watches the TV rejoin.** By step 4 every device already has an address (the console and
  printer got theirs when plugged in, the family when they joined). **The TV restarts** makes the TV
  leave and rejoin, so students watch all four DHCP messages on one device, slowly. It gets the same
  address back, which sets up a question about how the router recognized it (its MAC address).
- **Step 5 prints, step 6 reuses the print job.** The print job's ARP question is step 6's broadcast
  example, read back in the capture. Step 6 adds **The phone prints a photo**: the laptop's capture shows
  the phone's ARP broadcast but not the photo, which is the switch lesson in one observation.
- **Step 8 sends both requests to the same site.** The phone asks for a cat video and the laptop for a
  math video, from the same server at the same moment. With the same far end, only the port number tells
  the answers apart, so the "how did it know" question has one honest answer.
- **The sites use plain HTTP**, so students can read each answer's page in the capture and see the laptop
  got its own. Step 8 says so in one sentence.
- **Devices know the sites' addresses** (a hosts file), so there is no DNS traffic. Step 7 says so.
- **No modem.** The router's internet port plugs straight into the provider. Step 2 says so.

CED: **3.1.B** (3.1.B.4 Wi-Fi reaches outside the building; 3.1.B.5 a network that doesn't check who
joins is easy to join), **3.2.B** (3.2.B.3 WPA2 and WPA3, WPA3 strongest), plus the prerequisite
networking vocabulary for the unit. CodeHS: `3.1 How Network Traffic Moves`. About 40 minutes, 11 steps.

---

## Scenario

The Nguyen family is getting internet at home. A new Wi-Fi router sits in the living room, not set up
yet. Inside the home: a laptop, a phone, and a smart TV (Wi-Fi), and a game console and a printer
(cables, not plugged in yet). Outside: the family's internet provider and the internet, with a video
site, a school website, and a stranger's computer. The neighbor's laptop sits next door, in Wi-Fi range.

Students set up the box (cables, then Wi-Fi), watch the router hand out addresses, follow packets inside
the home and out to the internet, and see how the router sends every answer to the device that asked,
and drops what nobody asked for.

---

## Map

Canvas 1000 x 600. Timings as in build-network (`linkMs 500`, `procMs 100`, `l2Ms 50`, `httpTimeoutMs
15000`, `arpTimeoutMs 4000`, `pingTimeoutMs 12000`), slow enough to follow every packet. ARP is real
(not prewarmed): step 6 reads it. `map: { ports: true, addresses: (d) => d.id !== 'isp', zones }`,
`labelMacs: true`, `hostRoutes: true`, `captureDevice: 'laptop'`.

| id | label | kind | icon | x, y | addresses and ports | notes |
|---|---|---|---|---|---|---|
| `router` | Router | router | router | 470, 290 | `home` 192.168.1.1/24 (built-in cable to `wifi`), `internet` 203.0.113.25/24 (free) | default route via 203.0.113.1; DHCP server on `home`, pool 192.168.1.10 to .99; NAT with `internet` outside |
| `wifi` | Switch and Wi-Fi | switch | wifi | 300, 290 | `inside` (built-in cable to `router`), `p1` to `p4` home ports (free) | access point: SSID `HomeRouter-4F2A`, WPA2, no password, power 2, **off** |
| `laptop` | Laptop | host | laptop | 110, 120 | gets its address by DHCP | Wi-Fi client (no network yet); the capture device (sees its own packets and broadcasts) |
| `phone` | Phone | host | phone | 280, 105 | DHCP | Wi-Fi client |
| `tv` | Smart TV | host | tv | 110, 290 | DHCP | Wi-Fi client |
| `console` | Game console | host | console | 130, 430 | DHCP | wired, unplugged |
| `printer` | Printer | host | printer | 300, 430 | DHCP | wired, unplugged; a print service on TCP 631 (IPP) |
| `neighbor` | Neighbor's laptop | host | laptop | 470, 540 | DHCP | Wi-Fi client outside the house, in range; never told the family's password |
| `isp` | Internet provider | router | isp | 740, 290 | `customer` 203.0.113.1/24 (free), `p1` 198.51.100.1/25, `p2` 192.0.2.1/24, `p3` 198.51.100.129/25 | addresses hidden on the map |
| `video` | Video site | host | server | 900, 130 | 198.51.100.20/25, gw .1 | web `video.example` (HTTP), pages `/cats` and `/fractions` |
| `school` | School website | host | server | 900, 290 | 192.0.2.30/24, gw .1 | web `school.example` (HTTP) |
| `stranger` | Stranger | host | desktop | 900, 450 | 198.51.100.200/25, gw .129 | sends the unsolicited packet in step 9 |

Hosts file: `video.example` 198.51.100.20, `school.example` 192.0.2.30.

Zones: **The Nguyens' home** (rect 30,40 to 630,480, neutral); **Wi-Fi router (one box)** (rect around
`router` and `wifi`, info); **Next door** (rect under the house around `neighbor`, neutral, dashed);
**The internet** (rect 660,40 to 980,560, neutral, dashed); **Wi-Fi reach** (dashed circle around `wifi`,
only while the Wi-Fi is on).

Addresses are handed out in the order devices ask: the console and printer get .10 and .11 (in the order
the student plugs them in), then the laptop .12, phone .13, TV .14. Text never hardcodes a home device's
address for that reason; the map, inspector, and capture show the real ones.

---

## Simulator behaviors

### DHCP (`src/sim/dhcp.ts`)

- A router interface can run a **DHCP server**: a pool (first and last address), the prefix, the gateway
  (the interface's own address), and a lease table of MAC, IP, device name, and time. A host set to get its
  address automatically is a **DHCP client**.
- When a client's link comes up (a cable plugged in, or a Wi-Fi join), it starts the four-message exchange
  after a short delay. When its link goes down, it drops its address and gateway.
- Messages are frames with `Frame.dhcp`. Discover and Request are broadcasts from 0.0.0.0 to
  255.255.255.255; Offer and Ack are sent to the client's MAC from the router. The switch floods
  broadcasts and learns the sender's MAC from every message, as it does for any frame.
- The server offers the address it already gave that MAC, if any; otherwise the lowest free address in the
  pool. An Ack sets the client's IP address, prefix, and default gateway.
- Events: `{ type: 'dhcp', what: 'discover' | 'offer' | 'request' | 'ack', device, client, ip? }`.
- Map markers: at the client, "asks for an address" (Discover), "takes 192.168.1.12" (Request); at the
  router, "offers 192.168.1.12" (Offer), "gives 192.168.1.12" (Ack); the existing "address set" on the
  client.
- Packet color: a new **DHCP** pill. Capture info: "Discover: can someone give me an IP address?",
  "Offer: you can have 192.168.1.12", "Request: I'll take 192.168.1.12", "Ack: 192.168.1.12 is yours".
  Details layer: the message in plain words, the device name, the address, and the gateway.
- Router log lines, `source: 'dhcp'`, as a home router writes them: `DHCPDISCOVER(home) 02:...`,
  `DHCPOFFER(home) 192.168.1.12 02:...`, `DHCPREQUEST(home) 192.168.1.12 02:...`,
  `DHCPACK(home) 192.168.1.12 02:... Laptop`, with `fields: { mac, ip, name }`.
- Inspector section **Connected devices** on a router with a DHCP server: one row per lease (device, MAC
  address, IP address, and how it's connected: Wi-Fi, cable, or not connected).

### NAT (`src/sim/nat.ts`)

- A router option: `nat: { outside }`. Packets the router forwards out its outside interface from any
  other address get the outside interface's address as their "from" address and a fresh **public port**
  (counting up from 50001, deterministic). Pings keep their ID (the sequence number) as the public number.
- The table records protocol, inside address and port, public port, and far end (address and port). An
  inbound packet to the outside address matches a line by protocol, public port, and far end; the router
  restores the inside address and port and forwards it in.
- An inbound packet to the outside address with no matching line drops with the new drop reason
  `unsolicited`, unless it answers the router's own traffic. Map marker "nobody asked: dropped". Router
  log line, `source: 'nat'`: `Blocked incoming TCP 198.51.100.200:49160 -> 203.0.113.25:3389, no matching
  connection` with `fields: { src, dst, proto, sport, dport, action: 'drop' }`.
- Port forwarding lines (`forwards`: public port to inside address and port) for later labs; this lab
  doesn't use them.
- Translated packets carry `IpPacket.nat` (the address and port before the change). The capture's IP layer
  then says: "The router changed the To address. On the internet, this packet went to 203.0.113.25 port
  50001. The router's address-sharing list said that's 192.168.1.12 port 49153."
- Events `{ type: 'nat', what: 'out' | 'in', device, entry }`. Map markers on the router: "sent as
  203.0.113.25:50001" (out), "answer for Phone" (in).
- Inspector section **Address sharing (NAT)** on a router with NAT: the public address, then one row per
  line (device, inside address and port, shared as public address and port, talking to).

### Wi-Fi setup (shared with the wireless model)

- A short **Wi-Fi setup** inspector section replaces the full Wi-Fi settings when the lab's `wifi-config`
  tool has `basic: true`: on/off, network name (SSID), WPA2 or WPA3, password. New sim method
  `setWifiSsid` and action `wifi-ssid`. Renaming disconnects devices that knew the old name.
- Turning the Wi-Fi on needs a password (the box won't start an unlocked network).
- `WifiClient.outsider`: the neighbor is never handed the family's password when it changes.

### Lesson buttons and their lines

Each button writes its own result lines under it (`ActionDef.outcome`).

---

## Step 1: Meet the network (`tour`)

**Focus:** `router`, `wifi`, `laptop`. **Tools:** none.

**Body:**

> The Nguyen family is getting internet at home. A new **Wi-Fi router** sits in their living room, not set
> up yet. Your job: set it up, connect the family's devices, and find out how it gets every message to the
> right device.
>
> A **network** is a group of devices that can send messages to each other. A **device** is anything on a
> network: a laptop, a phone, a printer. The devices in one home make a **home network**, also called a
> **LAN** (local area network). The **internet** is millions of networks connected together.
>
> On the map, the home is on the left and the internet is on the right. The Wi-Fi router is one box with
> two parts: [[router]] and [[wifi]].
>
> **How to use this app**
>
> - **Click a device** on the map to look inside it. What you find shows in the **Inspect** tab under the
>   map.
> - **Goals** are under this text. Each one checks itself and turns green when it's done. Stuck? Open its
>   **Hint**.
> - **Lesson buttons** make something happen on the network. Press **Watch a packet**. A colored tag runs
>   along the lines: a message on its way.
> - Above the map, **Pause** (the two bars) freezes everything, and **0.5×** to **4×** set the speed.
>   **Replay step** shows this step's traffic again. **Packet colors** says what each color means.
> - The tabs under the map: **Inspect** shows the device you clicked. **Capture** lists every packet the
>   laptop sees (none yet). **Toolkit** holds the tools a step gives you.
> - **Questions** come after the goals. Pick an answer and press **Check**. When everything is done,
>   press **Continue**.

**Button:** **Watch a packet**: the school website pings the video site. Lines: "The packet is on its
way…" then "The video site answered the school website."

**Goals:**

- `router`: Open [[router]]
- `wifi`: Open [[wifi]]
- `laptop`: Open [[laptop]]
- `packet`: Watch a packet cross the internet and come back. Hint: "Press **Watch a packet**. The school
  website sends a test message to the video site, and the video site answers." Check: a ping reply at
  `school` from the video site since the step started.

**Question `router-job` (choice):** What does the Nguyens' Wi-Fi router connect?

- (correct) Home devices to each other, and the home to the internet
- Only the devices that use Wi-Fi, not the wired ones. Feedback: "Look at [[wifi]]: it has numbered ports
  for cables too. Wired devices connect to the same box."
- The video site to the school website, across the internet. Feedback: "Those two are out on the
  internet. They talk without the Nguyens' router, as the test packet showed."
- Each device in the home straight to the internet provider. Feedback: "Every device in the home goes
  through the box. The devices also talk to each other, like the laptop to the printer."

Explain: "The box does two jobs. Its switch and Wi-Fi part connects the devices in the home to each other.
Its router part connects the whole home network to the internet."

---

## Step 2: Plug in the cables (`cables`)

**Focus:** `console`, `printer`, `router`, `isp`. **Tools:** `cable` (with refusals).

**Body:**

> Some devices connect with a **cable**. A cable plugs into a **port**, a socket on a device. The game
> console and the printer use cables.
>
> [[wifi]] has four numbered **home ports**, for devices in the home. [[router]] has one **internet port**.
> The cable from the family's **internet provider** (the company that connects homes to the internet, also
> called an **ISP**) goes there, and nothing else does: it leads out of the home.
>
> Plug in three cables:
>
> - [[console]] into a home port on [[wifi]]
> - [[printer]] into a home port on [[wifi]]
> - [[router]]'s internet port into [[isp]]
>
> Drag from one device to the other on the map, or use **Cables** in the **Toolkit** tab. To unplug a
> cable, click it on the map.
>
> Watch [[console]] after you plug it in. It sends its first packets right away. Step 4 explains them.
>
> (Many homes have one more box, a modem, between the router and the provider. Here the router plugs
> straight in.)

**Cable refusals** (the drag and the Cables card show these and plug nothing in):

- console or printer to `router`: "That's the router's internet port. It leads out of the home. Plug the
  {Game console} into a home port on the Switch and Wi-Fi."
- console or printer to `isp`: "The internet provider is outside the home. Plug the {Game console} into a
  home port on the Switch and Wi-Fi."
- `isp` to `wifi`: "The internet provider's cable goes into the router's internet port. Home ports are for
  devices in the home."
- `router` to `wifi`: "The router and the Switch and Wi-Fi are already joined inside the box. The router's
  free port is its internet port, for the internet provider."
- `console` to `printer`: "Plug each device into the Wi-Fi router, not into each other."
- laptop, phone, or TV to anything: "The {Laptop} uses Wi-Fi. It connects in the next step."
- `neighbor` to anything: "That's the neighbor's laptop, next door. It isn't part of this home."

**Goals:**

- `console`: Plug [[console]] into a home port on [[wifi]]. Hint: "Drag from the game console to the
  Switch and Wi-Fi. The cable goes into the next free home port."
- `printer`: Plug [[printer]] into a home port on [[wifi]]. Hint: same shape.
- `uplink`: Plug [[router]]'s internet port into [[isp]]. Hint: "Drag from the router to the internet
  provider. The router's only free port is its internet port."

**Question `wired` (choice):** The laptop, phone, and TV will use Wi-Fi instead of cables. What's one real
difference?

- (correct) Wi-Fi goes through the air, so anyone nearby can hear it
- Only devices on a cable can reach the internet at all. Feedback: "Wi-Fi devices reach the internet
  through the same box as wired ones. Both ways lead to [[wifi]]."
- A cable sends messages one way, so it needs a second cable back. Feedback: "Every cable carries messages
  both ways. The console sends and receives on the same cable."
- Wired devices don't need an address to get messages. Feedback: "Every device needs an address, wired or
  not. Step 4 shows how they get one."

Explain: "A cable's signal stays inside the cable. Wi-Fi is radio: it goes through walls, out to the yard,
and next door. That's why Wi-Fi needs a password."

---

## Step 3: Turn on the Wi-Fi (`wifi`)

**Focus:** `wifi`, `neighbor`. **Tools:** `wifi-config` on `wifi`, `basic: true`.

**Body:**

> **Wi-Fi** connects devices by radio instead of a cable. [[wifi]] is the home's **access point**: the
> radio that Wi-Fi devices talk to.
>
> Radio goes through walls. This Wi-Fi reaches the yard, the street, and [[neighbor]] next door. So a home
> network needs a lock:
>
> - A **Wi-Fi password** that only the family knows. A device must know it to join.
> - **WPA2** or **WPA3** security. Both check the password, and both **encrypt** (scramble) everything
>   sent over the air, so a listener can't read it. WPA3 is newer and harder to break.
>
> Click [[wifi]] and find **Wi-Fi setup** in the Inspect tab:
>
> 1. Give the network a name. Devices see this name, the **SSID**, when they look for Wi-Fi.
> 2. Pick WPA2 or WPA3, and save a password of at least 8 characters.
> 3. Turn the Wi-Fi on.
>
> Then press **The family joins**. The laptop, phone, and TV join, and each one sends its first packets.
> Last, press **The neighbor tries to join**. The neighbor will guess common passwords.
>
> (In real life, each person types the password on their own device. Here, **The family joins** types it
> for them.)

**Wi-Fi setup section** (basic mode): Wi-Fi on/off toggle; Network name (SSID) with Save; Security: WPA2,
WPA3; Password with Save. Messages:

- Turning on with no password: "Save a password first. The box won't start a Wi-Fi network that anyone can
  join."
- Name saved: "Saved." If devices were on the old name: "Saved. Devices that knew the old name drop off
  until they join the new one."
- Name check: 1 to 32 characters, letters, numbers, spaces, dashes, and underscores.
- Password: the existing passphrase check (8 or more characters, no spaces; a note under 12).

**Buttons:**

- **The family joins**: the laptop, phone, and TV take the current name and password and join. Lines per
  device: "Laptop joined Nguyen Home and got an address." / "Laptop joined Nguyen Home. Asking for an
  address…" / "Laptop found no Wi-Fi network to join. Is the Wi-Fi on?"
- **The neighbor tries to join**: the neighbor tries `12345678`, `password`, `password1`, `qwerty123`,
  `nguyen123`, `nguyenhome` against the current network. Lines: "The neighbor's laptop tried 6 common
  passwords. None worked, so it can't join." / "The neighbor's laptop guessed the password and joined. Pick
  one that's harder to guess." / "The neighbor's laptop found no Wi-Fi network to join."

**Goals:**

- `name`: Give the Wi-Fi network a name. Hint: "Click [[wifi]]. Type a name under **Network name** and
  press **Save**." Check: SSID isn't the factory name.
- `secure`: Turn on the Wi-Fi with WPA2 or WPA3 and a password. Hint: "In **Wi-Fi setup**, pick WPA2 or
  WPA3, save a password of 8 or more characters, then switch the Wi-Fi on."
- `family`: [[laptop]], [[phone]], and [[tv]] join the Wi-Fi. Hint: "Press **The family joins** once the
  Wi-Fi is on. If you rename the network, press it again: the devices only know the old name."
- `neighbor`: [[neighbor]] tries to join and is turned away. Hint: "Press **The neighbor tries to join**.
  If the neighbor gets in, your password was easy to guess. Save a longer one and try again." Check: a
  refused join for the neighbor this step, and the neighbor isn't on the network.

**Question `walls` (choice):** The Nguyens' Wi-Fi is inside their house. Why does it still need a password?

- (correct) Its radio goes through walls, so people nearby can try to join
- A password makes the Wi-Fi signal reach farther outside. Feedback: "A password doesn't change how far the
  signal goes. The radio's strength does. The password decides who may join."
- Without one, the family's own devices can't join. Feedback: "A network with no password lets anyone
  join, the family included. The password keeps everyone else out."
- The internet provider checks it before letting the home online. Feedback: "The internet provider never
  sees your Wi-Fi password. It guards only the radio in your home."

Explain: "Wi-Fi goes wherever its radio reaches: through walls, into the yard, next door. With WPA2 or WPA3
and a password that's hard to guess, only devices that know it can join, and what they send is scrambled
for anyone listening."

---

## Step 4: Everyone gets an address (`addresses`)

**Focus:** `tv`, `router`, `phone`. **Tools:** none. **Setup:** make sure the cables and the family's Wi-Fi
are in place (keep the student's name and password).

**Body:**

> To get a message, a device needs an address, the way a house needs one for mail. Every device here has
> two:
>
> - A **MAC address** is built into the device's network hardware at the factory. It's like your name: it
>   stays the same wherever the device goes. It looks like `02:00:00:00:00:21`.
> - An **IP address** is the device's address on this network. It's like a mailing address: join a
>   different network, and you get a different one. It looks like `192.168.1.12`.
>
> The router hands out the IP addresses. When a device joins, it asks for one, and the router picks a free
> address and writes it down. This is called **DHCP**. It takes four messages:
>
> 1. **Discover.** The device, to everyone: "I'm new here. Can someone give me an IP address?"
> 2. **Offer.** The router: "You can have this one."
> 3. **Request.** The device: "I'll take it."
> 4. **Ack** (short for acknowledge). The router: "It's yours. And I'm your way out to the internet."
>
> Press **The TV restarts**. Set the speed to **0.5×** and watch the TV get its address again.
>
> Then click [[router]] and find **Connected devices**: every device's name, MAC address, and IP address.
> Click [[phone]] too, and check that its addresses match its line in the list.
>
> (Some phones make up a new MAC address for each network, for privacy. Here, every device keeps its own.
> Real devices also often skip to Request when they rejoin. Here, they always send all four messages.)

**Button:** **The TV restarts**: the TV leaves the Wi-Fi (dropping its address), then joins again two
seconds later. Lines: "The TV is restarting…" / "The TV is back and asking for an address…" / "The TV got
the address 192.168.1.14 again."

**Goals:**

- `tv`: Watch [[tv]] ask for an address and get one. Hint: "Press **The TV restarts**. The TV leaves the
  Wi-Fi, joins again, and sends the four DHCP messages." Check: a DHCP Ack for the TV this step.
- `router`: Find **Connected devices** on [[router]]. Hint: "Click the router on the map. Scroll down in
  the Inspect tab."
- `phone`: Open [[phone]] and compare its addresses.

**Question `who` (choice):** Which of the phone's two addresses did the router hand out?

- (correct) Its IP address
- Its MAC address. Feedback: "The MAC address was built into the phone's Wi-Fi hardware at the factory. The
  router only read it and wrote it down."
- Neither. The phone picked its own. Feedback: "The phone asked with DHCP, and the router offered the
  address. Look back at the four messages."
- Both of them (last). Feedback: "Only one came from the router. The other was in the phone before it ever
  joined."

Explain: "The MAC address came with the phone. The IP address came from the router when the phone joined,
through DHCP. The router's Connected devices list pairs the two."

**Question `same` (choice, after goals):** The TV got the same IP address as before. How did the router
know it was the TV?

- (correct) It found the TV's MAC address in its list
- The TV told the router its old IP address. Feedback: "The TV had no IP address when it asked. Its
  Discover came from 0.0.0.0, which means "no address yet." What else was on it?"
- It read the name "Smart TV" on the message. Feedback: "Names repeat: lots of homes have a "Smart TV."
  The router goes by the MAC address, which belongs to this TV's hardware."
- It didn't. The TV got that address by chance. Feedback: "The TV's line was already in Connected devices.
  The router gave back the address it had saved for that MAC address."

Explain: "The router's list pairs each MAC address with the IP address it handed out. When the same MAC
address asks again, the router hands back the same IP address."

---

## Step 5: Packets (`packets`)

**Focus:** `laptop`, `printer`. **Tools:** none. **Open:** Capture tab.

**Body:**

> Messages don't travel in one piece. They're cut into small pieces called **packets**. Each packet
> carries a "from" address and a "to" address, like an envelope. A big file, like a homework page, takes
> many packets. (The map draws this print job as one packet, to keep it clear.)
>
> Press **Print the homework**. Watch the laptop's packets go over the Wi-Fi to [[wifi]], then down the
> cable to [[printer]]. Print packets are marked PRINT. The laptop first asks who the printer is; step 6
> explains that part.
>
> The **Capture** tab lists every packet the laptop sends or receives. Click a print packet to open it,
> and find:
>
> - **From IP** and **To IP**: the IP addresses of the device that sent it and the device it's for.
> - **From MAC** and **To MAC**: the same two devices, by MAC address.
>
> Skip the other lines for now.

**Button:** **Print the homework**: the laptop sends `homework.pdf` to the printer (a connection to the
printer's print service). Lines: "Sending the homework to the printer…" / "The printer got the homework
and printed it." / "The homework didn't reach the printer."

**Goals:**

- `printed`: [[printer]] prints the homework. Hint: "Press **Print the homework**. It takes a few
  seconds." Check: the laptop's print connection succeeded this step.
- `opened`: Open a print packet in the **Capture** tab. Hint: "Open the Capture tab and click a row marked
  PRINT. Its details open next to the list."

**Question `to-address` (choice, after goals):** What is the print packet's To IP address for?

- (correct) It tells the network which device should get it
- It tells the printer who sent the homework. Feedback: "That's the From address. The printer reads it to
  know where to send its answer."
- It says how big the homework file is. Feedback: "Addresses say where a packet goes, not what's inside."
- It names the Wi-Fi network the packet uses. Feedback: "The Wi-Fi network has a name, but packets carry
  device addresses. This To IP is the printer's."

Explain: "Like the address on an envelope, the "to" address tells every part of the network where the
packet is going. The "from" address tells the receiver where to send its answer."

---

## Step 6: Who's where (`switch`)

**Focus:** `wifi`, `phone`, `printer`. **Tools:** none.

**Body:**

> To send its packets, the laptop needed the printer's MAC address. It only knew the printer's IP address.
> So it asked every device at once: "Who has this IP address?" A message to every device at once is a
> **broadcast**. Only the printer answered: "That's me. Here's my MAC address." This question and answer is
> called **ARP**. Both are in the laptop's Capture tab, marked ARP.
>
> How does [[wifi]] know where to send each packet? It reads the "from" MAC address on every packet it gets,
> and writes down where that packet came in: which home port, or Wi-Fi. That list is its **MAC address
> table**. When a packet comes for that MAC address, the switch sends it only that way.
>
> Press **The phone prints a photo**. Then look at the laptop's Capture tab. What did the laptop hear?
>
> Click [[wifi]] and find its MAC address table. Find the printer's port.

**Button:** **The phone prints a photo**: the phone sends `photo.jpg` to the printer. Lines as in step 5,
with "photo".

**Goals:**

- `photo`: [[phone]] prints a photo. Hint: "Press **The phone prints a photo**."
- `table`: Find the printer in [[wifi]]'s MAC address table. Hint: "Click the Switch and Wi-Fi. The table
  lists each MAC address and the port it's on."

**Question `missing` (choice, after goals):** The laptop's capture shows the phone asking "Who has…?" but
not the photo. Why not?

- (correct) The question went to everyone. The photo went only to the printer.
- The laptop is too far from the phone to hear it. Feedback: "The laptop heard the phone's question, so
  distance isn't it."
- The photo was scrambled, so the laptop threw it away. Feedback: "A scrambled packet would still show in
  the capture, as gibberish. The photo never reached the laptop at all."
- The switch didn't know where the printer was yet. Feedback: "It did: the printer's MAC address was already
  in its table. So the switch sent the photo straight out the printer's port."

Explain: "A broadcast goes to every device. Everything else goes only toward the device it's for: the
switch looks up the "to" MAC address in its table and sends the packet out that one port."

**Question `learned` (choice):** How did the switch learn which port leads to the printer?

- (correct) It read the "from" MAC address on a packet the printer sent
- You told it when you plugged in the printer's cable. Feedback: "You only plugged in a cable. The switch
  learned the rest by itself, from the printer's packets."
- The printer's IP address has the port number in it. Feedback: "An IP address doesn't say which port a
  device is on. The switch works with MAC addresses."
- The router sent it a list of every device in the home. Feedback: "The router hands out IP addresses, but
  it doesn't tell the switch where devices are."

Explain: "Every packet carries its sender's MAC address. When the printer sent its first packet, the switch
saw that MAC address come in on the printer's port and wrote it down."

---

## Step 7: Out to the internet (`internet`)

**Focus:** `phone`, `router`, `isp`, `video`. **Tools:** none.

**Body:**

> The phone wants a video from [[video]], out on the internet. The site's IP address, 198.51.100.20, doesn't
> start with 192.168.1, so it isn't in the home.
>
> Every device follows one rule:
>
> - If the "to" address is on the home network (here, it starts with 192.168.1), send the packet straight
>   to that device.
> - If not, send it to the **default gateway**: the way out of the home. That's [[router]], at 192.168.1.1.
>   The router said so in its DHCP Ack.
>
> The router checks the "to" address too. A home address goes back inside. Anything else goes out the
> internet port to [[isp]], and the internet carries it on to the site.
>
> Click [[phone]] and find its default gateway. Then press **Phone opens the video site** and follow the
> packets out of the home and back.
>
> Watch [[router]] as the request leaves. It changes something on the packet. The next step explains what.
>
> (Real devices first look up a site's IP address from its name. Here, they already know it.)

**Button:** **Phone opens the video site**: the phone's browser opens `http://video.example/cats`. Lines:
the browser's usual lines ("Phone's browser: loading…" / "Phone's browser: loaded "Funny cats, part 3".").

**Goals:**

- `gateway`: Open [[phone]] and find its default gateway. Hint: "Click the phone. The default gateway is in
  the Inspect tab."
- `video`: The video loads on [[phone]]. Hint: "Press **Phone opens the video site**. The page pops up next
  to the phone."

**Question `sort` (choice, multi):** The phone has packets for these "to" addresses. Which ones does it send
to its default gateway? Pick all that apply.

- (correct) 198.51.100.20
- (correct) 192.0.2.30
- 192.168.1.11. Feedback: "192.168.1.11 starts with 192.168.1, so it's on the home network. The phone sends
  it straight there."
- 192.168.1.12. Feedback: "192.168.1.12 is a home address. The phone delivers it itself, without the
  router."

Explain: "Home addresses here all start with 192.168.1, and the phone delivers those itself. Everything
else goes to the default gateway to leave the home, even 192.0.2.30, which also starts with 192."

---

## Step 8: One address for the whole home (`nat`)

**Focus:** `router`, `phone`, `laptop`, `video`. **Tools:** none.

**Body:**

> The internet provider gives the whole home one address on the internet, its **public address**:
> 203.0.113.25, on the router's internet port.
>
> Addresses that start with 192.168 are **private addresses**. Millions of homes use the same ones, so the
> internet can't deliver to them. Out on the internet, a packet needs the home's public address.
>
> So the router swaps addresses. When a packet leaves the home, the router:
>
> 1. Replaces the device's private "from" address with the home's public address.
> 2. Gives the packet a tracking number, and writes a line in its list: which device sent it, with which
>    number, to whom.
>
> The tracking number is called a **port number**. That's a second meaning of "port": a number on a packet,
> not a socket for a cable. When an answer comes back to that number, the router finds the line, puts back
> the device's private address, and sends the answer to the device that asked. This is **NAT** (network
> address translation).
>
> It works like mail to an apartment building. Every letter has the same street address, and the apartment
> number tells the front desk whose it is.
>
> Press **Phone and laptop browse at once**. Both ask the same video site for different videos at the same
> moment. Then open the laptop's answer in the **Capture** tab: its details show how the router changed
> its "to" address. Last, click [[router]] and find **Address sharing (NAT)**.
>
> (These sites use plain HTTP, so you can read their pages in the capture. Real sites use HTTPS, which
> scrambles them.)

**Button:** **Phone and laptop browse at once**: the phone opens `http://video.example/cats` and the laptop
`http://video.example/fractions`, at the same moment. Lines: both browsers' lines.

**Goals:**

- `both`: [[phone]] and [[laptop]] each get their own video. Hint: "Press **Phone and laptop browse at
  once**. Watch the router send each answer to the device that asked." Check: the phone loaded "Funny cats,
  part 3" and the laptop "Fractions, explained", this step.
- `answer`: Open the laptop's answer in the **Capture** tab. Hint: "In the Capture tab, click the newest
  HTTP row from 198.51.100.20. Read the note under the IP packet." Check: the student opened a captured
  answer the router translated.
- `table`: Find **Address sharing (NAT)** on [[router]] after both answers arrive. Hint: "Click the router.
  Each line is one device's conversation with the video site." Check: the router opened after both pages
  loaded.

**Question `match` (choice):** Both answers came to the home's public address, 203.0.113.25. How did the
router know which one was the phone's?

- (correct) Each answer's port number matched a line in its list
- The phone's private address was on the answer. Feedback: "On the internet, the answer's "to" address was
  the home's public address. The phone's private address never left the home."
- It sent both answers to both devices. Feedback: "Then the laptop would get a cat video it never asked
  for. Check the capture: the laptop got only its own answer."
- The phone's MAC address was on the answer. Feedback: "MAC addresses travel only inside one network. The
  video site never learns the phone's MAC address."

Explain: "The router gave each request its own port number and wrote down which device sent it. The answers
came back to those numbers, so the router looked up who asked."

---

## Step 9: Nobody asked for this (`stranger`)

**Focus:** `stranger`, `router`. **Tools:** `logs` on `router`.

**Body:**

> The list protects the home, too. A packet from the internet gets in only if it answers something a
> device in the home sent.
>
> Press **A stranger knocks**. [[stranger]], out on the internet, sends a packet to the home's public
> address. Nobody in the home asked for it, so the router's list has no line for it. The router **drops**
> it: it throws the packet away.
>
> The router writes what it did in its **log**, a list of events with the time of each. Open the **Logs**
> tab and click the line about the dropped packet.
>
> Some games ask you to set up **port forwarding**: a line you add to the list by hand, so packets for one
> port number go to one device even when nobody asked. That opens a door on purpose, so add one only when
> you need it.
>
> (Address sharing is not a full firewall. A later lab builds one.)

**Button:** **A stranger knocks**: the stranger connects to 203.0.113.25 port 3389. Lines: "The stranger's
packet is on its way…" / "The router dropped the stranger's packet. Nobody in the home asked for it."

**Goals:**

- `dropped`: [[router]] drops the stranger's packet. Hint: "Press **A stranger knocks** and watch the
  router." Check: an `unsolicited` drop at the router this step.
- `log`: Open the router's log line about it. Hint: "Open the Logs tab and click the line that starts with
  Blocked."

**Question `why` (choice):** Why did the router drop the stranger's packet?

- (correct) It matched no line in the list: nobody inside asked for it
- The stranger didn't know the Wi-Fi password. Feedback: "The packet came in through the internet port, not
  over Wi-Fi. The Wi-Fi password guards only the radio."
- It was sent to the wrong address. Feedback: "The address was right: 203.0.113.25 is the home's public
  address. That's how it reached the router."
- The devices in the home were all turned off. Feedback: "The laptop, phone, and TV were on. The router
  never passed the packet to any of them."

Explain: "The router lets in answers to packets that left the home. The stranger's packet answered nothing,
so no line in the list said where it should go."

**Question `protect` (choice):** How does this protect the laptop, phone, and TV?

- (correct) Strangers on the internet can't start a conversation with them
- It hides the home's public address from everyone. Feedback: "The stranger knew the public address, and
  the packet reached the router. What it couldn't reach was a device inside."
- It blocks every packet that comes from the internet. Feedback: "Answers to the family's own requests get
  through, like the videos in step 8."
- It scrambles their packets so nobody can read them. Feedback: "That's what WPA2 and WPA3 do on the Wi-Fi.
  Address sharing doesn't scramble anything."

Explain: "A device in the home can reach out, and the answers come back in. Nobody outside can reach in
first. That's one reason home devices are hard to reach from the internet."

---

## Step 10: Reflect (`reflect`)

**Body:**

> Look back at how the box sends every packet to the right place. The router hands out addresses, the
> switch sends each packet toward its device, and the router shares one public address with the whole home.

**Question `answer-path` (text, teacher-graded, `minWords: 40`, 5 lines):** Explain how an answer from the
internet reaches the right device in the home. Use the words public address, port number, and private
address.

---

## Step 11: Review and submit (`submit`)

`kind: 'submit'`. Body as in build-network: "Look over your summary on the right. You can go back to any
step and change an answer, then hand in your work again."

---

## Answer key (`solution.ts`)

1. Inspect router, wifi, laptop; press **Watch a packet**; answer.
2. Cables: console to wifi, printer to wifi, router to isp.
3. `wifi-ssid` "Nguyen Home"; `wifi-security` wpa3; `wifi-passphrase` "sunflower-kitchen-42"; `wifi-off`
   false; press **The family joins**; press **The neighbor tries to join**.
4. Press **The TV restarts**; inspect router, phone.
5. Press **Print the homework**; open a print frame in the capture.
6. Press **The phone prints a photo**; inspect wifi.
7. Inspect phone; press **Phone opens the video site**.
8. Press **Phone and laptop browse at once**; open the laptop's translated answer; inspect router.
9. Press **A stranger knocks**; open the router's `nat` log line.
10. Text answer.

## Lab tests (`lab.test.ts`)

- A device that joins gets the next address in the pool (and the same one again when it rejoins).
- Two devices browsing at once each get their own answers, through two NAT lines with different public
  ports.
- An unsolicited inbound packet drops with reason `unsolicited` and a router log line.
- Replay is identical (the walkthrough checks every lab; this lab's test replays its answer key too).
- Cable refusals: a home device into the internet port is refused with the lab's message.
