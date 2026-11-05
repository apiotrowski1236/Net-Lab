---
name: student-panel
description: Run a panel of simulated high school students (9th to 12th grade, from no background to some coding, with different math, reading, and English levels and ways of learning) through a NetLab lab, each in a private Playwright browser, then fix what they found and run the panel again until no student reports a high-importance problem with how clear, easy to follow, and educational the lab is. Also collects each student's time estimate and checks what they learned. Ends with a PR. Use when asked for a student panel, a student review, or a usability or learning pass on a lab.
---

# Student panel review

You are the developer and the moderator. Six student subagents each do the whole lab in their own browser and report back. Each student ranks every problem they find as high, medium, or low. You check their reports, fix the lab, verify it, commit, and run the panel again. Stop when a round comes back with no high problems. Then open a PR.

The students are subagents named `netlab-student-<id>`, one per persona in [personas.md](personas.md):

| id | Student | Screen |
| --- | --- | --- |
| maya | 10th grade, on level, no CS background | MacBook Air 13, 1470x760 |
| wei | 11th grade, international student still learning English, strong at math | MacBook Air 13, 1470x760 |
| jordan | 9th grade, learns by doing: skims, clicks first | iPad held upright, 820x1180 |
| kayla | 11th grade, learns from pictures, reads below grade level | MacBook Air 13, 1470x760 |
| riley | 12th grade, struggles with math and logic, careful reader | MacBook Air 13, 1470x760 |
| ethan | 10th grade, advanced: has coded, checks technical accuracy | laptop, 1440x900 |

Together they cover the teacher's classes: electives with 9th to 12th graders who differ in what they already know, how strong their math and logic are, how well they read English, and whether they learn best by reading, from pictures, or by doing.

Each one runs at medium effort with its own Playwright MCP server (`mcp__browser-<id>__*`), started fresh for every run. That gives it a private browser with no saved work. Students can't use Bash, files, or the shared `playwright` server. They see only the website.

## Setup

1. **Check the students are installed:** `node .claude/skills/student-panel/install.mjs --check`.
   - If it fails, run it without `--check`. Agent definitions load when a session starts, so tell the user to start a new session, and stop.
   - The agents live in `~/.claude/agents/` on purpose. Claude Code skips MCP servers in a project agent's frontmatter unless the folder is trusted, and a new worktree never is. Each persona has its own server name because agents that share a server name also share one browser.
2. **Get on a branch:** work on your own branch, not `main`. In a fresh worktree, run `npm ci` first if `node_modules` is missing.
3. **Load the `netlab-lab-authoring` skill.** It has the rules for editing a lab. New student-facing text also follows the house style: no em dashes; no simply, just, easy, easier, or obviously; no emoji. The style test enforces these. Write plain, specific sentences with no AI-sounding phrasing.
4. **Build and serve:**
   - Run `npm run build`.
   - Start `node .claude/skills/student-panel/serve.mjs <lab-id>` as a background command with `timeout: 7200000`. The default background limit is 30 minutes, which stops the server partway through the panel. It prints the lab's address and writes it to `/tmp/netlab-panel/<lab-id>/url`.
   - The server reads `dist/` on every request, so later builds show up without a restart.
5. **Preflight:** spawn `netlab-student-maya` once with this prompt: "Setup check, not a lab run: open <url>, then reply with your browser tool prefix, the window size (`browser_evaluate` `() => [innerWidth, innerHeight]`), and the page title." If it replies `SETUP FAILED`, or has no `mcp__browser-maya__` tools, stop and tell the user what it said.
6. **Write the learning check** in `/tmp/netlab-panel/<lab-id>/check.md` before round 1:
   - 6 to 8 short questions with expected answers, at least one for each of the lab's `objectives`.
   - Make them transfer questions: the same ideas applied to new numbers or situations, not copies of the lab's own questions.
   - Students see them only after they hand in their report.
7. **Note the time budget:** the lab's `minutes` field, and that a class period is about 45 minutes.

## A round

1. **Brief.** The prompt for every student holds:
   - the round number, the lab address, and "Do the whole lab and reply with your report";
   - from round 2 on:
     - **What changed since last round:** a short list in student terms, such as "Step 4's instructions now say the bits are buttons". No code.
     - **What you raised last time:** each of that student's high and medium findings, with what you did about it. Either "fixed" or "not changed, because …".

   Never include answers, hints, or the learning check.
2. **Spawn all six in one message.** Use six Agent calls, each with `subagent_type: "netlab-student-<id>"`, `name: "<id>-r<N>"`, `effort: "medium"`, and `run_in_background: false`.
   - Every round uses fresh agents and fresh browsers, so a round's findings always describe the current version.
   - A reply that starts with `SETUP FAILED` doesn't count as a report. Fix the setup and rerun that student.
3. **Learning check.**
   - Once all six reports are in, use SendMessage to send each student (by its round name) the questions from `check.md` in one message. Their answers come back as notifications.
   - Grade each answer: right, partly right, wrong, or "the lab didn't cover it".
   - A wrong answer that traces back to the lab's wording is a misleading finding. An objective that several students say the lab didn't cover is a gap finding. Both are high.
