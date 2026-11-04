/**
 * A simple drawing of Wireshark's main window for step 11, as one line of
 * HTML so it can sit inside a lesson's markdown (a line break would end the
 * HTML block). Its five parts are numbered to match the list under it.
 * Styles: "packet-capture: a drawing of Wireshark's window" in features.css.
 */

const fin = (color: string) =>
  `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M1 14 C5 12 8 7 9 1 C11 6 12 10 15 14 Z" fill="${color}"/></svg>`;
const square = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="#dc2626"/></svg>`;
const num = (n: number) => `<span class="ws-num" aria-hidden="true">${n}</span>`;

/** Rows of the drawing's packet list: a DNS lookup, then TCP opening a connection, then TLS. */
const ROWS: [string, string, string, string, string, string, string, string][] = [
  ['dns', '1', '0.000', '192.168.1.10', '192.0.2.53', 'DNS', '75', 'Standard query A video.example'],
  ['dns', '2', '0.021', '192.0.2.53', '192.168.1.10', 'DNS', '91', 'Standard query response A 198.51.100.20'],
  ['tcp', '3', '0.022', '192.168.1.10', '198.51.100.20', 'TCP', '66', '52114 → 443 [SYN]'],
  ['tcp', '4', '0.047', '198.51.100.20', '192.168.1.10', 'TCP', '66', '443 → 52114 [SYN, ACK]'],
  ['tcp', '5', '0.047', '192.168.1.10', '198.51.100.20', 'TCP', '54', '52114 → 443 [ACK]'],
  ['tls sel', '6', '0.048', '192.168.1.10', '198.51.100.20', 'TLS', '571', 'Client Hello'],
];

const row = (cells: string[], cls: string) => `<div class="ws-row ${cls}">${cells.map((c) => `<span>${c}</span>`).join('')}</div>`;

export const WIRESHARK_WINDOW = [
  `<figure class="ws-window" role="img" aria-label="A drawing of Wireshark's window. From top to bottom: 1, the toolbar with Start, Stop, and Restart; 2, the filter bar; 3, the packet list; 4, the packet details; 5, the packet bytes.">`,
  `<div class="ws-part ws-toolbar">${num(1)}<span class="ws-btn">${fin('#2563eb')} Start</span><span class="ws-btn">${square} Stop</span><span class="ws-btn">${fin('#16a34a')} Restart</span></div>`,
  `<div class="ws-part ws-filterbar">${num(2)}<span class="ws-input">Apply a display filter …</span></div>`,
  `<div class="ws-part ws-list">${num(3)}<div class="ws-table">`,
  row(['No.', 'Time', 'Source', 'Destination', 'Protocol', 'Length', 'Info'], 'ws-head'),
  ...ROWS.map(([cls, ...cells]) => row(cells, cls)),
  `</div></div>`,
  `<div class="ws-part ws-details">${num(4)}<div>`,
  ['Frame 6: 571 bytes', 'Ethernet II', 'Internet Protocol Version 4', 'Transmission Control Protocol', 'Transport Layer Security'].map((t) => `<div>&gt; ${t}</div>`).join(''),
  `</div></div>`,
  `<div class="ws-part ws-bytes">${num(5)}<div><div>0000 02 00 00 00 00 01 02 00 00 00 00 21 08 00 45 00</div><div>0010 02 2d 4c 1e 40 00 40 06 9b 3a c0 a8 01 0a c6 33</div></div></div>`,
  `</figure>`,
].join('');
