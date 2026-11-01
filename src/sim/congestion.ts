/**
 * Link capacity and congestion (built for `smurf`).
 *
 * A real flood is thousands of packets a second filling a link so ordinary
 * traffic has no room. The walkthrough test (and a saved replay) plays one
 * move at a time, running the network to a standstill after each, so a flood
 * and a victim's request never share the clock: counting packets in a sliding
 * window would never see them collide.
 *
 * So a flood is modelled as a steady *load* on a link — a packets-per-second
 * number a lesson action switches on, and a fix switches off — rather than as
 * individual packets. A link with a `capacityPps` drops an ordinary packet
 * (reason 'congestion') while the load on it leaves no headroom. A burst frame
 * (see burst.ts) stands for the flood itself and passes, so students still see
 * it cross the link and reach a firewall; only single packets get squeezed out.
 * The traffic meter reads the same load, so "the link is full" and "a packet is
 * dropped" always agree.
 */

export type FloodKind = 'smurf' | 'botnet';

/** A steady load one attack puts on one link. */
export interface Flood {
  kind: FloodKind;
  link: string;
  /** Packets per second this flood adds to the link. */
  rate: number;
}

export interface CongestionState {
  floods: Flood[];
}

export function newCongestion(): CongestionState {
  return { floods: [] };
}

/** Switch on (or change) a flood of `kind` loading `link` at `rate` packets per second. */
export function setFlood(c: CongestionState, link: string, kind: FloodKind, rate: number): void {
  const existing = c.floods.find((f) => f.kind === kind && f.link === link);
  if (existing) existing.rate = rate;
  else c.floods.push({ kind, link, rate });
}

/** Switch off every flood of `kind` (on any link). */
export function clearFlood(c: CongestionState, kind: FloodKind): void {
  c.floods = c.floods.filter((f) => f.kind !== kind);
}

/** Switch off every flood, whatever its kind. */
export function clearAllFloods(c: CongestionState): void {
  c.floods = [];
}

/** The total load on a link: the sum of the floods running over it, in packets per second. */
export function linkLoad(c: CongestionState, link: string): number {
  let sum = 0;
  for (const f of c.floods) if (f.link === link) sum += f.rate;
  return sum;
}
