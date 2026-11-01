import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Sim } from '../sim/sim';
import type { BrowserState, Device, InFlight, SimEvent } from '../sim/types';
import { FORGED_COLOR, PROTO_COLOR, protoOf } from './describe';
import { DeviceGlyph, Icon } from './icons';

/** Device currently hovered in the lesson text (device chips) — highlighted on the map. */
export const hoverDevice = signal<string | null>(null);

const MARKER_MS = 1800;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frame the map tightly around the devices, leaving room for labels below and markers above. */
function fitBox(devices: Device[]): Box {
  const xs = devices.map((d) => d.x);
  const ys = devices.map((d) => d.y);
  const x = Math.min(...xs) - 95;
  const y = Math.min(...ys) - 105;
  return { x, y, w: Math.max(...xs) + 95 - x, h: Math.max(...ys) + 80 - y };
}

interface Marker {
  device: string;
  text: string;
  tone: 'muted' | 'bad' | 'good' | 'warn' | 'info';
  t: number;
}

function markerFor(e: SimEvent, capturedAt: Set<string>): Omit<Marker, 't'> | null {
  switch (e.type) {
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
      };
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
    default:
      return null;
  }
}

function recentMarkers(sim: Sim): Marker[] {
  const out: Marker[] = [];
  const evs = sim.events;
  const captured = new Set<string>();
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (sim.t - e.t > MARKER_MS) break;
    if (e.type === 'captured') captured.add(`${e.device}@${e.t}`);
  }
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (sim.t - e.t > MARKER_MS) break;
    const m = markerFor(e, captured);
    if (m && !out.some((o) => o.device === m.device && o.text === m.text)) out.push({ ...m, t: e.t });
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

function BrowserBubble({ dev, b, t, box, view }: { dev: Device; b: BrowserState; t: number; box: Box; view: { w: number; h: number } }) {
  // Map SVG coordinates to pixels (the SVG uses preserveAspectRatio "meet": scaled to fit, centered).
  const k = Math.min(view.w / box.w, view.h / box.h);
  const ox = (view.w - box.w * k) / 2;
  const oy = (view.h - box.h * k) / 2;
  const sx = ox + (dev.x - box.x) * k;
  const sy = oy + (dev.y - box.y) * k;
  const bw = 230;
  const bh = 96;
  const right = dev.x < box.x + box.w / 2;
  const left = Math.max(4, Math.min(view.w - bw - 4, right ? sx + 44 * k + 8 : sx - 44 * k - 8 - bw));
  const top = Math.max(4, Math.min(view.h - bh - 4, sy - 36 * k - bh + 24));
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
    <div class={`browser-bubble ${b.status}`} style={{ left: `${left}px`, top: `${top}px`, width: `${bw}px`, minHeight: `${bh}px` }}>
      <div class="bb-who">{dev.label}'s browser</div>
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

export interface CanvasProps {
  sim: Sim;
  tick: number;
  selected: string | null;
  focus: string[];
  onSelect: (id: string) => void;
}

export function NetworkCanvas({ sim, selected, focus, onSelect }: CanvasProps) {
  const devices = Object.values(sim.devices);
  const markers = recentMarkers(sim);
  const hover = hoverDevice.value;
  const box = fitBox(devices);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div class="net-wrap" ref={wrap}>
      <svg
        class="net-canvas"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Network map"
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
          return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} class={`link ${l.wireless ? 'wireless' : ''}`} />;
        })}

        {devices.map((d) => {
          const isSel = selected === d.id;
          const isFocus = focus.includes(d.id);
          const isHover = hover === d.id;
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
              class={`device ${d.attacker ? 'attacker' : ''} ${isSel ? 'selected' : ''} ${isHover ? 'hover' : ''}`}
              onClick={() => onSelect(d.id)}
              role="button"
              tabIndex={0}
              aria-label={`${d.label}${d.sublabel ? `, ${d.sublabel}` : ''}`}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(d.id)}
            >
              {isFocus && <circle r={48} class="focus-ring" />}
              <rect x={-36} y={-32} width={72} height={64} rx={16} class="device-card" filter="url(#card-shadow)" />
              {/* Glyph strokes use currentColor: .device / .device.attacker set it per theme. */}
              <DeviceGlyph icon={d.icon} />
              <text y={52} text-anchor="middle" class="device-label">
                {d.label}
              </text>
              {d.sublabel && (
                <text y={70} text-anchor="middle" class="device-sublabel">
                  {d.sublabel}
                </text>
              )}
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
          const age = (sim.t - m.t) / MARKER_MS;
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
          .map((d) => <BrowserBubble key={d.id} dev={d} b={d.browser!} t={sim.t} box={box} view={view} />)}
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
