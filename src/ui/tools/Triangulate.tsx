import { useState } from 'preact/hooks';
import { distance, triangulate } from '../../sim/wifi';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/**
 * Signal triangulation: measure one network's signal from three set spots, then
 * solve for where the radio sits. Used to pin down a rogue box or an evil twin
 * that a scan found but can't place. See triangulate() in src/sim/wifi.ts.
 */
export function Triangulate({ session, spec, onSelect }: ToolCardProps<'triangulate'>) {
  void session.simRev.value;
  const sim = session.sim;
  const scanner = sim.dev(spec.scanner);
  const heard = sim.wifiScanRows(scanner, scanner.wifiClient?.antennaBoost ?? 0);
  const [target, setTarget] = useState('');

  const measure = (x: number, y: number) => {
    if (target) session.dispatch({ type: 'wifi-measure', device: spec.scanner, bssid: target, x, y });
  };

  const readings = sim.wifiReadings.filter((r) => r.bssid === target);
  const measured = (x: number, y: number) => readings.some((r) => r.x === x && r.y === y);
  const loc = target ? triangulate(readings) : null;
  const near = loc
    ? Object.values(sim.devices).reduce<{ id: string; d: number } | null>((best, d) => {
        const dist = distance(d, loc);
        return !best || dist < best.d ? { id: d.id, d: dist } : best;
      }, null)
    : null;

  return (
    <div class="tool-card">
      <div class="tool-title">
        <Icon name="target" /> Signal triangulation
      </div>
      <p class="tool-desc">Pick a network, then measure it from three spots. Three distances pin down where the radio is.</p>

      <label class="small">Network to find</label>
      <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
        <option value="">Choose a network...</option>
        {heard.map((r) => (
          <option key={r.bssid} value={r.bssid}>
            {`${r.ssid || '(hidden)'} (${r.bssid})`}
          </option>
        ))}
      </select>

      {target && (
        <div class="triangulate-spots">
          {spec.spots.map((s) => (
            <button key={s.label} class={`btn tiny ${measured(s.x, s.y) ? 'on' : ''}`} onClick={() => measure(s.x, s.y)}>
              {measured(s.x, s.y) ? '✓ ' : ''}
              Measure from {s.label}
            </button>
          ))}
          <p class="small muted">{readings.length} of 3 readings taken.</p>
        </div>
      )}

      {loc && near && (
        <p class="tool-msg good" role="status">
          <Icon name="check" size={14} /> Located near{' '}
          <button class="linklike" onClick={() => onSelect(near.id)}>
            {sim.dev(near.id).label}
          </button>{' '}
          at ({Math.round(loc.x)}, {Math.round(loc.y)}). Find that spot on the map.
        </p>
      )}
    </div>
  );
}
