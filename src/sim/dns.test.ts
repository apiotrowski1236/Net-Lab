import { describe, expect, it } from 'vitest';
import {
  forgedGuesses,
  freshEntry,
  nextQueryParams,
  newResolver,
  PREDICTABLE_IDS,
  PREDICTABLE_PORT,
  ttlLeft,
} from './dns';
import { buildDistrict, ensurePoisoned, IP, primeCache, SITE, TTL_MS } from '../labs/dns-spoof/scenario';
import type { Sim } from './sim';

/** Count the upstream questions the resolver sent (one log line per question). */
const upstreamQueries = (sim: Sim): number =>
  sim.dev('resolver').logs.filter((l) => l.source === 'dns' && l.msg.startsWith('query ')).length;

const cachedIp = (sim: Sim): string | undefined => sim.dev('resolver').resolver!.cache[SITE]?.ip;

describe('resolver cache helpers', () => {
  it('predictable query params cycle through the small ID range at one port', () => {
    const r = newResolver(IP.ns, 1000);
    const seen = PREDICTABLE_IDS.map(() => nextQueryParams(r, () => 0));
    expect(seen.map((s) => s.qid)).toEqual([...PREDICTABLE_IDS]);
    expect(seen.every((s) => s.port === PREDICTABLE_PORT)).toBe(true);
    // Wraps around, so the burst only ever needs to cover this range.
    expect(nextQueryParams(r, () => 0).qid).toBe(PREDICTABLE_IDS[0]);
  });

  it('hardened query params use the full ID range, which the forged burst never covers', () => {
    const r = newResolver(IP.ns, 1000);
    r.hardened = true;
    const big = nextQueryParams(r, () => 65535);
    expect(big.qid).toBe(65535);
    // The burst only guesses the small range, so a full-range ID is out of reach.
    expect(forgedGuesses().some((g) => g.qid === big.qid)).toBe(false);
    expect(forgedGuesses().every((g) => g.port === PREDICTABLE_PORT)).toBe(true);
  });

  it('a cache entry is fresh until its TTL runs out', () => {
    const r = newResolver(IP.ns, 1000);
    r.cache[SITE] = { ip: IP.grades, at: 0, ttl: 1000, from: IP.ns };
    expect(freshEntry(r, SITE, 500)?.ip).toBe(IP.grades);
    expect(ttlLeft(r.cache[SITE], 500)).toBe(500);
    expect(freshEntry(r, SITE, 1500)).toBeUndefined();
    expect(ttlLeft(r.cache[SITE], 1500)).toBe(0);
  });
});

describe('Maple Grove resolver (dns-spoof lab)', () => {
  it('a first lookup asks the name server and loads the real gradebook', () => {
    const sim = buildDistrict();
    sim.browse('alice', `http://${SITE}/`);
    sim.runUntilIdle();
    expect(upstreamQueries(sim)).toBe(1);
    expect(cachedIp(sim)).toBe(IP.grades);
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    expect(sim.dev('alice').browser?.from).toBe(IP.grades);
  });

  it('a second lookup for the same name is answered from the cache, with no new question', () => {
    const sim = buildDistrict();
    sim.browse('alice', `http://${SITE}/`);
    sim.runUntilIdle();
    const before = upstreamQueries(sim);
    sim.browse('ben', `http://${SITE}/`);
    sim.runUntilIdle();
    expect(upstreamQueries(sim)).toBe(before); // no new upstream question
    expect(sim.dev('resolver').logs.some((l) => l.msg === `cache hit ${SITE} -> ${IP.grades}`)).toBe(true);
    expect(sim.dev('ben').browser?.from).toBe(IP.grades);
  });

  it('a matching forged burst poisons the cache before the real answer gets back', () => {
    const sim = buildDistrict();
    primeCache(sim);
    expect(cachedIp(sim)).toBe(IP.grades);
    sim.forgeDnsAnswer('evil', 'resolver', SITE, IP.evil);
    sim.runUntilIdle();
    expect(cachedIp(sim)).toBe(IP.evil);
    // The change is logged at notice level, naming the address it replaced.
    expect(
      sim.dev('resolver').logs.some((l) => l.level === 'notice' && l.msg === `cached ${SITE} -> ${IP.evil} (was ${IP.grades})`),
    ).toBe(true);
  });

  it('a poisoned resolver sends Alice to the lookalike page', () => {
    const sim = buildDistrict();
    ensurePoisoned(sim);
    sim.browse('alice', `http://${SITE}/`);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.from).toBe(IP.evil);
    expect(sim.dev('alice').browser?.fake).toBe(true);
  });

  it('unpredictable query IDs defeat the forged burst: the cache keeps the real answer', () => {
    const sim = buildDistrict();
    primeCache(sim);
    sim.setResolverHardened('resolver', true);
    sim.forgeDnsAnswer('evil', 'resolver', SITE, IP.evil);
    sim.runUntilIdle();
    expect(cachedIp(sim)).toBe(IP.grades);
    expect(sim.dev('resolver').logs.some((l) => l.msg.includes(`${IP.evil}`))).toBe(false);
  });

  it('a hardened resolver still lets Alice reach the real gradebook', () => {
    const sim = buildDistrict();
    sim.setResolverHardened('resolver', true);
    sim.forgeDnsAnswer('evil', 'resolver', SITE, IP.evil);
    sim.runUntilIdle();
    sim.browse('alice', `http://${SITE}/`);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.from).toBe(IP.grades);
    expect(sim.dev('alice').browser?.fake).toBeFalsy();
  });

  it('flushing the cache forces the next lookup to ask the name server again', () => {
    const sim = buildDistrict();
    ensurePoisoned(sim);
    expect(cachedIp(sim)).toBe(IP.evil);
    sim.flushResolverCache('resolver');
    expect(cachedIp(sim)).toBeUndefined();
    const before = upstreamQueries(sim);
    sim.browse('ben', `http://${SITE}/`);
    sim.runUntilIdle();
    expect(upstreamQueries(sim)).toBe(before + 1);
    expect(cachedIp(sim)).toBe(IP.grades);
  });

  it('the cached answer expires on its own once the TTL runs out', () => {
    const sim = buildDistrict();
    primeCache(sim);
    const before = upstreamQueries(sim);
    sim.advance(TTL_MS + 1000);
    expect(freshEntry(sim.dev('resolver').resolver!, SITE, sim.t)).toBeUndefined();
    sim.browse('ben', `http://${SITE}/`);
    sim.runUntilIdle();
    expect(upstreamQueries(sim)).toBe(before + 1); // had to ask again
  });

  it('replays deterministically: the same moves give the same cache', () => {
    const run = () => {
      const sim = buildDistrict();
      primeCache(sim);
      sim.forgeDnsAnswer('evil', 'resolver', SITE, IP.evil);
      sim.runUntilIdle();
      return cachedIp(sim);
    };
    expect(run()).toBe(IP.evil);
    expect(run()).toBe(run());
  });
});
