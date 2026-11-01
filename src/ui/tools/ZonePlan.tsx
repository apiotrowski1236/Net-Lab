import { useState } from 'preact/hooks';
import { LEVEL_NAME, ZONE_LEVELS, type ZoneLevel } from '../../sim/zones';
import { Icon } from '../icons';
import { ToolMsg, type Msg } from './parts';
import type { ToolCardProps } from './registry';

/**
 * Zone plan (segmentation): put each listed device in a zone, and give each
 * zone a security level. Changes apply right away. The plan lives in the sim
 * (Device.zone, Sim.zoneLevels), so it replays and the map can draw it.
 */
export function ZonePlan({ session, spec }: ToolCardProps<'zone-plan'>) {
  void session.simRev.value;
  const sim = session.sim;
  const [msg, setMsg] = useState<Msg>(null);
  const zoneName = (id: string) => spec.zones.find((z) => z.id === id)?.label ?? id;
  const setZone = (device: string, zone: string) => {
    const label = sim.devices[device].label;
    session.dispatch({ type: 'set-zone', device, zone: zone || null });
    if (!zone) return setMsg({ tone: 'info', text: `Cleared. ${label} isn't in a zone.` });
    const fit = spec.fit?.[device];
    setMsg(
      !fit || fit.zone === zone
        ? { tone: 'good', text: `Saved. ${label} is in ${zoneName(zone)}.` }
        : { tone: 'info', text: `Saved. ${label} ${fit.job}. It fits better in ${zoneName(fit.zone)}.` },
    );
  };
  const setLevel = (zone: string, raw: string) => {
    const level = (raw || null) as ZoneLevel | null;
    session.dispatch({ type: 'set-zone-level', zone, level });
    if (!level) return setMsg({ tone: 'info', text: `Cleared. ${zoneName(zone)} has no level.` });
    const note = spec.levelNotes?.[zone]?.[level];
    setMsg(note ? { tone: 'info', text: `Saved. ${note}` } : { tone: 'good', text: `Saved. ${zoneName(zone)} is ${LEVEL_NAME[level]}.` });
  };
  return (
    <div class="tool-card defend zone-plan">
      <div class="tool-title">
        <Icon name="flag" /> Zone plan
      </div>
      <p class="tool-desc">Put each computer in a zone, then give each zone a security level. The map draws each zone as you go.</p>
      <table class="table">
        <thead>
          <tr>
            <th>Computer</th>
            <th>Zone</th>
          </tr>
        </thead>
        <tbody>
          {spec.devices.map((id) => (
            <tr key={id}>
              <td>{sim.devices[id].label}</td>
              <td>
                <select value={sim.devices[id].zone ?? ''} aria-label={`Zone for ${sim.devices[id].label}`} onChange={(e) => setZone(id, (e.target as HTMLSelectElement).value)}>
                  <option value="">Choose a zone</option>
                  {spec.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table class="table">
        <thead>
          <tr>
            <th>Zone</th>
            <th>Security level</th>
          </tr>
        </thead>
        <tbody>
          {spec.zones.map((z) => (
            <tr key={z.id}>
              <td>{z.label}</td>
              <td>
                <select value={sim.zoneLevels[z.id] ?? ''} aria-label={`Security level for ${z.label}`} onChange={(e) => setLevel(z.id, (e.target as HTMLSelectElement).value)}>
                  <option value="">Choose a level</option>
                  {ZONE_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_NAME[l]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ToolMsg msg={msg} />
    </div>
  );
}
