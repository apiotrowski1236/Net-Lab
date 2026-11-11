import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { startLive, type JsLast, type JsState } from '../../demos/js';
import type { JsSpec } from '../../demos/types';
import type { OutputLine } from '../../js';
import { paint, type InputEvent, type SketchState } from '../../sketch';
import { Icon } from '../icons';

/** Live lines the output keeps. A sketch can print every frame, all class long. */
const KEEP_LINES = 300;
/** How often the output under the canvas catches up while the sketch prints. */
const REPORT_MS = 120;
/** Keys that would scroll the page while the canvas has the keyboard. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown', 'Home', 'End']);

type Mode = 'idle' | 'running' | 'paused' | 'stopped' | 'still';

/** Fits the canvas in its box, as large as it fits but never larger than the sketch's own size. */
function useFit(box: preact.RefObject<HTMLDivElement>, w: number, h: number): { width: number; height: number } {
  const [room, setRoom] = useState({ width: w, height: h });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = Math.min(1, (room.width - 2) / w, (room.height - 2) / h);
  return { width: Math.max(1, Math.floor(w * Math.max(k, 0.05))), height: Math.max(1, Math.floor(h * Math.max(k, 0.05))) };
}

/**
 * The student's p5.js sketch, running. A Run in the model judges the code with
 * hidden frames. This canvas runs the same code again from the start, a frame at
 * a time on the real clock, with the real mouse and keys. Nothing here is saved.
 */
