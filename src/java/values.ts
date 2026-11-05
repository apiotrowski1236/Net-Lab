import type { JType } from './types';

/**
 * What a running program holds. An int, long, double, or char is a JavaScript
 * number and a boolean is a boolean: the checker knows which, so nothing here
 * has to tag them. null is null. Everything else is one of these objects, so
 * `==` on two references is `===`, as in Java.
 */

/** A String. A class and not a JavaScript string, so `==` compares references: the classic String bug behaves as it does in Java. */
export class JStr {
  constructor(readonly v: string) {}
}

export class JObj {
  readonly fields: Record<string, unknown> = {};
  constructor(
    readonly cls: string,
    readonly id: number,
  ) {}
}

export class JArr {
  constructor(
    readonly elem: JType,
    readonly items: unknown[],
    readonly id: number,
  ) {}
}

export class JList {
  items: unknown[] = [];
  /** Counts changes, so a for-each loop can notice the list changing under it. */
  mods = 0;
  constructor(readonly id: number) {}
}

/** An Integer, Double, Boolean, Character, or Long. */
export class JBox {
  constructor(
    readonly box: string,
    readonly v: number | boolean,
  ) {}
}

export interface StackLine {
  cls: string;
  method: string;
  file: string;
  line: number;
}

/** An exception object. */
export class JExc {
  constructor(
    readonly cls: string,
    readonly msg: string | null,
    readonly at: StackLine[],
    readonly id: number,
  ) {}
}

/** A Java exception on its way up the stack. */
export class Thrown {
  constructor(readonly exc: JExc) {}
}

/** The package of the library exceptions outside java.lang. */
const UTIL_EXC = new Set(['IllegalFormatConversionException', 'MissingFormatArgumentException', 'UnknownFormatConversionException', 'ConcurrentModificationException', 'NoSuchElementException']);
export const excName = (cls: string) => `java.${UTIL_EXC.has(cls) ? 'util' : 'lang'}.${cls}`;
