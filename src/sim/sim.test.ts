import { describe, expect, it } from 'vitest';
import { prefixContains, prefixCovers, normalizePrefix } from './addr';
import { buildCafe, enableWpa2, IP, LOGIN_BODY, MAC } from '../labs/on-path/scenario';
import { buildInternet, BANK_IP, BANK_PREFIX, FAKE_BANK, LOGIN_BODY as BANK_LOGIN, MORE_SPECIFIC, replayAnnouncements } from '../labs/route-hijack/scenario';
import type { SimEvent } from './types';

const loginCaptured = (events: SimEvent[], device: string) =>
  events.some(
    (e) =>
      e.type === 'captured' &&
      e.device === device &&
      e.frame.ip?.app.kind === 'http-req' &&
      !e.frame.ip.encrypted &&
      (e.frame.ip.app.body ?? '').includes('pass='),
  );

describe('addr', () => {
  it('matches prefixes', () => {
    expect(prefixContains('203.0.113.0/24', '203.0.113.10')).toBe(true);
    expect(prefixContains('203.0.113.0/25', '203.0.113.200')).toBe(false);
    expect(prefixContains('0.0.0.0/0', '8.8.8.8')).toBe(true);
    expect(prefixCovers('203.0.113.0/24', '203.0.113.0/25')).toBe(true);
    expect(prefixCovers('203.0.113.0/25', '203.0.113.0/24')).toBe(false);
    expect(normalizePrefix('203.0.113.77/24')).toBe('203.0.113.0/24');
  });
});

