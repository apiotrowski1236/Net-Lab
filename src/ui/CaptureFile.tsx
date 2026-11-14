import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import type { ToolSpec } from '../labs/types';
import { Sim } from '../sim/sim';
import { matchFilter, parseFilter } from '../sim/displayFilter';
import {
  conversationStats,
  endpointStats,
  followStream,
  ioGraph,
  loadCaptureFile,
  statsFilter,
  type CapStatsView,
  type CaptureFile,
  type CaptureFileDef,
} from '../sim/capfile';
import { PROTO_COLOR, endpoints, infoOf, layersOf, protoOf } from './describe';
import { WIRESHARK_PROTO } from './Dock';
import { Icon } from './icons';

/**
 * The Capture tab for saved capture files (capture-analysis; reusable).
 *
 * A step that offers { kind: 'capture-file', device, files, filter?, stats?, follow? }
 * shows this instead of the live capture: a file picker, Wireshark's display
 * filter bar, a packet list that stays fast at thousands of rows (only the
 * rows on screen are drawn), the open packet's layers, the Statistics views
 * (Endpoints, Conversations, I/O Graph), and Follow TCP Stream. Clicking a
 * Statistics row filters the list to it, the way Wireshark's "Apply as
 * Filter" does. Every view reports a UiEvent (labs/types.ts) for goals:
 * ui:open-capfile, ui:capfile-filter, ui:open-packet, ui:capfile-stats,
 * ui:follow-stream. Helpers to check them are in labs/helpers.ts.
 *
 * Device names never show: the file is a recording, so the packet layers
 * name no device (an analyst reads MACs and addresses, then looks them up).
 */

type View = 'packets' | CapStatsView | 'follow';

interface FileState {
  file: string;
  filter: string;
  view: View;
  selected: number | null;
  stream: number | null;
  top: number;
}

/** What each session last had open, so switching tabs doesn't lose the student's place. */
const remembered = new WeakMap<LabSession, Record<string, FileState>>();

/** Layers are drawn against an empty network, so no device names appear. */
const NOBODY = new Sim();

const ROW = 30;
const OVERSCAN = 12;

const STATS: { view: CapStatsView; label: string }[] = [
  { view: 'endpoints-eth', label: 'Endpoints: Ethernet' },
  { view: 'endpoints-ip', label: 'Endpoints: IPv4' },
  { view: 'conversations', label: 'Conversations' },
  { view: 'io', label: 'I/O Graph' },
];

const n = (x: number) => x.toLocaleString('en-US');
const secs = (ms: number) => (ms / 1000).toFixed(3);

