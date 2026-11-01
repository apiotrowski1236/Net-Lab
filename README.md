# NetLab

Interactive network-security labs for AP Cybersecurity, Unit 3 (Securing Networks). Students watch packets move on a simulated network, then play attacker and defender. The lesson, the network map, and the questions live on one screen. Work saves to the browser as students go, the site works offline, and a finished lab can go straight to a Google Sheet.

Nothing in NetLab touches a real network. Every device, packet, and attack is simulated in the browser.

## Quick start

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
cd netlab
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173). The first visit asks for a name and class period.

To try it from a student laptop on the same Wi-Fi, run `npm run dev -- --host` and open the `Network:` address it prints. Offline mode is off over plain `http://` on another machine (browsers only allow it on `https://` or `localhost`), but saving still works.

## Labs

| Lab | CodeHS lessons | Steps | Time |
|---|---|---|---|
| **From Cable to Web Page**: build a network from loose parts. Plug in cables, give each device an IP address, set default gateways, and add static routes until Alice's browser loads a page from a server two routers away. Then troubleshoot a broken computer one layer at a time | 3.1 | 13 | ~45 min |
| **Traffic in the Wrong Hands**: sniff a password on open Wi-Fi, see WPA2 stop it, ARP-poison your way into the middle, watch HTTPS defeat you, then lock ARP entries | 3.1, 3.2, 3.7 | 13 | ~45 min |
| **Flood the Switch**: plug into an open lobby jack, flood the office switch's MAC table until it repeats everyone's traffic, find the flood in the switch's log, stop it with port security, beat MAC filtering by spoofing a printer, then shut unused ports | none | 11 | ~45 min |
| **Wrong Directions**: poison a school district's DNS resolver with forged answers, send students to a fake gradebook, see HTTPS warn, find the attack in the logs, then make query IDs unpredictable | 3.3 | 11 | ~45 min |
| **Advertise a Bad Route**: hijack a bank's prefix with BGP, black-hole it, out-compete the real route with a more specific prefix, impersonate the bank, then deploy route origin validation | 3.1, 3.3 | 10 | ~40 min |
| **The Network Audit**: audit a food bank's office with a signed scope letter. Run a vulnerability scanner, see a Telnet password in the clear, rate each finding's likelihood and impact (high, moderate, low), then apply router, switch, Wi-Fi, and VPN policies and re-scan until only the accepted risk remains | none | 12 | ~45 min |
| **Signals Past the Walls**: secure an emergency shelter's Wi-Fi. Hear it from the parking lot, turn the signal down, hide the name, test WEP, WPA2, WPS, and WPA3 against a cracker, beat a copied MAC with per-user login, unplug a rogue access point, triangulate an evil twin, spot a jammer, then write the wireless policy | 3.7 | 12 | ~50 min |
| **Walls Inside the Network**: split a submarine's flat network into zones. Watch malware spread from a crew laptop to every computer, then plan security zones, put each zone in its own VLAN and subnet, write a zone policy on the core firewall, watch the same malware stop at the wall, and shut an unused port | 3.8 | 11 | ~45 min |
| **Firewall Rulebook**: protect Adams County Hospital. Scan a wide-open network, place two firewalls to build a screened subnet, write and order the edge firewall's rules, lock down the inner firewall, compare stateless, stateful, and next-generation firewalls, then read the firewall log | 3.10, 3.12 | 12 | ~45 min |

The home page also lists the planned labs as "coming soon": smurf attacks and log analysis. Together with the labs above they cover every topic in the CED's Unit 3. [docs/unit3/COVERAGE.md](docs/unit3/COVERAGE.md) maps each learning objective to a lab, each lab's plan is in `src/labs/<id>/PLAN.md`, and [docs/unit3/ARCHITECTURE.md](docs/unit3/ARCHITECTURE.md) is the guide for building one.

### How a lab works

