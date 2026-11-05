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
- **StepDef**: `id, title, body (md\`...\`), setup?, actions?, tools?, goals?, questions?, focus?, open?: 'capture'|'tools'|'logs'|{inspect}, kind?: 'submit', extra?: true`.
- Shape: 9 to 13 steps.
  - Step 1 is a tour: click devices, one easy question. In the first lab it also teaches the app.
  - The last two steps are a reflection (text question, `minWords` about 40) and `kind: 'submit'`. Copy these from build-network or home-network.
  - Optional steps go after the submit step, with `extra: true` and a title that starts `Optional extra challenge: `. They earn no points. The school doesn't allow awarding extra credit, so never write "extra credit" or "bonus" anywhere, including plans and handouts.
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
  - A chip goes straight to the tool the step hands out for that device (`src/ui/jump.ts`): its inspector section, scrolled into view with a ring, or its Toolkit card. So "Click [[wifi]] and find **Wi-Fi setup**" lands on Wi-Fi setup.
- Animations run at 1× = a third of real time (`RATE` in `LabPlayer.tsx`). Don't tell students to slow down to 0.5×.
- Where the sim simplifies, say so once, in one sentence. Example: "(The map draws this print job as one packet, to keep it clear.)"
- Attack labs say once, early: "Everything in this lab happens inside a simulation. ... on a real network without permission is illegal."
- Scan before committing. Grep student text for `—`, ` just `, `simply`, `easy`, `obviously`, `easier`, and emoji.
- Run `/avoid-ai-writing` on the student-facing text every time you use this skill. Use its `docs` context. Where it disagrees with this Voice section, this section wins: short sentences and bold terms and button names stay.
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
  - Set `tools` on the entry to the tool kinds students use in it, so lesson chips jump there.
  - Return null for devices it doesn't apply to. Read from the `sim` prop, which may be a replay.
  - Edit only when `has(kind)` (false during a replay).
  - Outside its step, keep it out of the way: a short read-only summary, or a second entry in the `'end'` slot that shows only when the tool isn't offered (see `wifiSetupSummary` in `WifiSetup.tsx`).
- **Redraws**: read `void session.simRev.value` in any component that must redraw when the network changes.
  - This includes a child that reads a signal or uses hooks and gets a mutable sim object as a prop. `@preact/signals` skips re-rendering such a component when its props are shallow-equal, so `dev.sniffing` can change while the component keeps drawing the old value. packet-capture's Start/Stop buttons stayed on **Start** with **Stop** greyed out until `CaptureTools` subscribed.
- **Parts**: `Toggle`, `ToolMsg`, `useDraft`, and `recentlyChanged` are in `src/ui/tools/parts.tsx`. Reuse the classes `tool-card`, `table`, `table kv`, `pill`, `callout`, `btn tiny`, `seg`, and `tool-row`.
- **CSS**: append to `src/features.css` under a comment naming the lab. Count `{` against `}` afterward. Check light (the default), dark, and 1366x768.
  - `.tool-row` spreads its children to opposite ends. Scope an override if a Save button should sit beside its input.

## Coding labs with the js demo

The `js` demo is a JavaScript editor on the stage of a lesson with no network (a `LabDef` with no `build`). `src/js` runs the student's code in the browser: a hand-written parser and interpreter, with no `eval` and no iframe. Copy `src/labs/java-classes/` for the file layout: `index.ts`, `code.ts` (starter code and checks), `solution.ts`, and a test. Intro CS labs go in the `intro` course in `src/curricula.ts`. They set `unit: 0`, and the Guide then prints no unit.

```ts
const sum: JsSpec = {
  kind: 'js',
  id: 'sum',                 // unique in the step: goals and the answer key use it
  title: 'Add up the scores',
  intro: 'Add up every number in `scores`.',
  files: [{ name: 'script.js', text: 'let scores = [4, 8, 15];\n' }],
  step: true,                // adds Step through
  checks: [LOOP, TOTAL],
  from: { step: 'arrays', demo: 'sum' }, // start from the student's code in an earlier step
  report: true,              // put the final code in the teacher's report
  lintOff: ['result-unused'], // for a step that teaches what a rule warns about
};
```

