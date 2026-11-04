import type { Sim } from '../sim/sim';
import type { Frame, LogEntry, SimEvent } from '../sim/types';
import type { CheckCtx } from './types';
import { matchFilter, parseFilter } from '../sim/displayFilter';

/**
 * Small building blocks for goal checks. A goal's check runs on every network
 * event while its step is open, so keep these cheap.
 */

/** A form login sent in the clear (HTTP POST with a password field). */
export const isPlainLogin = (f: Frame): boolean =>
  f.ip?.app.kind === 'http-req' && !f.ip.encrypted && f.ip.app.method === 'POST' && (f.ip.app.body ?? '').includes('pass=');

export const isEncrypted = (f: Frame): boolean => !!f.ip?.encrypted;

/** A Telnet login sent in the clear: a request to a Telnet service carrying the typed login. */
export const isTelnetLogin = (f: Frame): boolean =>
  f.ip?.app.kind === 'svc' && f.ip.app.app === 'telnet' && !f.ip.app.reply && !f.ip.encrypted && !!f.ip.app.text;

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

/** The student clicked a log line matching `pred` in the Logs tab. */
export const openedLog =
  (pred: (e: LogEntry) => boolean = () => true) =>
  ({ ev }: CheckCtx): boolean =>
    ev?.type === 'ui:open-log' && pred(ev.entry);

/** `device` wrote a log line matching `pred` since the step started. */
export function loggedSince(sim: Sim, device: string, since: number, pred: (e: LogEntry) => boolean): boolean {
  const logs = sim.dev(device).logs;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].t < since) return false;
    if (pred(logs[i])) return true;
  }
  return false;
}

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

/**
 * The student applied a display filter on `device` that shows exactly the
 * captured frames matching `want`: at least one, all of them, and nothing else
 * (packet-capture). Any filter that does that counts, so "dns" and
 * "udp.port == 53" both pass for DNS.
 */
export const filtered =
  (device: string, want: (f: Frame) => boolean) =>
  ({ sim, ev }: CheckCtx): boolean => {
    if (ev?.type !== 'ui:filter' || ev.device !== device) return false;
    const p = parseFilter(ev.filter);
    if (!p.ok || !p.node) return false;
    const cap = sim.dev(device).capture;
    let shown = 0;
    for (const c of cap) {
      const hit = matchFilter(p.node, c.frame);
      if (hit !== want(c.frame)) return false;
      if (hit) shown++;
    }
    return shown > 0;
  };
