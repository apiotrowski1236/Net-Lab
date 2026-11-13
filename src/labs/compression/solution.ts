import type { DemoInput } from '../../demos/types';
import type { LabSolution, Move } from '../solution';

/** Answer key for compression. Every move goes through the same demo models the stage uses. */

const on = (demo: string, ...inputs: DemoInput[]): Move[] => inputs.map((input) => ({ demo, input }));
const steps = (demo: string, n: number) => on(demo, ...Array.from({ length: n }, () => ({ advance: 1 }) as DemoInput));
/** The black squares of an 8×8 checkerboard, starting at the top left. */
const CHECKERBOARD = Array.from({ length: 64 }, (_, i) => i).filter((i) => ((i % 8) + Math.floor(i / 8)) % 2 === 0);

export const compressionSolution: LabSolution = {
  pixels: {
    // A blue corner, a yellow pixel, and the left eye (row 3, pixel 3).
    moves: on('pixels', { peek: 0 }, { peek: 2 }, { peek: 18 }),
    text: { bytes: '192' },
  },
  runs: {
    // Row 1 one pixel at a time, then the rest.
    moves: [...steps('encode', 8), ...on('encode', { finish: true })],
  },
  'rebuild-runs': {
    // Row 1 is 3 runs: 2 blue, 4 yellow, 2 blue.
    moves: [...steps('decode', 3), ...on('decode', { finish: true })],
  },
  average: {
    moves: [...steps('encode', 4), ...on('encode', { finish: true })],
    text: { 'avg-red': '600 / 4 = 150', 'stored-bytes': '48 bytes' },
  },
  stretch: {
    moves: [...steps('decode', 4), ...on('decode', { finish: true }, { changes: true })],
  },
  'side-by-side': {
    moves: on('squeeze', { method: 'runs' }, { method: 'avg2' }, { changes: true }),
    text: { saved: '192 - 104 = 88' },
  },
  'bigger-squares': {
    moves: on('squeeze', { method: 'avg2' }, { method: 'avg4' }, { method: 'avg8' }),
  },
  'no-runs': {
    // The lake is first. Picking the receipt keeps Runs picked.
    moves: on('squeeze', { method: 'runs' }, { picture: 'receipt' }),
  },
  details: {
    // The receipt is first. Picking the lake keeps Average 2×2 picked.
    moves: on('squeeze', { method: 'runs' }, { method: 'avg2' }, { picture: 'lake' }),
    text: { total: '$14.05' },
  },
  review: {
    text: {
      q4: 'Lossless compression rebuilds the original exactly, like runs did for the smiley with 0 pixels changed. Lossy compression throws away some detail to make a smaller file, like averaging the lake photo, which looked about the same but changed pixels that can never come back.',
    },
  },
  // Optional extra challenge, after the submit step.
  paint: {
    // A checkerboard is 64 runs of 1 pixel: 256 bytes, more than 192. Then one black 2×2
    // square lined up with the averaging squares: nothing changes.
    moves: [...on('paint', ...CHECKERBOARD.map((paint) => ({ paint }))), ...on('paint', { clear: true }, { paint: 0 }, { paint: 1 }, { paint: 8 }, { paint: 9 })],
  },
};
