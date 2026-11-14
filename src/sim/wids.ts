import type { Mac } from './addr';

/**
 * Wireless watch (built for `watch-the-air`): a small wireless intrusion
 * detection system (WIDS) that runs on an access point's radio.
 *
 * Opt in per access point with `sim.configureWids(id, { approved, record })`,
 * which gives the device a `Device.wids`. From then on:
 *
 *  - **Approved list.** `approved` is the inventory of access points the owner
 *    put up (name, radio address, channel, where it hangs). The inspector shows
 *    it. Students compare a scan against it and mark each network themselves
 *    (`sim.widsMark`); nothing here labels a network "not yours" for them.
 *  - **What the radio notices, live.** After every Wi-Fi change
 *    (`Sim.recomputeWifi`) the access point logs, with `source: 'wids'`:
 *    a network it hasn't heard before ("new network heard"), a shelter device
 *    now talking to an access point that isn't approved, and its own channel's
 *    noise level when it changes (jamming, or a crowd). A crowd is set with
 *    `sim.setWifiCrowd`; jamming with the wireless lab's `sim.setWifiJam`.
 *  - **Alarms.** Four rules (`WIDS_RULES`) and a noise threshold. The rules
 *    don't watch the live network: `sim.widsReplay` runs the radio's saved
 *    record (`record`, a list of `AirRecord`s the lab writes) through them,
 *    logs one `alert` line per alarm, and scores the run: attacks caught,
 *    attacks missed, and false alarms. That is how a defender tests alarm
 *    settings against past weeks before trusting them.
 *
 * Noise is on the same 0 to 100 scale as signal. A quiet channel reads about
 * 5. A crowd raises it a little; a jammer pins it near 90.
 */

export interface ApprovedAp {
  ssid: string;
  bssid: Mac;
  channel: number;
  /** Where it hangs, in the owner's words ("gym, center of the ceiling"). */
  where: string;
}

export type WidsRule = 'unknown-ap' | 'lookalike' | 'noise' | 'new-mac';
export const WIDS_RULES: WidsRule[] = ['unknown-ap', 'lookalike', 'noise', 'new-mac'];

/** What a student decided about one network in a scan. */
export type WidsMark = 'approved' | 'unknown';

/** One thing the radio (or the switch) recorded, for replaying through the alarms. */
export type AirRecord = { day: number; time: string; what: string; attack: boolean } & (
  | { kind: 'ap'; ssid: string; bssid: Mac; channel: number }
  | { kind: 'noise'; channel: number; level: number }
  | { kind: 'port-mac'; port: string; mac: Mac }
);

export interface WidsAlert {
  rule: WidsRule;
  record: AirRecord;
  text: string;
}

export interface WidsReplay {
  t: number;
  /** The rules and threshold this run used (settingsKey), so a goal can tell the run is current. */
  settings: string;
  alerts: WidsAlert[];
  /** `what` of each attack that raised at least one alert. */
  caught: string[];
  /** `what` of each attack that raised none. */
  missed: string[];
  /** `what` of each harmless record that raised an alert. */
  falseAlarms: string[];
}

export interface WidsState {
  approved: ApprovedAp[];
  /** Each radio address heard so far, when it was first heard (sim time), and the name it used last. Approved ones count as heard from the start. */
  heard: Record<Mac, { t: number; ssid: string }>;
  marks: Record<Mac, WidsMark>;
  rules: Record<WidsRule, boolean>;
  /** The noise alarm fires above this level (0 to 100). */
  noiseThreshold: number;
  record: AirRecord[];
  replays: WidsReplay[];
  /** Devices online right now, and on a usual evening. A crowd raises the channel's noise a little. */
  crowd: number;
  usualCrowd: number;
  /** Shelter devices seen talking to an access point that isn't approved: device MAC -> that radio's address. */
  strays: Record<Mac, Mac>;
  /** The noise level last logged for this access point's channel. */
  lastNoise?: number;
}

/** Noise on a quiet channel. */
export const QUIET_NOISE = 5;
/** Noise while a jammer blasts the channel. */
export const JAM_NOISE = 88;
/** The level a scanner or a log line calls normal. */
export const NORMAL_NOISE_MAX = 10;

