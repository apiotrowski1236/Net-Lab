import { buildNetwork } from '../labs/network';
import type { LabDef } from '../labs/types';
import type { Sim } from '../sim/sim';
import type { LabProgress } from '../store/progress';
import { applyAction } from './actions';

/** Quiet stretches longer than this are skipped during a replay. */
const MAX_GAP_MS = 600;
/** How much quiet to leave before the next thing happens, so it doesn't start abruptly. */
const LEAD_MS = 250;

/**
 * The stretch of simulated time a step covers: from when the student first
 * opened it to when they first opened a later one (or now, for the newest step).
 */
export function stepWindow(lab: LabDef, p: LabProgress, index: number, now: number): { from: number; to: number } | null {
  const from = p.stepStart[lab.steps[index].id];
  if (from === undefined) return null;
  const later = lab.steps
    .slice(index + 1)
    .map((s) => p.stepStart[s.id])
    .filter((t): t is number => t !== undefined && t >= from);
  return { from, to: later.length ? Math.min(...later) : now };
}

/** True when the student did something on the network during the step (setups don't count). */
export function hasReplay(lab: LabDef, p: LabProgress, index: number, now: number): boolean {
  const w = stepWindow(lab, p, index, now);
  return !!w && p.actions.some((x) => x.a.type !== 'setup' && x.t >= w.from && x.t < w.to);
}

/**
 * A second copy of the network that replays one step, for students who want
 * to watch it again. It never touches the student's real network or goals.
 */
export class Replay {
  readonly sim: Sim;
  readonly from: number;
  readonly to: number;
  private pending: LabProgress['actions'];
  private dirty = true;

  constructor(
    private readonly lab: LabDef,
    actions: LabProgress['actions'],
    window: { from: number; to: number },
    readonly stepIndex: number,
  ) {
    this.from = window.from;
    this.to = window.to;
    // Rebuild the network as it was when the step opened.
    const sim = buildNetwork(lab);
    for (const x of actions) {
      if (x.t >= window.from) continue;
      sim.advanceTo(x.t);
      applyAction(lab, sim, x.a);
    }
    sim.advanceTo(window.from);
    // Forget what happened before, so the map and capture start clean.
    sim.events = [];
    for (const d of Object.values(sim.devices)) d.capture = [];
    this.sim = sim;
    this.pending = actions.filter((x) => x.t >= window.from && x.t < window.to);
    sim.on(() => (this.dirty = true));
  }

  get done(): boolean {
    if (this.pending.length || this.sim.inflight.length) return false;
    const next = this.sim.nextJobAt;
    return next === undefined || next > this.to;
  }

  /** 0 to 1, for a progress bar. */
  get progress(): number {
    const span = Math.max(1, this.to - this.from);
    return Math.min(1, Math.max(0, (this.sim.t - this.from) / span));
  }

  /** Move the replay forward by `dt` ms of simulated time. Quiet gaps are skipped. */
  advance(dt: number): void {
    const sim = this.sim;
    if (!sim.inflight.length) {
      const next = Math.min(this.pending[0]?.t ?? Infinity, sim.nextJobAt ?? Infinity);
      if (next !== Infinity && next - sim.t > MAX_GAP_MS) sim.advanceTo(next - LEAD_MS);
    }
    const target = sim.t + dt;
    while (this.pending.length && this.pending[0].t <= target) {
      const x = this.pending.shift()!;
      sim.advanceTo(x.t);
      applyAction(this.lab, sim, x.a);
      this.dirty = true;
    }
    sim.advanceTo(target);
  }

  consumeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }
}
