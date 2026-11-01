import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Sim } from '../sim/sim';
import type { BrowserState, Device, InFlight, SimEvent } from '../sim/types';
import { FORGED_COLOR, PROTO_COLOR, protoOf } from './describe';
import { DeviceGlyph, Icon } from './icons';
import { portName } from '../runtime/toolInput';

/** Device currently hovered in the lesson text (device chips) — highlighted on the map. */
export const hoverDevice = signal<string | null>(null);

const MARKER_MS = 1800;
/** Where a packet died stays up longer: it's usually the thing to notice. */
const FAIL_MARKER_MS = 6000;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frame the map tightly around the devices, leaving room for labels below and markers above. */
function fitBox(devices: Device[], extraLines = 0): Box {
  const xs = devices.map((d) => d.x);
  const ys = devices.map((d) => d.y);
  const x = Math.min(...xs) - 95;
  const y = Math.min(...ys) - 105;
  return { x, y, w: Math.max(...xs) + 95 - x, h: Math.max(...ys) + 80 + extraLines * 16 - y };
}

/** The lines under a device's name: its sublabel, or (for labs where students build the network) its live addresses. */
function sublines(d: Device, addresses: boolean): { text: string; muted?: boolean }[] {
  if (!addresses || (d.kind !== 'host' && d.kind !== 'router')) return d.sublabel ? [{ text: d.sublabel }] : [];
  const set = d.ifaces.filter((i) => i.ip);
  if (!set.length) return [{ text: 'no IP address', muted: true }];
  if (d.kind === 'host') return set.map((i) => ({ text: `${i.ip}/${i.prefix}` }));
  return set.map((i) => ({ text: `${portName(i.id)}: ${i.ip}/${i.prefix}` }));
}

/**
 * Where a port's name tag sits on a cable: just clear of the device's card and
 * the name and addresses under it, toward the other end.
 */
function portTagPos(from: Device, to: Device, lines: { text: string }[], tagHalfW: number): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // The card, then the text block under it (bold name, then monospace address lines).
  const textHalfW = Math.max(from.label.length * 4.4, ...lines.map((l) => l.text.length * 3.8));
  const textBottom = 58 + 16 * lines.length;
  const hits = (x: number, y: number) =>
    // 46: the card plus the dashed ring around a spotlighted device.
    (Math.abs(x) < 46 + tagHalfW && Math.abs(y) < 40 + 9) || (Math.abs(x) < textHalfW + tagHalfW + 2 && y + 9 > 36 && y - 9 < textBottom);
  let d = 40;
  while (d < len * 0.45 && hits(ux * d, uy * d)) d += 2;
  return { x: from.x + ux * d, y: from.y + uy * d };
}

interface Marker {
  device: string;
  text: string;
  tone: 'muted' | 'bad' | 'good' | 'warn' | 'info';
  t: number;
  /** How long it stays up (sim ms). */
  life: number;
}

