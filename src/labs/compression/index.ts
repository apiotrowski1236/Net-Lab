import { RECEIPT_TOTAL } from '../../demos/pictures';
import type { SqueezeSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { LabDef } from '../types';
import { money, num, SPELLED } from './answers';

/**
 * Data Compression (AP CSP, topic 2.2). A lesson with no network: every
 * step's stage shows demos. The pictures and both methods are in
 * src/demos/pictures.ts. Plan: PLAN.md.
 */

/** A goal met once the student has looked at `picture` with `method` in the step's squeeze demo. */
const tried = (picture: string, method: string) => demoFact('squeeze', (f) => f[`tried:${picture}:${method}`] === true);

const compare = (spec: Omit<SqueezeSpec, 'kind' | 'id' | 'title'>): SqueezeSpec => ({ kind: 'squeeze', id: 'squeeze', title: 'Compare methods', ...spec });

export const compressionLab: LabDef = {
  id: 'compression',
  version: 2,
  title: 'Data Compression',
  tagline: 'Shrink a picture two ways, rebuild it, and find out which way loses data.',
  // AP CSP Big Idea 2 (Data), topic 2.2 Data Compression.
  unit: 2,
  codehs: [],
  ced: ['DAT-1.D'],
  minutes: 50,
  objectives: [
    'Explain how run-length encoding stores a picture in fewer bytes and rebuilds it exactly',
    "Explain how averaging squares of pixels shrinks a picture, and why the lost detail can't come back",
    'Compare lossless and lossy compression by the bytes they save and the data they lose',
    'Choose lossless or lossy compression for a situation and explain why',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'pixels',
      title: 'A picture is made of numbers',
      body: md`
        > **How this lesson works.** Each step has a short reading, an activity, and questions. Goals check themselves off when you finish them. Answer the questions, then press **Continue**. Your work saves on this computer as you go.

        A digital picture is a grid of tiny squares called **pixels**. Each pixel is one color.

        A computer stores a pixel's color as three numbers: how much **red**, **green**, and **blue** light to mix. Each number takes one **byte**. A byte is a group of 8 bits. 8 bits can make 256 different patterns, so one byte can store any whole number from 0 to 255. Every pixel takes 3 bytes.

        Use the **Pixels** card. Tap pixels in the smiley until you've found every color in it, and look at the bytes that store each one.

        Pictures get big fast. A photo from a phone has about 12 million pixels, so it takes about 36 million bytes. **Compression** stores the same data in fewer bytes, so it takes less space and sends faster. In this lesson you'll compress the smiley two different ways, rebuild it, and compare what comes back.
      `,
      demos: [{ kind: 'pixels', id: 'pixels', title: 'Pixels', picture: 'smiley', intro: 'Tap any pixel.' }],
      goals: [
        {
          id: 'colors',
          label: 'Find all 3 colors in the smiley.',
          hint: 'Tap a blue corner, a yellow pixel, and a black eye.',
          check: demoFact('pixels', (f) => f.colors === f.total),
        },
      ],
      questions: [
        {
          id: 'bytes',
          kind: 'text',
          prompt: 'The smiley is 8 pixels wide and 8 pixels tall, and each pixel takes 3 bytes. How many bytes does the whole picture take?',
          placeholder: 'Type a number',
          expect: num(192),
          wrong: [
            SPELLED,
            { match: num(64), text: '64 is the number of pixels. Each pixel takes 3 bytes.' },
            { match: num(24), text: '24 is the bytes in one row of 8 pixels. The smiley has 8 rows.' },
            { match: num(1536), text: "1,536 is the number of bits (192 bytes × 8 bits). The question asks for bytes." },
            { match: num(11), text: 'Multiply instead of adding: 8 × 8 pixels, then 3 bytes for each one.' },
          ],
          expectHint: 'Not quite. Find the number of pixels first (8 × 8), then multiply by 3 bytes for each pixel.',
          explain: '8 × 8 = 64 pixels, and 64 × 3 = 192 bytes.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'runs',
      title: 'Count the runs',
      body: md`
        Look at row 4 of the smiley: 8 yellow pixels in a row. Storing yellow 8 times takes 8 × 3 = 24 bytes. It's shorter to store "8 yellow."

        That idea is called **run-length encoding**, or **RLE**. A **run** is a group of pixels side by side in a row that are all the same color. RLE stores each run as a count and a color, instead of storing every pixel.

        Each run takes 4 bytes: 1 byte for the count and 3 bytes for the color.

        Use the **Run-length encoding** card:

        1. Press **Step** to read one pixel at a time, left to right, starting with row 1. Watch the count grow while the color stays the same, and a new run start when the color changes. A run also ends at the end of its row.
        2. After row 1, press **Play** to watch the rest, or **Skip to the end**.

        Watch the two bars under the picture. One counts the bytes of the pixels read so far, and the other counts the bytes of the runs that store them.
      `,
      demos: [{ kind: 'run-walk', id: 'encode', title: 'Run-length encoding', picture: 'smiley', mode: 'encode', intro: 'The numbers on the pixels count each run as it grows.' }],
      goals: [
        {
          id: 'row1',
          label: 'Read row 1 into runs.',
          hint: 'Press **Step** 8 times, once for each pixel in row 1.',
          check: demoFact('encode', (f) => (f.pos as number) >= 8),
        },
        {
          id: 'all',
          label: 'Encode the whole smiley.',
          hint: 'Press **Play**, or **Skip to the end**.',
          check: demoFact('encode', (f) => f.done === true),
        },
      ],
      questions: [
        {
          id: 'row3',
          kind: 'choice',
          prompt: 'Row 3 of the smiley is **yellow, yellow, black, yellow, yellow, black, yellow, yellow**. How does RLE store it?',
          options: [
            { id: 'counts', text: '6 yellow, 2 black', feedback: 'That counts all the yellow pixels together. A run counts only pixels that sit side by side, so the two black pixels split the yellow into three runs.' },
            { id: 'colors', text: 'yellow, black, yellow, black, yellow', feedback: "That lists the colors but not how many of each. Without the counts, the program can't tell how wide each run is." },
            { id: 'runs', text: '2 yellow, 1 black, 2 yellow, 1 black, 2 yellow', correct: true },
            { id: 'pixels', text: '8 pixels', feedback: 'RLE has to store the colors too. This row changes color 4 times, so it has 5 runs.' },
          ],
          explain: 'Each time the color changes, one run ends and the next one starts: 2 yellow, 1 black, 2 yellow, 1 black, 2 yellow.',
        },
        {
          id: 'best-row',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Look at the runs for each row. Which row did RLE shrink the most? (Every row takes 24 bytes as pixels.)',
          options: [
            { id: 'r1', text: 'Row 1', feedback: 'Row 1 is 3 runs, so 3 × 4 = 12 bytes. One row is even smaller.' },
            { id: 'r3', text: 'Row 3', feedback: 'Row 3 is 5 runs, so 5 × 4 = 20 bytes. That barely beats its 24 bytes as pixels.' },
            { id: 'r4', text: 'Row 4', correct: true },
            { id: 'same', text: 'They all shrank the same amount', feedback: 'Rows with fewer, longer runs shrink more. Compare row 3 with row 4.' },
          ],
          explain: 'Row 4 is one run of 8 yellow: 4 bytes instead of 24. The longer the runs, the more RLE saves.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'rebuild-runs',
      title: 'Rebuild from the runs',
      body: md`
        A compressed picture has to turn back into pixels before anyone can see it. That's called **decompressing**. To decompress RLE, the program reads each run and paints that many pixels of its color.

        Use the **Rebuild from the runs** card. Each **Step** paints one run. When the whole smiley is rebuilt, compare it with the original beside it.

        Compression that gets back the original data exactly, with every bit the same, is called **lossless** compression. RLE is lossless.
      `,
      demos: [{ kind: 'run-walk', id: 'decode', title: 'Rebuild from the runs', picture: 'smiley', mode: 'decode', intro: 'The runs on the left are everything that was stored.' }],
      goals: [
        {
          id: 'rebuilt',
          label: 'Rebuild the whole smiley from its runs.',
          hint: 'Press **Step** through row 1, then **Play** or **Skip to the end**.',
          check: demoFact('decode', (f) => f.done === true),
        },
      ],
      questions: [
        {
          id: 'why-exact',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Why does RLE get back every pixel exactly?',
          options: [
            { id: 'remembers', text: 'The program keeps a copy of the original picture', feedback: "The rebuild uses only the runs. If the original were kept too, compressing it wouldn't save any space." },
            { id: 'exact', text: 'Each run stores an exact count and color', correct: true },
            { id: 'colors', text: 'The smiley has only 3 colors', feedback: 'RLE gets back any picture exactly, even a photo with thousands of colors. (A photo may not shrink much, though. You will see why in a later step.)' },
            { id: 'order', text: 'RLE stores every pixel, in a different order', feedback: "RLE stores one count and one color for each run, not each pixel. Row 4's 8 pixels are stored as one run." },
          ],
          explain: 'Each run says exactly how many pixels and exactly which color. Nothing was thrown away, so painting the runs gives back the same picture. That makes RLE lossless.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'average',
      title: 'Average each square',
      body: md`
        Here's a different way to shrink the smiley. Split it into squares of 2 × 2 pixels. For each square, keep one color: the **average** of its 4 pixels.

        Remember that every color is stored as three numbers: red, green, and blue. That's true even for a color that isn't red, green, or blue. The smiley's yellow is red 255, green 220, blue 0. Its black is 0, 0, 0.

        To average a square, add up the red numbers of its 4 pixels and divide by 4. Then do the same with the 4 green numbers, and with the 4 blue numbers. The three averages are the stored color.

        The stored picture has one pixel for each square. That's 4 × 4 = 16 pixels instead of 64.

        Use the **Average 2×2 squares** card. Each **Step** averages one square, and the table shows the math for it. Watch what happens to a square that has two different colors in it.
      `,
      demos: [{ kind: 'square-walk', id: 'encode', title: 'Average 2×2 squares', picture: 'smiley', mode: 'encode', intro: 'Each square of 4 pixels becomes 1 stored pixel.' }],
      goals: [
        {
          id: 'row1',
          label: 'Average the first row of squares.',
          hint: 'Press **Step** 4 times.',
          check: demoFact('encode', (f) => (f.pos as number) >= 4),
        },
        {
          id: 'all',
          label: 'Average every square of the smiley.',
          hint: 'Press **Play**, or **Skip to the end**.',
          check: demoFact('encode', (f) => f.done === true),
        },
      ],
      questions: [
        {
          id: 'avg-red',
          kind: 'text',
          prompt: "A square's 4 pixels have red numbers **200, 200, 100, and 100**. What red number gets stored for the square?",
          placeholder: 'Type a number',
          expect: num(150),
          wrong: [
            SPELLED,
            { match: num(600), text: "600 is the total. Divide it by 4, the number of pixels in the square." },
            { match: num(300), text: 'You divided by 2. The square has 4 pixels, so divide the total by 4.' },
            { match: num(200), text: "200 is one of the pixels. The average falls between the biggest and the smallest." },
            { match: num(100), text: '100 is one of the pixels. The average falls between the biggest and the smallest.' },
          ],
          expectHint: 'Not quite. Add the 4 red numbers, then divide the total by 4.',
          explain: '200 + 200 + 100 + 100 = 600, and 600 ÷ 4 = 150.',
        },
        {
          id: 'stored-bytes',
          kind: 'text',
          afterGoals: true,
          prompt: 'The stored picture has 16 pixels. How many bytes does it take?',
          placeholder: 'Type a number',
          expect: num(48),
          wrong: [
            SPELLED,
            { match: num(16), text: "16 is the number of pixels. Each pixel's color takes 3 bytes." },
            { match: num(192), text: '192 bytes is the original smiley. The stored picture has fewer pixels.' },
            { match: num(64), text: '64 is the number of pixels in the original. The stored picture has 16.' },
          ],
          expectHint: 'Not quite. Multiply the 16 pixels by 3 bytes for each pixel.',
          explain: '16 × 3 = 48 bytes, a quarter of the original 192 bytes.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'stretch',
      title: 'Stretch it back',
      body: md`
        To decompress, the program does the reverse: each stored pixel becomes a 2 × 2 square of its color.

        Use the **Stretch it back** card. Step through it, then compare the rebuilt smiley with the original. Press **Show what changed** to mark every pixel that didn't come back as its original color.

        Compression that gets back only a close copy of the original is called **lossy** compression. Averaging squares is lossy. The detail it throws away is gone for good.
      `,
      demos: [{ kind: 'square-walk', id: 'decode', title: 'Stretch it back', picture: 'smiley', mode: 'decode', intro: 'The stored picture on the left is everything that was kept.' }],
      goals: [
        {
          id: 'rebuilt',
          label: 'Stretch every stored pixel back into a square.',
          hint: 'Press **Step** through the first row of squares, then **Play** or **Skip to the end**.',
          check: demoFact('decode', (f) => f.done === true),
        },
        {
          id: 'changes',
          label: 'Press **Show what changed**.',
          hint: 'The button is next to the count of pixels that changed, once the smiley is rebuilt.',
          check: demoFact('decode', (f) => f.changes === true),
        },
      ],
      questions: [
        {
          id: 'why-lost',
          kind: 'choice',
          afterGoals: true,
          prompt: 'A stored pixel is the gray halfway between black and white. Can the program tell what the 4 original pixels were?',
          options: [
            { id: 'bw', text: 'Yes: 2 black and 2 white', feedback: 'That is one way to get this gray. 4 pixels of the same gray average to it too, and so do other mixes.' },
            { id: 'math', text: 'Yes, by doing the math backward', feedback: "Many different sets of 4 numbers have the same average. Working backward can't pick which set it was." },
            { id: 'no', text: 'No: many squares have that same average', correct: true },
            { id: 'round', text: 'No, but only because the average was rounded', feedback: 'Rounding loses a tiny bit. The bigger loss is that 4 colors became 1. Even with no rounding, many squares share one average.' },
          ],
          explain: '2 black and 2 white, 4 grays, or 1 black, 1 white, and 2 grays all average to the same gray. Only the average was stored, so the program has no way to know which square it came from.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'side-by-side',
      title: 'Lossless or lossy?',
      body: md`
        Now compare the two methods on the same smiley. Use the **Compare methods** card. Pick **Runs (lossless)**, then **Average 2×2 (lossy)**. The table keeps the size and the pixels changed for each one.

        **Show what changed** colors each pixel by how far it moved from the original.
      `,
      demos: [compare({ pictures: ['smiley'], methods: ['none', 'runs', 'avg2'], intro: 'Pick a method. The rebuilt picture shows on the right.' })],
      goals: [
        { id: 'runs', label: 'Try **Runs (lossless)**.', check: tried('smiley', 'runs') },
        { id: 'avg2', label: 'Try **Average 2×2 (lossy)**.', check: tried('smiley', 'avg2') },
      ],
      questions: [
        {
          id: 'trade',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Which sentence matches your results for the smiley?',
          options: [
            { id: 'avg-smaller', text: 'Averaging made the smaller file, and runs got every pixel back', correct: true },
            { id: 'runs-smaller', text: 'Runs made the smaller file, and averaging got every pixel back', feedback: 'Look at the table again. Runs took 104 bytes and averaging took 48. Averaging changed 40 pixels.' },
            { id: 'same', text: 'Both made the same size file', feedback: 'Look at the Size column: 104 bytes for runs and 48 for averaging.' },
            { id: 'free', text: 'Averaging made the smaller file and lost nothing', feedback: 'Look at Pixels changed. 40 of the 64 pixels came back a different color.' },
          ],
          explain: 'This is the usual trade. Lossy compression made a smaller file (48 bytes) but changed 40 pixels. Lossless compression kept every pixel but took more space (104 bytes).',
        },
        {
          id: 'saved',
          kind: 'text',
          afterGoals: true,
          prompt: 'How many bytes did **Runs (lossless)** save on the smiley, compared with no compression?',
          placeholder: 'Type a number',
          expect: num(88),
          wrong: [
            SPELLED,
            { match: num(104), text: '104 bytes is the size with runs. How many fewer bytes is that than 192?' },
            { match: num(144), text: '144 is what averaging saved (192 − 48). The question asks about runs.' },
            { match: /^\s*54\s*%?\s*\.?$/, text: "54% is the size with runs, as a share of the original. The question asks for bytes saved." },
          ],
          expectHint: 'Not quite. Subtract the size with runs from the size with no compression (192 bytes).',
          explain: '192 − 104 = 88 bytes saved, and every pixel came back.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'bigger-squares',
      title: 'Bigger squares, smaller files',
      body: md`
        Averaging doesn't have to use 2 × 2 squares. A 4 × 4 square turns 16 pixels into 1, and an 8 × 8 square turns 64 pixels into 1. Bigger squares store fewer pixels, so the file is smaller.

        The **Lake photo** has 240 × 160 = 38,400 pixels, about the size of a small photo on a web page. Try each square size on it in **Compare methods**. Look at the whole photo first. Then press **Zoom in** to look closely at the cabin, the sailboat, and the birds.

        The Pixels changed column counts every pixel that isn't exactly its old color, even if it's off by 1. In a photo, almost every pixel changes a little at every square size. Press **Show what changed** to see how much: the brighter the orange, the bigger the change.

        Real photo formats such as JPEG use smarter math than plain averages, but they make the same trade: a smaller file for less detail. Many apps let you pick the quality when you save a JPEG.
      `,
      demos: [compare({ pictures: ['lake'], methods: ['none', 'avg2', 'avg4', 'avg8'], intro: 'Pick a square size. Tap a picture to zoom in on that spot.' })],
      goals: [
        { id: 'avg2', label: 'Try **Average 2×2 (lossy)** on the photo.', check: tried('lake', 'avg2') },
        { id: 'avg4', label: 'Try **Average 4×4 (lossy)**.', check: tried('lake', 'avg4') },
        { id: 'avg8', label: 'Try **Average 8×8 (lossy)**.', check: tried('lake', 'avg8') },
      ],
      questions: [
        {
          id: 'trend',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Which sentence fits what you saw?',
          options: [
            { id: 'trend', text: 'Bigger squares made smaller files and lost more detail', correct: true },
            { id: 'bigger-file', text: 'Bigger squares made bigger files', feedback: 'Look at the Size column: 28,800 bytes for 2×2, 7,200 for 4×4, and 1,800 for 8×8.' },
            { id: 'same-detail', text: 'Every square size lost about the same detail', feedback: 'Pixels changed is close for every size, because almost every pixel changes a little. Compare the pictures instead: at 8×8 the birds and the flowers are gone.' },
            { id: 'ruined', text: '2×2 lost so much that the photo looks ruined', feedback: 'Look again at 2×2 without zooming in. Most people can barely tell it from the original.' },
          ],
          explain: 'A bigger square throws away more pixels, so the file is smaller and more detail is lost. At 2×2 the photo still looks like the original at normal size. At 8×8 the birds and the flowers are gone, and the sailboat is a pale smudge.',
        },
        {
          id: 'phone',
          kind: 'choice',
          afterGoals: true,
          prompt: 'A phone photo has about 12 million pixels, so it takes about 36 MB with no compression. (1 MB, a **megabyte**, is a million bytes.) About how big is it after **Average 4×4 (lossy)**?',
          options: [
            { id: '9', text: '9 MB', feedback: "9 MB is 36 ÷ 4, the size after 2×2. A 4×4 square turns 16 pixels into 1." },
            { id: '0.225', text: '0.225 MB', feedback: 'Check the decimal point. 36 ÷ 16 is between 2 and 3.' },
            { id: '2.25', text: '2.25 MB', correct: true },
            { id: '32', text: '32 MB', feedback: 'That takes away 4 MB. Averaging divides the number of pixels: 16 pixels become 1.' },
          ],
          explain: 'A 4 × 4 square turns 16 pixels into 1, so the file is 1/16 the size: 36 ÷ 16 = 2.25 MB.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'no-runs',
      title: "When runs don't help",
      body: md`
        RLE shrank the smiley because it has long runs of one color. Does it work on every picture?

        Use **Compare methods** to try **Runs (lossless)** on the **Lake photo**, then on the **Receipt**, a screenshot of a food order. Check the Size column each time.

        How much a method can shrink data depends on how much of it repeats. Repeated data, like 8 yellow pixels in a row, is called **redundancy**.

        PNG pictures and ZIP files use lossless compression too. They find repeats in more ways than runs do, but they have the same limit: data with few repeats doesn't shrink much.
      `,
      demos: [compare({ pictures: ['lake', 'receipt', 'smiley'], methods: ['none', 'runs'], intro: 'Pick a picture, then a method.' })],
      goals: [
        { id: 'lake', label: 'Try **Runs (lossless)** on the **Lake photo**.', check: tried('lake', 'runs') },
        { id: 'receipt', label: 'Try **Runs (lossless)** on the **Receipt**.', check: tried('receipt', 'runs') },
      ],
      questions: [
        {
          id: 'photo-bigger',
          kind: 'choice',
          afterGoals: ['lake'],
          prompt: 'Why did RLE make the lake photo **bigger**?',
          options: [
            { id: 'too-many', text: 'The photo has too many pixels for RLE to count', feedback: 'RLE works on any number of pixels. What matters is whether pixels side by side repeat.' },
            { id: 'loses', text: 'RLE throws away detail in photos', feedback: 'RLE is lossless on every picture. Look at Pixels changed: 0.' },
            { id: 'ones', text: 'Pixels side by side almost never match', correct: true },
            { id: 'already', text: 'The photo was already compressed', feedback: 'It is stored here with no compression. Each pixel takes its own 3 bytes.' },
          ],
          explain: 'A real photo has tiny differences from pixel to pixel, so it has almost no runs. A 1-pixel run takes 4 bytes, but the pixel alone takes 3, so RLE made the photo about a third bigger.',
        },
        {
          id: 'receipt-why',
          kind: 'choice',
          afterGoals: true,
          prompt: 'RLE shrank the receipt to 17% of its size. What decides how much RLE can shrink a picture?',
          options: [
            { id: 'repeats', text: 'How many pixels side by side are the same color', correct: true },
            { id: 'size', text: 'How many pixels the picture has', feedback: 'The lake photo has more pixels than the receipt, and it got bigger, not smaller. Size alone does not decide it.' },
            { id: 'text', text: 'Whether the picture has letters and numbers in it', feedback: 'The letters are not the reason. The receipt shrinks because most of it is long runs of white and green.' },
            { id: 'bright', text: 'How bright the colors are', feedback: 'RLE does not care what the colors are. It only checks whether each pixel matches the one before it.' },
          ],
          explain: 'Most of the receipt is long runs of white and green, so it has lots of redundancy. The more pixels repeat, the more RLE saves.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'details',
      title: 'When losing detail matters',
      body: md`
        Averaging made the lake photo much smaller, and at normal size it still looked like the same lake. A little lost detail doesn't hurt a vacation photo.

        Some pictures can't afford to lose any detail. In **Compare methods**, pick the **Receipt** and **Runs (lossless)**, and read the total. Then pick **Average 2×2 (lossy)** and try to read it again. Compare that with **Average 2×2 (lossy)** on the **Lake photo**.
      `,
      demos: [compare({ pictures: ['receipt', 'lake'], methods: ['none', 'runs', 'avg2'], intro: 'Pick a picture, then a method.' })],
      goals: [
        { id: 'runs', label: 'Read the receipt with **Runs (lossless)**.', check: tried('receipt', 'runs') },
        { id: 'avg2', label: 'Try **Average 2×2 (lossy)** on the receipt.', check: tried('receipt', 'avg2') },
        { id: 'lake', label: 'Try **Average 2×2 (lossy)** on the **Lake photo**.', check: tried('lake', 'avg2') },
      ],
      questions: [
        {
          id: 'total',
          kind: 'text',
          afterGoals: ['runs'],
          prompt: 'With **Runs (lossless)** picked, what is the TOTAL on the receipt?',
          placeholder: 'Type the amount, like 3.50',
          expect: money(RECEIPT_TOTAL),
          wrong: [{ match: /^\s*\$?\s*1[0-9][.,]\d\d\s*$/, text: 'Close. Read the total again with **Runs (lossless)** picked, where every digit is sharp.' }],
          expectHint: 'Not quite. Pick **Runs (lossless)** and read the number on the TOTAL line, at the bottom of the receipt.',
          explain: `The total is ${RECEIPT_TOTAL}. With runs, every pixel of every digit comes back.`,
        },
        {
          id: 'receipt-method',
          kind: 'choice',
          afterGoals: true,
          prompt: 'You need to send this receipt to get paid back for lunch. Which method should you use?',
          options: [
            { id: 'avg2', text: 'Average 2×2, because lossy files are smaller', feedback: 'Look at the table: runs made the receipt even smaller, 3,144 bytes. After averaging, the numbers are hard to read.' },
            { id: 'runs', text: 'Runs, because every digit has to stay readable', correct: true },
            { id: 'none', text: "No compression, because compression changes the numbers", feedback: 'Lossless compression changes nothing. Runs rebuilt all 6,144 pixels exactly, in far fewer bytes.' },
            { id: 'avg8', text: 'Average 8×8, because the smallest file sends fastest', feedback: 'A tiny file is no use if nobody can read the total. Here every detail matters.' },
          ],
          explain: 'The digits are tiny details, and a blurred 8 can look like a 6 or a 0. Lossless compression keeps them exact. For this receipt, runs even made a smaller file than averaging.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'choose',
      title: 'Pick the right kind',
      body: md`
        Every time data gets compressed, someone decides which matters more: getting back every detail exactly, or the smallest file.

        | Lossless | Lossy |
        | --- | --- |
        | Rebuilds the original exactly | Rebuilds a close copy |
        | Usually saves less space | Usually saves more space |
        | PNG pictures, ZIP files | JPEG photos, MP3 music, streaming video |

        Decide what matters most in each situation below.
      `,
      questions: [
        {
          id: 'xray',
          kind: 'choice',
          prompt: 'A hospital stores X-rays. A doctor will look for a crack in a bone that is one pixel wide. Which kind of compression should the hospital use?',
          options: [
            { id: 'lossy-big', text: 'Lossy, because X-rays are big files', feedback: 'They are big, but a crack averaged away could be missed. Here every detail matters more than the size.' },
            { id: 'lossy-zoom', text: 'Lossy, because the doctor can zoom in to see the crack', feedback: 'Zooming in on a lossy picture shows the blurred squares, not the lost detail. The detail is gone for good.' },
            { id: 'either', text: 'Either one, since both rebuild the picture', feedback: 'Only lossless rebuilds it exactly. Lossy rebuilds a close copy, and the crack might not be in it.' },
            { id: 'lossless', text: 'Lossless, because a lost detail could hide the crack', correct: true },
          ],
          explain: 'When every detail matters, use lossless compression. A one-pixel crack is exactly the kind of detail averaging throws away.',
        },
        {
          id: 'video-call',
          kind: 'choice',
          prompt: 'You are on a video call over slow Wi-Fi. Each frame of video has to arrive right away. Which kind of compression fits best?',
          options: [
            { id: 'lossy', text: 'Lossy, because a smaller video arrives faster', correct: true },
            { id: 'lossless-perfect', text: 'Lossless, because the call should look perfect', feedback: 'A perfect picture that arrives late freezes the call. Here speed matters more than every detail.' },
            { id: 'lossless-smaller', text: 'Lossless, because it makes smaller files', feedback: 'Lossy compression usually makes smaller files than lossless does.' },
            { id: 'none', text: 'No compression, so nothing is lost', feedback: 'Video with no compression is far too big to send over slow Wi-Fi.' },
          ],
          explain: 'When a small file or a fast send matters most, use lossy compression. A slightly blurry face is better than a frozen one.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'review',
      title: 'Review quiz',
      body: md`
        Answer these questions on your own, the way you would on the AP exam.

        > **Think carefully before you answer.** You'll be able to change your wrong answers, but wrong guesses will show up on your results report.
      `,
      questions: [
        {
          id: 'q1',
          kind: 'choice',
          prompt: 'Which of the following is true of **lossless** compression?',
          options: [
            { id: 'smaller', text: 'It always makes data smaller than lossy compression does', feedback: 'Lossy usually saves more. On the smiley, averaging made 48 bytes and runs made 104.' },
            { id: 'exact', text: 'It can rebuild the original data exactly', correct: true },
            { id: 'unnoticed', text: "It removes details that people won't notice", feedback: 'That describes lossy compression. Lossless keeps every detail.' },
            { id: 'always', text: 'It always makes a file smaller', feedback: "Not always. Runs made the lake photo about a third bigger, because its pixels hardly ever repeat." },
          ],
          explain: 'Lossless compression rebuilds the original exactly. It usually saves less space than lossy, and data with few repeats may not shrink at all.',
        },
        {
          id: 'q2',
          kind: 'choice',
          prompt: 'A photo-sharing app wants to store millions of photos in as little space as possible. A small loss of detail is OK. Which is the best choice?',
          options: [
            { id: 'lossless-keeps', text: 'Lossless, because it keeps every pixel', feedback: 'Keeping every pixel costs more space, and the app said a small loss is OK.' },
            { id: 'lossless-smaller', text: 'Lossless, because it always makes smaller files', feedback: 'Lossless usually saves less space than lossy, and space is what this app cares about.' },
            { id: 'lossy-exact', text: 'Lossy, because it can rebuild the photos exactly', feedback: "Lossy can't rebuild a photo exactly. That's the trade it makes for a smaller file." },
            { id: 'lossy', text: 'Lossy, because it usually saves more space', correct: true },
          ],
          explain: 'When size matters most and a small loss is OK, lossy compression is the usual choice.',
        },
        {
          id: 'q3',
          kind: 'choice',
          prompt: 'You email your essay to your teacher as a compressed file. Which kind of compression should it use?',
          options: [
            { id: 'lossless', text: 'Lossless, because every letter must come back', correct: true },
            { id: 'lossy-small', text: 'Lossy, because text files are small anyway', feedback: 'Small or not, a lossy method could change letters. An essay needs every character back exactly.' },
            { id: 'lossy-guess', text: "Lossy, because a few wrong letters won't matter", feedback: 'Wrong letters change what you wrote. Text, numbers, and programs always use lossless compression.' },
            { id: 'either', text: 'Either one works for text', feedback: 'Lossy compression could change words. Text needs every character back exactly.' },
          ],
          explain: 'Text, numbers, and programs have to come back exactly, so they use lossless compression.',
        },
        {
          id: 'q4',
          kind: 'text',
          prompt: 'In 2 or 3 sentences, explain the difference between lossless and lossy compression. Use the smiley, the lake photo, or the receipt as an example.',
          minWords: 30,
          lines: 4,
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary. You can go back to any step and change an answer, then hand in your work again.

        Finished early? After you hand in, press **Optional extra challenge** for one more step: paint your own picture and see what each method does to it.
      `,
    },

    // ----------------------------------------------------------------------- optional extra challenge
    {
      id: 'paint',
      title: 'Optional extra challenge: paint a picture',
      extra: true,
      body: md`
        Paint your own 8 × 8 picture in the **Paint a picture** card. The sizes underneath change as you paint. Tap a pixel to paint it, or drag across several.

        Try to make these two pictures:

        1. A picture that **Runs (lossless)** stores in more bytes than no compression.
        2. A picture with at least 2 colors that Average 2×2 doesn't change at all.

        Think about runs and squares before you start painting.
      `,
      demos: [{ kind: 'paint', id: 'paint', title: 'Paint a picture', intro: 'Pick a color, then tap or drag on the picture.' }],
      goals: [
        {
          id: 'bigger',
          label: 'Paint a picture that runs store in more than 192 bytes.',
          hint: 'Runs grow when they are short. Try making each pixel a different color from the one beside it, like a checkerboard.',
          check: demoFact('paint', (f) => (f.runBytes as number) > (f.raw as number)),
        },
        {
          id: 'no-change',
          label: 'Paint a picture with 2 or more colors that Average 2×2 leaves exactly the same.',
          hint: 'A square that is all one color averages to that same color. Paint in whole 2×2 squares, lined up with the squares in the picture after averaging.',
          check: demoFact('paint', (f) => (f.colors as number) >= 2 && f.changed === 0),
        },
      ],
    },
  ],
};
