import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CAPTURE_TOOLS, isLesson, TAB_TOOLS, toolKey, type LabDef } from '../labs/types';
import { LabSession } from '../runtime/session';
import { checkCable } from '../runtime/toolInput';
import { profile } from '../store/profile';
import { getProgress } from '../store/progress';
import { CaptureView, Inspector, Toolkit } from './Dock';
import { DemoStage } from './demos/DemoStage';
import { extraProtos, FORGED_COLOR, PROTO_BLURB, PROTO_COLOR, type Proto } from './describe';
import { Icon } from './icons';
import { jumpFor, type Jump } from './jump';
import { useActiveTime, useTeacherSync } from './labTracking';
import { LessonPanel } from './Lesson';
import { logDevices, LogsView } from './LogsView';
import { type Cabling, NetworkCanvas } from './NetworkCanvas';
import { Summary } from './Summary';
import { TopBar } from './TopBar';
import { termBig, termHeld } from './tools/Terminal';

type Tab = 'inspect' | 'capture' | 'tools' | 'logs';

/** The one-column layout (styles.css, max-width 900px): the lesson on top, the stage under it. */
const NARROW = '(max-width: 900px)';
const smoothScroll = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

const SPEEDS = [0.5, 1, 2, 4];
/** Network time per real millisecond at 1×: a third of real time, slow enough to follow each packet. */
const RATE = 1 / 3;

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
  // Plug and unplug cables right on the map once the lab hands out the cable tool.
  const cabling: Cabling | undefined =
    !replay && session.tools.some((t) => t.kind === 'cable')
      ? {
          check: (a, b) => {
            const tool = session.tools.find((t) => t.kind === 'cable');
            const r = checkCable(session.sim, a, undefined, b, undefined, tool?.kind === 'cable' ? tool.refuse : undefined);
            return r.ok ? null : r.msg;
          },
          connect: (a, b) => session.dispatch({ type: 'cable', a, b }),
          unplug: (id) => {
            const l = session.sim.links[id];
            if (l) session.dispatch({ type: 'unplug', device: l.a.device, iface: l.a.iface });
          },
          hint: !!session.step.tools?.some((t) => t.kind === 'cable'),
        }
      : undefined;

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
        if (!pausedRef.current && !rp.done) rp.advance(dt * speedRef.current * RATE);
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
        if (!pausedRef.current) sim.advance(dt * speedRef.current * RATE);
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

  // Escape closes the packet colors legend.
  useEffect(() => {
    if (!legend) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLegend(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [legend]);

  // Focus rings point at what to work on: they go once the step's goals are done.
  const goalsLeft = (session.step.goals ?? []).some((g) => !session.goalDone(session.step.id, g.id));
  const canReplay = session.canReplay();
  const protos: Proto[] = ['ARP', 'HTTP', 'HTTPS', 'DNS', 'ROUTE', 'PING', 'ETH', ...extraProtos(session.sim)];
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
          <button class="btn ghost small" aria-expanded={legend} onClick={() => setLegend(!legend)}>
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
        <NetworkCanvas
          sim={session.view}
          tick={tick}
          selected={selected}
          focus={goalsLeft || !session.step.goals?.length ? (session.step.focus ?? []) : []}
          onSelect={onSelect}
          opts={session.lab.map}
          cabling={cabling}
          since={replay ? undefined : session.since}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dock: inspector / capture / tools. Re-renders when the network changes, not every frame.
// ---------------------------------------------------------------------------

function Dock({
  session,
  tab,
  setTab,
  selected,
  onSelect,
  jump,
}: {
  session: LabSession;
  tab: Tab;
  setTab: (t: Tab) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  jump: Jump | null;
}) {
  void session.simRev.value;
  void session.rev.value;
  const lab = session.lab;
  // Tools that open their own tab (Logs) or live in the Capture tab don't count as new Toolkit cards.
  const tools = session.tools.filter((t) => !(TAB_TOOLS as readonly string[]).includes(t.kind) && !(CAPTURE_TOOLS as readonly string[]).includes(t.kind));
  const captureTools = session.tools.some((t) => (CAPTURE_TOOLS as readonly string[]).includes(t.kind));
  const capDev = lab.captureDevice ? session.sim.devices[lab.captureDevice] : undefined;
  // A terminal command is running, or a lesson button set the network moving: Bigger gives the map
  // its room back until it's done. After a button, a moment more, so its last packet and tag can be
  // seen landing. After a command, the output is what matters: the Terminal grows back at once.
  const sim = session.sim;
  const termMax = tab === 'tools' && termBig.value && tools.some((t) => t.kind === 'terminal');
  const lastRuns = Object.values(sim.devices).flatMap((d) => (d.term?.length ? [d.term[d.term.length - 1]] : []));
  const cmdBusy = termMax && lastRuns.some((r) => r.doneAt === undefined);
  const pressed = session.lastRun.value;
  const btnBusy =
    termMax &&
    !cmdBusy &&
    !!pressed &&
    pressed.step === session.step.id &&
    lastRuns.every((r) => r.t <= pressed.t) &&
    (!sim.idle || sim.inflight.length > 0 || sim.t - pressed.t < 1500);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (btnBusy) return setHold(true);
    const id = setTimeout(() => setHold(false), 1500);
    return () => clearTimeout(id);
  }, [btnBusy]);
  // The network's last quiet timer doesn't redraw anything: look again until it's done.
  const [, recheck] = useState(0);
  useEffect(() => {
    if (!cmdBusy && !btnBusy) return;
    const id = setInterval(() => recheck((n) => n + 1), 300);
    return () => clearInterval(id);
  }, [cmdBusy || btnBusy]);
  const held = termMax && (cmdBusy || btnBusy || hold);
  useEffect(() => {
    termHeld.value = held;
  }, [held]);
  // Bigger stays on through steps at the same Terminal (a scan, then a closer look at it), and
  // goes back to the usual size when the Terminal moves to another computer or another lab.
  const termAt = tools.flatMap((t) => (t.kind === 'terminal' ? t.devices : [])).join();
  useEffect(() => {
    termBig.value = false;
  }, [lab.id, termAt]);
  const logIds = logDevices(session);
  const logLines = logIds.reduce((n, id) => n + session.sim.devices[id].logs.length, 0);
  const seenLogs = useRef(logLines);
  if (tab === 'logs') seenLogs.current = logLines;
  // The dock is short on a laptop screen: say when there's more to scroll to.
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = body.current;
    const m = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 12;
    if (m !== more) setMore(m);
  };
  useLayoutEffect(measure);
  // A different tab or device starts at the top, not where the last one was scrolled to.
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [tab, selected]);
  // A lesson chip that points at a tool: scroll to it and make it glow.
  useLayoutEffect(() => {
    const el = body.current;
    if (!jump || !el || tab !== jump.tab || selected !== jump.device) return;
    const hits = jump.selectors
      .flatMap((sel) => [...el.querySelectorAll<HTMLElement>(sel)])
      .map((h) => (h.getClientRects().length ? h : (h.firstElementChild as HTMLElement | null)))
      .filter((h): h is HTMLElement => !!h && h.offsetHeight > 0);
    if (!hits.length) return;
    const top = el.scrollTop + hits[0].getBoundingClientRect().top - el.getBoundingClientRect().top - 10;
    el.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    for (const h of hits) {
      h.classList.remove('jump-glow');
      void h.offsetWidth; // restart the animation on a second click
      h.classList.add('jump-glow');
      h.addEventListener('animationend', () => h.classList.remove('jump-glow'), { once: true });
    }
  }, [jump?.n]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
  // "New tool" until the student opens the Toolkit and sees what this step brought.
  const keys = tools.map(toolKey);
  const seenTools = useRef<Set<string> | null>(null);
  seenTools.current ??= new Set(keys);
  const newTools = tab !== 'tools' && keys.some((k) => !seenTools.current!.has(k));
  if (tab === 'tools') for (const k of keys) seenTools.current.add(k);
  return (
    // A Wireshark-style lab (packet-capture) lives in the Capture tab: give its packet list more room.
    // So does a terminal in the Toolkit (net-tools): its output needs the lines.
    <div class={`dock ${(lab.wireshark && tab === 'capture') || (tab === 'tools' && tools.some((t) => t.kind === 'terminal')) ? 'dock-tall' : ''} ${termMax ? `dock-max ${held ? 'dock-busy' : ''}` : ''}`}>
      <div class="dock-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'inspect'}
          class={tab === 'inspect' ? 'on' : ''}
          onClick={() => {
            // A chip can open a device's Toolkit card first; looking inside it still counts as opening it.
            if (tab !== 'inspect' && selected) session.ui({ type: 'ui:inspect', device: selected });
            setTab('inspect');
          }}
        >
          <Icon name="target" /> Inspect{selected ? `: ${session.sim.devices[selected]?.label}` : ''}
        </button>
        {capDev && (
          <button role="tab" aria-selected={tab === 'capture'} class={tab === 'capture' ? 'on' : ''} onClick={() => setTab('capture')}>
            <Icon name="eye" /> Capture <span class="count">{capDev.capture.length}</span>
          </button>
        )}
        <button role="tab" aria-selected={tab === 'tools'} class={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')}>
          <Icon name="bolt" /> Toolkit {newTools && <span class="count new-tools">new tool</span>}
        </button>
        {logIds.length > 0 && (
          <button role="tab" aria-selected={tab === 'logs'} class={tab === 'logs' ? 'on' : ''} onClick={() => setTab('logs')}>
            <Icon name="list" /> Logs <span class={`count ${logLines > seenLogs.current ? 'new-tools' : ''}`}>{logLines}</span>
          </button>
        )}
      </div>
      <div class="dock-body" ref={body} onScroll={measure}>
        {tab === 'inspect' && <Inspector session={session} deviceId={selected} />}
        {tab === 'capture' && capDev && <CaptureView session={session} deviceId={capDev.id} />}
        {tab === 'tools' && <Toolkit session={session} tools={tools} onSelect={onSelect} inCapture={captureTools} selected={selected} />}
        {tab === 'logs' && <LogsView session={session} />}
      </div>
      {more && (
        <button class="more-below" onClick={() => body.current?.scrollBy({ top: body.current.clientHeight * 0.7, behavior: 'smooth' })}>
          More below <Icon name="chevronDown" size={13} />
        </button>
      )}
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
  const [jump, setJump] = useState<Jump | null>(null);
  const jumps = useRef(0);
  const stepId = session.step.id;
  void session.rev.value;
  const narrow = useNarrow();
  // On a narrow screen the stage drops below the whole lesson. A lesson's activities
  // move into the step instead, between its goals and its questions.
  const inlineDemos = narrow && isLesson(lab) && session.step.kind !== 'submit';

  useEffect(() => () => session.dispose(), [session]);

  // Open whatever the step asks for when it starts.
  useEffect(() => {
    const open = session.step.open;
    if (!open) return;
    if (open === 'capture' || open === 'tools' || open === 'logs') setTab(open);
    else {
      setSelected(open.inspect);
      setTab('inspect');
    }
  }, [stepId]);

  useActiveTime(session);
  useTeacherSync(session);

  const select = (id: string) => {
    setSelected(id);
    setTab('inspect');
    setJump(null);
    session.ui({ type: 'ui:inspect', device: id });
  };
  /**
   * A device chip in the lesson (toolkit: true) or a card's Open button: go
   * straight to the tool this step hands out for that device, if there is one.
   */
  const open = (id: string, toolkit: boolean) => {
    const dev = session.sim.devices[id];
    const j = dev ? jumpFor(session.tools, dev, toolkit, ++jumps.current) : null;
    setSelected(id);
    setTab(j?.tab ?? 'inspect');
    setJump(j);
    // A Toolkit card isn't the inspector: opening the device waits until the student looks inside it.
    if (j?.tab !== 'tools') session.ui({ type: 'ui:inspect', device: id });
  };

  return (
    <div class="player">
      <TopBar session={session} />
      <div class="player-body">
        <LessonPanel
          session={session}
          onDevice={(id) => {
            open(id, true);
            // On a narrow screen the map and its Dock sit below the lesson: bring them up, so the tap shows something.
            if (narrow) requestAnimationFrame(() => document.querySelector('.stage-col')?.scrollIntoView({ block: 'start', behavior: smoothScroll() }));
          }}
          narrow={narrow}
          demos={inlineDemos ? <DemoStage session={session} inline /> : undefined}
        />
        {!inlineDemos && (
          <main class={`stage-col ${session.step.kind === 'submit' ? 'summary-col' : isLesson(lab) ? 'demo-col' : ''}`}>
            {session.step.kind === 'submit' ? (
              <Summary session={session} />
            ) : isLesson(lab) ? (
              // A lesson with no network: the step's demos take the map's place.
              <DemoStage session={session} />
            ) : (
              <>
                <Stage session={session} selected={selected} onSelect={select} />
                <Dock session={session} tab={tab} setTab={setTab} selected={selected} onSelect={(id) => open(id, false)} jump={jump} />
              </>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
