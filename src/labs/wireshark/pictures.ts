/**
 * Drawings of Wireshark, a terminal, and settings windows for the stage of
 * "Wireshark for Real", one per step. Each is one line of HTML, so it can sit
 * inside a note demo's markdown (a line break would end the HTML block).
 *
 * Every address in a drawing is a documentation address (192.0.2.x,
 * 198.51.100.x, 203.0.113.x), which no real school network uses, and the
 * names are made up or example ones. The answer checks in answers.ts turn
 * them away, so a student can't copy a drawing instead of doing the task.
 * Styles: "wireshark: drawings" in features.css, on top of packet-capture's
 * .ws-window. They stay light in the dark theme, like a picture of a program.
 */

/** The drawings' computer, router, and name server, and the values only a drawing has. */
export const PIC = {
  me: '192.0.2.25',
  router: '192.0.2.1',
  dns: '192.0.2.53',
  mac: 'a4:83:e7:5c:21:9f',
  routerMac: '00:1b:54:6e:0a:01',
  txid: '0x5c3d',
  /** The example site in the DNS drawing, and its address. */
  site: 'www.example.org',
  siteIp: '203.0.113.10',
  neverssl: 'calmquietmorning.neverssl.com',
  neversslIp: '198.51.100.45',
  wikiIp: '198.51.100.224',
  port: '52114',
} as const;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const fin = (color: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1 14 C5 12 8 7 9 1 C11 6 12 10 15 14 Z" fill="${color}"/></svg>`;
const square = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="#dc2626"/></svg>`;

/** A highlight ring with a label, around the part of a drawing the step is about. */
const tag = (text: string) => `<span class="ws-tag">${esc(text)}</span>`;

// ---------------------------------------------------------------------------
// Wireshark's main window
// ---------------------------------------------------------------------------

/** One packet list row: color class, then No., Time, Source, Destination, Protocol, Length, Info. */
export type Row = [cls: string, no: number, time: string, src: string, dst: string, proto: string, len: number, info: string];

/** One line of the packet details. `depth` indents it; `open` draws ▾ (opened), false draws ▸ (closed), undefined draws neither. */
export interface Detail {
  text: string;
  depth?: number;
  open?: boolean;
  /** Ring this line, with a label. */
  hi?: string;
}

export interface WindowOpts {
  /** What a screen reader says the drawing shows. */
  label: string;
  filter?: string;
  rows: Row[];
  /** Index into `rows` of the selected row. */
  selected?: number;
  details?: Detail[];
  status: { packets: number; displayed?: number };
  /** Ring a whole part, with a label. */
  hi?: Partial<Record<'toolbar' | 'filter' | 'list' | 'details' | 'status', string>>;
  /** Ring one row (index into `rows`), with a label. */
  hiRow?: [number, string];
  /** A right-click menu drawn beside the details or the list. */
  menu?: Menu;
  /** Draw the Protocol and Info cells as grey bars, so the drawing doesn't answer the question. */
  fog?: boolean;
  /** Ring one column's heading, with its name as the label. */
  hiHead?: string;
}

/** A right-click menu: the Copy item opened, with one choice ringed. */
export interface Menu {
  /** The menu's items, top to bottom. 'Copy' opens the submenu. */
  items: string[];
  /** The Copy submenu's items. */
  copy: string[];
  /** The item in `copy` to ring. */
  pick: string;
}

const part = (cls: string, inner: string, hi?: string) => `<div class="ws-part ${cls}${hi ? ' ws-hi' : ''}">${hi ? tag(hi) : ''}${inner}</div>`;

const HEAD = ['No.', 'Time', 'Source', 'Destination', 'Protocol', 'Length', 'Info'];
/** Cells of rows drawn with `fog`: Protocol and Info. */
const FOGGED = new Set([4, 6]);

const rowHtml = (cells: (string | number)[], cls: string, hi?: string, cell?: (c: string | number, i: number) => string | undefined) =>
  `<div class="ws-row ${cls}${hi ? ' ws-hi' : ''}">${hi ? tag(hi) : ''}${cells.map((c, i) => cell?.(c, i) ?? `<span>${esc(String(c))}</span>`).join('')}</div>`;

const menuHtml = (m: Menu) =>
  `<div class="ws-menu" aria-hidden="true"><div class="ws-menu-col">${m.items.map((i) => `<div class="${i === 'Copy' ? 'on' : ''}">${esc(i)}${i === 'Copy' ? ' ▸' : ''}</div>`).join('')}</div><div class="ws-menu-col">${m.copy.map((i) => `<div class="${i === m.pick ? 'on ws-hi' : ''}">${esc(i)}</div>`).join('')}</div></div>`;

/** The details menu (right-click a line under the packet list), with Copy > Value ringed. */
export const DETAIL_MENU: Menu = {
  items: ['Expand Subtrees', 'Apply as Filter', 'Follow', 'Copy', 'Show Packet Bytes'],
  copy: ['All Visible Items', 'Description', 'Field Name', 'Value', 'As Filter'],
  pick: 'Value',
};

/** The packet list menu (right-click a row), with Copy > Summary as Text ringed. */
export const ROW_MENU: Menu = {
  items: ['Mark/Unmark Packet', 'Apply as Filter', 'Conversation Filter', 'Follow', 'Copy'],
  copy: ['Summary as Text', '…as CSV', 'As Filter', 'Bytes as Hex + ASCII Dump'],
  pick: 'Summary as Text',
};

export function wsWindow(o: WindowOpts): string {
  const hi = o.hi ?? {};
  const status = `Packets: ${o.status.packets} · Displayed: ${o.status.displayed ?? o.status.packets} (${(((o.status.displayed ?? o.status.packets) / o.status.packets) * 100).toFixed(1)}%)`;
  const details = (o.details ?? [])
    .map((d) => {
      const arrow = d.open === undefined ? '<i></i>' : `<i>${d.open ? '▾' : '▸'}</i>`;
      return `<div class="ws-line${d.hi ? ' ws-hi' : ''}" style="padding-left:${(d.depth ?? 0) * 1.4}em">${d.hi ? tag(d.hi) : ''}${arrow}${esc(d.text)}</div>`;
    })
    .join('');
  return [
    `<figure class="ws-window ws-pic" role="img" aria-label="${esc(o.label)}">`,
    part('ws-toolbar', `<span class="ws-btn">${fin('#2563eb')} Start</span><span class="ws-btn">${square} Stop</span><span class="ws-btn">${fin('#16a34a')} Restart</span>`, hi.toolbar),
    part('ws-filterbar', `<span class="ws-input${o.filter ? ' ok' : ''}">${o.filter ? esc(o.filter) : 'Apply a display filter …'}</span>`, hi.filter),
    part(
      'ws-list',
      `<div class="ws-table">${rowHtml(HEAD, 'ws-head', undefined, (c) => (c === o.hiHead ? `<span class="ws-hi">${tag(String(c))}${esc(String(c))}</span>` : undefined))}${o.rows
        .map(([cls, ...cells], i) =>
          rowHtml(cells, `${cls}${i === o.selected ? ' sel' : ''}`, o.hiRow?.[0] === i ? o.hiRow[1] : undefined, (_c, j) =>
            o.fog && FOGGED.has(j) ? '<span class="ws-fog"></span>' : undefined,
          ),
        )
        .join('')}</div>${o.menu && !o.details ? menuHtml(o.menu) : ''}`,
      hi.list,
    ),
    o.details ? part('ws-details', `<div class="ws-tree">${details}</div>${o.menu ? menuHtml(o.menu) : ''}`, hi.details) : '',
    part('ws-status', `<span>${esc(status)}</span>`, hi.status),
    `</figure>`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Other windows
// ---------------------------------------------------------------------------

/** A small line graph that wiggles (traffic) or stays flat (none). */
const spark = (busy: boolean) =>
  `<svg class="ws-spark" viewBox="0 0 60 14" width="60" height="14" aria-hidden="true"><polyline fill="none" stroke="${busy ? '#16a34a' : '#94a3b8'}" stroke-width="1.5" points="${
    busy ? '0,12 6,9 10,11 15,4 20,10 26,7 31,12 36,3 41,9 47,6 52,11 60,5' : '0,12 60,12'
  }"/></svg>`;

