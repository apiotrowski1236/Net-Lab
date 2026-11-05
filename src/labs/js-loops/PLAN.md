# Loops at Arcade Night

Status: built. Code: `index.ts`, `code.ts`, `solution.ts`, `lab.test.ts`.

A guided practice lab for Intro CS, after the lecture on loops and after the arrays lab. Students write loops for one evening at a school arcade night: the countdown to opening, the prize wall, the door code, a guessing game, the prize line, laser tag scores, a broken closing report, and the finals. There is no HTML or DOM here, and no one writes a function.

Each step is a short task. The editor carries the step: `JsCheck`s in `code.ts` name the mistake, and each one has a hint ladder that ends close to the answer. A check decides by running the code with other data. It reads the source only after a failure, to pick the note that names the mistake.

## Steps

| # | id | Task | Practice | Scaffolding |
|---|----|------|----------|-------------|
| 1 | countdown | Count down from 10 to 0, then print Doors open! | `while`, counting down, code after a loop | A working `while` to change |
| 2 | prizes | List prices by 50 up to `top`, and add them up | `for`, counting by steps, a running total | A `for` with one wrong update, and one question |
| 3 | door | Keep asking until the code is `pixel` | a loop around `prompt()` | An `if` to turn into a `while` |
| 4 | guess | A number guessing game with hints and a count | `while`, `prompt()`, if/else, `Math.random`, a counter | One line that picks `secret` |
| 5 | line | Print places in line, and double every token count | walking an array by index, changing it in place | Two arrays and one comment |
| 6 | scores | Print the total, the count of high scores, and the top score | accumulating, counting matches, finding the largest | One array and one comment |
| 7 | report | Fix three broken loops, watching one in Step through | debugging, the loop stop, Something to check | Three bugs, and a required Step through |
| 8 | finals | Build `finalists` from two arrays | `push` inside a loop, matching arrays by index | Two arrays and one comment |
| 9 | reflect | Pick `for` or `while` for two jobs, and describe one bug | choosing a loop | Text question, 40 words |
| 10 | submit | Submit | | |
| 11 | table | Optional extra challenge: the token table | nested loops | No points |

## Decisions

- **The index when it matters.** Places need a number, and doubling has to write to the array, so step 5 needs the index. Finals need `scores[i]` next to `players[i]`, so step 8 does too. The checks decide this by what the code does: `for...of` with a counter of its own passes, and `for...of` with no position fails with a note that explains why.
- **`for...of` elsewhere.** Steps 6 and 7 accept `for...of` wherever it works.
- **A loop around a prompt.** Each prompt pauses the run, so the step budget never ends a loop that keeps asking. The editor has a **Stop** button on a waiting prompt, and a note under the prompt that says why a string never equals a number. Step 4 does not require this mistake. A student who makes it gets the note under the prompt, and the check names the same mistake after they press **Stop**.
- **The report starter is broken on purpose.** It draws four notes and hits the loop stop. No step sets `lintOff`, because every other starter draws no note.
