import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import type { JsError } from '../js';
import { runFiles, type PageHooks } from '../js';
import { FRAGMENTS, PAGES, SCRIPTS } from './corpus';
import { pageHosts } from './host';
import { parseFragment, parseHtml } from './html';
import { DomElement, innerHtml, insert, outerHtml } from './tree';
import type { PageView } from './view';

const short = (s: string) => JSON.stringify(s.slice(0, 80));

describe('reads a page the way a real parser does', () => {
  for (const html of PAGES) {
    test(short(html), () => {
      const real = new JSDOM(html).window.document;
      expect(outerHtml(parseHtml(html).root)).toBe(real.documentElement.outerHTML);
    });
  }
});

describe('reads innerHTML the way a real parser does', () => {
  for (const [tag, html] of FRAGMENTS) {
    test(`${tag}: ${short(html)}`, () => {
      const real = new JSDOM('<!doctype html><body>').window.document.createElement(tag);
      real.innerHTML = html;
      const mine = new DomElement(tag);
      for (const c of [...parseFragment(html, mine, false).children]) insert(mine, c);
      expect(innerHtml(mine)).toBe(real.innerHTML);
    });
  }
});

function inJsdom(html: string, js: string) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const lines: string[] = [];
  dom.window.console.log = (...args: unknown[]) => void lines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  dom.window.eval(js);
  return { page: dom.window.document.documentElement.outerHTML, lines };
}

function inEditor(html: string, js: string) {
  let page: PageHooks | undefined;
  const r = runFiles([{ name: 'script.js', text: js }], {
    hosts: (rt) => {
      const made = pageHosts(rt, [{ name: 'index.html', text: html }]);
      page = made.document.pageHooks;
      return made;
    },
    after: (rt) => page?.finish([], rt),
  });
  const error: JsError | undefined = r.error;
  return { page: error ? String(error.msg) : (page!.view() as PageView).html, lines: r.lines.map((l) => l.text) };
}

describe('runs a script the way a real page does', () => {
  for (const [html, js] of SCRIPTS) {
    test(short(js), () => {
      expect(inEditor(html, js)).toEqual(inJsdom(html, js));
    });
  }
});
