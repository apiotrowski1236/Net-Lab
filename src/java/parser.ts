import type { Access, Block, ClassDecl, Expr, FieldDecl, FileAst, LocalVar, MethodDecl, Param, Stmt, TypeNode } from './ast';
import { SyntaxStop, type CompileError, type Pos } from './errors';
import { lex, type Tok } from './lexer';

const PRIMS = new Set(['int', 'double', 'boolean', 'char', 'long', 'void']);
const UNSUPPORTED_PRIMS = new Set(['float', 'byte', 'short']);
const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'synchronized', 'native', 'transient', 'volatile', 'strictfp', 'default']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']);
const PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '>>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

/** Plain-English notes for the messages only the parser gives. */
const HELP: Record<string, string> = {
  ';': 'Most lines of Java end with a semicolon. Add a ; at the end of this line. If the line looks right, check the line above it too.',
  ')': 'Every ( needs a matching ). Count them on this line.',
  '(': 'This keyword needs parentheses around what comes next, like if (x > 0).',
  ']': 'Every [ needs a matching ].',
  '{': 'A class, method, or loop body starts with {.',
  '}': 'Every { needs a matching }.',
};

class Parser {
  private toks: Tok[];
  private i = 0;

  constructor(private file: string, src: string) {
    this.toks = lex(file, src);
  }

  // --- token helpers ---

