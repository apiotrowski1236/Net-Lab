import { BROADCAST_MAC } from './addr';
import { burstCopy } from './burst';
import { matchFilter, type FilterNode } from './displayFilter';
import type { Sim } from './sim';
import { payloadLen } from './tcp';
import type { Frame } from './types';

/**
 * Capture files (built for capture-analysis; meant for reuse).
 *
 * A capture file is a saved list of frames, like a .pcap a student opens in
 * Wireshark: numbered from 1, timed from the file's start, read without a
 * live network. Each one is made by *running scripted traffic through a
 * network* (never by hand-writing rows), so every frame has real headers:
 * real MACs, ARP, routing, TTLs, TCP flags.
 *
 * DEFINING ONE (in a lab's scenario.ts)
 *   const noon: CaptureFileDef = {
 *     id: 'noon',
 *     name: '12:00 depot.pcap',
 *     note: 'Lunch: things were slow',
 *     record: () => {
 *       const sim = build(FAST);            // a fresh network, fast timings (CAPFILE_TIMING)
 *       sim.setSniffing('analyst', true);   // the device that captures
 *       sim.schedule(2000, () => ...);      // the traffic, at real times in ms
 *       return { sim, device: 'analyst', ms: 60_000 };
 *     },
 *   };
 *   List the defs in `LabDef.captureFiles`, and offer them in a step with the
 *   tool { kind: 'capture-file', files: ['noon'] } (the Capture tab's file view).
 *
 * WHAT RECORDING DOES (loadCaptureFile, once per def; the result is cached)
 *   - Runs the network for `ms` and keeps every frame `device` captures.
 *   - Expands each `Frame.burst` (burst.ts) into its separate frames,
 *     `burstGapMs` apart (default 1), with each copy's own MAC or IP, so
 *     statistics and filters count a flood frame by frame.
 *   - Strips what a real capture can't know: `forged`, `malware`, `burst`, and
 *     the frame's `origin` (the device that built it).
 *   - Sorts by time, numbers from 1 (`no`), times from 0 (`t`, ms), and numbers
 *     TCP conversations (`ip.tcp.stream`, Wireshark's tcp.stream, from 0).
 *   It must be deterministic: build a fresh network inside `record`, and use
 *   sim.rand and sim.schedule only.
 *
 * READING ONE (pure functions over `CaptureFile.frames`)
 *   frameLen(frame)                    bytes on the wire, as Wireshark's Length column
 *   endpointStats(frames, 'eth'|'ip')  Statistics > Endpoints: packets and bytes per address
 *   conversationStats(frames, kind)    Statistics > Conversations: pairs, packets, bytes, ports used
 *   ioGraph(frames, ms, bucket, node)  Statistics > I/O Graph: packets per bucket, all and matching a filter
 *   followStream(file, stream)         Follow TCP Stream: each side's data, in order
 *   parsePacketList(text)              "412, 415", "412 and 415", "1200-1250": packet numbers a student typed
 *   Questions that check typed packet numbers: src/labs/cite.ts.
 */

/** The Statistics views a capture file offers (ui:capfile-stats). */
export type CapStatsView = 'endpoints-eth' | 'endpoints-ip' | 'conversations' | 'io';

export interface FileFrame {
  /** Packet number, from 1. */
  no: number;
  /** Ms since the file's first moment. */
  t: number;
  frame: Frame;
  /** Bytes on the wire (frameLen). */
  len: number;
}

export interface CaptureFile {
  id: string;
  name: string;
  note?: string;
  frames: FileFrame[];
  /** How long the capture ran, in ms. */
  ms: number;
}

/** What `record` hands back: a network with its traffic scheduled, and who captures. */
export interface Recording {
  sim: Sim;
  /** The device whose capture becomes the file. Turn its sniffing on in `record`. */
  device: string;
  /** How long to run, in ms. Frames after that are cut off, as when a capture stops. */
  ms: number;
  /** Time between the copies of an expanded burst. Default 1 ms. */
  burstGapMs?: number;
}

