---
name: netlab-lab-authoring
description: Condensed rules, APIs, and gotchas for writing or editing a NetLab lab (src/labs/<id>/ index.ts, scenario.ts, solution.ts, lab.test.ts, PLAN.md, SCRIPT.md), its student-facing text, a simulator feature a lab needs (src/sim), or the lab UI (inspector sections, toolkit cards, map zones). Use it whenever you plan, script, build, review, or polish a NetLab lab, so you don't have to reread the codebase first.
---

# Writing a NetLab lab

NetLab is a Preact + TypeScript network simulator for AP Cybersecurity Unit 3. Each lab is a guided lesson on a simulated network. `docs/unit3/ARCHITECTURE.md` is the rulebook, and this skill is its working summary plus what the code teaches the hard way. Open source files only when you need an exact signature.

Best models to copy: `home-network` (intro lab: DHCP, NAT, basic Wi-Fi setup, cable refusals, button outcomes), `build-network` (cables and typed addresses), `on-path` (attack, then defend).

## Files and registration

```
src/labs/<id>/PLAN.md       plan; at the end set "Status: built" and point to the code
src/labs/<id>/SCRIPT.md     optional lesson script (step text, goals, answer key) written before code
src/labs/<id>/index.ts      export const <camelId>Lab: LabDef
src/labs/<id>/scenario.ts   build(): NetBuilder network, constants, read helpers, button helpers, setups
src/labs/<id>/solution.ts   export const <camelId>Solution: LabSolution (the walkthrough test finds it by the "Solution" suffix)
src/labs/<id>/lab.test.ts   vitest tests for this lab
```

Register the lab in `src/labs/index.ts`: import it, put it in `LABS` in CED order, and delete its `STUBS` entry. Current order: home-network, build-network, on-path, mac-flood, dns-spoof, smurf, route-hijack, net-audit, wireless, segmentation, firewall, logs.

## Lab format (src/labs/types.ts)

- **LabDef**: `id, version: 1, title, tagline, unit, codehs[], ced[] ("3.1.B"), minutes (40 to 45), objectives (4), build: () => Sim, steps`. Optional: `captureDevice`, `labelMacs`, `hostRoutes`, `clock`, and `map: { ports?, addresses?: boolean | (d) => boolean, zones?: (sim) => MapZone[] }`.
  - Bump `version` whenever a change would break saved progress: step ids, an action's meaning, or the network a replay builds.
- **StepDef**: `id, title, body (md\`...\`), setup?, actions?, tools?, goals?, questions?, focus?, open?: 'capture'|'tools'|'logs'|{inspect}, kind?: 'submit'`.
- Shape: 9 to 13 steps.
  - Step 1 is a tour: click devices, one easy question. In the first lab it also teaches the app.
  - The last two steps are a reflection (text question, `minWords` about 40) and `kind: 'submit'`. Copy these from build-network or home-network.
- **Goals**: `{ id, label, hint?, check({ sim, ev, since }) }`.
  - A goal latches once true. Check network state and events, never button presses.
  - Helpers in `src/labs/helpers.ts`: `inspected(id)`, `openedFrame(pred)`, `openedLog(pred)`, `happened(sim, since, pred)`, `loggedSince`, `capturedSince`, `pageSince`.
  - `since` is the step's start time. Compare against it so the previous step's work doesn't count.
- **Questions**: 1 or 2 per step.
  - Choice options: `{ id, text, correct?, feedback, last? }`, plus `explain`, `afterGoals?`, `multi?`.
  - Give every wrong option feedback that teaches something.
  - The right answer is no longer than the others, and isn't always the most careful-sounding one.
  - Text questions: `expect` (a regex) or `minWords`. A regex must accept every reasonable format.
- **ActionDef** (lesson buttons): `{ id, label, run(sim), outcome?(sim, since): ActionLine[] }`.
  - `run` is recorded and replayed, so it must be deterministic.
  - `outcome` replaces the usual result lines under the button with `{ tone: 'good'|'bad'|'wait', text }`. It's recomputed live, so return a 'wait' line until the result is in.

