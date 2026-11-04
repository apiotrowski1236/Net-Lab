# Clues from the Command Line (`net-tools`)

Status: built. Lab 5 of AP Cybersecurity, after `build-network`. Code: `index.ts` (steps), `scenario.ts`
(network, readers, buttons, setups), `solution.ts` (answer key), `lab.test.ts`.

## Why this lab

Labs 1 to 4 built a network and watched packets. Before students play attacker in `on-path`, they should
know the everyday diagnostic commands every IT person uses: `ping`, `traceroute`, `nslookup`, `netstat`,
and `nmap`. The lab treats them as a detective's tools: each answers one question about the network.

It also sets the ethics rule for the rest of the course: the first four only look, and are fine on your
own computer. `nmap` probes other people's computers, so it needs the owner's written permission. The
lab's terminal refuses to scan anything outside the signed scope.

## Scenario

The student volunteers at the Lakeside Public Library's help desk after school. Three tickets come in:

1. The online catalog won't load on the public computers (a wrong DNS record).
2. The e-book site won't load (a cut cable out on the internet, past the library's provider).
3. A patron saw the mouse on Public PC 2 move by itself (a remote-control program).

Then the library director signs a permission letter, and the student maps the library network with
`nmap` and finds two risky services: an FTP server with a known backdoor and a printer's Telnet login.

## Network

Library (10.0.0.0/24, NAT to the provider):

| id | Device | Address | Notes |
|---|---|---|---|
| laptop | Help desk laptop | 10.0.0.5 | The student's; the only one with nmap |
| pc1 | Public PC 1 | 10.0.0.31 | Tickets 1 and 2 |
| pc2 | Public PC 2 | 10.0.0.32 | Remote-control program connected to 203.0.113.66:4444 |
| catalog | Catalog server | 10.0.0.20 | Web 80/443, SSH 22, FTP 21 (vsftpd 2.3.4) |
| printer | Printer | 10.0.0.40 | IPP 631, web admin 80, Telnet 23 |
| sw | Switch | | |
| router | Library router | 10.0.0.1, 198.51.100.10 | Gateway, NAT, and the library's DNS server |

Internet: `isp` (198.51.100.1), `core` (Internet router, 192.0.2.2), `ebooks` (E-book site,
ebooks.example, 192.0.2.80), `remote` (Unknown server, 203.0.113.66, port 4444).

## New shared pieces

- **Terminal tool** (`{ kind: 'terminal' }`, `src/ui/tools/Terminal.tsx`): a command line on the
  computer the student sits at, with command buttons, history, and a plain-words line under each result.
  Commands: `ping`, `traceroute` (`tracert`), `nslookup`, `netstat` (`-a`, `-b`), `nmap` (`-sV`,
  `--script vuln`), `help`, `clear`. A step lists the commands it allows and nmap's permitted scope.
- **Sim** (`src/sim/terminal.ts`): command parsing, runs stored on `Device.term`, ICMP time exceeded
  (`SimOptions.icmpErrors`) so traceroute works hop by hop (also through NAT), `Link.ms` for realistic
  round-trip times, `Device.sockets` for netstat, `ScanHost.banners` for `nmap -sV`.
- **Action** `{ type: 'term', device, line }`.

## Steps

1. **tour**: the tickets, the five commands, and the rule: look freely, scan only with permission.
2. **ping**: ping the router and the catalog server by address. Read replies, time, TTL, and loss.
3. **ping-name**: ping the catalog by name. Destination Host Unreachable, at a different address.
4. **nslookup**: the name points at 10.0.0.21. Report it (button needs the lookup first), check the fix,
   open the catalog.
5. **traceroute**: the e-book site is down. The trace stops after the provider. Call the provider (button
   needs the stopped trace first), trace again, and count the routers on the full path.
6. **netstat**: watch Public PC 2, list its connections with `netstat -b`, find the odd one, unplug it
   (button needs the netstat first), and see the connection gone.
7. **permission**: the signed letter. What it covers, and what it doesn't.
8. **nmap**: scan 10.0.0.0/24 from the laptop. Which devices answer, and with which ports?
9. **vuln**: `nmap -sV --script vuln` on the network; pick the services to turn off.
10. **close**: the contractor turns off FTP and Telnet; rescan to check.
11. **reflect**: advice for a friend who wants to try nmap on the school network.
12. **submit**.