/** Wireshark's welcome screen: the interface list, with Wi-Fi's line moving. */
export const WELCOME = [
  `<figure class="ws-window ws-pic" role="img" aria-label="A drawing of Wireshark's welcome screen. Under Capture, a list of interfaces: Wi-Fi has a moving line next to it and is ringed. Ethernet, Bluetooth, and the loopback adapter have flat lines.">`,
  part('ws-toolbar', `<b>Welcome to Wireshark</b>`),
  part('ws-filterbar', `<span class="ws-input">…using this filter: Enter a capture filter …</span>`),
  `<div class="ws-part ws-ifaces"><div class="ws-iface-list">`,
  `<div class="ws-iface ws-hi">${tag('Double-click')}<span>Wi-Fi</span>${spark(true)}</div>`,
  `<div class="ws-iface"><span>Ethernet</span>${spark(false)}</div>`,
  `<div class="ws-iface"><span>Bluetooth Network Connection</span>${spark(false)}</div>`,
  `<div class="ws-iface"><span>Adapter for loopback traffic capture</span>${spark(false)}</div>`,
  `</div></div>`,
  `</figure>`,
].join('');

/** A terminal window (Command Prompt or Terminal) showing `lines`, with one line ringed. */
export function terminal(title: string, label: string, lines: string[], hiLine?: [number, string]): string {
  return `<figure class="ws-term" role="img" aria-label="${esc(label)}"><div class="ws-term-bar">${esc(title)}</div><pre>${lines
    .map((l, i) => (hiLine?.[0] === i ? `<span class="ws-hi">${tag(hiLine[1])}${esc(l)}</span>` : esc(l)))
    // A character reference, not a newline: a blank line would end markdown's HTML block.
    .join('&#10;')}</pre></figure>`;
}

