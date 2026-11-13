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

export type PictureId = 'smiley' | 'lake' | 'receipt';

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
 * A vacation photo: a mountain lake near sunset, with snowy peaks, a line of
 * pine trees, a cabin on the far shore, a sailboat, and two birds. It is drawn
 * in a 96×64 "scene" scaled up to LAKE_W × LAKE_H pixels, with smooth
 * gradients and soft edges, plus a little camera noise in every pixel, the way
 * a real photo has, so almost no two pixels side by side match. It has enough
 * pixels that a 2×2 square is a tiny part of the scene.
 */
export const LAKE_W = 240;
export const LAKE_H = 160;

function lake(): Picture {
  const w = LAKE_W;
  const h = LAKE_H;
  const S = w / 96;
  const soft = 1.2 / S;
  // Where the far shore meets the water.
  const water = 38;
  const sun = { x: 72, y: 13, r: 5 };
  // The far mountains: each peak is a triangle, and the ridge is the tallest one at each spot.
  const peaks = [
    { x: 2, h: 12, w: 14 },
    { x: 20, h: 23, w: 22 },
    { x: 43, h: 15, w: 17 },
    { x: 62, h: 8, w: 14 },
    { x: 91, h: 14, w: 18 },
  ];
  const mountain = (sx: number) => {
    let top = 0;
    let lit = false;
    for (const p of peaks) {
      const t = p.h * (1 - Math.abs(sx - p.x) / p.w);
      if (t > top) {
        top = t;
        // The sun is on the right, so a peak's right side is in the light.
        lit = sx > p.x;
      }
    }
    return { top: top + 0.5 * Math.sin(sx * 0.9) + 0.3 * Math.sin(sx * 2.3 + 1), lit };
  };
  // The near hills are lower and covered in pine trees, which give them a jagged top.
  const tooth = (v: number) => Math.abs((((v % 1) + 1) % 1) - 0.5) * 2;
  const hill = (sx: number) => 2.2 + 2 * Math.sin(sx * 0.08 + 2) ** 2 + 1.5 * Math.sin(sx * 0.21) ** 2 + 1.5 * tooth(sx * 0.8);
  // Two birds, each a small V.
  const birds = [
    { x: 52, y: 8 },
    { x: 57.5, y: 6 },
  ];
  const boat = { x: 30, y: 46 };
  const cabin = { x: 78, y: water };
  const px: RGB[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Where this pixel sits in the scene.
      const sx = (x + 0.5) / S;
      const sy = (y + 0.5) / S;
      let c: RGB;
      const shore = 54 + 1.5 * Math.sin(sx * 0.11 + 1) + 0.5 * Math.sin(sx * 0.45);
      const trees = hill(sx);
      if (sy < water) {
        // Sky: blue at the top to warm orange low down, with soft clouds and the sun.
        const t = sy / water;
        c = mix([60, 110, 190], [250, 190, 130], smooth(t * 1.15));
        const cloud = Math.exp(-(((sx - 40) / 13) ** 2) - ((sy - 6) / 2.6) ** 2) + 0.7 * Math.exp(-(((sx - 84) / 9) ** 2) - ((sy - 5) / 2) ** 2);
        c = mix(c, [255, 225, 215], Math.min(0.75, cloud * 0.8));
        const d = Math.hypot(sx - sun.x, sy - sun.y);
        c = mix(c, [255, 220, 150], 0.6 * Math.exp(-(((d - sun.r) / 9) ** 2)) * (d > sun.r ? 1 : 0));
        c = mix(c, mix([255, 245, 200], [255, 215, 135], Math.min(1, d / sun.r)), cover(d, sun.r, soft));
        for (const b of birds) {
          const wing = Math.min(toSegment(sx, sy, b.x - 1.6, b.y - 0.9, b.x, b.y), toSegment(sx, sy, b.x, b.y, b.x + 1.6, b.y - 0.9));
          c = mix(c, [45, 40, 60], cover(wing, 0.3, soft) * 0.85);
        }
        // Mountains: rock that fades into haze lower down, with snow on the tall peaks.
        const m = mountain(sx);
        const ridge = water - 2 - m.top;
        const depth = sy - ridge;
        let rock = mix(m.lit ? [150, 135, 160] : [95, 95, 135], [190, 160, 165], Math.min(1, Math.max(0, depth) / 26));
        const snow = (m.top - 9) * 0.5 + 0.9 * Math.sin(sx * 1.9) + 0.5 * Math.sin(sx * 4.3);
        if (m.top > 9) rock = mix(rock, m.lit ? [255, 246, 235] : [205, 212, 235], cover(depth, snow, soft));
        c = mix(c, rock, cover(-depth, 0, soft));
        // Pine trees on the near hills, a little lighter where the hash says so.
        const pine = mix([30, 62, 50], [52, 88, 62], hash(Math.floor(sx * 1.6), Math.floor(sy * 1.6), 5));
        c = mix(c, pine, cover(water - trees - sy, 0, soft));
      } else if (sy < shore) {
        // Lake: darker as it comes closer, with the trees' reflection, ripples, and the sun's reflection.
        const t = (sy - water) / (shore - water);
        c = mix([110, 150, 185], [30, 80, 125], smooth(t));
        c = mix(c, [35, 68, 60], 0.6 * cover(sy - water, trees * 1.3, 1.5));
        const ripple = Math.sin(sx * 0.7 + sy * 2.1) * Math.sin(sx * 0.23 - sy * 0.9);
        c = mix(c, [150, 190, 220], Math.max(0, ripple) * 0.3);
        const glow = Math.exp(-(((sx - sun.x) / (3 + t * 6)) ** 2));
        if (glow > 0.1) c = mix(c, [255, 205, 130], glow * (0.35 + 0.55 * Math.max(0, Math.sin(sx * 1.3 + sy * 3.7))));
        // A pale line where the water meets the grass.
        c = mix(c, [225, 235, 235], cover(shore - sy, 0.4, soft) * 0.6);
      } else {
        // Grass on the near shore, with small wildflowers.
        const t = (sy - shore) / (64 - shore);
        c = mix([58, 100, 55], [110, 155, 72], smooth(t * 1.6));
        c = mix(c, [38, 78, 42], hash(x, y, 7) * 0.3);
        const cx = Math.floor(sx / 3);
        const cy = Math.floor(sy / 3);
        if (sy > shore + 1.5 && hash(cx, cy, 11) < 0.4) {
          const fx = (cx + 0.25 + 0.5 * hash(cx, cy, 12)) * 3;
          const fy = (cy + 0.25 + 0.5 * hash(cx, cy, 13)) * 3;
          const pick = hash(cx, cy, 14);
          const petal: RGB = pick < 0.4 ? [250, 215, 70] : pick < 0.75 ? [245, 245, 240] : [235, 130, 170];
          c = mix(c, petal, cover(Math.hypot(sx - fx, sy - fy), 0.55, soft));
        }
      }
      // A red cabin on the far shore: walls, a dark roof, and a lit window.
      const wall = sx > cabin.x - 2.2 && sx < cabin.x + 2.2 && sy > cabin.y - 2.6 && sy < cabin.y;
      const roof = sy > cabin.y - 4.4 && sy <= cabin.y - 2.6 && Math.abs(sx - cabin.x) < 2.8 * ((sy - (cabin.y - 4.4)) / 1.8);
      const pane = sx > cabin.x - 0.6 && sx < cabin.x + 0.6 && sy > cabin.y - 1.9 && sy < cabin.y - 0.8;
      if (wall) c = [175, 60, 50];
      if (roof) c = [60, 45, 50];
      if (pane) c = [255, 225, 130];
      // A sailboat on the lake: a hull, a mast, and a white sail.
      const hull = sx > boat.x - 2.8 && sx < boat.x + 2.8 - (sy - boat.y) * 0.6 && sx > boat.x - 2.8 + (sy - boat.y) * 0.6 && sy > boat.y && sy < boat.y + 1.3;
      const sail = sy > boat.y - 5.6 && sy < boat.y - 0.4 && sx > boat.x && sx < boat.x + 3 * ((sy - (boat.y - 5.6)) / 5.2);
      const mast = Math.abs(sx - boat.x + 0.2) < 0.22 && sy > boat.y - 6 && sy <= boat.y;
      if (hull) c = [70, 45, 45];
      if (mast) c = [60, 45, 50];
      if (sail) c = [250, 244, 232];
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
  lake: { name: 'Lake photo', about: 'A vacation photo from a phone camera.', make: lake },
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
