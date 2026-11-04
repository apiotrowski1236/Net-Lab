import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const cache = new Map<string, string>();

/** Markdown to HTML. [[deviceId]] becomes a device chip that highlights the device on the map. */
export function renderMarkdown(src: string, labels: Record<string, string>): string {
  const key = src + '\u0000' + JSON.stringify(labels);
  const hit = cache.get(key);
  if (hit) return hit;
  const pre = src.replace(/\[\[([A-Za-z0-9_-]+)\]\]/g, (_, id: string) =>
    labels[id] ? `<span class="chip" data-device="${esc(id)}" tabindex="0" role="button">${esc(labels[id])}</span>` : esc(id),
  );
  const html = marked.parse(pre, { async: false }) as string;
  cache.set(key, html);
  return html;
}
