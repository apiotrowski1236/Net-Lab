import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { css, inkOn, pixelChange, type Picture, type RGB } from '../../demos/pictures';
import type { DemoInput } from '../../demos/types';
import { Icon } from '../icons';

/**
 * Shared parts of the compression lesson's demo views: a grid of big pixels
 * for the small pictures, a canvas for the big ones, and the Step, Play, and
 * Skip to the end buttons of the walk-throughs.
 */

/** One pixel of a grid. `color` null draws an empty spot, waiting to be painted. */
export interface Cell {
  color: RGB | null;
  /** Text on the pixel, such as its place in a run. */
  label?: string;
  /** Draws in with a short pop, after this many ms. */
  pop?: number;
  /** Marked as changed from the original. */
  mark?: boolean;
  /** Drawn faded: not reached yet. */
  dim?: boolean;
}

interface GridProps {
  w: number;
  h: number;
  cells: Cell[];
  /** Name of the whole grid, for a screen reader. */
  label: string;
  /** Leave a wider gap between k×k squares. */
  squares?: number;
  /** A ring around a k×k block (k = size, default 1) with its top left pixel at (x, y). */
  ring?: { x: number; y: number; size?: number };
  /** Makes each pixel a button. */
  onTap?: (i: number) => void;
  /** The pixel tapped last, for its pressed state. */
  selected?: number;
  /** Size class: 'big' for a picture to tap, 'small' for a stored copy. */
  size?: 'big' | 'small';
}

/** CSS for the left (or top) edge of pixel column x, in a grid with wider gaps between k×k squares. */
const edge = (x: number, k?: number) => `calc(${x} * (var(--cell) + var(--gap)) + ${k ? Math.floor(x / k) : 0} * var(--sgap))`;
/** CSS for the span of n pixels starting at column x. */
const span = (x: number, n: number, k?: number) => `calc(${n} * var(--cell) + ${n - 1} * var(--gap) + ${k ? Math.floor((x + n - 1) / k) - Math.floor(x / k) : 0} * var(--sgap))`;

/** A small picture as a grid of big pixels, drawn so each one can be pointed at, counted, and animated. */
export function PixelGrid({ w, h, cells, label, squares, ring, onTap, selected, size }: GridProps) {
  return (
    <div class={`pxg ${size ?? ''} ${squares ? 'squares' : ''}`} style={{ width: span(0, w, squares), height: span(0, h, squares) }} role={onTap ? 'group' : 'img'} aria-label={label}>
      {cells.map((c, i) => {
        const x = i % w;
        const y = Math.floor(i / w);
        const style = {
          left: edge(x, squares),
          top: edge(y, squares),
          background: c.color ? css(c.color) : undefined,
          color: c.color ? inkOn(c.color) : undefined,
          animationDelay: c.pop !== undefined ? `${c.pop}ms` : undefined,
        };
        const cls = `pxg-cell ${c.color ? '' : 'empty'} ${c.pop !== undefined ? 'pop' : ''} ${c.dim ? 'dim' : ''} ${c.mark ? 'mark' : ''}`;
        return onTap ? (
          <button key={i} type="button" class={`${cls} tap`} style={style} data-px={i} aria-pressed={selected === i} aria-label={`Row ${y + 1}, pixel ${x + 1}`} onClick={() => onTap(i)}>
            {c.label}
          </button>
        ) : (
          <span key={i} class={cls} style={style} aria-hidden="true">
            {c.label}
          </span>
        );
      })}
      {ring && <span class="pxg-ring" style={{ left: edge(ring.x, squares), top: edge(ring.y, squares), width: span(ring.x, ring.size ?? 1, squares), height: span(ring.y, ring.size ?? 1, squares) }} aria-hidden="true" />}
    </div>
  );
}

/** Every pixel of a picture as a cell. */
export const cellsOf = (p: Picture, more?: (i: number) => Partial<Cell>): Cell[] => p.px.map((color, i) => ({ color, ...more?.(i) }));

/** A labeled picture in a walk-through. */
export function Fig({ title, children, note }: { title: string; children: ComponentChildren; note?: ComponentChildren }) {
  return (
    <figure class="pxfig">
      <figcaption>{title}</figcaption>
      {children}
      {note && <div class="pxfig-note">{note}</div>}
    </figure>
  );
}

/** A swatch of one color. */
export const Swatch = ({ c, big }: { c: RGB; big?: boolean }) => <span class={`swatch ${big ? 'big' : ''}`} style={{ background: css(c) }} aria-hidden="true" />;

