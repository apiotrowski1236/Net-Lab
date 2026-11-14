# Smarter Firewalls (`firewall-types`)

Status: built. Code in `src/labs/firewall-types/` (`index.ts`, `scenario.ts`, `solution.ts`, `lab.test.ts`); engine in `src/sim/ngfw.ts`. The original spec follows the "As built" section and is kept for reference.

## As built

- **Version 1, 11 steps, about 45 minutes.** CodeHS 3.9 Guarding the Gate. `ced: ['3.4.A', '3.4.B', '3.4.D', '3.5.A']`.
- **Network** (`buildHospital2`): the hospital a week after Firewall Rulebook, with Firewalls A and B already in their cables and stateful, and the rulebooks the last lab ends with (A: out any, HTTPS in to the web server, clinic SSH, deny inbound TCP; B: staff out). It imports the firewall lab's addresses and rules but builds its own network, because the firewall lab's builder starts with the firewalls unplaced and has no patient-free variant. The patient at home is gone. New: a branch office (`branch` router, 192.0.2.2 / 10.0.3.0/24, with a stateless firewall built in and one rule, out any) and its **front desk** (10.0.3.10). The attacker runs the remote-control server on 443 and 47001. The web server has two pages: `/appointments?id=7` and the SQL injection version of it.
- **Map zones:** Internet, Branch office, Screened subnet (DMZ), Internal network.

### Steps

1. **Back at the hospital** (`tour`): open A, B, and the branch router. Question: where the branch's firewall runs (inside the router, 3.4.A.1). Simulation and legality notice.
2. **A firewall with no memory** (`stateless`): switch A to stateless; the clinic portal's reply is denied. From the requirement ("staff must be able to open web sites"), add allow in TCP from port 443 and move it above the deny. Goals: portal loads and the attacker's SSH stays blocked, both after the last change (so a rule from any port fails). Question: why the reply was denied (3.4.A.2).
3. **Fake replies** (`fake`): a fake reply from port 443 reaches the web server; SSH from port 443 gets in. Question: what a stateless firewall checks and can't know.
4. **Give it a memory** (`stateful`): trace question first (predict the fake reply's verdict on a stateful A with the port 443 rule still there). Switch to stateful, find the portal conversation in the connection table, see the fake denied (`no-state`), then find and delete the port 443 rule that still lets SSH in. Question: the rule change and its impact. Points back to home-network's router remembering who asked (3.4.A.3).
5. **Same port, different program** (`same-port`): a remote-control program calls the attacker on 443 and crosses both stateful firewalls. Questions: why ports can't tell programs apart; trace of "allow out TCP 443 only".
6. **Name the program** (`ngfw`): switch A to next-generation (the 443 call is now blocked as a mismatch); the program moves to 47001 and gets out. Write deny out, program remote-control, above rule 1. Goals check 47001 blocked after the change, that the firewall would block the program on a port no rule names (a pure `evaluate` probe on 5938, so a port 47001 rule fails), 443 still blocked, and the portal still loads; the last two count only once the program rule is in place (so denying Web browsing fails). Questions: port 80 next (blocked by the program rule), and why 47001 needed a rule (indicator of compromise) (3.4.A.4, 3.4.B.3, 3.4.D.2).
7. **Look inside** (`inspect`): the attacker's booking lookup carries SQL injection that the HTTPS rule allows; it reaches the web server and the student reads the web server's log line. Turn on **Intrusion prevention**; the request is denied by signature, with an alert line in A's log. One sentence on decrypting HTTPS. Questions: why a stateful firewall misses it, and a written answer on how intrusion prevention halts the attack in real time (3.4.A.4, 3.5.A).
8. **The router at the branch** (`branch`): the front desk can't open the web app. Write the reply rule on the router (in TCP from the web server, port 443, to the branch network). Goals: desk loads; the attacker's fake reply is blocked (so the rule must name the web server); a forged reply that copies the web server's address gets through. Questions: why the forged reply got through, and when a router's firewall is enough.
9. **Which firewall would do that?** (`which`): five scenarios, pick the simplest type that can do each (CodeHS 3.9.5).
10. **Choose A and B** (`choose`): the next-generation trial ends, both firewalls go back to stateful. Prices: stateless $4,000, stateful $10,000, next-generation $30,000; budget $40,000. **Run the hospital's tests** checks five things (remote-control on 47001, the SQL injection, the desk, the nurse's portal, the web server reaching the records) and prints the cost. Goals: A's tests, B's tests, and all of them within budget, in a run after the last change. The only answer is A next-generation, B stateful. Written justification to the IT director (minWords 40, teacher-graded); this is the reflection.
11. **Review and submit.**

### Design notes and deviations from the spec

