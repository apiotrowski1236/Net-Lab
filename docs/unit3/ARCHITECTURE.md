# Building a Unit 3 lab: architecture and conventions

Every new lab follows this page. Several labs are built at the same time on separate branches, then merged. Following it keeps them consistent and keeps the merge clean.

Read these first:

1. `README.md`, sections "Labs" and "How a lab works": what students and teachers see.
2. `src/labs/types.ts`: the whole lab format (steps, goals, questions, tools).
3. `src/labs/build-network/` (newest lab, best model for step flow and tools) and `src/labs/on-path/` (best model for an attack-then-defend lab).
4. The header comment of `src/sim/sim.ts`: what the simulator models and what it skips on purpose.
5. Your lab's `PLAN.md` and `docs/unit3/COVERAGE.md`.

## Files for one lab

```
src/labs/<id>/
  PLAN.md        the plan (update it if you change course, and mark it done at the end)
  index.ts       the LabDef: steps, goals, questions, actions
  scenario.ts    builds the network (NetBuilder) and exports addresses and helpers
  solution.ts    the answer key: export const <camelId>Solution: LabSolution
  lab.test.ts    lab-specific tests (vitest)
```

Register the lab in `src/labs/index.ts`: import it, add it to `LABS` at the position below, and delete its `STUBS` entry. Home page order follows the CED: `build-network`, `on-path`, `mac-flood`, `dns-spoof`, `smurf`, `route-hijack`, `net-audit`, `wireless`, `segmentation`, `firewall`, `logs`.

`src/labs/walkthrough.test.ts` finds your `solution.ts` by itself and plays the lab start to finish, checks ids, reloads, resets, and version changes. It must pass with no changes to that file.

## The lab

- 9 to 13 steps, about 40 to 45 minutes. `version: 1`. Fill `ced` with LO codes ("3.1.A"), `codehs` with the CodeHS lessons in the plan, and `objectives` with 4 bullets.
- Step 1 is a tour: click devices, one easy question. The last two steps are a reflection step (a teacher-graded written question with `minWords` around 40) and a `kind: 'submit'` step. Copy their shape from `build-network`.
- Attack labs alternate: see it work, do the attack, see the evidence (detection), turn on the defense, try the attack again and watch it fail. Students play the attacker and then the defender.
- Attack labs say once, early: "Everything in this lab happens inside a simulation. [Doing this] on a real network without permission is illegal."
- Every step has goals that check themselves, with a `hint` on any goal that isn't obvious. Goals check what happened on the network (`happened`, `loggedSince`, `pageSince`, device state), not button presses.
- Questions: 1 or 2 per step. Every wrong option gets `feedback` that teaches something. Write the right answer no longer than the others, and don't let it always be the most careful-sounding one. Use `last: true` for "Both" or "None of these". Use `afterGoals: true` for a question about something the student is about to see. Each question gets an `explain`.
- Short-answer questions with `expect` accept every reasonable format (see the route-hijack AS path regex and its test).

### Voice (student-facing text: bodies, labels, hints, feedback, tool messages)

- Short sentences. Imperatives for instructions ("Press **Alice signs in**. Watch the switch.").
- **Bold** a term the first time it appears, and define it in the same sentence or the next.
- No em dashes (use a period, comma, or colon). No emoji. No "simply", "just", "easy", or "obviously".
- Name devices with chips: `[[deviceId]]`. Name buttons in bold, exactly as labeled.
- Plain words before jargon. A ninth grader who finished the earlier labs is the reader.
- Keep it accurate. If the simulation simplifies something, say so in one sentence rather than teach something false.

## The simulator

The simulator is deterministic and replayed. A student's saved work is a list of `SimAction`s with times. A reload builds a fresh network and replays them. So:

- Never use `Math.random()` or `Date.now()` in the sim or in a step setup. Use `sim.rand()` and `sim.randInt(n)`.
- Every change a student makes to the network is a `SimAction` (`src/runtime/actions.ts`): add a type, an `applyAction` case, and an `assertTypable` case in `src/labs/solution.ts` if the student types the input.
- Step `setup` runs once, recorded. Make it idempotent and keep a student's own valid work where it can (see build-network's setups). Setup events are tagged `quiet`.
- Put a new feature's logic in its own module, `src/sim/<feature>.ts`, with its state types exported from there. Add one optional field to `Device` (or `Iface`, `Frame`, `IpPacket`) typed from your module. In `sim.ts`, add only small hook calls where packets flow, plus public methods in one section at the end of the class headed `// --- <feature> (<lab id>) ---`.
- New events go in the `SimEvent` union. New drop reasons go in `DropReason`, with student text in `src/ui/describe.ts` (`pingFailText` and friends) and `CANT_SEND` if a browser can hit them.
- Devices that would log in real life call `sim.log(deviceId, { source, level, msg, fields })`. Write `msg` like the real device would, and put the facts in `fields` (src, dst, proto, sport, dport, mac, ip, ssid, rule, action, user, count) so goals and filters don't parse text. Seed history in a setup with the `at` argument (negative times are before the lab starts). Set `LabDef.clock` if the story needs a time of day.
- Never put hundreds of frames in flight. A flood is a few aggregated frames (`Frame.burst`, built by `mac-flood`), not hundreds of real ones. Keep `runUntilIdle` fast: the walkthrough test plays every lab.
- Unit-test your sim feature in `src/sim/<feature>.test.ts`.

