# Who Gets the Packet? (`home-network`)

Status: built. Code: `index.ts` (steps), `scenario.ts` (network and buttons), `solution.ts` (answer key), `lab.test.ts`; script in `SCRIPT.md`.

Tagline: Set up a family's Wi-Fi router, connect their devices, and watch the router deliver every message to the right one.

The first lab in the series. It assumes no networking knowledge at all, and it is the foundation the later labs build on, so it teaches the core vocabulary and the interface from the ground up. It stays shallow on purpose: one clear idea per step, in basic terms, with an everyday comparison where it helps. `build-network` (From Cable to Web Page) moves to second place and goes deeper: typing addresses by hand, routes between networks, troubleshooting.

CodeHS: `3.1 How Network Traffic Moves`. CED: prerequisite networking, plus Wi-Fi passwords and WPA2/WPA3 (3.2) and inbound traffic nobody asked for (3.1.B). Check the CED pages in `docs/unit3/COVERAGE.md` and list only LOs the lab really touches.

About 40 minutes, 11 steps.

## What students learn (in these words, roughly)

- A **network** is devices that can send messages to each other. A **home network** (a **LAN**, local area network) is the devices in one home. The **internet** is many networks connected together.
- Messages travel in small pieces called **packets**. Every packet carries a "from" address and a "to" address, like an envelope.
- A home **Wi-Fi router** is several jobs in one box: a **Wi-Fi access point** (connects devices by radio), a **switch** (connects devices by cable, and passes messages between devices in the home), and a **router** (connects the home network to the internet). Here, the box is drawn as two parts inside one outline: the router, and the switch with Wi-Fi.
- Devices connect by **cable** (plugged into a numbered port on the box) or by **Wi-Fi** (radio). The box's **internet port** is different from the home ports.
- Wi-Fi travels through walls, so anyone nearby can hear it. A **Wi-Fi password** with **WPA2** or **WPA3** security keeps strangers off the network and scrambles what it carries.
- Every device has a **MAC address** built into its network hardware (a name tag that comes with the device). On the home network, the router hands each device an **IP address** when it joins (its address on this network). Handing out addresses automatically is called **DHCP**.
- The switch learns where each device is (which port, or Wi-Fi) from the "from" address on packets it receives, and sends each packet only toward the device it's for.
- To find a device's MAC address from its IP address, a device asks the whole room at once (a **broadcast**: "Who has 192.168.1.20?"). Only that device answers. (This is ARP; name it, don't dwell on it.)
- A packet for an address outside the home goes to the router, the home's **default gateway** (the way out). The router checks the "to" address: home address, deliver it inside; anything else, send it to the **internet provider** (ISP).
- The internet provider gives the whole home **one public address**. The router swaps each device's private address for that shared one on the way out, and writes down who asked (a tracking number, called a port number, tells the answers apart). When the answer comes back, it checks its list and sends the answer to the device that asked. This is **NAT** (network address translation). This is the heart of "who gets the packet."
- Something from the internet that no device asked for has no line in the list, so the router drops it. That's one reason devices at home can't be reached from the internet by default.

Use "port" only for the physical ports on the box until the NAT step, then say once that the tracking number is also called a port number, a different meaning of the same word.

## Scenario and map

The Nguyen family just got internet. A new Wi-Fi router sits in the living room, unconfigured. Inside the home: a laptop, a phone, a smart TV (all Wi-Fi), a game console and a printer (both wired, not plugged in yet). Outside: the family's internet provider and the internet, with a video site and a school website (two servers). A neighbor's laptop sits outside the house, in Wi-Fi range.

Map zones: the house, the Wi-Fi router outline around its two parts, and the internet. Wi-Fi links drawn as the wireless lab draws them.

## Step outline

