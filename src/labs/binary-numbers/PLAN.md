# Binary Numbers (AP CSP 2.1)

Status: built. Code: `index.ts` (steps), `answers.ts` (answer patterns), `solution.ts` (answer key), `lab.test.ts`. Source lesson plan: `SOURCE.md`.

A self-paced lesson a substitute can run: students learn everything from the screen in about 50 minutes and hand in through the usual report. It has no network. Each step's stage shows **demos** (src/demos, src/ui/demos) instead of the map.

CED: DAT-1.A (bits and bytes, abstraction), DAT-1.B (overflow and rounding with a fixed number of bits), DAT-1.C (binary and decimal conversion, place value).

## Steps

1. **switches**: Light switches. Find every pattern with 1, 2, and 3 switches (2, 4, 8). Predict 4 switches (16) and pick the rule 2ⁿ.
2. **bits**: Bit, byte, 2ⁿ, base 10 vs base 2 place value, binary as an abstraction. One byte seen as voltages, lights, and bits. How many patterns in a byte (256)? What a chip holds (voltage).
3. **cards**: Binary cards 16 8 4 2 1. Make 9, 21, 31. Biggest number and why not 32; each card doubles.
4. **to-decimal**: Worked examples, tap each 1 to add its place value (01001010 = 74, 10010011 = 147). Reading from the wrong end (00000011 is not 192).
5. **practice-decimal**: Worksheet 1 to 5 with a scratch board.
6. **to-binary**: "Does it fit?" worked examples (75, 156). Biggest byte value (255, not 256).
7. **practice-binary**: Worksheet 6 to 10, 8-bit answers.
8. **compare**: First differing place from the left, after lining up lengths. Worksheet 11 and the shortcut.
9. **overflow**: Odometer 995 to 000 and a 4-bit counter 1100 to 0000. Worksheet 14, and overflow means a wrong value, not a crash.
10. **limits**: 0 to 2ⁿ − 1, bits needed for n items, rounding 1/3. Worksheet 12 and 13.
11. **exit**: The 4 exit-ticket questions; the overflow explanation is teacher-graded.
12. **extra** (optional, no goals): hex and ASCII. The step says to hand in first.
13. **submit**.

## Misconceptions answered

- Reading right to left: typed-answer feedback in steps 5 and 7, the step 4 question, and exit Q1 distractors.
- 256 vs 255: step 2 and step 6 questions, worksheet 4 and 10 feedback.
- Comparing different lengths by the first digit: the third compare pair forces "Line them up"; the shortcut question.
- Counting 1s instead of place value: worksheet 1 to 5 feedback, worksheet 11 and exit Q2 distractors.
- Overflow means a crash: step 9 question and its body text.

## Notes for later lessons

The demo API is generic: add a kind in `src/demos/types.ts`, a pure model, and a view. Saved state is per step and demo (`progress.demos["step/demo"]`), so the same scratch board on three steps keeps three separate states.
