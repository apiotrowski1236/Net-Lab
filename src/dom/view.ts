import { parseSelector, selectAll } from './select';
import { parseStyle } from './style';
import { innerHtml, outerHtml, textOf, type DomDocument, type DomElement } from './tree';
import type { FirstOfMany } from './notes';

/** One element, as a check reads it. */
export class PageNode {
  constructor(readonly el: DomElement) {}

  get tag(): string {
    return this.el.tag;
  }
  get id(): string {
    return this.el.attrs.get('id') ?? '';
  }
  get classes(): string[] {
    return (this.el.attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
  }
  /** Its text, with the spaces tidied. */
  get text(): string {
    return tidy(textOf(this.el));
  }
  get html(): string {
    return innerHtml(this.el);
  }
  get outer(): string {
    return outerHtml(this.el);
  }
  /** Came from the student's HTML file, not from their script. */
  get original(): boolean {
    return this.el.original;
  }
  attr(name: string): string | undefined {
    return this.el.attrs.get(name);
  }
  /** An inline style, by its CSS name. `background-color` also looks in `background`. */
  style(prop: string): string {
    const m = parseStyle(this.el.attrs.get('style') ?? '');
    return m.get(prop)?.value ?? (prop === 'background-color' ? (m.get('background')?.value ?? '') : '');
  }
  all(selector: string): PageNode[] {
    return selectAll(this.el, parseSelector(selector)).map((e) => new PageNode(e));
  }
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The page at the end of a run, for checks. Reading the result and not the code
 * means `textContent`, `innerHTML`, and `append` all pass, the way they all work
 * in a browser. A selector here is the lab author's, so a bad one throws.
 */
export class PageView {
  constructor(
    private readonly doc: DomDocument,
    /** Each `querySelector` that found the first of several matches. */
    readonly firstOfMany: readonly FirstOfMany[],
  ) {}

  all(selector: string): PageNode[] {
    return selectAll(this.doc, parseSelector(selector)).map((e) => new PageNode(e));
  }
  find(selector: string): PageNode | undefined {
    return this.all(selector)[0];
  }
  count(selector: string): number {
    return this.all(selector).length;
  }
  exists(selector: string): boolean {
    return this.count(selector) > 0;
  }
  /** The first match's text, or '' if nothing matches. */
  text(selector: string): string {
    return this.find(selector)?.text ?? '';
  }
  texts(selector: string): string[] {
    return this.all(selector).map((n) => n.text);
  }
  attr(selector: string, name: string): string | undefined {
    return this.find(selector)?.attr(name);
  }
  style(selector: string, prop: string): string {
    return this.find(selector)?.style(prop) ?? '';
  }
  /** What to tell a student whose `querySelector` found the first of several, or undefined. For a step that wanted every match. */
  firstOnly(): string | undefined {
    const hit = this.firstOfMany[0];
    if (!hit) return undefined;
    return `\`querySelector("${hit.selector}")\` finds only the first match, and this page has ${hit.matches}. Use \`querySelectorAll\` and a loop to reach all of them.`;
  }
  /** The whole page, as `document.documentElement.outerHTML` gives it. */
  get html(): string {
    return outerHtml(this.doc.root);
  }
  /** Elements on the page that the script made. */
  get made(): number {
    return this.all('*').filter((n) => !n.original).length;
  }
}
