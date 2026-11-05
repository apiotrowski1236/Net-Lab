import type { ArrayLit, Block, Case, Declarator, Expr, Fn, FnDecl, For, ForEach, Lexical, ObjectLit, Param, Program, Prop, Stmt, Switch, VarDecl } from './ast';
import { SyntaxStop, type JsError, type Pos } from './errors';
import { explainSyntax } from './help';
import { Lexer, type Token } from './lexer';

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);

/** How tightly each binary operator binds. `in` is added by the parser, since a `for` header can't use it. */
const PREC: Record<string, number> = {
  '||': 4,
  '&&': 5,
  '|': 6,
  '^': 7,
  '&': 8,
  '==': 9,
  '!=': 9,
  '===': 9,
  '!==': 9,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '<<': 11,
  '>>': 11,
  '>>>': 11,
  '+': 12,
  '-': 12,
  '*': 13,
  '/': 13,
  '%': 13,
  '**': 14,
};

interface Decl {
  kind: 'let' | 'const' | 'var' | 'fn' | 'param';
  /** A parameter that a `var` in the body names again. */
  alsoVar?: boolean;
  pos: Pos;
}

/** A sloppy-mode function in a block, which may also become a `var` once the whole function has been read. */
interface HoistCandidate {
  name: string;
  stmt: FnDecl;
  /** The scopes between the block and its function, which could stop it. */
  path: DeclScope[];
}

/** The names one scope declares, so a redeclaration is an error before anything runs, as in a browser. */
class DeclScope {
  lex = new Map<string, Decl>();
  vars = new Map<string, Decl>();
  funcs: Fn[] = [];
  hoists: HoistCandidate[] = [];
  constructor(
    readonly parent: DeclScope | null,
    /** The top of a function or of the file, where `var` stops. */
    readonly top: boolean,
  ) {}

  lexicals(): Lexical[] {
    return [...this.lex].map(([name, d]) => ({ name, kind: d.kind as Lexical['kind'] }));
  }

  varNames(): string[] {
    return [...this.vars].filter(([, d]) => d.kind === 'var' || d.alsoVar).map(([name]) => name);
  }
}

class Parser {
  private lx: Lexer;
  private tok!: Token;
  private prev!: Token;
  /** Everything read so far, for the help text. */
  private seen: Token[] = [];
  private scope = new DeclScope(null, true);
  private inFunction = false;
  private loops = 0;
  private breakable = 0;
  /** Functions seen so far, so a `for` can tell if one is written inside it. */
  private fnCount = 0;

  constructor(
    private file: string,
    private source: string,
  ) {
    this.lx = new Lexer(file, source);
    this.prev = { t: 'eof', v: '', pos: { file, line: 1, col: 0, off: 0 }, end: 0, nl: false };
    this.advance();
  }

  // --- tokens ---

  private advance(): void {
    this.prev = this.tok ?? this.prev;
    this.tok = this.lx.next();
    this.seen.push(this.tok);
  }

  private isOp(v: string): boolean {
    return this.tok.t === 'op' && this.tok.v === v;
  }

  private isKw(v: string): boolean {
    return this.tok.t === 'kw' && this.tok.v === v;
  }

  private isId(v: string): boolean {
    return this.tok.t === 'id' && this.tok.v === v;
  }

  /** The token after this one. */
  private peek(): Token {
    const here = this.lx.save();
    const t = this.lx.next();
    this.lx.restore(here);
    return t;
  }

  private stop(error: Omit<JsError, 'help'>, at: Token, extra?: { first?: Pos; name?: string }): never {
    const { code, help } = explainSyntax(error, this.seen, at, extra);
    throw new SyntaxStop({ ...error, code, help });
  }

  private fail(msg: string, at: Token = this.tok, code = 'syntax', extra?: { first?: Pos; name?: string }): never {
    this.stop({ type: 'SyntaxError', msg, code, pos: at.pos }, at, extra);
  }

  /** V8's wording for a token that doesn't belong. */
  private unexpected(t: Token = this.tok): never {
    switch (t.t) {
      case 'eof':
        return this.fail('Unexpected end of input', t);
      case 'num':
        return this.fail('Unexpected number', t);
      case 'str':
        return this.fail('Unexpected string', t);
      case 'tpl':
        return this.fail('Unexpected template string', t);
      case 'id':
        return this.fail(`Unexpected identifier '${t.v}'`, t);
      case 'illegal':
        if (t.code === 'bigint') return this.notAvailable(t.msg!, t);
        return this.fail(t.msg!, t, t.code);
      default:
        return this.fail(t.v === 'enum' ? 'Unexpected reserved word' : `Unexpected token '${t.v}'`, t);
    }
  }