## Voice (all student-facing text: bodies, labels, hints, feedback, tool messages)

- The reader is a ninth grader. Short sentences. Use imperatives for instructions: "Press **Print the homework**."
- **Bold** a term the first time it appears, and define it in that sentence or the next. An everyday comparison only where it helps.
- No em dashes. Use a period, comma, or colon. No emoji. Never write "simply", "just", "easy", or "obviously".
- Name devices with chips: `[[deviceId]]`. Name buttons in bold, exactly as labeled.
- Where the sim simplifies, say so once, in one sentence. Example: "(The map draws this print job as one packet, to keep it clear.)"
- Attack labs say once, early: "Everything in this lab happens inside a simulation. ... on a real network without permission is illegal."
- Scan before committing. Grep student text for `—`, ` just `, `simply`, `easy`, `obviously`, `easier`, and emoji.
- Watch apostrophes inside single-quoted strings: `'the family's'` breaks the build. Use double quotes for those strings.

## Determinism and replay

- Saved work is a list of timed `SimAction`s. A reload builds a fresh network and replays them, so `version` matters.
- Never use `Math.random()` or `Date.now()`. Use `sim.rand()`, `sim.randInt(n)`, and `sim.schedule(ms, fn)`.
- Every change a student makes is a `SimAction`. To add one:
  - Add the type and its `applyAction` case in `src/runtime/actions.ts`.
  - Add a `TOOL_FOR` entry in `src/labs/solution.ts`, mapping the action to the tool that must be offered.
  - Add an `assertTypable` case if the student types the input, so the answer key passes the same checks.
- **Setups** run once when a step opens.
  - They are recorded and quiet (`sim.quiet = true`). Their events carry `quiet`, and DHCP binds at once with no messages.
  - Make them idempotent. Keep the student's own valid work, and only fill in what's missing, so a student who skipped ahead still gets a working network.
  - Example: `ensureWifi` keeps the student's SSID and password and only sets defaults when they're missing.
- `playMove` runs `runUntilIdle` after every move. Keep `runUntilIdle` fast. A flood is one `Frame.burst`, not thousands of frames.

## Adding a sim feature (src/sim)

- Put the logic in its own module, `src/sim/<feature>.ts`, with its state types exported there.
- Add one optional field to `Device`, `Iface`, `Frame`, or `IpPacket`, typed from your module.
- In `sim.ts`, add only small hook calls where packets flow. Put public methods in one section at the end, headed `// --- <feature> (<lab id>) ---`.
- New events go in the `SimEvent` union (`src/sim/types.ts`).
- New drop reasons go in `DropReason`. Add their student text in `src/ui/describe.ts`, plus `CANT_SEND` if a browser can hit them.
- A device that logs in real life calls `sim.log(dev, { source, level, msg, fields })`. Write `msg` the way the real device would. Put the facts in `fields` so goals don't parse text.
- Add NetBuilder options in `src/sim/build.ts`. `build()` binds pre-cabled DHCP clients.
- Unit-test the feature in `src/sim/<feature>.test.ts`.

## Shared APIs you can reuse

`ARCHITECTURE.md` › "Shared APIs (merged)" lists the older ones: DNS resolver, switch security, bursts, Wi-Fi, zones, firewall engine, services, VLANs, malware, audit, hardening, VPN, IDS/SIEM, directed broadcast, congestion. home-network added these:

- **DHCP** (`src/sim/dhcp.ts`):
  - NetBuilder: router option `dhcp: { iface, from, to }`, host option `dhcp: true` (no `ip` or `gateway`).
  - Sim methods: `configureDhcpServer`, `configureDhcpClient`, `dhcpStart`, `dhcpBindNow`, `dhcpLeases`.
  - A client asks when its link comes up. Its frames carry `Frame.dhcp`, and each message emits event `type: 'dhcp'`.
  - A MAC gets its old address back. The inspector section is "Connected devices" (`DhcpLeases.tsx`).
