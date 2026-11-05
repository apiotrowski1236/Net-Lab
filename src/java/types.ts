import type { ClassDecl, FieldDecl, MethodDecl } from './ast';

/** A Java type, as the checker sees it. */
export type JType =
  | { k: 'int' }
  | { k: 'long' }
  | { k: 'double' }
  | { k: 'boolean' }
  | { k: 'char' }
  | { k: 'void' }
  | { k: 'null' }
  /** An expression that already has an error. It fits anywhere, so one mistake gives one message. */
  | { k: 'error' }
  | { k: 'class'; name: string; args: JType[] }
  | { k: 'array'; of: JType };

export const INT: JType = { k: 'int' };
export const LONG: JType = { k: 'long' };
export const DOUBLE: JType = { k: 'double' };
export const BOOLEAN: JType = { k: 'boolean' };
export const CHAR: JType = { k: 'char' };
export const VOID: JType = { k: 'void' };
export const NULL: JType = { k: 'null' };
export const ERROR: JType = { k: 'error' };
export const cls = (name: string, args: JType[] = []): JType => ({ k: 'class', name, args });
export const arr = (of: JType): JType => ({ k: 'array', of });
export const STRING = cls('String');
export const OBJECT = cls('Object');

/** A type's name as javac writes it. */
export function typeName(t: JType): string {
  switch (t.k) {
    case 'class':
      return t.args.length ? `${t.name}<${t.args.map(typeName).join(',')}>` : t.name;
    case 'array':
      return `${typeName(t.of)}[]`;
    case 'null':
      return '<null>';
    case 'error':
      return '<any>';
    default:
      return t.k;
  }
}

export const isNumeric = (t: JType) => t.k === 'int' || t.k === 'long' || t.k === 'double' || t.k === 'char';
export const isPrimitive = (t: JType) => isNumeric(t) || t.k === 'boolean';
export const isRef = (t: JType) => t.k === 'class' || t.k === 'array' || t.k === 'null';
export const isStr = (t: JType) => t.k === 'class' && t.name === 'String';

/** The wrapper class of each primitive, and back. */
export const BOX: Record<string, string> = { int: 'Integer', long: 'Long', double: 'Double', boolean: 'Boolean', char: 'Character' };
export const UNBOX: Record<string, JType> = { Integer: INT, Long: LONG, Double: DOUBLE, Boolean: BOOLEAN, Character: CHAR };

export interface FieldInfo {
  name: string;
  type: JType;
  owner: string;
  isStatic: boolean;
  isFinal: boolean;
  access: FieldDecl['access'];
  decl: FieldDecl;
}

export interface MethodInfo {
  name: string;
  params: JType[];
  ret: JType;
  owner: string;
  isStatic: boolean;
  access: MethodDecl['access'];
  decl: MethodDecl;
}

export interface UserClass {
  name: string;
  decl: ClassDecl;
  fields: Map<string, FieldInfo>;
  methods: Map<string, MethodInfo[]>;
  ctors: MethodInfo[];
}

/** One method or constructor of a library class. `run` gets the receiver, the arguments, and the running program. */
export interface LibMember {
  name: string;
  params: JType[];
  /** The declared parameters, when `params` had a type argument filled in. */
  erased?: JType[];
  ret: JType;
  isStatic: boolean;
  owner: string;
  /** Any number of Objects after `params` (printf). */
  varargs?: boolean;
  run: (self: any, args: any[], rt: any) => unknown;
}
