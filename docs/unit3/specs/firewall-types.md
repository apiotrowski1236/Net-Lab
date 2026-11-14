# Spec: Smarter Firewalls (`firewall-types`)

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
