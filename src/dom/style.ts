/**
 * Inline styles: what `el.style` reads and writes. A browser keeps a style only
 * if it can read the value, and throws the rest away with no error, so this file
 * does too. `readValue` says why a value was thrown away, and host.ts turns that
 * into a note, since a silent nothing is the hardest thing for a beginner to find.
 */
const PROPERTIES = `accent-color align-content align-items align-self all animation animation-delay animation-direction animation-duration animation-fill-mode animation-iteration-count animation-name animation-play-state animation-timing-function appearance aspect-ratio backdrop-filter backface-visibility background background-attachment background-blend-mode background-clip background-color background-image background-origin background-position background-repeat background-size block-size border border-block border-bottom border-bottom-color border-bottom-left-radius border-bottom-right-radius border-bottom-style border-bottom-width border-collapse border-color border-image border-inline border-left border-left-color border-left-style border-left-width border-radius border-right border-right-color border-right-style border-right-width border-spacing border-style border-top border-top-color border-top-left-radius border-top-right-radius border-top-style border-top-width border-width bottom box-shadow box-sizing break-inside caption-side caret-color clear clip-path color column-count column-gap column-rule column-span column-width columns content counter-increment counter-reset cursor direction display empty-cells fill filter flex flex-basis flex-direction flex-flow flex-grow flex-shrink flex-wrap float font font-family font-size font-stretch font-style font-variant font-weight gap grid grid-area grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-column-end grid-column-start grid-gap grid-row grid-row-end grid-row-start grid-template grid-template-areas grid-template-columns grid-template-rows height hyphens image-rendering inline-size inset isolation justify-content justify-items justify-self left letter-spacing line-height list-style list-style-image list-style-position list-style-type margin margin-block margin-bottom margin-inline margin-left margin-right margin-top mask max-height max-width min-height min-width mix-blend-mode object-fit object-position opacity order orphans outline outline-color outline-offset outline-style outline-width overflow overflow-wrap overflow-x overflow-y padding padding-block padding-bottom padding-inline padding-left padding-right padding-top perspective place-content place-items place-self pointer-events position quotes resize right rotate row-gap scale scroll-behavior stroke stroke-width tab-size table-layout text-align text-decoration text-decoration-color text-decoration-line text-decoration-style text-indent text-overflow text-shadow text-transform top transform transform-origin transition transition-delay transition-duration transition-property transition-timing-function translate unicode-bidi user-select vertical-align visibility white-space widows width will-change word-break word-spacing word-wrap writing-mode z-index`.split(' ');

export const CSS_PROPERTIES = new Set(PROPERTIES);

const COLOR_NAMES = new Set('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' '));
const COLOR_WORDS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'none', 'canvas', 'canvastext']);

