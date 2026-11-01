import { portLabel } from '../../sim/switchsec';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/** Port security (mac-flood): the settings live in the switch's inspector. This card says so and lists what's set. */
export function PortSecurityCard({ session, spec, onSelect }: ToolCardProps<'port-security'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  const set = Object.entries(d.switchSec?.ports ?? {}).filter(([, p]) => p.security || p.shutdown);
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="shield" /> Port security ({d.label})
      </div>
      <p class="tool-desc">
        Limit which MAC addresses may use each port, and shut down ports nobody uses. Change it in {d.label}'s inspector, under{' '}
        <strong>Ports and port security</strong>.
      </p>
      <button class="btn" onClick={() => onSelect(d.id)}>
        <Icon name="sliders" /> Open {d.label}
      </button>
      {set.length > 0 && (
        <ul class="tool-list">
          {set.map(([id, p]) => (
            <li key={id}>
              <span>{portLabel(id)}</span>
              <span class="small">
                {p.shutdown === 'violation' ? 'shut by port security' : p.shutdown === 'admin' ? 'shut down' : 'on'}
                {p.security ? (p.security.allowed ? ', MAC filtering' : `, at most ${p.security.maxMacs} MAC${p.security.maxMacs === 1 ? '' : 's'}`) : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
