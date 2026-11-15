import { MeterList, meteredLinks } from '../inspector/TrafficMeter';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/** Traffic meter (smurf): the same live meter as the router's inspector, so a student can watch it while pressing lesson buttons. */
export function TrafficMeterCard({ session, spec, onSelect }: ToolCardProps<'traffic-meter'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  const links = meteredLinks(session.sim, d);
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="arrows" /> Traffic meter ({d.label})
      </div>
      <p class="tool-desc">Packets per second on each of {d.label}'s limited links, against what the link can carry.</p>
      <MeterList links={links} />
      <button class="btn" onClick={() => onSelect(d.id)}>
        <Icon name="sliders" /> Open {d.label}
      </button>
    </div>
  );
}

/** Directed broadcasts (smurf): the switch lives in the router's inspector. This card says so and shows where it stands. */
export function DirectedBroadcastCard({ session, spec, onSelect }: ToolCardProps<'directed-broadcast'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  const on = !!d.directedBroadcast;
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="shield" /> Directed broadcasts ({d.label})
      </div>
      <p class="tool-desc">
        Turn this setting off in {d.label}'s inspector, under <strong>Directed broadcasts</strong>.
      </p>
      <div class="tool-row">
        <span class={`pill ${on ? 'warn' : 'good'}`}>{on ? 'On: forwarding' : 'Off'}</span>
        <button class="btn" onClick={() => onSelect(d.id)}>
          <Icon name="sliders" /> Open {d.label}
        </button>
      </div>
    </div>
  );
}