- `files`: `{ name, text, locked? }`. One `script.js` is the common case. With several, every `.js` file runs in the listed order and they share top-level names. A file with any other extension is shown and not run. A syntax error in any file stops all of them.
- `open`: the first tab. Default: the first file.
- `from`: `{ step, demo, files? }`, the same as Java, and a chain across steps works. The starter text in `files` is the fallback when the earlier demo was never touched. `files` limits which files carry over.
- A starter is judged too, so run it once and make sure it draws no "Something to check" note. Bump the lab's `version` if a starter change would confuse saved work.

### Three layers of mistake catching

1. **Errors.** Automatic. A student sees V8's exact wording plus plain help, with a link to the line and the output from before the crash. Syntax help covers commas in a `for` header, a missing `)` or `}` (naming the line that opened it), capitalized keywords, `elif` and `elseif`, curly quotes, unterminated strings, `const` with no value, `let` twice, and reserved words. Runtime help offers "did you mean" from names in scope.
2. **Notes.** Automatic. `src/js/lint.ts` runs when a run finishes and lists "Something to check" under the output. While a prompt waits after at least one answer, the rules in `WAITING_RULES` show too, so a loop that can't end says why. Rule ids, for `lintOff`:
   - `assign-in-condition`: `if (x = 5)`.
   - `semicolon-after-header`: `for (...);`, `while (...);`, `if (...);`.
   - `while-unchanged`: nothing in the body changes the condition's variables. Fires only when the run didn't finish.
   - `index-at-length`: reading exactly `arr[arr.length]`, or `i <= arr.length` in a loop, when the run really read past the end.
   - `assign-push`: `arr = arr.push(x)`.
   - `method-no-parens`: `arr.pop;`.
   - `result-unused`: `str.toUpperCase();`, `arr.slice(1);`, `x + 1;`, `x == 5;`.
   - `shadowed-name`: `let total` in a block hides an outer `total`.
   - `reset-in-loop`: a running total or counter set back to its start inside the loop that adds to it.
   - `prompt-plus`: `+` joined a prompt() answer as text where a number was meant.
   - `prompt-compare`: `===` or `!==` compared a prompt() answer with a number, which never matches.
   - `alert-extra-args`: `alert("a", b)`.
   - `misspelled-property`: a read that gave undefined and sits close to a real name, like `arr.lenght`.
3. **Checks.** Yours, one list per demo.

### Checks and hints

```ts
const TOTAL: JsCheck = {
  id: 'total',
  label: 'Print the total of the list',
  test(c) {
    const r = c.run({ data: { scores: [10, 20] } });
    if (r.dataMissing.length) return 'Keep the variable named `scores`.';
    return r.text === '30' ? undefined : 'Add up `scores` in a loop, so the total changes when the list does.';
  },
  hints: ['Make a variable to hold the total, and start it at 0.', 'Inside the loop, add `scores[i]` to the total.', 'Write `total = total + scores[i];` inside the loop.'],
};
```

- `test(c)` returns what's still wrong, in one or two sentences, or nothing. Put `backticks` around code in notes and hints, and they draw as code. A label is plain text.
- Checks run when a run finishes. They don't run while the program waits at a prompt, and they don't run on a syntax error: the old results stay, under a line saying the checks are waiting.
- Only the first unmet check runs, shows its note, and gets a **Hint** button, so order them from first task to last. Later checks run after it passes, and a test may assume the ones above it passed.
- `hints` is a ladder. The button opens them one at a time, and it works before the first Run. End close to the answer, since a student on the last hint needs to finish. Hints cost nothing, so never count them against a student.
- Goals read `check:<id>`: `check: demoFact('sum', (f) => f['check:total'] === true)`.
- A test that throws becomes a note telling the student to check their variable names. The answer key still has to pass, so this can't hide a broken check. Still, guard against what a student can write: `c.vars.scores` can be anything.

