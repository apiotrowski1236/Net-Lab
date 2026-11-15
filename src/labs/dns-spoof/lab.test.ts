import { describe, expect, it } from 'vitest';
import { checkForge } from '../../runtime/toolInput';
import { freshEntry } from '../../sim/dns';
import { dnsSpoofLab } from './index';
import { buildDistrict, ensurePoisoned, IP, primeAndExpire, primeCache, SITE, TTL_MS } from './scenario';
import type { Sim } from '../../sim/sim';

const step = (id: string) => dnsSpoofLab.steps.find((s) => s.id === id)!;
const burst = step('fix').actions!.find((a) => a.id === 'forge-again')!;
const cached = (sim: Sim) => sim.dev('resolver').resolver!.cache[SITE]?.ip;

describe('DNS forger input', () => {
  it('accepts the name with a final dot or capitals, once the record has expired', () => {
    const sim = buildDistrict();
    primeAndExpire(sim);
    const r = checkForge(sim, 'evil', 'resolver', ' Grades.Example. ', IP.evil);
    expect(r).toEqual({ ok: true, name: SITE, ip: IP.evil });
  });

  it('refuses while the resolver holds a fresh answer, and says why', () => {
    const sim = buildDistrict();
    primeCache(sim);
    const r = checkForge(sim, 'evil', 'resolver', SITE, IP.evil);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.msg).toMatch(
      /^The resolver has a fresh answer for grades\.example for another \d+s, so it is not asking the name server\. A forged answer has no question to match until that answer expires or is flushed\.$/,
    );
  });

  it('refuses a second burst once the cache already points at Mallory', () => {
    const sim = buildDistrict();
    ensurePoisoned(sim);
    const r = checkForge(sim, 'evil', 'resolver', SITE, IP.evil);
    expect(r).toEqual({ ok: false, field: 'ip', msg: `The resolver already sends ${SITE} to ${IP.evil}.` });
  });
});

describe('setups', () => {
  it("step 5's setup lets the TTL run out, so the clock moves past it", () => {
    const sim = buildDistrict();
    primeCache(sim);
    const at = sim.dev('resolver').resolver!.cache[SITE].at;
    sim.quiet = true;
    primeAndExpire(sim);
    sim.quiet = false;
    expect(sim.t).toBeGreaterThan(at + TTL_MS);
    expect(freshEntry(sim.dev('resolver').resolver!, SITE, sim.t)).toBeUndefined();
    expect(cached(sim)).toBe(IP.grades); // still listed, marked expired
  });

  it('ensurePoisoned keeps an existing poisoning and logs the change it made', () => {
    const sim = buildDistrict();
    ensurePoisoned(sim);
    const lines = sim.dev('resolver').logs.length;
    ensurePoisoned(sim);
    expect(sim.dev('resolver').logs.length).toBe(lines);
    expect(sim.dev('resolver').logs.some((l) => l.msg === `cached ${SITE} -> ${IP.evil} (was ${IP.grades})`)).toBe(true);
  });
});

describe('"Mallory sends another forged burst" result line', () => {
  it('says the burst matched when the resolver is flushed but not hardened', () => {
    const sim = buildDistrict();
    ensurePoisoned(sim);
    sim.flushResolverCache('resolver');
    const since = sim.t;
    burst.run(sim);
    expect(burst.outcome!(sim, since)).toEqual([
      { tone: 'wait', text: "The resolver asked the name server. Mallory's 8 forged answers are racing the real one." },
    ]);
    sim.runUntilIdle();
    expect(burst.outcome!(sim, since)).toEqual([
      { tone: 'bad', text: `A forged answer matched the ticket number and port. ${SITE} points at Mallory again.` },
    ]);
  });

  it('says no guess matched once the resolver is flushed and hardened', () => {
    const sim = buildDistrict();
    ensurePoisoned(sim);
    sim.flushResolverCache('resolver');
    sim.setResolverHardened('resolver', true);
    const since = sim.t;
    burst.run(sim);
    sim.runUntilIdle();
    expect(cached(sim)).toBe(IP.grades);
    expect(burst.outcome!(sim, since)).toEqual([
      { tone: 'good', text: 'None of the 8 forged answers matched the random ticket number and port. The real answer won.' },
    ]);
  });

  it('says the resolver asked nothing while it holds a fresh answer', () => {
    const sim = buildDistrict();
    primeCache(sim);
    const since = sim.t;
    burst.run(sim);
    sim.runUntilIdle();
    expect(cached(sim)).toBe(IP.grades);
    expect(burst.outcome!(sim, since)).toEqual([
      { tone: 'good', text: `The resolver already had a fresh answer for ${SITE}, so it asked nothing. All 8 forged answers were thrown away.` },
    ]);
  });
});
