# Wrong Directions (`dns-spoof`)

Status: planned, wave 1. Follow `docs/unit3/ARCHITECTURE.md`.

Tagline: Poison a DNS server's memory and send a whole school to a fake sign-in page.

CodeHS: `3.3 Misdirected and Overwhelmed`. CED LOs: 3.1.A, 3.1.B, 3.1.C, 3.5.E.

## What students learn

- **DNS** turns a name into an IP address. A **resolver** (the school's DNS server) asks the **authoritative name server** for a domain, then **caches** the answer for its **TTL**, so later lookups skip the trip.
- **DNS poisoning** (3.1.A.3): an adversary pretends to be the authoritative name server and plants a fake record in the resolver's cache. Everyone who uses that resolver gets the wrong address until the record expires.
- **Credential harvesting** (3.1.A.3): the wrong address leads to a lookalike sign-in page that records what people type.
- It attacks integrity first (a wrong record), then confidentiality (stolen passwords) (3.1.C.1).
- **HTTPS** catches the impostor: the fake site can't prove it is the real name (link back to `on-path` and `route-hijack`).
- **Detection** (3.5.E.5): DNS poisoning is hard to see. A sudden, unexplained drop in visits to the real site is the clue to check the DNS records.
- **Defenses**: a resolver that picks unpredictable query IDs (and source ports) makes forged answers almost impossible to match; signed records (DNSSEC, named as beyond the course) let a resolver reject forgeries; flushing the bad record ends a poisoning.

## Scenario and map

Maple Grove School District. Students and teachers (two or three laptops) use the district resolver (`resolver`). On the internet: the authoritative name server for `grades.example` (`ns`), the real gradebook web server (`grades`), and Mallory's server (`evil`) hosting a lookalike sign-in page. Mallory can send packets with a forged source address from the internet; say so plainly.

Keep it to two levels (resolver to authoritative server). Skip root and TLD servers, and say once that real DNS asks a few more servers first.

## Step outline

1. **Names and numbers**: tour. Inspect the resolver's cache (empty) and the name server's records.
2. **A lookup**: Alice opens `http://grades.example`. Watch the query go resolver to name server, the answer come back, and the cache fill with a TTL. Question: what DNS does.
3. **The cache**: Ben opens the same site. The resolver answers from its cache. Question: why caching makes one bad record dangerous.
4. **The impostor**: open Mallory's lookalike page directly by IP. It looks real. Question about credential harvesting.
5. **Guess the ticket number**: the resolver accepts the first answer whose query ID matches. Mallory's forger tool sends a burst of forged answers ("from" the name server's IP) with guessed IDs, while a fresh lookup is in flight (wait for the TTL to run out, or ask for the name right after it expires). The student types the name and the address to plant. The tool explains mistakes ("That's the real gradebook's address."). Goal: the resolver caches `grades.example` with Mallory's IP. Keep the guessing deterministic and quick: the toy resolver uses a small, predictable ID range.
6. **Harvest**: Alice and a teacher sign in on `http://grades.example`. Their passwords land on Mallory's server. Goal: credentials stolen.
7. **HTTPS says no**: Alice opens `https://grades.example` and gets a certificate warning. Question: why HTTPS caught it when DNS didn't.
8. **Something is wrong**: as the district's IT team, read the logs: the real gradebook's access log shows visits drop to zero at one minute; the resolver log shows when the record changed and who answered. Goal: open the log line where the record changed. Question: why DNS poisoning is hard to detect.
9. **Fix it**: flush the bad record, turn on random query IDs (and source ports), and optionally DNSSEC validation. Mallory tries again and fails. Goal: forged answers rejected; Alice reaches the real site.
10. **Reflect**: written, compare DNS poisoning with ARP poisoning: what each changes, and how far each reaches.
11. **Submit**.

## Core features this lab owns

- A recursive resolver role (`Device.resolver` or similar): forwards queries to the authoritative server for a zone, caches answers with TTLs that count down in sim time, answers from cache, logs cache changes. Hosts keep using `dnsServer`.
- Query IDs on DNS messages, matched by the resolver; forged answers with a spoofed source IP; a resolver setting for unpredictable IDs (and ports), and DNSSEC-style validation if it stays simple.
- Web server access logs (`source: 'web'`), which `logs` will reuse.
- Toolkit card for the forger. Inspector section for the resolver cache with TTLs, and for a name server's zone.

Reuse what exists: `dnsZone`, `dnsCache`, `dnsServer`, `WebSite.fake`, stolen credentials, the HTTPS certificate check. Keep `on-path` and `route-hijack` working.

## Acceptance

- Walkthrough test passes. Lab tests: a cache hit sends no query; a matching forged answer poisons the cache and a wrong ID doesn't; random IDs defeat the burst; TTL expiry clears the record; replay gives the same cache.
