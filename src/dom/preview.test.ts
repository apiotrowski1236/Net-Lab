import { describe, expect, test } from 'vitest';
import { pageOfFiles, srcdoc } from './index';
import { unsafeUrl } from './preview';

const page = (html: string, css = '') => pageOfFiles([{ name: 'index.html', text: html }, { name: 'style.css', text: css }]);

describe('nothing in the student page can run', () => {
  const body = (html: string) => page(html).body;

  test('script tags go, in the body, in the head, and inside svg', () => {
    expect(body('<p>a</p><script>alert(1)</script>')).toBe('<body><p>a</p></body>');
    expect(body('<svg><script>alert(1)</script><circle r="1"></circle></svg>')).toBe('<body><svg><circle r="1"></circle></svg></body>');
    expect(page('<head><script>alert(1)</script></head>').head).toBe('');
  });

  test('inline handlers go, in any capitalization', () => {
    expect(body('<img src="a.png" onerror="alert(1)" ONCLICK=x OnLoad=y><div onmouseover=z>a</div>')).toBe('<body><img src="a.png"><div>a</div></body>');
    expect(body('<svg onload="alert(1)"><rect onclick="x"></rect></svg>')).toBe('<body><svg><rect></rect></svg></body>');
  });

  test('tags that load or run another document go', () => {
    expect(body('<iframe src="x"></iframe><object data="x"></object><embed src="x"><base href="x"><meta http-equiv="refresh" content="0"><noscript>b</noscript>')).toBe('<body></body>');
  });

  test('javascript urls go, however they are dressed up', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)', 'vbscript:x', 'data:text/html,<script>alert(1)</script>']) expect(unsafeUrl(url)).toBe(true);
    expect(body('<a href="JAVA&#10;SCRIPT:alert(1)">a</a>')).toBe('<body><a>a</a></body>');
    expect(body('<svg><a xlink:href="javascript:alert(1)"></a></svg>')).not.toContain('javascript');
  });

  test('normal urls stay', () => {
    for (const url of ['page.html', '#top', 'https://example.com/a.png', 'data:image/png;base64,AAAA', 'mailto:a@b.c']) expect(unsafeUrl(url)).toBe(false);
    expect(body('<a href="#top">a</a><img src="me.png" alt="Me">')).toBe('<body><a href="#top">a</a><img src="me.png" alt="Me"></body>');
  });

  test('an attribute that navigates or fetches goes', () => {
    expect(body('<a href="x" target="_top" ping="y">a</a><form action="x"><button formaction="y">b</button></form>')).toBe('<body><a href="x">a</a><form><button>b</button></form></body>');
  });

  test('text cannot break out of its tag or attribute', () => {
    expect(body('<p title="&quot;><script>alert(1)</script>">&lt;script&gt;</p>')).toBe('<body><p title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">&lt;script&gt;</p></body>');
  });

  test('a strange tag name stops at the door', () => {
    expect(body('<x/y onclick=1>a</x/y>')).not.toContain('onclick');
  });

  test('math stays out', () => {
    expect(body('<math><mi>x</mi></math><p>a</p>')).toBe('<body><p>a</p></body>');
  });

  test('css cannot close its style tag', () => {
    const p = page('<link rel="stylesheet" href="style.css"><p>a</p>', 'p { color: red; } </style><script>alert(1)</script>');
    expect(p.head).not.toContain('</style><script>');
    expect(p.head.match(/<\/style>/g)).toHaveLength(1);
  });

  test('an inline style tag keeps its text', () => {
    expect(page('<style>p > b { color: red; }</style><p>a</p>').head).toBe('<style>p > b { color: red; }</style>');
  });
});

describe('the stylesheet follows the HTML', () => {
  test('a linked file is inlined', () => {
    expect(page('<link rel="stylesheet" href="style.css"><p>a</p>', 'p { color: red; }').head).toBe('<style>p { color: red; }</style>');
    expect(page('<link rel="stylesheet" href="./style.css">', 'b { color: red; }').head).toContain('b { color');
  });

  test('a file the page does not link stays out, as in a browser', () => {
    expect(page('<p>a</p>', 'p { color: red; }').head).toBe('');
  });

  test('an outside stylesheet stays out', () => {
    expect(page('<link rel="stylesheet" href="https://example.com/x.css"><p>a</p>').head).toBe('');
  });
});

describe('the frame document', () => {
  const doc = srcdoc({ body: '<body><p>a</p></body>', head: '<style>p { color: red; }</style>' }, { nonce: 'abc123', scrollY: 40 });

  test('the policy comes first, and allows only the script with this nonce', () => {
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script'));
    expect(doc).toContain('script-src &#39;nonce-abc123&#39;'.replace(/&#39;/g, "'"));
    expect(doc).toContain('<script nonce="abc123">');
    expect(doc).toContain('default-src');
    expect(doc).toContain('form-action');
    expect(doc).toContain('base-uri');
  });

  test('the bridge keeps links and forms in place', () => {
    expect(doc).toContain('preventDefault');
    expect(doc).toContain("'submit'");
  });

  test('it goes back to the scroll position it had', () => {
    expect(doc).toContain('scrollTo(0, 40)');
  });
});

describe('the counts', () => {
  test('lines leave out blank lines and comments', () => {
    const p = pageOfFiles([{ name: 'index.html', text: '<p>a</p>' }, { name: 'script.js', text: '// top\nlet a = 1;\n\n/* block\n   here */\nlet b = 2; // end\n' }]);
    expect(p.lines).toBe(2);
  });
});
