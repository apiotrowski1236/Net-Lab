import { closestName } from '../js/help';

/** Red, green, blue, and alpha, each 0 to 255, as p5.js counts them by default. */
export type Rgba = [number, number, number, number];

/** The CSS color names p5.js accepts, with their values. */
const TABLE =
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32';

const NAMED = new Map<string, string>(TABLE.split(' ').map((pair) => pair.split(':') as [string, string]));
export const COLOR_NAMES = [...NAMED.keys()];

const clamp = (n: number) => Math.min(255, Math.max(0, n));

function hex(h: string): Rgba | undefined {
  if (!/^[0-9a-f]+$/i.test(h)) return undefined;
  const pair = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const one = (i: number) => parseInt(h[i] + h[i], 16);
  if (h.length === 3) return [one(0), one(1), one(2), 255];
  if (h.length === 4) return [one(0), one(1), one(2), one(3)];
  if (h.length === 6) return [pair(0), pair(2), pair(4), 255];
  if (h.length === 8) return [pair(0), pair(2), pair(4), pair(6)];
  return undefined;
}

/** `rgb(255, 0, 0)`, `rgba(255, 0, 0, 0.5)`, and the percent forms p5.js reads. */
function functional(s: string): Rgba | undefined {
  const m = /^rgba?\(\s*([^)]*)\)$/i.exec(s);
  if (!m) return undefined;
  const parts = m[1].split(/\s*,\s*/);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p));
  const rgb = parts.slice(0, 3).map(channel);
  const a = parts[3] === undefined ? 255 : parts[3].endsWith('%') ? (parseFloat(parts[3]) * 255) / 100 : parseFloat(parts[3]) * 255;
  if ([...rgb, a].some((n) => !Number.isFinite(n))) return undefined;
  return [clamp(rgb[0]), clamp(rgb[1]), clamp(rgb[2]), clamp(a)];
}

/** A CSS color string, the way p5.js reads one, or undefined if p5.js wouldn't know it. */
export function parseColor(text: string): Rgba | undefined {
  const s = text.trim().toLowerCase();
  const named = NAMED.get(s);
  if (named) return hex(named);
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s.startsWith('#')) return hex(s.slice(1));
  return functional(s);
}

/** The color name closest to a misspelled one, such as "blue" for "bleu". */
export const closestColor = (text: string) => closestName(text.trim().toLowerCase(), COLOR_NAMES);

/** The color as a canvas style. */
export const css = (c: Rgba) => (c[3] >= 255 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${+(c[3] / 255).toFixed(3)})`);

/** The color in words a student would use for it: a CSS name if it is exactly one, or its numbers. */
export function colorWords(c: Rgba): string {
  for (const [name, h] of NAMED) {
    const v = hex(h)!;
    if (v[0] === c[0] && v[1] === c[1] && v[2] === c[2] && c[3] === 255) return name;
  }
  const rgb = `${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}`;
  return c[3] >= 255 ? `(${rgb})` : `(${rgb}, alpha ${Math.round(c[3])})`;
}

/** Two colors a person would call different. */
export const differ = (a: Rgba | null, b: Rgba | null) => (a === null || b === null ? a !== b : Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]) > 24);

export { clamp as clampChannel };