  /** Language this editor leaves out stops here, in plain words, and doesn't pretend to run. */
  private notAvailable(msg: string, at: Token = this.tok): never {
    throw new SyntaxStop({ type: 'NotAvailable', msg, code: 'not-available', pos: at.pos, help: 'The labs in this editor use a smaller part of JavaScript, so this line has to change before the code can run.' });
  }

  private expect(v: string): void {
    if (!this.isOp(v)) this.unexpected();
    this.advance();
  }

  private semicolon(): void {
    if (this.isOp(';')) {
      this.advance();
      return;
    }
    if (this.isOp('}') || this.tok.t === 'eof' || this.tok.nl) return;
    if (this.prev.t === 'id' && this.prev.v === 'await') this.notAvailable('await is not available in this editor.', this.prev);
    this.unexpected();
  }

  private mark(start: { pos: Pos; off?: number }, pos: Pos = start.pos) {
    return { pos, off: start.off ?? start.pos.off, end: this.prev.end };
  }

  // --- scopes ---

  private push(top = false): DeclScope {
    this.scope = new DeclScope(this.scope, top);
    return this.scope;
  }

  private pop(): void {
    this.scope = this.scope.parent!;
  }

  private redeclared(name: string, first: Decl, at: Token): never {
    this.fail(`Identifier '${name}' has already been declared`, at, 'redeclared', { first: first.pos, name });
  }

  private declareLexical(name: string, kind: 'let' | 'const' | 'fn', at: Token): void {
    const s = this.scope;
    const had = s.lex.get(name) ?? s.vars.get(name);
    // Sloppy mode lets one block declare a function twice.
    if (had && !(kind === 'fn' && had.kind === 'fn')) this.redeclared(name, had, at);
    s.lex.set(name, { kind, pos: at.pos });
  }

  private declareVar(name: string, at: Token): void {
    for (let s: DeclScope | null = this.scope; s; s = s.parent) {
      const had = s.lex.get(name);
      if (had) this.redeclared(name, had, at);
      const param = s.vars.get(name);
      if (!param) s.vars.set(name, { kind: 'var', pos: at.pos });
      else if (param.kind === 'param') param.alsoVar = true;
      if (s.top) return;
    }
  }

  private declare(name: string, kind: 'var' | 'let' | 'const', at: Token): void {
    if (kind === 'var') this.declareVar(name, at);
    else this.declareLexical(name, kind, at);
  }

  /** The end of a function: a function declared in one of its blocks gets a `var` too, if nothing there stops it. */
  private settleHoists(top: DeclScope): void {
    for (const h of top.hoists) {
      if (h.path.some((s) => s.lex.has(h.name))) continue;
      const had = top.vars.get(h.name);
      if (had?.kind === 'param') continue;
      if (top.lex.has(h.name)) continue;
      h.stmt.hoists = true;
      if (!had) top.vars.set(h.name, { kind: 'var', pos: h.stmt.pos });
    }
  }

  // --- statements ---

  parseProgram(): Program {
    const top = this.scope;
    const body: Stmt[] = [];
    while (this.tok.t !== 'eof') body.push(this.item());
    this.settleHoists(top);
    return { file: this.file, source: this.source, body, vars: top.varNames(), lets: top.lexicals(), funcs: top.funcs };
  }

  /** A statement, or a declaration where one is allowed. */
  private item(): Stmt {
    const t = this.tok;
    if (t.t === 'kw') {
      if (t.v === 'function') return this.functionDecl();
      if (t.v === 'class') this.notAvailable('class is not available in this editor.');
      if (t.v === 'const') return this.varStatement('const');
    }
    if (t.t === 'id') {
      if (t.v === 'let' && this.nextIsBinding()) return this.varStatement('let');
      if (t.v === 'async') {
        const n = this.peek();
        if (n.t === 'kw' && n.v === 'function' && !n.nl) this.notAvailable('async functions are not available in this editor.');
      }
    }
    return this.statement();
  }

  private nextIsBinding(): boolean {
    const n = this.peek();
    return n.t === 'id' || (n.t === 'op' && (n.v === '[' || n.v === '{'));
  }

