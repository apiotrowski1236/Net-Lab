import type { Ip, Mac } from './addr';
import type { Frame } from './types';

/**
 * Aggregated frames (built for `mac-flood`, reused by `smurf`).
 *
 * A flood is thousands of frames. Putting each one in flight would stall the
 * map and the walkthrough test, so the simulator sends one frame that stands
 * for many: `Frame.burst`. The map draws it as a stack with a count ("×20").
 *
 * Copies can differ in one field (`vary`). Copy i's value comes from the
 * burst's `seed` and i alone, so a replay makes the same values. Take the seed
 * from `sim.randInt`, never Math.random. Use `burstCopy(frame, i)` to look at
 * one copy, and `burstSize(frame)` to count a frame as all the frames it
 * stands for (link capacity, traffic meters).
 *
 * Who understands bursts:
 *  - Switches learn every copy's source MAC when `vary` is 'src-mac' (see
 *    switchsec.ts), and port security checks each one.
 *  - Everything else treats a burst as one frame unless it checks
 *    `frame.burst` itself. A lab feature that cares (a host answering a
 *    flood of pings, a link filling up) reads `burst.count`.
 */
export interface Burst {
  /** How many real frames this one stands for. */
  count: number;
  /**
   * The field that changes from copy to copy:
   *  - 'src-mac': each copy has its own made-up source MAC (MAC flooding).
   *  - 'src-ip': each copy has its own made-up source IP (a spoofed flood).
   *  - 'none' (or missing): identical copies (a plain flood).
   */
  vary?: 'src-mac' | 'src-ip' | 'none';
  /** Seeds the varying values. Copy 0 is the frame itself. */
  seed: number;
}

/** How many frames this frame stands for: its burst count, or 1. */
export function burstSize(f: Frame): number {
  return f.burst?.count ?? 1;
}

/** Deterministic 32-bit mix of a seed and an index. */
function mix(seed: number, i: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Copy i's made-up MAC. The first byte is even with the "locally
 * administered" bit set, like the random MACs flooding tools and phones use,
 * so it never collides with a lab's hand-picked addresses (which start 0a, 0c, 0e).
 */
export function burstMac(seed: number, i: number): Mac {
  const a = mix(seed, i);
  const b = mix(seed ^ 0x5bd1e995, i);
  const first = ((a >>> 24) & 0xf0) | 0x02;
  const bytes = [first, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, (b >>> 8) & 255, b & 255];
  return bytes.map((x) => x.toString(16).padStart(2, '0')).join(':');
}

/** Copy i's made-up source IP: a public-looking address (never 0, 10, 127, 192.168, or 224 and up). */
export function burstIp(seed: number, i: number): Ip {
  const a = mix(seed ^ 0x27d4eb2f, i);
  let first = 11 + (((a >>> 24) & 255) % 212);
  if (first === 127) first = 128;
  const second = (a >>> 16) & 255;
  if (first === 192 && second === 168) first = 193;
  return [first, second, (a >>> 8) & 255, 1 + ((a & 255) % 254)].join('.');
}

/** The source MACs of every copy in a burst. */
export function burstMacs(f: Frame): Mac[] {
  const b = f.burst;
  if (!b || b.vary !== 'src-mac') return [f.src];
  const out: Mac[] = [];
  for (let i = 0; i < b.count; i++) out.push(i === 0 ? f.src : burstMac(b.seed, i));
  return out;
}

/** Copy i of a burst, as a plain frame (no `burst` field). Copy 0 is the frame itself. */
export function burstCopy(f: Frame, i: number): Frame {
  const { burst, ...plain } = f;
  if (!burst || i === 0 || burst.vary === 'none' || !burst.vary) return { ...plain };
  if (burst.vary === 'src-mac') return { ...plain, src: burstMac(burst.seed, i) };
  return plain.ip ? { ...plain, ip: { ...plain.ip, src: burstIp(burst.seed, i) } } : { ...plain };
}