export interface CaptureFileDef {
  id: string;
  /** What the file list shows: "12:00 depot.pcap". */
  name: string;
  /** One line under the name. */
  note?: string;
  record: () => Recording;
}

/** Network timings for recording: real-world-fast links, so times in a file look like a real capture's. */
export const CAPFILE_TIMING = { linkMs: 0.2, procMs: 0.3, l2Ms: 0.05, arpTimeoutMs: 1000, pingTimeoutMs: 1000, httpTimeoutMs: 3000 };

const cache = new Map<CaptureFileDef, CaptureFile>();

/** The file a def records. The first call runs the network; later calls return the same object. */
export function loadCaptureFile(def: CaptureFileDef): CaptureFile {
  let f = cache.get(def);
  if (!f) {
    f = recordFile(def);
    cache.set(def, f);
  }
  return f;
}

function clone(f: Frame): Frame {
  return JSON.parse(JSON.stringify(f)) as Frame;
}

function recordFile(def: CaptureFileDef): CaptureFile {
  const r = def.record();
  const { sim } = r;
  const start = sim.t;
  const raw: { t: number; frame: Frame }[] = [];
  const off = sim.on((e) => {
    if (e.type === 'captured' && e.device === r.device) raw.push({ t: e.t - start, frame: clone(e.frame) });
  });
  sim.advanceTo(start + r.ms);
  off();
  const gap = r.burstGapMs ?? 1;
  const rows: { t: number; frame: Frame; k: number }[] = [];
  let k = 0;
  for (const c of raw) {
    const n = c.frame.burst?.count ?? 1;
    for (let i = 0; i < n; i++) {
      const t = c.t + i * gap;
      if (t > r.ms) break;
      const f = burstCopy(c.frame, i);
      delete f.forged;
      delete f.malware;
      f.origin = '';
      rows.push({ t, frame: f, k: k++ });
    }
  }
  rows.sort((a, b) => a.t - b.t || a.k - b.k);
  const streams = new Map<string, number>();
  const frames: FileFrame[] = rows.map((x, i) => {
    const frame = x.frame;
    frame.id = i + 1;
    const ip = frame.ip;
    if (ip?.proto === 'tcp' && ip.tcp) {
      const ends = [`${ip.src}:${ip.srcPort}`, `${ip.dst}:${ip.dstPort}`].sort().join(' ');
      if (!streams.has(ends)) streams.set(ends, streams.size);
      ip.tcp.stream = streams.get(ends)!;
    }
    return { no: i + 1, t: Math.round(x.t * 1000) / 1000, frame, len: frameLen(frame) };
  });
  return { id: def.id, name: def.name, note: def.note, frames, ms: r.ms };
}

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

/** Bytes on the wire, as Wireshark's Length column shows them (headers plus data, at least 60). */
export function frameLen(f: Frame): number {
  if (f.arp) return 42;
  const ip = f.ip;
  if (!ip) return 60;
  let body = 0;
  const a = ip.app;
  if (ip.proto === 'icmp') body = 8 + 56;
  else if (ip.proto === 'tcp') body = 20 + (ip.tcp ? payloadLen(ip) : a.kind === 'svc' ? (a.text?.length ?? 0) : 200);
  else body = 8 + (a.kind === 'dns-query' || a.kind === 'dns-answer' ? 17 + a.name.length + (a.kind === 'dns-answer' ? 16 : 0) : 40);
  return Math.max(60, 14 + 20 + body);
}

export interface EndpointRow {
  addr: string;
  packets: number;
  bytes: number;
  /** Packets it sent and received. */
  tx: number;
  rx: number;
}