  private statement(): Stmt {
    const t = this.tok;
    if (t.t === 'op') {
      if (t.v === '{') return this.block();
      if (t.v === ';') {
        this.advance();
        return { k: 'empty', ...this.mark(t) };
      }
    }
    if (t.t === 'kw') {
      switch (t.v) {
        case 'var':
          return this.varStatement('var');
        case 'if':
          return this.ifStatement();
        case 'while':
          return this.whileStatement();
        case 'do':
          return this.doStatement();
        case 'for':
          return this.forStatement();
        case 'switch':
          return this.switchStatement();
        case 'return':
          return this.returnStatement();
        case 'break':
        case 'continue':
          return this.jump(t.v);
        case 'function':
          return this.fail('In non-strict mode code, functions can only be declared at top level, inside a block, or as the body of an if statement.');
        case 'class':
          return this.notAvailable('class is not available in this editor.');
        case 'try':
          return this.notAvailable('try and catch are not available in this editor.');
        case 'throw':
          return this.notAvailable('throw is not available in this editor.');
        case 'import':
        case 'export':
          return this.notAvailable(`${t.v} is not available in this editor.`);
        case 'with':
        case 'debugger':
          return this.notAvailable(`The ${t.v} statement is not available in this editor.`);
      }
    }
    if (t.t === 'id' && t.v === 'let') {
      const n = this.peek();
      if ((n.t === 'op' && n.v === '[') || ((n.t === 'id' || (n.t === 'op' && n.v === '{')) && !n.nl)) this.fail('Lexical declaration cannot appear in a single-statement context');
    }
    const e = this.expression();
    if (e.k === 'id' && !e.parens && this.isOp(':')) this.notAvailable(`Labels like ${e.name}: are not available in this editor.`, t);
    this.semicolon();
    return { k: 'expr', e, ...this.mark(t) };
  }

  private blockBody(): { body: Stmt[] } {
    const body: Stmt[] = [];
    while (!this.isOp('}')) body.push(this.item());
    this.advance();
    return { body };
  }

  private block(): Block {
    const t = this.tok;
    this.advance();
    const s = this.push();
    const { body } = this.blockBody();
    this.pop();
    return { k: 'block', body, lets: s.lexicals(), funcs: s.funcs, ...this.mark(t) };
  }

  private varStatement(kind: 'var' | 'let' | 'const'): VarDecl {
    const d = this.varDecls(kind, false);
    this.semicolon();
    d.end = this.prev.end;
    return d;
  }

  private varDecls(kind: 'var' | 'let' | 'const', inFor: boolean): VarDecl {
    const start = this.tok;
    this.advance();
    const decls: Declarator[] = [];
    for (;;) {
      const name = this.tok;
      if (this.isOp('[') || this.isOp('{')) this.notAvailable('Destructuring is not available in this editor. Make one variable at a time.');
      if (name.t !== 'id') this.unexpected();
      if (kind !== 'var' && name.v === 'let') this.fail('let is disallowed as a lexically bound name');
      this.advance();
      this.declare(name.v, kind, name);
      let init: Expr | undefined;
      if (this.isOp('=')) {
        this.advance();
        init = this.assign(inFor);
      } else if (kind === 'const' && !(inFor && this.atForInOf())) this.fail('Missing initializer in const declaration', name);
      decls.push({ name: name.v, init, pos: name.pos, off: name.pos.off, end: this.prev.end });
      if (!this.isOp(',')) break;
      this.advance();
    }
    return { k: 'var', kind, decls, ...this.mark(start) };
  }

  private parenTest(): Expr {
    this.expect('(');
    const test = this.expression();
    this.expect(')');
    return test;
  }

  private ifStatement(): Stmt {
    const t = this.tok;
    this.advance();
    const test = this.parenTest();
    const yes = this.ifBranch();
    let no: Stmt | undefined;
    if (this.isKw('else')) {
      this.advance();
      no = this.ifBranch();
    }
    return { k: 'if', test, yes, no, ...this.mark(t) };
  }

  /** `if (x) function f() {}` is allowed in sloppy mode, as if it had braces. */
  private ifBranch(): Stmt {
    if (!this.isKw('function')) return this.statement();
    const t = this.tok;
    const s = this.push();
    const stmt = this.functionDecl();
    this.pop();
    return { k: 'block', body: [stmt], lets: s.lexicals(), funcs: s.funcs, ...this.mark(t) };
  }

  private loopBody(): Stmt {
    this.loops++;
    this.breakable++;
    const body = this.statement();
    this.loops--;
    this.breakable--;
    return body;
  }

  private whileStatement(): Stmt {
    const t = this.tok;
    this.advance();
    const test = this.parenTest();
    const body = this.loopBody();
    return { k: 'while', test, body, ...this.mark(t) };
  }

