// ---------------------------------------------------------------------------
// Recursive DNS resolver: cache, TTL, query IDs, and the surface a cache
// poisoning attack races against. Owned by the dns-spoof lab; the logs lab
// reuses the resolver log and the web access log.
//
// State types live here; the packet-flow logic is in sim.ts under
// "--- DNS resolver (dns-spoof) ---". Keep this module free of Sim imports so
// it stays easy to unit-test.
// ---------------------------------------------------------------------------

import type { Ip } from './addr';

/**
 * One answer the resolver is holding in memory. It is good until its TTL runs
 * out, after which the next lookup has to ask the name server again.
 */
export interface CacheEntry {
  ip: Ip;
  /** Simulated time the answer was cached. */
  at: number;
  /** How long the answer may be kept, in simulated milliseconds. */
  ttl: number;
  /** The address the accepted answer came from (a forgery claims the name server's address too). */
  from: Ip;
}

/** A lookup the resolver forwarded upstream and is waiting on an answer for. */
export interface PendingQuery {
  name: string;
  /** The query ID the resolver put on its outgoing question. An answer must echo it. */
  qid: number;
  /** The source port the resolver sent from. A real answer comes back to this port. */
  srcPort: number;
  /** Simulated time the question went out. */
  since: number;
  /** Clients waiting for this name: who to answer, and the IDs and ports to answer them on. */
  waiters: Waiter[];
}

export interface Waiter {
  ip: Ip;
  port: number;
  qid: number;
}

/**
 * A recursive resolver's state. A resolver answers clients from its cache, and
 * on a miss forwards the question to the authoritative name server for the zone.
 */
export interface DnsResolver {
  /** The authoritative name server this resolver forwards misses to. */
  upstream: Ip;
  /** name -> the answer being held, with its TTL. */
  cache: Record<string, CacheEntry>;
  /** Questions in flight, keyed by the outgoing query ID. */
  pending: Record<number, PendingQuery>;
  /** How long to keep each answer, in simulated milliseconds. */
  defaultTtl: number;
  /**
   * The defense: pick an unpredictable query ID and source port for every
   * question. Off by default, so the IDs and port are easy to guess.
   */
  hardened: boolean;
  /** Counter behind the predictable query IDs when the resolver is not hardened. */
  seq: number;
}

/**
 * The toy resolver, when it is not hardened, numbers its questions with a small
 * range of IDs and always sends from one port. That makes the attack visible: a
 * short burst of forged answers can cover every possible ID. Real DNS uses
 * 16-bit IDs (0 to 65535) and, since the Kaminsky attack of 2008, a random
 * source port too, which is what hardening turns on here.
 */
export const PREDICTABLE_IDS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export const PREDICTABLE_PORT = 33333;

/** A fresh resolver with an empty cache. */
export function newResolver(upstream: Ip, defaultTtl: number): DnsResolver {
  return { upstream, cache: {}, pending: {}, defaultTtl, hardened: false, seq: 0 };
}

/** The cached answer for `name`, if there is one and its TTL has not run out. */
export function freshEntry(r: DnsResolver, name: string, now: number): CacheEntry | undefined {
  const e = r.cache[name];
  return e && e.at + e.ttl > now ? e : undefined;
}

/** Milliseconds left before a cache entry expires (0 once it is stale). */
export function ttlLeft(e: CacheEntry, now: number): number {
  return Math.max(0, e.at + e.ttl - now);
}

/**
 * The query ID and source port the resolver puts on its next outgoing question.
 * Hardened: a random ID over the full range and a random high port. Not
 * hardened: the next ID in the small predictable range, always from one port.
 */
export function nextQueryParams(r: DnsResolver, randInt: (n: number) => number): { qid: number; port: number } {
  if (r.hardened) return { qid: randInt(65536), port: 1024 + randInt(64000) };
  const qid = PREDICTABLE_IDS[r.seq % PREDICTABLE_IDS.length];
  r.seq++;
  return { qid, port: PREDICTABLE_PORT };
}

/** The IDs and port a forger guesses: the whole predictable range, at the predictable port. */
export function forgedGuesses(): { qid: number; port: number }[] {
  return PREDICTABLE_IDS.map((qid) => ({ qid, port: PREDICTABLE_PORT }));
}