  private get t(): Tok {
    return this.toks[this.i];
  }
  private peek(n = 1): Tok {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)];
  }
  private get prevEnd(): Pos {
    const p = this.toks[this.i - 1];
    if (!p) return this.t.pos;
    return { ...p.end, col: Math.max(0, p.end.col - 1) };
  }
  private is(text: string): boolean {
    return (this.t.kind === 'op' || this.t.kind === 'kw') && this.t.text === text;
  }
  private accept(text: string): boolean {
    if (!this.is(text)) return false;
    this.i++;
    return true;
  }
  private stop(code: string, msg: string, pos: Pos = this.t.pos, help?: string): never {
    if (this.t.kind === 'eof' && code !== 'unsupported') this.eof();
    throw new SyntaxStop({ code, msg, pos, help });
  }
  private eof(): never {
    const e: CompileError = {
      code: 'end-of-file',
      msg: 'reached end of file while parsing',
      pos: this.prevEnd,
      help: 'Java got to the end of the file while something was still open. You are most likely missing a closing } at the bottom.',
    };
    throw new SyntaxStop(e);
  }
  private expect(text: string): Tok {
    const t = this.t;
    if (this.is(text)) {
      this.i++;
      return t;
    }
    if (t.kind === 'eof') this.eof();
    const pos = text === ';' || text === ')' || text === ']' ? this.prevEnd : t.pos;
    const code = text === ';' ? 'missing-semicolon' : 'expected';
    return this.stop(code, `'${text}' expected`, pos, HELP[text]);
  }
  private ident(): Tok {
    const t = this.t;
    if (t.kind === 'id') {
      this.i++;
      return t;
    }
    if (t.kind === 'eof') this.eof();
    if (t.kind === 'kw') {
      this.stop('keyword-name', `<identifier> expected`, t.pos, `\`${t.text}\` is a word Java keeps for itself, so it can't be a name. Pick a different name.`);
    }
    return this.stop('expected-name', '<identifier> expected', this.prevEnd, 'Java expected a name here, such as a variable or method name.');
  }

  // --- files and classes ---

  parseFile(): FileAst {
    const ast: FileAst = { file: this.file, imports: [], classes: [] };
    if (this.is('package')) {
      while (!this.is(';') && this.t.kind !== 'eof') this.i++;
      this.expect(';');
    }
    while (this.is('import')) {
      const pos = this.t.pos;
      this.i++;
      if (this.is('static')) this.stop('unsupported', 'this editor does not run static imports', pos);
      let name = this.ident().text;
      while (this.accept('.')) {
        if (this.accept('*')) {
          name += '.*';
          break;
        }
        name += '.' + this.ident().text;
      }
      this.expect(';');
      ast.imports.push({ name, pos });
    }
    while (this.t.kind !== 'eof') {
      if (this.accept(';')) continue;
      ast.classes.push(this.classDecl());
    }
    return ast;
  }

  private modifiers() {
    const seen = { access: 'package' as Access, isStatic: false, isFinal: false, isOverride: false, overridePos: undefined as Pos | undefined, isAbstract: false };
    for (;;) {
      if (this.is('@')) {
        const at = this.t.pos;
        this.i++;
        const name = this.ident().text;
        if (name === 'Override') {
          seen.isOverride = true;
          seen.overridePos = at;
        }
        continue;
      }
      if (this.t.kind !== 'kw' || !MODIFIERS.has(this.t.text)) return seen;
      const m = this.t.text;
      this.i++;
      if (m === 'public' || m === 'private' || m === 'protected') seen.access = m;
      else if (m === 'static') seen.isStatic = true;
      else if (m === 'final') seen.isFinal = true;
      else if (m === 'abstract') seen.isAbstract = true;
    }
  }

  private classDecl(): ClassDecl {
    const mods = this.modifiers();
    if (this.is('interface') || this.is('enum')) this.stop('unsupported', `this editor does not run ${this.t.text}s`, this.t.pos, 'AP CSA does not use these. Write a class instead.');
    if (!this.is('class')) {
      if (this.t.kind === 'eof') this.eof();
      this.stop(
        'expected-class',
        'class, interface, enum, or record expected',
        this.t.pos,
        this.is('}') ? 'There is an extra } here. Your class already closed before this line. Match each { with one }.' : 'Everything in a Java file has to sit inside a class. This line is outside the class braces.',
      );
    }
    const pos = this.t.pos;
    this.i++;
    const name = this.ident();
    if (mods.isAbstract) this.stop('unsupported', 'this editor does not run abstract classes', pos);
    if (this.is('<')) this.stop('unsupported', 'this editor does not run generic classes', this.t.pos);
    if (this.is('extends') || this.is('implements')) {
      this.stop('unsupported', `this editor does not run classes that use ${this.t.text}`, this.t.pos, 'This lab writes classes that stand on their own. Delete this part of the class header.');
    }
    const cls: ClassDecl = { name: name.text, isPublic: mods.access === 'public', file: this.file, pos: name.pos, fields: [], ctors: [], methods: [] };
    this.expect('{');
    while (!this.is('}')) {
      if (this.t.kind === 'eof') this.eof();
      if (this.accept(';')) continue;
      this.member(cls);
    }
    this.i++;
    return cls;
  }

  private member(cls: ClassDecl): void {
    const start = this.t.pos;
    const mods = this.modifiers();
    if (this.is('class') || this.is('interface') || this.is('enum')) this.stop('unsupported', 'this editor does not run a class inside a class', this.t.pos, 'Put each class in its own file, in its own tab.');
    if (this.is('{')) this.stop('unsupported', 'this editor does not run initializer blocks', this.t.pos, 'Put this code in a constructor instead.');
    if (mods.isAbstract) this.stop('unsupported', 'this editor does not run abstract methods', start);
    const decl = { access: mods.access, isStatic: mods.isStatic, isOverride: mods.isOverride, overridePos: mods.overridePos };

    // A name followed by ( with nothing before it: a constructor, or a method with no return type.
    if (this.t.kind === 'id' && this.peek().text === '(') {
      const name = this.t;
      if (name.text !== cls.name) {
        this.stop(
          'no-return-type',
          'invalid method declaration; return type required',
          name.pos,
          `A method needs a return type before its name, such as void or int. If you meant a constructor, its name has to match the class exactly: ${cls.name}.`,
        );
      }
      this.i++;
      const params = this.params();
      this.throwsClause();
      const body = this.block();
      cls.ctors.push({ name: name.text, ret: null, params, ...decl, body, pos: name.pos });
      return;
    }

    if (this.t.kind !== 'id' && !(this.t.kind === 'kw' && (PRIMS.has(this.t.text) || UNSUPPORTED_PRIMS.has(this.t.text)))) {
      this.memberStartError();
    }
    const type = this.type();
    if (this.t.kind !== 'id') this.memberStartError(type);
    const name = this.t;
    if (this.peek().text === '(') {
      this.i += 1;
      const params = this.params();
      this.throwsClause();
      if (this.is(';')) this.stop('missing-body', 'missing method body, or declare abstract', name.pos, 'A method needs a body in braces. Replace the ; with { and }.');
      const body = this.block();
      const m: MethodDecl = { name: name.text, ret: type, params, ...decl, body, pos: name.pos };
      cls.methods.push(m);
      return;
    }
    // One or more fields.
    for (;;) {
      const n = this.ident();
      let dims = 0;
      while (this.is('[') && this.peek().text === ']') {
        this.i += 2;
        dims++;
      }
      const f: FieldDecl = { name: n.text, type: { ...type, dims: type.dims + dims }, access: mods.access, isStatic: mods.isStatic, isFinal: mods.isFinal, pos: n.pos };
      if (this.accept('=')) f.init = this.is('{') ? this.arrayInit() : this.expr();
      cls.fields.push(f);
      if (!this.accept(',')) break;
    }
    this.expect(';');
  }

  /** Something other than a field or method in a class body. Javac's message, and what it usually means. */
  private memberStartError(type?: TypeNode): never {
    const help =
      'Only instance variables, constructors, and methods can sit directly inside a class. Statements like this one go inside a constructor or a method.';
    if (type && (this.is('=') || this.is('.') || this.is('('))) this.stop('statement-in-class', '<identifier> expected', this.prevEnd, help);
    if (type) this.stop('expected-name', '<identifier> expected', this.prevEnd, 'Java expected a name after the type here.');
    if (this.is('}')) this.eof();
    return this.stop('illegal-type', 'illegal start of type', this.t.pos, help);
  }

  private params(): Param[] {
    this.expect('(');
    const out: Param[] = [];
    if (this.accept(')')) return out;
    for (;;) {
      this.accept('final');
      const type = this.paramType();
      const n = this.ident();
      let dims = 0;
      while (this.is('[') && this.peek().text === ']') {
        this.i += 2;
        dims++;
      }
      out.push({ name: n.text, type: { ...type, dims: type.dims + dims }, pos: n.pos });
      if (!this.accept(',')) break;
    }
    if (!this.is(')')) {
      if (this.t.kind === 'eof') this.eof();
      this.stop('expected', "',', ')', or '[' expected", this.t.pos, 'Parameters are a type and a name, split by commas: (String title, int year).');
    }
    this.i++;
    return out;
  }

  private paramType(): TypeNode {
    if (this.t.kind === 'kw' && !PRIMS.has(this.t.text) && !UNSUPPORTED_PRIMS.has(this.t.text)) this.stop('illegal-type', 'illegal start of type', this.t.pos);
    if (this.t.kind !== 'id' && this.t.kind !== 'kw') {
      if (this.t.kind === 'eof') this.eof();
      this.stop('expected-type', '<identifier> expected', this.prevEnd, 'Each parameter needs a type and then a name: (String title).');
    }
    const type = this.type();
    if (this.is('...')) this.stop('unsupported', 'this editor does not run varargs parameters', this.t.pos, 'Use an array parameter instead.');
    if (this.t.kind !== 'id' && (this.is(',') || this.is(')'))) {
      this.stop('expected-name', '<identifier> expected', this.prevEnd, 'A parameter needs a type and a name. This one has only one word: (String title), not (title).');
    }
    return type;
  }

  private throwsClause(): void {
    if (!this.accept('throws')) return;
    do this.ident();
    while (this.accept(','));
  }

  // --- types ---

  private type(): TypeNode {
    const t = this.t;
    if (t.kind === 'kw' && UNSUPPORTED_PRIMS.has(t.text)) this.stop('unsupported', `this editor does not run ${t.text} values`, t.pos, t.text === 'float' ? 'Use double instead.' : 'Use int instead.');
    let node: TypeNode;
    if (t.kind === 'kw' && PRIMS.has(t.text)) {
      this.i++;
      node = { name: t.text, args: [], dims: 0, pos: t.pos };
    } else {
      const n = this.ident();
      if (n.text === 'var') this.stop('unsupported', 'this editor does not run var', n.pos, 'Write the type out, such as int or String. AP CSA always names the type.');
      node = { name: n.text, args: [], dims: 0, pos: n.pos };
      while (this.is('.') && this.peek().kind === 'id') {
        // java.util.ArrayList: keep the last part.
        this.i++;
        node.name = this.ident().text;
      }
      if (this.is('<')) this.typeArgs(node);
    }
    while (this.is('[') && this.peek().text === ']') {
      this.i += 2;
      node.dims++;
    }
    return node;
  }

  private typeArgs(node: TypeNode): void {
    this.expect('<');
    if (this.accept('>')) {
      node.diamond = true;
      return;
    }
    do {
      if (this.is('?')) this.stop('unsupported', 'this editor does not run wildcard types', this.t.pos);
      node.args.push(this.type());
    } while (this.accept(','));
    const t = this.t;
    if (t.text === '>') this.i++;
    else if (t.kind === 'op' && t.text === '>>') {
      // Two closing brackets at once: ArrayList<ArrayList<String>>. Take one.
      this.toks[this.i] = { ...t, text: '>', pos: { ...t.pos, col: t.pos.col + 1 } };
    } else this.stop('expected', "'>' expected", t.pos);
  }

  /** From the current token: does a type and then a name come next? */
  private looksLikeLocal(): boolean {
    const t = this.t;
    if (t.kind === 'kw') return PRIMS.has(t.text) || UNSUPPORTED_PRIMS.has(t.text);
    if (t.kind !== 'id') return false;
    let j = this.i + 1;
    const at = (k: number) => this.toks[Math.min(k, this.toks.length - 1)];
    while (at(j).text === '.' && at(j + 1).kind === 'id') j += 2;
    if (at(j).text === '<') {
      let depth = 0;
      for (; j < this.toks.length; j++) {
        const x = at(j);
        if (x.text === '<') depth++;
        else if (x.text === '>') depth--;
        else if (x.text === '>>') depth -= 2;
        else if (x.kind !== 'id' && x.text !== ',' && x.text !== '[' && x.text !== ']' && !PRIMS.has(x.text) && x.text !== '.') return false;
        if (depth <= 0) break;
      }
      j++;
    }
    while (at(j).text === '[' && at(j + 1).text === ']') j += 2;
    return at(j).kind === 'id';
  }

  // --- statements ---

  block(): Block {
    const pos = this.expect('{').pos;
    const body: Stmt[] = [];
    while (!this.is('}')) {
      if (this.t.kind === 'eof') this.eof();
      body.push(this.stmt());
    }
    const endPos = this.t.pos;
    this.i++;
    return { k: 'block', pos, body, endPos };
  }

  private localDecl(isFinal: boolean, pos: Pos): Stmt {
    const type = this.type();
    if (type.name === 'void') this.stop('illegal-type', 'illegal start of expression', pos);
    const vars: LocalVar[] = [];
    for (;;) {
      const n = this.ident();
      let dims = 0;
      while (this.is('[') && this.peek().text === ']') {
        this.i += 2;
        dims++;
      }
      const v: LocalVar = { name: n.text, pos: n.pos, dims };
      if (this.accept('=')) v.init = this.is('{') ? this.arrayInit() : this.expr();
      vars.push(v);
      if (!this.accept(',')) break;
    }
    return { k: 'local', pos, type, vars, isFinal };
  }

  private stmt(): Stmt {
    const t = this.t;
    const pos = t.pos;
    if (t.kind === 'kw') {
      switch (t.text) {
        case 'if': {
          this.i++;
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          const a = this.stmt();
          const b = this.accept('else') ? this.stmt() : undefined;
          return { k: 'if', pos, c, a, b };
        }
        case 'else':
          return this.stop('else-without-if', "'else' without 'if'", pos, 'This else has no if right before it. Check for a stray ; after the if, or a missing { }.');
        case 'while': {
          this.i++;
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          return { k: 'while', pos, c, body: this.stmt() };
        }
        case 'do': {
          this.i++;
          const body = this.stmt();
          this.expect('while');
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          this.expect(';');
          return { k: 'do', pos, c, body };
        }
        case 'for':
          return this.forStmt();
        case 'return': {
          this.i++;
          const e = this.is(';') ? undefined : this.expr();
          this.expect(';');
          return { k: 'return', pos, e };
        }
        case 'break':
        case 'continue':
          this.i++;
          this.expect(';');
          return { k: t.text, pos };
        case 'throw': {
          this.i++;
          const e = this.expr();
          this.expect(';');
          return { k: 'throw', pos, e };
        }
        case 'switch':
          return this.stop('unsupported', 'this editor does not run switch', pos, 'Write this with if and else instead.');
        case 'try':
          return this.stop('unsupported', 'this editor does not run try and catch', pos, 'AP CSA does not use these. Use an if statement to check for the problem first.');
        case 'final': {
          this.i++;
          const s = this.localDecl(true, pos);
          this.expect(';');
          return s;
        }
        case 'public':
        case 'private':
        case 'protected':
        case 'static':
          return this.stop(
            'illegal-expr',
            'illegal start of expression',
            pos,
            'Java found public, private, or static inside a method, where they can\'t go. Local variables have none of these words. If you meant to start a new method, close the one above with a } first.',
          );
        case 'class':
          return this.stop('unsupported', 'this editor does not run a class inside a method', pos, 'Put each class in its own file, in its own tab.');
      }
    }
    if (this.is('{')) return this.block();
    if (this.accept(';')) return { k: 'empty', pos };
    if ((this.is('this') || this.is('super')) && this.peek().text === '(') {
      const which = t.text as 'this' | 'super';
      this.i++;
      const args = this.args();
      this.expect(';');
      return { k: 'ctorcall', pos, which, args };
    }
    if (t.kind === 'kw' && PRIMS.has(t.text) && this.peek().kind !== 'id' && this.peek().text !== '[') {
      const next = this.peek();
      this.stop(
        'not-a-statement',
        'not a statement',
        pos,
        next.kind === 'kw' ? `${next.text} is a word Java keeps for itself, so it can't be a variable name. Pick another name.` : 'A variable name goes after the type. A name starts with a letter, not a digit.',
      );
    }
    if (this.looksLikeLocal()) {
      const s = this.localDecl(false, pos);
      this.expect(';');
      return s;
    }
    const e = this.expr();
    if (e.k !== 'assign' && e.k !== 'incdec' && e.k !== 'call' && e.k !== 'new') {
      this.stop('not-a-statement', 'not a statement', e.pos, 'This line works out a value but does nothing with it. To keep the result, store it with =, as in total = total + 1;');
    }
    this.expect(';');
    return { k: 'expr', pos, e };
  }

  private forStmt(): Stmt {
    const pos = this.t.pos;
    this.i++;
    this.expect('(');
    // for (Type x : things)
    const save = this.i;
    this.accept('final');
    if (this.looksLikeLocal()) {
      const type = this.type();
      const n = this.ident();
      if (this.accept(':')) {
        const iter = this.expr();
        this.expect(')');
        return { k: 'foreach', pos, type, name: n.text, namePos: n.pos, iter, body: this.stmt() };
      }
    }
    this.i = save;
    const init: Stmt[] = [];
    if (!this.is(';')) {
      const isFinal = this.accept('final');
      if (isFinal || this.looksLikeLocal()) init.push(this.localDecl(isFinal, this.t.pos));
      else
        do {
          const e = this.expr();
          init.push({ k: 'expr', pos: e.pos, e });
        } while (this.accept(','));
    }
    this.expect(';');
    const c = this.is(';') ? undefined : this.expr();
    this.expect(';');
    const update: Expr[] = [];
    if (!this.is(')')) {
      do update.push(this.expr());
      while (this.accept(','));
    }
    this.expect(')');
    return { k: 'for', pos, init, c, update, body: this.stmt() };
  }

  // --- expressions ---

  expr(): Expr {
    const a = this.cond();
    if (this.t.kind === 'op' && ASSIGN_OPS.has(this.t.text)) {
      const op = this.t;
      this.i++;
      const value = this.expr();
      return { k: 'assign', pos: op.pos, op: op.text, target: a, value };
    }
    return a;
  }

  private cond(): Expr {
    const c = this.binary(1);
    if (!this.is('?')) return c;
    const pos = this.t.pos;
    this.i++;
    const a = this.expr();
    this.expect(':');
    const b = this.cond();
    return { k: 'cond', pos, c, a, b };
  }

  private binary(min: number): Expr {
    let a = this.unary();
    for (;;) {
      if (this.is('instanceof') && min <= 7) {
        const pos = this.t.pos;
        this.i++;
        a = { k: 'instanceof', pos, e: a, type: this.type() };
        continue;
      }
      const op = this.t;
      const prec = op.kind === 'op' ? PREC[op.text] : undefined;
      if (prec === undefined || prec < min) return a;
      this.i++;
      const b = this.binary(prec + 1);
      a = { k: 'binary', pos: op.pos, op: op.text, a, b };
    }
  }

  private unary(): Expr {
    const t = this.t;
    if (t.kind === 'op') {
      if (t.text === '++' || t.text === '--') {
        this.i++;
        return { k: 'incdec', pos: t.pos, op: t.text, prefix: true, e: this.unary() };
      }
      if (t.text === '-' && this.peek().kind === 'int' && this.peek().value === 2147483648) {
        this.i += 2;
        return this.postfix({ k: 'lit', lit: 'int', value: -2147483648, pos: t.pos });
      }
      if (t.text === '+' || t.text === '-' || t.text === '!' || t.text === '~') {
        this.i++;
        return { k: 'unary', pos: t.pos, op: t.text, e: this.unary() };
      }
      if (t.text === '(' && this.isCast()) {
        this.i++;
        const type = this.type();
        this.expect(')');
        return { k: 'cast', pos: t.pos, type, e: this.unary() };
      }
    }
    return this.postfix(this.primary());
  }

  private isCast(): boolean {
    const n = this.peek();
    if (n.kind === 'kw' && (PRIMS.has(n.text) || UNSUPPORTED_PRIMS.has(n.text))) {
      // (int) x, but not (int[]) which also counts.
      return true;
    }
    if (n.kind !== 'id') return false;
    // (Name) or (Name<...>) or (Name[]) followed by something that starts a value.
    let j = this.i + 2;
    const at = (k: number) => this.toks[Math.min(k, this.toks.length - 1)];
    if (at(j).text === '<') {
      let depth = 0;
      for (; j < this.toks.length; j++) {
        if (at(j).text === '<') depth++;
        else if (at(j).text === '>') depth--;
        else if (at(j).text === '>>') depth -= 2;
        else if (at(j).kind !== 'id' && at(j).text !== ',') return false;
        if (depth <= 0) break;
      }
      j++;
    }
    while (at(j).text === '[' && at(j + 1).text === ']') j += 2;
    if (at(j).text !== ')') return false;
    const after = at(j + 1);
    return after.kind === 'id' || after.kind === 'string' || after.kind === 'char' || after.kind === 'int' || after.kind === 'double' || after.kind === 'long' || after.text === '(' || after.text === '!' || after.text === '~' || (after.kind === 'kw' && ['this', 'new', 'true', 'false', 'null', 'super'].includes(after.text));
  }

  private args(): Expr[] {
    this.expect('(');
    const out: Expr[] = [];
    if (this.accept(')')) return out;
    do out.push(this.expr());
    while (this.accept(','));
    if (!this.is(')')) {
      if (this.t.kind === 'eof') this.eof();
      this.stop('expected', "')' or ',' expected", this.prevEnd, HELP[')']);
    }
    this.i++;
    return out;
  }

  private arrayInit(): Expr {
    const pos = this.expect('{').pos;
    const items: Expr[] = [];
    while (!this.is('}')) {
      items.push(this.is('{') ? this.arrayInit() : this.expr());
      if (!this.accept(',')) break;
    }
    this.expect('}');
    return { k: 'arrayinit', pos, items };
  }

  private postfix(start: Expr): Expr {
    let e = start;
    for (;;) {
      const t = this.t;
      if (t.kind !== 'op') return e;
      if (t.text === '.') {
        this.i++;
        const n = this.ident();
        if (this.is('(')) e = { k: 'call', pos: t.pos, target: e, name: n.text, args: this.args() };
        else e = { k: 'field', pos: t.pos, target: e, name: n.text };
      } else if (t.text === '[') {
        this.i++;
        const index = this.expr();
        this.expect(']');
        e = { k: 'index', pos: t.pos, target: e, index };
      } else if (t.text === '++' || t.text === '--') {
        this.i++;
        e = { k: 'incdec', pos: t.pos, op: t.text, prefix: false, e };
      } else return e;
    }
  }

  private primary(): Expr {
    const t = this.t;
    const pos = t.pos;
    switch (t.kind) {
      case 'int':
        if (t.value === 2147483648) this.stop('int-too-large', 'integer number too large', pos, 'An int can hold numbers up to 2147483647. This number is bigger than that.');
        this.i++;
        return { k: 'lit', lit: 'int', value: t.value as number, pos };
      case 'long':
        this.i++;
        return { k: 'lit', lit: 'long', value: t.value as number, pos };
      case 'double':
        this.i++;
        return { k: 'lit', lit: 'double', value: t.value as number, pos };
      case 'char':
        this.i++;
        return { k: 'lit', lit: 'char', value: t.value as number, pos };
      case 'string':
        this.i++;
        return { k: 'lit', lit: 'string', value: t.value as string, pos };
      case 'id':
        this.i++;
        if (this.is('(')) return { k: 'call', pos, target: null, name: t.text, args: this.args() };
        return { k: 'name', name: t.text, pos };
      case 'eof':
        return this.eof();
    }
    if (t.kind === 'kw') {
      switch (t.text) {
        case 'true':
        case 'false':
          this.i++;
          return { k: 'lit', lit: 'bool', value: t.text === 'true', pos };
        case 'null':
          this.i++;
          return { k: 'lit', lit: 'null', value: null, pos };
        case 'this':
          this.i++;
          return { k: 'this', pos };
        case 'super':
          this.stop('unsupported', 'this editor does not run super', pos, 'This lab writes classes that stand on their own, so they have no superclass to call.');
          break;
        case 'new':
          return this.newExpr();
      }
    }
    if (this.is('(')) {
      this.i++;
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (t.kind === 'kw' && PRIMS.has(t.text)) {
      this.i++;
      return this.stop('dot-class', "'.class' expected", this.t.pos, `Leave out the type here. ${t.text} belongs in a declaration, not in a value or a method call.`);
    }
    return this.stop('illegal-expr', 'illegal start of expression', pos, 'Java expected a value here, like a number, a variable, or a method call. Look for a missing value or an extra symbol.');
  }

  private newExpr(): Expr {
    const pos = this.t.pos;
    this.i++;
    const t = this.t;
    let type: TypeNode;
    if (t.kind === 'kw' && (PRIMS.has(t.text) || UNSUPPORTED_PRIMS.has(t.text))) {
      if (UNSUPPORTED_PRIMS.has(t.text)) this.stop('unsupported', `this editor does not run ${t.text} values`, t.pos);
      this.i++;
      type = { name: t.text, args: [], dims: 0, pos: t.pos };
    } else {
      const n = this.ident();
      type = { name: n.text, args: [], dims: 0, pos: n.pos };
      while (this.is('.') && this.peek().kind === 'id') {
        this.i++;
        type.name = this.ident().text;
      }
      if (this.is('<')) this.typeArgs(type);
    }
    if (this.is('[')) {
      const sizes: Expr[] = [];
      let extra = 0;
      while (this.is('[')) {
        this.i++;
        if (this.accept(']')) {
          extra++;
          continue;
        }
        if (extra) this.stop('expected', "']' expected", this.t.pos);
        sizes.push(this.expr());
        this.expect(']');
      }
      let init: Expr | undefined;
      if (this.is('{')) {
        if (sizes.length) this.stop('expected', "';' expected", this.t.pos, HELP[';']);
        init = this.arrayInit();
      } else if (!sizes.length) this.stop('array-size', 'array dimension missing', pos, 'Say how long the array is: new int[10].');
      return { k: 'newarray', pos, elem: type, sizes, extra, init };
    }
    if (!this.is('(')) {
      if (this.t.kind === 'eof') this.eof();
      this.stop('expected', "'(' or '[' expected", this.t.pos, 'After new and the class name comes a list of values in parentheses: new Song("Hello", 3).');
    }
    return { k: 'new', pos, type, args: this.args() };
  }
}

export function parseFile(file: string, src: string): FileAst {
  return new Parser(file, src).parseFile();
}