- **Program rules are skipped by stateless and stateful firewalls** (the inspector says so in the Program column), and the rule form offers a program only on a next-generation firewall. The typed check explains why when a student names one on another type.
- **The program moves to 47001, not 80 or 8443.** 8443 is the usual second HTTPS port (student panel, round 1). The NGFW's existing mismatch check already blocks remote-control on 80 (80 is known for HTTP), so 80 couldn't show why a program rule is needed. Port 80 is a question instead.
- **Intrusion prevention is a switch** (`FirewallState.ips`, action `fw-ips`, tool option `ips: true`), off by default, so the firewall lab and device-analysis keep today's NGFW behavior. Signatures are payload patterns in `src/sim/ngfw.ts`; `src/sim/ids.ts`'s signatures are traffic patterns (ARP, floods, scans), so they didn't fit.
- **Step 8's rule must name the web server.** A rule that trusts any source passes the desk test but fails the fake-reply goal. The forged reply then shows the stateless limit that remains.
- **Step 10 setups** keep the student's own rules: the program rule and the branch rule are added only if the network wouldn't already pass those tests.
- The firewall lab's trim landed in the same branch (version 2).

- **Student panel, round 1** (Maya, Ethan): step 3's setup now adds the usual wide reply rule when the student's step 2 rule is narrower, so the fake packets always have a hole to use. Link delays and timeouts are shorter (link 200 ms, proc 60 ms, HTTP 7 s, connect 5 s), and the exploit outcome and the hospital's tests settle as soon as a firewall denies, instead of waiting for a timeout. Step 4's and step 6's "still works" goals count only after the rule change they test. The branch clinic is now the branch office, so it isn't confused with Lakeside Clinic. Shared fixes the panel hit: the rule form's destination placeholders read "any" (a blank field means any, and "10.0.1.10"/"443" looked like filled-in values), and a firewall's Ports table no longer has an unlabeled MAC/IP column (`Dock.tsx`).

### Shared APIs added

- `src/sim/ngfw.ts`: `APP_GROUPS`, `APP_CHOICES`, `ruleAppName`, `appMatches`, `IPS_SIGNATURES`, `payloadOf`, `signatureOf`, `signatureName`.
- `src/sim/firewall.ts`: `FwRule.app`, `FirewallState.ips`, verdict `by: 'ips'` with `signature`, `ruleMatches`/`firstMatch` take `seesApps`; log level `alert` and `fields.signature` for IPS denies.
- `Sim.fwSetIps` (sim.ts, section "ngfw"), action `fw-ips`, `firewall-rules` tool option `ips`.
- `src/runtime/firewallInput.ts`: `RuleDraft.app`, `checkRuleApp`.
- `FirewallRules.tsx`: Program column and select, router note, intrusion prevention switch.
- `clickthrough.mjs` drivers: firewall type, add, move, delete, intrusion prevention, placement, scan, connect, and opening a log line.

---

# Original spec

Split from `firewall` (see `docs/unit3/SUITE-PLAN.md`). Slot 12 of 17, right after Firewall Rulebook.

