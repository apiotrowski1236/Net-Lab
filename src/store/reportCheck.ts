import { sha256Hex } from './sha256';

// Check codes: catch a downloaded report that was edited by hand.
//
// A report shows a check code made from its results: everything inside
// <main id="netlab-results">, which is the name, period, lab, dates, Work ID,
// scores, every goal, and every answer with its grade line. The code is a
// hash of that text, not of the file, so it can sit in the same file. The
// checker on the #/teacher page hashes the results text of the file it is
// given and compares. Change a score, a goal, a grade line, or an answer and
// the codes stop matching.
//
// There's no server, so there is no secret: anyone who reads NetLab's source
// can make a code that matches. This stops edits made by hand, not a student
// who writes code. The checker shows the score it read from the file's text,
// so styles or scripts added to change what the page looks like don't fool it.

/** Changing this makes every existing check code fail. */
export const CHECK_SALT = 'netlab-report-check:v1:';
export const RESULTS_ID = 'netlab-results';
export const CHECK_ID = 'netlab-check';

/** Spaces, line breaks, and control characters don't count, so a file re-saved by a browser still checks. */
const canonical = (text: string) => text.replace(/[\s\u0000-\u001f\u007f]+/g, '');

/** The check code for a report's results text: 16 hex digits in groups of 4. */
export function checkCode(resultsText: string): string {
  return sha256Hex(CHECK_SALT + canonical(resultsText))
    .slice(0, 16)
    .replace(/(.{4})(?!$)/g, '$1-');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };

/** The text a browser shows for report HTML: tags dropped, entities decoded. Only for HTML NetLab wrote, where student text is escaped. */
export function htmlText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e] ?? m;
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    });
}

const RESULTS_RE = new RegExp(`<main id="${RESULTS_ID}">([\\s\\S]*)</main>`);
const CODE_RE = new RegExp(`<b id="${CHECK_ID}">([^<]*)</b>`);

/** The results section of a report, as HTML. Student text is escaped, so it can't hold a </main>. */
export const resultsHtml = (html: string): string | undefined => RESULTS_RE.exec(html)?.[1];

/** The `<b>` that shows a report's check code. */
export const checkCodeHtml = (code: string) => `<b id="${CHECK_ID}">${code}</b>`;

export interface CheckResult {
  /**
   * `ok`: the results match the check code. `changed`: they don't, so the file was edited after it was downloaded.
   * `no-code`: a NetLab report with no check code (made before check codes, or the code was deleted).
   * `not-report`: not a NetLab report at all.
   */
  status: 'ok' | 'changed' | 'no-code' | 'not-report';
  /** As the file's results text shows them. Empty when the file doesn't have them. */
  student: string;
  lab: string;
  /** Auto-checked points, like "7 / 10". */
  score: string;
  /** The code printed in the file, and the code its results should have. */
  code?: string;
  expected?: string;
}

const textOf = (html: string, re: RegExp) => {
  const m = re.exec(html);
  return m ? htmlText(m[1]).replace(/\s+/g, ' ').trim() : '';
};

/** Check a report file's text against its check code. */
export function checkReport(html: string): CheckResult {
  const results = resultsHtml(html);
  if (results === undefined) {
    const isReport = /NetLab report/.test(html) && /auto-checked points/.test(html);
    return { status: isReport ? 'no-code' : 'not-report', student: '', lab: '', score: '' };
  }
  const found = {
    student: textOf(results, /<span class="who">([\s\S]*?)<\/span>/),
    lab: textOf(results, /<h1>([\s\S]*?)<\/h1>/),
    score: textOf(results, /<div class="stat score"><b>([\s\S]*?)<\/b>/),
  };
  const code = CODE_RE.exec(html)?.[1].trim();
  if (!code) return { status: 'no-code', ...found };
  const expected = checkCode(htmlText(results));
  return { status: code.toLowerCase() === expected ? 'ok' : 'changed', ...found, code, expected };
}