## The interface

Shared pieces built for these labs (wave 0):

| Need | Use |
|---|---|
| A Toolkit card for your tool | Add a `ToolSpec` kind in `src/labs/types.ts`, write `src/ui/tools/<Name>.tsx`, list it in `TOOL_CARDS` (`src/ui/tools/registry.ts`). Add its name to `TOOL_NAME` in `src/ui/Guide.tsx`. |
| Settings or tables inside a device | Write `src/ui/inspector/<Name>.tsx` and list it in `INSPECTOR_SECTIONS` (`src/ui/inspector/registry.ts`). Return null for devices it doesn't apply to. Read from the `sim` prop (it may be a replay). No editing while `replaying`. |
| Toggles, tool messages, Save boxes, flashing rows | `src/ui/tools/parts.tsx`: `Toggle`, `ToolMsg`, `useDraft`, `recentlyChanged` |
| A building, a signal's reach, a DMZ, a VLAN on the map | `LabDef.map.zones(sim)` returning `MapZone`s |
| Logs | The `{ kind: 'logs', devices: [...] }` tool unlocks the Logs tab. `open: 'logs'` opens it. Goals: `openedLog(pred)`, `loggedSince(...)`. Solution move: `{ openLog: deviceId, where: (e) => ... }` |

Typed inputs: the student types addresses, prefixes, MACs, ports, SSIDs. A check function (like those in `src/runtime/toolInput.ts`) returns `{ ok: false, msg, suggest? }` with a message that explains the mistake in this lab's terms ("That's Mallory's MAC, the one from the forged ARP replies."). The answer key goes through the same checks.

Look and feel: use existing classes (`tool-card attack` or `defend`, `table`, `pill`, `callout`, `btn`) and CSS variables. Append new CSS to `src/features.css` under a comment naming your lab. Check both themes (dark is the default; the theme button is in the top bar) and a 1366x768 window, where the dock is short.

Map coordinates are a 1000 x 600 canvas. Keep device centers at least about 130 apart so names and tags fit.

## Checks before you finish

