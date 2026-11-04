# Wireshark for Real (AP Cybersecurity lab 3)

Status: built. Code: `index.ts` (steps), `answers.ts` (answer checks), `pictures.ts` (stage drawings), `solution.ts` (one real student's answers), `lab.test.ts`.

## Idea

`packet-capture` ends with "next class, we'll download Wireshark." This lab is that class. Students install Wireshark on their own computer and capture their own traffic on the school Wi-Fi, with the teacher's permission. The page is a lesson with no simulated network: the stage shows drawings of what each step looks like, and the questions work like a quiz.

Every auto-checked answer has to come out of the student's own capture:

- `expect` matches Wireshark's own format (an Info line like `Standard query response 0x0d11 A wikipedia.org A 198.35.26.224`), checked against TShark 4.4.
- `verify` (new, see below) checks it against the student's other answers: the DNS response goes to the address from step 3, the `[SYN, ACK]` goes back to the `[SYN]`'s port, the ping reply comes from the router from step 8, and the two step 9 counts add up to the total.
- The drawings use documentation addresses (192.0.2.x, 198.51.100.x, 203.0.113.x) and their own made-up MACs, names, and port 52114. The checks turn those away, and step 2's drawing fogs the Protocol and Info columns.

Pasting is the expected way in. **Copy > Summary as Text** gives one tab-separated row (No., Time, Source, Destination, Protocol, Length, Info), and the checks read Source and Destination out of it. An Info line on its own also passes, minus the address cross-check.

## Steps (50 minutes)

1. **install**: the rules (own computer, school Wi-Fi, no monitor mode, no one else's traffic, don't save or share), install notes (Npcap on Windows, ChmodBPF on Mac, Chromebooks can't), version from About. Choice: what the permission covers.
2. **first-capture**: capture 30 seconds on Wi-Fi. Packets count, three protocol names.
3. **you**: IP address from ipconfig or Wi-Fi Details; MAC from Ethernet II Source with `ip.src ==`, Copy > Value.
4. **dns**: `nslookup wikipedia.org`, filter `dns`, paste the response, its address. Choice: what the Transaction ID is for.
5. **http**: http://neverssl.com, filter `http`, paste a GET, its Host. Choice: who could read plain HTTP.
6. **handshake**: filter `tcp.port == 80`, paste the [SYN] and its [SYN, ACK]. Choice: the big port number is temporary.
7. **tls**: https://www.wikipedia.org, filter `tls.handshake.type == 1`, paste the Client Hello (SNI), Dst Port 443. Choice: what a network watcher still learns.
8. **ping**: the gateway, `ping` it, filter `icmp`, paste a reply (or a lost request when pings are blocked). Choice: why ICMP has no ports.
9. **not-mine**: Packets, `ip.addr ==` me, `!(ip.addr == me)`; the two add up. Choice: why classmates' pages aren't there.
10. **reflect**: advice for a friend who thinks HTTPS makes them invisible (40+ words); quit without saving.
11. **submit**
12. **user-agent** (extra credit): paste the User-Agent from the neverssl GET and say what it gives away.

## New shared API

- `TextQuestion.verify(value, answer)` in `src/labs/types.ts`: runs after `expect` passes and returns a message when the answer disagrees with another answer. `answer(stepId, questionId)` reads the student's trimmed answers. `textCorrect` and `wrongFeedback(q, value, answer?)` use it. `LabSession.answerText` is the lookup; `session.check` and `Lesson.tsx`'s feedback pass it.
- CSS: "wireshark: drawings" in `src/features.css` (classes `ws-pic`, `ws-term`, `ws-settings`, `ws-shake`, `ws-split`, `ws-hi`/`ws-tag` rings, `ws-fog`, `ws-menu`, row colors for http, udp, arp, icmp).
- `clickthrough.mjs` handles lessons (no `build`, no speed button), waits a moment as each step opens, and strips backticks when it finds a question card.

## For the teacher

- Check ahead of time that Wireshark installs on the school's laptops (Npcap needs an administrator on Windows; ChmodBPF on Mac). Chromebooks can't run it.
- A school VPN or web filter agent can tunnel traffic past the Wi-Fi interface. If a student's capture is nearly empty or shows no DNS, try the other interfaces with a moving line.
- Some networks block ping. Step 8 accepts a request marked `(no response found!)`.
- Some school DNS servers answer `nslookup` first with the school's suffix added (`No such name`). Step 4 says to skip those.
- Answers vary by student, so the report shows what each student pasted. The checks make copying a drawing or a neighbor's answer fail when it doesn't match the student's own step 3 address.
