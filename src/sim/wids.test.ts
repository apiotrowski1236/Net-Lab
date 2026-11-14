import { describe, expect, it } from 'vitest';
import { NetBuilder } from './build';
import { clientPasses, matchesProfile, type WifiAp, type WifiProfile } from './wifi';
import { alertsFor, looksLike, newWidsState, noiseLevel, replayRecord, type AirRecord } from './wids';

const REAL: WifiAp = { ssid: 'Home', bssid: '02:00:00:00:00:01', security: 'wpa3', wps: false, auth: 'eap', users: ['amy'], server: 'radius.home', beacon: true, power: 2, channel: 6 };
const PROFILE: WifiProfile = { security: 'wpa3', auth: 'eap', server: 'radius.home' };

function twoRadios() {
  const sim = new NetBuilder()
    .switch('ap', { label: 'AP', icon: 'wifi', x: 100, y: 100, wifi: { ...REAL } })
    .hub('twin', { label: 'Twin', icon: 'wifi', x: 400, y: 100, wifi: { ...REAL, bssid: '02:00:00:00:00:02', security: 'open', auth: 'psk', users: undefined, server: undefined, boost: 50, off: true } })
    .host('staff', { label: 'Staff', icon: 'phone', x: 380, y: 100, ip: '10.0.0.2/24', mac: '0a:00:00:00:00:02', wifiClient: { ssid: 'Home', user: 'amy', profile: { ...PROFILE } } })
    .host('guest', { label: 'Guest', icon: 'phone', x: 380, y: 120, ip: '10.0.0.3/24', mac: '0a:00:00:00:00:03', wifiClient: { ssid: 'Home', user: 'amy' } })
    .build();
  sim.recomputeWifi();
  sim.configureWids('ap', { approved: [{ ssid: 'Home', bssid: REAL.bssid, channel: 6, where: 'hall' }], usualCrowd: 10 });
  return sim;
}

describe('saved Wi-Fi profiles', () => {
  it('match on security, sign-in, and the EAP server', () => {
    expect(matchesProfile(REAL, PROFILE)).toBe(true);
    expect(matchesProfile({ ...REAL, security: 'open', auth: 'psk' }, PROFILE)).toBe(false);
    expect(matchesProfile({ ...REAL, server: 'radius.evil' }, PROFILE)).toBe(false);
    expect(clientPasses({ ...REAL, security: 'open', auth: 'psk' }, { mac: '0a:00:00:00:00:02', profile: PROFILE }).reason).toBe('profile');
  });

  it('keep a device off a louder open copy with the exact name; a device with no profile joins it', () => {
    const sim = twoRadios();
    expect(sim.dev('staff').wifiClient!.joinedAp).toBe('ap');
    expect(sim.dev('guest').wifiClient!.joinedAp).toBe('ap');
    sim.setWifiOff('twin', false);
    expect(sim.dev('staff').wifiClient!.joinedAp).toBe('ap');
    expect(sim.dev('guest').wifiClient!.joinedAp).toBe('twin');
    // The copy never heard a try from the staff phone, so it logged no denial.
    expect(sim.dev('twin').logs.some((e) => e.msg.includes('denied'))).toBe(false);
  });
});

describe('wireless watch', () => {
  it('spots lookalike names but not the real one or unrelated ones', () => {
    expect(looksLike('Shelter_WiFi', 'Shelter-WiFi')).toBe(true);
    expect(looksLike('Shelter-WiFl', 'Shelter-WiFi')).toBe(true);
    expect(looksLike('5helter-WiFi', 'Shelter-WiFi')).toBe(true);
    expect(looksLike('Shelter-WiFi', 'Shelter-WiFi')).toBe(false);
    expect(looksLike('Corner-Cafe', 'Shelter-WiFi')).toBe(false);
  });

  it('logs a new network, a device straying to it, and the noise', () => {
    const sim = twoRadios();
    sim.setWifiOff('twin', false);
    const msgs = sim.dev('ap').logs.filter((e) => e.source === 'wids').map((e) => e.msg);
    expect(msgs.some((m) => m.startsWith('new network heard: "Home" 02:00:00:00:00:02'))).toBe(true);
    expect(msgs.some((m) => m.includes('Guest') && m.includes('not on the approved list'))).toBe(true);
    expect(msgs.some((m) => m.includes('Staff') && m.includes('not on the approved list'))).toBe(false);

    sim.jam = { on: true, channel: 6 };
    sim.recomputeWifi();
    const noise = sim.dev('ap').logs.at(-1)!;
    expect(noise.fields?.noise).toBe(88);
    expect(noise.fields?.devices).toBe(0);
    sim.jam = { on: false, channel: 0 };
    sim.setWifiCrowd('ap', 130);
    expect(sim.channelNoise(6)).toBe(noiseLevel({ jammed: false, crowd: 130, usualCrowd: 10 }));
    expect(sim.dev('ap').logs.at(-1)!.fields?.devices).toBeGreaterThan(100);
  });

  it('replays a record through the rules and scores it', () => {
    const record: AirRecord[] = [
      { day: 1, time: '10:00', kind: 'ap', ssid: 'Home', bssid: REAL.bssid, channel: 6, what: 'home', attack: false },
      { day: 2, time: '10:00', kind: 'ap', ssid: 'H0me', bssid: '02:00:00:00:00:09', channel: 6, what: 'twin', attack: true },
      { day: 3, time: '10:00', kind: 'noise', channel: 6, level: 15, what: 'crowd', attack: false },
      { day: 4, time: '10:00', kind: 'noise', channel: 6, level: 90, what: 'jammer', attack: true },
      { day: 5, time: '10:00', kind: 'port-mac', port: 'port 3', mac: '0a:00:00:00:00:44', what: 'printer', attack: false },
    ];
    const w = newWidsState({ approved: [{ ssid: 'Home', bssid: REAL.bssid, channel: 6, where: 'hall' }], record });
    expect(replayRecord(w, 0).missed).toEqual(['twin', 'jammer']);
    w.rules.lookalike = true;
    w.rules.noise = true;
    w.noiseThreshold = 10;
    let run = replayRecord(w, 0);
    expect(run.missed).toEqual([]);
    expect(run.falseAlarms).toEqual(['crowd']);
    w.noiseThreshold = 40;
    run = replayRecord(w, 0);
    expect(run.falseAlarms).toEqual([]);
    w.rules['new-mac'] = true;
    expect(replayRecord(w, 0).falseAlarms).toEqual(['printer']);
    expect(alertsFor(w, record[0])).toEqual([]);
  });

  it('cites log lines and takes citations back', () => {
    const sim = twoRadios();
    const line = sim.dev('ap').logs[0];
    sim.citeLog('ap', line.no, true);
    sim.citeLog('ap', line.no, true);
    expect(sim.logCites).toHaveLength(1);
    sim.citeLog('ap', line.no, false);
    expect(sim.logCites).toHaveLength(0);
  });
});
