/**
 * Pictures and the two compression methods in the compression lesson
 * (src/labs/compression): run-length encoding, which is lossless, and
 * averaging squares of pixels, which is lossy.
 *
 * Every picture is drawn by code, the same way every time, so the lesson
 * works offline and a check always sees the same pixels. A pixel's color is
 * three bytes, red, green, and blue, from 0 to 255.
 */

export type RGB = readonly [number, number, number];

export interface Picture {
  w: number;
  h: number;
  /** Row by row, left to right, top to bottom. */
  px: RGB[];
}

export type PictureId = 'smiley' | 'beach' | 'receipt';

export interface PictureInfo {
  /** What the picker calls it. */
  name: string;
  /** One sentence about where a picture like this comes from. */
  about: string;
  make: () => Picture;
}

/** Bytes in one pixel's color: one each for red, green, and blue. */
export const PIXEL_BYTES = 3;
/** Bytes in one run: a 1-byte count and a 3-byte color. */
export const RUN_BYTES = 4;
/** The most pixels one run's 1-byte count can hold. */
export const RUN_MAX = 255;

// ---------------------------------------------------------------------------
// Colors

/** The named colors of the small pictures, and the names the lesson uses for them. */
export const BLUE: RGB = [80, 160, 240];
export const YELLOW: RGB = [255, 220, 0];
export const BLACK: RGB = [0, 0, 0];
export const WHITE: RGB = [255, 255, 255];
export const RED: RGB = [230, 40, 40];
export const GREEN: RGB = [40, 160, 80];

const NAMES: [RGB, string][] = [
  [BLUE, 'blue'],
  [YELLOW, 'yellow'],
  [BLACK, 'black'],
  [WHITE, 'white'],
  [RED, 'red'],
  [GREEN, 'green'],
];

export const sameColor = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** "blue" for a named color, or undefined for a mix such as an average. */
export const colorName = (c: RGB): string | undefined => NAMES.find(([n]) => sameColor(n, c))?.[1];

export const css = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** A text color that reads on top of `c`. */
export const inkOn = (c: RGB) => (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 > 150 ? '#111' : '#fff');

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// ---------------------------------------------------------------------------
// Run-length encoding (lossless)

/** A run: `count` pixels in a row of the same color. */
export interface Run {
  count: number;
  color: RGB;
}

/** One row's runs, left to right. A run never goes past the end of its row, or past RUN_MAX pixels. */
export function rowRuns(row: readonly RGB[]): Run[] {
  const runs: Run[] = [];
  for (const c of row) {
    const last = runs[runs.length - 1];
    if (last && sameColor(last.color, c) && last.count < RUN_MAX) last.count++;
    else runs.push({ count: 1, color: c });
  }
  return runs;
}

export const rowOf = (p: Picture, y: number) => p.px.slice(y * p.w, (y + 1) * p.w);

/** Every row's runs, top to bottom. */
export const runsOf = (p: Picture): Run[][] => Array.from({ length: p.h }, (_, y) => rowRuns(rowOf(p, y)));

/** Rebuild a picture from its runs: each run becomes `count` pixels of its color. */
export function unRun(rows: Run[][], w: number): Picture {
  const px: RGB[] = [];
  for (const row of rows) for (const r of row) for (let i = 0; i < r.count; i++) px.push(r.color);
  return { w, h: rows.length, px };
}

export const runCount = (rows: Run[][]) => rows.reduce((n, row) => n + row.length, 0);

// ---------------------------------------------------------------------------
// Averaging squares (lossy)

/** The average of some colors, each channel rounded to a whole number. */
export function average(colors: readonly RGB[]): RGB {
  const sum = [0, 1, 2].map((k) => colors.reduce((t, c) => t + c[k], 0));
  return [clamp(sum[0] / colors.length), clamp(sum[1] / colors.length), clamp(sum[2] / colors.length)];
}

/** The pixels of the k×k square at square column `bx`, square row `by`, row by row. */
export function square(p: Picture, k: number, bx: number, by: number): RGB[] {
  const out: RGB[] = [];
  for (let y = by * k; y < (by + 1) * k; y++) for (let x = bx * k; x < (bx + 1) * k; x++) out.push(p.px[y * p.w + x]);
  return out;
}

/** The stored picture: one pixel per k×k square, its average. The width and height must divide by k. */
export function shrink(p: Picture, k: number): Picture {
  const w = p.w / k;
  const h = p.h / k;
  const px: RGB[] = [];
  for (let by = 0; by < h; by++) for (let bx = 0; bx < w; bx++) px.push(average(square(p, k, bx, by)));
  return { w, h, px };
}

