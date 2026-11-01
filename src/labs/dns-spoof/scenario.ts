import { NetBuilder } from '../../sim/build';
import { freshEntry } from '../../sim/dns';
import type { Sim } from '../../sim/sim';
import type { WebSite } from '../../sim/types';

// Maple Grove School District. Students and a teacher share the district's DNS
// resolver. On the internet: the authoritative name server for grades.example,
// the real gradebook, and Mallory's lookalike server.

export const SITE = 'grades.example';

export const IP = {
  alice: '10.1.0.21',
  ben: '10.1.0.22',
  teacher: '10.1.0.23',
  resolver: '10.1.0.53',
  gw: '10.1.0.1',
  ns: '192.0.2.53',
  grades: '203.0.113.10',
  evil: '198.51.100.66',
};

const GRADES_PAGE = 'Sign in with your district account to see your grades.';
const GRADES_DASHBOARD = 'Your grades are posted for this term.';

export const GRADEBOOK: WebSite = {
  name: SITE,
  title: 'Maple Grove Gradebook',
  https: true,
  page: GRADES_PAGE,
  dashboard: GRADES_DASHBOARD,
};

/** Mallory's copy. It looks like the gradebook but holds no certificate for the name. */
export const LOOKALIKE: WebSite = {
  name: SITE,
  title: 'Maple Grove Gradebook',
  https: false,
  fake: true,
  page: GRADES_PAGE,
  dashboard: GRADES_DASHBOARD,
};

export const ALICE_LOGIN = 'user=alice&pass=tigers2014';
export const TEACHER_LOGIN = 'user=mr.ruiz&pass=gradebook!7';

/** How long the resolver keeps an answer (5 minutes of simulated time). */
export const TTL_MS = 300_000;

export function buildDistrict(): Sim {
  const net = new NetBuilder({ linkMs: 520, procMs: 120, httpTimeoutMs: 30_000, autoArp: true })
    .host('alice', { label: 'Alice', sublabel: 'student', icon: 'laptop', x: 90, y: 110, ip: `${IP.alice}/24`, gateway: IP.gw, dns: IP.resolver })
    .host('ben', { label: 'Ben', sublabel: 'student', icon: 'laptop', x: 90, y: 300, ip: `${IP.ben}/24`, gateway: IP.gw, dns: IP.resolver })
    .host('teacher', { label: 'Mr. Ruiz', sublabel: 'teacher', icon: 'desktop', x: 90, y: 490, ip: `${IP.teacher}/24`, gateway: IP.gw, dns: IP.resolver })
    .host('resolver', {
      label: 'District resolver',
      sublabel: IP.resolver,
      icon: 'server',
      x: 260,
      y: 110,
      ip: `${IP.resolver}/24`,
      gateway: IP.gw,
      resolver: { upstream: IP.ns, ttl: TTL_MS },
    })
    .switch('lan', { label: 'School switch', icon: 'switch', x: 260, y: 320 })
    .router('gw', {
      label: 'School router',
      sublabel: IP.gw,
      icon: 'router',
      x: 440,
      y: 320,
      ifaces: [
        { id: 'lan', ip: `${IP.gw}/24` },
        { id: 'wan', ip: '100.64.0.2/30' },
      ],
      routes: [{ prefix: '0.0.0.0/0', via: '100.64.0.1', iface: 'wan' }],
    })
    .router('inet', {
      label: 'The internet',
      icon: 'cloud',
      x: 630,
      y: 320,
      ifaces: [
        { id: 'school', ip: '100.64.0.1/30' },
        { id: 'ns', ip: '192.0.2.1/24' },
        { id: 'grades', ip: '203.0.113.1/24' },
        { id: 'evil', ip: '198.51.100.1/24' },
      ],
      routes: [{ prefix: '10.1.0.0/24', via: '100.64.0.2', iface: 'school' }],
    })
    .host('ns', {
      label: 'Name server',
      sublabel: `authority for ${SITE}`,
      icon: 'server',
      x: 820,
      y: 110,
      ip: `${IP.ns}/24`,
      gateway: '192.0.2.1',
      dnsZone: { [SITE]: IP.grades },
    })
    .host('grades', { label: 'Gradebook', sublabel: IP.grades, icon: 'server', x: 820, y: 320, ip: `${IP.grades}/24`, gateway: '203.0.113.1', web: GRADEBOOK })
    .host('evil', {
      label: 'Mallory',
      sublabel: IP.evil,
      icon: 'attacker',
      x: 820,
      y: 500,
      ip: `${IP.evil}/24`,
      gateway: '198.51.100.1',
      attacker: true,
      web: LOOKALIKE,
    })
    .link('alice', 'lan')
    .link('ben', 'lan')
    .link('teacher', 'lan')
    .link('resolver', 'lan')
    .link(['gw', 'lan'], 'lan')
    .link(['gw', 'wan'], ['inet', 'school'])
    .link(['inet', 'ns'], 'ns')
    .link(['inet', 'grades'], 'grades')
    .link(['inet', 'evil'], 'evil');
  const sim = net.build();
  sim.prelearnSwitch('lan');
  seedAccessLog(sim);
  return sim;
}

/**
 * Give the real gradebook a steady morning of visits before the lab starts, so
 * the drop to zero after the poisoning stands out in its access log. Times are
 * negative: they happened before the lab's clock.
 */
function seedAccessLog(sim: Sim): void {
  const visitors = [
    '10.1.0.31',
    '10.1.0.44',
    '10.1.0.52',
    '10.1.0.27',
    '10.1.0.61',
    '10.1.0.38',
    '10.1.0.49',
    '10.1.0.55',
  ];
  visitors.forEach((src, i) => {
    const at = -((visitors.length - i) * 7000);
    sim.log('grades', { source: 'web', level: 'info', msg: `GET / from ${src}`, fields: { src, method: 'GET', path: '/', host: SITE } }, at);
  });
  sim.events = [];
}

/** Ensure the resolver is holding the real answer for the gradebook, as if someone just looked it up. */
export function primeCache(sim: Sim): void {
  const r = sim.dev('resolver').resolver!;
  const e = freshEntry(r, SITE, sim.t);
  if (e && e.ip === IP.grades) return;
  // A stale or poisoned entry would be served from cache, so clear it first and
  // let the lookup really reach the name server.
  if (e) sim.flushResolverCache('resolver');
  sim.browse('ben', `http://${SITE}/`);
  sim.runUntilIdle();
}

/**
 * Poison the resolver so grades.example resolves to Mallory's server. Leaves an
 * already-poisoned cache untouched, so re-entering a later step does not churn
 * the resolver log with extra flush-and-repoison lines.
 */
export function ensurePoisoned(sim: Sim): void {
  const r = sim.dev('resolver').resolver!;
  if (freshEntry(r, SITE, sim.t)?.ip === IP.evil) return;
  primeCache(sim); // establish the real answer first, so the poison shows as a change
  sim.forgeDnsAnswer('evil', 'resolver', SITE, IP.evil);
  sim.runUntilIdle();
}
