import { HostObject, type PageHooks, type Runtime, type Value } from '../js';
import { arrayIndex, isCallable } from '../js/values';
import { parseFragment, parseHtml } from './html';
import { PageLog, meantProperty } from './notes';
import { pageState, type PageState, type SourceText } from './preview';
import { BadSelector, LeftOutSelector, bareTag, matches, parseSelector, selectAll, type Selector } from './select';
import { CSS_PROPERTIES, cssName, parseStyle, readValue, serializeStyle } from './style';
import { DomComment, DomDocument, DomElement, DomFragment, DomText, allElements, detach, elementsIn, innerHtml, insert, isConnected, outerHtml, parentElement, textOf, walkElements, type DomNode, type DomParent } from './tree';
import { PageView } from './view';

/**
 * The JavaScript face of the page: `document`, elements, lists, and `style`.
 * Student code reaches the tree in tree.ts only through these classes. Where a
 * browser answers a misspelled name with undefined and goes on, these do the
 * same and leave a note in the log, and a name a browser has that this file
 * leaves out stops with "not available in this editor".
 */

/** Past this a loop has gone wrong, and the preview would crawl. A 100 by 100 grid fits. */
const MAX_ELEMENTS = 12_000;

type Holder = DomElement | DomDocument;
interface Listener {
  type: string;
  fn: Value;
  /** From `el.onclick = f`: there's one, and setting it again replaces it. */
  slot?: boolean;
}

