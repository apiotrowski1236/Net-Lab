# JavaScript Arrays: The Dance Playlist (Intro CS)

Status: built. Code in `index.ts`, `code.ts` (starting code and hidden checks), and `solution.ts`. Tests in `lab.test.ts`.

The first of three Intro CS JavaScript labs: arrays, then loops, then the DOM. A lecture on arrays comes first, so this is guided practice, not teaching. Students know variables, `prompt()`, `alert()`, and basic if/else. They have not learned functions, objects, or loops. No required step uses a loop, and a working loop always passes. There is no HTML and no DOM.

Students run the music for the spring dance, so every array in the lab is a playlist, a request list, or a list that goes with one. All song titles are invented.

Target: 45 minutes.

| # | Step | Min | What the student does | Mistakes it catches |
| --- | --- | --- | --- | --- |
| 1 | warmup | 4 | Runs code, opens a hint, prints with `console.log`, steps through | quoted name, `alert` in place of `console.log`, one index, `Console.log`, typo in `playlist` |
| 2 | make | 4 | Fills in three arrays: strings, numbers, and an empty one | `()` and `{}` for `[]`, missing comma, no quotes, one long string, quoted numbers, `[""]`, `""` |
| 3 | read | 5 | Predicts `playlist[5]`, then prints the third song, the count, and the last song | `arr[3]` for the third, `arr.length()`, `arr[arr.length]`, fixed index, typed answers, `length - 1` as the count |
| 4 | change | 4 | Replaces two songs and adds a vote, on `const` arrays | counting from 1, reassigning a `const`, retyping the array, `arr[arr.length] = x`, `votes[2] = 16`, `votes[2] + 1;` |
| 5 | edges | 6 | Uses `pop`, `push`, `shift`, and `unshift` in order | `arr[3] = x` for push, `arr = arr.push(x)`, `arr.push[x]`, `arr + x`, forgetting what `pop` gives back, popping twice, `shift` and `unshift` swapped, `arr[0] = x` for unshift |
| 6 | search | 7 | Writes an if/else from a `prompt` with `includes` and `indexOf` | `request === banned`, quoted `"request"`, `banned.includes` with no parentheses, case sensitivity, printing the index, `spot > 0`, treating -1 as a position |
| 7 | show | 5 | Replaces a raw `alert` with `join`, and picks a random song | bare commas, `join()`, unused `join`, typed lists, no `floor`, `Math.round`, `+ 1`, `Math.random` with no parentheses, fixed length, printing the index |
| 8 | program | 9 | Writes the request line with one comment of help | no prompt, overwriting a spot, adding a duplicate, no message, `alert(arr)`, count or list printed too early, a pick that never changes |
| 9 | reflect | 2 | Explains `arr[arr.length]` and -1 to a friend | |
| 10 | submit | | Hands in | |
| 11 | remove | extra | Removes a song by name with `splice` | `splice(-1, 1)` removing the last song, `spot > 0`, `pop`, one argument to `splice`, a fixed index |

## Scaffolding

Steps 1 to 4 start from nearly complete code. Step 5 gives a one-line comment and a reminder table. Step 6 gives the arrays and the prompt. Step 7 gives the array and the bare `alert`. Step 8 gives one comment.

## How the checks work

- Every check that can decide by running does so, with `c.run({ data })` and a longer list. A student who types an answer, retypes the array, or writes a fixed index fails on that list.
- Source text only picks which note to show, after a run has already shown the code is wrong.
- `isList` drops lines that print a whole list, so `console.log(playlist)` never passes "print the third song".
- Random picks run on 40 seeds. A fixed multiplier shows up as a pick that never reaches the end of the longer list.
- The request line answers extra prompts with the same song, then Cancel, so a student who asks their name first still passes.

Syntax errors never reach a check, so `{1, 2, 3}` and a missing comma are caught by the editor's error help. `lab.test.ts` proves those word for word too.
