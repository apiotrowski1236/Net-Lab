export { pageHosts } from './host';
export { parseHtml } from './html';
export { PAGE_RULES, type FirstOfMany } from './notes';
export { pageState, srcdoc, type PageState, type SourceText } from './preview';
export { PageNode, PageView } from './view';

import { parseHtml } from './html';
import { pageState, type PageState, type SourceText } from './preview';

/** The page from the files alone, with no script run: what the preview shows before the first Run. */
export function pageOfFiles(files: readonly SourceText[]): PageState {
  const html = files.find((f) => f.name.endsWith('.html'))?.text ?? '';
  return pageState(parseHtml(html, { fresh: (e) => (e.original = true) }), files, 0);
}
