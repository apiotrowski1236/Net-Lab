import { useRef } from 'preact/hooks';
import { PAINT_COLORS, PAINT_SIZE, paintPicture, type PaintState } from '../../demos/paint';
import { colorName, compress, percentOf } from '../../demos/pictures';
import type { PaintSpec } from '../../demos/types';
import { Icon } from '../icons';
import { cellsOf, Fig, n, PixelGrid, SizeBars, Swatch } from './pictureParts';
import type { DemoViewProps } from './parts';

/** An 8×8 picture to paint, with what runs and 2×2 averages do to it, live. Drag to paint several pixels. */
export function PaintView({ state: s, send }: DemoViewProps<PaintSpec, PaintState>) {
  const p = paintPicture(s);
  const raw = compress(p, 'none');
  const runs = compress(p, 'runs');
  const avg = compress(p, 'avg2');
  const painting = useRef(false);
  const paintAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-px]');
    if (el) send({ paint: Number(el.dataset.px) });
  };
  return (
    <div class="paint">
      <div class="demo-row">
        <span class="demo-label" id="paint-colors">
          Color
        </span>
        <div class="seg wrap" role="group" aria-labelledby="paint-colors">
          {PAINT_COLORS.map((c, i) => (
            <button key={i} class={i === s.brush ? 'on' : ''} aria-pressed={i === s.brush} data-brush={i} onClick={() => send({ brush: i })}>
              <Swatch c={c} /> {colorName(c)}
            </button>
          ))}
        </div>
        <button class="btn ghost small" onClick={() => send({ clear: true })}>
          <Icon name="reset" size={14} /> Clear
        </button>
      </div>
      <div class="walk-figs">
        <Fig title="Your picture">
          <div
            class="paint-canvas"
            onPointerDown={(e) => {
              painting.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              paintAt(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => painting.current && paintAt(e.clientX, e.clientY)}
            onPointerUp={() => (painting.current = false)}
            onPointerCancel={() => (painting.current = false)}
          >
            <PixelGrid w={PAINT_SIZE} h={PAINT_SIZE} cells={cellsOf(p)} label="Your picture, one button per pixel" size="big" onTap={(i) => send({ paint: i })} />
          </div>
        </Fig>
        <Fig title="After Average 2×2">
          <PixelGrid w={PAINT_SIZE} h={PAINT_SIZE} cells={cellsOf(avg.rebuilt)} squares={2} label="Your picture after averaging 2×2 squares" />
        </Fig>
      </div>
      <SizeBars
        rows={[
          {
            label: (
              <>
                No compression: <b>{n(raw.bytes)} bytes</b>
              </>
            ),
            bytes: raw.bytes,
            tone: 'base',
          },
          {
            label: (
              <>
                Runs (lossless): {runs.runs} runs = <b>{n(runs.bytes)} bytes</b> ({percentOf(runs.bytes, raw.bytes)}), 0 pixels changed
              </>
            ),
            bytes: runs.bytes,
            tone: runs.bytes > raw.bytes ? 'bad' : 'good',
          },
          {
            label: (
              <>
                Average 2×2 (lossy): <b>{n(avg.bytes)} bytes</b> ({percentOf(avg.bytes, raw.bytes)}), {avg.changed} {avg.changed === 1 ? 'pixel' : 'pixels'} changed
              </>
            ),
            bytes: avg.bytes,
            tone: 'good',
          },
        ]}
      />
    </div>
  );
}
