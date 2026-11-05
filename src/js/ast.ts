import type { Pos } from './errors';

/** The syntax tree. Plain data, so lint rules and lab checks can walk it. */
interface Base {
  /** Where an error here is reported. For `a.b` that's the b, which is where V8 points. */
  pos: Pos;
  /** Offsets of the node's text in its file. */
  off: number;
  end: number;
  /** Written inside parentheses. */
  parens?: boolean;
}

export interface Num extends Base {
  k: 'num';
  v: number;
}
export interface Str extends Base {
  k: 'str';
  v: string;
}
export interface Bool extends Base {
  k: 'bool';
  v: boolean;
}
export interface Null extends Base {
  k: 'null';
}
export interface Template extends Base {
  k: 'template';
  strs: string[];
  exprs: Expr[];
}
export interface Id extends Base {
  k: 'id';
  name: string;
}
export interface ArrayLit extends Base {
  k: 'array';
  /** null is a hole: `[1, , 3]`. */
  items: (Expr | null)[];
}
export interface Prop {
  key: string | Expr;
  value: Expr;
  pos: Pos;
}
export interface ObjectLit extends Base {
  k: 'object';
  props: Prop[];
}
export interface Param {
  name: string;
  init?: Expr;
  pos: Pos;
}
export interface Fn extends Base {
  k: 'fn';
  name?: string;
  params: Param[];
  body: Block | Expr;
  arrow: boolean;
  /** A function expression with a name can call itself by that name. */
  selfName?: boolean;
  /** `var` names, hoisted to the top of the function. */
  vars: string[];
  /** Any parameter has a default, so the parameters get a scope of their own. */
  defaults: boolean;
}
export interface Unary extends Base {
  k: 'unary';
  op: '!' | '-' | '+' | '~' | 'typeof' | 'void' | 'delete';
  e: Expr;
}
export interface Update extends Base {
  k: 'update';
  op: '++' | '--';
  prefix: boolean;
  target: Expr;
}
export interface Binary extends Base {
  k: 'binary';
  op: string;
  l: Expr;
  r: Expr;
}
export interface Logical extends Base {
  k: 'logical';
  op: '&&' | '||' | '??';
  l: Expr;
  r: Expr;
}
export interface Cond extends Base {
  k: 'cond';
  test: Expr;
  yes: Expr;
  no: Expr;
}
export interface Assign extends Base {
  k: 'assign';
  /** '=', '+=', and so on. */
  op: string;
  target: Expr;
  value: Expr;
}
export interface Seq extends Base {
  k: 'seq';
  items: Expr[];
}
export interface Member extends Base {
  k: 'member';
  obj: Expr;
  name: string;
}
export interface Index extends Base {
  k: 'index';
  obj: Expr;
  key: Expr;
}
export interface Call extends Base {
  k: 'call';
  callee: Expr;
  args: Expr[];
}

export type Expr = Num | Str | Bool | Null | Template | Id | ArrayLit | ObjectLit | Fn | Unary | Update | Binary | Logical | Cond | Assign | Seq | Member | Index | Call;

/** A `let`, `const`, or function name a block declares. */
export interface Lexical {
  name: string;
  kind: 'let' | 'const' | 'fn';
}

export interface Block extends Base {
  k: 'block';
  body: Stmt[];
  lets: Lexical[];
  /** Function declarations, ready as soon as the block starts. */
  funcs: Fn[];
}
export interface ExprStmt extends Base {
  k: 'expr';
  e: Expr;
}
export interface Declarator {
  name: string;
  init?: Expr;
  pos: Pos;
  off: number;
  end: number;
}
export interface VarDecl extends Base {
  k: 'var';
  kind: 'var' | 'let' | 'const';
  decls: Declarator[];
}
export interface FnDecl extends Base {
  k: 'fndecl';
  fn: Fn;
  /** A function in a block also sets a `var` of the same name when the line runs (sloppy mode, Annex B). */
  hoists?: boolean;
}
export interface If extends Base {
  k: 'if';
  test: Expr;
  yes: Stmt;
  no?: Stmt;
}
export interface While extends Base {
  k: 'while';
  test: Expr;
  body: Stmt;
}
export interface DoWhile extends Base {
  k: 'do';
  body: Stmt;
  test: Expr;
}
export interface For extends Base {
  k: 'for';
  init?: VarDecl | ExprStmt;
  test?: Expr;
  update?: Expr;
  body: Stmt;
  /** `let` or `const` names from the header. */
  lets: Lexical[];
  /** A function in the loop can keep a variable, so each pass needs its own copy. */
  closures: boolean;
}
export interface ForEach extends Base {
  k: 'forof' | 'forin';
  /** The declaration's kind, or undefined for `for (x of list)` with no keyword. */
  decl?: 'var' | 'let' | 'const';
  /** The name the declaration makes, or the expression it assigns to. */
  target: string | Expr;
  iter: Expr;
  body: Stmt;
}
export interface Jump extends Base {
  k: 'break' | 'continue';
}
export interface Return extends Base {
  k: 'return';
  e?: Expr;
}
export interface Case {
  /** undefined for `default`. */
  test?: Expr;
  body: Stmt[];
  pos: Pos;
}
export interface Switch extends Base {
  k: 'switch';
  test: Expr;
  cases: Case[];
  lets: Lexical[];
  funcs: Fn[];
}
export interface Empty extends Base {
  k: 'empty';
}

export type Stmt = Block | ExprStmt | VarDecl | FnDecl | If | While | DoWhile | For | ForEach | Jump | Return | Switch | Empty;

export type Loop = While | DoWhile | For | ForEach;

export type Node = Expr | Stmt;

/** One parsed file. */
export interface Program {
  file: string;
  source: string;
  body: Stmt[];
  vars: string[];
  lets: Lexical[];
  funcs: Fn[];
}

export const isLoop = (n: Node): n is Loop => n.k === 'while' || n.k === 'do' || n.k === 'for' || n.k === 'forof' || n.k === 'forin';

/** Fields that point back at nodes reachable some other way. */
const SKIP = new Set(['pos', 'funcs', 'lets', 'vars']);

function kids(n: object, out: Node[]): void {
  for (const [key, v] of Object.entries(n)) {
    if (SKIP.has(key) || typeof v !== 'object' || v === null) continue;
    if ('k' in v) out.push(v as Node);
    else kids(v, out);
  }
}

/** The nodes directly under `n`, in source order. */
export function children(n: Node): Node[] {
  const out: Node[] = [];
  kids(n, out);
  return out;
}

/** Calls `visit` on `n` and everything under it, outermost first. `visit` returns false to skip a node's children. */
export function walk(n: Node, visit: (n: Node, parent?: Node) => boolean | void, parent?: Node): void {
  if (visit(n, parent) === false) return;
  for (const c of children(n)) walk(c, visit, n);
}

/** Every node in the file. */
export function walkProgram(p: Program, visit: (n: Node, parent?: Node) => boolean | void): void {
  for (const s of p.body) walk(s, visit);
}

/** A node's source text. */
export const textOf = (p: { source: string }, n: { off: number; end: number }) => p.source.slice(n.off, n.end);