/** Statistics > Endpoints: every address seen, with how many packets and bytes it sent or received. Busiest first. */
export function endpointStats(frames: FileFrame[], kind: 'eth' | 'ip'): EndpointRow[] {
  const m = new Map<string, EndpointRow>();
  const row = (addr: string) => {
    let r = m.get(addr);
    if (!r) m.set(addr, (r = { addr, packets: 0, bytes: 0, tx: 0, rx: 0 }));
    return r;
  };
  for (const c of frames) {
    const ends = kind === 'eth' ? { src: c.frame.src, dst: c.frame.dst } : c.frame.ip ? { src: c.frame.ip.src, dst: c.frame.ip.dst } : undefined;
    if (!ends) continue;
    const s = row(ends.src);
    s.packets++;
    s.bytes += c.len;
    s.tx++;
    if (ends.dst === ends.src) continue;
    const d = row(ends.dst);
    d.packets++;
    d.bytes += c.len;
    d.rx++;
  }
  return [...m.values()].sort((a, b) => b.packets - a.packets || a.addr.localeCompare(b.addr));
}

export interface ConversationRow {
  a: string;
  b: string;
  packets: number;
  bytes: number;
  /** Packets from a to b, and from b to a. */
  aToB: number;
  bToA: number;
  /** TCP and UDP ports used on the side that used more of them (a port scan knocks on many). */
  ports: number;
  /** When it started and how long it lasted, in ms. */
  start: number;
  ms: number;
}

/** Statistics > Conversations: every pair of addresses that traded packets. Busiest first. */
export function conversationStats(frames: FileFrame[], kind: 'eth' | 'ip'): ConversationRow[] {
  const m = new Map<string, ConversationRow & { pa: Set<number>; pb: Set<number> }>();
  for (const c of frames) {
    const ip = c.frame.ip;
    const ends = kind === 'eth' ? { src: c.frame.src, dst: c.frame.dst } : ip ? { src: ip.src, dst: ip.dst } : undefined;
    if (!ends) continue;
    const [a, b] = [ends.src, ends.dst].sort();
    const key = `${a} ${b}`;
    let r = m.get(key);
    if (!r) m.set(key, (r = { a, b, packets: 0, bytes: 0, aToB: 0, bToA: 0, ports: 0, start: c.t, ms: 0, pa: new Set(), pb: new Set() }));
    r.packets++;
    r.bytes += c.len;
    if (ends.src === a) r.aToB++;
    else r.bToA++;
    r.ms = c.t - r.start;
    if (ip?.srcPort !== undefined && ip.dstPort !== undefined) {
      (ends.src === a ? r.pa : r.pb).add(ip.srcPort);
      (ends.dst === a ? r.pa : r.pb).add(ip.dstPort);
    }
  }
  return [...m.values()]
    .map(({ pa, pb, ...r }) => ({ ...r, ports: Math.max(pa.size, pb.size) }))
    .sort((x, y) => y.packets - x.packets || x.a.localeCompare(y.a));
}

/** The display filter that shows one endpoint's or conversation's packets (what clicking a Statistics row applies). */
export function statsFilter(kind: 'eth' | 'ip', a: string, b?: string): string {
  const f = kind === 'eth' ? 'eth.addr' : 'ip.addr';
  return b === undefined ? `${f} == ${a}` : `${f} == ${a} && ${f} == ${b}`;
}

/**
 * Statistics > I/O Graph: packets in each `bucketMs` slice of the file, for
 * every packet and for the ones matching `node` (a parsed display filter).
 */
export function ioGraph(frames: FileFrame[], ms: number, bucketMs = 1000, node?: FilterNode | null): { all: number[]; match?: number[] } {
  const n = Math.max(1, Math.ceil(ms / bucketMs));
  const all = new Array<number>(n).fill(0);
  const match = node ? new Array<number>(n).fill(0) : undefined;
  for (const c of frames) {
    const i = Math.min(n - 1, Math.floor(c.t / bucketMs));
    all[i]++;
    if (match && matchFilter(node!, c.frame)) match[i]++;
  }
  return { all, match };
}

export interface StreamPart {
  /** 'a' is the side that opened the connection (sent the first packet). */
  from: 'a' | 'b';
  text: string;
  /** The packets this part came from. */
  nos: number[];
  /** Set for data shown as a byte count (encrypted, or no text): how many bytes. */
  bytes?: number;
}

