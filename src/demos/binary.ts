/** Small binary helpers shared by the demos and the binary-numbers lesson. */

/** Place values for `places` bits, left to right: 128, 64, ..., 1 for 8. */
export function placeValues(places: number): number[] {
  return Array.from({ length: places }, (_, i) => 2 ** (places - 1 - i));
}

/** The value of a string of 0s and 1s. */
export function fromBits(bits: string): number {
  let n = 0;
  for (const c of bits) n = n * 2 + (c === '1' ? 1 : 0);
  return n;
}

/** `n` in binary, padded with 0s in front to `places` bits (more if it needs them). */
export function toBits(n: number, places = 8): string {
  return n.toString(2).padStart(places, '0');
}

/** The value written in a base with digits, e.g. digits(995, 10, 3) = [9, 9, 5]. */
export function digitsOf(n: number, base: number, digits: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < digits; i++) {
    out.unshift(n % base);
    n = Math.floor(n / base);
  }
  return out;
}

/** Index of the first place two equal-length bit strings differ, or -1. */
export function firstDifference(a: string, b: string): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Pad both to the longer length with 0s in front. */
export function lineUp(a: string, b: string): [string, string] {
  const n = Math.max(a.length, b.length);
  return [a.padStart(n, '0'), b.padStart(n, '0')];
}

/** The hex digit for 0 to 15. */
export const hexDigit = (n: number): string => n.toString(16).toUpperCase();
