# Wireshark for Real (AP Cybersecurity lab 3)

Status: built. Code: `index.ts` (steps), `answers.ts` (answer checks), `pictures.ts` (stage drawings), `solution.ts` (one real student's answers), `lab.test.ts`.

## Idea

`packet-capture` ends with "next class, we'll download Wireshark." This lab is that class. Students install Wireshark on their own computer and capture their own traffic on the school Wi-Fi, with the teacher's permission. The page is a lesson with no simulated network: the stage shows drawings of what each step looks like, and the questions work like a quiz.

Every auto-checked answer has to come out of the student's own capture:

- `expect` matches Wireshark's own format (an Info line like `Standard query response 0x0d11 A wikipedia.org A 198.35.26.224`), checked against TShark 4.4.
- `verify` (new, see below) checks it against the student's other answers: the DNS response goes to the address from step 3, the `[SYN, ACK]` goes back to the `[SYN]`'s port, the ping reply comes from the router from the extra-credit step, and the two step 8 counts add up to the total.
- The drawings use documentation addresses (192.0.2.x, 198.51.100.x, 203.0.113.x) and their own made-up MACs, names, and port 52114. The checks turn those away, and step 2's drawing fogs the Protocol and Info columns.

Pasting is the expected way in. **Copy > Summary as Text** gives one tab-separated row (No., Time, Source, Destination, Protocol, Length, Info), and the checks read Source and Destination out of it. An Info line on its own also passes, minus the address cross-check.

## Steps (55 minutes)

Students install Wireshark before class (the teacher sends the link), so class time goes to capturing. Step 1 has a short "Not installed yet?" note for anyone who didn't.

1. **install**: the rules (own computer, school Wi-Fi, no monitor mode, no one else's traffic, don't save or share), a short install note (Npcap on Windows, ChmodBPF on Mac, Chromebooks can't), version from About. Choice: what the permission covers.
2. **first-capture**: capture 30 seconds on Wi-Fi. Packets count, three protocol names.
3. **you**: IP address from ipconfig or Wi-Fi Details (a private address; the router swaps in the public one); MAC from Ethernet II Source with `ip.src ==`, Copy > Value.
4. **dns**: `nslookup wikipedia.org`, filter `dns`, paste the response, its address (the DNS server's own address is turned away with its own message). Choice: what the Transaction ID is for.
5. **http**: http://neverssl.com, filter `http`, paste a GET, its Host. Choice: who could read plain HTTP.
6. **handshake**: filter `tcp.port == 80`, paste the [SYN] and its [SYN, ACK]. The explains cover the temporary port.
7. **tls**: https://www.wikipedia.org, filter `tls.handshake.type == 1`, paste the Client Hello (SNI); a QUIC row gets its own message, and an "If you see QUIC" note sends only-QUIC students to a private window. A drawing shows Encrypted Application Data. Choice: what a network watcher still learns.
8. **not-mine**: Packets, `ip.addr ==` me, `!(ip.addr == me)`; the two add up, and until they do, none of the three boxes says Correct!. The body says why classmates' pages never reach the capture (the card keeps only packets for you, for everyone, or for a group; per-device Wi-Fi keys). Choice: would a classmate's plain-HTTP GET show up.
9. **reflect**: advice for a friend who thinks HTTPS makes them invisible (40+ words). Quit without saving after any extra credit.
10. **submit**
11. **ping** (extra credit): the gateway, `ping` it, filter `icmp`, paste a reply (or a lost request when pings are blocked). Choice: why ICMP has no ports.
12. **user-agent** (extra credit): paste the User-Agent from the neverssl GET (details pane, Copy > Value) and say what it gives away.

## New shared API

- `TextQuestion.verify(value, answer)` in `src/labs/types.ts`: runs after `expect` passes and returns a message when the answer disagrees with another answer. `answer(stepId, questionId)` reads the student's trimmed answers. `textCorrect` and `wrongFeedback(q, value, answer?)` use it. `LabSession.answerText` is the lookup; `session.check` and `Lesson.tsx`'s feedback pass it.
- CSS: "wireshark: drawings" in `src/features.css` (classes `ws-pic`, `ws-term`, `ws-settings`, `ws-shake`, `ws-split`, `ws-hi`/`ws-tag` rings, `ws-fog`, `ws-menu`, row colors for http, udp, arp, icmp).
- `Answer.rightAfter` in `src/store/progress.ts`: the tries it took to be right the first time. `session.check` sets it once, and `buildReport` uses it, so checking another answer after a right one doesn't add tries.
- `Summary.tsx` skips the goals stat when a lab has no goals, and `.summary-stats` drops to three columns then. Its time stat says "minutes on this page", since this lab's work happens in Wireshark. `.prose code` turns off font ligatures, so `!=` and `->` show as typed.
- `inlineMarkdown` in `src/ui/markdown.ts`: question feedback and explains draw `**bold**` and `` `code` `` (everything else escaped). Before, they showed the stars and backticks.
- `Lesson.tsx` `TextCard`: a text answer that failed only its `verify` drops the old verdict once the other answer it disagreed with changes, so its Check button works again.
- `LabSession.check` re-grades the step's other checked text answers that have a `verify` (`regradeSiblings` in `src/runtime/session.ts`). An answer that a newer check contradicts loses its Correct!, and one that now agrees turns right without a new try. In step 8, when the three counts don't add up, all three boxes say so, and the report counts tries against the box the student changed.
- `clickthrough.mjs` handles lessons (no `build`, no speed button), waits a moment as each step opens, and strips backticks when it finds a question card.

## For the teacher

- Have students install Wireshark before class, and check ahead of time that it installs on the school's laptops (Npcap needs an administrator on Windows; ChmodBPF on Mac). Chromebooks can't run it. A class that installs during the period needs about 15 more minutes.
- Some school web filters install their own certificate on school laptops and unlock HTTPS. Step 7's explain mentions it; if yours does, tell students the school can read their HTTPS pages too.
- A school VPN or web filter agent can tunnel traffic past the Wi-Fi interface. If a student's capture is nearly empty or shows no DNS, try the other interfaces with a moving line.
- Some networks block ping. The ping extra credit accepts a request marked `(no response found!)`.
- Some school DNS servers answer `nslookup` first with the school's suffix added (`No such name`). Step 4 says to skip those.
- Answers vary by student, so the report shows what each student pasted. The checks make copying a drawing or a neighbor's answer fail when it doesn't match the student's own step 3 address.
- The report's minutes count time on the lab page only. Time spent in Wireshark, the terminal, and the browser doesn't show up there, so a real class takes longer than the report says.
- The report counts tries up to the first right answer. A student who checks a second answer from the same capture after being right isn't charged a try.
