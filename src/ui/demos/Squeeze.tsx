import { useState } from 'preact/hooks';
import { METHOD_NAME, percentOf, picture, PICTURES, rawBytes, resultOf, type Picture } from '../../demos/pictures';
import type { SqueezeState } from '../../demos/squeeze';
import type { SqueezeSpec } from '../../demos/types';
import { Icon } from '../icons';
import { differenceOf, n, PictureCanvas, type View } from './pictureParts';
import type { DemoViewProps } from './parts';

/** Pictures this wide get a Zoom in button: at full size, one pixel is too small to see. */
const ZOOMABLE = 120;
/** Zoomed in, the canvas shows a quarter of the picture's width and height. */
const ZOOM = 4;

function zoomBox(p: Picture, at: { x: number; y: number }): View {
  const w = Math.round(p.w / ZOOM);
  const h = Math.round(p.h / ZOOM);
  const x = Math.max(0, Math.min(p.w - w, Math.round(at.x - w / 2)));
  const y = Math.max(0, Math.min(p.h - h, Math.round(at.y - h / 2)));
  return { x, y, w, h };
}

/**
 * Pick a picture and a compression method. The rebuilt picture sits beside
 * the original, and a table keeps the size and the pixels changed for every
 * method tried on this picture.
 */
export function SqueezeView({ spec, state: s, send }: DemoViewProps<SqueezeSpec, SqueezeState>) {
  const p = picture(s.picture);
  const r = resultOf(s.picture, s.method);
  const raw = rawBytes(p);
  const zoomable = p.w >= ZOOMABLE;
  // Zooming is only for looking, so it isn't saved: where the student tapped, or the palm tree's leaves.
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const view = zoomable && zoom ? zoomBox(p, zoom) : undefined;
  const point = zoomable ? (x: number, y: number) => setZoom({ x, y }) : undefined;
  const right = s.changes && s.method !== 'none' ? differenceOf(p, r.rebuilt) : r.rebuilt;
  const rightTitle = s.method === 'none' ? 'Not compressed' : s.changes ? 'What changed' : `Rebuilt after ${METHOD_NAME[s.method].replace(/ \(.*\)$/, '')}`;
  return (
    <div class="squeeze">
      {spec.pictures.length > 1 && (
        <div class="demo-row">
          <span class="demo-label" id={`${spec.id}-pic`}>
            Picture
          </span>
          <div class="seg" role="group" aria-labelledby={`${spec.id}-pic`}>
            {spec.pictures.map((id) => (
              <button key={id} class={id === s.picture ? 'on' : ''} aria-pressed={id === s.picture} data-picture={id} onClick={() => send({ picture: id })}>
                {PICTURES[id].name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="demo-row">
        <span class="demo-label" id={`${spec.id}-method`}>
          Method
        </span>
        <div class="seg wrap" role="group" aria-labelledby={`${spec.id}-method`}>
          {spec.methods.map((m) => (
            <button key={m} class={m === s.method ? 'on' : ''} aria-pressed={m === s.method} data-method={m} onClick={() => send({ method: m })}>
              {m === 'none' ? 'No compression' : METHOD_NAME[m]}
            </button>
          ))}
        </div>
      </div>

      <div class={`squeeze-pics ${view ? 'zoomed' : ''} ${p.w <= 16 ? 'tiny' : ''}`}>
        <figure class="pxfig">
          <figcaption>Original</figcaption>
          <PictureCanvas pic={p} view={view} label={`The original ${PICTURES[s.picture].name.toLowerCase()}`} onPoint={point} />
        </figure>
        <figure class="pxfig">
          <figcaption>{rightTitle}</figcaption>
          <PictureCanvas pic={right} view={view} label={rightTitle} onPoint={point} />
        </figure>
      </div>
      <div class="squeeze-tools">
        {s.method !== 'none' && (
          <button class={`btn small squeeze-changes ${s.changes ? 'on' : ''}`} aria-pressed={s.changes} onClick={() => send({ changes: !s.changes })}>
            <Icon name="eye" size={14} /> {s.changes ? 'Hide what changed' : 'Show what changed'}
          </button>
        )}
        {zoomable && (
          <button class={`btn small squeeze-zoom ${zoom ? 'on' : ''}`} aria-pressed={!!zoom} onClick={() => setZoom(zoom ? null : { x: p.w / 4, y: p.h * 0.38 })}>
            {zoom ? 'Zoom out' : 'Zoom in'}
          </button>
        )}
        {zoomable && <span class="small muted">{zoom ? 'Tap a picture to look somewhere else.' : 'Or tap a picture to zoom in on that spot.'}</span>}
      </div>
      {s.changes && s.method !== 'none' && (
        <p class="small squeeze-legend">
          <span class="legend-swatch same" aria-hidden="true" /> Black: the same color as the original. <span class="legend-swatch moved" aria-hidden="true" /> Orange: the color changed. The brighter
          the orange, the more it changed.
        </p>
      )}

      <table class="demo-table squeeze-table" aria-live="polite">
        <caption>{PICTURES[s.picture].name}: what each method did</caption>
        <thead>
          <tr>
            <th>Method</th>
            <th>Size</th>
            <th>Pixels changed</th>
          </tr>
        </thead>
        <tbody>
          {spec.methods.map((m) => {
            // No compression is the original, always on screen at the left.
            const tried = m === 'none' || s.tried.includes(`${s.picture}:${m}`);
            const mr = resultOf(s.picture, m);
            return (
              <tr key={m} class={m === s.method ? 'on' : ''}>
                <th>{m === 'none' ? 'No compression' : METHOD_NAME[m]}</th>
                {tried ? (
                  <>
                    <td class="squeeze-size">
                      <span>
                        {n(mr.bytes)} bytes <span class="muted">({percentOf(mr.bytes, raw)})</span>
                      </span>
                      <span class="size-bar-track" aria-hidden="true">
                        <span class={`size-bar ${m === 'none' ? 'base' : mr.bytes > raw ? 'bad' : 'good'}`} style={{ width: `${Math.min(100, (mr.bytes / (raw * 1.4)) * 100)}%` }} />
                      </span>
                    </td>
                    <td>
                      {n(mr.changed)} of {n(p.w * p.h)}
                    </td>
                  </>
                ) : (
                  <td colSpan={2} class="muted">
                    Not tried yet
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {r.bytes > raw && <p class="callout bad small squeeze-bigger">This made the picture bigger: {n(r.bytes)} bytes is more than the {n(raw)} bytes it started as.</p>}
    </div>
  );
}