const COLOR_PROPS = new Set(['color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', 'caret-color', 'accent-color', 'fill', 'stroke']);
const LENGTH_PROPS = new Set(['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'top', 'right', 'bottom', 'left', 'font-size', 'border-radius', 'border-width', 'gap', 'row-gap', 'column-gap', 'letter-spacing', 'word-spacing', 'text-indent']);

/** `backgroundColor` to `background-color`. A name with a dash stays as it is. */
export function cssName(name: string): string {
  if (name === 'cssFloat') return 'float';
  if (name.includes('-')) return name.toLowerCase();
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return kebab.startsWith('webkit-') ? `-${kebab}` : kebab;
}

/** `background-color` to `backgroundColor`. */
export const camelName = (name: string): string => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export const camelProperties = (): string[] => PROPERTIES.map(camelName);

export interface StyleEntry {
  value: string;
  important: boolean;
}

/** Splits on a mark, skipping anything in quotes or parentheses. */
function splitTop(s: string, on: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === on && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

/** Reads a `style` attribute. */
export function parseStyle(text: string): Map<string, StyleEntry> {
  const out = new Map<string, StyleEntry>();
  for (const part of splitTop(text.replace(/\/\*[\s\S]*?\*\//g, ''), ';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (!name || !value) continue;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/\s*!\s*important\s*$/i, '');
    const read = readValue(name, value);
    if (read.ok) out.set(name, { value: read.value, important });
  }
  return out;
}

export function serializeStyle(style: Map<string, StyleEntry>): string {
  return [...style].map(([k, v]) => `${k}: ${v.value}${v.important ? ' !important' : ''};`).join(' ');
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function rgbText(r: number, g: number, b: number, a: number): string {
  const parts = [r, g, b].map((n) => Math.round(clamp(n, 0, 255)));
  if (a >= 1) return `rgb(${parts.join(', ')})`;
  return `rgba(${parts.join(', ')}, ${Number(clamp(a, 0, 1).toFixed(3))})`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function hexColor(v: string): string | undefined {
  const h = v.slice(1);
  if (!/^[0-9a-f]+$/i.test(h)) return undefined;
  if (h.length === 3 || h.length === 4) {
    const [r, g, b, a] = [...h].map((c) => parseInt(c + c, 16));
    return rgbText(r, g, b, a === undefined ? 1 : a / 255);
  }
  if (h.length === 6 || h.length === 8) {
    const [r, g, b, a] = (h.match(/../g) as string[]).map((c) => parseInt(c, 16));
    return rgbText(r, g, b, a === undefined ? 1 : a / 255);
  }
  return undefined;
}

function numberPart(p: string, pct: number): number | undefined {
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(p)) return Number(p);
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(p)) return (Number(p.slice(0, -1)) * pct) / 100;
  return undefined;
}

function fnColor(v: string): string | undefined {
  const m = /^(rgba?|hsla?)\((.*)\)$/i.exec(v);
  if (!m) return undefined;
  const parts = m[2].trim().split(/\s*[,/]\s*|\s+/);
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  const alpha = parts[3] === undefined ? 1 : numberPart(parts[3], 1);
  if (alpha === undefined) return undefined;
  if (m[1].toLowerCase().startsWith('rgb')) {
    const nums = parts.slice(0, 3).map((p) => numberPart(p, 255));
    if (nums.some((n) => n === undefined)) return undefined;
    return rgbText(nums[0]!, nums[1]!, nums[2]!, alpha);
  }
  const hue = parts[0].replace(/deg$/i, '');
  const h = numberPart(hue, 1);
  const s = /%$/.test(parts[1]) ? numberPart(parts[1], 1) : undefined;
  const l = /%$/.test(parts[2]) ? numberPart(parts[2], 1) : undefined;
  if (h === undefined || s === undefined || l === undefined) return undefined;
  const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
  return rgbText(r, g, b, alpha);
}

/** A color as a browser hands it back, or undefined if it isn't one. */
export function readColor(text: string): string | undefined {
  const v = text.trim();
  const low = v.toLowerCase();
  if (COLOR_NAMES.has(low) || COLOR_WORDS.has(low)) return low;
  if (low.startsWith('#')) return hexColor(low);
  return fnColor(v);
}

export type ReadValue = { ok: true; value: string } | { ok: false; why: 'color' | 'unit' };

const BARE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** What a browser keeps of a value for this property. Most values pass through. Colors and lengths are the two a beginner gets silently wrong. */
export function readValue(prop: string, text: string): ReadValue {
  const value = text.trim();
  if (COLOR_PROPS.has(prop)) {
    const c = readColor(value);
    if (c === undefined && !/^(?:var|calc|color|lab|lch|oklab|oklch|hwb|color-mix)\(/i.test(value)) return { ok: false, why: 'color' };
    return { ok: true, value: c ?? value };
  }
  if (prop === 'background') {
    // One word or a color function is meant as a color. A longer value could be anything.
    if (/^[a-z]+$/i.test(value) || /^(?:rgba?|hsla?)\(/i.test(value)) {
      const c = readColor(value);
      if (c === undefined && !/^(?:fixed|local|scroll|repeat|space|round|top|bottom|left|right|center)$/i.test(value)) return { ok: false, why: 'color' };
      return { ok: true, value: c ?? value };
    }
    return { ok: true, value };
  }
  if (LENGTH_PROPS.has(prop) && value.split(/\s+/).some((p) => BARE_NUMBER.test(p) && Number(p) !== 0)) return { ok: false, why: 'unit' };
  return { ok: true, value };
}