/** Rebuild from a stored picture: each stored pixel becomes a k×k square of its color. */
export function stretch(small: Picture, k: number): Picture {
  const w = small.w * k;
  const h = small.h * k;
  const px: RGB[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.push(small.px[Math.floor(y / k) * small.w + Math.floor(x / k)]);
  return { w, h, px };
}

// ---------------------------------------------------------------------------
// Comparing

/** How far a pixel moved: the biggest change in red, green, or blue (0 to 255). */
export const pixelChange = (a: RGB, b: RGB) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** How many pixels of `b` aren't exactly the color of the same pixel in `a`. */
export const changedPixels = (a: Picture, b: Picture) => a.px.reduce((n, c, i) => n + (sameColor(c, b.px[i]) ? 0 : 1), 0);

// ---------------------------------------------------------------------------
// Methods, as the lesson offers them

export type Method = 'none' | 'runs' | 'avg2' | 'avg4' | 'avg8';

export const METHOD_NAME: Record<Method, string> = {
  none: 'Original',
  runs: 'Runs (lossless)',
  avg2: 'Average 2×2 (lossy)',
  avg4: 'Average 4×4 (lossy)',
  avg8: 'Average 8×8 (lossy)',
};

/** The square size of an averaging method, or undefined for the others. */
export const squareOf = (m: Method): number | undefined => ({ avg2: 2, avg4: 4, avg8: 8 })[m as 'avg2'];

export interface Result {
  /** Bytes the compressed picture takes. */
  bytes: number;
  /** The picture rebuilt from the compressed data. */
  rebuilt: Picture;
  /** Pixels whose color isn't exactly what it was. */
  changed: number;
  /** The runs, for 'runs'. */
  runs?: number;
  /** The stored picture, for an average. */
  stored?: Picture;
}

export const rawBytes = (p: Picture) => p.w * p.h * PIXEL_BYTES;

export function compress(p: Picture, m: Method): Result {
  if (m === 'none') return { bytes: rawBytes(p), rebuilt: p, changed: 0 };
  if (m === 'runs') {
    const rows = runsOf(p);
    const rebuilt = unRun(rows, p.w);
    return { bytes: runCount(rows) * RUN_BYTES, rebuilt, changed: changedPixels(p, rebuilt), runs: runCount(rows) };
  }
  const k = squareOf(m)!;
  const stored = shrink(p, k);
  const rebuilt = stretch(stored, k);
  return { bytes: rawBytes(stored), rebuilt, changed: changedPixels(p, rebuilt), stored };
}

const results = new Map<string, Result>();

/** `compress` for a picture from the library, worked out once. */
export function resultOf(id: PictureId, m: Method): Result {
  const key = `${id}:${m}`;
  let r = results.get(key);
  if (!r) results.set(key, (r = compress(picture(id), m)));
  return r;
}

/** A picture's size as a share of the original: "54%". */
export const percentOf = (bytes: number, of: number) => `${Math.round((bytes / of) * 100)}%`;

// ---------------------------------------------------------------------------
// The pictures

/** Draw a picture from rows of letters, one letter per pixel. */
function fromRows(rows: string[], key: Record<string, RGB>): Picture {
  const w = rows[0].length;
  return { w, h: rows.length, px: rows.flatMap((r) => [...r].map((ch) => key[ch])) };
}

/** 8×8 pixel art with three colors: the picture both walk-throughs use. */
export const SMILEY_ROWS = ['BBYYYYBB', 'BYYYYYYB', 'YYKYYKYY', 'YYYYYYYY', 'YKYYYYKY', 'YYKKKKYY', 'BYYYYYYB', 'BBYYYYBB'];

const smiley = () => fromRows(SMILEY_ROWS, { B: BLUE, Y: YELLOW, K: BLACK });

/** A number from 0 to 1 that looks random but is the same for the same inputs. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Distance from point (px, py) to the segment from (ax, ay) to (bx, by). */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** How much of a shape covers a pixel: 1 inside, 0 outside, with an edge `soft` wide, so edges look smooth the way a camera sees them. */
const cover = (d: number, r: number, soft: number) => 1 - smooth((d - r + soft / 2) / soft);

/**
 * A vacation photo: a beach at sunset with a palm tree, a sailboat, and two
 * birds. It is drawn in a 96×64 "scene" scaled up to BEACH_W × BEACH_H pixels,
 * with smooth gradients and soft edges, plus a little camera noise in every
 * pixel, the way a real photo has, so almost no two pixels side by side match.
 * It has enough pixels that a 2×2 square is a tiny part of the scene.
 */
export const BEACH_W = 240;
export const BEACH_H = 160;

function beach(): Picture {
  const w = BEACH_W;
  const h = BEACH_H;
  const S = w / 96;
  const soft = 1.2 / S;
  const horizon = 30;
  const sun = { x: 66, y: 22, r: 6 };
  // The palm trunk bends from the sand up to the leaves.
  const trunk = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return { x: 16 + 8 * t + 3 * Math.sin(t * Math.PI), y: 66 - 44 * t, r: 1.6 - 0.7 * t };
  });
  const top = trunk[trunk.length - 1];
  // Each leaf is a drooping arc of short segments from the top of the trunk.
  const leaves = [-2.75, -2.25, -1.6, -1.0, -0.45, 0.15].map((a) => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 8; i++) {
      const s = i / 8;
      const len = 15 * s;
      pts.push({ x: top.x + Math.cos(a) * len, y: top.y + Math.sin(a) * len + 7 * s * s });
    }
    return pts;
  });
  // Two birds, each a small V.
  const birds = [
    { x: 40, y: 7 },
    { x: 45.5, y: 5 },
  ];
  const px: RGB[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Where this pixel sits in the scene.
      const sx = (x + 0.5) / S;
      const sy = (y + 0.5) / S;
      let c: RGB;
      const shore = 47 + 2 * Math.sin(sx * 0.13 + 1) + 0.6 * Math.sin(sx * 0.5);
      if (sy < horizon) {
        // Sky: deep blue at the top to orange at the horizon, with soft clouds and the sun.
        const t = sy / horizon;
        c = mix([45, 85, 165], [250, 160, 100], smooth(t * 1.05));
        const cloud = Math.exp(-(((sx - 26) / 14) ** 2) - ((sy - 12) / 3.2) ** 2) + 0.7 * Math.exp(-(((sx - 40) / 9) ** 2) - ((sy - 15) / 2.4) ** 2);
        c = mix(c, [255, 200, 190], Math.min(0.75, cloud * 0.8));
        const d = Math.hypot(sx - sun.x, sy - sun.y);
        c = mix(c, [255, 210, 140], 0.6 * Math.exp(-(((d - sun.r) / 9) ** 2)) * (d > sun.r ? 1 : 0));
        c = mix(c, mix([255, 240, 190], [255, 205, 125], Math.min(1, d / sun.r)), cover(d, sun.r, soft));
        for (const b of birds) {
          const wing = Math.min(toSegment(sx, sy, b.x - 1.6, b.y - 0.9, b.x, b.y), toSegment(sx, sy, b.x, b.y, b.x + 1.6, b.y - 0.9));
          c = mix(c, [45, 40, 60], cover(wing, 0.3, soft) * 0.85);
        }
      } else if (sy < shore) {
        // Sea: darker as it comes closer, with ripples and the sun's reflection.
        const t = (sy - horizon) / (shore - horizon);
        c = mix([60, 110, 160], [25, 85, 135], t);
        const ripple = Math.sin(sx * 0.7 + sy * 2.1) * Math.sin(sx * 0.23 - sy * 0.9);
        c = mix(c, [120, 170, 210], Math.max(0, ripple) * 0.35);
        const glow = Math.exp(-(((sx - sun.x) / (3 + t * 6)) ** 2));
        if (glow > 0.1) c = mix(c, [255, 190, 120], glow * (0.35 + 0.55 * Math.max(0, Math.sin(sx * 1.3 + sy * 3.7))));
        // Foam where the waves reach the sand.
        c = mix(c, [235, 240, 245], cover(shore - sy, 0.5, soft) * 0.75);
      } else {
        // Sand: wet and dark at the water, dry and light up the beach.
        const t = (sy - shore) / (64 - shore);
        c = mix([175, 145, 110], [235, 205, 160], smooth(t * 2.2));
        c = mix(c, [150, 120, 90], hash(x, y, 7) * 0.25);
      }
      // A sailboat far out on the horizon: a hull and a white sail.
      const hull = sx > 80 && sx < 85 && sy > horizon - 0.6 && sy < horizon + 0.4 ? 1 : 0;
      const sail = sy > horizon - 5.2 && sy < horizon - 0.6 && sx > 82 && sx < 82 + 2.6 * ((sy - (horizon - 5.2)) / 4.6) ? 1 : 0;
      if (hull) c = mix(c, [60, 45, 50], 0.9);
      if (sail) c = mix(c, [250, 240, 225], 0.9);
      // The palm tree is a dark shape against the sunset.
      let shade = 0;
      for (let i = 0; i < trunk.length - 1; i++) {
        const a = trunk[i];
        const b = trunk[i + 1];
        shade = Math.max(shade, cover(toSegment(sx, sy, a.x, a.y, b.x, b.y), a.r, soft));
      }
      for (const leaf of leaves)
        for (let i = 0; i < leaf.length - 1; i++) {
          const r = 1.25 - i * 0.12;
          shade = Math.max(shade, cover(toSegment(sx, sy, leaf[i].x, leaf[i].y, leaf[i + 1].x, leaf[i + 1].y), r, soft));
        }
      if (shade > 0) c = mix(c, sy < horizon + 2 ? [40, 35, 45] : [55, 40, 30], shade * 0.92);
      // Camera noise: every pixel is a little off, as in a real photo.
      const n = (k: number) => (hash(x, y, k) - 0.5) * 10;
      px.push([clamp(c[0] + n(1)), clamp(c[1] + n(2)), clamp(c[2] + n(3))]);
    }
  }
  return { w, h, px };
}

