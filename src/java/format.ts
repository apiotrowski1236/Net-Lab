/** Java's number formatting. JavaScript's differs in small ways that students would notice: 5.0 prints as 5 there. */

/** The shortest digits that identify `abs`, and the power of ten of the first one. */
function shortest(abs: number): { digits: string; exp: number } {
  const [m, e] = abs.toExponential().split('e');
  return { digits: m.replace('.', ''), exp: Number(e) };
}

/** Double.toString. */
export function doubleStr(d: number): string {
  if (Number.isNaN(d)) return 'NaN';
  if (!Number.isFinite(d)) return d > 0 ? 'Infinity' : '-Infinity';
  if (d === 0) return Object.is(d, -0) ? '-0.0' : '0.0';
  const abs = Math.abs(d);
  const sign = d < 0 ? '-' : '';
  // Java always prints two digits, and for the smallest double JavaScript's one digit rounds to 5.
  if (abs === 5e-324) return `${sign}4.9E-324`;
  const { digits, exp } = shortest(abs);
  if (abs >= 1e-3 && abs < 1e7) {
    if (exp >= 0) return `${sign}${digits.slice(0, exp + 1).padEnd(exp + 1, '0')}.${digits.slice(exp + 1) || '0'}`;
    return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  }
  return `${sign}${digits[0]}.${digits.slice(1) || '0'}E${exp}`;
}

/** A long, which is held as a JavaScript number. */
export const longStr = (v: number) => (Math.abs(v) < 1e21 ? String(v) : BigInt(v).toString());

/** `abs` to `prec` decimal places, rounding half up on the shortest digits, as java.util.Formatter does. */
export function fixed(abs: number, prec: number): string {
  if (abs === 0) return prec ? `0.${'0'.repeat(prec)}` : '0';
  const s = shortest(abs);
  let digits = s.digits.split('').map(Number);
  let exp = s.exp;
  const keep = exp + 1 + prec;
  if (keep < 0) digits = [];
  else if (keep < digits.length) {
    const up = digits[keep] >= 5;
    digits = digits.slice(0, keep);
    if (up) {
      let i = keep - 1;
      for (; i >= 0; i--) {
        if (digits[i] === 9) digits[i] = 0;
        else {
          digits[i]++;
          break;
        }
      }
      if (i < 0) {
        digits.unshift(1);
        exp++;
      }
    }
  }
  const text = digits.join('');
  const whole = exp >= 0 ? text.slice(0, exp + 1).padEnd(exp + 1, '0') : '0';
  let frac = exp >= 0 ? text.slice(exp + 1) : '0'.repeat(-exp - 1) + text;
  frac = frac.padEnd(prec, '0').slice(0, prec);
  return prec ? `${whole}.${frac}` : whole;
}

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface FormatRt {
  text(v: unknown): string;
  fail(cls: string, msg: string): never;
}

/** The value inside a boxed number or boolean; `box` is its wrapper class. */
export type Boxed = { box: string; v: number | boolean } | null;

/** String.format and printf, for the conversions a student meets: %d %f %s %c %b %n %%. */
export function formatJava(fmt: string, args: unknown[], rt: FormatRt, unbox: (a: unknown) => Boxed): string {
  let next = 0;
  return fmt.replace(/%(-|0|,|\+|\s)*(\d+)?(?:\.(\d+))?([a-zA-Z%])/g, (spec, _f, width, prec, conv: string) => {
    const flags = spec.slice(1, spec.length - conv.length - (width?.length ?? 0) - (prec !== undefined ? prec.length + 1 : 0));
    const pad = (s: string) => {
      const w = Number(width ?? 0);
      if (s.length >= w) return s;
      if (flags.includes('-')) return s.padEnd(w);
      if (flags.includes('0')) {
        const neg = /^[+-]/.test(s) ? s[0] : '';
        return neg + s.slice(neg.length).padStart(w - neg.length, '0');
      }
      return s.padStart(w);
    };
    if (conv === 'n') return '\n';
    if (conv === '%') return pad('%');
    if (next >= args.length) rt.fail('MissingFormatArgumentException', `Format specifier '${spec}'`);
    const arg = args[next++];
    const boxed = unbox(arg);
    const bad = (): never => rt.fail('IllegalFormatConversionException', `${conv} != java.lang.${boxed?.box ?? 'String'}`);
    const signed = (neg: boolean, s: string) => (neg ? `-${s}` : flags.includes('+') ? `+${s}` : s);
    switch (conv) {
      case 'd': {
        if (arg === null) return pad('null');
        if (!boxed || (boxed.box !== 'Integer' && boxed.box !== 'Long')) bad();
        const v = boxed!.v as number;
        const s = String(Math.abs(v));
        return pad(signed(v < 0, flags.includes(',') ? group(s) : s));
      }
      case 'f': {
        if (arg === null) return pad('null');
        if (!boxed || boxed.box !== 'Double') bad();
        const v = boxed!.v as number;
        const s = fixed(Math.abs(v), prec === undefined ? 6 : Number(prec));
        const [w, f] = s.split('.');
        return pad(signed(v < 0, (flags.includes(',') ? group(w) : w) + (f !== undefined ? `.${f}` : '')));
      }
      case 'e': {
        if (!boxed || boxed.box !== 'Double') bad();
        const [m, e] = (boxed!.v as number).toExponential(prec === undefined ? 6 : Number(prec)).split('e');
        const n = Number(e);
        return pad(`${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`);
      }
      case 's':
      case 'S': {
        let s = rt.text(arg);
        if (prec !== undefined) s = s.slice(0, Number(prec));
        return pad(conv === 'S' ? s.toUpperCase() : s);
      }
      case 'c':
        if (arg === null) return pad('null');
        if (!boxed || (boxed.box !== 'Character' && boxed.box !== 'Integer')) bad();
        return pad(String.fromCharCode(boxed!.v as number));
      case 'b':
        return pad(arg === null ? 'false' : boxed?.box === 'Boolean' ? String(boxed.v) : 'true');
      case 'x':
        if (!boxed || boxed.box !== 'Integer') bad();
        return pad(((boxed!.v as number) >>> 0).toString(16));
      default:
        return rt.fail('UnknownFormatConversionException', `Conversion = '${conv}'`);
    }
  });
}