- **NAT** (`src/sim/nat.ts`):
  - NetBuilder: router option `nat: { outside, forwards? }`. Sim methods: `configureNat`, `natPublicIp`.
  - Event `type: 'nat'` (`what: 'out' | 'in'`). Rewritten packets carry `IpPacket.nat`, so the capture shows what changed.
  - Unsolicited inbound packets drop with reason `'unsolicited'` and a `source: 'nat'` log line.
  - Port forwarding exists for later labs. The inspector section is "Address sharing (NAT)" (`NatTable.tsx`).
- **Cables**:
  - `{ kind: 'cable', refuse?: CableRefusal[] }`. A refusal is `{ between: [a, b], text }` with a `'*'` wildcard and `{a}`/`{b}` placeholders. The first match wins.
  - `link(a, b, { fixed: true })` makes a cable built into one box. Students can't unplug it.
  - Switches take `named: ['inside']` ports before the numbered ones.
- **Basic Wi-Fi**:
  - `{ kind: 'wifi-config', device, basic: true }` swaps the full Wi-Fi settings for the home "Wi-Fi setup" section (`WifiSetup.tsx`).
  - The setup section covers name, WPA2/WPA3, password, and on/off. It's read-only outside steps that offer the tool.
  - Action `wifi-ssid`. Checks in `toolInput.ts`: `checkWifiSsid`, `checkWifiPassword`, `checkWifiTurnOn`.
  - `sim.setWifiClient(dev, ssid, pass)` joins or leaves a network. `wifiClient.outsider` marks a neighbor who doesn't get the new password when it changes.
- **Other**:
  - Icons `tv` and `console`. The services list has the well-known port `ipp` (631, PRINT).
  - `map.addresses` can take a predicate that picks which devices show addresses.

## UI extension points

- **Toolkit card**: add a `ToolSpec` kind in `types.ts`, write `src/ui/tools/<Name>.tsx`, list it in `TOOL_CARDS` (`src/ui/tools/registry.ts`), and add `TOOL_NAME` in `src/ui/Guide.tsx`.
  - Settings tools (`SETTING_TOOLS`: ip-config, gateway, static-route, wifi-config) don't get their own card. They show in the Dock's "Device settings" card and are edited in the inspector.
- **Inspector section**: write `src/ui/inspector/<Name>.tsx` and list it in `INSPECTOR_SECTIONS` (`registry.ts`) under a `// <lab>` comment.
  - Return null for devices it doesn't apply to. Read from the `sim` prop, which may be a replay.
  - Edit only when `has(kind)` and not `replaying`.
  - Outside its step, render a short read-only summary so the sections below it stay in view.
- **Redraws**: read `void session.simRev.value` in any component that must redraw when the network changes.
- **Parts**: `Toggle`, `ToolMsg`, `useDraft`, and `recentlyChanged` are in `src/ui/tools/parts.tsx`. Reuse the classes `tool-card`, `table`, `table kv`, `pill`, `callout`, `btn tiny`, `seg`, and `tool-row`.
- **CSS**: append to `src/features.css` under a comment naming the lab. Count `{` against `}` afterward. Check dark, light, and 1366x768.
  - `.tool-row` spreads its children to opposite ends. Scope an override if a Save button should sit beside its input.

## Tools per step and the answer key

- A step's `tools` is the whole list for that step. Nothing carries over except the Logs tab once opened.
  - Re-list a tool, with the same options, in every step that uses it.
  - The walkthrough test fails any answer-key move whose tool the step doesn't offer.
- Solution moves: `{ inspect }`, `{ press }`, `{ tool: SimAction }`, `{ openFrame: dev, match }`, `{ openLog: dev, where }`, `{ openFinding, id }`.
  - `text: { questionId: answer }` is needed for every text question. Choice answers come from `correct`.
