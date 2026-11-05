import type { Pos } from './errors';
import type { JType } from './types';
import type { FieldInfo, LibMember, MethodInfo } from './types';

export type Access = 'public' | 'private' | 'protected' | 'package';

export interface TypeNode {
  name: string;
  args: TypeNode[];
  /** `new ArrayList<>()`. */
  diamond?: boolean;
  dims: number;
  pos: Pos;
}

export interface Param {
  name: string;
  type: TypeNode;
  pos: Pos;
}

export interface FieldDecl {
  name: string;
  type: TypeNode;
  access: Access;
  isStatic: boolean;
  isFinal: boolean;
  init?: Expr;
  pos: Pos;
}

export interface MethodDecl {
  name: string;
  /** null for a constructor. */
  ret: TypeNode | null;
  params: Param[];
  access: Access;
  isStatic: boolean;
  isOverride: boolean;
  /** Where @Override is written. */
  overridePos?: Pos;
  body: Block;
  pos: Pos;
  /** Filled in by the checker: how many local variable slots a call needs, and each one's name. */
  slotNames?: string[];
}

export interface ClassDecl {
  name: string;
  isPublic: boolean;
  file: string;
  pos: Pos;
  fields: FieldDecl[];
  ctors: MethodDecl[];
  methods: MethodDecl[];
}

export interface FileAst {
  file: string;
  imports: { name: string; pos: Pos }[];
  classes: ClassDecl[];
}

export interface Block {
  k: 'block';
  pos: Pos;
  body: Stmt[];
  endPos: Pos;
  /** Slots declared directly in this block, cleared when it ends so the step-through shows only what's in scope. */
  from?: number;
  to?: number;
}

export interface LocalVar {
  name: string;
  pos: Pos;
  dims: number;
  init?: Expr;
  slot?: number;
  ty?: JType;
}

export type Stmt =
  | Block
  | { k: 'local'; pos: Pos; type: TypeNode; vars: LocalVar[]; isFinal: boolean }
  | { k: 'expr'; pos: Pos; e: Expr }
  | { k: 'if'; pos: Pos; c: Expr; a: Stmt; b?: Stmt }
  | { k: 'while'; pos: Pos; c: Expr; body: Stmt }
  | { k: 'do'; pos: Pos; c: Expr; body: Stmt }
  | { k: 'for'; pos: Pos; init: Stmt[]; c?: Expr; update: Expr[]; body: Stmt; from?: number; to?: number }
  | { k: 'foreach'; pos: Pos; type: TypeNode; name: string; namePos: Pos; iter: Expr; body: Stmt; slot?: number; unbox?: boolean; box?: string }
  | { k: 'return'; pos: Pos; e?: Expr }
  | { k: 'break'; pos: Pos }
  | { k: 'continue'; pos: Pos }
  | { k: 'throw'; pos: Pos; e: Expr }
  | { k: 'empty'; pos: Pos }
  | { k: 'ctorcall'; pos: Pos; which: 'this' | 'super'; args: Expr[]; m?: MethodInfo };

export type BinMode = 'str' | 'int' | 'long' | 'double' | 'and' | 'or' | 'bool' | 'ref';

/** What a plain name turned out to be. */
export type NameRef = { to: 'local'; slot: number } | { to: 'field'; f: FieldInfo } | { to: 'static'; f: FieldInfo } | { to: 'class'; name: string };

export type Expr = { pos: Pos; ty?: JType } & (
  | { k: 'lit'; lit: 'int' | 'long' | 'double' | 'bool' | 'char' | 'string' | 'null'; value: number | boolean | string | null }
  | { k: 'name'; name: string; ref?: NameRef }
  /** `a.b`. `ref` also covers `arr.length` and library constants like Integer.MAX_VALUE. */
  | { k: 'field'; target: Expr; name: string; ref?: { to: 'field' | 'static'; f: FieldInfo } | { to: 'length' } | { to: 'lib'; value: () => unknown } | { to: 'class'; name: string } }
  | { k: 'call'; target: Expr | null; name: string; args: Expr[]; user?: MethodInfo; lib?: LibMember; superCall?: boolean }
  | { k: 'new'; type: TypeNode; args: Expr[]; user?: MethodInfo; cls?: string; lib?: LibMember }
  | { k: 'newarray'; elem: TypeNode; sizes: Expr[]; extra: number; init?: Expr }
  | { k: 'arrayinit'; items: Expr[] }
  | { k: 'index'; target: Expr; index: Expr }
  | { k: 'unary'; op: '+' | '-' | '!' | '~'; e: Expr }
  | { k: 'incdec'; op: '++' | '--'; prefix: boolean; e: Expr }
  | { k: 'binary'; op: string; a: Expr; b: Expr; mode?: BinMode }
  | { k: 'assign'; op: string; target: Expr; value: Expr; mode?: BinMode }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'cast'; type: TypeNode; e: Expr }
  | { k: 'instanceof'; e: Expr; type: TypeNode }
  | { k: 'this' }
  /** Added by the checker where a value has to change form: an int into an Integer, or back. */
  | { k: 'conv'; e: Expr; box: string | null }
);
