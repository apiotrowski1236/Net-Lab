import type { InspectorSectionProps } from './registry';

/**
 * A switch's mirror port (capture-analysis; see Device.mirror): which port
 * gets a copy of every frame, and what is plugged into it. Read only.
 */
export function MirrorPortSection({ sim, dev }: InspectorSectionProps) {
  if (dev.kind !== 'switch' || !dev.mirror) return null;
  const iface = dev.ifaces.find((i) => i.id === dev.mirror);
  const link = iface?.linkId ? sim.links[iface.linkId] : undefined;
  const far = link ? (link.a.device === dev.id ? link.b.device : link.a.device) : undefined;
  const who = far ? sim.devices[far]?.label : undefined;
  return (
    <section class="mirror-port">
      <h4>
        Mirror port <span class="muted">a copy of everything</span>
      </h4>
      <p>
        Port <strong class="mono">{dev.mirror}</strong> is the <strong>mirror port</strong>
        {who ? (
          <>
            , cabled to <strong>{who}</strong>
          </>
        ) : (
          ' (nothing plugged in)'
        )}
        . The switch sends a copy of every frame it receives out this port, so a computer here can capture the traffic of every device on the switch.
      </p>
    </section>
  );
}
