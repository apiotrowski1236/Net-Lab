import type { Mac } from './addr';

/**
 * Wi-Fi radio model for the `wireless` lab.
 *
 * It is deliberately simple, so a ninth grader can reason about it and so
 * replay stays deterministic. The lesson says where it simplifies.
 *
 *  - Range is distance on the map. A device associates with an access point
 *    when the signal it hears is above a threshold. Signal falls off linearly
 *    with distance (real radio is logarithmic and bounces off walls; we skip
 *    all of that). Transmit power and a directional/high-gain antenna raise it.
 *  - Security is a single mode (open/WEP/WPA/WPA2/WPA3) plus optional WPS, a
 *    MAC filter, and either a shared key (PSK) or per-user logins (EAP).
 *  - Cracking is a yes/no with a human-readable time estimate, not a real
 *    attack. WEP always falls, WPA/WPA2 fall to a weak passphrase, WPS falls
 *    to PIN guessing, and WPA3 (or WPA2 with a strong passphrase and WPS off)
 *    holds.
 *
 * Other labs (`net-audit`, `logs`) reuse `WifiAp` settings and the Wi-Fi log
 * lines (`source: 'wifi'`). Treat the exported types and the `Sim` Wi-Fi
 * methods as the public API.
 */

export type WifiSecurity = 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3';
export type WifiAuth = 'psk' | 'eap';

/** An access point's radio and security settings. Lives on `Device.wifi`. */
export interface WifiAp {
  ssid: string;
  /** The radio's MAC address, shown in a scan. Separate from the AP's wired ports. */
  bssid: Mac;
  security: WifiSecurity;
  /** The shared passphrase for WEP/WPA/WPA2/WPA3 with PSK. Ignored when `auth` is `eap`. */
  passphrase?: string;
  /** Wi-Fi Protected Setup: a short PIN that can be guessed, so it defeats a strong passphrase. */
  wps: boolean;
  /** `psk` shares one passphrase with everyone; `eap` gives each user a login checked by a server. */
  auth: WifiAuth;
  /** EAP identities the authentication server accepts (used when `auth` is `eap`). */
  users?: string[];
  /** Only listed MAC addresses may join, when `on`. Beaten by MAC spoofing. */
  macFilter?: { on: boolean; allow: Mac[] };
  /** Broadcast the SSID in beacon frames. Off only hides the name from casual scans. */
  beacon: boolean;
  /** Transmit power level 1 (lowest) to 4 (highest). Sets the reach on the map. */
  power: 1 | 2 | 3 | 4;
  /** Extra signal from a high-gain or amplified antenna (an evil twin uses this to reach inside). */
  boost?: number;
  channel: number;
  /** Powered off: not broadcasting and nothing can join. Used for the rogue AP and twin before they appear. */
  off?: boolean;
  /** Not an approved access point: a rogue box or an evil twin. Labels it in a scan. */
  rogue?: boolean;
}

/** A device that joins Wi-Fi networks. Lives on `Device.wifiClient`. */
export interface WifiClient {
  /** The network name this device tries to join. */
  ssid: string;
  /** The passphrase it holds (for a PSK network). */
  passphrase?: string;
  /** The EAP login it holds (for an EAP network), if any. */
  user?: string;
  /** A high-gain antenna: extra signal this device hears, so it can reach a faraway AP. */
  antennaBoost?: number;
  /** The AP it is currently associated with (set by the simulator; do not set by hand). */
  joinedAp?: string;
}

/** One signal reading for triangulation: a point on the map and the distance it implies. */
export interface WifiReading {
  bssid: Mac;
  x: number;
  y: number;
  /** Distance to the source implied by the measured signal. */
  dist: number;
}

// ---------------------------------------------------------------------------
// The radio model (pure functions, so the UI and goals can reuse them)
// ---------------------------------------------------------------------------

/** Signal a transmitter puts out at its own antenna, before distance, by power level. */
const TX_BY_POWER: Record<1 | 2 | 3 | 4, number> = { 1: 60, 2: 80, 3: 95, 4: 110 };
/** Signal lost per unit of map distance. */
const FALLOFF = 0.15;
/** A device associates only when the signal it hears is at least this strong (0 to 100). */
export const JOIN_THRESHOLD = 20;

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The strongest signal an AP's radio emits, including any antenna boost. */
export function txPower(ap: WifiAp): number {
  return TX_BY_POWER[ap.power] + (ap.boost ?? 0);
}

/** How far an AP reaches: the distance at which its signal drops to the join threshold. */
export function reach(ap: WifiAp): number {
  return Math.max(0, (txPower(ap) - JOIN_THRESHOLD) / FALLOFF);
}

