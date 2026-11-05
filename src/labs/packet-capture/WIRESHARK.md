# What's in a Packet? Part 2: Wireshark

In Part 1 you captured packets on a small, slow, simulated network. Now you'll do the same on your own computer with **Wireshark**. Expect a lot more packets. You already know how to find the ones that matter: stop, then filter.

About 45 minutes. Answer the questions in **bold** and hand them in on PowerSchool.

## Before you start: permission

A capture can show the sites someone visits and anything sent without encryption. Capture only on your own computer, on a network where you have permission. Your teacher has the school's permission for this activity, on this network, today. Running Wireshark on any other network without the owner's permission can break school rules and the law.

## 1. Install Wireshark

Download it only from **wireshark.org**, the official site.

- **Windows**: run the installer and keep the defaults. When it asks, install **Npcap** too. Wireshark needs it to capture.
- **Mac**: open the .dmg, drag Wireshark to Applications, and run **Install ChmodBPF** from the same window. Without it, Wireshark can't see your network connections.
- **Chromebook**: Wireshark doesn't run on Chromebooks. Pair up with a classmate, or use a school computer.

If the installer asks for an administrator password you don't have, ask your teacher.

## 2. Pick an interface

Open Wireshark. The welcome screen lists your computer's network connections, called **interfaces**. Each has a small line graph next to it.

- Pick the one with a moving line: **Wi-Fi** (on a Mac, **Wi-Fi: en0**), or **Ethernet** if you use a cable.
- Double-click it. The capture starts right away.

**Q1. Which interface did you pick, and how did you know it was the right one?**

## 3. Your first capture

Let it run for 30 seconds without touching anything. Then press **Stop**, the red square in the toolbar. (**Start** is the blue shark fin.)

Look at the three panes:

- **Top**: the packet list. Same columns as Part 1, plus **Length**, the packet's size in bytes.
- **Middle**: the layers of the packet you clicked: Ethernet II, Internet Protocol, TCP or UDP, then the message. Click the arrows to open each layer.
- **Bottom**: the packet's raw bytes, in hexadecimal. You can ignore this pane.

**Q2. How many packets did you capture in 30 seconds without doing anything? Why so many?**

## 4. Filters

Type a filter in the bar above the packet list and press Enter. Green means Wireshark understands it, red means it doesn't. To see everything again, clear the bar and press Enter.

Start a new capture before each part below (the blue shark fin), do the thing, then press Stop.

**a. Name lookups.** Start a capture, then visit a website you haven't visited today. Stop, and filter `dns`.

**Q3. Write down two names your computer looked up, and the IP address the DNS answer gave for one of them.**

(Seeing no DNS packets? Your browser may use secure DNS, which hides lookups inside encrypted traffic. Your computer also remembers recent answers, so try a site you haven't visited today.)

**b. Plain web traffic.** Start a capture, then visit **http://neverssl.com** (a site made to use plain HTTP). Stop, and filter `http`.

**Q4. Find the GET request. What does its Host line say? Could someone else on the network read this page?**

**c. Encrypted web traffic.** Filter `tls`. Click a packet whose Info says Application Data, and open its Transport Layer Security layer.

**Q5. What can you still read about a TLS packet, and what can't you?**

**d. Ping.** Find your **default gateway** (your router's address):

- **Windows**: open Command Prompt and type `ipconfig`. Look for Default Gateway.
- **Mac**: System Settings, then Wi-Fi, then Details next to your network, then TCP/IP. Look for Router.

Start a capture. Ping the gateway: `ping 192.168.1.1` on Windows, or `ping -c 4 192.168.1.1` in Terminal on a Mac (use your gateway's address). Stop, and filter `icmp`.

**Q6. How many Echo (ping) requests and replies did you capture? What are their Source and Destination addresses?**

(If the pings time out, some networks block them. Note that and move on.)

**e. ARP.** Filter `arp`.

**Q7. Find a "Who has" request. Who sent it, and who was it sent to? Why does your computer get it?**

**f. One computer.** Find your own IP address (`ipconfig` on Windows, or the Wi-Fi Details window on a Mac). Filter `ip.addr == ` followed by your address.

**Q8. Did the filter hide anything? What kinds of packets were left out, and why?**

## 5. What's new compared with Part 1

You'll see packets Part 1 didn't show:

- **TCP handshakes**: three small packets marked [SYN], [SYN, ACK], and [ACK] before each connection. Filter `tcp.flags.syn == 1` to see them.
- **QUIC**: a newer way to carry web traffic, over UDP. Filter `quic`.
- **IPv6**: long addresses with colons. Filter `ipv6`.
- Packets from other programs, like `mdns` and `ssdp`: devices announcing themselves to the network.

**Q9. Give one piece of advice to someone opening Wireshark for the first time.**

## Optional extra challenge

- **Statistics, then Protocol Hierarchy**: what kinds of packets made up your capture. Which protocol had the most?
- Filter `dns || http` and explain why the order of the packets makes sense.