- **Steps** have a short reading, buttons that make things happen on the network ("Alice signs in"), **goals** that check themselves when the student does the thing, and **questions**.
- Multiple-choice and short-answer questions check themselves. A wrong answer gets a hint, and the student tries again. There is no "show me the answer" button; you are the help in the room.
- Students can change any answer at any time, even one already marked correct. Changing it clears the old result until they check again. The report always shows the latest answer.
- Multiple-choice options appear in a shuffled order that is the same for every student, every reload, and the printed guide, so the right answer isn't always first.
- Written-response questions are graded by you. They show a word count and a target length.
- **Continue** unlocks when every goal and question in the step is done. Students can always go back to review. The step menu (top left) jumps to any step they've reached.
- Tools (packet capture, ARP spoofer, route announcer, defenses) appear in the **Toolkit** tab as the lesson hands them out. Students type addresses into the tools themselves (the IP to impersonate, the prefix to announce, the MAC to lock). The tool checks what they typed and explains a mistake, for example "That's Mallory's MAC, the one from the forged ARP replies."
- **Reset network** puts the network back the way the current step set it up. Answers and finished goals stay.

### Helping a confused student

- **Replay step** (above the map) plays back everything the student did on the network in this step, on a copy of the network. Turn on **Repeat** to loop it. The inspector shows the replayed network, so students can watch an ARP table change. **Back to live** returns to the real network. Doing anything on the network also ends the replay.
- Each step starts with a "Builds on step N" row. **Reread** opens the previous step; **Watch again** replays it.
- **Guide** (top of the lesson) opens every step of the lab on one page in a new tab: the reading, the buttons, the goals, the hints, and the questions (no answers). Students keep it open for notes. Print it for a paper reference; it always prints in black on white. The address is `#/guide/on-path` or `#/guide/route-hijack`.

### Teacher override

If a step is broken for a student (a bug, a browser problem), you can unlock **Continue** with a password.

1. Set a password once: run `npm run set-password`, or open the site's `#/teacher` page, which makes the line for you. Either way, only a salted SHA-256 hash goes in `config.json`, never the password. Use at least 8 characters and nothing you use elsewhere: students can read `config.json`, so a short password could be guessed offline.
2. On a stuck step, a small **Teacher override** link appears under the step. Type the password and, if you like, a note about what went wrong.

The step's unfinished goals stay unchecked and earn no points. The report, the downloaded file, and the Google Sheet all flag the step as unlocked by a teacher, with the time and your note. Wrong passwords are counted on the report too, and three wrong in a row lock the override for a minute. With no password set, students never see the link.

### Finishing a lab

The last step replaces the map with a summary: percent complete, goals, points, minutes, the skills the lab covered, every step with its status (and a **Go there** button for unfinished ones), and every answer with a **Change** button. From there students hand in their work.

### Answer keys

Each lab has a solution file that doubles as the answer key, including sample answers for the written questions:

- `src/labs/on-path/solution.ts`
- `src/labs/route-hijack/solution.ts`

Multiple-choice answers are marked `correct: true` in each lab's `index.ts`. The app never loads the solution files, so they are not sent to students' browsers. They are in the source code, though: keep the repository private if students could find it.

## Saving and offline

- Every answer, completed goal, and network action saves to the browser's local storage within a third of a second, and again the instant the tab is hidden or closed. A backup copy guards against a half-written save.
- Reopening the site returns the student to the lab and step they left.
- After the first visit, the whole app is cached. It opens and runs with no internet.
- The top bar always shows the save state: **Saved**, **Offline (still saving)**, and, if submissions are set up, when the last copy reached you.
- Work lives in that browser on that computer. A different computer or a different Chrome profile starts fresh. On shared computers, students use **I'm a different student** in the name menu, which keeps each student's work separate.
- If storage is blocked (some locked-down profiles), the app warns the student before they start.

### Restoring from a report file

Every downloaded report also carries the student's full progress. If a browser loses its saved work (Safari does this after a week away, see [Browser support](#browser-support)), the student opens the report with **Open saved work** on the home page and picks up where they left off. **Save backup** on a started lab's card downloads the same file mid-lab.

To keep students from handing in a classmate's file as their own:

- A report only opens for a student signed in with the same name (capitals and extra spaces don't matter).
- The saved work in the file is signed. Editing the file, for example to change the name in it, makes NetLab refuse it.
- Every restore shows on the report and in the Google Sheet with the name the file was saved under, flagged when that differs from the name handing it in.
- Each attempt at a lab has a **Work ID**, shown on the report and in the Sheet, and it stays the same through a restore. Two students with the same Work ID means one opened the other's file. The Sheet turns those cells red.

This all runs in the browser, so a student who reads NetLab's source code could get around it. It stops casual copying and makes copying visible.

## Getting student work

There are two ways. You can use both.

### Option 1: Google Sheet (recommended)

Reports land in a Google Sheet, one tab per lab and one row per student. Rows update as students work (every 2 minutes while the lab is open, and when they close the tab) and again when they press **Submit**. Submissions made offline go out automatically when the computer reconnects.

1. Create a Google Sheet, for example "NetLab Submissions".
2. In the sheet, open **Extensions > Apps Script**. Replace the sample code with the contents of [`receivers/google-apps-script/Code.gs`](receivers/google-apps-script/Code.gs). Save.
3. **Deploy > New deployment**. Choose type **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Deploy and authorize.
4. Copy the web app URL (it ends in `/exec`).
5. Paste it into `public/config.json` as `submitEndpoint` and rebuild (or edit `config.json` directly on the server; no rebuild needed).
6. Open the URL in a browser. It should say `NetLab receiver is running.`

Each row has the student's name and period, status (`in-progress` or `submitted`), auto-checked score, goals done, step reached, active minutes, timestamps, and one column per question with the student's answer. Auto-checked answers are tagged `[correct]` or `[not yet]`. **Teacher overrides** lists any steps unlocked with the override password, and **Wrong override passwords** counts failed tries; both cells turn yellow when they aren't empty, and answers in an overridden step are tagged `[step overridden]`. **Work ID** and **Restored from file** come from [restoring from a report file](#restoring-from-a-report-file); they turn red when work looks copied. Grade in the **Teacher score** and **Teacher notes** columns. NetLab never overwrites those two.

If you set up the sheet before these columns existed, paste the new `Code.gs` over the old one and choose **Deploy > Manage deployments > Edit > Version: New version**. The URL stays the same.

"Anyone" access means anyone with the URL can add rows. The URL is not secret (it's in `config.json`), so treat the sheet as a convenience, not a gradebook of record.

### Option 2: Report file

With no `submitEndpoint` set, one button, **Submit and download my report**, marks the lab finished and downloads the report. Students hand in that file themselves, for example by uploading it to Schoology. The summary reminds them that their teacher doesn't have it until they do. The report is one HTML file. It opens in any browser and prints cleanly. It lists every step with its goals and answers, the auto-checked score, timestamps, the Work ID, any teacher overrides, and any restores. The same file restores the student's work if their browser loses it.

## Settings

`public/config.json` (in the built site, `config.json` next to `index.html`):

```json
{
  "courseTitle": "AP Cybersecurity",
  "teacherName": "",
  "periods": ["Period 1", "Period 2", "Period 3", "Period 4", "Period 5", "Period 6", "Period 7"],
  "submitEndpoint": "",
  "autoSyncMinutes": 2,
  "teacherPasswordHash": ""
}
```

| Setting | What it does |
|---|---|
| `courseTitle` | Shown on the home page. |
| `teacherName` | Used in "Delivered to ..." after a submit. |
| `periods` | Choices in the name dialog. Use `[]` for a free-text box. |
| `submitEndpoint` | Google Apps Script URL (see above). Empty means download/print only. |
| `autoSyncMinutes` | How often in-progress copies go to the sheet. `0` turns that off (submits still send). |
| `teacherPasswordHash` | Turns on the teacher override (see above). Empty means no override. |

The app re-reads `config.json` each time it opens (and remembers the last copy when offline), so you can change settings on the server without rebuilding.

## Testing

```bash
npm test          # simulator and lab walkthrough tests (a few seconds)
npm run typecheck # TypeScript
npm run e2e       # build, then drive the real app in Chromium and save screenshots
npm run playthrough  # build, then page through every lab's answer key in Chromium
```

`npm test` plays every lab from the first step to the last using its solution file and fails if any step can't be finished. It also checks that a reload rebuilds the same network, that **Reset network** keeps answers, and that a student can't skip ahead.

`npm run e2e` builds the site, opens it in headless Chromium at 13-inch MacBook Air size (1440×800; `SIZE=small` for 1366×768, `THEME=light` for the light theme), plays the first steps of a lab through the real interface, changes an answer, replays a step, reloads to confirm the work was saved, goes offline to confirm the app still loads, opens the guide (screen and print), types a wrong and a right address into the ARP spoofer, uses the teacher override, submits and downloads from the summary page, and restores the work from that download on a fresh browser (and refuses it for a different student or after the file is edited). It also opens every lab and its guide. It writes screenshots to `screenshots/`. It needs a Chromium for Playwright. If it can't find one, run `npx playwright-core install chromium` or set `CHROME_PATH` to a Chrome binary.

`npm run playthrough` plays each lab's solution file in Node, loads the finished work into the built app, and pages through every step with **Continue**. Each step must show its goals done, with no sideways scrolling and no page errors. That also proves the saved actions replay to the same network in the browser. `LAB=<id>` checks one lab. Screenshots go to `screenshots/playthrough/`.

To check offline by hand: `npm run build && npm run preview`, open the preview address, do part of a lab, then turn on **Offline** in Chrome DevTools (Network tab) and reload.

## Browser support

NetLab runs on Chrome and Edge 87+, Firefox 78+, and Safari 14.1+ (macOS, iPad, and iPhone). The build is compiled for those versions, and it avoids newer browser features (or falls back when they're missing).

- **Downloads** use a standard file download, which works in all of the above. Safari may ask where to save, or put the file in Downloads without asking, depending on its settings.
- **Safari clears storage** for a site that hasn't been used in 7 days of Safari use. A student who leaves a lab unfinished in Safari for more than a week may lose it. Most students use Safari on MacBooks, so this one matters: have them **Save backup** (or download their report) before a long break, and use **Open saved work** if their progress is gone. Submissions to the Google Sheet are safe.
- **Private or guest windows** lose saved work when the window closes.
- NetLab asks the browser to keep its storage when space runs low (`navigator.storage.persist()`).

## Deploying

### GitHub Pages (recommended)

NetLab lives at [github.com/apiotrowski1236/Net-Lab](https://github.com/apiotrowski1236/Net-Lab) and is published at **https://apiotrowski1236.github.io/Net-Lab/**.

`.github/workflows/deploy.yml` runs on every push to `main`: it runs the tests, builds the site, and publishes it. The site uses relative paths, so it works under any repository name.

One-time setup, by the repository owner: open **Settings > Pages** and set **Source** to **GitHub Actions**. Then push to `main`, or run **Deploy to GitHub Pages** from the **Actions** tab.

To change settings on the live site, edit `public/config.json` on GitHub and commit; the workflow redeploys in about a minute.

The repository is public, because GitHub Pages is free for public repositories. Anyone can read the answer keys in `solution.ts`, including sample answers to the written questions. Multiple-choice answers ship to the browser either way, because the app checks them. To hide the source, either make the repository private (Pages then needs a paid plan, or a GitHub Team organization, which GitHub Education gives verified teachers for free), or keep the source private and publish only the built `dist/` folder from a separate public repository.

### Other hosts

```bash
npm run build
```

Upload the `dist/` folder to any static web host. It uses relative paths, so it works at a domain root or in a subfolder.

- **Netlify or Vercel**: build command `npm run build`, output directory `dist`. Both deploy from a private repository on their free plans.
- **School web server**: copy the contents of `dist/` into a folder.

Offline mode needs `https://`. All of these hosts provide it.

After you deploy an update, a student's browser picks it up the second time they open the site (the first visit after the update still uses the cached copy).

## Project layout

```
public/config.json           teacher settings
receivers/google-apps-script Google Sheets receiver
scripts/e2e.mjs              browser check + screenshots
scripts/playthrough.mjs      every lab's answer key, step by step, in the browser
scripts/set-password.mjs     sets the teacher override password
.github/workflows/deploy.yml GitHub Pages build and deploy
sw/sw-template.js            offline service worker (filled in at build time)
src/
  sim/                       the network simulator (no UI code)
    sim.ts                   devices, frames, ARP, switching, routing, BGP, DNS, HTTP(S)
    build.ts                 NetBuilder: describe a network in a few lines
    sim.test.ts              attack and defense scenarios
  labs/
    index.ts                 list of labs shown on the home page
    types.ts                 what a lab, step, goal, question, and tool look like
    helpers.ts               building blocks for goal checks
    shuffle.ts               seeded order for multiple-choice options
    build-network/           From Cable to Web Page (scenario, lesson, solution)
    on-path/                 Traffic in the Wrong Hands (scenario, lesson, solution)
    route-hijack/            Advertise a Bad Route (scenario, lesson, solution)
    walkthrough.test.ts      plays every lab start to finish
  runtime/                   one student's session: goals, answers, step replay, tool input checks
  store/                     local saving, profile, reports, submission outbox, teacher override, restore from a report file
  ui/                        Preact components (lab player, summary, guide, teacher page)
  styles.css                 themes and core layout
  features.css               replay, summary, guide, override, and tool-input styles
```

### How saving works under the hood

The simulator is deterministic: the same actions at the same simulated times always produce the same network. NetLab saves the list of actions a student took (not the network itself) and replays them on reload. Answers, completed goals, and the current step are saved directly.

If you change a lab's steps after students have started, bump its `version`. Students with older progress keep their answers and goals; only the network resets.

## Adding a lab

1. **Build the network.** Create `src/labs/<id>/scenario.ts` with a function that returns a `Sim`. Use `NetBuilder`: `.host()`, `.router()`, `.switch()`, `.hub()`, `.link()`. Place devices with `x` (0 to 1000) and `y` (0 to 600); the map zooms to fit them. Add a test in `src/sim/sim.test.ts` that the attack and the defense do what you expect.
2. **Write the lesson.** Create `src/labs/<id>/index.ts` exporting a `LabDef`. Each step has a markdown `body` (write `[[deviceId]]` for a clickable device chip), optional `actions` (lesson buttons), `tools`, `goals`, `questions`, and a `setup` that restores whatever the step needs if the student reset the network or a teacher overrode an earlier step. Use the helpers in `src/labs/helpers.ts` for goal checks. For a lab where students build the network, leave addresses out of the scenario, give switches `ports`, and turn on the `cable`, `ping`, `ip-config`, `gateway`, and `static-route` tools. Set `map: { ports: true, addresses: true }` to label ports, show live addresses, and tag each MAC address a switch learns on the map. Setups in that kind of lab should finish earlier steps without undoing the student's own valid choices; see `src/labs/build-network/scenario.ts`. With the `cable` tool on, students also plug in cables by dragging from one device to another on the map, and unplug one by clicking it. Changes a `setup` makes don't put tags on the map, so a setup can break something for students to find. Mark a question `afterGoals: true` when it asks about something the student is about to see; it stays locked until the step's goals are done. Options are shuffled for students; mark "Both" or "None of these" options `last: true` to keep them at the end. End with a step that has `kind: 'submit'`.
3. **Write the solution.** Create `src/labs/<id>/solution.ts` with the moves and text answers for each step, and add it to `SOLUTIONS` in `src/labs/walkthrough.test.ts`. Tool moves go through the same input checks a student's typing does, so the test fails if the lesson asks for something the tool would reject.
4. **Register it** in `LABS` in `src/labs/index.ts` (and remove its "coming soon" entry from `STUBS`).
5. Run `npm test` and `npm run e2e`, then try it yourself with `npm run dev`.

Lesson text follows the house voice: short sentences, imperatives, terms in bold the first time they appear, no em dashes, no emoji.