  private doStatement(): Stmt {
    const t = this.tok;
    this.advance();
    const body = this.loopBody();
    if (!this.isKw('while')) this.unexpected();
    this.advance();
    const test = this.parenTest();
    if (this.isOp(';')) this.advance();
    return { k: 'do', body, test, ...this.mark(t) };
  }

  private atForInOf(): boolean {
    return this.isKw('in') || this.isId('of');
  }

  private forStatement(): Stmt {
    const t = this.tok;
    this.advance();
    if (this.isId('await')) this.notAvailable('for await is not available in this editor.');
    this.expect('(');
    const s = this.push();
    const fnsBefore = this.fnCount;
    let init: For['init'];
    if (this.isKw('var') || this.isKw('const') || (this.isId('let') && this.nextIsBinding())) {
      const kind = this.tok.v as 'var' | 'let' | 'const';
      const decl = this.varDecls(kind, true);
      if (this.atForInOf()) {
        const word = this.tok.v;
        if (decl.decls.length !== 1) this.fail(`Invalid left-hand side in ${word === 'of' ? 'for-of' : 'for-in'} loop: Must have a single binding.`, this.prev);
        if (decl.decls[0].init) this.fail(`for-${word} loop variable declaration may not have an initializer.`, this.prev);
        return this.forEachRest(t, word as 'of' | 'in', kind, decl.decls[0].name);
      }
      init = decl;
    } else if (!this.isOp(';')) {
      const start = this.tok;
      const e = this.expression(true);
      if (this.atForInOf()) {
        if (e.k === 'array' || e.k === 'object') this.notAvailable('Destructuring is not available in this editor. Make one variable at a time.', start);
        if (e.k !== 'id' && e.k !== 'member' && e.k !== 'index') this.fail('Invalid left-hand side in for-loop', start);
        return this.forEachRest(t, this.tok.v as 'of' | 'in', undefined, e);
      }
      init = { k: 'expr', e, ...this.mark(start) };
    }
    this.expect(';');
    const test = this.isOp(';') ? undefined : this.expression();
    this.expect(';');
    const update = this.isOp(')') ? undefined : this.expression();
    this.expect(')');
    const body = this.loopBody();
    const lets = s.lexicals();
    this.pop();
    return { k: 'for', init, test, update, body, lets, closures: this.fnCount > fnsBefore, ...this.mark(t) };
  }

  private forEachRest(t: Token, word: 'of' | 'in', decl: ForEach['decl'], target: string | Expr): Stmt {
    this.advance();
    const iter = word === 'of' ? this.assign() : this.expression();
    this.expect(')');
    const body = this.loopBody();
    this.pop();
    return { k: word === 'of' ? 'forof' : 'forin', decl, target, iter, body, ...this.mark(t) };
  }

  private jump(word: 'break' | 'continue'): Stmt {
    const t = this.tok;
    this.advance();
    if (word === 'break' && !this.breakable) this.fail('Illegal break statement', t);
    if (word === 'continue' && !this.loops) this.fail('Illegal continue statement: no surrounding iteration statement', t);
    if (this.tok.t === 'id' && !this.tok.nl) this.notAvailable(`Labels are not available in this editor, so ${word} cannot name one.`, this.tok);
    this.semicolon();
    return { k: word, ...this.mark(t) };
  }

  private returnStatement(): Stmt {
    const t = this.tok;
    if (!this.inFunction) this.fail('Illegal return statement');
    this.advance();
    let e: Expr | undefined;
    if (!this.isOp(';') && !this.isOp('}') && this.tok.t !== 'eof' && !this.tok.nl) e = this.expression();
    this.semicolon();
    return { k: 'return', e, ...this.mark(t) };
  }

  private switchStatement(): Switch {
    const t = this.tok;
    this.advance();
    const test = this.parenTest();
    this.expect('{');
    const s = this.push();
    const cases: Case[] = [];
    let hasDefault = false;
    this.breakable++;
    while (!this.isOp('}')) {
      const at = this.tok;
      let caseTest: Expr | undefined;
      if (this.isKw('case')) {
        this.advance();
        caseTest = this.expression();
      } else if (this.isKw('default')) {
        if (hasDefault) this.fail('More than one default clause in switch statement');
        hasDefault = true;
        this.advance();
      } else this.unexpected();
      this.expect(':');
      const body: Stmt[] = [];
      while (!this.isOp('}') && !this.isKw('case') && !this.isKw('default')) body.push(this.item());
      cases.push({ test: caseTest, body, pos: at.pos });
    }
    this.breakable--;
    this.advance();
    this.pop();
    return { k: 'switch', test, cases, lets: s.lexicals(), funcs: s.funcs, ...this.mark(t) };
  }

