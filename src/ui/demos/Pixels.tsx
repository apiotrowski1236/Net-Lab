import { toBits } from '../../demos/binary';
import { colorsIn, foundColors, type PixelsState } from '../../demos/pixels';
import { colorName, picture } from '../../demos/pictures';
import type { PixelsSpec } from '../../demos/types';
import { cellsOf, PixelGrid, Swatch } from './pictureParts';
import type { DemoViewProps } from './parts';

/** A small picture to tap: each pixel shows its color's three bytes, as numbers and as bits. */
export function PixelsView({ spec, state: s, send }: DemoViewProps<PixelsSpec, PixelsState>) {
  const p = picture(spec.picture);
  const at = s.at;
  const c = at !== undefined ? p.px[at] : undefined;
  const found = foundColors(s);
  const total = colorsIn(spec);
  return (
    <div class="pxv">
      <PixelGrid w={p.w} h={p.h} cells={cellsOf(p)} label="The picture, one button per pixel" size="big" onTap={(i) => send({ peek: i })} selected={at} ring={at !== undefined ? { x: at % p.w, y: Math.floor(at / p.w) } : undefined} />
      <div class="pxv-info" aria-live="polite">
        {c && at !== undefined ? (
          <>
            <p class="pxv-where">
              <Swatch c={c} big /> Row {Math.floor(at / p.w) + 1}, pixel {(at % p.w) + 1}: <strong>{colorName(c)}</strong>
            </p>
            <table class="demo-table pxv-bytes">
              <thead>
                <tr>
                  <th>Byte</th>
                  <th>Number</th>
                  <th>Bits</th>
                </tr>
              </thead>
              <tbody>
                {(['Red', 'Green', 'Blue'] as const).map((name, k) => (
                  <tr key={name}>
                    <th>{name}</th>
                    <td>{c[k]}</td>
                    <td>
                      <code>{toBits(c[k], 8)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="small muted">3 bytes, or 24 bits, for this one pixel.</p>
          </>
        ) : (
          <p class="muted">Tap a pixel to see the numbers that store its color.</p>
        )}
        <div class="pxv-found">
          <span class="demo-label">
            Colors found: {found.length} of {total}
          </span>
          <div class="row gap-sm wrap">
            {found.map((f) => (
              <span key={f.name} class="pill">
                <Swatch c={f.color} /> {f.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
