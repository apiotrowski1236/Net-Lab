import type { JsError, LintNote, Runtime } from '../js';
import { closestName } from '../js/help';
import { CSS_PROPERTIES, camelProperties, cssName } from './style';
import { allElements, isConnected, rootOf, textOf, type DomDocument, type DomElement, type DomNode, type DomParent } from './tree';

/**
 * The mistakes a browser lets pass. `el.textcontent = "x"` is a legal line that
 * changes nothing, and a beginner can stare at it for an hour. The page keeps a
 * log as the program runs, turns it into notes when the run ends, and rewrites
 * the help on an error, so "Cannot set properties of null" can name the ids that
 * do exist. Rule ids, for `lintOff`, are in PAGE_RULES.
 */
export const PAGE_RULES = ['id-with-hash', 'class-with-dot', 'class-no-rule', 'selector-no-prefix', 'selector-nothing', 'not-a-property', 'style-unknown', 'style-bad-value', 'never-added', 'list-property', 'moved-same-element', 'tags-as-text', 'element-as-text', 'handler-called'] as const;

interface Place {
  file: string;
  line: number;
}

/** A search that found nothing. */
interface Lookup extends Place {
  how: string;
  query: string;
}

/** A read of something a list doesn't have, like `list.style`. */
interface ListRead extends Place {
  name: string;
  source: string;
}

/** A `querySelector` that found the first of several matches. */
export interface FirstOfMany extends Place {
  selector: string;
  matches: number;
}

const DOCUMENT_METHODS = ['getElementById', 'getElementsByClassName', 'getElementsByTagName', 'querySelector', 'querySelectorAll', 'createElement', 'createTextNode'];
const ELEMENT_METHODS = ['appendChild', 'append', 'prepend', 'removeChild', 'remove', 'querySelector', 'querySelectorAll', 'getAttribute', 'setAttribute', 'addEventListener'];
const PROPERTIES = ['textContent', 'innerHTML', 'id', 'className', 'classList', 'style', 'children', 'parentElement', 'tagName', 'src', 'href', 'alt'];

/** Names a beginner reaches for, with what they meant. */
const MEANT: Record<string, string> = { class: 'className', classname: 'className', text: 'textContent', innertext: 'innerText', html: 'innerHTML', content: 'textContent', color: 'style.color', background: 'style.background', backgroundColor: 'style.backgroundColor', fontSize: 'style.fontSize', font: 'style.font', width: 'style.width', height: 'style.height' };

/** The right name for a property that an element doesn't have, or undefined if this isn't near one. */
export function meantProperty(name: string, known: readonly string[]): string | undefined {
  if (Object.prototype.hasOwnProperty.call(MEANT, name)) return MEANT[name];
  const camel = name.includes('-') ? '' : cssName(name);
  if (camel && CSS_PROPERTIES.has(camel) && camel !== 'content') return `style.${name}`;
  return closestName(name, known);
}

const quote = (s: string) => `"${s}"`;

function listNames(names: string[]): string {
  const shown = names.slice(0, 10).join(', ');
  return names.length > 10 ? `${shown}, and ${names.length - 10} more` : shown;
}

const idsOn = (doc: DomDocument): string[] => [...new Set(allElements(doc).flatMap((e) => (e.attrs.get('id') ? [e.attrs.get('id')!] : [])))];
const classesOn = (doc: DomDocument): string[] => [...new Set(allElements(doc).flatMap((e) => (e.attrs.get('class') ?? '').split(/\s+/).filter(Boolean)))];