- **Title:** Smarter Firewalls
- **Tagline (draft):** Decide what kind of firewall Adams County Hospital needs: watch a stateless firewall get fooled, give it a memory, then teach it to recognize programs no matter what port they use.
- **CodeHS:** 3.9 Guarding the Gate (3.9.1 to 3.9.5), and the type half of scenario 3A
- **CED:** 3.4.A.1 to 3.4.A.4 (hands-on); 3.4.B.3 and 3.4.D.2 "service, or application" as a rule criterion; 3.5.A.3 as a bridge (an NGFW's intrusion prevention)
- **Minutes:** 45. **Steps:** 10 or 11.
- **Prerequisites:** Firewall Rulebook (ACLs, first match, implicit deny, rule order, placement of Firewalls A and B). home-network's "the router remembers who asked" is the plain-words version of a connection table; point back to it.

## Why this lab

Firewalls are 8 of 26 CED periods. The current `firewall` lab packs types, rules, order, placement, the DMZ, and logs into one period and runs 55 to 65 minutes. Types (3.4.A) are its last three steps. They also leave two gaps: no firewall inside a router is hands-on (3.4.A.1), and the NGFW only blocks a program that doesn't match its port, while the CED defines it by deep packet inspection, intrusion prevention, and filtering by application type (3.4.A.4).

CED scenario 3A asks students to "determine the **type** and placement of Firewalls A and B." Firewall Rulebook did placement. This lab does type.

## Story

Same hospital, a week later. Firewalls A and B are placed, and the rulebooks from the last lab are in. The IT director asks: "Which kind of firewall should each of these be? A next-generation box costs three times as much." Students test each kind against real problems and then make the call. A small clinic branch office joins the story with a router that has firewall software built in.

## Steps (outline)

1. **Back at the hospital** (tour). Setup builds the finished network from Firewall Rulebook (placed A and B, working rules). Inspect A and B, and the clinic branch's router. Question: where firewall software can live (a standalone box, or inside a router: 3.4.A.1). Show the router's own rules in its inspector.
2. **A firewall with no memory.** Switch A to stateless. A patient's portal page stops loading because the replies are denied. Students write the rule that lets replies back in, from the requirement ("let replies from the portal back to patients"), not from dictated fields. 3.4.A.2.
3. **Fake replies.** An attacker sends packets from source port 443 that match the reply rule. They get in. Question: what the stateless firewall checked and what it couldn't know.
4. **Give it a memory.** Switch to stateful. Inspect the connection table. Replay: real replies pass, the forged one is denied (no matching connection). Delete the now-unneeded reply rule. 3.4.A.3.
5. **Same port, different program.** A remote-control program on a nurse's computer calls home over port 443. Stateful allows it (an allowed port, a real connection). Question: why ports alone can't tell programs apart.
6. **Name the program.** Switch A to next-generation. Write rules that name an application, for example deny outbound `remote-control` and allow outbound `web`. The program is blocked even when it moves to port 80. 3.4.A.4, 3.4.B.3.
7. **Look inside.** Deep packet inspection and intrusion prevention: an attacker sends an exploit inside an ordinary HTTPS-port request to the portal (simplify: the NGFW can see it; say in one sentence that real NGFWs must decrypt TLS to do this). The NGFW drops it and logs why. Question: how this automated response halts an attack in real time (FRQ move).
8. **The router at the clinic.** The branch router's built-in firewall is stateless. Students add the rule the branch needs and see its limit. Question: when a firewall inside a router is enough.
9. **Which firewall would do that?** Five or six short scenarios; students pick stateless, stateful, or next-generation for each (CodeHS 3.9.5).
10. **Choose A and B.** Pick the type for each firewall within a budget and justify it in writing (scenario 3A). Goals check the choice is consistent with what each must stop; the justification is teacher-graded.
11. **Review and submit.**

(The reflection can fold into step 10, or be its own step if time allows.)

## Questions that must be in the lab

- At least one trace: given a packet and the rule table, predict the verdict for stateless vs stateful.
- How an automated system halts an attack in real time (step 7).
- A rule change and its impact (step 4 deletes the reply rule, step 6 adds app rules: what still works?).

## Features to build (this lab owns them)

1. **Application criterion in rules.** `FwRule.app?: string` ("web", "remote-control", "ssh", "file-share", ...) matched by `ruleMatches` against the packet's identified application. The rule editor gets an App column (shown only in NGFW mode, or always with "any"). Typed checks in `src/runtime/firewallInput.ts` with messages in this lab's terms.
2. **NGFW identifies the application whatever the port.** Today `ngfw` mode only denies a port/app mismatch under an allow rule. Keep that behavior for the existing lab and add application matching.
3. **NGFW intrusion prevention.** A small signature check on packet payloads in NGFW mode (reuse signatures from `src/sim/ids.ts` if they fit), with a deny log line naming the signature.
4. **Router-hosted firewall in the inspector.** Routers already accept `firewall` (`src/sim/build.ts:66`). Make sure the inspector and rule editor work on a router, with a label that says the software runs inside the router.

`device-analysis` is being built at the same time and also edits `src/sim/firewall.ts` and `src/ui/inspector/FirewallRules.tsx` (it adds host firewalls and a UFW log format). Keep your edits additive: new optional fields, new cases, no reformatting.

Reuse: the firewall engine (`src/sim/firewall.ts`, `fw*` sim methods, actions `fw-*`), `FirewallRules.tsx`, `firewallText.ts`, services and `connectService`, the hospital network in `src/labs/firewall/scenario.ts` (import its builders; don't copy them if you can avoid it).

## Parent-lab trim (do this in the same branch)

- In `src/labs/firewall/index.ts`, remove steps `stateless`, `fake`, and `ngfw`, and their answer-key entries in `solution.ts` and tests. Bump the firewall lab's `version`.
- Add one sentence at the end of Firewall Rulebook pointing to this lab ("Next lab: what kind of firewall A and B should be").
- Update the firewall lab's `PLAN.md` to match. Make no other changes to the firewall lab: its other improvements are a separate pass.

## Done means

All checks in the authoring skill pass (typecheck, tests, walkthrough, playthrough in light, dark, and small, click-through at 4× and 1×) for both this lab and the trimmed firewall lab. `/avoid-ai-writing` run on the student text. PLAN.md in `src/labs/firewall-types/`, set to "Status: built".
