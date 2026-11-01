import { MODE_NAME } from '../../sim/firewall';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/** Lists the firewalls the student may edit. The rules themselves are in the inspector. */
export function FirewallRulesTool({ session, spec, onSelect }: ToolCardProps<'firewall-rules'>) {
  void session.simRev.value;
  const sim = session.sim;
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="shield" /> Firewall rules
      </div>
      <p class="tool-desc">
        Each firewall checks its rules from the top. The first rule that matches a packet decides. If none match, the <strong>implicit deny</strong> at
        the bottom blocks it.
      </p>
      {spec.devices.map((id) => {
        const d = sim.devices[id];
        const fw = d?.firewall;
        if (!fw) return null;
        const n = fw.rules.length;
        const placed = d.kind !== 'firewall' || d.ifaces.some((i) => i.linkId);
        return (
          <div key={id} class="tool-row">
            <span>
              <strong>{d.label}</strong> <span class="pill tiny info">{MODE_NAME[fw.mode]}</span>{' '}
              <span class="muted small">
                {n === 1 ? '1 rule' : `${n} rules`} + implicit deny{placed ? '' : ', not placed yet'}
              </span>
            </span>
            <button class="btn tiny" onClick={() => onSelect(id)}>
              Edit rules
            </button>
          </div>
        );
      })}
    </div>
  );
}