**What `c` has.** `c` is a `JsCheckCtx` (`src/demos/js.ts`), and it extends `Query` (`src/js/query.ts`). Call methods on it (`c.loops()`). Don't destructure them.

- The code: `c.source(file?)` (default: the first file), `c.code(file?)` (the same with comments blanked), `c.programs` and `c.program(file?)` (the syntax tree, `src/js/ast.ts`).
- `c.loops()`: `{ kind: 'for' | 'while' | 'do' | 'for-of' | 'for-in', file, line, test?, head, body, depth, inFunction?, node }`. `head` and `body` are source text.
- `c.calls(name?)`: by last name (`'push'`) or whole name (`'console.log'`): `{ name, callee, receiver?, args, file, line, inLoop, inFunction? }`. `args` are source text.
- `c.declared(name)`, `c.declarations()`: `{ name, kind, file, line, init?, scope: 'top' | 'block' | 'function', inLoop }`.
- `c.functions()`, `c.fn(name)`: `{ name?, params, body, arrow, file, line, node }`. `c.fn` also finds `let f = () => 1`.
- `c.uses(name)`, `c.assigned(name)`: the lines that read or write a name.
- The student's own Run: `c.status` (`'ok' | 'error' | 'limit'`), `c.ok`, `c.output`, `c.text`, `c.vars`, `c.error`, `c.limit`, `c.facts`, `c.notes` (the lint notes).

**`c.run({ prompts?, seed?, data? })`** runs a hidden copy and returns `{ status, ok, output, text, vars, error, limit, waiting, facts, dataMissing }`. The student sees nothing from it.

- `output`: `{ kind: 'log' | 'alert', text, line, error? }[]` in order, with prompts left out. `text` is the same lines joined with newlines. An array reads as `console.log` prints it: `['a', 1]`.
- `vars`: final top-level variables as plain values. Functions read `'[function name]'`. A variable that never got its value is left out.
- `prompts`: answers in order. A string is OK, and null is Cancel. For `confirm`, any string is OK. A run that needs one more answer than it was given stops with status `'waiting'`, and `waiting.message` says which prompt. **A program with a prompt needs `prompts`.**
- `seed`: where `Math.random` starts. Default 1, so a check gives the same result on every Run. The student's own runs use the run count.
- `data`: replaces the first value of named top-level variables, with plain JSON values. **This is the main defense against a student typing the expected output.** A list that prints the right answer with `[1, 2, 3]` has to print a different answer with other data.
  - It works on `let`, `const`, and `var` with a value, a `let a;` set on a later line, and a variable with no declaration.
  - The program can still change the value afterward. A `prompt()` in the replaced value isn't asked.
  - Variables inside a function or a block are not replaced. Check `dataMissing`, which lists names the program never gave a first value to, usually because the student renamed one. Say so in the note.
- Facts for a check: `facts.loops` (`{ file, line, runs }`, how many passes each loop made), `facts.builtinCalls`, `facts.prompts`, `facts.indexAtLength`, `facts.promptPlus`, `facts.promptCompare`, `facts.misspelled`.
- It can't hang. Each hidden run gets 400,000 steps, and all of them together get 1,500,000 per Run. Past that, `run` returns status `'limit'` at once. The same options return the same result without running again, so call it freely.

### Facts for goals

`runs`, `ok`, `waiting`, `error` (a code such as `not-defined`), `errorType`, `limit` (`loop`, `steps`, `output`, or `memory`), `output` (log and alert lines, first 4,000 characters), `notes` (rule ids, space separated), `far`, `finished`, `checks` (all passed), `check:<id>`, `hints` (total opened), `hints:<id>`, `opened:<file>`.