4. **Triage.** Merge the reports into one list. For each finding, record:
   - who raised it, the step, the type (broken, misleading, confusing, pacing, layout, gap), and the quoted words;
   - its severity: high, medium, or low, as the student ranked it. High findings are the blockers.
     - Raise a finding to high if you confirm it's broken or factually wrong, even if the student ranked it lower.
     - Lower one only if you can't reproduce it or you decline it (see below). The student hears why next round.

   If no finding is high, the panel is done. Skip to "When to stop". Otherwise:
   - Reproduce every "broken" claim yourself before you fix it, with the `playwright` MCP tools or the lab's clickthrough script. A student agent can misread a slow page or a flaky tool.
   - Fix every finding: high, medium, and low. Another round is coming anyway, so it will check the small fixes too.
   - When two students want opposite things, look for one change that works for both. For example, Ethan wants less text and Wei wants plainer text: shorter and plainer serves both.
   - Decline a suggestion only when it would make the lab less accurate, hurt another student, or belong to a different lab. Write down why. The student hears the reason next round.
   - Keep what students called good.
5. **Fix.** Edit the lab, and keep its tests, `solution.ts`, answer keys, clickthrough scripts, and `SCRIPT.md`/`PLAN.md` in step with the text.
   - Bump the lab's `version` if step ids or meanings change.
   - Fix shared UI (`src/ui/`) only for a real bug that the students hit. `npm test` covers the other labs' tests, and the playthrough under "Finish" checks them in a browser.
6. **Verify.** Run `npm run -s typecheck`, `npm test`, and `npm run -s build`. The students see the build, so it must pass before the next round. Save the browser checks (the clickthrough and the playthrough) for the final version, under "Finish". The next round's students go through the whole lab in a browser anyway, and they report anything broken.
7. **Commit** on your branch as `Student panel round <N>: <what changed>`.
8. **Log the round** in `/tmp/netlab-panel/<lab-id>/log.md`: each student's count of high, medium, and low findings, their time estimates, the learning-check score, and each finding with what you did about it. The PR is built from this log.

## Time estimates

Each report gives minutes per step and a total. Each round, make a table of each student's total and whether it fits in a class period.

- It's a pacing problem when the median total is more than the lab's `minutes`, or any student needs more than about 55 minutes for the required steps. The optional extra challenge doesn't count. Fix it by cutting or tightening text, merging repetitive practice, or moving material into an optional extra challenge.
- If the lab is fine and only the `minutes` field is wrong, update `minutes` instead.
- Students don't slow down to measure this. The minutes are their estimates for a real classroom.

## When to stop

- **Done:** a round has no high findings, and the learning check shows no gap in the lab. A miss that fits a student's persona, like an arithmetic slip from Riley, isn't a gap. Don't fix that round's medium and low findings, because no round would check the fixes. List them in the PR under "Left for later".
- **Keep going** while any finding is high. There's no fixed round limit.
- **Stuck:** if two rounds in a row produce no new fix and the same high findings come back, stop iterating. That usually means the students want opposite things or a fix needs the teacher's decision. Put those findings in the PR as open questions for the teacher. Never run a round without changing anything.

## Finish: the PR

1. **Run the browser checks** on the final version, with typecheck, test, and build passing too:
   - the lab's clickthrough:
     - `OUT=/tmp/netlab-panel/<lab-id>/ct node scripts/binary-clickthrough.mjs` for binary-numbers
     - `LAB=<lab-id> node .claude/skills/netlab-lab-authoring/clickthrough.mjs` for simulator labs
   - `node scripts/playthrough.mjs`, if you changed shared code (`src/ui/`, `src/store/`, `src/demos/`, `src/sim/`, `src/runtime/`, or the CSS files in `src/`)

   The clickthrough checks the lab's wording, so expect to update its expected text for what the panel changed. If a check finds a real bug in the lab, fix it. If that fix changes what students see, run one more round.
2. Commit, and make sure every round is committed. Push with `git push -u origin HEAD`.
3. Open the PR with `gh pr create --base main --title "<Lab title>: student panel review"`. The body has these sections:
   - **Summary:** rounds run, and how the final round came out.
   - **Panel:** a table with one row per student. Columns: student and need, high findings each round (for example "R1 3 high, R2 1 high, R3 none"), final time estimate, and learning check score.
   - **Time:** median and range of total minutes, compared with the lab's `minutes`.
   - **Changes by round:** what changed and which student it was for.
   - **Suggestions not taken:** each one with the reason.
   - **Left for later:** the medium and low findings from the final round.
   - **Open questions for the teacher:** only if you stopped stuck.
   - **Verification:** the checks you ran.
   - End the body with the PR attribution line from your instructions.
4. Link the PR with the host's PR-linking tool if there is one. Don't merge it.
5. Stop the server with `kill $(cat /tmp/netlab-panel/<lab-id>/pid)`.

## Changing the panel

To change the panel, edit [personas.md](personas.md). To change the student instructions or report format, edit [student.md](student.md), the template. Then run `node .claude/skills/student-panel/install.mjs` and start a new session. To change the Playwright MCP version or Chrome path, edit `install.mjs`.
