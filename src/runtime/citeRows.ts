/**
 * "Cite the rows" answers (device-analysis): a student lists the log rows
 * that show something, the way the exam's free-response question asks
 * ("rows 11-24", "11 to 24", "3, 5, 9"). parseRows reads the list and
 * checkRows compares it with the rows that really show it.
 *
 * capture-analysis (frame numbers) and watch-the-air (access point log rows)
 * check citations the same way; the three could share this module.
 */

/** The biggest list worth reading: a typo like "1-9999" shouldn't build a huge array. */
const MAX_ROWS = 500;

/**
 * Row numbers in an answer, sorted, without repeats. Reads ranges written
 * with a hyphen, an en dash, "to", or "through", and lists with commas, "and",
 * or spaces. Words like "rows" and "lines" are skipped. Returns a message
 * instead when there are no numbers or a range runs backward.
 */
export function parseRows(text: string): number[] | { msg: string } {
  const s = text
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\b(through|thru|to|until)\b/g, '-')
    .replace(/\s*-\s*/g, '-');
  const out = new Set<number>();
  for (const m of s.matchAll(/(\d+)(?:-(\d+))?/g)) {
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a) return { msg: `“${m[0]}” runs backward. Write the smaller row first, like ${b}-${a}.` };
    if (b - a > MAX_ROWS) return { msg: `“${m[0]}” covers more rows than the file has.` };
    for (let n = a; n <= b; n++) out.add(n);
  }
  if (!out.size) return { msg: 'Write the row numbers, like 4-9 or 4, 5, 6.' };
  return [...out].sort((x, y) => x - y);
}

/** Write rows back as short ranges: [3, 4, 5, 9] → "3-5, 9". */
export function rowsText(rows: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    parts.push(j > i ? `${rows[i]}-${rows[j]}` : String(rows[i]));
    i = j;
  }
  return parts.join(', ');
}

/**
 * Check a citation. `want` is every row that shows the thing asked about;
 * `what` names it ("spray"); `describe(n)` says what another row is, for
 * feedback ("Bayline Farms signing in with its key"). Returns what to tell
 * the student, or undefined when the rows are exactly right.
 */
export function checkRows(value: string, want: readonly number[], what: string, describe: (row: number) => string | undefined): string | undefined {
  const got = parseRows(value);
  if (!Array.isArray(got)) return got.msg;
  const extra = got.filter((n) => !want.includes(n));
  if (extra.length) {
    const d = describe(extra[0]);
    return d ? `Row ${extra[0]} isn't part of the ${what}: ${d}.` : `Row ${extra[0]} isn't in the file yet. Check the row numbers on the left.`;
  }
  const missing = want.filter((n) => !got.includes(n));
  if (missing.length) {
    const inside = missing.some((n) => n > Math.min(...got) && n < Math.max(...got));
    const where = inside ? 'One is between rows you cited, so check for a row you skipped.' : 'Look above and below the rows you found for more.';
    return `You cited ${got.length} of the ${want.length} ${what} rows. ${where}`;
  }
  return undefined;
}
