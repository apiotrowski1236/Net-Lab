# DNS Cache Poisoning (`dns-spoof`)

Status: built. 11 steps, registered in `src/labs/index.ts`. Feature code in
`src/sim/dns.ts` (+ the resolver section of `src/sim/sim.ts`); scenario,
lesson, answer key, and tests in this folder and `src/sim/dns.test.ts`.

Tagline: Poison a DNS server's cache and send a whole school to a fake sign-in page, then make the attack harder.

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
5. **Guess the ticket number**: the resolver accepts the first answer whose query ID and source port match a question it asked. The forger tool is atomic: it makes sure a question for the name is in flight, then floods a burst of forged answers ("from" the name server's IP) covering the whole predictable ID range, at the predictable port. The forged answers reach the resolver in fewer hops than the real one, so when the resolver is not hardened one guess matches first. The student types the name and the address to plant; the tool explains mistakes ("That is the real gradebook's address."). Goal: the resolver caches `grades.example` with Mallory's IP. The toy resolver uses a small, predictable ID range so the burst is short and deterministic. TTL is 5 minutes of simulated time, long enough to survive reading.
6. **Harvest**: Alice and a teacher sign in on `http://grades.example`. Their passwords land on Mallory's server. Goal: credentials stolen.
7. **HTTPS says no**: Alice opens `https://grades.example` and gets a certificate warning. Question: why HTTPS caught it when DNS didn't.
8. **Something is wrong**: as the district's IT team, read the logs: the real gradebook's access log shows visits drop to zero at one minute; the resolver log shows when the record changed and who answered. Goal: open the log line where the record changed. Question: why DNS poisoning is hard to detect.
9. **Fix it**: the Resolver defenses card flushes the bad record and turns on unpredictable query IDs and source ports. Mallory tries again and fails. Goals: flushed, hardened, and Alice reaches the real site over HTTPS with no warning. DNSSEC (signed records) is named here and in the reflection as the stronger, beyond-the-course fix, in prose only; it is not a toggle.
10. **Reflect**: written, compare DNS poisoning with ARP poisoning: what each changes, and how far each reaches.
11. **Submit**.

## Core features this lab owns

- A recursive resolver role (`Device.resolver` or similar): forwards queries to the authoritative server for a zone, caches answers with TTLs that count down in sim time, answers from cache, logs cache changes. Hosts keep using `dnsServer`.
- Query IDs on DNS messages, matched by the resolver with the source port; forged answers with a spoofed source IP; a resolver setting for unpredictable IDs and ports. DNSSEC stayed prose-only (no signed-record validation in the sim).
- Web server access logs (`source: 'web'`), which `logs` will reuse.
- Toolkit card for the forger. Inspector section for the resolver cache with TTLs, and for a name server's zone.

Reuse what exists: `dnsZone`, `dnsCache`, `dnsServer`, `WebSite.fake`, stolen credentials, the HTTPS certificate check. Keep `on-path` and `route-hijack` working.

## Acceptance

- Walkthrough test passes. Lab tests: a cache hit sends no query; a matching forged answer poisons the cache and a wrong ID doesn't; random IDs defeat the burst; TTL expiry clears the record; replay gives the same cache.
