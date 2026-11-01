/** Tagged template for lesson text: strips the common indentation so lab files stay readable. */
export function md(strings: TemplateStringsArray, ...values: unknown[]): string {
  let s = strings.reduce((acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ''), '');
  s = s.replace(/^\n/, '').replace(/\n\s*$/, '');
  const indents = s
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.match(/^ */)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return s
    .split('\n')
    .map((l) => l.slice(min))
    .join('\n');
}