/** Signal (0 to 100) a receiver at `point` hears from `ap` at `apPos`, with an optional receiver boost. */
export function signalAt(ap: WifiAp, apPos: { x: number; y: number }, point: { x: number; y: number }, rxBoost = 0): number {
  const raw = txPower(ap) + rxBoost - FALLOFF * distance(apPos, point);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Turn a measured signal back into a distance (the inverse of the model, for triangulation). */
export function distanceFromSignal(ap: WifiAp, signal: number): number {
  return Math.max(0, (txPower(ap) - signal) / FALLOFF);
}

/** Signal strength as bars (0 to 4), for a friendly display. */
export function bars(signal: number): number {
  if (signal <= 0) return 0;
  return Math.min(4, Math.ceil(signal / 25));
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/** A passphrase is weak if it is short enough to guess. Twelve characters is the line this lab draws. */
export const STRONG_PASSPHRASE_LEN = 12;

export function passphraseStrength(p: string | undefined): 'none' | 'weak' | 'strong' {
  if (!p) return 'none';
  return p.length >= STRONG_PASSPHRASE_LEN ? 'strong' : 'weak';
}

/** Security modes from weakest to strongest, for ranking questions and labels. */
export const SECURITY_RANK: Record<WifiSecurity, number> = { open: 0, wep: 1, wpa: 2, wpa2: 3, wpa3: 4 };

export const SECURITY_LABEL: Record<WifiSecurity, string> = {
  open: 'Open (no encryption)',
  wep: 'WEP',
  wpa: 'WPA',
  wpa2: 'WPA2',
  wpa3: 'WPA3',
};

export interface CrackResult {
  /** Whether the attacker would recover the passphrase. */
  ok: boolean;
  /** How the attacker got in (or would have tried). */
  method: 'open' | 'wep' | 'wps' | 'guess' | 'none';
  /** A human estimate of how long it takes. */
  estimate: string;
}

/**
 * Whether and how an attacker can break into an AP, with a time estimate.
 * This is the heart of the encryption step: it rewards WPA3, or WPA2 with a
 * long passphrase and WPS off.
 */
export function crack(ap: WifiAp): CrackResult {
  if (ap.security === 'open') return { ok: true, method: 'open', estimate: 'no password to break' };
  if (ap.security === 'wep') return { ok: true, method: 'wep', estimate: 'under a minute' };
  if (ap.wps) return { ok: true, method: 'wps', estimate: 'a few hours (the WPS PIN)' };
  if (ap.auth === 'eap') return { ok: false, method: 'none', estimate: 'no shared passphrase to steal' };
  const strength = passphraseStrength(ap.passphrase);
  if (ap.security === 'wpa3') return { ok: false, method: 'none', estimate: 'centuries (WPA3 resists guessing)' };
  // WPA and WPA2: a captured handshake can be guessed against, so a short passphrase falls.
  if (strength === 'weak') return { ok: true, method: 'guess', estimate: 'a few minutes (guessing common passwords)' };
  return { ok: false, method: 'none', estimate: 'centuries (too long to guess)' };
}

/** The identity a joining device presents to an AP. */
export interface JoinAttempt {
  mac: Mac;
  passphrase?: string;
  user?: string;
}

export type JoinReason = 'wrong-key' | 'no-login' | 'mac-filtered';

/** Whether `who` passes an AP's security (not counting range). */
export function clientPasses(ap: WifiAp, who: JoinAttempt): { ok: boolean; reason?: JoinReason } {
  if (ap.security !== 'open' && ap.auth === 'psk') {
    if (!who.passphrase || who.passphrase !== ap.passphrase) return { ok: false, reason: 'wrong-key' };
  }
  if (ap.auth === 'eap') {
    if (!who.user || !ap.users?.includes(who.user)) return { ok: false, reason: 'no-login' };
  }
  if (ap.macFilter?.on && !ap.macFilter.allow.includes(who.mac)) return { ok: false, reason: 'mac-filtered' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Scanning and triangulation
// ---------------------------------------------------------------------------

export interface ScanRow {
  device: string;
  ssid: string;
  bssid: Mac;
  security: WifiSecurity;
  auth: WifiAuth;
  wps: boolean;
  channel: number;
  /** Measured signal (0 to 100) from the scanner's position. */
  signal: number;
  rogue: boolean;
}

/** Solve for the point that is `dist` from each reading (trilateration). Needs 3 non-collinear readings. */
export function triangulate(readings: WifiReading[]): { x: number; y: number } | null {
  if (readings.length < 3) return null;
  const [a, b, c] = readings;
  // Subtract the first circle's equation from the others to get two lines, then solve.
  const A1 = 2 * (b.x - a.x);
  const B1 = 2 * (b.y - a.y);
  const C1 = a.dist ** 2 - b.dist ** 2 - a.x ** 2 + b.x ** 2 - a.y ** 2 + b.y ** 2;
  const A2 = 2 * (c.x - a.x);
  const B2 = 2 * (c.y - a.y);
  const C2 = a.dist ** 2 - c.dist ** 2 - a.x ** 2 + c.x ** 2 - a.y ** 2 + c.y ** 2;
  const det = A1 * B2 - A2 * B1;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (C1 * B2 - C2 * B1) / det, y: (A1 * C2 - A2 * C1) / det };
}