  // --- functions ---

  private functionDecl(): FnDecl {
    const t = this.tok;
    this.advance();
    if (this.isOp('*')) this.notAvailable('Generator functions are not available in this editor.');
    const name = this.tok;
    if (this.isOp('(')) this.fail('Function statements require a function name');
    if (name.t !== 'id') this.unexpected();
    this.advance();
    const scope = this.scope;
    const fn = this.functionRest(t, name.v);
    const stmt: FnDecl = { k: 'fndecl', fn, ...this.mark(t) };
    if (scope.top) {
      const had = scope.lex.get(name.v);
      if (had) this.redeclared(name.v, had, name);
      if (!scope.vars.has(name.v)) scope.vars.set(name.v, { kind: 'fn', pos: name.pos });
    } else {
      this.declareLexical(name.v, 'fn', name);
      const path: DeclScope[] = [];
      let s = scope.parent!;
      while (!s.top) {
        path.push(s);
        s = s.parent!;
      }
      s.hoists.push({ name: name.v, stmt, path });
    }
    scope.funcs.push(fn);
    return stmt;
  }

  private functionExpr(): Fn {
    const t = this.tok;
    this.advance();
    if (this.isOp('*')) this.notAvailable('Generator functions are not available in this editor.');
    let name: string | undefined;
    if (!this.isOp('(')) {
      if (this.tok.t !== 'id') this.unexpected();
      name = this.tok.v;
      this.advance();
    }
    return this.functionRest(t, name, name !== undefined);
  }

  /** Parameters and body, with the reader on the `(`. */
  private functionRest(t: Token, name: string | undefined, selfName = false): Fn {
    this.expect('(');
    const s = this.push(true);
    const params: Param[] = [];
    let defaults = false;
    let duplicate: Token | undefined;
    while (!this.isOp(')')) {
      if (this.isOp('...')) this.notAvailable('Rest parameters, written with ..., are not available in this editor.');
      if (this.isOp('[') || this.isOp('{')) this.notAvailable('Destructuring is not available in this editor. Make one variable at a time.');
      const p = this.tok;
      if (p.t !== 'id') this.unexpected();
      this.advance();
      if (s.vars.has(p.v)) duplicate = p;
      s.vars.set(p.v, { kind: 'param', pos: p.pos });
      let init: Expr | undefined;
      if (this.isOp('=')) {
        this.advance();
        init = this.assign();
        defaults = true;
      }
      params.push({ name: p.v, init, pos: p.pos });
      if (!this.isOp(',')) break;
      this.advance();
    }
    this.expect(')');
    if (defaults && duplicate) this.fail('Duplicate parameter name not allowed in this context', duplicate);
    return this.functionBody(t, s, name, params, defaults, selfName);
  }

  private functionBody(t: { pos: Pos; off?: number }, s: DeclScope, name: string | undefined, params: Param[], defaults: boolean, selfName: boolean): Fn {
    const open = this.tok;
    this.expect('{');
    const saved = [this.inFunction, this.loops, this.breakable] as const;
    this.inFunction = true;
    this.loops = 0;
    this.breakable = 0;
    this.fnCount++;
    const { body } = this.blockBody();
    [this.inFunction, this.loops, this.breakable] = saved;
    this.settleHoists(s);
    this.pop();
    const block: Block = { k: 'block', body, lets: s.lexicals(), funcs: s.funcs, ...this.mark(open) };
    return { k: 'fn', name, params, body: block, arrow: false, selfName, vars: s.varNames(), defaults, ...this.mark(t) };
  }

  private arrow(left: Expr, start: Token): Fn {
    const parts = left.k === 'seq' && left.parens ? left.items : [left];
    if (!left.parens && left.k !== 'id') this.fail('Malformed arrow function parameter list', start);
    const params: Param[] = [];
    const s = this.push(true);
    let defaults = false;
    for (const p of parts) {
      if (p.k === 'id') params.push({ name: p.name, pos: p.pos });
      else if (p.k === 'assign' && p.op === '=' && p.target.k === 'id') {
        params.push({ name: p.target.name, init: p.value, pos: p.pos });
        defaults = true;
      } else if (p.k === 'array' || p.k === 'object') this.notAvailable('Destructuring is not available in this editor. Make one variable at a time.', start);
      else this.stop({ type: 'SyntaxError', msg: 'Invalid destructuring assignment target', code: 'syntax', pos: p.pos }, start);
      if (s.vars.has(params[params.length - 1].name)) this.fail('Duplicate parameter name not allowed in this context', start);
      s.vars.set(params[params.length - 1].name, { kind: 'param', pos: p.pos });
    }
    this.advance();
    if (this.isOp('{')) {
      const fn = this.functionBody(start, s, undefined, params, defaults, false);
      fn.arrow = true;
      return fn;
    }
    const saved = this.inFunction;
    this.fnCount++;
    const body = this.assign();
    this.inFunction = saved;
    this.settleHoists(s);
    this.pop();
    return { k: 'fn', params, body, arrow: true, vars: s.varNames(), defaults, ...this.mark(start) };
  }