- Typed checks return `{ ok: false, msg }` with a message in the lab's terms. The answer key goes through them too.

## Tests and checks (all must pass)

```
npm run -s typecheck && npm test
npm run e2e                                   # needs CHROME_PATH=/usr/bin/google-chrome-stable here
LAB=<id> npm run playthrough                  # plus THEME=light SIZE=small
```

- `walkthrough.test.ts` plays every answer key, then checks reload replay, reset, version change, and tool offers.
- `lab.test.ts` should test:
  - the lab's sim behavior with exact event orders,
  - the typed-check messages, word for word,
  - the button outcome lines,
  - that setups keep student work,
  - that a quiet setup emits nothing. Set `sim.quiet = true` around setup helpers when you assert that.
- **The playthrough only shows the final network.** It loads finished progress and pages through steps in review mode, so its screenshots never show a step mid-lesson.
  - To review real step states, run `.claude/skills/netlab-lab-authoring/shots.mjs` from the repo root after `npm run build`.
  - It plays the answer key up to a step, opens the app there, clicks a device or tab, and saves to `/tmp/netlab-shots/<lab>/`.
  - Read every screenshot in dark, light, and small. Look for overlaps.

## Map layout gotchas

- The map is usually **height-limited**. Horizontal room is close to free, but every extra unit of height shrinks everything.
  - The scale is about 0.67 px/unit at 1440x800 and about 0.58 at 1366x768.
  - `fitBox` = device y range (−105 above, +80 + 16 per address line below) plus zones (−24 above, +10 below).
  - Avoid a device above y ≈ 100. It grows the map.
- Wi-Fi reach is part of `fitBox`: power 1 reaches 267 units and power 2 reaches 400. A big circle shrinks the whole map. Keep every Wi-Fi client inside the reach.
- **Browser chips** are 190 px wide (280 to 330 units).
  - A chip sits at the device's label line: to the right if the device is left of the map's center, otherwise to the left.
  - It covers any device beside it at the same height. Put browsing devices where that side is empty, or stagger them by more than 70 units.
- **Port tags** collide on short links. Keep a tagged link at least about 190 units long.
- The **cable hint** (shown all step whenever `cable` is offered) covers the bottom-center 45 to 65 px. Bottom-row labels there are hidden during cabling steps.
- Dashed Wi-Fi lines run through address text under devices above the access point. Markers ("address set", "plugged in") pop above devices.
- Keep device centers at least about 130 units apart.
- Zone labels sit at a rect's top-left, or at the top of a circle.

## Gotchas

- A cable-refusal wildcard (`['*', 'router']`) also refuses moves the answer key needs. Write explicit pairs, and run the walkthrough.
- `recomputeWifi` dedupes "rejected" events per client. To log several wrong guesses, set the client's SSID to `''` between tries.
- A capture needs `dev.sniffing = true` and `dev.captureOwn = true` on the capture device. The map then shows a red eye badge on it.
- `Checked<T>` is a union. Narrow with `r.ok` before reading `r.note`.
- In Playwright, spotlighted devices pulse and never settle. Use `click({ force: true })` on `g.device rect.device-card`.
- Don't edit `README.md`, `docs/unit3/COVERAGE.md`, `docs/unit3/ARCHITECTURE.md`, or other labs' folders, unless asked. Put what they should say in your report.
  - Keep shared edits additive: union members, optional fields, cases. No drive-by refactors.
- Never commit the untracked `pnpm-lock.yaml`. Keep throwaway files in /tmp.
- The local `main` ref may be stale. Find the branch base with `git merge-base` before diffing.

## Final report checklist

Include:

- branch and HEAD;
- each step in one line;
- new shared APIs with paths: types, Sim methods, actions, events, drop reasons, tool kinds, inspector sections, CSS;
- every shared-file edit and why;
- check results and screenshot paths;
- a README row: title, summary, CodeHS, steps, minutes;
- the CED LOs touched;
- rough spots, and what README and COVERAGE should say.