export function CaptureFileView({ session, tool }: { session: LabSession; tool: Extract<ToolSpec, { kind: 'capture-file' }> }) {
  void session.rev.value;
  const lab = session.lab;
  const defs = tool.files.map((id) => lab.captureFiles?.find((f) => f.id === id)).filter((d): d is CaptureFileDef => !!d);
  const store = remembered.get(session) ?? {};
  remembered.set(session, store);
  const key = session.step.id;
  const first = (): FileState => ({ file: defs[0]?.id ?? '', filter: '', view: 'packets', selected: null, stream: null, top: 0 });
  const [st, setSt] = useState<FileState>(() => {
    const s = store[key];
    return s && defs.some((d) => d.id === s.file) ? s : first();
  });
  const set = (p: Partial<FileState>) =>
    setSt((s) => {
      const next = { ...s, ...p };
      store[key] = next;
      return next;
    });
  // A new step starts on its own first file.
  useEffect(() => {
    const s = store[key];
    setSt(s && defs.some((d) => d.id === s.file) ? s : first());
  }, [key]);

  const def = defs.find((d) => d.id === st.file) ?? defs[0];
  // Recording a file runs the network for a minute of its time: a moment the first time, then cached.
  const file = useMemo(() => (def ? loadCaptureFile(def) : undefined), [def]);
  // Opening the tab (or another file) is something the step can check.
  useEffect(() => {
    if (def) session.ui({ type: 'ui:open-capfile', file: def.id });
  }, [def?.id, key]);

  if (!def || !file) return <div class="dock-empty">No capture file in this step.</div>;

  const applied = tool.filter ? st.filter : '';
  // A filter typed on the I/O Graph stays there, so the darker bars show what it matches.
  const applyFilter = (text: string, stay = false) => {
    set({ filter: text, view: stay && st.view === 'io' ? 'io' : 'packets', top: 0 });
    session.ui({ type: 'ui:capfile-filter', file: def.id, filter: text });
  };
  const openStats = (view: CapStatsView) => {
    set({ view });
    session.ui({ type: 'ui:capfile-stats', file: def.id, view });
  };
  // A click on an I/O Graph bar opens the Packet list at that second.
  const jumpTo = (second: number) => {
    const p = parseFilter(applied);
    const node = p.ok ? p.node : null;
    const rows = node ? file.frames.filter((c) => matchFilter(node, c.frame)) : file.frames;
    const i = rows.findIndex((c) => c.t >= second * 1000);
    set({ view: 'packets', top: Math.max(0, (i < 0 ? rows.length : i) * ROW) });
  };
  const follow = (stream: number) => {
    set({ view: 'follow', stream });
    session.ui({ type: 'ui:follow-stream', file: def.id, stream });
  };

  return (
    <div class="capture capfile">
      <div class="capture-tools capfile-tools" data-capture-tools>
        <button
          type="button"
          class="btn small skip-link"
          onClick={() => (document.querySelector<HTMLElement>('.lesson .actions .btn.action') ?? document.querySelector<HTMLElement>('.lesson .step-title'))?.focus()}
        >
          Back to the lesson
        </button>
        <div class="capfile-head">
        <div class="capfile-files" role="group" aria-label="Capture file">
          <Icon name="list" size={14} />
          {defs.length > 1 ? (
            <select
              value={def.id}
              aria-label="Capture file"
              onChange={(e) => set({ file: (e.target as HTMLSelectElement).value, filter: '', view: 'packets', selected: null, stream: null, top: 0 })}
            >
              {defs.map((d) => (
                <option value={d.id}>{d.name}</option>
              ))}
            </select>
          ) : (
            <strong class="mono">{def.name}</strong>
          )}
          <span class="muted">
            {n(file.frames.length)} packets · {Math.round(file.ms / 1000)} seconds{def.note && ` · ${def.note}`}
          </span>
        </div>
        {tool.stats && (
          <div class="capfile-views" role="group" aria-label="Views">
            <span class="muted">Statistics:</span>
            <button type="button" class={`btn tiny ${st.view === 'packets' ? 'on' : ''}`} aria-pressed={st.view === 'packets'} onClick={() => set({ view: 'packets' })}>
              Packet list
            </button>
            {STATS.map((s) => (
              <button type="button" class={`btn tiny ${st.view === s.view ? 'on' : ''}`} aria-pressed={st.view === s.view} onClick={() => openStats(s.view)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        </div>
        {tool.filter && <FilterBar key={`${key}/${def.id}`} applied={applied} onApply={(t) => applyFilter(t, true)} />}
      </div>
      {st.view === 'packets' && (
        <PacketList
          session={session}
          file={file}
          filter={applied}
          selected={st.selected}
          top={st.top}
          onSelect={(no) => {
            set({ selected: no });
            const c = file.frames[no - 1];
            session.ui({ type: 'ui:open-packet', file: def.id, no, frame: c.frame });
          }}
          onScroll={(top) => (store[key] = { ...(store[key] ?? st), top })}
          onFollow={tool.follow ? follow : undefined}
        />
      )}
      {(st.view === 'endpoints-eth' || st.view === 'endpoints-ip') && (
        <EndpointsView file={file} kind={st.view === 'endpoints-eth' ? 'eth' : 'ip'} onFilter={tool.filter ? applyFilter : undefined} />
      )}
      {st.view === 'conversations' && <ConversationsView file={file} onFilter={tool.filter ? applyFilter : undefined} />}
      {st.view === 'io' && <IoGraph file={file} filter={applied} onJump={jumpTo} />}
      {st.view === 'follow' && st.stream !== null && (
        <FollowView file={file} stream={st.stream} onBack={() => set({ view: 'packets' })} onFilter={tool.filter ? applyFilter : undefined} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function FilterBar({ applied, onApply }: { applied: string; onApply: (text: string) => void }) {
  const [draft, setDraft] = useState(applied);
  const [tried, setTried] = useState(false);
  // A Statistics row can set the filter: show what it set.
  useEffect(() => setDraft(applied), [applied]);
  const check = parseFilter(draft);
  const state = !draft.trim() ? '' : check.ok ? 'valid' : 'invalid';
  const apply = (text: string) => {
    if (!parseFilter(text).ok) return setTried(true);
    setTried(false);
    onApply(text.trim());
  };
  return (
    <>
      <form
        class={`capture-filter ${state}`}
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
      >
        <Icon name="filter" size={14} />
        <input
          class="mono"
          value={draft}
          placeholder="Apply a display filter, like icmp"
          aria-label="Display filter"
          aria-invalid={state === 'invalid'}
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          onInput={(e) => {
            setDraft((e.target as HTMLInputElement).value);
            setTried(false);
          }}
        />
        {state && (
          <span class={`filter-state ${state}`}>
            <Icon name={state === 'valid' ? 'check' : 'x'} size={12} /> {state === 'valid' ? 'OK' : 'Error'}
          </span>
        )}
        <button type="submit" class="btn tiny">
          Apply
        </button>
        {(applied || draft) && (
          <button
            type="button"
            class="btn tiny"
            aria-label="Clear the filter"
            onClick={() => {
              setDraft('');
              apply('');
            }}
          >
            <Icon name="x" size={12} /> Clear
          </button>
        )}
      </form>
      {tried && !check.ok && (
        <div class="filter-msg">
          <div>{check.msg}</div>
          {applied && <div>The list still shows your last filter that worked: {applied}</div>}
        </div>
      )}
      {applied && applied !== draft.trim() && check.ok && <div class="filter-msg muted">Press Enter to apply. Still showing: {applied}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Packet list (only the rows on screen are drawn)
// ---------------------------------------------------------------------------

function PacketList({
  session,
  file,
  filter,
  selected,
  top,
  onSelect,
  onScroll,
  onFollow,
}: {
  session: LabSession;
  file: CaptureFile;
  filter: string;
  selected: number | null;
  top: number;
  onSelect: (no: number) => void;
  onScroll: (top: number) => void;
  onFollow?: (stream: number) => void;
}) {
  const lab = session.lab;
  const rows = useMemo(() => {
    const p = parseFilter(filter);
    const node = p.ok ? p.node : null;
    return node ? file.frames.filter((c) => matchFilter(node, c.frame)) : file.frames;
  }, [file, filter]);
  // A file with frames that carry no IP (ARP, a MAC flood) shows MAC addresses as Source and Destination: give them room.
  const macs = useMemo(() => file.frames.some((c) => !c.frame.ip), [file]);
  const listRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(top);
  const [height, setHeight] = useState(400);
  const focusNo = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = top;
    setScroll(el.scrollTop);
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [file, filter]);
  // Arrow keys move to a row that may not be drawn yet: focus it once it is.
  useLayoutEffect(() => {
    if (focusNo.current === null) return;
    listRef.current?.querySelector<HTMLElement>(`tr[data-no="${focusNo.current}"]`)?.focus({ preventScroll: true });
    focusNo.current = null;
  });

  const from = Math.max(0, Math.floor(scroll / ROW) - OVERSCAN);
  const to = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + OVERSCAN);
  const sel = selected !== null ? rows.find((r) => r.no === selected) : undefined;
  const stream = sel?.frame.ip?.tcp?.stream;

  const moveTo = (i: number) => {
    const c = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!c) return;
    const el = listRef.current!;
    const y = rows.indexOf(c) * ROW;
    const head = 34;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW + head > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW + head - el.clientHeight;
    focusNo.current = c.no;
    onSelect(c.no);
  };

  return (
    <div class="capture-split capfile-split">
      <div
        class="capture-list capfile-list"
        ref={listRef}
        onScroll={(e) => {
          const t = (e.currentTarget as HTMLDivElement).scrollTop;
          setScroll(t);
          onScroll(t);
        }}
      >
        <table class={`table capture-table capfile-table ${macs ? 'wide-addr' : ''}`}>
          <thead>
            <tr>
              <th class="no">No.</th>
              <th class="time">Time</th>
              <th class="addr">Source</th>
              <th class="addr">Destination</th>
              <th class="proto-col">Protocol</th>
              <th class="len">Length</th>
              <th>Info</th>
            </tr>
          </thead>
          <tbody>
            {from > 0 && <tr class="capfile-pad" aria-hidden="true" style={{ height: `${from * ROW}px` }} />}
            {rows.slice(from, to).map((c, k) => {
              const i = from + k;
              const proto = protoOf(c.frame);
              const { src, dst } = endpoints(c.frame);
              return (
                <tr
                  key={c.no}
                  data-no={c.no}
                  class={selected === c.no ? 'selected' : ''}
                  tabIndex={0}
                  aria-selected={selected === c.no}
                  onClick={() => onSelect(c.no)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(c.no);
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      moveTo(i + (e.key === 'ArrowDown' ? 1 : -1));
                    }
                  }}
                >
                  <td class="no">{c.no}</td>
                  <td class="mono time">{secs(c.t)}</td>
                  <td class="mono" title={src}>
                    {src}
                  </td>
                  <td class="mono" title={dst}>
                    {dst}
                  </td>
                  <td class="proto-col">
                    <span class="proto" style={{ background: PROTO_COLOR[proto] }}>
                      {(lab.wireshark && WIRESHARK_PROTO[proto]) || proto}
                    </span>
                  </td>
                  <td class="mono len">{c.len}</td>
                  <td class="mono info" title={infoOf(c.frame)}>
                    {infoOf(c.frame)}
                  </td>
                </tr>
              );
            })}
            {to < rows.length && <tr class="capfile-pad" aria-hidden="true" style={{ height: `${(rows.length - to) * ROW}px` }} />}
          </tbody>
        </table>
        {rows.length === 0 && <p class="muted capture-none">No packets match this filter.</p>}
      </div>
      <div class="capture-detail-col">
        <div class="capture-detail">
          {sel ? (
            <>
              <div class="capfile-detail-head">
                <strong>Packet {sel.no}</strong>
                <span class="muted">
                  {secs(sel.t)} s · {sel.len} bytes
                </span>
                {onFollow && stream !== undefined && (
                  <button type="button" class="btn tiny" onClick={() => onFollow(stream)}>
                    Follow TCP Stream
                  </button>
                )}
              </div>
              {layersOf(NOBODY, sel.frame).map((l) => (
                <div class={`layer ${l.locked ? 'locked' : ''}`} style={{ borderLeftColor: l.color }}>
                  <div class="layer-title" style={{ color: l.color }}>
                    {l.locked && <Icon name="lock" size={14} />} {l.title}
                  </div>
                  {lab.wireshark && l.ws && <div class="layer-ws">Wireshark: {l.ws}</div>}
                  <table>
                    <tbody>
                      {l.rows.map(([k, v, note]) => (
                        <tr class={k ? '' : 'sub'}>
                          <td class="k">{k}</td>
                          <td class={`v mono ${l.locked ? 'gib' : ''}`}>
                            {v} {note && <span class="muted">{note}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {l.note && <div class="layer-note">{l.note}</div>}
                </div>
              ))}
            </>
          ) : (
            <div class="dock-empty small">
              <p>{rows.length ? 'Click a packet, or Tab to it and press Enter, to open it up. Arrow keys move up and down the list.' : 'No packet to open.'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

type Col<T> = { key: string; label: string; num?: boolean; get: (r: T) => string | number; show?: (r: T) => string };

function SortTable<T>({ rows, cols, initial, caption, onRow, rowLabel }: {
  rows: T[];
  cols: Col<T>[];
  initial: string;
  caption: string;
  onRow?: (r: T) => void;
  rowLabel?: (r: T) => string;
}) {
  const [sort, setSort] = useState<{ key: string; down: boolean }>({ key: initial, down: true });
  const col = cols.find((c) => c.key === sort.key) ?? cols[0];
  const sorted = [...rows].sort((a, b) => {
    const x = col.get(a);
    const y = col.get(b);
    const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
    return sort.down ? -d : d;
  });
  return (
    <div class="capture-list capfile-stats">
      <table class="table capfile-stats-table">
        <caption class="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {cols.map((c) => (
              <th class={c.num ? 'num' : ''} aria-sort={sort.key === c.key ? (sort.down ? 'descending' : 'ascending') : undefined}>
                <button type="button" class="capfile-sort" onClick={() => setSort({ key: c.key, down: sort.key === c.key ? !sort.down : !!c.num })}>
                  {c.label}
                  {sort.key === c.key && (
                    <span class={`capfile-arrow ${sort.down ? '' : 'up'}`} aria-hidden="true">
                      <Icon name="chevronDown" size={12} />
                    </span>
                  )}
                </button>
              </th>
            ))}
            {onRow && <th class="visually-hidden">Filter</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr>
              {cols.map((c) => (
                <td class={c.num ? 'num mono' : 'mono'}>{c.show ? c.show(r) : typeof c.get(r) === 'number' ? n(c.get(r) as number) : c.get(r)}</td>
              ))}
              {onRow && (
                <td class="capfile-act">
                  <button type="button" class="btn tiny" aria-label={`Filter on ${rowLabel?.(r) ?? 'this row'}`} onClick={() => onRow(r)}>
                    <Icon name="filter" size={12} /> Filter
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointsView({ file, kind, onFilter }: { file: CaptureFile; kind: 'eth' | 'ip'; onFilter?: (f: string) => void }) {
  const rows = useMemo(() => endpointStats(file.frames, kind), [file, kind]);
  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { key: 'addr', label: kind === 'eth' ? 'MAC address' : 'IP address', get: (r) => r.addr },
    { key: 'packets', label: 'Packets', num: true, get: (r) => r.packets },
    { key: 'bytes', label: 'Bytes', num: true, get: (r) => r.bytes },
    { key: 'tx', label: 'Packets sent', num: true, get: (r) => r.tx },
    { key: 'rx', label: 'Packets received', num: true, get: (r) => r.rx },
  ];
  return (
    <>
      <p class="capfile-stats-head muted">
        {n(rows.length)} {kind === 'eth' ? 'MAC addresses' : 'IP addresses'} in {file.name}. Click a column to sort by it.
      </p>
      <SortTable
        key={kind}
        rows={rows}
        cols={cols}
        initial="packets"
        caption={`Endpoints by ${kind === 'eth' ? 'MAC' : 'IP'} address`}
        onRow={onFilter && ((r) => onFilter(statsFilter(kind, r.addr)))}
        rowLabel={(r) => r.addr}
      />
    </>
  );
}

function ConversationsView({ file, onFilter }: { file: CaptureFile; onFilter?: (f: string) => void }) {
  const rows = useMemo(() => conversationStats(file.frames, 'ip'), [file]);
  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { key: 'a', label: 'Address A', get: (r) => r.a },
    { key: 'b', label: 'Address B', get: (r) => r.b },
    { key: 'packets', label: 'Packets', num: true, get: (r) => r.packets },
    { key: 'bytes', label: 'Bytes', num: true, get: (r) => r.bytes },
    { key: 'aToB', label: 'A → B', num: true, get: (r) => r.aToB },
    { key: 'bToA', label: 'B → A', num: true, get: (r) => r.bToA },
    { key: 'ports', label: 'Ports', num: true, get: (r) => r.ports },
    { key: 'start', label: 'Start (s)', num: true, get: (r) => r.start, show: (r) => secs(r.start) },
    { key: 'ms', label: 'Duration (s)', num: true, get: (r) => r.ms, show: (r) => secs(r.ms) },
  ];
  return (
    <>
      <p class="capfile-stats-head muted">
        {n(rows.length)} conversations between IP addresses in {file.name}. <strong>Ports</strong> counts the different port numbers one side used. Click a column to sort by it.
      </p>
      <SortTable
        rows={rows}
        cols={cols}
        initial="packets"
        caption="Conversations between IP addresses"
        onRow={onFilter && ((r) => onFilter(statsFilter('ip', r.a, r.b)))}
        rowLabel={(r) => `${r.a} and ${r.b}`}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// I/O Graph: packets per second, with the filter's packets drawn over them
// ---------------------------------------------------------------------------

function IoGraph({ file, filter, onJump }: { file: CaptureFile; filter: string; onJump: (second: number) => void }) {
  const p = parseFilter(filter);
  const node = p.ok ? p.node : null;
  const g = useMemo(() => ioGraph(file.frames, file.ms, 1000, node), [file, filter]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(10, ...g.all);
  const step = max > 200 ? 100 : max > 100 ? 50 : max > 40 ? 20 : 10;
  const top = Math.ceil(max / step) * step;
  // Draw at the box's real size, so the graph fits the dock and the text stays its normal size.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 720, h: 240 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(320, el.clientWidth), h: Math.max(110, el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = size.w;
  const H = size.h;
  const L = 44;
  const B = 28;
  const T = 10;
  const pw = W - L - 8;
  const ph = H - B - T;
  const bw = pw / g.all.length;
  const y = (v: number) => T + ph - (v / top) * ph;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const xEvery = g.all.length > 40 ? 10 : 5;
  const bar = (i: number, v: number, cls: string) => {
    if (!v) return null;
    const x = L + i * bw + 1;
    const w = Math.max(1, bw - 2);
    const h = (v / top) * ph;
    const r = Math.min(4, w / 2, h);
    // Rounded at the data end, square at the baseline.
    const d = `M${x},${T + ph} V${T + ph - h + r} Q${x},${T + ph - h} ${x + r},${T + ph - h} H${x + w - r} Q${x + w},${T + ph - h} ${x + w},${T + ph - h + r} V${T + ph} Z`;
    return <path class={cls} d={d} />;
  };
  const tip = hover !== null ? { s: hover, all: g.all[hover], match: g.match?.[hover] } : null;
  const tipX = tip ? L + tip.s * bw + bw / 2 : 0;
  return (
    <div class="capfile-io">
      <p class="capfile-stats-head muted">
        Packets per second in {file.name}. {node ? 'The filter’s packets are drawn darker, over all packets.' : 'Apply a display filter to see how much of each spike it matches.'}{' '}
        Point at a bar to see its numbers, and click it to open the Packet list at that second.
      </p>
      {g.match && (
        <div class="capfile-legend" aria-hidden="true">
          <span>
            <i class="io-all" /> All packets
          </span>
          <span>
            <i class="io-match" /> Matching <code>{filter}</code>
          </span>
        </div>
      )}
      <div class="capfile-io-box" ref={box}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Packets per second over ${g.all.length} seconds. The busiest second has ${n(Math.max(...g.all))} packets.`} onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g>
              <line class="io-grid" x1={L} x2={W - 8} y1={y(v)} y2={y(v)} />
              <text class="io-tick" x={L - 6} y={y(v) + 4} text-anchor="end">
                {v}
              </text>
            </g>
          ))}
          {g.all.map((v, i) => bar(i, v, 'io-all'))}
          {g.match?.map((v, i) => bar(i, v, 'io-match'))}
          {g.all.map((_, i) =>
            i % xEvery === 0 ? (
              <text class="io-tick" x={L + i * bw + bw / 2} y={H - 8} text-anchor="middle">
                {i}s
              </text>
            ) : null,
          )}
          {g.all.map((_, i) => (
            <rect class="io-hit" x={L + i * bw} y={T} width={bw} height={ph} onMouseEnter={() => setHover(i)} onClick={() => onJump(i)} />
          ))}
          {tip && <line class="io-cross" x1={L + tip.s * bw + bw / 2} x2={L + tip.s * bw + bw / 2} y1={T} y2={T + ph} />}
        </svg>
        {tip && (
          <div class="capfile-tip" style={{ left: `${tipX}px`, transform: tipX < 80 ? 'none' : tipX > W - 80 ? 'translateX(-100%)' : undefined }}>
            <strong>
              {tip.s} to {tip.s + 1} s
            </strong>
            <div>{n(tip.all)} packets</div>
            {tip.match !== undefined && <div>{n(tip.match)} match the filter</div>}
          </div>
        )}
      </div>
      <details class="capfile-io-table">
        <summary>Show the numbers as a table</summary>
        <table class="table">
          <thead>
            <tr>
              <th>Second</th>
              <th class="num">Packets</th>
              {g.match && <th class="num">Matching</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {g.all.map((v, i) => (
              <tr>
                <td>
                  {i} to {i + 1}
                </td>
                <td class="num mono">{n(v)}</td>
                {g.match && <td class="num mono">{n(g.match[i])}</td>}
                <td class="capfile-act">
                  <button type="button" class="btn tiny" onClick={() => onJump(i)}>
                    Packets
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow TCP Stream
// ---------------------------------------------------------------------------

function FollowView({ file, stream, onBack, onFilter }: { file: CaptureFile; stream: number; onBack: () => void; onFilter?: (f: string) => void }) {
  const s = useMemo(() => followStream(file, stream), [file, stream]);
  if (!s) return <div class="dock-empty">No TCP stream {stream} in this file.</div>;
  const a = `${s.a.ip}:${s.a.port}`;
  const b = `${s.b.ip}:${s.b.port}`;
  return (
    <div class="capfile-follow">
      <div class="capfile-follow-head">
        <strong>Follow TCP Stream {stream}</strong>
        <span class="muted">
          {s.app ? `${s.app}, ` : ''}
          {n(s.nos.length)} packets, {s.nos[0]} to {s.nos[s.nos.length - 1]}
        </span>
        <span class="capfile-follow-btns">
          {onFilter && (
            <button type="button" class="btn tiny" onClick={() => onFilter(`tcp.stream == ${stream}`)}>
              <Icon name="filter" size={12} /> Show these packets
            </button>
          )}
          <button type="button" class="btn tiny" onClick={onBack}>
            Back to the packet list
          </button>
        </span>
      </div>
      <div class="capfile-legend">
        <span>
          <i class="side-a" /> {a} (started it)
        </span>
        <span>
          <i class="side-b" /> {b}
        </span>
      </div>
      {s.encrypted && <p class="callout capfile-locked">This conversation is encrypted (TLS). You can see who talked and how much, but not what they said.</p>}
      <div class="capfile-stream" tabIndex={0} aria-label={`The conversation between ${a} and ${b}`}>
        {s.parts.length === 0 && <p class="muted">The two sides connected and hung up without sending any data.</p>}
        {s.parts.map((p) => (
          <div class={`stream-part side-${p.from} ${p.bytes !== undefined ? 'bytes' : ''}`}>
            <span class="stream-who">
              {p.from === 'a' ? a : b} · packet{p.nos.length > 1 ? 's' : ''} {p.nos.length > 1 ? `${p.nos[0]} to ${p.nos[p.nos.length - 1]}` : p.nos[0]}
            </span>
            <pre class="mono">{p.text}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
