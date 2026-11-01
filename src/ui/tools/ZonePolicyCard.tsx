import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/** Zone policy (segmentation): the table lives in the firewall's inspector. This card says so. */
export function ZonePolicyCard({ session, spec, onSelect }: ToolCardProps<'zone-policy'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="shield" /> Zone policy ({d.label})
      </div>
      <p class="tool-desc">
        Choose which zone may start connections to which, and for what. Change it in {d.label}'s inspector, under <strong>Zone policy</strong>.
      </p>
      <button class="btn" onClick={() => onSelect(d.id)}>
        <Icon name="sliders" /> Open {d.label}
      </button>
    </div>
  );
}
