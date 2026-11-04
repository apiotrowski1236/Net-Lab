import { placeValues } from '../../demos/binary';
import type { BitsSpec } from '../../demos/types';
import { demoFact } from '../helpers';
import { md } from '../md';
import type { LabDef, TextQuestion } from '../types';
import { bitsRe, longBits, notBinary, num, rangeRe, reversed, shortBits } from './answers';

/**
 * Binary Numbers (AP CSP, topic 2.1). A lesson with no network: every step's
 * stage shows demos (src/demos) instead of a map. Source plan: SOURCE.md.
 * Plan for this build: PLAN.md.
 */

/** The 8-bit place-value board, as scratch paper: it doesn't add for the student. */
const scratch: BitsSpec = {
  kind: 'bits',
  id: 'board',
  title: 'Place-value board',
  style: 'board',
  places: 8,
  total: false,
};

const COUNT_ONES = "That's how many 1s there are. Add up their place values instead.";

/** The place values under the 1s, as a sum: "8 + 2". */
const sumOf = (bits: string) =>
  placeValues(bits.length)
    .filter((_, i) => bits[i] === '1')
    .join(' + ');

/** Worksheet Part A: binary to decimal. */
function toDecimal(id: string, n: number, bits: string, ones: number): TextQuestion {
  const back = parseInt(reversed(bits), 2);
  const wrong: TextQuestion['wrong'] = [];
  if (back !== n) wrong.push({ match: num(back), text: 'You read the bits from the wrong end. The rightmost bit is the 1s place, and the leftmost is the 128s place.' });
  wrong.push({ match: num(ones), text: COUNT_ONES });
  wrong.push({ match: bitsRe(bits), text: "That's the binary number again. Add the place values that have a 1 under them." });
  return {
    id,
    kind: 'text',
    prompt: `Turn **${bits}** into decimal.`,
    placeholder: 'Type a number',
    expect: num(n),
    wrong,
    expectHint: 'Write 128 64 32 16 8 4 2 1 above the bits, then add the place values that have a 1 under them.',
    explain: bits.indexOf('1') === bits.lastIndexOf('1') ? `${bits} has one 1, in the ${n}s place.` : `${sumOf(bits)} = ${n}.`,
  };
}

/** Worksheet Part B: decimal to 8-bit binary. */
function toBinary(id: string, n: number, bits: string, extra: TextQuestion['wrong'] = []): TextQuestion {
  const short = bits.replace(/^0+/, '');
  const wrong: TextQuestion['wrong'] = [...extra];
  if (short !== bits) wrong.push({ match: bitsRe(short), text: `Right bits, but write all 8. Put 0s in front: ${'0'.repeat(8 - short.length)} then your bits.` });
  if (reversed(bits) !== bits) wrong.push({ match: bitsRe(reversed(bits)), text: 'Those bits are in reverse order. The 128s place is on the left, and the 1s place is on the right.' });
  wrong.push(
    { match: notBinary, text: 'Binary uses only the digits 0 and 1.' },
    { match: shortBits(8), text: 'Write exactly 8 bits. Put 0s in front if you need them.' },
    { match: longBits(8), text: 'Write exactly 8 bits. One byte has 8 places, from 128 down to 1.' },
  );
  return {
    id,
    kind: 'text',
    prompt: `Turn **${n}** into 8-bit binary.`,
    placeholder: 'Type 8 bits, like 00000101',
    expect: bitsRe(bits),
    wrong,
    expectHint: "Ask \"does it fit?\" at each place, starting at 128. When the place value fits in what's left, write 1 and subtract. When it's too big, write 0.",
    explain: `${n} = ${sumOf(bits)}, so those places get a 1: ${bits}.`,
  };
}