1. **Meet the network**: tour, and how to use the app: click a device to look inside it, press lesson buttons, watch packets move (speed and pause controls), check goals, answer questions. What a network, a device, and the internet are. Open the Wi-Fi router's two parts and the laptop. Question: what the Wi-Fi router connects.
2. **Plug in the cables**: plug the game console and the printer into home ports, and the router's internet port into the internet provider. Feedback when a home device goes into the internet port. Goal: three cables in the right places. Question: wired vs. Wi-Fi.
3. **Turn on the Wi-Fi**: name the network and set a password with WPA2 or WPA3 (Wi-Fi settings in the inspector). Press **The family joins**: the laptop, phone, and TV connect. Press **The neighbor tries to join**: refused. Goals: security on with a password, family joined, neighbor refused. Question: why the password matters even inside a home.
4. **Everyone gets an address**: watch a device join and ask for an address (the four DHCP messages, labeled in plain words). Open the router's **Connected devices** list: each device's name, MAC address, and IP address. Goal: open the list; find the phone's addresses. Questions: MAC vs. IP; who handed out the address.
5. **Packets**: press **Print the homework**. The laptop's print job crosses the Wi-Fi, then the cable to the printer. Open one of its packets (Capture tab, or however reads best) and read its "from" and "to" addresses. Goal: open a print packet. Question: what the "to" address is for.
6. **Who's where**: before the laptop could send to the printer, it asked the whole room "Who has 192.168.1.x?" and only the printer answered. Open the switch part's list of which device is on which port or on Wi-Fi. Press **TV plays a show** or similar to show a message going only to its device. Goal: find the printer's port in the list. Question: how the switch learned where the printer is.
7. **Out to the internet**: press **Phone opens the video site**. The "to" address isn't in the home, so the phone sends it to the router, its default gateway, and the router sends it to the internet provider. Sorting question: for several "to" addresses, inside the home or out to the internet. Goal: the video loads.
8. **One address for the whole home**: press **Phone and laptop browse at once**. Both requests leave with the home's one public address. Open the router's **address sharing (NAT)** list and match each answer to the device that asked. Goal: open the list while both entries are there (or a goal that checks the student opened it after both answers came back). Question: how the router knew the video was for the phone.
9. **Nobody asked for this**: press **A stranger knocks**: a packet from the internet arrives for the home's public address with no line in the list, and the router drops it. Read the router's log line. Goal: see the drop. Questions: why the router dropped it; why that protects the devices inside. One sentence on port forwarding (opening that door on purpose for a game, a risk).
10. **Reflect**: written, about 40 words: explain how an answer from the internet reaches the right device in the home.
11. **Submit**.

## Core features this lab owns

- **DHCP** (`src/sim/dhcp.ts`): a router can run a DHCP server for one of its interfaces (a pool of addresses, a lease table of MAC, IP, device name, and time). A host set to get its address automatically asks when its cable comes up or when it joins Wi-Fi: Discover (broadcast), Offer, Request, Ack, drawn as frames with plain labels and a packet color. Log lines with `source: 'dhcp'`. Inspector section on the router: Connected devices.
- **NAT** (`src/sim/nat.ts`): a router option that shares its outside interface's address. Outbound packets from inside get the outside address and a fresh public port number (deterministic); the table records inside address and number, public number, and the far end. Replies are translated back. Unsolicited inbound packets drop with a new `DropReason` and plain student text. Handle pings sensibly (the ICMP echo id can stand in for the number) or keep pings inside the home. Inspector section on the router: Address sharing (NAT). Make the before-and-after addresses visible somewhere students look (packet details or capture). Design it so the firewall lab could use it later; don't change the firewall lab now.
- The Wi-Fi router: a router plus a switch with Wi-Fi, drawn inside one zone outline. Reuse the wireless lab's Wi-Fi model, association, and settings section; reuse the existing switch MAC table display.

## Acceptance

- Walkthrough test passes. Lab tests: a device that joins gets the next address in the pool; two devices browsing at once each get their own answers; an unsolicited inbound packet drops; replay is identical.
- Playthrough passes with screenshots in both themes and at 1366x768.
