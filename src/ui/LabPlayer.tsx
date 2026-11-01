import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LabDef } from '../labs/types';
import { LabSession } from '../runtime/session';
import { beacon, enqueue, hasEndpoint } from '../store/outbox';
import { config, profile } from '../store/profile';
import { getProgress } from '../store/progress';
import { buildReport } from '../store/report';
import { flushSaves } from '../store/storage';
import { CaptureView, Inspector, Toolkit } from './Dock';
import { FORGED_COLOR, PROTO_BLURB, PROTO_COLOR, type Proto } from './describe';
import { Icon } from './icons';
import { LessonPanel } from './Lesson';
import { NetworkCanvas } from './NetworkCanvas';
import { Summary } from './Summary';
import { TopBar } from './TopBar';

type Tab = 'inspect' | 'capture' | 'tools';

const SPEEDS = [0.5, 1, 2, 4];

// ---------------------------------------------------------------------------
// Stage: the animated network. Owns the animation loop so only it re-renders every frame.
// ---------------------------------------------------------------------------

/** How long a finished replay holds its last frame before it loops or closes (real ms). */
const REPLAY_HOLD_MS = 1400;

function Stage({ session, selected, onSelect }: { session: LabSession; selected: string | null; onSelect: (id: string) => void }) {
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [legend, setLegend] = useState(false);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  pausedRef.current = paused;
  speedRef.current = speed;
  void session.rev.value;
  const replay = session.replay.value;
  const repeat = session.repeat.value;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastPaint = 0;
    let heldSince = 0;
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const rp = session.replay.peek();
      let dirty: boolean;
      let sim = session.sim;
      if (rp) {
        // The live network waits while a replay plays.
        sim = rp.sim;
        if (!pausedRef.current && !rp.done) rp.advance(dt * speedRef.current);
        dirty = rp.consumeDirty();
        if (rp.done) {
          heldSince ||= now;
          if (now - heldSince > REPLAY_HOLD_MS) {
            heldSince = 0;
            if (session.repeat.peek()) session.startReplay(rp.stepIndex);
            else session.stopReplay();
          }
        } else heldSince = 0;
      } else {
        heldSince = 0;
        if (!pausedRef.current) sim.advance(dt * speedRef.current);
        dirty = session.consumeSimDirty();
      }
      if (dirty) session.simRev.value++;
      const lastEv = sim.events[sim.events.length - 1];
      const animating = sim.inflight.length > 0 || (lastEv && sim.t - lastEv.t < 2000);
      if (animating || dirty || now - lastPaint > 500) {
        lastPaint = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  const canReplay = session.canReplay();
  const protos: Proto[] = ['ARP', 'HTTP', 'HTTPS', 'DNS', 'ROUTE', 'PING'];
  return (
    <div class={`stage ${replay ? 'replaying' : ''}`}>
      <div class="stage-bar">
        <div class="row gap-sm">
          <button class="btn icon" onClick={() => setPaused(!paused)} title={paused ? 'Play' : 'Pause'} aria-label={paused ? 'Play' : 'Pause'}>
            <Icon name={paused ? 'play' : 'pause'} />
          </button>
          <div class="seg" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} class={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
          {paused && <span class="pill">paused</span>}
        </div>
        <div class="row gap-sm">
          <button
            class="btn ghost small"
            disabled={!canReplay && !replay}
            title={canReplay ? 'Watch what happened on the network in this step again' : 'Nothing to replay yet. Do something on the network first.'}
            onClick={() => (replay ? session.stopReplay() : session.startReplay())}
          >
            <Icon name="replay" /> {replay ? 'Stop replay' : 'Replay step'}
          </button>
          <button
            class={`btn ghost small toggle-btn ${repeat ? 'on' : ''}`}
            aria-pressed={repeat}
            title="Loop replays until you stop them"
            onClick={() => (session.repeat.value = !repeat)}
          >
            <Icon name="repeat" /> Repeat
          </button>
          <button class="btn ghost small" onClick={() => setLegend(!legend)}>
            Packet colors
          </button>
          <button
            class="btn ghost small"
            onClick={() => {
              if (confirm('Reset the network to how this lab set it up? Your answers and completed goals are kept.')) session.resetNetwork();
            }}
          >
            <Icon name="reset" /> Reset network
          </button>
        </div>
      </div>
      {legend && (
        <div class="legend">
          {protos.map((p) => (
            <div key={p} class="legend-row">
              <span class="proto" style={{ background: PROTO_COLOR[p] }}>
                {p}
              </span>{' '}
              {PROTO_BLURB[p]}
            </div>
          ))}
          <div class="legend-row">
            <span class="proto" style={{ background: FORGED_COLOR }}>
              FAKE
            </span>{' '}
            A forged packet. (Real networks don't label them. We do, so you can follow along.)
          </div>
        </div>
      )}
      {replay && (
        <div class="replay-banner" role="status">
          <Icon name="replay" />
          <span>
            <strong>Replay</strong> of step {replay.stepIndex + 1}, {session.lab.steps[replay.stepIndex].title}
            {repeat ? ' (repeating)' : ''}
          </span>
          <span class="replay-progress" aria-hidden="true">
            <span style={{ width: `${Math.round(replay.progress * 100)}%` }} />
          </span>
          <button class="btn tiny" onClick={() => session.startReplay(replay.stepIndex)}>
            Restart
          </button>
          <button class="btn tiny" onClick={() => session.stopReplay()}>
            Back to live
          </button>
        </div>
      )}
      <div class="canvas-wrap">
        <NetworkCanvas sim={session.view} tick={tick} selected={selected} focus={session.step.focus ?? []} onSelect={onSelect} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dock: inspector / capture / tools. Re-renders when the network changes, not every frame.
// ---------------------------------------------------------------------------

function Dock({ session, tab, setTab, selected }: { session: LabSession; tab: Tab; setTab: (t: Tab) => void; selected: string | null }) {
  void session.simRev.value;
  void session.rev.value;
  const lab = session.lab;
  const tools = session.tools;
  const capDev = lab.captureDevice ? session.sim.devices[lab.captureDevice] : undefined;
  const seenTools = useRef(tools.length);
  const newTools = tools.length > seenTools.current && tab !== 'tools';
  if (tab === 'tools') seenTools.current = tools.length;
  return (
    <div class="dock">
      <div class="dock-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'inspect'} class={tab === 'inspect' ? 'on' : ''} onClick={() => setTab('inspect')}>
          <Icon name="target" /> Inspect{selected ? `: ${session.sim.devices[selected]?.label}` : ''}
        </button>
        {capDev && (
          <button role="tab" aria-selected={tab === 'capture'} class={tab === 'capture' ? 'on' : ''} onClick={() => setTab('capture')}>
            <Icon name="eye" /> Capture <span class="count">{capDev.capture.length}</span>
          </button>
        )}
        <button role="tab" aria-selected={tab === 'tools'} class={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')}>
          <Icon name="bolt" /> Toolkit {tools.length > 0 && <span class="count">{tools.length}</span>}
          {newTools && <span class="new-dot" title="New tool" />}
        </button>
      </div>
      <div class="dock-body">
        {tab === 'inspect' && <Inspector session={session} deviceId={selected} />}
        {tab === 'capture' && capDev && <CaptureView session={session} deviceId={capDev.id} />}
        {tab === 'tools' && <Toolkit session={session} tools={tools} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export function LabPlayer({ lab }: { lab: LabDef }) {
  const who = profile.value;
  const session = useMemo(() => new LabSession(lab, getProgress(who.id, lab.id, lab.version)), [lab, who.id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inspect');
  const stepId = session.step.id;
  void session.rev.value;

  useEffect(() => () => session.dispose(), [session]);

  // Open whatever the step asks for when it starts.
  useEffect(() => {
    const open = session.step.open;
    if (!open) return;
    if (open === 'capture' || open === 'tools') setTab(open);
    else {
      setSelected(open.inspect);
      setTab('inspect');
    }
  }, [stepId]);

  // Active-time tracking: counts 15s slices when the tab is visible and the student did something recently.
  useEffect(() => {
    let lastInput = Date.now();
    const mark = () => (lastInput = Date.now());
    const evs = ['pointerdown', 'keydown', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInput < 120_000) {
        session.progress.activeMs += 15_000;
      }
    }, 15_000);
    return () => {
      clearInterval(id);
      evs.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [session]);

  // Automatic in-progress copies to the teacher (if a submit endpoint is configured).
  useEffect(() => {
    const current = () => buildReport(lab, session.progress, profile.value, session.progress.submittedAt ? 'submitted' : 'in-progress');
    let lastSent = 0;
    const minutes = config.value.autoSyncMinutes;
    const id =
      minutes > 0
        ? setInterval(() => {
            if (!hasEndpoint() || !profile.value.name.trim()) return;
            if (session.progress.updatedAt <= lastSent) return;
            lastSent = Date.now();
            enqueue(current());
          }, minutes * 60_000)
        : undefined;
    const onHide = () => {
      flushSaves();
      if (hasEndpoint() && profile.value.name.trim() && session.progress.updatedAt > lastSent) {
        lastSent = Date.now();
        beacon(current());
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      if (id) clearInterval(id);
      window.removeEventListener('pagehide', onHide);
    };
  }, [session]);

  const select = (id: string) => {
    setSelected(id);
    setTab('inspect');
    session.ui({ type: 'ui:inspect', device: id });
  };

  return (
    <div class="player">
      <TopBar session={session} />
      <div class="player-body">
        <LessonPanel session={session} onDevice={select} />
        <main class={`stage-col ${session.step.kind === 'submit' ? 'summary-col' : ''}`}>
          {session.step.kind === 'submit' ? (
            <Summary session={session} />
          ) : (
            <>
              <Stage session={session} selected={selected} onSelect={select} />
              <Dock session={session} tab={tab} setTab={setTab} selected={selected} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
