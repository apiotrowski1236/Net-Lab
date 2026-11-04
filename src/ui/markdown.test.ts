import { describe, expect, it } from 'vitest';
import { inlineMarkdown } from './markdown';

describe('inlineMarkdown', () => {
  it('draws **bold** and `code`, and escapes everything else', () => {
    expect(inlineMarkdown('Filter `dns`. Read **Displayed:**.')).toBe('Filter <code>dns</code>. Read <strong>Displayed:</strong>.');
    expect(inlineMarkdown('<b>hi</b> & "x" < 3 * 2')).toBe('&lt;b&gt;hi&lt;/b&gt; &amp; &quot;x&quot; &lt; 3 * 2');
  });
});
