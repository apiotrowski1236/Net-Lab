# Lab plan: Build a Page with JavaScript (js-dom)

Status: built. Code is in this folder and `src/dom/`.

Intro CS, third JavaScript lab, after arrays and loops. Students have made personal websites in HTML and CSS, and they know variables, prompt, alert, if/else, arrays, and loops. They have not learned functions or objects. The point is automation: a loop can build what would take hours to write by hand.

Tabs are `index.html` (read only in every step), `style.css` (carries from step to step), and `script.js`. Each step starts a new `script.js`, because a chained `prompt()` would fire on every later Run. The page shows the sections a step needs, so a student never faces empty headings.

## Mistakes each step catches

Where a line says "shared", the words come from `src/dom/notes.ts` or `src/js/help.ts` and any page lab gets them.

| Step | Wrong attempt | Caught by |
| --- | --- | --- |
| hello | `getElementById("#title")` | shared help |
| hello | `getElementByID`, `getElementsById` | shared help |
| hello | `getElementById("titel")` | shared help, names the ids that exist |
| hello | `title.textcontent = "x"`, `title.innerHtml = "x"` | shared note |
| hello | `title.textContent("x")` | shared help |
| look | `title.style.background-color = "gold"` | shared syntax help |
| look | `title.style.color = gold` | shared help |
| look | `title.classList.add(".highlight")` | shared note, then the check |
| look | `title.classList.add("highlght")` | shared note, then the check |
| look | `greeting.textContent = "Welcome, Mia!"` | check, with two hidden prompts |
| look | `"Welcome, " + "name"` | check names the quotes |
| look | `let name = prompt("Name?")` with the result never used | check |
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
| grid | `i < 144` | check, with `count` replaced |
| grid | no class, `cell.class = "cell"` | check, and a shared note |
| grid | every square one color | check |
| grid | `"hsl(i, 80%, 60%)"` | check, and a shared note |
| grid | `count` left at 144 | check |
| every | `headings.textContent = "x"` on the list | shared note, then the check |
| every | `querySelector("h2")` | shared fact `firstOnly`, in the check |
| every | `headings.style.color = "red"` | shared help |
| every | `querySelectorAll(".h2")` | shared note |
| every | `headings[0]`, `headings[1]`, `headings[2]` | check, on a page with other headings |
| every | a table of contents typed by hand | check, on a page with other headings |
| cards | one array, or arrays of different lengths | check |
| cards | three cards typed by hand | check, with new arrays |
| cards | a card that shows only one array | check |
| cards | `titles[0]` in the loop | check |
| cards | no `card` class | check |
| extra | `addEventListener("click", addSquare())` | shared note |
| extra | listener added and no square added | check |

## Correct styles each step tests

`textContent` or `innerHTML`, `innerHTML +=`, `append` or `appendChild`, `for` or `for...of`, `classList.add` or `className`, `getElementById` or `querySelector`, `const` or `let`, and an array of objects in the last step. Checks read the final page of a hidden `c.run`, so all of these pass.

## Steps

1. hello: find by id, set `textContent`, on the heading and tagline.
2. look: `style` or `classList`, and a `prompt()` answer on the page.
3. one: `createElement` and `appendChild`.
4. list: an array becomes a list, and one new string makes one new item. One prediction question.
5. grid: a color grid, `count` controls it, and the bar above the preview counts the elements.
6. every: `querySelectorAll` with a loop, then a table of contents from the headings.
7. cards: parallel arrays, written with no starter code.
8. reflect, then submit.
9. Optional extra challenge: `addEventListener` with its shape given. A click is a recorded input.
