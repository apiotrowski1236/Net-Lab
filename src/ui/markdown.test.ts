import { describe, expect, it } from 'vitest';
import { inlineMarkdown, renderMarkdown } from './markdown';

describe('inlineMarkdown', () => {
  it('draws **bold** and `code`, and escapes everything else', () => {
    expect(inlineMarkdown('Filter `dns`. Read **Displayed:**.')).toBe('Filter <code>dns</code>. Read <strong>Displayed:</strong>.');
    expect(inlineMarkdown('<b>hi</b> & "x" < 3 * 2')).toBe('&lt;b&gt;hi&lt;/b&gt; &amp; &quot;x&quot; &lt; 3 * 2');
  });
});

describe('renderMarkdown', () => {
  it('never turns a URL in a lesson button label into a link', () => {
    const labels = { open: 'Alice opens https://bank.example' };
    for (const live of [true, false]) {
      const html = renderMarkdown('Press [[button:open]] now.', {}, { labels, live });
      expect(html).not.toContain('<a ');
      expect(html.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))).toContain('Alice opens https://bank.example');
    }
  });
});
