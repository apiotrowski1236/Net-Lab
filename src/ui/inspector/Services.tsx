import { appName, listening, portInfo } from '../../sim/services';
import type { InspectorSectionProps } from './registry';

/**
 * A host's open ports: the programs that answer on each one. Shown for hosts
 * whose lab gave them a `services` list (even an empty one), so labs without
 * services look the same as before.
 */
export function ServicesSection({ dev }: InspectorSectionProps) {
  if (dev.kind !== 'host' || dev.services === undefined) return null;
  const list = listening(dev);
  return (
    <section>
      <h4>
        Open ports <span class="muted">programs waiting for connections</span>
      </h4>
      {list.length === 0 ? (
        <p class="muted small">None. Nothing on this computer answers connections from the network.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Port</th>
              <th>Program</th>
              <th>What it's for</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={`${s.proto}/${s.port}`}>
                <td class="mono">
                  {s.port}
                  <span class="muted"> {s.proto.toUpperCase()}</span>
                </td>
                {s.program ? (
                  // A lab that names the program (net-tools): its banner is the version nmap -sV reports.
                  <>
                    <td class="mono small">{s.banner ?? s.program}</td>
                    <td class="small">
                      {appName(s.app)}
                      {portInfo(s.port, s.proto)?.app === s.app ? `: ${portInfo(s.port, s.proto)?.what}` : ''}
                    </td>
                  </>
                ) : (
                  <>
                    <td>{appName(s.app)}</td>
                    <td class="small">{s.banner ?? (portInfo(s.port, s.proto)?.app === s.app ? portInfo(s.port, s.proto)?.what : '')}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
