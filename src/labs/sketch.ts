import type { JsCheck, JsCheckCtx, JsFile } from '../demos/types';

/** What the p5.js labs (p5-draw, p5-move, p5-game) share in their checks. */

/** A starter of one file, `sketch.js`, the name the p5.js web editor uses. */
export const sketch = (text: string): JsFile[] => [{ name: 'sketch.js', text }];

export const BROKE = 'Your code stopped with an error. Read the error under the output, fix it, and press Run.';
/** p5.js draws an unknown color name as white, so a check would judge a picture the student never meant. */
export const UNKNOWN_COLOR = 'p5.js does not know one of the color names in your code, so it used white. Read the note under the output that names it, and fix the spelling.';

export const hasNote = (c: JsCheckCtx, rule: string) => c.notes.some((n) => n.rule === rule);

/** A hidden run stopped with an error the student's own Run never reached, such as one inside an if that only a mouse or a key makes true. */
export function playedError(r: { error?: { msg: string; pos: { line: number }; help?: string } }): string {
  if (!r.error) return BROKE;
  return `Your sketch runs, but when the check played it, line ${r.error.pos.line} stopped with an error: ${r.error.msg}.${r.error.help ? ` ${r.error.help}` : ''}`;
}

export function check(id: string, label: string, test: (c: JsCheckCtx) => string | undefined, hints: string[], next?: true): JsCheck {
  return { id, label, test, hints, ...(next ? { next } : {}) };
}
