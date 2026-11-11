# Make a Game (p5-game)

Status: built. Code: `index.ts`, `code.ts`, `solution.ts`, `lab.test.ts`. The engine is in `src/sketch/` (see p5-draw's plan).

Intro CS, the third p5.js lab. Students build a catch-the-target game: a gold player moved with the arrow keys, a red target, a score, a win, and an optional timer. Everything uses if statements, variables, and one function. No loops or arrays.

The live canvas takes the keys once it has focus, and arrow keys stop scrolling the page while it does. Checks play scripted key presses (`sketch.keys`) in hidden runs and read `x`, `y`, `score`, and the shapes frame by frame.

## Steps

| # | id | Task | Practice | Scaffolding |
|---|----|------|----------|-------------|
| 1 | keys | All four arrow keys move the player | `keyIsDown`, the arrow constants | The right-arrow if, and a question on which line moves up |
| 2 | walls | Stop at all four edges, with the player's edge on the wall | ifs against `width`, `height`, and the radius | The student's code from step 1 |
| 3 | target | Score on a catch, move the target, show the score | `dist`, radiuses, `random`, `text` with `+` | `movePlayer()` as a function, `tx`, `ty`, `score`, and a question on a 60-wide target |
| 4 | win | Stop at 5 with a message | `noLoop()`, `>=` | The student's game from step 3, and a question on what `noLoop` freezes. In the report |
| 5 | reflect | How the catch works, how to make it harder, what to add | | Text question, 40 words |
| 6 | submit | Submit | | |
| 7 | timer | Optional extra challenge: a 20-second countdown that ends the game | `frameCount % 60`, remainder | No points |

## Decisions

- **Held keys.** The keys check holds each arrow for 10 frames and compares `x` and `y` before and after, then checks the player circle is drawn at `(x, y)`. The walls check holds each arrow for 150 frames and names the side that went past, stopped too early, or jumped.
- **Catches with data.** The catch check puts the player 10 pixels from the target with `data`, then 45 apart, so a typed score never passes and a distance of 50 is caught as too loose.
- **The win reads `score`.** The check starts a run with `score` at 4 and the player on the target, and expects the game to stop within a few frames. A second run starts at 3 and must not stop early.
- **The timer counts seconds.** It reads `timeLeft` at frames 1, 61, 121, and 181. A timer that drops 5 or more in its first 10 frames is counting frames, and the note says so.
- **Arrow names.** `RIGHT` is a real p5.js constant (`"right"`), so `keyIsDown(RIGHT)` runs and is never true. A note under the output names `RIGHT_ARROW`. Names p5.js lacks, like `UP` or `ArrowLeft`, stop with an error whose help names the right constant. Both live in `src/sketch/host.ts`.