/** `macName`: when set, a switch shows what it learns ("learned Alice: port 1"). */
function markerFor(e: SimEvent, capturedAt: Set<string>, macName?: (mac: string) => string | undefined): Omit<Marker, 't' | 'life'> | null {
  if (e.quiet) return null;
  switch (e.type) {
    case 'mac-learn': {
      const who = macName?.(e.mac);
      return who ? { device: e.device, text: `learned ${who}: ${portName(e.iface)}`, tone: 'info' } : null;
    }
    case 'ignored':
      if (capturedAt.has(`${e.device}@${e.t}`)) return { device: e.device, text: 'copied it', tone: 'bad' };
      return { device: e.device, text: 'not for me', tone: 'muted' };
    case 'drop': {
      const why: Record<string, string> = {
        'not-forwarding': 'dropped it',
        blackhole: 'black hole: dropped',
        ttl: 'TTL hit 0: dropped',
        'arp-timeout': 'no ARP answer',
        'no-route': 'no route: dropped',
        'no-service': 'nothing listening',
        'no-ip': 'no IP address',
        'no-link': 'no cable',
        'no-gateway': 'no gateway: dropped',
        'gateway-off-net': 'gateway not on my network',
      };
      // Say where the packet was going: a request and its reply look the same otherwise.
      if (e.reason === 'no-route' && e.pkt?.dst) return { device: e.device, text: `no route to ${e.pkt.dst}: dropped`, tone: 'bad' };
      return { device: e.device, text: why[e.reason] ?? 'dropped', tone: 'bad' };
    }
    case 'arp-update':
      return e.prev
        ? { device: e.device, text: e.forged ? 'ARP entry overwritten!' : 'ARP entry changed', tone: e.forged ? 'bad' : 'warn' }
        : { device: e.device, text: 'learned a MAC', tone: 'info' };
    case 'arp-rejected':
      return { device: e.device, text: 'ignored fake ARP', tone: 'good' };
    case 'route-change':
      return { device: e.device, text: e.route ? 'route updated' : 'route removed', tone: 'warn' };
    case 'route-rejected':
      return { device: e.device, text: 'rejected bad route', tone: 'good' };
    case 'credentials-stolen':
      return { device: e.device, text: 'password stolen!', tone: 'bad' };
    case 'ping-reply':
      return { device: e.device, text: 'ping reply', tone: 'good' };
    case 'ping-fail':
      return e.reason === 'timeout' ? { device: e.device, text: 'no reply', tone: 'bad' } : null;
    case 'config':
      if (e.what === 'cable') return { device: e.device, text: e.on ? 'plugged in' : 'unplugged', tone: e.on ? 'info' : 'warn' };
      if (e.what === 'ip') return { device: e.device, text: e.on ? 'address set' : 'address removed', tone: e.on ? 'info' : 'warn' };
      if (e.what === 'gateway') return { device: e.device, text: e.on ? 'gateway set' : 'gateway removed', tone: e.on ? 'info' : 'warn' };
      return null;
    default:
      return null;
  }
}

/** Markers for recent events since `since` (the step's start: an earlier step's failures don't belong here). */
function recentMarkers(sim: Sim, since = 0, learn = false): Marker[] {
  const out: Marker[] = [];
  const macName = learn
    ? (mac: string) => Object.values(sim.devices).find((d) => d.ifaces.some((i) => i.mac === mac))?.label
    : undefined;
  const evs = sim.events;
  const captured = new Set<string>();
  // The last time each device's settings changed: a failure from before a fix is old news.
  const changed = new Map<string, number>();
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (sim.t - e.t > FAIL_MARKER_MS) break;
    if (e.type === 'captured') captured.add(`${e.device}@${e.t}`);
    if (!e.quiet && (e.type === 'config' || e.type === 'route-change') && !changed.has(e.device)) changed.set(e.device, e.t);
  }
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    const age = sim.t - e.t;
    if (age > FAIL_MARKER_MS || e.t < since) break;
    const fail = e.type === 'drop' || e.type === 'ping-fail';
    const life = fail ? FAIL_MARKER_MS : MARKER_MS;
    if (age > life) continue;
    const m = markerFor(e, captured, macName);
    if (m && fail && (changed.get(m.device) ?? -1) > e.t) continue;
    if (m && !out.some((o) => o.device === m.device && o.text === m.text)) out.push({ ...m, t: e.t, life });
  }
  return out;
}

function packetPos(sim: Sim, f: InFlight): { x: number; y: number; angle: number } {
  const a = sim.devices[f.from];
  const b = sim.devices[f.to];
  const p = Math.min(1, Math.max(0, (sim.t - f.depart) / (f.arrive - f.depart)));
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease in-out
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = 9;
  return { x: a.x + dx * e + (-dy / len) * off, y: a.y + dy * e + (dx / len) * off, angle: Math.atan2(dy, dx) };
}