// ---------------------------------------------------------------------------
// Big pictures, on a canvas

const images = new WeakMap<Picture, ImageData>();

function imageOf(p: Picture): ImageData {
  let img = images.get(p);
  if (!img) {
    const data = new Uint8ClampedArray(p.w * p.h * 4);
    p.px.forEach((c, i) => {
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = 255;
    });
    img = new ImageData(data, p.w, p.h);
    images.set(p, img);
  }
  return img;
}

/** The part of a picture a canvas shows: all of it, or a zoomed-in box. */
export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A picture on a canvas, each pixel a square, scaled to the width of its box. */
export function PictureCanvas({ pic, view, label, onPoint }: { pic: Picture; view?: View; label: string; onPoint?: (x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const v = view ?? { x: 0, y: 0, w: pic.w, h: pic.h };
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(imageOf(pic), -v.x, -v.y, v.x, v.y, v.w, v.h);
  }, [pic, v.x, v.y, v.w, v.h]);
  return (
    <canvas
      ref={ref}
      class={`pxcanvas ${onPoint ? 'pointable' : ''}`}
      width={v.w}
      height={v.h}
      style={{ aspectRatio: `${v.w} / ${v.h}` }}
      role="img"
      aria-label={label}
      onClick={
        onPoint &&
        ((e) => {
          const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
          onPoint(v.x + ((e.clientX - r.left) / r.width) * v.w, v.y + ((e.clientY - r.top) / r.height) * v.h);
        })
      }
    />
  );
}

/**
 * How far each pixel moved from the original, as a picture: black where the
 * color is the same, and brighter the more it changed. Even a tiny change
 * shows a little, so "almost every pixel changed" is visible.
 */
const diffs = new WeakMap<Picture, Picture>();
export function differenceOf(a: Picture, b: Picture): Picture {
  let d = diffs.get(b);
  if (!d) {
    d = {
      w: a.w,
      h: a.h,
      px: a.px.map((c, i) => {
        const n = pixelChange(c, b.px[i]);
        if (!n) return [16, 16, 20] as RGB;
        const t = 0.3 + 0.7 * Math.min(1, n / 96);
        return [Math.round(255 * t), Math.round(190 * t), Math.round(40 * t)] as RGB;
      }),
    };
    diffs.set(b, d);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Walk-through controls

/**
 * Step, Play or Pause, and Skip to the end. Play presses Step every `ms`
 * until the end. Skip to the end shows up after the first row, so everyone
 * watches at least one row.
 */
export function WalkControls({ pos, total, canSkip, ms, unit, send }: { pos: number; total: number; canSkip: boolean; ms: number; unit: string; send: (i: DemoInput) => void }) {
  const [playing, setPlaying] = useState(false);
  const done = pos >= total;
  useEffect(() => {
    if (!playing) return;
    if (done) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => send({ advance: 1 }), ms);
    return () => clearTimeout(t);
  }, [playing, pos, done]);
  // Start over puts pos back to 0 without remounting, so stop playing too.
  useEffect(() => {
    if (pos === 0) setPlaying(false);
  }, [pos]);
  return (
    <div class="walk-controls">
      <div class="row gap-sm">
        <button class="btn walk-step" disabled={done || playing} onClick={() => send({ advance: 1 })}>
          <Icon name="chevronRight" size={14} /> Step
        </button>
        <button class="btn walk-play" disabled={done} onClick={() => setPlaying(!playing)} aria-pressed={playing}>
          <Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Pause' : 'Play'}
        </button>
        {canSkip && !done && (
          <button
            class="btn ghost walk-skip"
            onClick={() => {
              setPlaying(false);
              send({ finish: true });
            }}
          >
            Skip to the end
          </button>
        )}
      </div>
      <span class="pill info walk-count">
        {unit} {Math.min(pos, total)} of {total}
      </span>
    </div>
  );
}

/** Two bars that compare sizes in bytes, scaled to the biggest. */
export function SizeBars({ rows }: { rows: { label: ComponentChildren; bytes: number; tone?: 'base' | 'good' | 'bad' }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.bytes));
  return (
    <div class="size-bars">
      {rows.map((r, i) => (
        <div key={i} class="size-bar-row">
          <span class="size-bar-label">{r.label}</span>
          <span class="size-bar-track">
            <span class={`size-bar ${r.tone ?? ''}`} style={{ width: `${(r.bytes / max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** "1,536" */
export const n = (v: number) => v.toLocaleString('en-US');
