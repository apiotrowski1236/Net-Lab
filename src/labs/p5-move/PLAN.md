# p5.js: Animation (p5-move)

Status: built. Code: `index.ts`, `code.ts`, `solution.ts`, `lab.test.ts`. The engine is in `src/sketch/` (see p5-draw's plan).

Intro CS, the second p5.js lab. Students know variables, if/else, and functions, and not loops. `draw` running about 60 times a second is the loop they have not learned yet, so this lab gets motion without one.

The live canvas plays the sketch with the real mouse. Checks never read it. They play the student's code in hidden runs with a scripted mouse (`sketch.mouse`, `sketch.press`) and read the shapes frame by frame.

## Steps

| # | id | Task | Practice | Scaffolding |
|---|----|------|----------|-------------|
| 1 | follow | A circle at the mouse, then `background` moved into `draw` | `setup` against `draw`, `mouseX`/`mouseY`, frames | A sketch with `background` in `setup`, and a question on the trail (after the goals) |
| 2 | slide | A circle sliding right, a second sliding down | a variable changed in each frame | `let x = 0` and a circle, and a question on why `x` is at the top |
| 3 | wrap | Back to the left edge after passing `width` | `if`, `width` | The `if` shape in the step text, and a question on a 600-wide canvas |
| 4 | bounce | Turn at both walls, then turn when the edge touches | `speed` as a direction, `width - 25` | A sliding ball with `speed` |
| 5 | press | A color while the mouse is down, and one more change | `mouseIsPressed`, if/else | The student's bouncing ball. In the report |
| 6 | reflect | `draw`, variables at the top, a sketch they would make | | Text question, 40 words |
| 7 | submit | Submit | | |
| 8 | corners | Optional extra challenge: bounce in x and y, new color on each bounce | `height`, `random` | No points |

## Decisions

- **Hidden mouse.** Step 1 plays a mouse path and checks that a circle follows it, so drawing at `(200, 200)` never passes. The trail check reads the order of one frame's calls: a full `background()` before the circle passes, and one after it gets its own note.
- **Tracks by line.** A moving circle is followed by the line that drew it. An if/else that draws the ball from two lines (one per color) still counts as one ball in step 5.
- **Bounce timing.** The checks run 600 to 900 frames and look for the turn, then for where the ball's edge was when it turned. A ball that turns at `x > width` passes the first goal and gets the edge note on the last one.
- **Each step starts fresh** except press, which carries the bounce code, so a broken earlier step cannot block the next one.
