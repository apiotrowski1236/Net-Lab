---
name: student-panel
description: Run a panel of simulated high school students with different learning needs (on-level, English learner, ADHD, dyscalculia, advanced, low vision) through a NetLab lab, each in a private Playwright browser, then fix what they found and run the panel again until every student approves the lab as clear, easy to follow, and educational. Also collects each student's time estimate and checks what they learned. Ends with a PR. Use when asked for a student panel, a student review, or a usability or learning pass on a lab.
---

# Student panel review

You are the developer and the moderator. Six student subagents each do the whole lab in their own browser and report back. You check their reports, fix the lab, verify it, commit, and run the panel again. Stop when all six approve in the same round. Then open a PR.

The students are subagents named `netlab-student-<id>`, one per persona in [personas.md](personas.md):

| id | Student | Screen |
| --- | --- | --- |
| maya | on-level 10th grader, no CS background | Chromebook, 1366x768 |
| luis | English learner, reads English at about a 5th-grade level | Chromebook, 1366x768 |
| jordan | ADHD: skims, clicks first | iPad held upright, 820x1180 |
| riley | dyscalculia and math anxiety | Chromebook, 1366x768 |
| ethan | advanced, checks technical accuracy | laptop, 1440x900 |
| ava | low vision: 200% zoom, mostly keyboard | 683x384 |

Each one runs at medium effort with its own Playwright MCP server (`mcp__browser-<id>__*`), started fresh for every run. That gives it a private browser with no saved work. Students can't use Bash, files, or the shared `playwright` server. They see only the website.

## Setup

1. **Check the students are installed:** `node .claude/skills/student-panel/install.mjs --check`.
   - If it fails, run it without `--check`. Agent definitions load when a session starts, so tell the user to start a new session, and stop.
   - The agents live in `~/.claude/agents/` on purpose. Claude Code skips MCP servers in a project agent's frontmatter unless the folder is trusted, and a new worktree never is. Each persona has its own server name because agents that share a server name also share one browser.
2. **Get on a branch:** work on your own branch, not `main`. In a fresh worktree, run `npm ci` first if `node_modules` is missing.
3. **Load the `netlab-lab-authoring` skill.** It has the rules for editing a lab. New student-facing text also follows the house style: no em dashes; no simply, just, easy, easier, or obviously; no emoji. The style test enforces these. Write plain, specific sentences with no AI-sounding phrasing.
4. **Build and serve:**
   - Run `npm run build`.
   - Start `node .claude/skills/student-panel/serve.mjs <lab-id>` as a background command. It prints the lab's address and writes it to `/tmp/netlab-panel/<lab-id>/url`.
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
     - **What you raised last time:** each of that student's blockers, with what you did about it. Either "fixed" or "not changed, because …".

   Never include answers, hints, or the learning check.
2. **Spawn all six in one message.** Use six Agent calls, each with `subagent_type: "netlab-student-<id>"`, `name: "<id>-r<N>"`, `effort: "medium"`, and `run_in_background: false`.
   - Every round uses fresh agents and fresh browsers, so an approval always means the current version.
   - A reply that starts with `SETUP FAILED` doesn't count as a verdict. Fix the setup and rerun that student.
3. **Learning check.**
   - Once all six reports are in, use SendMessage to send each student (by its round name) the questions from `check.md` in one message. Their answers come back as notifications.
   - Grade each answer: right, partly right, wrong, or "the lab didn't cover it".
   - A wrong answer that traces back to the lab's wording is a misleading finding. An objective that several students say the lab didn't cover is a gap finding.
4. **Triage.** Merge the reports into one list. For each finding, record:
   - who raised it, the step, the type (broken, misleading, confusing, pacing, layout, gap), and the quoted words;
   - whether it is a blocker. Blockers are anything in a REVISE verdict, plus anything broken or misleading.

   Then:
   - Reproduce every "broken" claim yourself before you fix it, with the `playwright` MCP tools or the lab's clickthrough script. A student agent can misread a slow page or a flaky tool.
   - Fix every blocker. Fix minor findings when the fix is cheap and doesn't hurt another student.
   - When two students want opposite things, look for one change that works for both. For example, Ethan wants less text and Luis wants plainer text: shorter and plainer serves both.
   - Decline a suggestion only when it would make the lab less accurate, hurt another student, or belong to a different lab. Write down why. The student hears the reason next round.
   - Keep what students called good.
5. **Fix.** Edit the lab, and keep its tests, `solution.ts`, answer keys, clickthrough scripts, and `SCRIPT.md`/`PLAN.md` in step with the text.
   - Bump the lab's `version` if step ids or meanings change.
   - Fix shared UI (`src/ui/`) only for a real bug that the students hit. Then check that the other labs still pass.
6. **Verify.** All of these must pass:
   - `npm run -s typecheck`, `npm test`, and `npm run -s build`
   - the lab's clickthrough:
     - `OUT=/tmp/netlab-panel/<lab-id>/ct node scripts/binary-clickthrough.mjs` for binary-numbers
     - `LAB=<lab-id> node .claude/skills/netlab-lab-authoring/clickthrough.mjs` for simulator labs
   - `node scripts/playthrough.mjs`
7. **Commit** on your branch as `Student panel round <N>: <what changed>`.
8. **Log the round** in `/tmp/netlab-panel/<lab-id>/log.md`: each verdict and time estimate, the learning-check score, and each finding with what you did about it. The PR is built from this log.

## Time estimates

Each report gives minutes per step and a total. Each round, make a table of each student's total and whether it fits in a class period.

- It's a pacing problem when the median total is more than the lab's `minutes`, or any student needs more than about 55 minutes for the required steps. Extra credit doesn't count. Fix it by cutting or tightening text, merging repetitive practice, or moving material into extra credit.
- If the lab is fine and only the `minutes` field is wrong, update `minutes` instead.
- Students don't slow down to measure this. The minutes are their estimates for a real classroom.

## When to stop

- **Done:** all six reply APPROVE in the same round, and the learning check shows no gap in the lab. A miss that fits a student's persona, like an arithmetic slip from Riley, isn't a gap.
- **Keep going** while there are fixes to make. There's no fixed round limit.
- **Stuck:** if two rounds in a row produce no new fix and the same blockers come back, stop iterating. That usually means the students want opposite things or a fix needs the teacher's decision. Put those blockers in the PR as open questions for the teacher. Never run a round without changing anything.

## Finish: the PR

1. Make sure the final checks pass and every round is committed. Push with `git push -u origin HEAD`.
2. Open the PR with `gh pr create --base main --title "<Lab title>: student panel review"`. The body has these sections:
   - **Summary:** rounds run, and the final verdict.
   - **Panel:** a table with one row per student. Columns: student and need, verdict each round (for example "R1 REVISE, R2 REVISE, R3 APPROVE"), final time estimate, and learning check score.
   - **Time:** median and range of total minutes, compared with the lab's `minutes`.
   - **Changes by round:** what changed and which student it was for.
   - **Suggestions not taken:** each one with the reason.
   - **Open questions for the teacher:** only if you stopped stuck.
   - **Verification:** the checks you ran.
   - End the body with the PR attribution line from your instructions.
3. Link the PR with the host's PR-linking tool if there is one. Don't merge it.
4. Stop the server with `kill $(cat /tmp/netlab-panel/<lab-id>/pid)`.

## Changing the panel

To change the panel, edit [personas.md](personas.md). To change the student instructions or report format, edit [student.md](student.md), the template. Then run `node .claude/skills/student-panel/install.mjs` and start a new session. To change the Playwright MCP version or Chrome path, edit `install.mjs`.