/** Plain words for a search that found nothing. */
function foundNothing(doc: DomDocument, l: Lookup): string {
  const q = l.query;
  const call = `${l.how}(${quote(q)})`;
  const ids = idsOn(doc);
  const classes = classesOn(doc);
  if (l.how === 'getElementById') {
    const bare = q.replace(/^[#.]/, '');
    if (q !== bare && ids.includes(bare)) return `${call} found no element. getElementById takes the id alone, and the ${q[0]} belongs only in a CSS selector. Write getElementById(${quote(bare)}).`;
    const near = closestName(bare, ids);
    const list = ids.length ? `The ids on this page are ${listNames(ids)}.` : 'No element on this page has an id.';
    return `${call} found no element, so it gave back null. ${list}${near ? ` Did you mean ${quote(near)}?` : ''}`;
  }
  const hash = /^#([\w-]+)$/.exec(q);
  if (hash) {
    const near = closestName(hash[1], ids);
    const list = ids.length ? `The ids on this page are ${listNames(ids)}.` : 'No element on this page has an id.';
    return `${call} found no element, so it gave back null. ${list}${near ? ` Did you mean ${quote(`#${near}`)}?` : ''}`;
  }
  const dot = /^\.([\w-]+)$/.exec(q);
  if (dot) {
    if (!classes.includes(dot[1]) && allElements(doc).some((e) => e.tag === dot[1])) return `${call} looks for the class ${dot[1]}, and no element has it. To find <${dot[1]}> tags, write ${quote(dot[1])} with no dot.`;
    const near = closestName(dot[1], classes);
    const list = classes.length ? `The classes on this page are ${listNames(classes)}.` : 'No element on this page has a class.';
    return `${call} found no element, so it gave back null. ${list}${near ? ` Did you mean ${quote(`.${near}`)}?` : ''}`;
  }
  if (/^[a-zA-Z][\w-]*$/.test(q)) {
    if (ids.includes(q)) return `${call} looks for a <${q}> tag, and this page has none. An id needs a # in front, so write ${quote(`#${q}`)}.`;
    if (classes.includes(q)) return `${call} looks for a <${q}> tag, and this page has none. A class needs a dot in front, so write ${quote(`.${q}`)}.`;
    return `${call} looks for a <${q}> tag, and this page has none. For an id, put a # in front. For a class, put a dot in front.`;
  }
  return `${call} found no element, so it gave back null. Check the selector against the HTML.`;
}


export class PageLog {
  private readonly found = new Map<string, LintNote>();
  private readonly nulls: Lookup[] = [];
  private readonly lists: ListRead[] = [];
  private readonly made: (Place & { el: DomElement })[] = [];
  private readonly addedHere = new Map<DomNode, Map<number, { parent: DomParent; times: number; file: string }>>();
  /** Things that have been on the page, so taking one off isn't "never added". */
  private readonly placed = new Set<DomNode>();
  private readonly usedClasses: (Place & { name: string })[] = [];
  readonly firstOfMany: FirstOfMany[] = [];
  /** The last name read from a host that it doesn't have, for `x is not a function`. */
  private missed?: { on: 'document' | 'element' | 'list' | 'collection' | 'text'; name: string };
  /** The run ended on an error, so an element it made may be waiting for a line that never ran. */
  private cut = false;

  constructor(
    private readonly doc: () => DomDocument,
    private readonly files: readonly { name: string; text: string }[],
    private readonly rt: Runtime,
  ) {}

  private here(): Place {
    const { file, line } = this.rt.at();
    return { file, line };
  }

  note(rule: string, text: string): void {
    const at = this.here();
    const key = `${rule}:${at.file}:${at.line}`;
    if (!this.found.has(key)) this.found.set(key, { rule, ...at, text });
  }

  /** `getElementById("#title")`: a real search with no chance of working, which a null check would hide. */
  lookedUp(how: string, query: string, hit: boolean, doc: DomDocument): void {
    if (hit) return;
    const miss: Lookup = { how, query, ...this.here() };
    this.nulls.push(miss);
    if (how === 'getElementById' && /^[#.]/.test(query)) this.note('id-with-hash', foundNothing(doc, miss));
    else this.note('selector-nothing', foundNothing(doc, miss));
  }

  /** A list search that matched nothing, so the loop after it has nothing to do. */
  emptyList(how: string, query: string, doc: DomDocument): void {
    const place = this.here();
    const near = foundNothing(doc, { how, query, ...place }).replace('found no element, so it gave back null.', 'found no elements, so a loop over it has nothing to do.');
    this.note('selector-nothing', near);
  }

  /** `querySelector("title")` that landed on the `<title>` tag when the page has a `.title`. */
  bareTagHit(how: string, query: string, doc: DomDocument): void {
    const ids = idsOn(doc);
    const classes = classesOn(doc);
    const fix = classes.includes(query) ? quote(`.${query}`) : ids.includes(query) ? quote(`#${query}`) : undefined;
    if (fix) this.note('selector-no-prefix', `${how}(${quote(query)}) looks for a <${query}> tag, and it found one. If you meant the element with the ${classes.includes(query) ? `class ${query}` : `id ${query}`}, write ${fix}.`);
  }

  firstMatch(selector: string, matches: number): void {
    if (matches > 1) this.firstOfMany.push({ selector, matches, ...this.here() });
  }

  classWithDot(call: string, name: string): void {
    this.note('class-with-dot', `A class name has no dot here. The dot belongs only in a CSS selector. Write ${call}(${quote(name.slice(1))}).`);
  }

  /** The script gave an element this class. */
  classGiven(name: string): void {
    if (!name.startsWith('.')) this.usedClasses.push({ name, ...this.here() });
  }

  /** A class no CSS uses changes nothing on the page, which looks the same as code that didn't run. */
  private unruledClasses(): LintNote[] {
    const css = this.files.filter((f) => f.name.endsWith('.css'));
    if (!css.length) return [];
    const inline = allElements(this.doc()).flatMap((e) => (e.tag === 'style' ? [textOf(e)] : []));
    const known = new Set([...css.map((f) => f.text), ...inline].flatMap((t) => [...t.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])));
    if (!known.size) return [];
    const scripts = this.files.filter((f) => f.name.endsWith('.js')).map((f) => f.text);
    const out = new Map<string, LintNote>();
    for (const u of this.usedClasses) {
      // A class the script looks up again is a marker for the script, and needs no rule.
      if (known.has(u.name) || scripts.some((t) => t.includes(`.${u.name}"`) || t.includes(`.${u.name}'`))) continue;
      const near = closestName(u.name, known);
      const name = css[0].name;
      out.set(`${u.file}:${u.line}:${u.name}`, { rule: 'class-no-rule', file: u.file, line: u.line, text: `No rule in ${name} uses the class ${u.name}, so this class changes nothing on the page.${near ? ` Did you mean ${near}?` : ''}` });
    }
    return [...out.values()];
  }

  notProperty(name: string, meant: string): void {
    const caps = meant.toLowerCase() === name.toLowerCase();
    this.note('not-a-property', `An element has no property called ${name}, so nothing changed on the page. A browser gives no error for this. Did you mean ${meant}?${caps ? ' Capital and lowercase letters count in JavaScript.' : ''}`);
  }

  readMiss(name: string, meant: string): void {
    this.note('not-a-property', `An element has no property called ${name}, so reading it gives undefined. Did you mean ${meant}?${meant.toLowerCase() === name.toLowerCase() ? ' Capital and lowercase letters count in JavaScript.' : ''}`);
  }

  styleUnknown(name: string): void {
    const near = closestName(name, camelProperties());
    this.note('style-unknown', `${name} is not a CSS property, so nothing changed on the page. A browser gives no error for this.${near ? ` Did you mean style.${near}?` : ''}`);
  }

  styleBadColor(prop: string, value: string): void {
    this.note('style-bad-value', `${quote(value)} is not a color, so a browser ignores this line and ${prop} stays as it was.`);
  }

  styleNoUnit(prop: string, value: string): void {
    this.note('style-bad-value', `${prop} needs a unit, so a browser ignores ${value} with no error. Write ${quote(`${value}px`)}.`);
  }

  listProperty(name: string, kind: string): void {
    this.note('list-property', `${kind} gives a list of elements, not one element, so setting ${name} on the list changes nothing. A browser gives no error for this. Use a loop and set ${name} on each element.`);
  }

  /** `list.style`, read for a line that's about to fail. */
  listRead(name: string, source: string): void {
    this.lists.push({ name, source, ...this.here() });
  }

  miss(on: NonNullable<PageLog['missed']>['on'], name: string): void {
    this.missed = { on, name };
  }

  tagsAsText(prop: string): void {
    this.note('tags-as-text', `${prop} shows tags as plain text, so the page prints the angle brackets. To make the tags work, use innerHTML.`);
  }

  elementAsText(tagClass: string): void {
    this.note('element-as-text', `An element was joined into a string, so the page shows ${tagClass}. Add the element with appendChild, not with + or +=.`);
  }

  handlerCalled(): void {
    this.note('handler-called', 'addEventListener needs a function, and this line gave it something else. If you wrote the name of a function with () after it, take the () away, so the click calls it and this line does not.');
  }

  created(el: DomElement): void {
    this.made.push({ el, ...this.here() });
  }

  /** Something was just added to `parent`. */
  added(n: DomNode, parent: DomParent, wasThere: boolean): void {
    if (isConnected(n)) this.placed.add(n);
    if (n.kind !== 'element') return;
    const at = this.here();
    let lines = this.addedHere.get(n);
    if (!lines) this.addedHere.set(n, (lines = new Map()));
    const seen = lines.get(at.line);
    if (seen && seen.parent === parent && wasThere) {
      seen.times++;
      this.note('moved-same-element', `The same <${n.tag}> element was added ${seen.times} times, so it only moved, and one copy stayed on the page. Call createElement inside the loop, so each pass makes a new element.`);
      const note = this.found.get(`moved-same-element:${at.file}:${at.line}`);
      if (note) note.text = `The same <${n.tag}> element was added ${seen.times} times, so it only moved, and one copy stayed on the page. Call createElement inside the loop, so each pass makes a new element.`;
    } else lines.set(at.line, { parent, times: 1, file: at.file });
  }

  /** Something is about to come off the page. */
  removing(n: DomNode): void {
    if (isConnected(n)) this.placed.add(n);
  }

  private neverAdded(): LintNote[] {
    const out = new Map<string, LintNote>();
    for (const m of this.made) {
      const top = rootOf(m.el);
      if (top.kind === 'document' || top.kind === 'text' || top.kind === 'comment' || this.placed.has(top as DomNode)) continue;
      // The note goes on the outermost loose element: adding that one adds the rest.
      if (top !== m.el && top.kind === 'element') continue;
      const key = `${m.file}:${m.line}`;
      if (!out.has(key)) out.set(key, { rule: 'never-added', file: m.file, line: m.line, text: `The <${m.el.tag}> element made on this line never went on the page. Use appendChild to add it to an element that is on the page.` });
    }
    return [...out.values()];
  }

  notes(): LintNote[] {
    return [...this.found.values(), ...this.unruledClasses(), ...(this.cut ? [] : this.neverAdded())].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  }

  private lineOf(file: string, line: number): string {
    return this.files.find((f) => f.name === file)?.text.split('\n')[line - 1] ?? '';
  }

  /** The search behind a null: on the failing line, or the one that set the variable, or else the latest. */
  private lookupFor(e: JsError): Lookup | undefined {
    const onLine = this.nulls.filter((l) => l.file === e.pos.file && l.line === e.pos.line).at(-1);
    if (onLine) return onLine;
    const name = /^([\w$]+) is null,/.exec(e.help ?? '')?.[1];
    if (name) {
      const set = new RegExp(`(?:^|[^\\w$.])${name.replace(/\$/g, '\\$')}\\s*=[^=]`);
      const hit = [...this.nulls].reverse().find((l) => set.test(this.lineOf(l.file, l.line)));
      if (hit) return hit;
    }
    return this.nulls.at(-1);
  }

  private drop(rule: string, e: JsError): void {
    this.found.delete(`${rule}:${e.pos.file}:${e.pos.line}`);
  }

  explainNull(e: JsError): string | undefined {
    const l = this.lookupFor(e);
    if (!l) return undefined;
    this.found.delete(`id-with-hash:${l.file}:${l.line}`);
    this.found.delete(`selector-nothing:${l.file}:${l.line}`);
    return foundNothing(this.doc(), l);
  }

  private explainList(e: JsError): string | undefined {
    const r = [...this.lists].reverse().find((l) => l.file === e.pos.file && l.line === e.pos.line);
    if (!r) return undefined;
    return `${r.source} gives a list of elements, not one element, so the list has no ${r.name}. Use a loop, and use ${r.name} on each element.`;
  }

  private explainNotFunction(e: JsError): string | undefined {
    const m = /(?:^|\.)([\w$]+) is not a function$/.exec(e.msg);
    if (!m) return undefined;
    const name = m[1];
    const missed = this.missed?.name === name ? this.missed : undefined;
    this.drop('not-a-property', e);
    if (missed?.on === 'list' || missed?.on === 'collection') {
      if (missed.on === 'collection' && name === 'forEach') return 'getElementsByClassName and children give a collection, which has no forEach. Use a for loop with an index, or use querySelectorAll.';
      if (PROPERTIES.includes(name) || ELEMENT_METHODS.includes(name)) return `A list of elements has no ${name} of its own. Use a loop and call ${name} on each element.`;
      return `A list of elements is not an array, so it has no ${name}. Use a for loop with an index.`;
    }
    if (name === 'getElementsById') return 'document has no method called getElementsById. An id belongs to one element, so the name has no s: getElementById.';
    if (/^getElements?ByClass$/.test(name)) return `document has no method called ${name}. To find elements by class, use document.querySelectorAll(".name") for all of them, or document.querySelector(".name") for the first one.`;
    if (name === 'getElementByClassName') return 'document has no method called getElementByClassName. A class can be on many elements, so the name has an s: getElementsByClassName. It gives a list.';
    if (missed?.on === 'document' || missed?.on === 'element') {
      const names = missed.on === 'document' ? DOCUMENT_METHODS : ELEMENT_METHODS;
      const near = closestName(name, names);
      const who = missed.on === 'document' ? 'document' : 'An element';
      if (near) return `${who} has no method called ${name}. Did you mean ${near}?${near.toLowerCase() === name.toLowerCase() ? ' Capital and lowercase letters count in JavaScript.' : ''}`;
      return undefined;
    }
    // A value that isn't a page element.
    if (ELEMENT_METHODS.includes(name) && !this.isProperty(e)) return `${e.msg.replace(/ is not a function$/, '').replace(/\.[\w$]+$/, '')} is not an element, so it has no ${name}. Elements come from document.getElementById, document.querySelector, and document.createElement.`;
    if (this.isProperty(e)) return `${name} is a property, not a method, so it takes no parentheses. Set it with an equals sign, like this: ${e.msg.replace(/ is not a function$/, '')} = "new value";`;
    return undefined;
  }

  private isProperty(e: JsError): boolean {
    const name = /(?:^|\.)([\w$]+) is not a function$/.exec(e.msg)?.[1] ?? '';
    return ['textContent', 'innerHTML', 'innerText', 'id', 'className', 'src', 'href', 'alt', 'title'].includes(name) || /\.style\.[\w$]+ is not a function$/.test(e.msg);
  }

  private explainNotDefined(e: JsError): string | undefined {
    const name = /^([\w$]+) is not defined$/.exec(e.msg)?.[1];
    if (!name) return undefined;
    if (DOCUMENT_METHODS.includes(name)) return `${name} belongs to document, so write document.${name}.`;
    if (name.toLowerCase() === 'document') return 'The name for the page is document, in all lowercase letters.';
    const line = this.lineOf(e.pos.file, e.pos.line);
    const safe = name.replace(/\$/g, '\\$');
    const asArgument = new RegExp(`\\.(?:getElementById|getElementsByClassName|getElementsByTagName|querySelector|querySelectorAll|createElement|createTextNode|add|remove|toggle|contains|setAttribute|setProperty)\\([^)]*\\b${safe}\\b`);
    const asStyle = new RegExp(`\\.style\\.[\\w$]+\\s*=\\s*${safe}\\b`);
    if (asArgument.test(line) || asStyle.test(line)) return `${name} has no quotes, so JavaScript looks for a variable called ${name}. Text goes in quotes, so write ${quote(name)}.`;
    return undefined;
  }

  /** Better help for an error, if the page can say more. */
  explain(e: JsError): string | undefined {
    this.cut = true;
    if (e.code === 'set-undefined' || e.code === 'read-undefined') return e.msg.includes('of null') ? this.explainNull(e) : this.explainList(e);
    if (e.code === 'not-a-function') return this.explainNotFunction(e);
    if (e.code === 'not-defined') return this.explainNotDefined(e);
    if (e.code === 'not-available' && e.msg.startsWith('document.write')) return 'document.write replaces the whole page in a real browser, so it is left out here. Find an element and set its textContent, or make one with createElement and add it with appendChild.';
    return undefined;
  }
}