1. `npm run typecheck`, `npm test`, and `npm run build` pass. `npm run e2e` still passes (needs Chromium; see below). `LAB=<id> npm run playthrough` passes: it plays your solution.ts, loads the result into the built app, and checks every step shows its goals done with Continue ready, no sideways scroll, and no page errors.
2. Play the whole lab in a real browser as a first-time student would: `npx vite preview --port <a free port, 4200 or above> --strictPort`, then drive it with Playwright (`node_modules/playwright-core`, Chromium at `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, or set `CHROME_PATH`). Seed a profile with `localStorage['netlab:v1:profile'] = '{"id":"s1","name":"Test Student","period":"1"}'`. Use a 1366x768 window. Read every screen: is the next action obvious, does each message make sense, does anything overlap? Fix what confuses. No page errors in the console. Keep screenshots in `/tmp/netlab-<id>/`.
3. The lab guide (`#/guide/<id>`) reads well.

## Working alongside other labs

Four labs are built at once on separate branches, and merged afterward. To keep merges clean:

- Don't edit `README.md`, `scripts/e2e.mjs`, `docs/unit3/COVERAGE.md`, `docs/unit3/ARCHITECTURE.md`, or other labs' folders. The orchestrator updates those after merging. Put anything they should say in your final report.
- Keep edits to shared files small and additive: add union members, cases, fields, and functions. Don't reorder, reformat, or rename existing code. No drive-by refactors.
- Build only the core features your lab owns (table below). If you need something another lab in your wave owns, build the smallest stand-in inside your lab's folder and say so in your report.
- Commit to your branch as you reach working milestones, with messages that end in the `Co-Authored-By` line you were given. Don't push, rebase onto other branches, or merge.

### Who builds what

Later labs reuse these, so design them as shared, documented APIs, not one-offs.

| Core feature | Built by (wave) | Reused by |
|---|---|---|
| Device logs, Logs tab, tool and inspector registries, map zones, `sim.rand` | orchestrator (0) | everyone |
| Services and ports on hosts; client connections to a service (request and reply, with ports); a port-scan primitive | `firewall` (1) | `segmentation`, `net-audit`, `logs` |
| Firewall engine: ordered ACL rules, first match, direction, stateless, stateful, next-gen; firewall log lines; rule editor; "which rule matched" explanations | `firewall` (1) | `segmentation`, `smurf`, `net-audit`, `logs` |
| Switch MAC table limit and eviction; `Frame.burst` aggregated frames and how the map draws them; MAC flooding; changing a host's MAC; port security (max MACs, violation action, allowed MACs); shutting a port | `mac-flood` (1) | `smurf`, `net-audit`, `logs`, `segmentation` |
| Recursive DNS resolver with cache and TTL; query IDs; forged DNS answers; resolver defenses; web access logs | `dns-spoof` (1) | `logs` |
| Wi-Fi access points: SSID, beacons, security mode, WPS, signal reach on the map, MAC filtering, EAP; association; Wi-Fi scanner; cracking; rogue AP; evil twin; jamming | `wireless` (1) | `net-audit`, `logs` |
| VLANs on switches; malware that spreads laterally; zone policy matrix (on the firewall engine) | `segmentation` (2) | |
| Directed broadcasts; forged source IP; link capacity and congestion drops; traffic-rate meter | `smurf` (2) | `logs` |
| Vulnerability scanner and report; Telnet vs. SSH; router and switch hardening settings; VPN and split tunneling; risk register | `net-audit` (2) | |
| IDS and IPS (signature, anomaly, hybrid); SIEM correlation; AI scores and threshold; alert triage | `logs` (2) | |

### Shared APIs (merged)

Where to read each merged feature before you use it. Reuse these; extend them additively if they fall short.

- **DNS resolver** (`dns-spoof`): `src/sim/dns.ts` (resolver state, TTL cache, query IDs and ports); the resolver section of `src/sim/sim.ts` (`forgeDnsAnswer`, `setResolverHardened`, `flushResolverCache`); `NetBuilder` host option `resolver: { upstream, ttl }`. Log lines: `source: 'dns'` on the resolver (query, cache hit, hardening, flush; `cached` with `fields: { name, ip, from, ttl }`, level `notice` when a record changed), `source: 'web'` on every web server (`fields: { src, method, path, host }`). Frames with `forged: true` stay marked across hops.
- **Switch security** (`mac-flood`): `src/sim/switchsec.ts` (header explains it; opt in per switch with `sim.configureSwitch(id, { tableSize })`). Sim methods `setPortSecurity`, `setPortShutdown`, `setMac`; read helpers `portUp`, `macTableUse`, `macsOnPort`, `portLabel`. Actions `port-security`, `port-shutdown`, `set-mac`, `mac-flood`; typed checks in `src/runtime/switchInput.ts`. Inspector section `switch-ports`. Log sources on the switch: `link` (`%LINK-3-UPDOWN`, `%LINK-5-CHANGED`), `mac-table` (`%SW_MATM-4-TABLE_FULL`), `port-security` (`PSECURE_VIOLATION`, `ERR_DISABLE`). Drop reasons `port-shutdown`, `port-security`.
- **Bursts** (`mac-flood`): `src/sim/burst.ts`. `Frame.burst { count, vary: 'src-mac' | 'src-ip' | 'none', seed }` makes one frame stand for many; the map draws a "×N" stack. Send one with `sim.sendBurst(dev, body, burst, delay)`; pass `ip` for a ping flood. Use it for any flood instead of thousands of frames.
- **Wi-Fi** (`wireless`): `src/sim/wifi.ts` holds the pure models (`signalAt`, `reach`, `crack`, `clientPasses`, `triangulate`, `passphraseStrength`). An access point is any device with `Device.wifi` (NetBuilder `switch`/`hub` option `wifi`); a client has `Device.wifiClient` (host option `wifiClient`). Association is derived, never stored: every Wi-Fi setter (`setWifiSecurity`, `setWifiPassphrase`, `setWifiPower`, `setWifiBeacon`, `setWifiWps`, `setWifiAuth`, `setWifiMacFilter`, `setWifiOff`, `setWifiJam`, `setMac` on a client) ends with `sim.recomputeWifi()`. Attacker moves: `wifiCrack`, `wifiScan`, `wifiMeasure`. Actions `wifi-*`; sim event `type: 'wifi'`; log source `wifi`. Tool kinds `wifi-config` (a settings tool), `wifi-scan`, `wifi-crack`, `triangulate`; inspector section `wifi-settings`.
- **Map zones** (`wireless`): `LabDef.map.zones(sim)` returns `MapZone[]` (rect or circle, label, tone, dashed), drawn under the cables and recomputed as the network changes. Use it for buildings, a signal's reach, a DMZ, or a VLAN.

## Your final report

End with:

- Branch name and HEAD commit.
- What the lab teaches, step by step, in one line each.
- New shared APIs other labs can use (types, `Sim` methods, events, tool kinds, inspector sections, CSS), with file paths.
- Every edit to a shared file outside your lab's folder, with one line each on why.
- Test results (`typecheck`, `test`, `build`, `e2e`), what you checked in the browser, and screenshot paths.
- What's left, known rough spots, and anything README or COVERAGE should say.
