import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';

/** Answer key for binary-numbers. Every move goes through the same demo models the stage uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const flips = (demo: string, ...cols: number[]) => on(demo, ...cols.map((flip) => ({ flip })));
const taps = (demo: string, ...cols: number[]) => on(demo, ...cols.map((tap) => ({ tap })));
/** "Does it fit?" calls for each place, left to right, from the bits of the answer. */
const says = (demo: string, bits: string) => on(demo, ...[...bits].map((c) => ({ say: c === '1' ? 1 : 0 }) as DemoInput));
const adds = (demo: string, n: number) => on(demo, ...Array.from({ length: n }, () => ({ add: 1 })));

export const binaryNumbersSolution: LabSolution = {
  switches: {
    moves: [
      // 1 switch: off is already a pattern, so one flip finds both.
      ...flips('switches', 0),
      // 2 switches: 00, then 10, 11, 01.
      ...on('switches', { use: 2 }),
      ...flips('switches', 0, 1, 0),
      // 3 switches: change one switch at a time to visit all 8 (a Gray code).
      ...on('switches', { use: 3 }),
      ...flips('switches', 0, 1, 0, 2, 0, 1, 0),
    ],
    text: { four: '16' },
  },
  bits: {
    // 2305 -> 2306; then 1100 (12) -> 1000 -> 1010 (10).
    moves: [...on('base10', { bump: 3, by: 1 }), ...flips('base2', 1, 2)],
    text: { byte: '256' },
  },
  cards: {
    // Cards are 16 8 4 2 1. 9 = 8 + 1; then 21 = 16 + 4 + 1; then 31 = all five.
    moves: [...flips('cards', 1, 4), ...flips('cards', 0, 1, 2), ...flips('cards', 1, 3)],
  },
  'to-decimal': {
    // 01001010 = 64 + 8 + 2 = 74; 10010011 = 128 + 16 + 2 + 1 = 147.
    moves: [...taps('read', 1, 4, 6), ...on('read', { next: true }), ...taps('read', 0, 3, 6, 7)],
  },
  'practice-decimal': {
    text: { w1: '8 + 2 = 10', w2: '45', w3: '100', w4: '255', w5: '129' },
  },
  'to-binary': {
    moves: [...says('fit', '01001011'), ...on('fit', { next: true }), ...says('fit', '10011100')],
  },
  'practice-binary': {
    text: { w6: '00001101', w7: '0011 0010', w8: '01001101', w9: '11001000', w10: '11111111' },
  },
  compare: {
    moves: [
      // 01101001 vs 01100111: first differ in the 8s place (column 4). 105 > 103.
      ...on('compare', { tap: 4 }, { pick: 0 }, { next: true }),
      // 10000000 vs 01111111: the 128s place decides. 128 > 127.
      ...on('compare', { tap: 0 }, { pick: 0 }, { next: true }),
      // 1001 vs 110: line up as 1001 and 0110, then the 8s place decides. 9 > 6.
      ...on('compare', { pad: true }, { tap: 0 }, { pick: 0 }),
    ],
  },
  limits: {
    text: { 'w12-values': '64', 'w12-range': '0 to 63', w13: '7' },
  },
  overflow: {
    // 995 to 999 to 000 is 5 counts; 1100 (12) to 1111 to 0000 is 4.
    moves: [...adds('odometer', 5), ...adds('counter', 4)],
    text: { w14: '0000' },
  },
  rounding: {
    moves: on('round', { digits: 4 }),
  },
  exit: {
    text: {
      e4: 'An overflow error happens when a result needs more bits than the computer has, so the stored value is wrong. In 4 bits, 1111 + 1 should be 10000, but it shows 0000.',
    },
  },
  // Extra credit, after the submit step.
  hex: {
    // 10101111 (AF) -> 00101010 (2A).
    moves: flips('hex', 0, 5, 7),
  },
  colors: {
    // Red FF to start. Orange: green's first bit on (80). Yellow: the rest of green on (FF).
    // White: all of blue on too.
    moves: [...flips('color', 8), ...flips('color', 9, 10, 11, 12, 13, 14, 15), ...flips('color', 16, 17, 18, 19, 20, 21, 22, 23)],
  },
  text: {
    moves: on('ascii', { text: 'Hello' }),
  },
  meaning: {
    // 01000001 (A, 65) -> 01001011 (K, 75) -> 11111111 (white).
    moves: [...flips('byte', 4, 6), ...flips('byte', 0, 2, 3, 5)],
  },
};
