import type { LintNote, Program } from '../js';
import { walk, type Expr, type Fn, type Node } from '../js/ast';
import { closestName } from '../js/help';
import { CALLBACKS, P5_NAMES, P5_VARIABLES } from './host';

/**
 * Mistakes p5.js lets pass, found by reading the code. Rule ids, for `lintOff`,
 * are in SKETCH_RULES, along with the ones the sketch finds as it runs.
 */
export const SKETCH_RULES = ['no-sketch', 'event-name', 'p5-name', 'reset-in-draw', 'callback-as-test', 'key-word', 'shape-args', 'color-args', 'color-unknown', 'unused-style', 'background-covers', 'off-canvas', 'no-canvas', 'canvas-in-draw', 'canvas-size', 'key-code'] as const;

const WHAT: Record<string, string> = {
  width: 'the canvas width',
  height: 'the canvas height',
  mouseX: "the mouse's x",
  mouseY: "the mouse's y",
  key: 'the last key pressed',
  keyCode: "the last key's code",
  frameCount: 'how many frames have been drawn',
};

/** Top-level functions, by name. */
function topFunctions(programs: Program[]): Map<string, { fn: Fn; file: string; line: number }> {
  const out = new Map<string, { fn: Fn; file: string; line: number }>();
  for (const p of programs) {
    for (const s of p.body) {
      if (s.k === 'fndecl' && s.fn.name) out.set(s.fn.name, { fn: s.fn, file: p.file, line: s.pos.line });
      if (s.k === 'var') for (const d of s.decls) if (d.init?.k === 'fn') out.set(d.name, { fn: d.init, file: p.file, line: d.pos.line });
    }
  }
  return out;
}

/** Walks a function's own body, leaving out functions inside it. */
function own(fn: Fn, visit: (n: Node) => void): void {
  walk(fn.body, (n) => {
    if (n.k === 'fn') return false;
    visit(n);
  });
}

const isId = (e: Expr | undefined, name: string) => e?.k === 'id' && e.name === name;

/** Reads `name`: in `x = x + 1`, the right side reads x. */
function reads(e: Expr, name: string): boolean {
  let found = false;
  walk(e, (n) => {
    if (n.k === 'fn') return false;
    if (n.k === 'id' && n.name === name) found = true;
  });
  return found;
}

const KEY_MEANT: Record<string, string> = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', left_arrow: 'ArrowLeft', right_arrow: 'ArrowRight', up_arrow: 'ArrowUp', down_arrow: 'ArrowDown', space: ' ', spacebar: ' ', enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape' };

export function staticNotes(programs: Program[]): LintNote[] {
  const out: LintNote[] = [];
  const note = (rule: string, file: string, line: number, text: string) => {
    if (!out.some((n) => n.rule === rule && n.file === file && n.line === line)) out.push({ rule, file, line, text });
  };
  const fns = topFunctions(programs);
  const first = programs.find((p) => p.body.length);

  if (first && !fns.has('setup') && !fns.has('draw')) {
    note('no-sketch', first.file, first.body[0].pos.line, 'This code has no setup() or draw() function, so p5.js never starts, and the canvas stays empty. Put your drawing code inside function setup() { }.');
  }

  for (const [name, f] of fns) {
    if ((CALLBACKS as readonly string[]).includes(name)) continue;
    const meant = closestName(name, CALLBACKS);
    if (meant && !fns.has(meant)) note('event-name', f.file, f.line, `p5.js runs a function only if it has the exact name it looks for, so it never runs ${name}(). Did you mean ${meant}()?${meant.toLowerCase() === name.toLowerCase() ? ' Capital and lowercase letters count.' : ''}`);
  }

  for (const p of programs) {
    const names = [...p.lets.map((l) => l.name), ...p.vars, ...p.funcs.map((f) => f.name!)];
    for (const name of new Set(names)) {
      if (!P5_NAMES.has(name)) continue;
      const line = p.body.find((s) => (s.k === 'var' && s.decls.some((d) => d.name === name)) || (s.k === 'fndecl' && s.fn.name === name))?.pos.line ?? 1;
      const isVar = (P5_VARIABLES as readonly string[]).includes(name);
      const what = isVar ? `a variable p5.js keeps up to date${WHAT[name] ? `: ${WHAT[name]}` : ''}` : 'the name of a p5.js function';
      note('p5-name', p.file, line, `${name} is already ${what}. Your ${name} on this line hides p5.js's, so ${isVar ? `your code reads yours instead, and p5.js can't change it` : `calling ${name}() runs yours or stops with an error`}. Give yours a different name, such as my${name[0].toUpperCase()}${name.slice(1)}.`);
    }
  }

  const draw = fns.get('draw');
  if (draw) {
    const made = new Map<string, { line: number; init: string }>();
    const prog = programs.find((p) => p.file === draw.file)!;
    own(draw.fn, (n) => {
      if (n.k === 'var') for (const d of n.decls) if (d.init && !made.has(d.name)) made.set(d.name, { line: d.pos.line, init: prog.source.slice(d.init.off, d.init.end) });
    });
    const changed = new Set<string>();
    own(draw.fn, (n) => {
      if (n.k === 'update' && n.target.k === 'id') changed.add(n.target.name);
      if (n.k === 'assign' && n.target.k === 'id' && (n.op !== '=' || reads(n.value, n.target.name))) changed.add(n.target.name);
    });
    for (const [name, d] of made) {
      if (!changed.has(name)) continue;
      note('reset-in-draw', draw.file, d.line, `${name} is declared inside draw(), so it starts over at ${d.init} each time draw() runs, about 60 times a second, and it never builds up. Move let ${name} = ${d.init}; to the top of your code, above setup(), and keep the line that changes it inside draw().`);
    }
  }

  for (const p of programs) {
    for (const s of p.body) {
      walk(s, (n) => {
        if (n.k === 'if' || n.k === 'while' || n.k === 'cond') {
          walk(n.test, (t, parent) => {
            if (t.k === 'fn') return false;
            if (t.k !== 'id' || (parent?.k === 'call' && parent.callee === t)) return;
            const live = t.name === 'keyPressed' ? 'keyIsPressed' : ['mousePressed', 'mouseClicked', 'mouseReleased'].includes(t.name) ? 'mouseIsPressed' : undefined;
            if (live && fns.has(t.name)) note('callback-as-test', p.file, t.pos.line, `${t.name} is the name of your function, so this test is always true. To check whether ${live === 'keyIsPressed' ? 'a key' : 'the mouse button'} is down right now, use ${live}.`);
          });
        }
        if (n.k === 'binary' && ['===', '==', '!==', '!='].includes(n.op)) {
          const [id, str] = isId(n.l, 'key') ? [n.l, n.r] : isId(n.r, 'key') ? [n.r, n.l] : [];
          if (id && str?.k === 'str') {
            const meant = KEY_MEANT[str.v.toLowerCase()];
            if (meant && meant !== str.v) note('key-word', p.file, n.pos.line, `When that key is pressed, key is "${meant}", not "${str.v}". Compare with "${meant}"${meant.startsWith('Arrow') ? `, or use keyIsDown(${meant.slice(5).toUpperCase()}_ARROW)` : ''}.`);
          }
        }
      });
    }
  }
  return out;
}
