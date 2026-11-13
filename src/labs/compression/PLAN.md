# Data Compression (AP CSP 2.2)

Status: built. Code: `index.ts` (steps), `answers.ts` (answer patterns), `solution.ts` (answer key), `lab.test.ts`. The pictures and both methods: `src/demos/pictures.ts`. Demo models: `src/demos/{pixels,runWalk,squareWalk,squeeze,paint}.ts`. Views: `src/ui/demos/{Pixels,RunWalk,SquareWalk,Squeeze,Paint}.tsx` and `pictureParts.tsx`.

A self-paced lesson with no network, about 50 minutes. Students compress a picture two ways, rebuild it, and compare what comes back: run-length encoding (lossless) and averaging squares of pixels (lossy). Then they try both on a photo and on a receipt, where the right choice differs.

CED: DAT-1.D (EK DAT-1.D.1 to DAT-1.D.8: redundancy, lossless vs lossy, how much each saves, and when to choose each).

## Pictures

- **Smiley**, 8×8 pixel art in 3 colors: 192 bytes. Runs: 26 runs, 104 bytes (54%), 0 changed. Average 2×2: 48 bytes, 40 of 64 changed (each eye blurs into a 2×2 smudge of dark yellow).
- **Lake photo** (a mountain lake near sunset), 240×160, drawn from a deterministic hash with ±5 camera noise: 115,200 bytes. Runs: 133% (bigger, because neighbors almost never match). Average 2×2 / 4×4 / 8×8: 28,800 / 7,200 / 1,800 bytes. At 2×2 it looks like the original at normal size; at 8×8 the birds and flowers are gone and the sailboat is a smudge.
- **Receipt**, 96×64 screenshot in a 3×5 font, TOTAL 14.05: runs 3,144 bytes (17%), smaller than Average 2×2 (4,608 bytes, 25%), which makes the digits unreadable.

A run takes 4 bytes (a 1-byte count and a 3-byte color), runs never cross a row end, and a run tops out at 255.

## Steps

1. **pixels**: A picture is a grid of pixels, 3 bytes each. Tap the smiley to find its 3 colors and see their bytes. Bytes in the smiley (192).
2. **runs**: RLE, a run, 4 bytes per run. Step through row 1 pixel by pixel, then Play or Skip. How row 3 is stored; which row shrank most (row 4, one run).
3. **rebuild-runs**: Decompressing; lossless. Paint the runs back one at a time beside the original. Why RLE comes back exact.
4. **average**: Average 2×2 squares with the math shown per square. Average red of 200, 200, 100, 100 (150); bytes stored (48).
5. **stretch**: Stretch each stored pixel back to a square; lossy. Show what changed. Why the 4 pixels can't be recovered from one gray.
6. **side-by-side**: Compare methods on the smiley: runs vs 2×2. The trade (smaller vs exact); bytes runs saved (88).
7. **bigger-squares**: The lake photo at 2×2, 4×4, 8×8, with Zoom in. JPEG makes the same trade. Bigger squares, smaller files, more loss; a 36 MB phone photo at 4×4 (2.25 MB).
8. **no-runs**: Runs on the photo (bigger) and the receipt (17%). Redundancy; PNG and ZIP. Why the photo grew; what decides how much RLE saves.
9. **details**: The receipt with runs vs 2×2, and the lake at 2×2. Read the total (14.05). Which method to send the receipt with (runs).
10. **choose**: Lossless vs lossy table with formats. An X-ray (lossless) and a video call on slow Wi-Fi (lossy).
11. **review**: AP-style quiz: what lossless means, a photo app (lossy), an emailed essay (lossless), and a teacher-graded explanation with an example.
12. **submit**
13. **paint** (optional extra challenge, no points): paint an 8×8 picture that runs make bigger than 192 bytes (a checkerboard), and one with 2+ colors that 2×2 averaging leaves unchanged (whole squares lined up with the grid).

## Misconceptions answered

- Counting all the pixels of a color as one run (row 3 as "6 yellow, 2 black").
- RLE keeps a copy of the original, or only works because the smiley has few colors.
- An average can be worked backward to the original pixels; rounding is the only loss.
- Lossy always loses so much the picture looks ruined (the lake at 2×2 says otherwise).
- Compression always makes a file smaller (runs on the photo make it 133%).
- Lossless always saves more, or lossy can rebuild exactly.
- Zooming in on a lossy picture brings back the detail.
