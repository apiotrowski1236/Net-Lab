/**
 * Answer patterns for the lesson's typed answers. Students type numbers and
 * bits in many ways ("45", "32 + 8 + 4 + 1 = 45", "0000 1101"), so the checks
 * accept those, and the `wrong` patterns catch the plan's common mistakes.
 */

/** A whole number, alone or at the end of worked-out math ("8 + 2 = 10"), with an optional word after it ("64 values"). */
export const num = (n: number) => new RegExp(`^\\s*(?:[^=]*=\\s*)?${n}(?:\\s*[a-z][a-z ]*)?\\s*\\.?$`, 'i');

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/**
 * A count of patterns: the number, or the same number as a power of 2 ("2^8",
 * "2**8", "2⁸", "2^8 = 256"), since the lesson writes counts that way too.
 */
export const count = (n: number) => {
  const k = Math.log2(n);
  if (!Number.isInteger(k)) return num(n);
  const sup = [...String(k)].map((d) => SUPERSCRIPT[Number(d)]).join('');
  const pow = `2\\s*(?:\\^|\\*\\*)\\s*${k}|2${sup}`;
  return new RegExp(`^\\s*(?:(?:${pow})(?:\\s*=\\s*${n})?|(?:[^=]*=\\s*)?${n})(?:\\s*[a-z][a-z ]*)?\\s*\\.?$`, 'i');
};

/** Exactly these bits, spaces allowed between them ("0000 1101"). */
export const bitsRe = (bits: string) => new RegExp(`^\\s*${[...bits].join('\\s*')}\\s*$`);

/** A range like "0 to 63", "0-63", or "0 through 63", with an optional word after it ("0 to 63 values"). */
export const rangeRe = (lo: number, hi: number) =>
  new RegExp(`^\\s*(?:from\\s+)?${lo}\\s*(?:to|-|\\u2013|\\u2014|through|thru|until|\\.{2,3})\\s*${hi}(?:\\s*[a-z][a-z ]*)?\\s*\\.?$`, 'i');

/** Bits in the reverse order. */
export const reversed = (bits: string) => [...bits].reverse().join('');

/** Fewer than `n` binary digits. */
export const shortBits = (n: number) => new RegExp(`^\\s*(?:[01]\\s*){1,${n - 1}}$`);
/** Exactly `n` binary digits. */
export const exactBits = (n: number) => new RegExp(`^\\s*(?:[01]\\s*){${n}}$`);
/** More than `n` binary digits. */
export const longBits = (n: number) => new RegExp(`^\\s*(?:[01]\\s*){${n + 1},}$`);
const NUMBER_WORDS =
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand';
/** A number written in words ("sixteen") with no digits: a format slip, not a math slip. */
export const SPELLED = {
  match: new RegExp(`^[^\\d]*\\b(?:${NUMBER_WORDS})\\b[^\\d]*$`, 'i'),
  text: 'Write the number with digits, like 7 instead of seven.',
};
/** Any digit that isn't 0 or 1. */
export const notBinary = /[2-9]/;