function Packet({ sim, f }: { sim: Sim; f: InFlight }) {
  const { x, y } = packetPos(sim, f);
  const proto = protoOf(f.frame);
  const forged = !!f.frame.forged;
  const label = forged ? `FAKE ${proto}` : proto;
  const w = label.length * 8 + (proto === 'HTTPS' ? 28 : 18);
  const fill = forged ? FORGED_COLOR : PROTO_COLOR[proto];
  return (
    <g transform={`translate(${x},${y})`} class="packet">
      {/* Ring color comes from CSS (.packet-pill) so it matches the map in either theme. */}
      <rect x={-w / 2} y={-12} width={w} height={24} rx={12} fill={fill} class="packet-pill" />
      {proto === 'HTTPS' && (
        <g transform={`translate(${-w / 2 + 9},-5) scale(0.5)`} fill="none" stroke="#fff" stroke-width={3}>
          <rect x={2} y={9} width={16} height={11} rx={2} fill="#fff" />
          <path d="M5 9 V6 A5 5 0 0 1 15 6 V9" />
        </g>
      )}
      <text x={proto === 'HTTPS' ? 6 : 0} y={4} text-anchor="middle" class="packet-label">
        {label}
      </text>
    </g>
  );
}

/** How long a finished page stays open on the map before it shrinks to one line (sim ms). */
const BUBBLE_HOLD_MS = 6000;

const bubbleHeadline = (b: BrowserState) =>
  b.status === 'failed'
    ? 'No connection'
    : b.status === 'warning'
      ? 'Warning: possible impostor'
      : b.status === 'loading' || b.status === 'resolving'
        ? 'Loading…'
        : (b.title ?? 'Page loaded');

interface BubbleProps {
  dev: Device;
  b: BrowserState;
  t: number;
  box: Box;
  view: { w: number; h: number };
  /** Full size, or shrunk to one line. */
  open: boolean;
  onToggle: () => void;
  /** Where devices sit on screen (px), so a page can open beside them instead of on top. */
  avoid: Rect[];
}

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

/** The spot next to a device that covers the least of the other devices, preferring the side with more room. */
function placeBubble(sx: number, sy: number, k: number, w: number, h: number, view: { w: number; h: number }, preferRight: boolean, avoid: Rect[]) {
  const gap = 44 * k + 8;
  const rightX = sx + gap;
  const leftX = sx - gap - w;
  const sides = preferRight ? [rightX, leftX] : [leftX, rightX];
  const spots = [
    ...sides.flatMap((x) => [
      { x, y: sy - h / 2 },
      { x, y: sy - 36 * k - h + 24 },
      { x, y: sy + 20 * k },
    ]),
    { x: sx - w / 2, y: sy - 40 * k - h - 8 },
    { x: sx - w / 2, y: sy + 76 * k },
  ];
  let best = { l: 0, t: 0, score: Infinity };
  for (const s of spots) {
    const l = Math.max(4, Math.min(view.w - w - 4, s.x));
    const t = Math.max(4, Math.min(view.h - h - 4, s.y));
    const box = { l, t, r: l + w, b: t + h };
    // Covering a device costs the most; being pushed off its spot by the edge of the map costs a little.
    const score = avoid.reduce((sum, a) => sum + overlap(box, a), 0) + Math.abs(l - s.x) + Math.abs(t - s.y);
    if (score < best.score) best = { l, t, score };
  }
  return best;
}