const ELEMENT_INTERFACE: Record<string, string> = { a: 'Anchor', area: 'Area', audio: 'Audio', body: 'Body', br: 'BR', button: 'Button', canvas: 'Canvas', div: 'Div', dl: 'DList', form: 'Form', h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading', head: 'Head', hr: 'HR', html: 'Html', iframe: 'IFrame', img: 'Image', input: 'Input', label: 'Label', li: 'LI', link: 'Link', ol: 'OList', option: 'Option', p: 'Paragraph', pre: 'Pre', script: 'Script', select: 'Select', span: 'Span', style: 'Style', table: 'Table', tbody: 'TableSection', td: 'TableCell', textarea: 'TextArea', tfoot: 'TableSection', th: 'TableCell', thead: 'TableSection', title: 'Title', tr: 'TableRow', ul: 'UList', video: 'Video' };

const interfaceOf = (e: DomElement) => (e.ns === 'svg' ? 'SVGElement' : `HTML${ELEMENT_INTERFACE[e.tag] ?? ''}Element`);

/** Properties that are one attribute by another name. */
const REFLECT: Record<string, string> = { id: 'id', className: 'class', title: 'title', lang: 'lang', dir: 'dir' };
/** The same, for only some tags. A `src` on a `<div>` is a loose property in a browser, and does nothing. */
const REFLECT_ON: Record<string, { attr: string; tags: string[] }> = {
  src: { attr: 'src', tags: ['img', 'audio', 'video', 'source', 'iframe', 'embed', 'input', 'track', 'script'] },
  href: { attr: 'href', tags: ['a', 'area', 'link', 'base'] },
  alt: { attr: 'alt', tags: ['img', 'area', 'input'] },
  value: { attr: 'value', tags: ['input', 'button', 'option', 'li', 'data', 'meter', 'progress', 'param'] },
  type: { attr: 'type', tags: ['input', 'button', 'ol', 'link', 'script', 'source', 'style'] },
  name: { attr: 'name', tags: ['input', 'button', 'select', 'textarea', 'form', 'iframe', 'meta', 'a', 'img'] },
  placeholder: { attr: 'placeholder', tags: ['input', 'textarea'] },
  rel: { attr: 'rel', tags: ['a', 'area', 'link'] },
  target: { attr: 'target', tags: ['a', 'area', 'base', 'form'] },
  width: { attr: 'width', tags: ['img', 'canvas', 'video', 'iframe', 'embed', 'table', 'td', 'th'] },
  height: { attr: 'height', tags: ['img', 'canvas', 'video', 'iframe', 'embed'] },
};
/** On or off by an attribute being there at all. */
const BOOLEANS: Record<string, string> = { hidden: 'hidden', disabled: 'disabled', checked: 'checked', required: 'required', readOnly: 'readonly' };

const NODE_GET = ['parentNode', 'parentElement', 'nextSibling', 'previousSibling', 'nextElementSibling', 'previousElementSibling', 'isConnected', 'nodeType', 'nodeName', 'nodeValue'];
const PARENT_GET = ['children', 'childNodes', 'firstChild', 'lastChild', 'firstElementChild', 'lastElementChild', 'childElementCount'];
const NODE_CALL = ['remove', 'before', 'after', 'replaceWith', 'cloneNode'];
const PARENT_CALL = ['appendChild', 'append', 'prepend', 'removeChild', 'insertBefore', 'replaceChild', 'replaceChildren', 'querySelector', 'querySelectorAll', 'hasChildNodes', 'contains'];

const ELEMENT_ALLOW = {
  get: [...NODE_GET, ...PARENT_GET, 'textContent', 'innerText', 'innerHTML', 'outerHTML', 'tagName', 'classList', 'style', 'dataset', 'onclick', 'attributes', ...Object.keys(REFLECT), ...Object.keys(REFLECT_ON), ...Object.keys(BOOLEANS)],
  set: ['textContent', 'innerText', 'innerHTML', 'outerHTML', 'style', 'onclick', 'nodeValue', ...Object.keys(REFLECT), ...Object.keys(REFLECT_ON), ...Object.keys(BOOLEANS)],
  call: [...NODE_CALL, ...PARENT_CALL, 'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute', 'toggleAttribute', 'getElementsByClassName', 'getElementsByTagName', 'closest', 'matches', 'addEventListener', 'removeEventListener', 'click', 'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText'],
} as const;
const ELEMENT_NAMES: readonly string[] = [...new Set([...ELEMENT_ALLOW.get, ...ELEMENT_ALLOW.call])];

class Page {
  readonly doc: DomDocument;
  readonly log: PageLog;
  readonly listeners = new Map<Holder, Listener[]>();
  /** Goes up when the tree changes, so a live list knows to look again. */
  version = 0;
  private readonly hosts = new WeakMap<object, HostObject>();
  private readonly selectors = new Map<string, Selector>();
  private count = 0;

  constructor(
    readonly rt: Runtime,
    readonly files: readonly SourceText[],
  ) {
    const html = files.find((f) => f.name.endsWith('.html'))?.text ?? '';
    this.doc = parseHtml(html, { fresh: (e) => (e.original = true) });
    this.count = allElements(this.doc).length;
    this.log = new PageLog(() => this.doc, files, rt);
  }

  /** The one object for this node, so `===` works as it does in a browser. */
  wrap(n: DomNode | DomFragment | DomDocument | null | undefined): Value {
    if (!n) return null;
    let h = this.hosts.get(n);
    if (!h) {
      h = n.kind === 'element' ? new ElementHost(this, n) : n.kind === 'fragment' ? new FragmentHost(this, n) : n.kind === 'document' ? new DocumentHost(this) : new TextHost(this, n);
      this.hosts.set(n, h);
    }
    return h;
  }

  counted(): void {
    if (++this.count <= MAX_ELEMENTS) return;
    this.count = allElements(this.doc).length;
    this.rt.charge(this.count >> 2);
    if (this.count > MAX_ELEMENTS) this.rt.fail('RangeError', `This page has more than ${MAX_ELEMENTS.toLocaleString('en-US')} elements.`, 'page-too-big', 'The program stopped here because the page got too big to draw. A loop may be adding more elements than you meant.');
  }

  /** Every element under `p`. A walk takes time, so it takes steps, and a loop around it still runs out. */
  every(p: DomParent): DomElement[] {
    const all = allElements(p);
    this.rt.charge(all.length >> 2);
    return all;
  }

  /** A read of everything under `p`, paid for like a walk. */
  whole(p: DomParent, read: () => string): string {
    this.every(p);
    const text = read();
    this.rt.checkLength(text.length);
    return text;
  }

  fragment(html: string, context: DomElement): DomFragment {
    return parseFragment(html, context, this.doc.quirks, { fresh: () => this.counted(), charge: (n) => this.rt.charge(n) });
  }

  selector(text: string, method: string, on: string): Selector {
    const known = this.selectors.get(text);
    if (known) return known;
    try {
      const s = parseSelector(text);
      this.selectors.set(text, s);
      return s;
    } catch (e) {
      if (e instanceof BadSelector) this.rt.fail('DOMException', `Failed to execute '${method}' on '${on}': '${text}' is not a valid selector.`, 'bad-selector', 'A selector is written the way a CSS rule starts: a tag name, a dot and a class, or a # and an id. Check this one for a stray mark or an empty name.');
      if (e instanceof LeftOutSelector) this.rt.notAvailable(`The selector ${text} is not available in this editor.`);
      throw e;
    }
  }

  /** Adds a node. Everything that puts a node on the page comes through here. */
  put(parent: DomParent, n: DomNode | DomFragment, before: DomNode | null | undefined, method: string): void {
    if (n.kind === 'fragment') {
      for (const c of [...n.children]) this.put(parent, c, before, method);
      return;
    }
    for (let at: DomParent | null = parent; at; at = at.parent) if (at === n) this.rt.fail('DOMException', `Failed to execute '${method}' on 'Node': The new child element contains the parent.`, 'cycle', 'An element can\'t go inside itself or inside one of its own children.');
    const stay = before === n ? nextSibling(n) : before;
    const was = n.parent === parent;
    insert(parent, n, stay);
    this.version++;
    this.log.added(n, parent, was);
  }

  take(n: DomNode): void {
    this.log.removing(n);
    detach(n);
    this.version++;
  }

  clear(p: DomParent): void {
    for (const c of [...p.children]) this.take(c);
  }

  setAttr(e: DomElement, name: string, value: string): void {
    this.rt.charge(value.length >> 5);
    e.attrs.set(name, value);
    this.version++;
  }

  dropAttr(e: DomElement, name: string): void {
    e.attrs.delete(name);
    this.version++;
  }

  /** Strings become text, and nodes stay as they are: what `append` and friends take. */
  nodes(args: Value[], method: string): DomNode[] {
    const out: DomNode[] = [];
    for (const a of args) {
      if (a instanceof NodeHost) {
        const n = a.node;
        if (n.kind === 'fragment') out.push(...n.children);
        else if (n.kind !== 'document') out.push(n);
      } else {
        const text = this.rt.str(a);
        this.watchText(text, method);
        out.push(new DomText(text));
      }
    }
    return out;
  }

  /** A browser shows these as they are, which is rarely what a beginner meant. */
  watchText(text: string, prop: string): void {
    this.rt.charge(text.length >> 5);
    if (/<\/?[a-zA-Z][^<>]*>/.test(text)) this.log.tagsAsText(prop);
    const shown = /\[object HTML\w*Element\]/.exec(text);
    if (shown) this.log.elementAsText(shown[0]);
  }

  fire(target: Holder, type: string): void {
    const path: Holder[] = [];
    for (let at: DomParent | null = target; at; at = at.parent) if (at.kind !== 'fragment') path.push(at);
    const event = new EventHost(this, type, target);
    for (const at of path) {
      event.current = at;
      for (const l of [...(this.listeners.get(at) ?? [])]) if (l.type === type) this.rt.call(l.fn, undefined, [event]);
      if (event.stopped) break;
    }
  }

  listen(on: Holder, type: string, fn: Value): void {
    if (type !== 'click' && !(on.kind === 'document' && type === 'DOMContentLoaded')) this.rt.notAvailable(`The ${type} event is not available in this editor. Use click.`);
    if (!isCallable(fn)) {
      this.log.handlerCalled();
      return;
    }
    const list = this.listeners.get(on) ?? [];
    if (!list.some((l) => l.type === type && l.fn === fn)) list.push({ type, fn });
    this.listeners.set(on, list);
  }

  unlisten(on: Holder, type: string, fn: Value): void {
    const list = this.listeners.get(on);
    if (list) this.listeners.set(on, list.filter((l) => l.type !== type || l.fn !== fn));
  }

  /** How many elements on the page could answer a click. */
  listening(): number {
    let n = 0;
    for (const [at, list] of this.listeners) if (list.some((l) => l.type === 'click') && (at.kind === 'document' || isConnected(at))) n++;
    return n;
  }

  /** `1.0.3` from the preview, or a CSS selector from an answer key. */
  find(target: string): DomElement | undefined {
    if (/^\d+(?:\.\d+)*$/.test(target)) {
      let at: DomParent = this.doc;
      for (const part of target.split('.')) {
        const next: DomElement | undefined = elementsIn(at)[Number(part)];
        if (!next) return undefined;
        at = next;
      }
      return at.kind === 'element' ? at : undefined;
    }
    return selectAll(this.doc, parseSelector(target))[0];
  }
}

const nextSibling = (n: DomNode): DomNode | null => {
  const sibs = n.parent?.children;
  return sibs?.[sibs.indexOf(n) + 1] ?? null;
};
const prevSibling = (n: DomNode): DomNode | null => {
  const sibs = n.parent?.children;
  return sibs?.[sibs.indexOf(n) - 1] ?? null;
};

function need(page: Page, args: Value[], n: number, method: string, on: string): void {
  if (args.length < n) page.rt.fail('TypeError', `Failed to execute '${method}' on '${on}': ${n} argument${n > 1 ? 's' : ''} required, but only ${args.length} present.`, 'missing-argument', `${method} needs ${n === 1 ? 'a value' : `${n} values`} in its parentheses.`);
}

/** The node in a parameter, or a stop in Chrome's words. */
function nodeArg(page: Page, v: Value, method: string, position = 1): DomNode | DomFragment {
  if (v instanceof NodeHost && v.node.kind !== 'document') return v.node as DomNode | DomFragment;
  let help = `${method} takes an element. Make one with document.createElement, or find one with document.getElementById.`;
  if (typeof v === 'string') help = `${method} takes an element, and this is a string. Make an element with document.createElement and set its textContent first.`;
  else if (v === null) help = `${method} was given null, which usually means a search found nothing. Check the id or selector that gave you this value.`;
  else if (v === undefined) help = `${method} was given undefined. Check that the variable in the parentheses holds an element.`;
  page.rt.fail('TypeError', `Failed to execute '${method}' on 'Node': parameter ${position} is not of type 'Node'.`, 'not-a-node', help);
}

function nodeGet(page: Page, n: DomNode | DomDocument | DomFragment, name: string): Value {
  const node = n.kind === 'document' || n.kind === 'fragment' ? undefined : n;
  if (name.endsWith('Sibling')) page.rt.charge((n.parent?.children.length ?? 0) >> 6);
  switch (name) {
    case 'parentNode':
      return page.wrap(n.parent);
    case 'parentElement':
      return page.wrap(node ? parentElement(node) : null);
    case 'nextSibling':
      return page.wrap(node ? nextSibling(node) : null);
    case 'previousSibling':
      return page.wrap(node ? prevSibling(node) : null);
    case 'nextElementSibling': {
      let at = node ? nextSibling(node) : null;
      while (at && at.kind !== 'element') at = nextSibling(at);
      return page.wrap(at);
    }
    case 'previousElementSibling': {
      let at = node ? prevSibling(node) : null;
      while (at && at.kind !== 'element') at = prevSibling(at);
      return page.wrap(at);
    }
    case 'isConnected':
      return node ? isConnected(node) : n.kind === 'document';
    case 'nodeType':
      return n.kind === 'element' ? 1 : n.kind === 'text' ? 3 : n.kind === 'comment' ? 8 : n.kind === 'document' ? 9 : 11;
    case 'nodeName':
      return n.kind === 'element' ? (n.ns === 'html' ? n.tag.toUpperCase() : n.tag) : n.kind === 'text' ? '#text' : n.kind === 'comment' ? '#comment' : n.kind === 'document' ? '#document' : '#document-fragment';
    case 'nodeValue':
      return n.kind === 'text' || n.kind === 'comment' ? n.data : null;
  }
  return undefined;
}

function parentGet(page: Page, p: DomParent, name: string): Value {
  const kids = () => {
    page.rt.charge(p.children.length >> 4);
    return elementsIn(p);
  };
  switch (name) {
    case 'children':
      return new ListHost(page, () => elementsIn(p), 'HTMLCollection', 'children');
    case 'childNodes':
      return new ListHost(page, () => p.children, 'NodeList', 'childNodes');
    case 'firstChild':
      return page.wrap(p.children[0]);
    case 'lastChild':
      return page.wrap(p.children.at(-1));
    case 'firstElementChild':
      return page.wrap(kids()[0]);
    case 'lastElementChild':
      return page.wrap(kids().at(-1));
    case 'childElementCount':
      return kids().length;
  }
  return undefined;
}

function queryOne(page: Page, p: DomParent, args: Value[], on: string): Value {
  need(page, args, 1, 'querySelector', on);
  const text = page.rt.str(args[0]);
  const all = selectAll(p, page.selector(text, 'querySelector', on), (n) => page.rt.charge(n >> 2));
  page.log.lookedUp('querySelector', text, all.length > 0, page.doc);
  page.log.firstMatch(text, all.length);
  if (all.length && bareTag(text)) page.log.bareTagHit('querySelector', text, page.doc);
  return page.wrap(all[0]);
}

function queryAll(page: Page, p: DomParent, args: Value[], on: string): Value {
  need(page, args, 1, 'querySelectorAll', on);
  const text = page.rt.str(args[0]);
  const all = selectAll(p, page.selector(text, 'querySelectorAll', on), (n) => page.rt.charge(n >> 2));
  if (!all.length) page.log.emptyList('querySelectorAll', text, page.doc);
  return new ListHost(page, () => all, 'NodeList', 'querySelectorAll');
}

function byClass(page: Page, p: DomParent, args: Value[], on: string): Value {
  need(page, args, 1, 'getElementsByClassName', on);
  const text = page.rt.str(args[0]);
  if (text.startsWith('.')) page.log.classWithDot('getElementsByClassName', text);
  const names = text.split(/\s+/).filter(Boolean);
  return new ListHost(page, () => page.every(p).filter((e) => names.length > 0 && names.every((k) => (e.attrs.get('class') ?? '').split(/\s+/).includes(k))), 'HTMLCollection', 'getElementsByClassName');
}

function byTag(page: Page, p: DomParent, args: Value[], on: string): Value {
  need(page, args, 1, 'getElementsByTagName', on);
  const tag = page.rt.str(args[0]).toLowerCase();
  return new ListHost(page, () => page.every(p).filter((e) => tag === '*' || e.tag.toLowerCase() === tag), 'HTMLCollection', 'getElementsByTagName');
}

/** What every node that can hold others can do. Undefined: not one of these. */
function parentCall(page: Page, p: DomParent, name: string, args: Value[], on: string): { value: Value } | undefined {
  switch (name) {
    case 'appendChild': {
      need(page, args, 1, name, 'Node');
      const n = nodeArg(page, args[0], name);
      page.put(p, n, null, name);
      return { value: args[0] };
    }
    case 'append':
      for (const n of page.nodes(args, name)) page.put(p, n, null, name);
      return { value: undefined };
    case 'prepend': {
      const first = p.children[0];
      for (const n of page.nodes(args, name)) page.put(p, n, first, name);
      return { value: undefined };
    }
    case 'removeChild': {
      need(page, args, 1, name, 'Node');
      const n = nodeArg(page, args[0], name);
      if (n.kind === 'fragment' || n.parent !== p) page.rt.fail('DOMException', "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.", 'not-a-child', 'removeChild only works on an element directly inside this one. To remove an element from wherever it is, call remove() on it.');
      page.take(n);
      return { value: args[0] };
    }
    case 'insertBefore': {
      need(page, args, 2, name, 'Node');
      const n = nodeArg(page, args[0], name);
      const ref = args[1] === null || args[1] === undefined ? null : nodeArg(page, args[1], name, 2);
      if (ref && (ref.kind === 'fragment' || ref.parent !== p)) page.rt.fail('DOMException', "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.", 'not-a-child', 'The second value must be an element directly inside this one.');
      page.put(p, n, ref as DomNode | null, name);
      return { value: args[0] };
    }
    case 'replaceChild': {
      need(page, args, 2, name, 'Node');
      const n = nodeArg(page, args[0], name);
      const old = nodeArg(page, args[1], name, 2);
      if (old.kind === 'fragment' || old.parent !== p) page.rt.fail('DOMException', "Failed to execute 'replaceChild' on 'Node': The node to be replaced is not a child of this node.", 'not-a-child', 'The second value must be an element directly inside this one.');
      page.put(p, n, old, name);
      page.take(old);
      return { value: args[1] };
    }
    case 'replaceChildren': {
      const fresh = page.nodes(args, name);
      page.clear(p);
      for (const n of fresh) page.put(p, n, null, name);
      return { value: undefined };
    }
    case 'querySelector':
      return { value: queryOne(page, p, args, on) };
    case 'querySelectorAll':
      return { value: queryAll(page, p, args, on) };
    case 'hasChildNodes':
      return { value: p.children.length > 0 };
    case 'contains': {
      const n = args[0] instanceof NodeHost ? args[0].node : null;
      for (let at: DomParent | DomNode | null = n; at; at = at.parent) if (at === p) return { value: true };
      return { value: false };
    }
  }
  return undefined;
}

function nodeCall(page: Page, n: DomNode, name: string, args: Value[]): { value: Value } | undefined {
  const p = n.parent;
  switch (name) {
    case 'remove':
      if (p) page.take(n);
      return { value: undefined };
    case 'before':
      if (p) for (const x of page.nodes(args, name)) page.put(p, x, n, name);
      return { value: undefined };
    case 'after':
      if (p) {
        const next = nextSibling(n);
        for (const x of page.nodes(args, name)) page.put(p, x, next, name);
      }
      return { value: undefined };
    case 'replaceWith':
      if (p) {
        for (const x of page.nodes(args, name)) page.put(p, x, n, name);
        page.take(n);
      }
      return { value: undefined };
    case 'cloneNode':
      return { value: page.wrap(clone(page, n, !!args[0])) };
  }
  return undefined;
}

function clone(page: Page, n: DomNode, deep: boolean): DomNode {
  if (n.kind === 'text') return new DomText(n.data);
  if (n.kind === 'comment') return new DomComment(n.data);
  const out = new DomElement(n.tag, n.ns);
  page.counted();
  page.log.created(out);
  for (const [k, v] of n.attrs) out.attrs.set(k, v);
  if (deep) for (const c of n.children) insert(out, clone(page, c, true));
  return out;
}

abstract class NodeHost extends HostObject {
  constructor(
    protected readonly page: Page,
    readonly node: DomNode | DomFragment | DomDocument,
  ) {
    super();
  }
}

class ElementHost extends NodeHost {
  readonly allow = ELEMENT_ALLOW;
  private readonly loose = new Map<string, Value>();
  private classes?: ClassListHost;
  private styles?: StyleHost;

  constructor(
    page: Page,
    readonly el: DomElement,
  ) {
    super(page, el);
  }

  label(): string {
    const id = this.el.attrs.get('id');
    const cls = this.el.attrs.get('class');
    return `<${this.el.tag}${id ? ` id="${id}"` : ''}${cls ? ` class="${cls}"` : ''}>`;
  }

  asString(): string {
    if (this.el.tag === 'a' || this.el.tag === 'area') return this.el.attrs.get('href') ?? '';
    return `[object ${interfaceOf(this.el)}]`;
  }

  get(name: string, rt: Runtime): Value {
    const { el, page } = this;
    switch (name) {
      case 'textContent':
      case 'innerText':
        return page.whole(el, () => textOf(el));
      case 'innerHTML':
        return page.whole(el, () => innerHtml(el));
      case 'outerHTML':
        return page.whole(el, () => outerHtml(el));
      case 'tagName':
        return nodeGet(page, el, 'nodeName');
      case 'classList':
        return (this.classes ??= new ClassListHost(page, el));
      case 'style':
        return (this.styles ??= new StyleHost(page, el));
      case 'dataset':
        return new DatasetHost(page, el);
      case 'onclick':
        return page.listeners.get(el)?.find((l) => l.slot)?.fn ?? null;
      case 'attributes':
        return rt.array([...el.attrs.keys()]);
    }
    if (NODE_GET.includes(name)) return nodeGet(page, el, name);
    if (PARENT_GET.includes(name)) return parentGet(page, el, name);
    if (name in REFLECT) return el.attrs.get(REFLECT[name]) ?? '';
    if (name in BOOLEANS) return el.attrs.has(BOOLEANS[name]);
    const on = REFLECT_ON[name];
    if (on.tags.includes(el.tag)) {
      const v = el.attrs.get(on.attr) ?? '';
      return name === 'width' || name === 'height' ? Number(v) || 0 : v;
    }
    return this.loose.get(name);
  }

  set(name: string, value: Value, rt: Runtime): void {
    const { el, page } = this;
    switch (name) {
      case 'textContent':
      case 'innerText':
      case 'nodeValue': {
        if (name === 'nodeValue') return;
        const text = value === null || value === undefined ? '' : rt.str(value);
        page.watchText(text, name);
        page.clear(el);
        if (text) page.put(el, new DomText(text), null, name);
        return;
      }
      case 'innerHTML': {
        const html = value === null ? '' : rt.str(value);
        const shown = /\[object HTML\w*Element\]/.exec(html);
        if (shown) page.log.elementAsText(shown[0]);
        const parsed = page.fragment(html, el);
        page.clear(el);
        page.put(el, parsed, null, name);
        return;
      }
      case 'outerHTML': {
        const p = el.parent;
        if (!p) return;
        const parsed = page.fragment(rt.str(value), p.kind === 'element' ? p : new DomElement('body'));
        page.put(p, parsed, el, name);
        page.take(el);
        return;
      }
      case 'style':
        page.setAttr(el, 'style', rt.str(value));
        return;
      case 'onclick': {
        const list = (page.listeners.get(el) ?? []).filter((l) => !l.slot);
        if (isCallable(value)) list.push({ type: 'click', fn: value, slot: true });
        page.listeners.set(el, list);
        return;
      }
    }
    if (name in REFLECT) {
      const text = rt.str(value);
      if (name === 'className') {
        if (/(?:^|\s)\.\w/.test(text)) page.log.classWithDot('el.className =', text);
        for (const k of text.split(/\s+/).filter(Boolean)) page.log.classGiven(k);
      }
      page.setAttr(el, REFLECT[name], text);
      return;
    }
    if (name in BOOLEANS) {
      if (value) page.setAttr(el, BOOLEANS[name], '');
      else page.dropAttr(el, BOOLEANS[name]);
      return;
    }
    const on = REFLECT_ON[name];
    if (on.tags.includes(el.tag)) page.setAttr(el, on.attr, rt.str(value));
    else {
      page.log.notProperty(name, name === 'width' || name === 'height' ? `style.${name}` : `a tag that has it, like <${on.tags[0]}>`);
      this.loose.set(name, value);
    }
  }

  read(name: string): { value: Value } | undefined {
    if (this.loose.has(name)) return { value: this.loose.get(name) };
    if (name === 'length') {
      this.page.log.elementLength();
      return { value: undefined };
    }
    const meant = meantProperty(name, ELEMENT_NAMES);
    if (meant === undefined) return undefined;
    this.page.log.miss('element', name);
    this.page.log.readMiss(name, meant);
    return { value: undefined };
  }

  write(name: string, value: Value): boolean {
    const meant = meantProperty(name, ELEMENT_NAMES);
    if (meant === undefined) return false;
    this.page.log.notProperty(name, meant);
    this.loose.set(name, value);
    return true;
  }

  call(name: string, args: Value[], rt: Runtime): Value {
    const { el, page } = this;
    const done = parentCall(page, el, name, args, 'Element') ?? nodeCall(page, el, name, args);
    if (done) return done.value;
    switch (name) {
      case 'getAttribute':
        need(page, args, 1, name, 'Element');
        return el.attrs.get(rt.str(args[0]).toLowerCase()) ?? null;
      case 'setAttribute': {
        need(page, args, 2, name, 'Element');
        const attr = rt.str(args[0]);
        if (!/^[^\s<>"'/=]+$/.test(attr)) rt.fail('DOMException', `Failed to execute 'setAttribute' on 'Element': '${attr}' is not a valid attribute name.`, 'bad-attribute', 'An attribute name is one word, with no spaces or marks.');
        const text = rt.str(args[1]);
        if (attr.toLowerCase() === 'class') {
          if (/(?:^|\s)\.\w/.test(text)) page.log.classWithDot('setAttribute("class",', text);
          for (const k of text.split(/\s+/).filter(Boolean)) page.log.classGiven(k);
        }
        page.setAttr(el, el.ns === 'html' ? attr.toLowerCase() : attr, text);
        return undefined;
      }
      case 'removeAttribute':
        need(page, args, 1, name, 'Element');
        page.dropAttr(el, rt.str(args[0]).toLowerCase());
        return undefined;
      case 'hasAttribute':
        need(page, args, 1, name, 'Element');
        return el.attrs.has(rt.str(args[0]).toLowerCase());
      case 'toggleAttribute': {
        need(page, args, 1, name, 'Element');
        const attr = rt.str(args[0]).toLowerCase();
        const on = args.length > 1 ? !!args[1] : !el.attrs.has(attr);
        if (on && !el.attrs.has(attr)) page.setAttr(el, attr, '');
        else if (!on) page.dropAttr(el, attr);
        return on;
      }
      case 'getElementsByClassName':
        return byClass(page, el, args, 'Element');
      case 'getElementsByTagName':
        return byTag(page, el, args, 'Element');
      case 'closest': {
        need(page, args, 1, name, 'Element');
        const s = page.selector(rt.str(args[0]), name, 'Element');
        for (let at: DomElement | null = el; at; at = parentElement(at)) if (matches(at, s)) return page.wrap(at);
        return null;
      }
      case 'matches':
        need(page, args, 1, name, 'Element');
        return matches(el, page.selector(rt.str(args[0]), name, 'Element'));
      case 'addEventListener':
        need(page, args, 2, name, 'EventTarget');
        page.listen(el, rt.str(args[0]), args[1]);
        return undefined;
      case 'removeEventListener':
        need(page, args, 2, name, 'EventTarget');
        page.unlisten(el, rt.str(args[0]), args[1]);
        return undefined;
      case 'click':
        page.fire(el, 'click');
        return undefined;
      case 'insertAdjacentHTML': {
        need(page, args, 2, name, 'Element');
        const at = this.adjacent(rt.str(args[0]), name);
        const parsed = page.fragment(rt.str(args[1]), at.parent.kind === 'element' ? at.parent : new DomElement('body'));
        page.put(at.parent, parsed, at.before, name);
        return undefined;
      }
      case 'insertAdjacentElement': {
        need(page, args, 2, name, 'Element');
        const at = this.adjacent(rt.str(args[0]), name);
        page.put(at.parent, nodeArg(page, args[1], name, 2), at.before, name);
        return args[1];
      }
      case 'insertAdjacentText': {
        need(page, args, 2, name, 'Element');
        const at = this.adjacent(rt.str(args[0]), name);
        page.put(at.parent, new DomText(rt.str(args[1])), at.before, name);
        return undefined;
      }
    }
    return undefined;
  }

  private adjacent(where: string, method: string): { parent: DomParent; before: DomNode | null } {
    const { el, page } = this;
    const w = where.toLowerCase();
    if (w === 'afterbegin') return { parent: el, before: el.children[0] ?? null };
    if (w === 'beforeend') return { parent: el, before: null };
    if (w === 'beforebegin' || w === 'afterend') {
      if (!el.parent || el.parent.kind === 'document') page.rt.fail('DOMException', `Failed to execute '${method}' on 'Element': The element has no parent.`, 'no-parent', 'This element is not inside another one yet, so nothing can go next to it.');
      return { parent: el.parent!, before: w === 'afterend' ? nextSibling(el) : el };
    }
    return page.rt.fail('DOMException', `Failed to execute '${method}' on 'Element': The value provided ('${where}') is not one of 'beforeBegin', 'afterBegin', 'beforeEnd', or 'afterEnd'.`, 'bad-position', 'The first value says where the new content goes: "beforebegin", "afterbegin", "beforeend", or "afterend".');
  }
}

class TextHost extends NodeHost {
  readonly allow = { get: [...NODE_GET, 'textContent', 'data', 'length'], set: ['textContent', 'data', 'nodeValue'], call: NODE_CALL };

  constructor(
    page: Page,
    private readonly n: DomText | DomComment,
  ) {
    super(page, n);
  }

  label(): string {
    return JSON.stringify(this.n.data);
  }

  asString(): string {
    return this.n.kind === 'text' ? '[object Text]' : '[object Comment]';
  }

  get(name: string): Value {
    if (name === 'textContent' || name === 'data') return this.n.data;
    if (name === 'length') return this.n.data.length;
    return nodeGet(this.page, this.n, name);
  }

  set(_name: string, value: Value, rt: Runtime): void {
    this.n.data = value === null ? '' : rt.str(value);
  }

  call(name: string, args: Value[]): Value {
    return nodeCall(this.page, this.n, name, args)?.value;
  }
}

class FragmentHost extends NodeHost {
  readonly allow = { get: [...PARENT_GET, 'textContent', 'nodeType', 'nodeName'], call: PARENT_CALL };

  constructor(
    page: Page,
    private readonly f: DomFragment,
  ) {
    super(page, f);
  }

  label(): string {
    return 'DocumentFragment';
  }

  get(name: string): Value {
    if (name === 'textContent') return this.page.whole(this.f, () => textOf(this.f));
    if (PARENT_GET.includes(name)) return parentGet(this.page, this.f, name);
    return nodeGet(this.page, this.f, name);
  }

  call(name: string, args: Value[]): Value {
    return parentCall(this.page, this.f, name, args, 'DocumentFragment')?.value;
  }
}

class DocumentHost extends NodeHost {
  readonly allow = {
    get: ['body', 'head', 'documentElement', 'title', ...PARENT_GET, 'nodeType', 'nodeName'],
    set: ['title'],
    call: ['getElementById', 'getElementsByClassName', 'getElementsByTagName', 'querySelector', 'querySelectorAll', 'createElement', 'createTextNode', 'createDocumentFragment', 'createComment', 'addEventListener', 'removeEventListener', 'appendChild', 'write', 'writeln'],
  };

  constructor(page: Page) {
    super(page, page.doc);
  }

  label(): string {
    return 'document';
  }

  asString(): string {
    return '[object HTMLDocument]';
  }

  private titleEl(): DomElement | undefined {
    return selectAll(this.page.doc, parseSelector('title'), (n) => this.page.rt.charge(n >> 2))[0];
  }

  get(name: string): Value {
    const { doc } = this.page;
    switch (name) {
      case 'body':
        return this.page.wrap(doc.body);
      case 'head':
        return this.page.wrap(doc.head);
      case 'documentElement':
        return this.page.wrap(doc.root);
      case 'title': {
        const t = this.titleEl();
        return t ? textOf(t).replace(/[ \t\n\f\r]+/g, ' ').trim() : '';
      }
    }
    if (PARENT_GET.includes(name)) return parentGet(this.page, doc, name);
    return nodeGet(this.page, doc, name);
  }

  set(_name: string, value: Value, rt: Runtime): void {
    const { page } = this;
    let t = this.titleEl();
    if (!t) {
      t = new DomElement('title');
      page.put(page.doc.head, t, null, 'title');
    }
    page.clear(t);
    const text = rt.str(value);
    if (text) page.put(t, new DomText(text), null, 'title');
  }

  read(name: string): { value: Value } | undefined {
    if (meantProperty(name, this.allow.call) === undefined && !/^(?:getElement|querySelect|createElem)/i.test(name)) return undefined;
    this.page.log.miss('document', name);
    return { value: undefined };
  }

  call(name: string, args: Value[], rt: Runtime): Value {
    const { page } = this;
    const { doc } = page;
    switch (name) {
      case 'getElementById': {
        need(page, args, 1, name, 'Document');
        const id = rt.str(args[0]);
        let hit: DomElement | undefined;
        let seen = 0;
        walkElements(doc, (e) => {
          seen++;
          if (e.attrs.get('id') !== id) return false;
          hit = e;
          return true;
        });
        rt.charge(seen >> 2);
        page.log.lookedUp(name, id, !!hit, doc);
        return page.wrap(hit);
      }
      case 'getElementsByClassName':
        return byClass(page, doc, args, 'Document');
      case 'getElementsByTagName':
        return byTag(page, doc, args, 'Document');
      case 'querySelector':
        return queryOne(page, doc, args, 'Document');
      case 'querySelectorAll':
        return queryAll(page, doc, args, 'Document');
      case 'createElement': {
        need(page, args, 1, name, 'Document');
        const tag = rt.str(args[0]);
        if (!/^[a-zA-Z][\w.:-]*$/.test(tag)) rt.fail('DOMException', `Failed to execute 'createElement' on 'Document': The tag name provided ('${tag}') is not a valid name.`, 'bad-tag', `createElement takes the tag name alone, with no angle brackets or spaces. Write createElement("${tag.replace(/[<>/\s]/g, '') || 'p'}").`);
        const e = new DomElement(tag.toLowerCase());
        page.counted();
        page.log.created(e);
        return page.wrap(e);
      }
      case 'createTextNode': {
        need(page, args, 1, name, 'Document');
        const text = rt.str(args[0]);
        page.watchText(text, name);
        return page.wrap(new DomText(text));
      }
      case 'createComment':
        need(page, args, 1, name, 'Document');
        return page.wrap(new DomComment(rt.str(args[0])));
      case 'createDocumentFragment':
        return page.wrap(new DomFragment());
      case 'addEventListener':
        need(page, args, 2, name, 'EventTarget');
        page.listen(doc, rt.str(args[0]), args[1]);
        return undefined;
      case 'removeEventListener':
        need(page, args, 2, name, 'EventTarget');
        page.unlisten(doc, rt.str(args[0]), args[1]);
        return undefined;
      case 'appendChild':
        return rt.fail('DOMException', "Failed to execute 'appendChild' on 'Node': Only one element on document allowed.", 'document-append', 'document stands for the whole page, which already has its one <html> element. Add to document.body, or to an element inside it.');
      default:
        return rt.notAvailable(`document.${name} is not available in this editor.`);
    }
  }

}

class ListHost extends HostObject {
  readonly allow: HostObject['allow'];
  private seen = -1;
  private held: readonly (DomNode | DomElement)[] = [];
  private readonly loose = new Map<string, Value>();

  constructor(
    private readonly page: Page,
    private readonly source: () => readonly (DomNode | DomElement)[],
    private readonly kind: 'NodeList' | 'HTMLCollection',
    private readonly from: string,
  ) {
    super();
    this.allow = { get: ['length'], call: kind === 'NodeList' ? ['item', 'forEach'] : ['item'] };
  }

  /** A live list looks again only when the page has changed, so a loop over it isn't slower for each pass. */
  private list(): readonly (DomNode | DomElement)[] {
    if (this.seen !== this.page.version) {
      this.held = this.source();
      this.seen = this.page.version;
      this.page.rt.charge(this.held.length >> 2);
    }
    return this.held;
  }

  label(): string {
    return `${this.kind}(${this.list().length})`;
  }

  asString(): string {
    return `[object ${this.kind}]`;
  }

  get(): Value {
    return this.list().length;
  }

  items(): Value[] {
    return this.list().map((n) => this.page.wrap(n));
  }

  call(name: string, args: Value[], rt: Runtime): Value {
    if (name === 'item') return this.page.wrap(this.list()[rt.num(args[0])]);
    const fn = args[0];
    if (!isCallable(fn)) rt.fail('TypeError', "Failed to execute 'forEach' on 'NodeList': The callback provided as parameter 1 is not a function.", 'not-a-function');
    [...this.list()].forEach((n, i) => rt.call(fn, undefined, [this.page.wrap(n), i, this]));
    return undefined;
  }

  read(name: string): { value: Value } | undefined {
    const i = arrayIndex(name);
    if (i >= 0) {
      const n = this.list()[i];
      return { value: n ? this.page.wrap(n) : undefined };
    }
    if (this.loose.has(name)) return { value: this.loose.get(name) };
    const on = this.kind === 'NodeList' ? 'list' : 'collection';
    this.page.log.miss(on, name);
    if (ELEMENT_NAMES.includes(name)) {
      this.page.log.listRead(name, this.from);
      return { value: undefined };
    }
    if (['map', 'filter', 'reduce', 'find', 'some', 'every', 'includes', 'indexOf', 'join', 'slice', 'push', 'pop', 'sort', 'reverse', 'concat', 'forEach'].includes(name)) return { value: undefined };
    return undefined;
  }

  write(name: string, value: Value): boolean {
    if (arrayIndex(name) >= 0) return true;
    if (!ELEMENT_NAMES.includes(name)) return false;
    this.page.log.listProperty(name, this.from);
    this.loose.set(name, value);
    return true;
  }
}

class ClassListHost extends HostObject {
  readonly allow = { get: ['length', 'value'], call: ['add', 'remove', 'toggle', 'contains', 'replace', 'item'] };

  constructor(
    private readonly page: Page,
    private readonly el: DomElement,
  ) {
    super();
  }

  private tokens(): string[] {
    return [...new Set((this.el.attrs.get('class') ?? '').split(/[ \t\n\f\r]+/).filter(Boolean))];
  }

  private save(tokens: string[]): void {
    if (!tokens.length && !this.el.attrs.has('class')) return;
    this.page.setAttr(this.el, 'class', tokens.join(' '));
  }

  label(): string {
    return `DOMTokenList(${this.tokens().length})`;
  }

  asString(): string {
    return this.el.attrs.get('class') ?? '';
  }

  get(name: string): Value {
    return name === 'length' ? this.tokens().length : (this.el.attrs.get('class') ?? '');
  }

  items(): Value[] {
    return this.tokens();
  }

  read(name: string): { value: Value } | undefined {
    const i = arrayIndex(name);
    return i >= 0 ? { value: this.tokens()[i] } : undefined;
  }

  private token(v: Value, method: string, rt: Runtime): string {
    const t = rt.str(v);
    if (!t) rt.fail('DOMException', `Failed to execute '${method}' on 'DOMTokenList': The token provided must not be empty.`, 'bad-token', 'A class name can\'t be empty.');
    if (/[ \t\n\f\r]/.test(t)) rt.fail('DOMException', `Failed to execute '${method}' on 'DOMTokenList': The token provided ('${t}') contains HTML space characters, which are not valid in tokens.`, 'bad-token', v instanceof ElementHost ? 'A class name goes in quotes, like classList.add("big"). This line gave it an element.' : `A class name is one word. To add two classes, give ${method} two strings, with a comma between them.`);
    if (method === 'add' || method === 'toggle') {
      if (t.startsWith('.')) this.page.log.classWithDot(`classList.${method}`, t);
      this.page.log.classGiven(t);
    }
    return t;
  }

  call(name: string, args: Value[], rt: Runtime): Value {
    const tokens = this.tokens();
    switch (name) {
      case 'add':
        for (const a of args) {
          const t = this.token(a, name, rt);
          if (!tokens.includes(t)) tokens.push(t);
        }
        this.save(tokens);
        return undefined;
      case 'remove': {
        const out = args.map((a) => this.token(a, name, rt));
        this.save(tokens.filter((t) => !out.includes(t)));
        return undefined;
      }
      case 'toggle': {
        need(this.page, args, 1, name, 'DOMTokenList');
        const t = this.token(args[0], name, rt);
        const had = tokens.includes(t);
        const on = args.length > 1 && args[1] !== undefined ? !!args[1] : !had;
        if (on && !had) this.save([...tokens, t]);
        else if (!on && had) this.save(tokens.filter((x) => x !== t));
        return on;
      }
      case 'contains':
        need(this.page, args, 1, name, 'DOMTokenList');
        return tokens.includes(rt.str(args[0]));
      case 'replace': {
        need(this.page, args, 2, name, 'DOMTokenList');
        const from = this.token(args[0], name, rt);
        const to = this.token(args[1], name, rt);
        if (!tokens.includes(from)) return false;
        this.save([...new Set(tokens.map((t) => (t === from ? to : t)))]);
        return true;
      }
      default:
        return tokens[rt.num(args[0])] ?? null;
    }
  }
}

class StyleHost extends HostObject {
  readonly allow = { get: ['cssText', 'length'], set: ['cssText'], call: ['setProperty', 'getPropertyValue', 'removeProperty', 'item'] };
  private readonly loose = new Map<string, Value>();

  constructor(
    private readonly page: Page,
    private readonly el: DomElement,
  ) {
    super();
  }

  private map() {
    return parseStyle(this.el.attrs.get('style') ?? '');
  }

  private save(m: ReturnType<StyleHost['map']>): void {
    if (!m.size && !this.el.attrs.has('style')) return;
    this.page.setAttr(this.el, 'style', serializeStyle(m));
  }

  label(): string {
    return 'CSSStyleDeclaration';
  }

  asString(): string {
    return '[object CSSStyleDeclaration]';
  }

  get(name: string): Value {
    return name === 'length' ? this.map().size : serializeStyle(this.map());
  }

  set(_name: string, value: Value, rt: Runtime): void {
    this.page.setAttr(this.el, 'style', serializeStyle(parseStyle(rt.str(value))));
  }

  private value(prop: string): string {
    const m = this.map();
    const hit = m.get(prop)?.value;
    if (hit !== undefined) return hit;
    // `background: red` covers background-color, and this file doesn't expand shorthands.
    return prop === 'background-color' ? (m.get('background')?.value ?? '') : '';
  }

  private store(prop: string, value: string, important: boolean): void {
    const m = this.map();
    if (value === '') {
      if (m.delete(prop)) this.save(m);
      return;
    }
    const read = readValue(prop, value);
    if (!read.ok) {
      if (read.why === 'color') this.page.log.styleBadColor(prop, value);
      else this.page.log.styleNoUnit(prop, value);
      return;
    }
    m.set(prop, { value: read.value, important });
    this.save(m);
  }

  read(name: string): { value: Value } | undefined {
    const i = arrayIndex(name);
    if (i >= 0) return { value: [...this.map().keys()][i] };
    const prop = cssName(name);
    return { value: CSS_PROPERTIES.has(prop) ? this.value(prop) : this.loose.get(name) };
  }

  write(name: string, value: Value, rt: Runtime): boolean {
    const prop = cssName(name);
    if (!CSS_PROPERTIES.has(prop)) {
      this.page.log.styleUnknown(name);
      this.loose.set(name, value);
      return true;
    }
    this.store(prop, value === null ? '' : rt.str(value), false);
    return true;
  }

  call(name: string, args: Value[], rt: Runtime): Value {
    if (name === 'item') return [...this.map().keys()][rt.num(args[0])] ?? '';
    need(this.page, args, 1, name, 'CSSStyleDeclaration');
    const prop = rt.str(args[0]);
    if (name === 'getPropertyValue') return this.value(prop.toLowerCase());
    if (name === 'removeProperty') {
      const old = this.value(prop.toLowerCase());
      this.store(prop.toLowerCase(), '', false);
      return old;
    }
    need(this.page, args, 2, name, 'CSSStyleDeclaration');
    if (prop.startsWith('--')) {
      const m = this.map();
      m.set(prop, { value: rt.str(args[1]), important: false });
      this.save(m);
      return undefined;
    }
    if (!CSS_PROPERTIES.has(prop.toLowerCase())) {
      this.page.log.styleUnknown(/[A-Z]/.test(prop) ? cssName(prop) : prop);
      return undefined;
    }
    this.store(prop.toLowerCase(), args[1] === null ? '' : rt.str(args[1]), args[2] === 'important');
    return undefined;
  }
}

class DatasetHost extends HostObject {
  readonly allow = {};

  constructor(
    private readonly page: Page,
    private readonly el: DomElement,
  ) {
    super();
  }

  label(): string {
    return 'DOMStringMap';
  }

  private attr(name: string): string {
    return `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  }

  read(name: string): { value: Value } {
    return { value: this.el.attrs.get(this.attr(name)) };
  }

  write(name: string, value: Value, rt: Runtime): boolean {
    this.page.setAttr(this.el, this.attr(name), rt.str(value));
    return true;
  }
}

class EventHost extends HostObject {
  readonly allow = { get: ['target', 'currentTarget', 'type', 'bubbles', 'defaultPrevented'], call: ['preventDefault', 'stopPropagation'] };
  current?: Holder;
  stopped = false;
  private prevented = false;

  constructor(
    private readonly page: Page,
    private readonly type: string,
    private readonly target: Holder,
  ) {
    super();
  }

  label(): string {
    return 'Event';
  }

  get(name: string): Value {
    switch (name) {
      case 'target':
        return this.page.wrap(this.target);
      case 'currentTarget':
        return this.page.wrap(this.current);
      case 'type':
        return this.type;
      case 'bubbles':
        return this.type === 'click';
      default:
        return this.prevented;
    }
  }

  call(name: string): Value {
    if (name === 'stopPropagation') this.stopped = true;
    else this.prevented = true;
    return undefined;
  }
}

/** What a lab puts in `JsSpec.hosts`: a `document` built from the student's files. */
export function pageHosts(rt: Runtime, files: readonly SourceText[]): Record<string, HostObject> {
  const page = new Page(rt, files);
  const document = page.wrap(page.doc) as DocumentHost;
  const hooks: PageHooks<PageState, PageView> = {
    finish(clicks) {
      page.fire(page.doc, 'DOMContentLoaded');
      page.log.awaitingClick = !clicks.length && page.listening() > 0;
      page.log.clicking = true;
      for (const c of clicks) {
        const target = page.find(c);
        if (target) page.fire(target, 'click');
      }
      page.log.clicking = false;
    },
    state: (whole) => pageState(page.doc, files, page.listening(), whole),
    view: () => new PageView(page.doc, page.log.firstOfMany),
    notes: () => page.log.notes(),
    explain: (e) => page.log.explain(e),
  };
  document.pageHooks = hooks as PageHooks;
  return { document };
}
