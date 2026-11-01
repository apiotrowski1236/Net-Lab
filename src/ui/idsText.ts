import { TOLERANCE_MIN, megabytes, type IdsSensor, type Judgment, type Tolerance } from '../sim/ids';
import type { Sim } from '../sim/sim';
import type { SimEvent } from '../sim/types';
import type { OutcomeLine } from './firewallText';

/** Words for the IDS sensor's settings and results (logs lab), shared by the lesson, the map, and the inspector. */

export const TOLERANCE_NAME: Record<Tolerance, string> = { loose: 'Loose', medium: 'Medium', strict: 'Strict' };

/** "Loose alerts at a deviation of 4 or more". */
export function toleranceText(t: Tolerance): string {
  return `${TOLERANCE_NAME[t]} alerts at a deviation of ${TOLERANCE_MIN[t]} or more`;
}

/** Why a connection scored its deviation: "outside office hours (03:12), new peer 45.77.12.9, 90 MB (over 10x usual)". */
export function deviationWhy(j: Judgment): string {
  const parts = [j.offHours ? `outside office hours (${j.time})` : '', j.newPeer ? `new peer ${j.peer}` : '', j.big ? `${megabytes(j.bytes)}, over 10x usual` : ''];
  return parts.filter(Boolean).join(', ') || 'nothing unusual';
}

type IdsEvent = Extract<SimEvent, { type: 'ids' }>;

/** Addresses and switch ports that belong to attacker devices: acting on these is the good outcome. */
function hostile(sim: Sim): { ips: Set<string>; ports: Set<string> } {
  const ips = new Set<string>();
  const ports = new Set<string>();
  for (const d of Object.values(sim.devices)) {
    if (!d.attacker) continue;
    for (const i of d.ifaces) {
      if (i.ip) ips.add(i.ip);
      const peer = sim.peer(d.id, i.id);
      if (peer) ports.add(`${peer.device}/${peer.iface}`);
    }
  }
  return { ips, ports };
}

/**
 * Lines for the lesson's "what happened" list after a button: each IDS alert
 * and IPS action since `since`, and, when a sensor saw the traffic but stayed
 * quiet, why.
 */
export function idsOutcomeLines(sim: Sim, since: number): OutcomeLine[] {
  const sensors = Object.values(sim.devices).filter((d) => d.ids?.sensor);
  if (!sensors.length) return [];
  const lines: OutcomeLine[] = [];
  const evs: IdsEvent[] = [];
  for (let i = sim.events.length - 1; i >= 0 && sim.events[i].t >= since; i--) {
    const e = sim.events[i];
    if (e.type === 'ids') evs.unshift(e);
  }
  const bad = hostile(sim);
  for (const d of sensors) {
    const s = d.ids!.sensor!;
    const mine = evs.filter((e) => e.device === d.id);
    const judged = s.judged.filter((j) => j.t >= since);
    for (const e of mine) {
      if (e.what === 'alert') {
        const j = e.signature === 'anomaly' ? judged.find((x) => x.alerted && e.detail.includes(x.host)) : undefined;
        const extra = j ? ` Deviation ${j.deviation}; ${toleranceText(s.tolerance)}.` : '';
        lines.push({ tone: 'bad', text: `${d.label}: ${e.detail}.${extra}` });
      } else {
        const sw = e.what === 'shut' ? Object.values(sim.devices).find((x) => x.kind === 'switch' && x.switchSec?.ports[e.target ?? '']?.shutdown) : undefined;
        const good = e.what === 'shut' ? !!sw && bad.ports.has(`${sw.id}/${e.target}`) : bad.ips.has(e.target ?? '');
        lines.push({ tone: good ? 'good' : 'bad', text: `${d.label}: ${e.detail}.` });
      }
    }
    if (mine.length || s.lastSeen === undefined || s.lastSeen < since) continue;
    lines.push(...quietLines(d.label, s, judged));
  }
  return lines;
}

/** The sensor saw traffic and raised nothing. Say why. */
function quietLines(label: string, s: IdsSensor, judged: Judgment[]): OutcomeLine[] {
  if (!s.signatures && !s.anomaly) return [{ tone: 'bad', text: `${label} saw the traffic, but its detection is off. No alert.` }];
  const out: OutcomeLine[] = [];
  if (s.signatures) out.push({ tone: 'bad', text: `${label} saw the traffic. No signature matched it, so no alert.` });
  if (s.anomaly) {
    const j = judged.at(-1);
    if (j) out.push({ tone: 'bad', text: `${label}: deviation ${j.deviation} (${deviationWhy(j)}). ${toleranceText(s.tolerance)}, so no alert.` });
  }
  return out;
}

/** A map label for an IDS event. */
export function idsMarker(e: IdsEvent): { device: string; text: string; tone: 'bad' | 'warn' } {
  if (e.what === 'alert') return { device: e.device, text: `ALERT ${e.signature}`, tone: 'bad' };
  if (e.what === 'shut') return { device: e.device, text: `IPS shut ${e.target?.replace(/^p(\d+)$/, 'port $1') ?? 'a port'}`, tone: 'warn' };
  return { device: e.device, text: `IPS blocked ${e.target ?? 'an address'}`, tone: 'warn' };
}