function BrowserBubble({ dev, b, t, box, view, open, onToggle, avoid }: BubbleProps) {
  // Map SVG coordinates to pixels (the SVG uses preserveAspectRatio "meet": scaled to fit, centered).
  const k = Math.min(view.w / box.w, view.h / box.h);
  const ox = (view.w - box.w * k) / 2;
  const oy = (view.h - box.h * k) / 2;
  const sx = ox + (dev.x - box.x) * k;
  const sy = oy + (dev.y - box.y) * k;
  const right = dev.x < box.x + box.w / 2;
  // Place it by its real height: a long error makes it taller than planned.
  const el = useRef<HTMLDivElement>(null);
  const [bh, setBh] = useState(120);
  useLayoutEffect(() => {
    const h = el.current?.offsetHeight;
    if (h && Math.abs(h - bh) > 2) setBh(h);
  });
  if (!open) {
    // Shrunk: one line beside the device's name, so it doesn't cover the map.
    const cw = 190;
    const left = Math.max(4, Math.min(view.w - cw - 4, right ? sx + 40 * k + 6 : sx - 40 * k - 6 - cw));
    return (
      <button
        class={`browser-chip ${b.status} ${right ? '' : 'flip'}`}
        style={{ left: `${left}px`, top: `${sy + 30 * k}px`, width: `${cw}px` }}
        title={`${dev.label}'s browser. Click to open.`}
        onClick={onToggle}
      >
        {b.status === 'loading' || b.status === 'resolving' ? <span class="spinner" /> : <Icon name={b.status === 'loaded' ? 'check' : 'warn'} size={12} />}
        <span>{bubbleHeadline(b)}</span>
      </button>
    );
  }
  const bw = 230;
  const { l: left, t: top } = placeBubble(sx, sy, k, bw, bh, view, right, avoid);
  const age = t - b.startedAt;
  let content: preact.JSX.Element;
  let lock: 'secure' | 'insecure' | 'warn' = b.secure ? 'secure' : 'insecure';
  if (b.status === 'resolving' || b.status === 'loading') {
    content = (
      <div class="bb-loading">
        <span class="spinner" /> {b.status === 'resolving' ? 'Looking up address…' : 'Waiting for the server…'}
        {age > 4000 && <div class="bb-sub">still waiting ({Math.floor(age / 1000)}s)</div>}
      </div>
    );
  } else if (b.status === 'failed') {
    content = (
      <div class="bb-error">
        <strong>No connection</strong>
        <div>{b.error}</div>
      </div>
    );
  } else if (b.status === 'warning') {
    lock = 'warn';
    content = (
      <div class="bb-warning">
        <strong>Warning: possible impostor</strong>
        <div>{b.error}</div>
      </div>
    );
  } else {
    content = (
      <div class="bb-page">
        <strong>{b.title}</strong>
        <div>{b.body}</div>
      </div>
    );
  }
  return (
    <div class={`browser-bubble ${b.status} ${b.doneAt !== undefined ? 'done' : ''}`} style={{ left: `${left}px`, top: `${top}px`, width: `${bw}px`, minHeight: '96px' }} ref={el}>
      <div class="bb-who">
        {dev.label}'s browser
        {b.doneAt !== undefined && (
          <button class="bb-close" title="Shrink" aria-label={`Shrink ${dev.label}'s browser`} onClick={onToggle}>
            <Icon name="x" size={11} />
          </button>
        )}
      </div>
      <div class="bb-bar">
        <span class={`bb-lock ${lock}`} title={lock === 'secure' ? 'HTTPS' : lock === 'warn' ? 'Certificate problem' : 'Not secure'}>
          {lock === 'secure' ? <Icon name="lock" size={12} /> : lock === 'warn' ? <Icon name="warn" size={12} /> : 'Not secure'}
        </span>
        <span class="bb-url">{b.url.replace(/^https?:\/\//, '')}</span>
      </div>
      <div class="bb-body">{content}</div>
    </div>
  );
}

/** Plugging and unplugging cables on the map. Leave out to make the map read-only. */
export interface Cabling {
  /** Why a cable from `a` to `b` can't be plugged in, or null if it can. */
  check: (a: string, b: string) => string | null;
  connect: (a: string, b: string) => void;
  unplug: (linkId: string) => void;
  /** Show how to drag a cable, for the step that introduces it. */
  hint?: boolean;
}

export interface CanvasProps {
  sim: Sim;
  tick: number;
  selected: string | null;
  focus: string[];
  onSelect: (id: string) => void;
  /** Extras for labs where students build the network (see LabDef.map). */
  opts?: { ports?: boolean; addresses?: boolean };
  cabling?: Cabling;
  /** When the current step started (sim time). Browser results from before it are hidden. */
  since?: number;
}

/** How far the pointer moves before a press on a device becomes a cable drag (px). */
const DRAG_START_PX = 6;

/** The device under a point on the map: its card, or the name under it. */
function deviceAt(devices: Device[], x: number, y: number): Device | undefined {
  return devices.find((d) => Math.abs(x - d.x) <= 46 && y - d.y >= -38 && y - d.y <= 58);
}

/** One end of a cable, as students see it: "Office router port 2", or just "Alice" for a one-port device. */
function endName(sim: Sim, end: { device: string; iface: string }): string {
  const d = sim.devices[end.device];
  return d.ifaces.length > 1 ? `${d.label} ${portName(end.iface)}` : d.label;
}

interface Drag {
  from: string;
  /** Pointer in map coordinates. */
  x: number;
  y: number;
  /** Pointer in pixels, relative to the map's corner. */
  px: number;
  py: number;
}

export function NetworkCanvas({ sim, selected, focus, onSelect, opts, cabling, since }: CanvasProps) {
  const devices = Object.values(sim.devices);
  // Labs where students build the network (port labels on) show what the switch learns.
  const markers = recentMarkers(sim, since, !!opts?.ports);
  const hover = hoverDevice.value;
  const lines = new Map(devices.map((d) => [d.id, sublines(d, !!opts?.addresses)]));
  // Leave room for routers with more than one address line (the layout stays put as addresses change).
  const maxLines = opts?.addresses ? Math.max(1, ...devices.map((d) => (d.kind === 'router' ? d.ifaces.length : 1))) : 1;
  const box = fitBox(devices, maxLines - 1);
  const tagged = (d: Device) => !!opts?.ports && (d.kind === 'router' || d.kind === 'switch' || d.kind === 'hub');
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Cables: drag from one device to another to plug one in; click a cable to unplug it. ---
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; n: number } | null>(null);
  /** Browser pages the student opened or shrank by hand, by device and request. */
  const [bubbles, setBubbles] = useState<Record<string, 'open' | 'shut'>>({});
  const live = useRef({ cabling, devices });
  live.current = { cabling, devices };
  const endDrag = useRef<(() => void) | null>(null);
  /** A drag that ends over a device also fires a click there. Don't let it select the device. */
  const swallowClick = useRef(false);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(id);
  }, [notice?.n]);
  // Cabling turns off during a replay: drop anything half done.
  useEffect(() => {
    if (!cabling) {
      endDrag.current?.();
      setPicked(null);
    }
  }, [!cabling]);
  useEffect(() => () => endDrag.current?.(), []);
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPicked(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked]);

  const toMap = (clientX: number, clientY: number) => {
    const m = svgRef.current?.getScreenCTM();
    const r = wrap.current!.getBoundingClientRect();
    const p = m ? new DOMPoint(clientX, clientY).matrixTransform(m.inverse()) : { x: 0, y: 0 };
    return { x: p.x, y: p.y, px: clientX - r.left, py: clientY - r.top };
  };

  const startPress = (from: string, e: PointerEvent) => {
    if (!live.current.cabling || e.button !== 0) return;
    endDrag.current?.();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START_PX) return;
      moved = true;
      ev.preventDefault();
      setPicked(null);
      setDrag({ from, ...toMap(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      stop();
      if (!moved) return;
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 0);
      const { cabling: c, devices: ds } = live.current;
      const { x, y } = toMap(ev.clientX, ev.clientY);
      const to = deviceAt(ds, x, y);
      if (!c || !to || to.id === from) return;
      const why = c.check(from, to.id);
      if (why) setNotice({ text: why, n: Date.now() });
      else c.connect(from, to.id);
    };
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && stop();
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', key);
      endDrag.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', key);
    endDrag.current = stop;
  };

  /** Map coordinates to pixels in the map's box (the SVG is scaled to fit and centered). */
  const toPx = (x: number, y: number) => {
    const k = Math.min(view.w / box.w, view.h / box.h);
    return { left: (view.w - box.w * k) / 2 + (x - box.x) * k, top: (view.h - box.h * k) / 2 + (y - box.y) * k };
  };

  // When the network last changed: a cable, an address, a gateway, or a route.
  let lastChange = 0;
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i];
    if (!e.quiet && (e.type === 'config' || e.type === 'route-change')) {
      lastChange = e.t;
      break;
    }
  }
  const rect = (l: number, t: number, r: number, b: number): Rect => {
    const a = toPx(l, t);
    const z = toPx(r, b);
    return { l: a.left, t: a.top, r: z.left, b: z.top };
  };
  // Each device, its name and address lines, and the wider strip above it where tags pop up.
  const deviceRects: Rect[] =
    view.w > 0
      ? devices.flatMap((d) => [
          rect(d.x - 60, d.y - 40, d.x + 60, d.y + 60 + 16 * (lines.get(d.id)?.length ?? 0)),
          rect(d.x - 95, d.y - 74, d.x + 95, d.y - 34),
        ])
      : [];

  const target = drag ? deviceAt(devices, drag.x, drag.y) : undefined;
  const over = target && target.id !== drag?.from ? target : undefined;
  const overWhy = drag && over && cabling ? cabling.check(drag.from, over.id) : null;
  const pickedLink = picked ? sim.links[picked] : undefined;

  return (
    <div class="net-wrap" ref={wrap}>
      <svg
        ref={svgRef}
        class={`net-canvas ${cabling ? 'cabling' : ''} ${drag ? 'dragging' : ''}`}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Network map"
        onClick={() => setPicked(null)}
      >
        <defs>
          <filter id="card-shadow" x="-30%" y="-30%" width="160%" height="160%">
            {/* flood color and opacity are set per theme in CSS (.card-shadow-fe) */}
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.12" class="card-shadow-fe" />
          </filter>
        </defs>

        {Object.values(sim.links).map((l) => {
          const a = sim.devices[l.a.device];
          const b = sim.devices[l.b.device];
          return (
            <g key={l.id} class={`link-group ${picked === l.id ? 'picked' : ''}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class={`link ${l.wireless ? 'wireless' : ''}`} />
              {cabling && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  class="link-hit"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPicked(picked === l.id ? null : l.id);
                  }}
                >
                  <title>
                    {endName(sim, l.a)} to {endName(sim, l.b)}. Click to unplug.
                  </title>
                </line>
              )}
            </g>
          );
        })}

        {drag &&
          (() => {
            const a = sim.devices[drag.from];
            const end = over ?? drag;
            return (
              <g class={`cable-draft ${over ? (overWhy ? 'bad' : 'ok') : ''}`}>
                <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} />
                {!over && <circle cx={drag.x} cy={drag.y} r={6} />}
              </g>
            );
          })()}

        {opts?.ports &&
          Object.values(sim.links).flatMap((l) =>
            [
              [l.a, l.b],
              [l.b, l.a],
            ].map(([end, other]) => {
              const d = sim.devices[end.device];
              if (!tagged(d)) return null;
              const text = portName(end.iface);
              const w = text.length * 6.6 + 12;
              const { x, y } = portTagPos(d, sim.devices[other.device], lines.get(d.id) ?? [], w / 2);
              return (
                <g key={`${l.id}-${end.device}`} transform={`translate(${x},${y})`} class="port-tag">
                  <rect x={-w / 2} y={-9} width={w} height={18} rx={9} />
                  <text y={4} text-anchor="middle">
                    {text}
                  </text>
                </g>
              );
            }),
          )}

        {devices.map((d) => {
          const isSel = selected === d.id;
          const isFocus = focus.includes(d.id);
          const isHover = hover === d.id;
          const cableClass = !drag
            ? ''
            : d.id === drag.from
              ? 'cable-source'
              : `${cabling?.check(drag.from, d.id) ? 'cable-no' : 'cable-ok'} ${over?.id === d.id ? 'cable-target' : ''}`;
          const badges: { icon: string; title: string; tone: string }[] = [];
          if (d.sniffing) badges.push({ icon: 'eye', title: 'Capturing packets', tone: 'bad' });
          if (d.forwarding && d.kind === 'host') badges.push({ icon: 'arrows', title: 'Forwarding traffic', tone: 'bad' });
          if (d.bgp?.validate) badges.push({ icon: 'shield', title: 'Validating routes', tone: 'good' });
          if (Object.values(d.arp).some((e) => e.via === 'static')) badges.push({ icon: 'lock', title: 'Locked ARP entry', tone: 'good' });
          if (d.stolen.length) badges.push({ icon: 'key', title: `${d.stolen.length} stolen password(s)`, tone: 'bad' });
          return (
            <g
              key={d.id}
              transform={`translate(${d.x},${d.y})`}
              class={`device ${d.attacker ? 'attacker' : ''} ${isSel ? 'selected' : ''} ${isHover ? 'hover' : ''} ${cableClass}`}
              onClick={() => !swallowClick.current && onSelect(d.id)}
              onPointerDown={(e) => startPress(d.id, e)}
              role="button"
              tabIndex={0}
              aria-label={[d.label, ...lines.get(d.id)!.map((l) => l.text)].join(', ')}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(d.id)}
            >
              {isFocus && <circle r={48} class="focus-ring" />}
              <rect x={-36} y={-32} width={72} height={64} rx={16} class="device-card" filter="url(#card-shadow)" />
              {/* Glyph strokes use currentColor: .device / .device.attacker set it per theme. */}
              <DeviceGlyph icon={d.icon} />
              <text y={52} text-anchor="middle" class="device-label">
                {d.label}
              </text>
              {lines.get(d.id)!.map((line, i) => (
                <text key={i} y={70 + i * 16} text-anchor="middle" class={`device-sublabel ${line.muted ? 'faint' : ''}`}>
                  {line.text}
                </text>
              ))}
              {badges.map((b, i) => (
                <g key={b.icon} transform={`translate(${30 - i * 22},-30)`}>
                  <title>{b.title}</title>
                  <circle r={10} class={`badge ${b.tone}`} />
                  <BadgeGlyph name={b.icon} />
                </g>
              ))}
            </g>
          );
        })}

        {sim.inflight.map((f) => (
          <Packet key={`${f.frame.id}-${f.linkId}-${f.depart}`} sim={sim} f={f} />
        ))}

        {markers.map((m, i) => {
          const d = sim.devices[m.device];
          const age = (sim.t - m.t) / m.life;
          const stack = markers.slice(0, i).filter((o) => o.device === m.device).length;
          return (
            <g
              key={`${m.device}-${m.text}-${m.t}`}
              transform={`translate(${d.x},${d.y - 46 - stack * 24 - age * 14})`}
              opacity={Math.min(1, 1.6 * (1 - age))}
              class={`marker ${m.tone}`}
            >
              <rect x={-m.text.length * 3.9 - 10} y={-12} width={m.text.length * 7.8 + 20} height={24} rx={12} />
              <text y={4} text-anchor="middle">
                {m.text}
              </text>
            </g>
          );
        })}
      </svg>
      {view.w > 0 &&
        devices
          .filter((d) => d.browser && !d.web)
          // A page from an earlier step, or from before the network last changed, is old news: it could say something that's no longer true.
          .filter((d) => d.browser!.doneAt === undefined || (d.browser!.doneAt >= (since ?? 0) && d.browser!.doneAt >= lastChange))
          .map((d) => {
            const b = d.browser!;
            const key = `${d.id}#${b.reqId}`;
            // A new page or warning opens big for a moment. Loading and failures stay one line: the result under the button explains them.
            const fresh = (b.status === 'loaded' || b.status === 'warning') && b.doneAt !== undefined && sim.t - b.doneAt < BUBBLE_HOLD_MS;
            const open = bubbles[key] ? bubbles[key] === 'open' : fresh;
            return (
              <BrowserBubble
                key={d.id}
                dev={d}
                b={b}
                t={sim.t}
                box={box}
                view={view}
                open={open}
                onToggle={() => setBubbles({ ...bubbles, [key]: open ? 'shut' : 'open' })}
                avoid={deviceRects}
              />
            );
          })}

      {drag && (
        <div
          class={`cable-tip ${over ? (overWhy ? 'bad' : 'ok') : ''}`}
          style={(() => {
            // Trail behind the pointer, toward where the drag started, so the tip never covers the device being dropped on.
            const from = sim.devices[drag.from];
            const back = (d: number) => (d > 0 ? 'calc(-100% - 14px)' : '14px');
            return { left: `${drag.px}px`, top: `${drag.py}px`, transform: `translate(${back(drag.x - from.x)}, ${back(drag.y - from.y)})` };
          })()}
        >
          {over
            ? (overWhy ?? `Let go to plug ${sim.devices[drag.from].label} into ${over.label}`)
            : `Drag onto another device to plug ${sim.devices[drag.from].label} into it`}
        </div>
      )}

      {pickedLink && cabling && view.w > 0 && (
        <div
          class="cable-pop"
          role="dialog"
          aria-label="Cable"
          style={(() => {
            const a = sim.devices[pickedLink.a.device];
            const b = sim.devices[pickedLink.b.device];
            const p = toPx((a.x + b.x) / 2, (a.y + b.y) / 2);
            return { left: `${Math.max(120, Math.min(view.w - 120, p.left))}px`, top: `${p.top}px` };
          })()}
        >
          <span>
            {endName(sim, pickedLink.a)} <span class="muted">to</span> {endName(sim, pickedLink.b)}
          </span>
          <button
            class="btn tiny"
            onClick={() => {
              cabling.unplug(pickedLink.id);
              setPicked(null);
            }}
          >
            <Icon name="x" size={12} /> Unplug
          </button>
        </div>
      )}

      {notice && (
        <div class="map-notice" role="alert">
          <Icon name="warn" size={14} /> {notice.text}
        </div>
      )}

      {cabling?.hint && !drag && !notice && (
        <div class="map-hint">
          <Icon name="cable" size={14} /> Drag from one device to another to plug in a cable. Click a cable to unplug it.
        </div>
      )}
    </div>
  );
}

function BadgeGlyph({ name }: { name: string }) {
  const s = { fill: 'none', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  switch (name) {
    case 'eye':
      return (
        <g {...s}>
          <path d="M-6 0 C-3 -4.5 3 -4.5 6 0 C3 4.5 -3 4.5 -6 0 Z" />
          <circle r={1.6} fill="#fff" />
        </g>
      );
    case 'arrows':
      return <path d="M-5 -2.5 H5 M2.5 -5 L5 -2.5 L2.5 0 M5 2.5 H-5 M-2.5 0 L-5 2.5 L-2.5 5" {...s} />;
    case 'shield':
      return <path d="M0 -6 L5 -4 V0 C5 3 3 5 0 6 C-3 5 -5 3 -5 0 V-4 Z" {...s} />;
    case 'lock':
      return (
        <g {...s}>
          <rect x={-4.5} y={-1} width={9} height={6.5} rx={1} />
          <path d="M-2.5 -1 V-3 A2.5 2.5 0 0 1 2.5 -3 V-1" />
        </g>
      );
    case 'key':
      return (
        <g {...s}>
          <circle cx={-2.5} cy={0} r={2.6} />
          <path d="M0 0 H6 M4 0 V2.5" />
        </g>
      );
    default:
      return null;
  }
}
