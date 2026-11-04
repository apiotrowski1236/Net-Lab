import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const cache = new Map<string, string>();

const PLAY = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" class="icon"><path d="M7 5 L19 12 L7 19 Z" fill="currentColor" stroke="none"/></svg>';

/** The step's lesson buttons, for `[[button:actionId]]` in its body. `live` draws real buttons; otherwise the label in bold (the guide). */
export type MdActions = { labels: Record<string, string>; live: boolean };

/**
 * One line of feedback to HTML: **bold** and `code` only, everything else escaped,
 * so a message can name a button or a filter the way the step body does.
 */
export function inlineMarkdown(src: string): string {
  return esc(src)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * Markdown to HTML. [[deviceId]] becomes a device chip that highlights the device on the map.
 * [[button:actionId]] becomes a copy of that lesson button, so the step can put it in its instructions.
 */
export function renderMarkdown(src: string, labels: Record<string, string>, actions?: MdActions): string {
  const key = src + '\u0000' + JSON.stringify(labels) + '\u0000' + JSON.stringify(actions ?? null);
  const hit = cache.get(key);
  if (hit) return hit;
  const pre = src
    .replace(/\[\[button:([A-Za-z0-9_-]+)\]\]/g, (_, id: string) => {
      const label = actions?.labels[id];
      if (!label) return esc(id);
      return actions.live
        ? `<button type="button" class="btn action inline-action" data-action="${esc(id)}">${PLAY} ${esc(label)}</button>`
        : `<strong>${esc(label)}</strong>`;
    })
    .replace(/\[\[([A-Za-z0-9_-]+)\]\]/g, (_, id: string) =>
      labels[id] ? `<span class="chip" data-device="${esc(id)}" tabindex="0" role="button">${esc(labels[id])}</span>` : esc(id),
    );
  const html = marked.parse(pre, { async: false }) as string;
  cache.set(key, html);
  return html;
}
