import type { Sim } from '../sim/sim';
import type { Frame, SimEvent } from '../sim/types';
import type { CheckCtx } from './types';

/**
 * Small building blocks for goal checks. A goal's check runs on every network
 * event while its step is open, so keep these cheap.
 */

/** A form login sent in the clear (HTTP POST with a password field). */
export const isPlainLogin = (f: Frame): boolean =>
  f.ip?.app.kind === 'http-req' && !f.ip.encrypted && f.ip.app.method === 'POST' && (f.ip.app.body ?? '').includes('pass=');

export const isEncrypted = (f: Frame): boolean => !!f.ip?.encrypted;

/** The student clicked this device on the map (or its chip in the lesson). */
export const inspected =
  (device: string) =>
  ({ ev }: CheckCtx): boolean =>
    ev?.type === 'ui:inspect' && ev.device === device;

/** The student opened a captured frame matching `pred` in the Capture tab. */
export const openedFrame =
  (device: string, pred: (f: Frame) => boolean = () => true) =>
  ({ ev }: CheckCtx): boolean =>
    ev?.type === 'ui:open-frame' && ev.device === device && pred(ev.frame);

/** Some event since the step started matches. */
export function happened(sim: Sim, since: number, pred: (e: SimEvent) => boolean): boolean {
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i];
    if (e.t < since) return false;
    if (pred(e)) return true;
  }
  return false;
}

/** The device captured a frame matching `pred` since the step started. */
export function capturedSince(sim: Sim, device: string, since: number, pred: (f: Frame) => boolean): boolean {
  return sim.dev(device).capture.some((c) => c.t >= since && pred(c.frame));
}

/** The device's browser finished a page this step that matches `pred`. */
export function pageSince(sim: Sim, device: string, since: number, pred: (b: NonNullable<ReturnType<Sim['dev']>['browser']>) => boolean): boolean {
  const b = sim.dev(device).browser;
  return !!b && b.startedAt >= since && pred(b);
}

/** The AS path a router would use to reach `ip`, or undefined if it has no route. */
export function asPathTo(sim: Sim, device: string, ip: string): number[] | undefined {
  return sim.lookup(sim.dev(device), ip)?.asPath;
}