/** A settings window: a title and label: value rows, some ringed. */
export function settings(title: string, label: string, rows: [string, string, string?][]): string {
  return `<figure class="ws-settings" role="img" aria-label="${esc(label)}"><div class="ws-term-bar">${esc(title)}</div><div class="ws-kv">${rows
    .map(([k, v, hi]) => `<div class="${hi ? 'ws-hi' : ''}">${hi ? tag(hi) : ''}<span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join('')}</div></figure>`;
}

/** Wireshark's About window, with the version ringed. */
export const ABOUT = settings('About Wireshark', 'A drawing of the About Wireshark window. The line Version 4.6.1 is ringed.', [
  ['', 'Wireshark'],
  ['Version', '4.6.1 (v4.6.1-0-g0f2a1c2)', 'Copy this number'],
  ['', 'Compiled with Qt 6, with libpcap'],
]);

/** The question Wireshark asks before it throws away a capture. */
export const UNSAVED = `<figure class="ws-settings" role="img" aria-label="A drawing of Wireshark's question: Do you want to save the captured packets before quitting? Your captured packets will be lost if you don't save them. Three buttons: Save before Quit, Cancel, and Quit without Saving, which is ringed."><div class="ws-term-bar">Unsaved packets</div><div class="ws-dialog"><p><b>Do you want to save the captured packets before quitting?</b></p><p>Your captured packets will be lost if you don't save them.</p><div class="ws-dialog-btns"><span>Save before Quit</span><span>Cancel</span><span class="ws-hi">${tag('Choose this')}Quit without Saving</span></div></div></figure>`;

/** The three packets that open a TCP connection, as arrows between two computers. */
export const HANDSHAKE = `<figure class="ws-shake" role="img" aria-label="A drawing of the TCP handshake. Your computer, on port 52114, sends SYN to the web server on port 80. The server answers SYN, ACK. Your computer answers ACK. Then the GET / request goes through the open connection."><div class="ws-shake-ends"><b>Your computer</b><span>port ${PIC.port}</span><b>Web server</b><span>port 80</span></div><div class="ws-shake-arrow right"><span>1. SYN: "Can we talk?"</span></div><div class="ws-shake-arrow left"><span>2. SYN, ACK: "Sure. Ready?"</span></div><div class="ws-shake-arrow right"><span>3. ACK: "Ready."</span></div><div class="ws-shake-arrow right get"><span>Then: GET /</span></div></figure>`;

/** Step 9's drawing: one capture, and the two filters' counts. Not step 2's count, so it doesn't look like the old capture. */
export const SPLIT_NUM = { total: 1176, mine: 1043, others: 133 } as const;

/** The two filters of step 9 split one capture into two lists that add up to the whole. */
const { total, mine, others } = SPLIT_NUM;
export const SPLIT = `<figure class="ws-split" role="img" aria-label="A drawing: one capture of ${total} packets splits into ${mine} packets to or from your address, and ${others} packets that aren't. ${mine} plus ${others} is ${total}."><div class="ws-split-all">Packets: ${total}<small>the whole capture</small></div><div class="ws-split-parts"><div><code>ip.addr == ${PIC.me}</code>Displayed: ${mine}<small>to or from your computer</small></div><div><code>!(ip.addr == ${PIC.me})</code>Displayed: ${others}<small>everything else</small></div></div><div class="ws-split-sum">${mine} + ${others} = ${total}</div></figure>`;