export function SketchPane({ spec, state: s, onLive }: { spec: JsSpec; state: JsState; onLive: (last: JsLast | undefined) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const queue = useRef<InputEvent[]>([]);
  const held = useRef(new Set<string>());
  const pressed = useRef(false);
  const paused = useRef(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [restart, setRestart] = useState(0);
  const [focused, setFocused] = useState(false);
  const saved: SketchState | undefined = s.last?.sketch;
  const [size, setSize] = useState({ w: saved?.w ?? 400, h: saved?.h ?? 400 });
  const fit = useFit(box, size.w, size.h);
  const live = useRef(onLive);
  live.current = onLive;

  useEffect(() => {
    const el = canvas.current;
    const last = s.last;
    const sk = last?.sketch;
    queue.current = [];
    paused.current = false;
    if (!el || !last || !sk) {
      setMode('idle');
      live.current(undefined);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = (w: number, h: number) => {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      setSize({ w, h });
    };
    const ctx = el.getContext('2d');
    // A Run that stopped, or code changed since its Run, shows the still from the saved run: nothing new runs.
    if (last.status !== 'ok' || !sk.started || s.edited) {
      resize(sk.w, sk.h);
      if (ctx) paint(ctx, sk.still, dpr, sk);
      setMode('still');
      live.current(undefined);
      return;
    }
    const run = startLive(spec, s);
    if (!run) return;
    let w = sk.w;
    let h = sk.h;
    resize(w, h);
    let lines: OutputLine[] = [];
    let dropped = 0;
    let end: JsLast | undefined;
    const take = (more: OutputLine[]) => {
      if (!more.length) return;
      lines = lines.concat(more);
      if (lines.length > KEEP_LINES) {
        dropped += lines.length - KEEP_LINES;
        lines = lines.slice(-KEEP_LINES);
      }
    };
    const draw = () => {
      const got = run.sketch.drain();
      if (got.resized && (run.sketch.w !== w || run.sketch.h !== h)) {
        w = run.sketch.w;
        h = run.sketch.h;
        resize(w, h);
      }
      if (ctx && got.shapes.length) paint(ctx, got.shapes, dpr, { w, h });
    };
    let reported = 0;
    const report = (now: boolean) => {
      const t = performance.now();
      if (!now && t - reported < REPORT_MS) return;
      reported = t;
      const shown: OutputLine[] = dropped ? [{ kind: 'log', text: `(${dropped.toLocaleString('en-US')} earlier lines are hidden. The newest are below.)`, file: '', line: 0 }, ...lines] : lines;
      live.current(end ?? { status: 'ok', lines: shown, sketch: sk });
    };
    const stop = (r: { status: JsLast['status']; error?: JsLast['error']; limit?: JsLast['limit'] }) => {
      end = { status: r.status, lines: dropped ? [{ kind: 'log', text: `(${dropped.toLocaleString('en-US')} earlier lines are hidden.)`, file: '', line: 0 }, ...lines] : lines, error: r.error, limit: r.limit, sketch: sk };
      setMode('stopped');
      report(true);
    };

    take(run.first.lines);
    draw();
    if (run.first.status !== 'ok') {
      stop(run.first);
      return;
    }
    setMode('running');
    report(true);
    let raf = 0;
    let before = performance.now();
    let owed = 0;
    let printed = lines.length + dropped;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const gap = Math.min(t - before, 250);
      before = t;
      if (paused.current) return;
      const every = 1000 / (run.sketch.fps ?? 60);
      owed += gap;
      // A frame a little early is fine: displays tick a hair off 60 a second.
      if (owed < every - 2) return;
      owed = Math.min(owed - every, every);
      const r = run.step(queue.current.splice(0));
      take(r.lines);
      draw();
      if (r.status !== 'ok') {
        cancelAnimationFrame(raf);
        stop(r);
        return;
      }
      if (lines.length + dropped !== printed) {
        printed = lines.length + dropped;
        report(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // A new Run makes a new `last`. Edits alone don't restart what's running, as in the p5.js editor.
  }, [s.last, restart]);

  useEffect(() => () => live.current(undefined), []);

  const point = (e: PointerEvent): InputEvent => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    // Whole pixels, as p5.js gives on a canvas shown at its own size. This one is scaled to fit.
    return { t: 'move', x: Math.round(((e.clientX - r.left) * size.w) / r.width), y: Math.round(((e.clientY - r.top) * size.h) / r.height) };
  };
  const push = (ev: InputEvent) => {
    const q = queue.current;
    // Moves between two frames only need the last one, unless the button changed in between.
    if (ev.t === 'move' && q.length && q[q.length - 1].t === 'move') q[q.length - 1] = ev;
    else if (q.length < 200) q.push(ev);
  };
  const letGo = () => {
    for (const key of held.current) push({ t: 'keyup', key });
    held.current.clear();
    if (pressed.current) push({ t: 'up' });
    pressed.current = false;
  };

  const togglePause = () => {
    paused.current = !paused.current;
    setMode(paused.current ? 'paused' : 'running');
  };
  const canRestart = !!saved && s.last?.status === 'ok' && !s.edited;
  // A sketch with no draw() drew once and is done. There is nothing to pause.
  const moving = !!saved?.looping;
  const reads = [saved?.mouse && 'mouse', saved?.keys && 'keys'].filter(Boolean);
  const how = mode === 'running' && reads.length ? (saved?.keys ? (focused ? 'The keys go to your sketch. Click outside it to stop.' : 'Click the canvas, then use the keys.') : 'Use the mouse on the canvas.') : undefined;

  return (
    <section class="js-preview js-sketch" data-preview="sketch">
      <div class="js-preview-bar">
        <h4>Your sketch</h4>
        <span class="js-sketch-state" aria-live="polite">
          {mode === 'running' && moving && 'Running'}
          {mode === 'paused' && 'Paused'}
          {mode === 'stopped' && 'Stopped'}
          {mode === 'still' && (s.edited && s.last?.status === 'ok' ? 'Press Run to start your new code' : 'Stopped')}
        </span>
        <span class="js-sketch-buttons">
          {moving && (mode === 'running' || mode === 'paused') && (
            <button class="btn tiny" onClick={togglePause} aria-pressed={mode === 'paused'}>
              <Icon name={mode === 'paused' ? 'play' : 'pause'} size={12} /> {mode === 'paused' ? 'Resume' : 'Pause'}
            </button>
          )}
          {canRestart && (
            <button class="btn tiny js-restart" onClick={() => setRestart((n) => n + 1)} title="Run the sketch again from setup()">
              <Icon name="replay" size={12} /> Restart
            </button>
          )}
        </span>
      </div>
      <div class="js-canvas-box" ref={box}>
        {!saved && <p class="js-canvas-empty">Press Run to start your sketch.</p>}
        <canvas
          ref={canvas}
          class={saved ? '' : 'hidden'}
          style={{ width: `${fit.width}px`, height: `${fit.height}px` }}
          tabIndex={0}
          aria-label={`Your sketch, ${size.w} by ${size.h}.${saved?.keys ? ' Click it, then use the keys.' : ''}`}
          onPointerMove={(e) => push(point(e))}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLCanvasElement).focus();
            (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
            push(point(e));
            if (!pressed.current) push({ t: 'down' });
            pressed.current = true;
          }}
          onPointerUp={(e) => {
            push(point(e));
            if (pressed.current) push({ t: 'up' });
            pressed.current = false;
          }}
          onPointerCancel={() => letGo()}
          onKeyDown={(e) => {
            if (e.key === 'Tab' || e.metaKey || e.ctrlKey) return;
            if (SCROLL_KEYS.has(e.key)) e.preventDefault();
            if (e.repeat || held.current.has(e.key)) return;
            held.current.add(e.key);
            push({ t: 'keydown', key: e.key });
          }}
          onKeyUp={(e) => {
            if (!held.current.delete(e.key)) return;
            push({ t: 'keyup', key: e.key });
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            letGo();
          }}
        />
      </div>
      {how && <p class="js-canvas-how">{how}</p>}
    </section>
  );
}