/** A 3×5 pixel font: each glyph is 5 rows of 3 pixels, "1" for ink. */
const FONT: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001001001',
  '8': '111101111101111',
  '9': '111101111001111',
  A: '010101111101101',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  H: '101101111101101',
  I: '111010010010111',
  K: '101101110101101',
  L: '100100100100111',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  Y: '101101010010010',
  '.': '000000000000010',
  ' ': '000000000000000',
};

/** Draw `text` in the 3×5 font with its top left corner at (x, y). Each character is 4 pixels wide with its space. */
function write(p: Picture, text: string, x: number, y: number, ink: RGB) {
  [...text].forEach((ch, i) => {
    const g = FONT[ch];
    if (!g) throw new Error(`No glyph for "${ch}"`);
    for (let r = 0; r < 5; r++) for (let col = 0; col < 3; col++) if (g[r * 3 + col] === '1') p.px[(y + r) * p.w + x + i * 4 + col] = ink;
  });
}

/** A line of text that fills a width: `left` at the left edge and `right` ending at the right edge. */
const spread = (left: string, right: string, chars: number) => left + ' '.repeat(Math.max(1, chars - left.length - right.length)) + right;

/**
 * A screenshot of a food order: small text on a plain background, where
 * every pixel of a digit matters. A screenshot has no camera noise, so the
 * background is long runs of one color.
 */