describe('café network (on-path lab)', () => {
  it('Alice ARPs for the router, then loads the bank page', () => {
    const sim = buildCafe();
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(sim.dev('alice').arp[IP.router]?.mac).toBe(MAC.router);
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    expect(sim.dev('alice').browser?.body).toContain('Welcome back, alice');
  });

  it('on open Wi-Fi a sniffer sees the plaintext password', () => {
    const sim = buildCafe();
    sim.setSniffing('mallory', true);
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(loginCaptured(sim.events, 'mallory')).toBe(true);
  });

  it('with WPA2 (switched) the sniffer no longer sees it', () => {
    const sim = buildCafe();
    enableWpa2(sim);
    sim.setSniffing('mallory', true);
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    expect(loginCaptured(sim.events, 'mallory')).toBe(false);
  });

  it('ARP poisoning without forwarding breaks Alice’s connection', () => {
    const sim = buildCafe();
    enableWpa2(sim);
    sim.arpSpoof('mallory', 'alice', IP.router);
    sim.arpSpoof('mallory', 'router', IP.alice);
    sim.runUntilIdle();
    expect(sim.dev('alice').arp[IP.router]?.mac).toBe(MAC.mallory);
    expect(sim.dev('router').arp[IP.alice]?.mac).toBe(MAC.mallory);
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('failed');
    expect(sim.events.some((e) => e.type === 'drop' && e.device === 'mallory' && e.reason === 'not-forwarding')).toBe(true);
  });

  it('ARP poisoning with forwarding is an invisible man-in-the-middle', () => {
    const sim = buildCafe();
    enableWpa2(sim);
    sim.setSniffing('mallory', true);
    sim.setForwarding('mallory', true);
    sim.arpSpoof('mallory', 'alice', IP.router);
    sim.arpSpoof('mallory', 'router', IP.alice);
    sim.runUntilIdle();
    sim.browse('alice', 'http://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    expect(loginCaptured(sim.events, 'mallory')).toBe(true);
    // The response came back through Mallory too.
    expect(sim.events.some((e) => e.type === 'forwarded' && e.device === 'mallory' && e.frame.ip?.app.kind === 'http-res')).toBe(true);
  });

  it('HTTPS hides the password even from a man-in-the-middle', () => {
    const sim = buildCafe();
    enableWpa2(sim);
    sim.setSniffing('mallory', true);
    sim.setForwarding('mallory', true);
    sim.arpSpoof('mallory', 'alice', IP.router);
    sim.arpSpoof('mallory', 'router', IP.alice);
    sim.runUntilIdle();
    sim.browse('alice', 'https://bank.example/login', LOGIN_BODY);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    expect(loginCaptured(sim.events, 'mallory')).toBe(false);
    expect(sim.events.some((e) => e.type === 'captured' && e.device === 'mallory' && e.frame.ip?.encrypted)).toBe(true);
  });

  it('a static ARP entry rejects the forged reply', () => {
    const sim = buildCafe();
    sim.setStaticArp('alice', IP.router, MAC.router);
    sim.arpSpoof('mallory', 'alice', IP.router);
    sim.runUntilIdle();
    expect(sim.dev('alice').arp[IP.router].mac).toBe(MAC.router);
    expect(sim.events.some((e) => e.type === 'arp-rejected')).toBe(true);
  });

  it('is deterministic', () => {
    const run = () => {
      const sim = buildCafe();
      sim.setSniffing('mallory', true);
      sim.browse('alice', 'http://bank.example/', undefined);
      sim.advance(1234);
      sim.arpSpoof('mallory', 'alice', IP.router);
      sim.runUntilIdle();
      return JSON.stringify({ t: sim.t, ev: sim.events.length, cap: sim.dev('mallory').capture.length });
    };
    expect(run()).toBe(run());
  });
});

describe('internet routing (route hijack lab)', () => {
  const pathAt = (sim: ReturnType<typeof buildInternet>, dev: string, ip = BANK_IP) => sim.lookup(sim.dev(dev), ip)?.asPath;

  it('converges to the real path', () => {
    const sim = buildInternet();
    expect(pathAt(sim, 'home')).toEqual([200, 300, 400]);
    expect(pathAt(sim, 'east')).toEqual([400]);
    sim.browse('alice', 'http://bank.example/', undefined);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
  });

  it('replaying announcements changes nothing but resends them', () => {
    const sim = buildInternet();
    replayAnnouncements(sim, BANK_PREFIX, 'bankhost');
    sim.runUntilIdle();
    expect(pathAt(sim, 'home')).toEqual([200, 300, 400]);
  });

  it('an equal-prefix hijack fools nearby networks only', () => {
    const sim = buildInternet();
    sim.announce('shady', BANK_PREFIX);
    sim.runUntilIdle();
    expect(pathAt(sim, 'home')).toEqual([200, 666]);
    expect(pathAt(sim, 'west')).toEqual([666]);
    expect(pathAt(sim, 'east')).toEqual([400]);
    sim.browse('alice', 'http://bank.example/', undefined);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('failed');
    expect(sim.events.some((e) => e.type === 'drop' && e.device === 'shady' && e.reason === 'blackhole')).toBe(true);
  });

  it('a more-specific hijack fools everyone', () => {
    const sim = buildInternet();
    sim.announce('shady', MORE_SPECIFIC);
    sim.runUntilIdle();
    expect(pathAt(sim, 'east')).toEqual([200, 666]);
    expect(pathAt(sim, 'home')).toEqual([200, 666]);
  });

  it('an impersonating hijacker steals plaintext logins but not HTTPS ones', () => {
    const sim = buildInternet();
    sim.dev('shady').impersonate = FAKE_BANK;
    sim.announce('shady', MORE_SPECIFIC);
    sim.runUntilIdle();
    sim.browse('alice', 'http://bank.example/login', BANK_LOGIN);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    expect(sim.dev('shady').stolen).toHaveLength(1);
    sim.browse('alice', 'https://bank.example/login', BANK_LOGIN);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('warning');
    expect(sim.dev('shady').stolen).toHaveLength(1);
  });

  it('route origin validation at the attacker’s neighbor undoes the hijack', () => {
    const sim = buildInternet();
    sim.announce('shady', BANK_PREFIX);
    sim.announce('shady', MORE_SPECIFIC);
    sim.runUntilIdle();
    sim.setValidation('west', true);
    sim.runUntilIdle();
    expect(pathAt(sim, 'home')).toEqual([200, 300, 400]);
    expect(pathAt(sim, 'east')).toEqual([400]);
    expect(sim.events.some((e) => e.type === 'route-rejected')).toBe(true);
    // New bad announcements are rejected on arrival too.
    sim.withdraw('shady', MORE_SPECIFIC);
    sim.announce('shady', MORE_SPECIFIC);
    sim.runUntilIdle();
    expect(pathAt(sim, 'home')).toEqual([200, 300, 400]);
    sim.browse('alice', 'http://bank.example/', undefined);
    sim.runUntilIdle();
    expect(sim.dev('alice').browser?.status).toBe('loaded');
    expect(sim.dev('alice').browser?.fake).toBe(false);
  });

  it('withdrawing the hijack restores the real path', () => {
    const sim = buildInternet();
    sim.announce('shady', BANK_PREFIX);
    sim.runUntilIdle();
    sim.withdraw('shady', BANK_PREFIX);
    sim.runUntilIdle();
    expect(pathAt(sim, 'home')).toEqual([200, 300, 400]);
  });
});