A goal latches, and a check belongs in the demo's list, not in a goal. Use goals to say which checks finish a step. Don't require `hints` to be 0.

### Answer keys

Moves are `{ demo, input }`, the same as Java. The walkthrough test plays them through the model, and `clickthrough.mjs` presses the real controls.

```ts
const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));

loops: { moves: on('sum', { edit: 'script.js', code: DONE }, { run: true }) },
ask: { moves: on('tip', { edit: 'script.js', code: TIP }, { run: true }, { answer: '20' }, { answer: null }) },
```

- `{ edit: file, code }`, then `{ run: true }`. Edits don't run anything. Editing while a prompt waits drops the prompt.
- `{ answer: string | null }`, once per prompt, after the Run. Null is **Cancel**. A confirm takes `{ answer: '' }` for **OK**. Each answer reruns from the top with the same seed, so `Math.random` gives the same numbers throughout one Run. A Run clears the answers.
- `{ stop: true }` presses **Stop** on a waiting prompt. A loop around a prompt never reaches the step limit, and Cancel, Run, and a reload all land on the same prompt, so this is how a student leaves one. The run ends where it stood, and it gets its notes and checks with `c.status` set to `'waiting'`.
- `{ hint: id }` works only for the first unmet check. `{ tab: file }` opens a tab, which `opened:<file>` reports.
- Step through: `{ stepping: true }`, then `{ seek: 1 }`, `{ seek: 2 }`, and so on, then `{ stepping: false }`. The click-through presses **Next** once per seek, so count up by one. A prompt in a step-through takes `{ answer }` at the step that waits, and the same step number then shows what came next.
- A lab needs its click-through at 4× and 1× like any other.

### Language subset

The program runs as a sloppy-mode script. `differential.test.ts` holds the interpreter to real JavaScript for output, error type, error message, and line.

- **Variables and values:** `let`, `const`, `var`, block scope, TDZ, hoisting, per-iteration `for (let ...)` bindings, implicit globals. Numbers, strings, booleans, null, undefined, NaN, template literals, `typeof`.
- **Operators:** all arithmetic, comparison, and logical operators, including `==` with coercion, `??`, compound assignment, `++`, `--`, the ternary, and the bitwise operators.
- **Statements:** `if`, `else`, `while`, `do...while`, `for`, `for...of`, `for...in`, `break`, `continue`, `switch`.
- **Functions:** declarations, expressions, arrows, closures, default parameters.
- **Arrays:** literals, holes, `length`, assignment past the end, `push pop shift unshift indexOf lastIndexOf includes join slice splice concat reverse sort forEach map filter reduce find findIndex some every fill`, `Array.isArray`.
- **Objects:** literals with dot and bracket access.
- **Strings:** `length`, indexing, `charAt indexOf lastIndexOf includes startsWith endsWith slice substring toUpperCase toLowerCase trim split repeat replace padStart padEnd concat`. `replace` takes string patterns only.
- **Numbers:** `Number() String() Boolean() parseInt parseFloat isNaN Number.isInteger toFixed toString`. `Math`: `floor ceil round trunc abs min max pow sqrt random PI`.
- **Input and output:** `alert`, `prompt`, `confirm`, `console.log`, `console.error`. Alerts print in the output panel, marked as alerts, and nothing pops up, so a loop with `alert` doesn't trap a student. `alert(arr)` prints `1,2,3`, and `console.log(arr)` prints `[1, 2, 3]`.

Anything else stops with a plain "not available in this editor" message: `class`, `try`, `async`, regex literals, destructuring, generators, `Date`, spread, `setTimeout`, and the rest. Check that your lab's own code stays inside this list by running it, since an answer key that uses `const [a, b] = x` fails. Property access goes through allowlists, so `constructor` and `__proto__` stop too.

