/**
 * Answer patterns for the lesson's typed answers. Students write numbers with
 * or without commas ("1,536"), alone or at the end of their math
 * ("192 - 104 = 88"), and with a word after ("48 bytes").
 */

/** A whole number with optional thousands commas: 1536 or 1,536. */
const digits = (n: number) => {
  const plain = String(n);
  const commas = n.toLocaleString('en-US');
  return plain === commas ? plain : `(?:${plain}|${commas})`;
};

/** A whole number, alone or at the end of worked-out math, with an optional word after it ("48 bytes"). */
export const num = (n: number) => new RegExp(`^\\s*(?:[^=]*=\\s*)?${digits(n)}(?:\\s*[a-z][a-z ]*)?\\s*\\.?$`, 'i');

/** An amount of money such as 14.05, with or without a dollar sign. */
export const money = (amount: string) => new RegExp(`^\\s*\\$?\\s*${amount.replace('.', '[.,]')}\\s*(?:dollars)?\\s*\\.?$`, 'i');

const NUMBER_WORDS =
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand';

/** A number written in words ("forty-eight") with no digits: a format slip, not a math slip. */
export const SPELLED = {
  match: new RegExp(`^[^\\d]*\\b(?:${NUMBER_WORDS})\\b[^\\d]*$`, 'i'),
  text: 'Write the number with digits, like 48 instead of forty-eight.',
  format: true,
};
