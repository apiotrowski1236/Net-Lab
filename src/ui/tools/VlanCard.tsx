import { DEFAULT_VLAN, vlansInUse } from '../../sim/vlan';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/** VLANs (segmentation): the settings live in the switch's inspector. This card says so and lists the VLANs in use. */
export function VlanCard({ session, spec, onSelect }: ToolCardProps<'vlan'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  const name = new Map((spec.vlans ?? []).map((v) => [v.id, v.name]));
  const used = vlansInUse(d).filter((v) => v !== DEFAULT_VLAN);
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="list" /> VLANs ({d.label})
      </div>
      <p class="tool-desc">
        Put each switch port in a VLAN. Ports in different VLANs can't hear each other. Change it in {d.label}'s inspector, under <strong>VLANs</strong>.
      </p>
      <button class="btn" onClick={() => onSelect(d.id)}>
        <Icon name="sliders" /> Open {d.label}
      </button>
      {used.length > 0 && (
        <p class="small muted">
          In use: {used.map((v) => (name.has(v) ? `${v} ${name.get(v)}` : String(v))).join(', ')}
        </p>
      )}
    </div>
  );
}