Limits: 5,000,000 steps, 2,000 output lines, 200,000 characters of output, and 1,000 characters on a line (longer lines are cut off, and the program keeps going). A loop that passes 100,000 times with nothing in its condition changing stops early and says what its condition did. The step-through stops after 2,000 steps and says so. Calls nest 900 deep at most, far fewer than Chrome's 11,000 or so, and a call deep in nested expressions can hit the same error sooner.

### A lab with a page (lab 3)

`src/dom` is a small DOM for labs where a script changes a web page, and `src/labs/js-dom/` is the lab to copy. It runs in the pure model, in the browser and in vitest, and its behavior is tested against jsdom (`src/dom/differential.test.ts`). The HTML parser is forgiving like a browser's. `<script>` tags are skipped, and the interpreter runs the `.js` files instead.

```ts
import { pageHosts, pageOfFiles } from '../../dom';

const page: JsSpec = {
  kind: 'js',
  id: 'list',
  title: 'Your code',
  files: [
    { name: 'index.html', text: HTML, locked: true }, // locked, so the page has to come from the script
    { name: 'style.css', text: STYLE },
    { name: 'script.js', text: STARTER },
  ],
  open: 'script.js',
  hosts: pageHosts,        // gives the code `document`
  startPage: pageOfFiles,  // turns on the preview pane
  checks: [ITEMS],
  report: true,
  from: { step: 'one', demo: 'one', files: ['style.css'] },
};
```

