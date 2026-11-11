# Draw with Code (p5-draw)

Status: built. Code: `index.ts`, `code.ts`, `solution.ts`, `lab.test.ts`, and the p5.js engine in `src/sketch/` with its canvas in `src/ui/demos/Sketch.tsx`.

Intro CS, the first of three p5.js labs, for students who finish the main work early. They know HTML, CSS, variables, prompt/alert, if/else, and functions. They have not learned loops, arrays, or classes, so no step needs them. This lab draws still pictures: everything happens in `setup`, and `draw` waits for p5-move.

Each step is one editor with `sketch: true`. The student's code runs in the editor's own interpreter with p5.js names added, and the canvas sits where the js-dom page preview goes. Checks read the shapes a hidden run drew, not the source, so any way of writing the picture passes.

## Steps

| # | id | Task | Practice | Scaffolding |
|---|----|------|----------|-------------|
| 1 | canvas | Change the background, put a circle in the middle | `createCanvas`, `background`, x and y with y down | A sketch with a canvas, and a question on `circle(50, 350, 40)` |
| 2 | shapes | Three circles inside a traffic light box | `rect` corners against `circle` middles | The box, and a question on its far corner |
| 3 | color | Box color, red/yellow/green lights, outlines | `fill`, `stroke`, `strokeWeight`, order of calls | The student's light from step 2, and a question on fill order |
| 4 | picture | A picture of their own: 6 shapes, 2 kinds, 3 colors | planning coordinates, more shapes | A shape reference in the step text. In the report |
| 5 | move | A face drawn from `x` and `y` that moves with one change | variables in expressions | A face with 10 typed numbers, and a question on `x - 30, y - 20` |
| 6 | reflect | Their picture, and how variables would move it | | Text question, 40 words |
| 7 | submit | Submit | | |
| 8 | stamp | Optional extra challenge: `drawFace(x, y)` called three times, with a mouth and a color parameter | parameters | No points |

## Decisions

- **Shapes, not pixels.** The engine records each shape with its box, colors, and line. A check asks "which circles are inside the box" or "is the top light red", and names the shape by its line: "the circle from line 12".
- **Colors by name.** `hueOf` sorts a color into red, orange, yellow, green, blue, purple, pink, brown, white, black, or gray, so `"crimson"`, `"#e00"`, and `fill(220, 20, 60)` all count as red. Yellow accepts orange, because many yellows students pick read as orange.
- **Misspelled colors.** p5.js draws an unknown color name as white and keeps going. The engine adds a note under the output naming the word, and every check stops first with a line pointing at that note, so `"skyblu"` never passes as a background change.
- **Step 5 runs twice.** The check moves the face with `data` (x and y at two places) and compares each shape's offset. A shape that stays put is named, so a student who missed the mouth learns which line.
- **Errors in a hidden run.** When the check's run hits an error the student's own Run did not, the note quotes the line and the error instead of "your code stopped".