function receipt(): Picture {
  const w = 96;
  const h = 64;
  const p: Picture = { w, h, px: Array.from({ length: w * h }, () => WHITE) };
  for (let y = 0; y < 11; y++) for (let x = 0; x < w; x++) p.px[y * w + x] = GREEN;
  const ink: RGB = [20, 20, 20];
  write(p, 'TACO TRUCK', 28, 3, WHITE);
  const left = 10;
  const chars = 19;
  write(p, 'ORDER 4821', left, 15, ink);
  write(p, spread('2 TACOS', '9.50', chars), left, 24, ink);
  write(p, spread('1 SODA', '2.75', chars), left, 31, ink);
  write(p, spread('TIP', '1.80', chars), left, 38, ink);
  for (let x = left; x < left + chars * 4 - 1; x += 2) p.px[46 * w + x] = [150, 150, 150];
  write(p, spread('TOTAL', RECEIPT_TOTAL, chars), left, 50, ink);
  return p;
}

export const PICTURES: Record<PictureId, PictureInfo> = {
  smiley: { name: 'Smiley', about: 'Pixel art with three colors.', make: smiley },
  beach: { name: 'Beach photo', about: 'A vacation photo from a phone camera.', make: beach },
  receipt: { name: 'Receipt', about: 'A screenshot of a food order.', make: receipt },
};

/** The receipt's lines, for questions about what it says. */
export const RECEIPT_TOTAL = '14.05';

const made = new Map<PictureId, Picture>();

export function picture(id: PictureId): Picture {
  let p = made.get(id);
  if (!p) made.set(id, (p = PICTURES[id].make()));
  return p;
}