  // --- expressions ---

  private expression(noIn = false): Expr {
    const start = this.tok;
    const first = this.assign(noIn);
    if (!this.isOp(',')) return first;
    const items = [first];
    while (this.isOp(',')) {
      this.advance();
      items.push(this.assign(noIn));
    }
    return { k: 'seq', items, ...this.mark(start) };
  }

  private assign(noIn = false): Expr {
    const start = this.tok;
    if (start.t === 'id' && start.v === 'async') {
      const n = this.peek();
      if (!n.nl && ((n.t === 'kw' && n.v === 'function') || n.t === 'id' || (n.t === 'op' && n.v === '('))) this.notAvailable('async functions are not available in this editor.');
    }
    const left = this.conditional(noIn);
    if (this.isOp('=>')) {
      if (this.tok.nl) this.unexpected();
      return this.arrow(left, start);
    }
    if (this.tok.t !== 'op' || !ASSIGN_OPS.has(this.tok.v)) return left;
    const op = this.tok;
    if (left.k === 'array' || left.k === 'object') this.notAvailable('Destructuring is not available in this editor. Make one variable at a time.', start);
    if (left.k !== 'id' && left.k !== 'member' && left.k !== 'index' && left.k !== 'call') this.fail('Invalid left-hand side in assignment', start);
    this.advance();
    const value = this.assign(noIn);
    return { k: 'assign', op: op.v, target: left, value, ...this.mark(start, op.pos) };
  }

  private conditional(noIn: boolean): Expr {
    const start = this.tok;
    const test = this.logical(noIn);
    if (!this.isOp('?')) return test;
    this.advance();
    const yes = this.assign();
    this.expect(':');
    const no = this.assign(noIn);
    return { k: 'cond', test, yes, no, ...this.mark(start) };
  }

  /** `??` can't sit next to `&&` or `||` without parentheses, so it gets a path of its own, as in V8. */
  private logical(noIn: boolean): Expr {
    const start = this.tok;
    let e = this.binary(6, noIn);
    if (this.isOp('&&') || this.isOp('||')) return this.binaryRest(e, 4, noIn, start);
    while (this.isOp('??')) {
      this.advance();
      const r = this.binary(6, noIn);
      e = { k: 'logical', op: '??', l: e, r, ...this.mark(start) };
    }
    return e;
  }

  private binary(min: number, noIn: boolean): Expr {
    const start = this.tok;
    return this.binaryRest(this.unary(), min, noIn, start);
  }

  private precedence(noIn: boolean): number {
    const t = this.tok;
    if (t.t === 'op') return PREC[t.v] ?? 0;
    if (t.t === 'kw' && t.v === 'in') return noIn ? 0 : 10;
    if (t.t === 'kw' && t.v === 'instanceof') return 10;
    return 0;
  }

  private binaryRest(first: Expr, min: number, noIn: boolean, start: Token): Expr {
    let left = first;
    for (;;) {
      const p = this.precedence(noIn);
      if (p === 0 || p < min) return left;
      const op = this.tok;
      if (op.v === 'instanceof') this.notAvailable('instanceof is not available in this editor. Use typeof or Array.isArray instead.');
      this.advance();
      const right = this.binary(op.v === '**' ? p : p + 1, noIn);
      const at = this.mark(start, op.pos);
      left = op.v === '&&' || op.v === '||' ? { k: 'logical', op: op.v, l: left, r: right, ...at } : { k: 'binary', op: op.v, l: left, r: right, ...at };
    }
  }

