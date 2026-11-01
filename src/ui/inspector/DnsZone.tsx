import type { InspectorSectionProps } from './registry';

/**
 * An authoritative name server's zone: the names it is the authority for and
 * the addresses it hands back. Read-only.
 */
export function DnsZone({ dev }: InspectorSectionProps) {
  const zone = dev.dnsZone;
  if (!zone || dev.resolver) return null;
  const names = Object.keys(zone);
  if (names.length === 0) return null;
  return (
    <section>
      <h4>
        Name server records <span class="muted">the names this server is the authority for</span>
      </h4>
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => (
            <tr key={name}>
              <td class="mono">{name}</td>
              <td class="mono">{zone[name]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
