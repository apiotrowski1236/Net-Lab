# Lab 3.1 - Hijacked SSH and Mitigation Part 1 (answer sheet)

Status: built. Code: `index.ts` (questions), `solution.ts` (sample answers for the tests), `lab.test.ts`.

## What it is

An answer sheet, not a guided lab (`LabDef.worksheet`, `src/ui/Worksheet.tsx`). Students do CYBER.ORG's
"APCySec Lab 3.1 - Hijacked SSH And Mitigation Part 1" on the CYBER.ORG Range (apps.cyber.org) from the
PDF handout. NetLab holds only the questions, so students type answers as they go and hand in the usual
report. The handout's instructions stay on the handout.

## Source

The handout has four sections. Every numbered item that asks for something is a question here, with the
handout's number as its `label`, and the prompt is the handout's question with a few words of context so a
student can match it. Items that only give instructions (A2 to A4, A6, B3, B4, B6, C2 to C4, C7) have no
question.

| Section | Questions |
| --- | --- |
| A. Examine the Recon File | A1 `hostname -I`, A5 FTP username and password, A7 first SSH attempt |
| B. Looking for the Key | B1 file name, B2 what security.db holds, B5 how to prevent the key leak |
| C. Using John the Ripper (JtR) and the RSA Key | C1 password guesses, C5 cracked password, C6 second SSH attempt |
| D. Putting It All Together | D1 the user's mistakes, D2 why not FTP, D3 how to move a key |

Every question is teacher-graded at the default 2 points (24 in all). Answers differ per student (IP
addresses), so nothing is auto-checked.

## Later

Part 2 (the student defends as the Ubuntu user) can be a second answer sheet the same way.