  private unary(): Expr {
    const t = this.tok;
    if ((t.t === 'op' && (t.v === '!' || t.v === '-' || t.v === '+' || t.v === '~')) || (t.t === 'kw' && (t.v === 'typeof' || t.v === 'void' || t.v === 'delete'))) {
      this.advance();
      const e = this.unary();
      if (this.isOp('**')) this.fail('Unary operator used immediately before exponentiation expression. Parenthesis must be used to disambiguate operator precedence', this.prev);
      if (t.v === 'delete' && e.k === 'id') this.notAvailable('delete works on a property here, not on a variable.', t);
      return { k: 'unary', op: t.v as '!', e, ...this.mark(t) };
    }
    if (t.t === 'op' && (t.v === '++' || t.v === '--')) {
      this.advance();
      const target = this.unary();
      if (target.k !== 'id' && target.k !== 'member' && target.k !== 'index' && target.k !== 'call') this.fail('Invalid left-hand side expression in prefix operation', t);
      return { k: 'update', op: t.v as '++', prefix: true, target, ...this.mark(t) };
    }
    if (t.t === 'id' && t.v === 'await') {
      const n = this.peek();
      if (!n.nl && (n.t === 'id' || n.t === 'num' || n.t === 'str' || (n.t === 'kw' && n.v !== 'in' && n.v !== 'instanceof'))) this.notAvailable('await is not available in this editor.');
    }
    return this.postfix();
  }

  private postfix(): Expr {
    const start = this.tok;
    const e = this.callOrMember();
    if ((this.isOp('++') || this.isOp('--')) && !this.tok.nl) {
      if (e.k !== 'id' && e.k !== 'member' && e.k !== 'index' && e.k !== 'call') this.fail('Invalid left-hand side expression in postfix operation', start);
      const op = this.tok.v as '++';
      this.advance();
      return { k: 'update', op, prefix: false, target: e, ...this.mark(start) };
    }
    return e;
  }

  private callOrMember(): Expr {
    const start = this.tok;
    let e = this.primary();
    for (;;) {
      if (this.isOp('.')) {
        this.advance();
        const name = this.tok;
        if (name.t !== 'id' && name.t !== 'kw') this.unexpected();
        this.advance();
        e = { k: 'member', obj: e, name: name.v, ...this.mark(start, name.pos) };
      } else if (this.isOp('[')) {
        const open = this.tok;
        this.advance();
        const key = this.expression();
        this.expect(']');
        e = { k: 'index', obj: e, key, ...this.mark(start, open.pos) };
      } else if (this.isOp('(')) {
        const at = e.k === 'member' ? e.pos : this.tok.pos;
        const args = this.args();
        e = { k: 'call', callee: e, args, ...this.mark(start, at) };
      } else if (this.isOp('?.')) this.notAvailable('Optional chaining, written with ?., is not available in this editor.');
      else if (this.tok.t === 'tpl') this.notAvailable('Tagged templates are not available in this editor.');
      else return e;
    }
  }

  private args(): Expr[] {
    this.advance();
    const out: Expr[] = [];
    while (!this.isOp(')')) {
      if (this.isOp('...')) this.notAvailable('The spread operator, written with ..., is not available in this editor.');
      out.push(this.assign());
      if (!this.isOp(',')) break;
      this.advance();
    }
    if (!this.isOp(')')) this.fail('missing ) after argument list', this.prev, 'missing-paren');
    this.advance();
    return out;
  }

  private primary(): Expr {
    const t = this.tok;
    switch (t.t) {
      case 'num':
        this.advance();
        return { k: 'num', v: t.n!, ...this.mark(t) };
      case 'str':
        this.advance();
        return { k: 'str', v: t.v, ...this.mark(t) };
      case 'tpl':
        return this.template();
      case 'id':
        this.advance();
        return { k: 'id', name: t.v, ...this.mark(t) };
      case 'kw':
        switch (t.v) {
          case 'true':
          case 'false':
            this.advance();
            return { k: 'bool', v: t.v === 'true', ...this.mark(t) };
          case 'null':
            this.advance();
            return { k: 'null', ...this.mark(t) };
          case 'function':
            return this.functionExpr();
          case 'this':
            return this.notAvailable('this is not available in this editor. Pass the value in as a parameter instead.');
          case 'new':
            return this.notAvailable(this.peek().v === 'Array' ? 'new is not available in this editor. To make an array, use square brackets: let list = [];' : 'new is not available in this editor.');
          case 'class':
            return this.notAvailable('class is not available in this editor.');
          case 'super':
          case 'import':
            return this.notAvailable(`${t.v} is not available in this editor.`);
        }
        return this.unexpected();
      case 'op':
        if (t.v === '(') return this.parens();
        if (t.v === '[') return this.arrayLit();
        if (t.v === '{') return this.objectLit();
        if (t.v === '/' || t.v === '/=') {
          const rest = this.source.slice(t.end).split('\n')[0];
          if (!rest.includes('/')) this.fail('Invalid regular expression: missing /');
          this.notAvailable('Regular expressions, written between / marks, are not available in this editor.');
        }
        if (t.v === '...') this.notAvailable('The spread operator, written with ..., is not available in this editor.');
        return this.unexpected();
      default:
        return this.unexpected();
    }
  }