export const binaryNumbersLab: LabDef = {
  id: 'binary-numbers',
  version: 1,
  title: 'Binary Numbers',
  tagline: 'Count with light switches and cards, convert between binary and decimal, and see why a computer can run out of bits.',
  // AP CSP Big Idea 2 (Data), topic 2.1 Binary Numbers.
  unit: 2,
  codehs: [],
  ced: ['DAT-1.A', 'DAT-1.B', 'DAT-1.C'],
  minutes: 50,
  objectives: [
    'Define bit and byte, and explain why n bits make 2ⁿ values',
    'Convert 8-bit binary to decimal, and decimal from 0 to 255 to binary',
    'Order binary numbers without converting every one',
    'Explain overflow and rounding errors caused by a fixed number of bits',
  ],
  steps: [
    // -----------------------------------------------------------------------
    {
      id: 'switches',
      title: 'How many messages can a switch send?',
      body: md`
        > **How this lesson works.** Read each step here on the left. Try the activity on the right. (On a narrow screen, like a tablet held upright, the activity is below the lesson.) Goals check themselves off when you finish them. Answer the questions, then press **Continue**. Your work saves on this computer as you go.

        A computer is built from billions of tiny switches. Each one is off or on, and that's all it can do. So how does a computer store a number, a word, or a song? It uses **patterns** of switches.

        Think of a porch light. One switch can send two messages: off means "nobody's home," and on means "come in."

        Use the **Light switches** on the right:

        1. Choose **1** switch. Flip it and watch the list of patterns grow.
        2. Choose **2** switches. Make every on and off pattern you can.
        3. Choose **3** switches and do the same.

        All off counts as a pattern too.
      `,
      demos: [{ kind: 'switches', id: 'switches', title: 'Light switches', max: 3, intro: 'Choose how many switches to use, then tap a switch to flip it.' }],
      goals: [
        {
          id: 'one',
          label: 'Find every pattern with **1** switch.',
          hint: 'Choose **1** under Switches, then flip the switch.',
          check: demoFact('switches', (f) => f.n === 1 && f.found === f.total),
        },
        {
          id: 'two',
          label: 'Find every pattern with **2** switches.',
          hint: 'Try each switch on by itself, then both together.',
          check: demoFact('switches', (f) => f.n === 2 && f.found === f.total),
        },
        {
          id: 'three',
          label: 'Find every pattern with **3** switches.',
          hint: 'Work in order. Find every pattern of the last two switches with the first switch off, then all of them again with it on.',
          check: demoFact('switches', (f) => f.n === 3 && f.found === f.total),
        },
      ],
      questions: [
        {
          id: 'four',
          kind: 'text',
          afterGoals: true,
          prompt: 'You found 2 patterns with 1 switch, 4 with 2 switches, and 8 with 3. **Predict:** how many patterns can 4 switches make?',
          placeholder: 'Type a number',
          expect: num(16),
          wrong: [
            { match: num(10), text: "Adding a switch doesn't add 2 each time. Look at 2, 4, 8: what happens to the count when you add a switch?" },
            { match: num(12), text: "Adding a switch doesn't add 4 each time. Look at 2, 4, 8: what happens to the count when you add a switch?" },
            { match: num(9), text: "The count doesn't go up by 1. Look at 2, 4, 8: what happens to the count when you add a switch?" },
          ],
          expectHint: 'Look at 2, 4, 8. What does each new switch do to the count?',
          explain: 'Each new switch doubles the count. The 8 patterns of 3 switches happen once with the new switch off and once with it on: 16.',
        },
        {
          id: 'rule',
          kind: 'choice',
          afterGoals: true,
          prompt: 'Which rule gives the number of patterns for **n** switches?',
          options: [
            { id: 'pow', text: '2ⁿ', correct: true },
            { id: 'double', text: '2 × n', feedback: 'That gives 6 for 3 switches. You found 8.' },
            { id: 'plus', text: 'n + 1', feedback: 'That gives 4 for 3 switches. You found 8.' },
            { id: 'square', text: 'n × n', feedback: 'That gives 9 for 3 switches. You found 8.' },
          ],
          explain: '2ⁿ means 2 multiplied by itself n times. For 3 switches, 2³ = 2 × 2 × 2 = 8.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'bits',
      title: 'Bits and bytes',
      body: md`
        Each switch holds one **bit**: a single 0 or 1. (Bit is short for *binary digit*.) Off is 0 and on is 1. A group of 8 bits is a **byte**.

        The rule you found works for bits too: **n bits make 2ⁿ patterns**. Each pattern can stand for a different value, like a number or a letter.

        | Bits | Patterns |
        | --- | --- |
        | 1 | 2 |
        | 2 | 4 |
        | 3 | 8 |
        | 4 | 16 |
        | 8 (one byte) | ? |

        **Place value.** The numbers you use every day are **base 10**. Each place is worth 10 times the place to its right: 1, 10, 100, 1000. Binary is **base 2**. Each place is worth 2 times the place to its right: 1, 2, 4, 8, 16, and so on. The **Place values** card on the right shows both.

        **Binary is an abstraction.** An **abstraction** hides details so you can think about the big idea. There are no little 0s and 1s inside a chip. Each wire has a high or a low voltage, and we *call* low 0 and high 1. Flip a few wires on the right, then look at the same byte three ways with **View as**.
      `,
      demos: [
        { kind: 'bits', id: 'byte', title: 'One byte, three ways', style: 'wires', places: 8, start: '01000001', intro: 'Tap a wire to flip it between low and high.' },
        {
          kind: 'note',
          id: 'places',
          title: 'Place values',
          md: md`
            **Base 10:** each place is worth 10 times the place to its right.

            | Place value | 1000 | 100 | 10 | 1 |
            | --- | --- | --- | --- | --- |
            | Digits of 2305 | 2 | 3 | 0 | 5 |

            2305 = 2 × 1000 + 3 × 100 + 0 × 10 + 5 × 1

            **Base 2:** each place is worth 2 times the place to its right.

            | Place value | 8 | 4 | 2 | 1 |
            | --- | --- | --- | --- | --- |
            | Bits of 1100 | 1 | 1 | 0 | 0 |

            1100 = 1 × 8 + 1 × 4 + 0 × 2 + 0 × 1 = 12
          `,
        },
      ],
      goals: [
        {
          id: 'flip',
          label: 'Flip at least one wire of the byte.',
          check: demoFact('byte', (f) => Number(f.flips) >= 1),
        },
        {
          id: 'views',
          label: 'Look at the byte all three ways: **Voltage**, **Lights**, and **Bits**.',
          hint: 'Use the **View as** buttons at the top of the byte.',
          check: demoFact('byte', (f) => Number(f.views) >= 3),
        },
      ],
      questions: [
        {
          id: 'byte',
          kind: 'text',
          prompt: 'How many different patterns can **one byte** (8 bits) make?',
          placeholder: 'Type a number',
          expect: num(256),
          wrong: [
            { match: num(255), text: "255 is the biggest number a byte can hold, because counting starts at 0. How many patterns is that, counting 0?" },
            { match: num(16), text: '2 × 8 = 16. But each bit doubles the count, so multiply 2 by itself 8 times.' },
            { match: num(8), text: '8 is the number of bits. Keep doubling down the table: 16 for 4 bits, 32 for 5, and on to 8 bits.' },
            { match: num(64), text: '64 is 2⁶, the count for 6 bits. Keep doubling.' },
            { match: num(128), text: '128 is 2⁷, the count for 7 bits. Double once more.' },
          ],
          expectHint: 'Keep doubling down the table: 16 for 4 bits, 32 for 5, and on to 8 bits.',
          explain: '2⁸ = 256. One byte can stand for 256 different things, like the numbers 0 to 255.',
        },
        {
          id: 'stores',
          kind: 'choice',
          prompt: 'What does a computer chip really hold for each bit?',
          options: [
            { id: 'volt', text: 'A high or a low voltage', correct: true },
            { id: 'digit', text: 'A tiny printed 0 or 1', feedback: 'There are no printed digits inside a chip. 0 and 1 are names we give to low and high voltage.' },
            { id: 'ten', text: 'A digit from 0 to 9', feedback: 'A bit has only two states. The digits 0 to 9 are base 10.' },
            { id: 'bulb', text: 'A very small light bulb', feedback: 'Lights are one way to picture bits. The chip holds a voltage on a wire.' },
          ],
          explain: 'The voltage is real. The 0 and 1 are an abstraction: names that let us think about numbers instead of electricity.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'cards',
      title: 'Binary cards',
      body: md`
        Binary cards turn bits into something you can count. Each card has dots on its front: **16, 8, 4, 2, and 1**. A card **face up** is a 1. A card **face down** is a 0. The number the cards show is the total of the dots you can see.

        Tap a card to flip it. Make each number in the goals. Then look closely at the cards to answer the questions.
      `,
      demos: [{ kind: 'bits', id: 'cards', title: 'Binary cards', style: 'cards', places: 5, total: true, intro: 'Face up is 1. Face down is 0.' }],
      goals: [
        {
          id: 'nine',
          label: 'Make **9**.',
          hint: "Start with the biggest card that isn't too big. 16 is too big for 9, so start with 8. What's left?",
          check: demoFact('cards', (f) => f.value === 9),
        },
        {
          id: 'twenty-one',
          label: 'Make **21**.',
          hint: '16 fits in 21, and 21 − 16 = 5. Which cards make 5?',
          check: demoFact('cards', (f) => f.value === 21),
        },
        {
          id: 'thirty-one',
          label: 'Make **31**.',
          hint: 'How many cards do you need face up?',
          check: demoFact('cards', (f) => f.value === 31),
        },
      ],
      questions: [
        {
          id: 'biggest',
          kind: 'choice',
          prompt: "What is the biggest number the five cards can make, and why can't they make 32?",
          options: [
            { id: 'thirty-one', text: '31: all five face up add to 31, with no card left', correct: true },
            { id: 'thirty-two', text: '32: all five face up add to 32, a power of 2', feedback: 'Add them: 16 + 8 + 4 + 2 + 1 = 31. Making 32 would take a sixth card, worth 32.' },
            { id: 'sixteen', text: '16: the biggest card is the biggest number', feedback: 'You made 21 and 31, which are bigger than 16. Face-up cards add together.' },
            { id: 'five', text: '5: five cards can only make five numbers', feedback: 'Five cards make 2⁵ = 32 patterns: every number from 0 to 31.' },
          ],
          explain: '16 + 8 + 4 + 2 + 1 = 31. To make 32 you would need a sixth card, worth 32. Five bits stop at 31.',
        },
        {
          id: 'dots',
          kind: 'choice',
          prompt: "Compare each card's dots with the card to its right. What do you notice?",
          options: [
            { id: 'twice', text: 'Each card has twice as many dots', correct: true },
            { id: 'two-more', text: 'Each card has 2 more dots', feedback: 'The 16 card has 8 more dots than the 8 card, not 2 more. Try multiplying instead of adding.' },
            { id: 'half', text: 'Each card has half as many dots', feedback: "That's true the other way around: each card has half as many dots as the card to its left." },
            { id: 'one-more', text: 'Each card has 1 more dot', feedback: '1, 2, 4, 8, 16 jumps by more each time. How many times bigger is each card?' },
          ],
          explain: 'Each place is worth twice the place to its right. That doubling is what makes binary work: 1, 2, 4, 8, 16, 32, 64, 128.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'to-decimal',
      title: 'Binary to decimal',
      body: md`
        A byte has eight places. Their values double from right to left: **128, 64, 32, 16, 8, 4, 2, 1**.

        Always find the 1s place first. It's the **rightmost** bit. A common mistake is to read the bits from the wrong end.

        **Binary to decimal:** add up the place values that have a 1 under them. Skip the 0s.

        Work both examples on the right. Tap each 1 to add its place value.
      `,
      demos: [{ kind: 'read-walk', id: 'read', title: 'Worked examples: binary to decimal', examples: ['01001010', '10010011'] }],
      goals: [
        { id: 'ex1', label: 'Turn **01001010** into decimal.', hint: 'Tap the three 1s.', check: demoFact('read', (f) => Number(f.finished) >= 1) },
        { id: 'ex2', label: 'Turn **10010011** into decimal.', hint: 'Press **Next example** first, then tap the 1s.', check: demoFact('read', (f) => Number(f.finished) >= 2) },
      ],
      questions: [
        {
          id: 'backward',
          kind: 'choice',
          prompt: 'Sam says **00000011** is 192. What did Sam do wrong?',
          options: [
            { id: 'end', text: 'Read the bits from the wrong end', correct: true },
            { id: 'multiply', text: 'Added the place values instead of multiplying', feedback: 'Adding is right. The trouble is which place values Sam added.' },
            { id: 'zeros', text: 'Forgot to count the 0s', feedback: 'The 0s add nothing, so skipping them is right.' },
            { id: 'nothing', text: 'Nothing: 00000011 is 192', feedback: "Find the 1s place first: it's on the right. The two 1s sit in the 2s and 1s places." },
          ],
          explain: 'The two 1s sit in the 2s and 1s places, so 00000011 is 2 + 1 = 3. Sam used 128 and 64, as if the left end were the 1s place.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'practice-decimal',
      title: 'Practice: binary to decimal',
      body: md`
        Worksheet problems 1 to 5. Turn each byte into decimal, then press **Check**.

        Use the place-value board on the right as scratch paper. Tap the boxes to copy a byte onto it, then add the place values over each 1. You can type your work if you like, such as 8 + 2 = 10.
      `,
      demos: [scratch],
      questions: [
        toDecimal('w1', 10, '00001010', 2),
        toDecimal('w2', 45, '00101101', 4),
        toDecimal('w3', 100, '01100100', 3),
        {
          ...toDecimal('w4', 255, '11111111', 8),
          wrong: [
            { match: num(256), text: 'Close. 256 is how many patterns 8 bits make, counting 0. The biggest number is one less.' },
            { match: num(8), text: COUNT_ONES },
            { match: bitsRe('11111111'), text: "That's the binary number again. Add the place values that have a 1 under them." },
          ],
        },
        toDecimal('w5', 129, '10000001', 2),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'to-binary',
      title: 'Decimal to binary',
      body: md`
        To go from decimal to binary, ask **does it fit?** Start at the 128s place and move right, one place at a time:

        1. Does the place value fit in what's left of your number? (It fits if it's the same or smaller.)
        2. If it fits, write **1** and subtract it.
        3. If it's too big, write **0**.

        When you reach the 1s place, nothing should be left.

        Work both examples on the right. At each place, choose **Fits: write 1** or **Too big: write 0**.
      `,
      demos: [{ kind: 'fit-walk', id: 'fit', title: 'Worked examples: does it fit?', examples: [75, 156] }],
      goals: [
        { id: 'ex1', label: 'Turn **75** into binary.', check: demoFact('fit', (f) => Number(f.finished) >= 1) },
        { id: 'ex2', label: 'Turn **156** into binary.', hint: 'Press **Next example** first.', check: demoFact('fit', (f) => Number(f.finished) >= 2) },
      ],
      questions: [
        {
          id: 'max',
          kind: 'choice',
          prompt: 'What is the biggest number one byte can hold?',
          options: [
            { id: '255', text: '255', correct: true },
            { id: '256', text: '256', feedback: 'A byte has 256 patterns, but one of them is 00000000, which is 0. Counting from 0, the biggest is one less.' },
            { id: '128', text: '128', feedback: '128 is the biggest place value. With every bit set to 1, the byte holds 128 + 64 + 32 + 16 + 8 + 4 + 2 + 1.' },
            { id: '8', text: '8', feedback: 'A byte has 8 bits. The biggest number is what you get with all eight set to 1.' },
          ],
          explain: "11111111 = 128 + 64 + 32 + 16 + 8 + 4 + 2 + 1 = 255. That's one less than 256, the number of patterns, because 0 is a pattern too.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'practice-binary',
      title: 'Practice: decimal to binary',
      body: md`
        Worksheet problems 6 to 10. Turn each number into **8-bit** binary. Write all eight bits, with 0s in front if you need them. For example, 5 is 00000101.

        Use the board on the right as scratch paper.
      `,
      demos: [scratch],
      questions: [
        toBinary('w6', 13, '00001101'),
        toBinary('w7', 50, '00110010'),
        toBinary('w8', 77, '01001101'),
        toBinary('w9', 200, '11001000'),
        toBinary('w10', 255, '11111111', [{ match: bitsRe('100000000'), text: "That's 256, which needs 9 bits. 255 is one less: all eight bits are 1." }]),
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'compare',
      title: 'Which is bigger?',
      body: md`
        You can compare two binary numbers without converting them.

        1. Make sure they have the same number of bits. If one is shorter, put 0s in front of it.
        2. Scan **from the left**. The first place where they differ decides: the number with the 1 there is bigger.

        Why does that work? One place is worth more than all the places to its right put together. 64 is more than 32 + 16 + 8 + 4 + 2 + 1 = 63.

        Lining up matters. 1001 and 110 both start with 1, but 1001 is 9 and 110 is 6. Compare their first digits and you learn nothing.

        Try all three pairs on the right.
      `,
      demos: [
        {
          kind: 'compare',
          id: 'compare',
          title: 'Compare two numbers',
          pairs: [
            ['01101001', '01100111'],
            ['10000000', '01111111'],
            ['1001', '110'],
          ],
        },
      ],
      goals: [
        { id: 'pairs', label: 'Compare the first two pairs.', hint: 'Tap the leftmost column where the two numbers have different bits.', check: demoFact('compare', (f) => Number(f.finished) >= 2) },
        { id: 'ragged', label: 'Compare **1001** and **110**.', hint: 'Press **Line them up** first.', check: demoFact('compare', (f) => Number(f.finished) >= 3) },
      ],
      questions: [
        {
          id: 'order',
          kind: 'choice',
          prompt: 'Worksheet problem 11. Put these in order from least to greatest: **01011010, 00111111, 01010111, 10000000**.',
          options: [
            { id: 'right', text: '00111111, 01010111, 01011010, 10000000', correct: true },
            {
              id: 'backward',
              text: '10000000, 01011010, 01010111, 00111111',
              feedback: "That's greatest to least. (Counting 1s gives this order too, and it's backward: 00111111 has the most 1s but is the smallest.)",
            },
            { id: 'swap', text: '00111111, 01011010, 01010111, 10000000', feedback: '01011010 and 01010111 first differ in the 8s place. Which one has the 1 there?' },
            { id: 'mixed', text: '01010111, 01011010, 00111111, 10000000', feedback: '00111111 has a 0 in the 64s place, and the next two have a 1 there. That makes it the smallest of those three.' },
          ],
          explain: "In decimal they're 63, 87, 90, and 128. Scanning from the left was enough. You didn't need to convert them.",
        },
        {
          id: 'shortcut',
          kind: 'choice',
          prompt: 'Which shortcut puts them in order without converting all of them?',
          options: [
            { id: 'first-diff', text: 'Find the first place from the left where they differ', correct: true },
            { id: 'count', text: 'Count the 1s: more 1s means a bigger number', feedback: '00111111 has six 1s but is the smallest. Where a 1 sits matters more than how many 1s there are.' },
            { id: 'last', text: 'Look at the last bit: a 1 there means bigger', feedback: 'The last bit is worth only 1. It decides only when every other place matches.' },
            { id: 'first', text: 'Compare only the first digit of each number', feedback: 'The first digit picks out 10000000, but the other three all start with 0. Keep scanning to the first place they differ.' },
          ],
          explain: 'One place is worth more than all the places to its right put together, so the leftmost difference decides.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'overflow',
      title: 'Overflow',
      body: md`
        A car's **odometer** counts miles with a fixed number of digits. Press **+1** on the odometer until it passes 999. What happens?

        Computers store each number in a fixed number of bits, so they hit the same wall. A 4-bit number goes from 0000 to 1111 (0 to 15). Press **+1** on the 4-bit counter until it passes 1111.

        When a result needs more bits than there are, the extra bit on the left is lost, and the stored value is wrong. That's an **overflow error**. The program usually keeps running with the wrong number. Nothing crashes, which is why overflow can go unnoticed.
      `,
      demos: [
        { kind: 'counter', id: 'odometer', title: 'Odometer (3 digits)', base: 10, digits: 3, start: 995 },
        { kind: 'counter', id: 'counter', title: '4-bit counter', base: 2, digits: 4, start: 12 },
      ],
      goals: [
        { id: 'odometer', label: 'Roll the odometer past **999**.', check: demoFact('odometer', (f) => Number(f.overflows) >= 1) },
        { id: 'counter', label: 'Make the 4-bit counter overflow.', hint: 'Keep pressing **+1** on the 4-bit counter until it passes 1111.', check: demoFact('counter', (f) => Number(f.overflows) >= 1) },
      ],
      questions: [
        {
          id: 'w14',
          kind: 'text',
          prompt: 'Worksheet problem 14. A 4-bit counter shows **1110**. It counts up 2 more times. What does it show now? (Type 4 bits.)',
          placeholder: 'Type 4 bits',
          expect: bitsRe('0000'),
          wrong: [
            { match: bitsRe('10000'), text: '1110 + 2 is 10000, but that needs 5 bits. The counter has only 4, so the 1 on the left is lost.' },
            { match: num(16), text: '16 is the true total, but the counter shows 4 bits. 16 is 10000 in binary. Which 4 bits are left?' },
            { match: bitsRe('1111'), text: "That's one count up. Count once more." },
            { match: /^\s*(?:0\s*){0,3}1\s*$/, text: 'Count it out one step at a time: 1110, then 1111, then one more.' },
          ],
          expectHint: 'Count up one at a time: 1110, then 1111, then one more. You can try it on the 4-bit counter.',
          explain: '1110 is 14, and 14 + 2 = 16, which is 10000. That needs 5 bits, so a 4-bit counter keeps only 0000. Overflow.',
        },
        {
          id: 'meaning',
          kind: 'choice',
          prompt: 'What happens in an **overflow error**?',
          options: [
            { id: 'wrong', text: 'The result needs more bits than there are, so the stored value is wrong', correct: true },
            { id: 'crash', text: 'The computer crashes and has to restart right away', feedback: 'Usually nothing crashes. The program keeps going with a wrong number, which is why overflow is hard to spot.' },
            { id: 'grow', text: 'The computer adds another bit so that the number fits', feedback: 'The number of bits is fixed. The extra bit has nowhere to go, so it is lost.' },
            {
              id: 'round',
              text: 'The number is rounded to the closest value it can store',
              feedback: "That's rounding error, a different problem. Overflow keeps only the bits that fit, so 1111 + 1 becomes 0000, which is nowhere near 16.",
            },
          ],
          explain: 'The stored value is wrong, and the program carries on with it. On the AP exam, overflow means a wrong value, not a crash.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'limits',
      title: 'How many bits do you need?',
      body: md`
        With **n** bits there are 2ⁿ patterns. Counting from 0, they stand for the numbers **0 to 2ⁿ − 1**. For example, 4 bits make 16 patterns: the numbers 0 to 15.

        To give every item its own code, you need at least as many patterns as items. Keep doubling until you reach the number of items: 2, 4, 8, 16, 32, 64, 128, and so on.

        **Rounding.** Some numbers can't be stored exactly in any number of bits. 1 ÷ 3 is 0.3333…, with 3s that never end. A computer keeps a fixed number of digits, so it stores a number close to 1/3 but not equal to it. That small difference is a **rounding error**. Try it on the right. (Computers keep binary digits, not decimal ones, but the problem is the same.)
      `,
      demos: [{ kind: 'rounding', id: 'round', title: 'Rounding: 1 ÷ 3', digits: [2, 4, 8], intro: 'Choose how many digits the computer keeps after the decimal point.' }],
      goals: [
        {
          id: 'round',
          label: 'Keep more digits and see whether the rounding error goes away.',
          hint: 'Choose **4** or **8** under Digits kept.',
          check: demoFact('round', (f) => Number(f.tried) >= 2),
        },
      ],
      questions: [
        {
          id: 'w12-values',
          kind: 'text',
          prompt: 'Worksheet problem 12. How many different values can **6 bits** represent?',
          placeholder: 'Type a number',
          expect: num(64),
          wrong: [
            { match: num(12), text: '2 × 6 = 12. But each bit doubles the count, so multiply 2 by itself 6 times.' },
            { match: num(36), text: '6 × 6 = 36. Multiply 2 by itself 6 times instead.' },
            { match: num(63), text: '63 is the biggest value. Count the 0 too: how many values is that?' },
            { match: num(32), text: '32 is 2⁵, the count for 5 bits. One more bit doubles it.' },
          ],
          expectHint: 'Each bit doubles the count: 2, 4, 8, ... for 1, 2, 3 bits. Keep going to 6.',
          explain: '2⁶ = 64.',
        },
        {
          id: 'w12-range',
          kind: 'text',
          prompt: 'What range of whole numbers is that, starting at 0? Type it like **0 to 15**.',
          placeholder: 'Like 0 to 15',
          expect: rangeRe(0, 63),
          wrong: [
            { match: rangeRe(0, 64), text: '0 to 64 is 65 numbers. With 64 values starting at 0, the last one is 63.' },
            { match: rangeRe(1, 64), text: 'Start at 0: 000000 is the first pattern. The last value is then one less than 64.' },
          ],
          expectHint: 'Start at 0. The last value is one less than the number of values.',
          explain: '64 values: 0, 1, 2, and so on up to 63, which is 111111.',
        },
        {
          id: 'w13',
          kind: 'text',
          prompt: 'Worksheet problem 13. What is the fewest bits needed to give **100** items each a unique code?',
          placeholder: 'Type a number',
          expect: num(7),
          wrong: [
            { match: num(6), text: "6 bits make 2⁶ = 64 codes. That's too few for 100 items." },
            { match: num(8), text: '8 bits work, but 7 bits already make 2⁷ = 128 codes, which is enough for 100.' },
            { match: num(100), text: "You don't need one bit per item. Each bit doubles the number of codes." },
            { match: num(128), text: '128 is how many codes you get. The question asks how many bits that takes.' },
          ],
          expectHint: 'Keep doubling: 2, 4, 8, 16, 32, 64, 128. How many bits until there are at least 100 codes?',
          explain: '2⁶ = 64 is too few. 2⁷ = 128 is enough. So 7 bits.',
        },
        {
          id: 'third',
          kind: 'choice',
          prompt: "Why can't a computer store 1/3 exactly?",
          options: [
            { id: 'digits', text: 'It keeps a fixed number of digits, and 1/3 never ends', correct: true },
            { id: 'whole', text: 'Computers can store only whole numbers', feedback: 'Computers store fractions too, with a fixed number of digits.' },
            { id: 'big', text: '1/3 is too big a number to fit in a byte', feedback: "1/3 is small. The trouble is that its digits never end." },
            { id: 'enough', text: 'It can, if it keeps enough digits', feedback: "More digits make the error smaller, as the demo showed. The 3s never end, though, so some error is always left." },
          ],
          explain: 'Any fixed number of digits cuts 1/3 off somewhere. The small difference is a rounding error.',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'exit',
      title: 'Exit ticket',
      body: md`
        Answer these four questions on your own, the way you would on the AP exam. Your teacher uses them to plan the next class.

        Think before you press **Check**: your report shows how many tries each one took. The board on the right is scratch paper.
      `,
      demos: [scratch],
      questions: [
        {
          id: 'e1',
          kind: 'choice',
          prompt: 'What is the decimal value of the binary number **01011**?',
          options: [
            { id: '9', text: '9', feedback: '9 is 01001. You missed the 1 in the 2s place. The places here are 16, 8, 4, 2, and 1.' },
            { id: '11', text: '11', correct: true },
            { id: '13', text: '13', feedback: '13 is 01101. Check which places hold the 1s: count the places from the right, starting at 1.' },
            { id: '22', text: '22', feedback: '22 is double the answer. The rightmost place is worth 1, not 2.' },
          ],
          explain: '01011 = 8 + 2 + 1 = 11.',
        },
        {
          id: 'e2',
          kind: 'choice',
          prompt: 'Which of the following is the greatest value?',
          options: [
            { id: 'b192', text: 'Binary 11000000', correct: true },
            { id: 'd190', text: 'Decimal 190', feedback: 'Binary 11000000 is 128 + 64 = 192, which beats 190.' },
            { id: 'b191', text: 'Binary 10111111', feedback: '10111111 has more 1s, but it is 191. It first differs from 11000000 in the 64s place, where it has the 0.' },
            { id: 'd189', text: 'Decimal 189', feedback: '189 is the smallest of the four. Binary 11000000 is 192 and 10111111 is 191.' },
          ],
          explain: '11000000 = 192 and 10111111 = 191, so binary 11000000 is the greatest.',
        },
        {
          id: 'e3',
          kind: 'choice',
          prompt: 'A school district has 1,200 students. What is the minimum number of bits needed to give every student a unique ID number?',
          options: [
            { id: '10', text: '10', feedback: "2¹⁰ = 1,024 IDs. That's too few for 1,200 students." },
            { id: '11', text: '11', correct: true },
            { id: '12', text: '12', feedback: '12 bits work (4,096 IDs), but 11 bits already give 2,048, and the question asks for the fewest.' },
            { id: '1200', text: '1,200', feedback: "You don't need one bit per student. Each bit doubles the number of IDs." },
          ],
          explain: '2¹⁰ = 1,024 is too few. 2¹¹ = 2,048 covers 1,200.',
        },
        {
          id: 'e4',
          kind: 'text',
          prompt: 'In 1 or 2 sentences, explain what an **overflow error** is. Give an example using a 4-bit number.',
          minWords: 15,
          lines: 3,
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'extra',
      title: 'If you finish early: hex and ASCII',
      body: md`
        **This step is optional.** If class is almost over, press **Continue** and hand in your work first. You can come back to this step after you hand in.

        **Hexadecimal** is base 16. It uses 16 digits: 0 to 9, then A to F (A is 10 and F is 15). One hex digit stands for exactly 4 bits, because 2⁴ = 16. So any byte is two hex digits: 11111111 is FF. Flip the bits on the right and watch the hex digits change.

        **ASCII** is a code that gives each letter, digit, and symbol a number from 0 to 127. Capital A is 65, which is 01000001 as a byte. Type a word to see its bytes.
      `,
      demos: [
        { kind: 'bits', id: 'hex', title: 'Binary to hex', style: 'hex', places: 8, total: true, start: '10101111', intro: 'Each group of 4 bits is one hex digit.' },
        { kind: 'ascii', id: 'ascii', title: 'ASCII', start: 'Hi', intro: 'Type a word of up to 10 characters.' },
      ],
    },

    // -----------------------------------------------------------------------
    {
      id: 'submit',
      title: 'Review and submit',
      kind: 'submit',
      body: md`
        Look over your summary on the right. You can go back to any step and change an answer, then hand in your work again.
      `,
    },
  ],
};
