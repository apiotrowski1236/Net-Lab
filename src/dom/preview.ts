import { allElements, elementsIn, escapeAttr, escapeText, VOID_TAGS, type DomDocument, type DomElement, type DomNode, type DomParent } from './tree';

/** A file's name and text. */
export interface SourceText {
  name: string;
  text: string;
}

/** The page after a run, as plain JSON, so it saves with the rest of the demo's state. */
export interface PageState {
  /** Cleaned HTML of the whole body: `<body ...>...</body>`. Empty when `big`. */
  body: string;
  /** The `<style>` blocks that go in the head, with linked CSS files inlined. */
  head: string;
  /** Elements on the page that the script made. */
  made: number;
  /** Lines of JavaScript, with blank lines and comments left out. */
  lines: number;
  /** Elements that answer a click. With none, the page has no click paths and the bridge stays quiet. */
  listens: number;
  /** Too long to save. The view gets it back by running the code again. */
  big?: boolean;
}

/** Tags that never reach the frame, in any namespace. */
const DROP = new Set(['script', 'iframe', 'object', 'embed', 'applet', 'base', 'meta', 'frame', 'frameset', 'noscript', 'template', 'math', 'plaintext', 'xmp', 'noembed', 'noframes', 'link', 'title', 'head']);
/** The whole of inline SVG that a personal site needs: shapes and how they're colored. */
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'clippath', 'mask', 'pattern', 'symbol']);
const NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;
const NO_ATTRS = new Set(['srcdoc', 'formaction', 'target', 'ping', 'srcset', 'action', 'http-equiv']);

/** A value that would run code or load a page if a browser followed it. Spaces and control marks inside the scheme are skipped by browsers, so they're skipped here. */
export function unsafeUrl(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  return /^(?:javascript|vbscript|livescript|mocha|data:text\/html|data:image\/svg|data:application)/.test(v);
}

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'background', 'poster', 'cite', 'data']);

function attrsOf(e: DomElement): string {
  let out = '';
  for (const [k, v] of e.attrs) {
    const key = k.toLowerCase();
    if (!ATTR_NAME.test(k) || key.startsWith('on') || NO_ATTRS.has(key)) continue;
    if (URL_ATTRS.has(key) && unsafeUrl(v)) continue;
    out += ` ${k}="${escapeAttr(v)}"`;
  }
  return out;
}

function cleanNode(n: DomNode, path: string | undefined, out: string[]): void {
  if (n.kind === 'comment') return;
  if (n.kind === 'text') {
    out.push(escapeText(n.data));
    return;
  }
  const lower = n.tag.toLowerCase();
  if (!NAME.test(n.tag) || (n.ns === 'html' ? DROP.has(lower) : !SVG_TAGS.has(lower))) return;
  if (n.ns === 'math') return;
  out.push('<', n.tag, attrsOf(n));
  if (path !== undefined) out.push(' data-nl="', path, '"');
  out.push('>');
  if (n.ns === 'html' && VOID_TAGS.has(lower)) return;
  if (n.ns === 'html' && lower === 'style') {
    out.push(n.children.map((c) => (c.kind === 'text' ? cssText(c.data) : '')).join(''));
  } else {
    let at = 0;
    for (const c of n.children) {
      const place = c.kind === 'element' ? `${path}.${at++}` : '';
      cleanNode(c, path === undefined ? undefined : place, out);
    }
  }
  out.push('</', n.tag, '>');
}

/** Text that goes inside `<style>`, where a browser reads to the first `</style`. */
const cssText = (css: string) => css.replace(/<(?=\/?style|!--)/gi, '\\3c ');

function headOf(doc: DomDocument, files: readonly SourceText[]): string {
  const css: string[] = [];
  const add = (text: string) => css.push(`<style>${cssText(text)}</style>`);
  for (const e of allElements(doc)) {
    if (e.ns !== 'html') continue;
    if (e.tag === 'style' && !isInBody(e)) add(e.children.map((c) => (c.kind === 'text' ? c.data : '')).join(''));
    if (e.tag === 'link' && (e.attrs.get('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) {
      const name = (e.attrs.get('href') ?? '').replace(/^\.\//, '');
      const file = files.find((f) => f.name === name);
      if (file) add(file.text);
    }
  }
  return css.join('');
}

function isInBody(e: DomElement): boolean {
  for (let at: DomParent | null = e.parent; at; at = at.parent) if (at.kind === 'element' && at.tag === 'body') return true;
  return false;
}

function bodyOf(doc: DomDocument, withPaths: boolean): string {
  const out: string[] = [];
  const body = doc.body;
  if (!body) return '<body></body>';
  const at = elementsIn(doc.root).indexOf(body);
  const place = withPaths ? `${elementsIn(doc).indexOf(doc.root)}.${at}` : undefined;
  out.push('<body', attrsOf(body), place ? ` data-nl="${place}"` : '', '>');
  let i = 0;
  for (const c of body.children) cleanNode(c, c.kind === 'element' && place ? `${place}.${i++}` : undefined, out);
  out.push('</body>');
  return out.join('');
}

const MAX_SAVED = 200_000;

/** Non-blank lines that aren't only a comment. */
function codeLines(files: readonly SourceText[]): number {
  let n = 0;
  for (const f of files) {
    if (!f.name.endsWith('.js')) continue;
    const bare = f.text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const line of bare.split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('//')) n++;
    }
  }
  return n;
}

export function pageState(doc: DomDocument, files: readonly SourceText[], listens: number, keepBig = false): PageState {
  const body = bodyOf(doc, listens > 0);
  const head = headOf(doc, files);
  const made = allElements(doc).filter((e) => !e.original).length;
  const big = !keepBig && body.length + head.length > MAX_SAVED;
  return { body: big ? '' : body, head: big ? '' : head, made, lines: codeLines(files), listens, ...(big ? { big } : {}) };
}

/** The script that runs in the frame. Clicks go to the parent, and links and forms stay put. Nothing else in the frame can run. */
const BRIDGE = `
addEventListener('click', function (e) {
  var t = e.target;
  var el = t && t.closest ? t : t && t.parentElement;
  if (!el) return;
  if (el.closest('a, area, button, input, label, summary')) e.preventDefault();
  var hit = el.closest('[data-nl]');
  if (hit) parent.postMessage({ netlab: 'click', path: hit.getAttribute('data-nl'), y: scrollY }, '*');
}, true);
addEventListener('submit', function (e) { e.preventDefault(); }, true);
`;

/**
 * The whole document for the sandboxed frame. The first line of defense is the
 * frame's `sandbox`, the second is the policy here, which lets only the script
 * with this render's `nonce` run, and the third is the cleaning in this file.
 */
export function srcdoc(page: Pick<PageState, 'body' | 'head'>, options: { nonce: string; scrollY?: number }): string {
  const { nonce, scrollY } = options;
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; font-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'`;
  const scroll = scrollY ? `addEventListener('load', function () { scrollTo(0, ${Math.round(scrollY)}); });` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttr(policy)}"><script nonce="${nonce}">${BRIDGE}${scroll}</script>${page.head}</head>${page.body}</html>`;
}