  private parens(): Expr {
    const t = this.tok;
    this.advance();
    const seq = (items: Expr[]): Expr => ({ k: 'seq', items, parens: true, ...this.mark(t) });
    if (this.isOp(')')) {
      const close = this.tok;
      this.advance();
      if (!this.isOp('=>')) this.unexpected(close);
      return seq([]);
    }
    if (this.isOp('...')) this.notAvailable('Rest parameters, written with ..., are not available in this editor.');
    const items = [this.assign()];
    while (this.isOp(',')) {
      this.advance();
      if (this.isOp(')')) {
        const close = this.tok;
        this.advance();
        if (!this.isOp('=>')) this.unexpected(close);
        return seq(items);
      }
      if (this.isOp('...')) this.notAvailable('Rest parameters, written with ..., are not available in this editor.');
      items.push(this.assign());
    }
    this.expect(')');
    if (items.length > 1) return seq(items);
    return { ...items[0], parens: true };
  }

  private arrayLit(): ArrayLit {
    const t = this.tok;
    this.advance();
    const items: (Expr | null)[] = [];
    while (!this.isOp(']')) {
      if (this.isOp(',')) {
        this.advance();
        items.push(null);
        continue;
      }
      if (this.isOp('...')) this.notAvailable('The spread operator, written with ..., is not available in this editor.');
      items.push(this.assign());
      if (!this.isOp(']')) this.expect(',');
    }
    this.advance();
    return { k: 'array', items, ...this.mark(t) };
  }

  private objectLit(): ObjectLit {
    const t = this.tok;
    this.advance();
    const props: Prop[] = [];
    while (!this.isOp('}')) {
      const at = this.tok;
      let key: string | Expr;
      if (at.t === 'id' || at.t === 'kw') {
        const n = this.peek();
        const special = n.t !== 'op' || !',:(}='.includes(n.v);
        if (at.t === 'id' && (at.v === 'get' || at.v === 'set' || at.v === 'async') && special) this.notAvailable(`${at.v} methods are not available in this editor.`);
        key = at.v;
        this.advance();
      } else if (at.t === 'str') {
        key = at.v;
        this.advance();
      } else if (at.t === 'num') {
        key = String(at.n);
        this.advance();
      } else if (this.isOp('[')) {
        this.advance();
        key = this.assign();
        this.expect(']');
      } else if (this.isOp('...')) this.notAvailable('The spread operator, written with ..., is not available in this editor.');
      else if (this.isOp('*')) this.notAvailable('Generator functions are not available in this editor.');
      else this.unexpected();
      let value: Expr;
      if (this.isOp(':')) {
        this.advance();
        value = this.assign();
      } else if (this.isOp('(')) {
        value = this.functionRest(at, typeof key === 'string' ? key : undefined);
      } else if (at.t === 'id') {
        if (this.isOp('=')) this.notAvailable('Destructuring is not available in this editor. Make one variable at a time.');
        value = { k: 'id', name: at.v, ...this.mark(at) };
      } else if (at.t === 'kw' || at.t === 'num' || at.t === 'str') this.unexpected(at);
      else this.unexpected();
      props.push({ key, value: value!, pos: at.pos });
      if (!this.isOp('}')) this.expect(',');
    }
    this.advance();
    return { k: 'object', props, ...this.mark(t) };
  }

  /** A template literal. The lexer hands over the text, and the parser reads what's inside `${ }`. */
  private template(): Expr {
    const t = this.tok;
    const strs: string[] = [];
    const exprs: Expr[] = [];
    let chunk = this.lx.templateChunk();
    for (;;) {
      if (chunk.bad) this.unexpected(chunk.bad);
      strs.push(chunk.text);
      if (chunk.done) break;
      this.seen.push({ ...this.tok, t: 'op', v: '${', pos: this.tok.pos });
      this.advance();
      exprs.push(this.expression());
      if (!this.isOp('}')) this.fail('Missing } in template expression');
      chunk = this.lx.templateChunk();
    }
    this.advance();
    return { k: 'template', strs, exprs, ...this.mark(t) };
  }
}

/** Parses one file. Throws `SyntaxStop` at the first error. */
export function parseFile(file: string, source: string): Program {
  return new Parser(file, source).parseProgram();
}