export function newWidsState(o: { approved: ApprovedAp[]; record?: AirRecord[]; noiseThreshold?: number; usualCrowd?: number }): WidsState {
  return {
    approved: o.approved,
    heard: Object.fromEntries(o.approved.map((a) => [a.bssid, { t: 0, ssid: a.ssid }])),
    marks: {},
    rules: { 'unknown-ap': false, lookalike: false, noise: false, 'new-mac': false },
    noiseThreshold: o.noiseThreshold ?? 10,
    record: o.record ?? [],
    replays: [],
    crowd: o.usualCrowd ?? 0,
    usualCrowd: o.usualCrowd ?? 0,
    strays: {},
  };
}

export const isApproved = (w: WidsState, bssid: Mac): boolean => w.approved.some((a) => a.bssid === bssid);

/** Noise on a channel: quiet, a little higher with a crowd, near the top while jammed. */
export function noiseLevel(o: { jammed: boolean; crowd: number; usualCrowd: number }): number {
  if (o.jammed) return JAM_NOISE;
  return QUIET_NOISE + Math.max(0, Math.round((o.crowd - o.usualCrowd) / 10));
}

// ---------------------------------------------------------------------------
// Lookalike names
// ---------------------------------------------------------------------------

/** A name with case, spaces, and punctuation stripped, and digits that pass for letters swapped back. */
export function plainName(s: string): string {
  return s
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/5/g, 's')
    .replace(/[^a-z0-9]/g, '');
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/**
 * Whether `name` looks like `real` without being it: the same once case,
 * spaces, and punctuation are ignored ("Shelter_WiFi" and "Shelter-WiFi"), or
 * one or two letters off ("Shelter-WiFl", "Shelter-WiFi2").
 */
export function looksLike(name: string, real: string): boolean {
  if (name === real) return false;
  const a = plainName(name);
  const b = plainName(real);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 2);
}

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

/** The alarm settings as a short key: which rules are on, and the threshold. */
export function settingsKey(w: WidsState): string {
  return `${WIDS_RULES.filter((r) => w.rules[r]).join('+')}@${w.noiseThreshold}`;
}

/** The alerts one record raises under the current settings. */
export function alertsFor(w: WidsState, r: AirRecord): WidsAlert[] {
  const out: WidsAlert[] = [];
  const when = `[record: day ${r.day}, ${r.time}]`;
  if (r.kind === 'ap') {
    const known = isApproved(w, r.bssid);
    if (w.rules['unknown-ap'] && !known) {
      out.push({ rule: 'unknown-ap', record: r, text: `${when} access point not on the approved list: "${r.ssid}" ${r.bssid}, channel ${r.channel}` });
    }
    const copied = w.approved.find((a) => (a.ssid === r.ssid && !known) || looksLike(r.ssid, a.ssid));
    if (w.rules.lookalike && copied) {
      const how = copied.ssid === r.ssid ? 'uses the same name as' : 'looks like';
      out.push({ rule: 'lookalike', record: r, text: `${when} network "${r.ssid}" ${r.bssid} ${how} approved network "${copied.ssid}"` });
    }
  } else if (r.kind === 'noise') {
    if (w.rules.noise && r.level > w.noiseThreshold) {
      out.push({ rule: 'noise', record: r, text: `${when} noise on channel ${r.channel} is ${r.level}, above the alarm level of ${w.noiseThreshold}` });
    }
  } else if (w.rules['new-mac']) {
    out.push({ rule: 'new-mac', record: r, text: `${when} new device ${r.mac} on switch ${r.port}` });
  }
  return out;
}

/** Run the whole record through the alarms and score the run. */
export function replayRecord(w: WidsState, t: number): WidsReplay {
  const alerts: WidsAlert[] = [];
  const caught: string[] = [];
  const missed: string[] = [];
  const falseAlarms: string[] = [];
  for (const r of w.record) {
    const hits = alertsFor(w, r);
    alerts.push(...hits);
    const list = r.attack ? (hits.length ? caught : missed) : hits.length ? falseAlarms : null;
    if (list && !list.includes(r.what)) list.push(r.what);
  }
  // An attack with several records counts as caught if any one of them raised an alert.
  const missedReally = missed.filter((m) => !caught.includes(m));
  return { t, settings: settingsKey(w), alerts, caught, missed: missedReally, falseAlarms };
}

/** Plain names for the rules, for the card and the log. */
export const RULE_TEXT: Record<WidsRule, string> = {
  'unknown-ap': 'An access point that is not on the approved list',
  lookalike: 'A network name that copies or looks like an approved one',
  noise: 'Noise on a channel above the alarm level',
  'new-mac': 'A new device on a switch port',
};
