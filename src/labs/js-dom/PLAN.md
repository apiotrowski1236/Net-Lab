# Lab plan: Build a Page with JavaScript (js-dom)

Status: built. Code is in this folder and `src/dom/`.

Intro CS, third JavaScript lab, after arrays and loops. Students have made personal websites in HTML and CSS, and they know variables, prompt, alert, if/else, arrays, and loops. They have not learned functions or objects. The point is automation: a loop can build what would take hours to write by hand.

Tabs are `index.html` and `style.css` (both read only in every step) and `script.js`. Syntax reminders sit in the step text, not in a `note` demo, so the editor, preview, and output fit on one screen at 1366x768. Each step starts a new `script.js`, because a chained `prompt()` would fire on every later Run. The page shows the sections a step needs, so a student never faces empty headings.

## Mistakes each step catches

Where a line says "shared", the words come from `src/dom/notes.ts` or `src/js/help.ts` and any page lab gets them.

| Step | Wrong attempt | Caught by |
| --- | --- | --- |
| hello | `getElementById("#title")` | shared help |
| hello | `getElementByID`, `getElementsById` | shared help |
| hello | `getElementById("titel")` | shared help, names the ids that exist |
| hello | `title.textcontent = "x"`, `title.innerHtml = "x"` | shared note |
| hello | `title.textContent("x")` | shared help |
| hello | `title.style.background-color = "gold"` | shared syntax help |
| hello | `title.style.color = gold` | shared help |
| hello | `title.classList.add(".highlight")` | shared note, then the check |
| hello | `title.classList.add("highlght")` | shared note, then the check |
| one | made and never added | shared note, then the check |
| one | `about.appendChild("text")` | shared help |
| one | added to `document.body` | check |
| one | `createElement("<p>")`, `createElement(p)` | shared help |
| one | `about.textContent = "x"` | check |
| list | `createElement` once, above the loop | shared note, then the check |
| list | `list.textContent = favorites[i]` | check |
| list | `i <= favorites.length` | check |
| list | `i < 3` | check, with five hidden strings |
| list | `list.innerHTML = "<li>..."` in the loop | check |
| list | `list.append("<li>...")` | shared note, then the check |
| list | three `<li>` strings typed by hand | check, with five hidden strings |
| list | `item.textContent = favorites`, or `favorites[0]` | check: every item shows the same text |
| grid | `i < 144` | check, with `count` replaced |
| grid | no class, `cell.class = "cell"` | check, and a shared note |
| grid | every square one color | check |
| grid | `"hsl(i, 80%, 60%)"` | check, and a shared note |
| grid | `count` left at 144 | check |
| every | `headings.textContent = "x"` on the list | shared note, then the check |
| every | `querySelector("h2")` | shared fact `firstOnly`, in the check |
| every | `headings.style.color = "red"` | shared help |
| every | `querySelectorAll(".h2")` | shared note |
| every | `querySelector("h2")` with the loop from the reminder | shared note on `length`, then the check |
| every | `classList.add(".accent")` | shared note, then the check |
| every | a class with no rule, like `big` | shared note, then the check |
| every | `headings[0]`, `headings[1]`, `headings[2]` | check, on a page with other headings |
| contents | a table of contents typed by hand | check, on a page with other headings |
| contents | an element used as text | shared note |
| contents | `item.appendChild(headings[i])`, which moves the headings | check |
| contents | `item.textContent = headings` | check: every item shows the same text |
| cards | one array, or arrays of different lengths | check |
| cards | three cards typed by hand | check, with new arrays |
| cards | a card that shows only one array | check |
| cards | `titles[0]`, or the whole arrays, in the loop | check |
| cards | no `card` class | check |
| cards | the `h3` and `p` added to `cards`, not the card | check |
| extra | `addEventListener("click", addSquare())` | shared note |
| extra | listener added and no square added | check |
| extra | a mistake inside the function that shows only on a click | check says to click and read the error |

## Correct styles each step tests

`textContent` or `innerHTML`, `innerHTML +=`, `append` or `appendChild`, `for` or `for...of`, `classList.add` or `className`, `getElementById` or `querySelector`, `const` or `let`, and an array of objects in the last step. Checks read the final page of a hidden `c.run`, so all of these pass.

## Steps

1. hello: find by id, set `textContent`, on the heading and tagline, then change the heading's look with `style` or `classList`. One prediction question: the file stays as it was after a Run.
2. one: `createElement` and `appendChild`.
3. list: an array becomes a list, and one new string makes one new item. One prediction question.
4. grid: a color grid, `count` controls it, and the bar above the preview counts the elements.
5. every: `querySelector` against `querySelectorAll`, then a loop over the matches.
6. cards: parallel arrays, written from an outline in comments.
7. reflect, then submit.
8. Optional extra challenge: a table of contents built from the headings, starting from `querySelectorAll`.
9. Optional extra challenge: `addEventListener` with its shape given. A click is a recorded input.

The student panel moved the prompt greeting out of the lab and the table of contents into the optional steps, because round 1 ran 54.5 minutes at the median.

Round 3 locked `style.css`, because three students typed their script into that tab and got a note about the wrong line. The goal for clicking in step 10 became a check, so the list under the code matches the Goals box.