export interface FollowedStream {
  stream: number;
  a: { ip: string; port: number };
  b: { ip: string; port: number };
  app?: string;
  encrypted: boolean;
  parts: StreamPart[];
  /** Every packet of the conversation, handshake included. */
  nos: number[];
}

/**
 * Follow TCP Stream: the data each side sent in one conversation, in order,
 * with a side's back-to-back segments joined. Encrypted data and data with no
 * text show as a byte count.
 */
export function followStream(file: CaptureFile, stream: number): FollowedStream | undefined {
  const pkts = file.frames.filter((c) => c.frame.ip?.tcp?.stream === stream);
  if (!pkts.length) return undefined;
  const first = pkts[0].frame.ip!;
  const out: FollowedStream = {
    stream,
    a: { ip: first.src, port: first.srcPort ?? 0 },
    b: { ip: first.dst, port: first.dstPort ?? 0 },
    app: first.app.kind === 'svc' ? first.app.app : undefined,
    encrypted: false,
    parts: [],
    nos: pkts.map((c) => c.no),
  };
  for (const c of pkts) {
    const ip = c.frame.ip!;
    const len = payloadLen(ip);
    if (!len) continue;
    const from = ip.src === out.a.ip && ip.srcPort === out.a.port ? 'a' : 'b';
    const text = ip.encrypted ? undefined : ip.app.kind === 'svc' ? ip.app.text : undefined;
    if (ip.encrypted) out.encrypted = true;
    const last = out.parts[out.parts.length - 1];
    if (last && last.from === from && (text === undefined) === (last.bytes !== undefined)) {
      last.nos.push(c.no);
      if (text === undefined) {
        last.bytes! += len;
        last.text = byteText(last.bytes!, ip.encrypted);
      } else last.text += last.text.endsWith('\n') ? text : `\n${text}`;
      continue;
    }
    out.parts.push(text === undefined ? { from, text: byteText(len, ip.encrypted), nos: [c.no], bytes: len } : { from, text, nos: [c.no] });
  }
  return out;
}

function byteText(n: number, encrypted?: boolean): string {
  return `(${n.toLocaleString('en-US')} bytes of ${encrypted ? 'encrypted data' : 'data with no text'})`;
}

/** The TCP stream a frame belongs to, if it has one. */
export function streamOf(f: Frame): number | undefined {
  return f.ip?.tcp?.stream;
}

/** Whether a MAC is the broadcast address. */
export const isBroadcastMac = (mac: string) => mac === BROADCAST_MAC;

/**
 * Packet numbers a student typed: "412, 415", "412 and 415", "412 or 415",
 * "412/415", "#412; #415", "412, 415." (a sentence's last period),
 * "packets 1200-1250" (a range counts every number in it). Numbers come back
 * sorted, without repeats.
 */
export function parsePacketList(text: string, maxRange = 20_000): { ok: true; nums: number[] } | { ok: false; msg: string } {
  const src = text
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\b(packets?|frames?|numbers?|no\.?|nos\.?|#)\s*/g, ' ')
    .replace(/#/g, ' ')
    .replace(/\bthrough\b|\bthru\b|\bto\b/g, '-')
    .replace(/\band\b|\bor\b|&|;|,|\+|\//g, ' ')
    // A period, colon, or bracket at the end of a number: "412." or "(412)".
    .replace(/[.:!?()[\]]+(?=\s|$)|(?<=^|\s)[([]+/g, ' ')
    .trim();
  if (!src) return { ok: false, msg: 'Type the packet numbers from the No. column, like 412, 415.' };
  const nums = new Set<number>();
  for (const part of src.replace(/\s*-\s*/g, '-').split(/\s+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return { ok: false, msg: `“${part}” isn't a packet number. Type numbers from the No. column, like 412, 415, or a range like 1200-1250.` };
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (hi - lo > maxRange) return { ok: false, msg: `The range ${lo}-${hi} is too long.` };
    for (let n = lo; n <= hi; n++) nums.add(n);
  }
  return { ok: true, nums: [...nums].sort((x, y) => x - y) };
}
