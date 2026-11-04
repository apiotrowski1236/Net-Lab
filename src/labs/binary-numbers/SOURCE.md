# Binary Numbers — AP CSP Lesson Plan

Nov 3, 2026 · @Andrew

## Overview

One 50-minute period that takes students from "what is a bit?" to converting and comparing binary numbers by hand, ending on why a fixed number of bits causes overflow.

| Item | Detail |
| --- | --- |
| Course | AP Computer Science Principles |
| CED topic | 2.1 Binary Numbers (Big Idea 2: Data) |
| Length | 50 min (one period) |
| Prior knowledge | Place value in base 10; exponents |

**Learning objectives (CED)**

- **DAT-1.A** Explain how data can be represented using bits.
- **DAT-1.B** Explain the consequences of using bits to represent data (overflow, rounding).
- **DAT-1.C** Calculate the binary equivalent of a positive decimal integer and vice versa; compare and order binary numbers.

**Students will be able to**

1. Define bit and byte, and state that n bits can represent 2^n values.
2. Convert 8-bit binary to decimal and decimal (0–255) to binary.
3. Order a list of binary numbers without converting every one.
4. Explain what happens when a value needs more bits than are available.

## Materials and prep

Prep takes about 15 minutes, mostly printing and cutting card sets.

- **Binary card sets** (1 per group of 3): five index cards labeled 16, 8, 4, 2, 1 with the matching number of dots on the front, blank backs. Make one demo set of eight (128 down to 1) for the board.
- **Practice worksheet** (section below), 1 per student
- **Exit ticket** (section below), half-sheet or Google Form
- **Board setup**: an 8-column place-value header — 128 · 64 · 32 · 16 · 8 · 4 · 2 · 1
- **Optional**: a light switch or flashlight for the hook; a picture of a car odometer for the overflow discussion

## Lesson sequence

The period moves from a physical hook to card-based discovery, then formal conversion, then the limits of fixed bits.

| Time | Segment | What happens |
| --- | --- | --- |
| 0–5 | Hook | Flip a light switch: "How many messages can one switch send? Two switches? Three?" Students predict; tally on the board until the 2, 4, 8 pattern appears. |
| 5–12 | Direct instruction | Define **bit** (one 0/1 value) and **byte** (8 bits). n bits → 2^n values. Compare base 10 place values (1, 10, 100) to base 2 (1, 2, 4, 8…). Note binary is an abstraction: the computer stores voltages; we call them 0 and 1. |
| 12–25 | Binary cards activity | Groups lay out cards 16 8 4 2 1, dots facing up = 1, blank = 0. Challenges: show 9, show 21, show 31. "What's the biggest number you can make? Why can't you make 32?" "What do you notice about the dots on each card compared to the card to its right?" |
| 25–35 | Guided practice | Model both directions on the 8-column board. **Binary → decimal**: add the place values under each 1. **Decimal → binary**: start at 128, ask "does it fit?", write 1 and subtract, else 0. Do 2 together, 2 in pairs (worksheet #1–4). |
| 35–43 | Overflow and comparison | Odometer picture: what happens after 999999? Ask what 4-bit 1111 + 1 becomes (10000 needs 5 bits, so a 4-bit system shows 0000). Then comparing: with equal length, the first position where two numbers differ decides which is bigger. Briefly: real numbers like 1/3 can't be stored exactly, which causes rounding error. |
| 43–50 | Exit ticket | Students complete the 4-question exit ticket individually. Collect to sort tomorrow's warm-up groups. |

## Practice worksheet

Fourteen problems, easiest first; #1–4 are done in class during guided practice, the rest finish as homework.

**Part A — Binary to decimal**

1. 00001010
2. 00101101
3. 01100100
4. 11111111
5. 10000001

**Part B — Decimal to 8-bit binary**

6. 13
7. 50
8. 77
9. 200
10. 255

**Part C — Comparing**

11. Put these in order from least to greatest without converting all of them: 01011010, 00111111, 01010111, 10000000. Explain the shortcut you used.

**Part D — Limits of bits**

12. How many different values can 6 bits represent? What range of whole numbers is that, starting at 0?
13. What is the fewest bits needed to give 100 items each a unique code?
14. A 4-bit counter shows 1110. It counts up 2 more times. What does it show, and why?

## Exit ticket

Four questions in AP exam style; aim for 6 minutes.

1. What is the decimal value of the binary number 01011?
   - A) 9
   - B) 11
   - C) 13
   - D) 22
2. Which of the following is the greatest value?
   - A) Binary 11000000
   - B) Decimal 190
   - C) Binary 10111111
   - D) Decimal 189
3. A school district has 1,200 students. What is the minimum number of bits needed to give every student a unique ID number?
   - A) 10
   - B) 11
   - C) 12
   - D) 1,200
4. **Short answer**: In 1–2 sentences, explain what an overflow error is. Give an example using a 4-bit number.

## Answer key

**Worksheet**

| # | Answer | Work |
| --- | --- | --- |
| 1 | 10 | 8 + 2 |
| 2 | 45 | 32 + 8 + 4 + 1 |
| 3 | 100 | 64 + 32 + 4 |
| 4 | 255 | All eight place values: 128 + 64 + … + 1 |
| 5 | 129 | 128 + 1 |
| 6 | 00001101 | 8 + 4 + 1 |
| 7 | 00110010 | 32 + 16 + 2 |
| 8 | 01001101 | 64 + 8 + 4 + 1 |
| 9 | 11001000 | 128 + 64 + 8 |
| 10 | 11111111 | Largest 8-bit value |
| 11 | 00111111, 01010111, 01011010, 10000000 | Same length, so scan left to right; the first position where they differ decides. (63, 87, 90, 128) |
| 12 | 64 values, 0–63 | 2^6 = 64 |
| 13 | 7 bits | 2^6 = 64 is too few; 2^7 = 128 is enough |
| 14 | 0000 | 1110 = 14; 14 + 2 = 16 = 10000, which needs 5 bits. The 4-bit counter keeps only the last 4 bits: overflow. |

**Exit ticket**

| # | Answer | Why |
| --- | --- | --- |
| 1 | B) 11 | 8 + 2 + 1 |
| 2 | A) Binary 11000000 | 11000000 = 192, 10111111 = 191 |
| 3 | B) 11 | 2^10 = 1,024 is too few; 2^11 = 2,048 covers 1,200 |
| 4 | — | Overflow happens when a result needs more bits than are available, so the stored value is wrong. Example: 1111 (15) + 1 = 10000, but 4 bits store 0000. |

## Differentiation and follow-up

**Common misconceptions**

- Reading binary right to left as if the leftmost bit is worth 1. Anchor on the board header every time.
- Thinking 8 bits can reach 256. The values are 0–255: 256 values, max 255.
- Comparing binary numbers of different lengths by the first digit. Pad with leading zeros first.
- Assuming overflow causes a crash. On the exam it usually means a wrong stored value.

**Support**

- Let students keep the card set or a printed place-value strip during the worksheet.
- Limit Part A/B to 5-bit numbers (0–31) first, then extend to 8.

**Extension**

- Count to 31 on one hand (each finger is a bit).
- Convert to and from hexadecimal; explain why one hex digit equals 4 bits.
- Encode a short word in ASCII binary and trade with a partner to decode.

**Next lessons in Topic 2.1–2.2**

1. Representing text, color (RGB), and images with bits
2. Analog vs. digital data and sampling
3. Lossless vs. lossy compression
