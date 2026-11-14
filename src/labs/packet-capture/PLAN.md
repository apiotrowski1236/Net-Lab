# Packet Capture Basics (`packet-capture`)

Status: built. Code: `index.ts` (steps), `scenario.ts` (network, buttons, setups), `solution.ts` (answer key), `lab.test.ts`. Part 2 handout: `WIRESHARK.md`.

Tagline: Capture the family laptop's traffic, open packets layer by layer, learn the common kinds, and filter for the packets you want, to get ready for Wireshark.

The second lab, after `home-network` (Home Network: Switching, DHCP, and NAT) and before `build-network`. It is Part 1 of a two-part lab: here, students practice packet capture on a slow, small, simulated network. In Part 2 (`WIRESHARK.md`, a handout) they install Wireshark and repeat the basics on a real computer. The goal is familiarity, not mastery: students should recognize Wireshark's window, know the half-dozen packet types they'll see first, and know that a display filter is how you stop drowning.

CodeHS: `3.1 How Network Traffic Moves`. CED: prerequisite networking (no Unit 3 LO is about packet capture by name). It touches 3.1.A.2 (eavesdropping: what a capture on a switched network can and can't see) and 3.2.B (encrypted traffic stays unreadable in a capture). About 45 minutes, 13 steps.

## What students learn

- A **packet capture** records every packet one device's network card sends or receives. Wireshark is the common tool. Capture only on your own device, or with permission.
- Start, do something, stop, then read. The packet list has the same columns as Wireshark: No., Time (seconds since Start), Source, Destination, Protocol, Info.
- A packet is **layers**, one inside another: Ethernet (MACs, this hop), IP (addresses, the whole trip), TCP or UDP (ports, which program), then the message. Under each layer, Wireshark's name for it.
- Loading one web page takes three kinds of packets: ARP (find the router's MAC), DNS (find the server's address), HTTP (get the page).
- Other jobs: DHCP (get an address), ping (Wireshark: ICMP).
- HTTPS (Wireshark: TLS): addresses and ports are readable, the message isn't.
- A real computer is busy even when nobody is using it: apps work in the background.
- **Display filters** hide everything but what you ask for: `dns`, `http`, `ip.addr == 198.51.100.140`, `!arp`, `dns || http`. Green means it worked; red means a mistake, with a message.
- A capture on your own computer sees your own traffic and broadcasts. The switch keeps everyone else's away.
- Wireshark's extras: the interface list, a Length column, the bytes pane, TCP's SYN and ACK packets, QUIC, IPv6.

## Scenario and map

The Nguyens' home from lab 1, already set up: the Wi-Fi router (router plus Switch and Wi-Fi, one box), the laptop, phone, and TV on Wi-Fi (WPA3), the internet provider, and five servers: a name server (DNS), the school website (plain HTTP), the video site (HTTPS), a chat service (HTTPS), and a weather service (plain HTTP). The hook: the family laptop's Wi-Fi light blinks all day, even when nobody uses it. The capture runs on the laptop.

## Steps

1. **Meet the capture**: what a capture is, Wireshark, permission. Open the laptop and the name server. Question: what a capture records.
2. **Your first capture**: Start, **Open the school website**, Stop. The columns. The page goal needs a clean capture: the laptop's ARP request is packet 1. Question: how many packets one page took.
3. **Open a packet**: layers of the GET and the 200 OK. Questions: which layer names the program; why the To MAC is the router's.
4. **One click, three kinds of packets**: ARP, DNS, HTTP in order. Open the ARP reply and the DNS answer. Questions: why DNS comes first; the address in the DNS answer.
5. **Packets with other jobs**: a new capture; **The phone rejoins the Wi-Fi** (DHCP broadcasts); ping the router (ICMP). Question: which packet a device with no address sends.
6. **Locked packets**: **Open the video site** over HTTPS; open a TLS packet. Questions: what a capture still learns; the port number.
7. **A busy minute**: a new capture; **Leave the laptop alone for a minute** (44 packets of background apps and broadcasts, squeezed into about 15 seconds). Question: why packets flow when nobody uses the laptop.
8. **Filters**: `dns`, then `http`; read the weather. Question: today's weather.
9. **Follow one conversation**: `ip.addr ==` the chat service; `!` (the example is `!dns`, the task asks for `!arp`); `||` in one sentence. Question: what the chat messages show.
10. **What the capture can't see**: a new capture; **The TV plays a show**; `ip.addr ==` the TV shows nothing; `arp` shows its broadcast. Question: why.
11. **Get ready for Wireshark**: a drawing of Wireshark's window with its five parts numbered (`wiresharkWindow.ts`); a short list of what Wireshark shows that the lab left out: TCP's handshake, QUIC (and the `quic` filter), and IPv6; then a numbered practice list for `icmp` and `tls`. No question: step 8 teaches stop-then-filter, and the reflection asks about it.
12. **Reflect**: advice for a friend opening Wireshark the first time (about 40 words).
13. **Submit**.

## What this lab adds

- **Capture runs** (`src/sim/capture.ts`): `sim.startCapture(dev)` clears the list and numbers packets from 1 with time from 0, as Wireshark starts a new capture; `sim.stopCapture(dev)`. Action `capture`. `Device.captureRun`.
- **Display filters** (`src/sim/displayFilter.ts`): a small Wireshark filter language (protocol names, `ip.addr`, `ip.src`, `ip.dst`, `eth.addr`, `tcp.port`, `udp.port`, `dns.qry.name`, `http.host`, `==`, `!=`, `contains`, `!`, `&&`, `||`, parentheses) with friendly errors ("Wireshark calls ping packets icmp").
- **Capture tool** (`{ kind: 'capture', device, filter? }`): Start, Stop, and (with `filter`) the filter bar, in the Capture tab's toolbar rather than the Toolkit. UI event `ui:filter`; goal helper `filtered`; solution move `{ filter, text }`.
- **Wireshark look** (`LabDef.wireshark`): Wireshark's name under each packet layer, Wireshark's protocol names in the list (ICMP, TLS), no "Hide ARP" shortcut, a taller Capture tab, and the list scrolls to the top when a capture stops.
- **Background apps** (`scenario.ts`): the busy minute and the TV's show send hand-built packets with `Sim.sendPacket`, from ports 61000 up and message numbers 900000 up, so they never collide with the browser's.

## Notes

- The laptop forgets the router's MAC address before each button (`clearArp`), so every page load shows ARP, DNS, HTTP. Step 4 says so in one sentence. Routers and servers start with warm ARP caches, so no hidden lookups slow a page.
- A host with a DNS server asks it every time (no host cache), so DNS shows on every load.
- Setups for steps 3, 4, 8, and 9 fill in a finished capture only when the student's own list lacks it. The others stop the capture so "Press Start" is always the right first move.
- Goals that capture a lesson button's traffic (steps 2, 6, 7, 10) need the capture running before the press, matching the warning under the button.
- Lesson buttons ignore a second press while their first run is still going: a page load while the browser is loading, and the busy minute for its first 17 seconds. Outcome lines warn when Start came after the button, or when the list holds packets from before it.
- Step 2's setup replaces the student's capture unless it is clean; step 7's waits for the network to go quiet before it starts one.
- `session.captureFilter` is view state: it is never saved or replayed. Filter goals latch on the `ui:filter` event and check the filter against the capture at that moment.

## Acceptance

- Walkthrough passes. Lab tests: one page load is ARP, DNS, HTTP in that order; the busy minute is deterministic (44 packets: 4 ARP, 8 DNS, 4 HTTP, 28 TLS), and each app looks up its server before talking to it; the TV's show leaves only an ARP request in the laptop's capture; filter parsing and errors word for word.
- Playthrough passes; screenshots of real step states in light, dark, and 1366x768.
