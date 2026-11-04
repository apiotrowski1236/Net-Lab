/**
 * Answer patterns for the lesson's typed answers. Students type numbers and
 * bits in many ways ("45", "32 + 8 + 4 + 1 = 45", "0000 1101"), so the checks
 * accept those, and the `wrong` patterns catch the plan's common mistakes.
 */

/** A whole number, alone or at the end of worked-out math ("8 + 2 = 10"), with an optional word after it ("64 values"). */
export const num = (n: number) => new RegExp(`^\\s*(?:[^=]*=\\s*)?${n}(?:\\s*[a-z][a-z ]*)?\\s*\\.?$`, 'i');

/** Exactly these bits, spaces allowed between them ("0000 1101"). */
export const bitsRe = (bits: string) => new RegExp(`^\\s*${[...bits].join('\\s*')}\\s*$`);

/** A range like "0 to 63", "0-63", or "0 through 63", with an optional word after it ("0 to 63 values"). */
export const rangeRe = (lo: number, hi: number) =>
  new RegExp(`^\\s*(?:from\\s+)?${lo}\\s*(?:to|-|\\u2013|\\u2014|through|thru|until|\\.{2,3})\\s*${hi}(?:\\s*[a-z][a-z ]*)?\\s*\\.?$`, 'i');

/** Bits in the reverse order. */
export const reversed = (bits: string) => [...bits].reverse().join('');

/** Fewer than `n` binary digits. */
export const shortBits = (n: number) => new RegExp(`^\\s*(?:[01]\\s*){1,${n - 1}}$`);
/** More than `n` binary digits. */
export const longBits = (n: number) => new RegExp(`^\\s*(?:[01]\\s*){${n + 1},}$`);
/** Any digit that isn't 0 or 1. */
export const notBinary = /[2-9]/;