- **One script per step.** A chained `prompt()` would fire on every later Run. Carry `style.css` with `from`, and give each step its own locked `index.html` with only the sections that step uses.
- **Judge the page, not the source.** `c.page` is the page after the student's Run, and `c.run()` returns `page` too. A check that reads the page passes `textContent`, `innerHTML`, `append`, and `for...of` alike.
- `PageView` (`src/dom/view.ts`): `all`, `find`, `count`, `exists`, `text`, `texts`, `attr`, `style`, `html`, `made` (elements the script added), and `firstOnly()`, which returns a note when a `querySelector` found the first of several. `PageNode`: `tag`, `id`, `classes`, `text`, `html`, `outer`, `original` (came from the HTML file), `attr()`, `style()`, `all()`. `style('background-color')` also looks in `background`.
- **Hidden runs.** `c.run({ data })` replaces arrays. `c.run({ files: { 'index.html': OTHER } })` runs on other HTML, which catches a list typed by hand. `c.run({ clicks: ['#more', '#more'] })` plays clicks after the last line. A click target is a CSS selector or a path like `1.0.3`.
- **A student may change the data on purpose.** Compare a page to the variable as it ended (`r.vars.favorites`), not to the data you passed in, so `favorites.push("x")` still passes.
- **Notes.** Rule ids are in `PAGE_RULES` (`src/dom/notes.ts`), and `lintOff` takes them too: `id-with-hash`, `class-with-dot`, `class-no-rule`, `selector-no-prefix`, `selector-nothing`, `not-a-property`, `style-unknown`, `style-bad-value`, `never-added`, `list-property`, `moved-same-element`, `tags-as-text`, `element-as-text`, `handler-called`. A check can read them with `c.notes.some((n) => n.rule === 'never-added')` and give its own wording. A runtime error's help comes from `Page.explain` in the same file, and a null from a wrong id lists the ids on the page.
- **Check hints draw backticks only.** A `**` shows as asterisks there. Goal hints go through markdown, so bold works in those.
- **Clicks** are a recorded input, `{ click: target }`, through the pure model. Each click re-runs the program with the same seed and plays the clicks in order, so reload and the answer key replay the same way. An answer-key click must be a CSS selector, because the click-through needs one. The model ignores a click when the code changed since Run, at a prompt, or after an error, and takes at most 300. Facts add `clicks` and `made`.
- **The preview** (`src/dom/preview.ts`, `Preview` in `src/ui/demos/Js.tsx`) is a sandboxed `iframe` with `srcdoc`, with `allow-scripts` for its own bridge and no `allow-same-origin`. The sanitizer removes student scripts and inline `on...` attributes, a nonce CSP backs it up, and the bridge posts clicks and stops links and forms. Images may load from anywhere, so a student can use a picture from the web, but a lab's own content can't depend on that: the site works offline. A page too long to save (`MAX_SAVED`) is rebuilt by running the code again. `[data-preview]` is the queryable container, and the click-through reaches inside with `frameLocator`.
- **Room.** The preview shares a column with the output, and it grows when the output has little to say. Keep a page's header short, or generated content starts below the fold at 1366x768. Long code goes in a fenced block: inline `code` in a step body doesn't wrap.
- **Limits.** A page holds 12,000 elements (error code `page-too-big`). `HostObject` (`src/js/values.ts`) is an abstract class: `label()`, `allow: { get, set, call }`, `get`, `set`, `call`, and `items()` for `for...of`, plus optional `read`, `write`, `asString`, and `pageHooks`. A name outside `allow` stops as not available. `RunOptions.after` runs after the last line.
- **Left out.** Anything needing layout (`getBoundingClientRect`, `offsetWidth`, computed styles), shorthand expansion (`margin` doesn't set `margin-top`), `window`, `this` in handlers, events other than `click` and `DOMContentLoaded`, typing in an `<input>` in the preview, inline `onclick` attributes, `createElementNS`, `<template>` contents, framesets, and the parser's adoption-agency reshuffle for a block inside a formatting tag. `innerText` acts as `textContent`, and `src` and `href` read back as written. Each stops with the "not available in this editor" message or is listed in `src/dom/html.ts`.

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
LAB=<id> npm run playthrough                  # plus THEME=dark SIZE=small
LAB=<id> node .claude/skills/netlab-lab-authoring/clickthrough.mjs   # after npm run build; also SPEED=1. A coding lab goes on through its optional step.
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
  - It plays the answer key up to a step, opens the app there, clicks a device, lesson chip, tab, or captured packet, and saves to `/tmp/netlab-shots/<lab>/`.
  - Read every screenshot in light, dark, and small. Look for overlaps.
- **A lab isn't done until the click-through passes.** The walkthrough, playthrough, and shots all play moves through `LabSession` with `runUntilIdle`, so they can't catch a step a student can't finish in the live player.
  - `clickthrough.mjs` plays the answer key from a fresh profile in the built app. It clicks map devices, lesson buttons, Start and Stop, the Ping card, display filters, captured rows, questions, and Continue, and waits on the live network.
  - On a stuck step it prints the goals left, the capture bar, and the button's result line, saves a screenshot to `/tmp/netlab-shots/<lab>/clickthrough/`, and exits 1.
  - Run it at the default 4× and at `SPEED=1`. A move or tool with no UI driver fails loudly: add one in `doMove`.

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
- The **cable hint** shows all step whenever `cable` is offered. `fitBox` leaves 48 units under the map for it, so cabling steps draw slightly smaller.
- Dashed Wi-Fi lines stop at the edge of each device's name and address box (`wifiEnd`).
- Markers ("address set", "plugged in") pop above devices and can cover a zone label for a few seconds. Tags of one kind on a device merge into one (`Marker.merge`), so they don't stack: give new event tags a `merge` key when several can fire at once.
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
- Keep throwaway files in /tmp.
- The local `main` ref may be stale. Find the branch base with `git merge-base` before diffing.

## Final report checklist

Include:

- branch and HEAD;
- each step in one line;
- new shared APIs with paths: types, Sim methods, actions, events, drop reasons, tool kinds, inspector sections, CSS;
- every shared-file edit and why;
- check results and screenshot paths, including the click-through at 4× and 1×;
- a README row: title, summary, CodeHS, steps, minutes;
- the CED LOs touched;
- rough spots, and what README and COVERAGE should say.
