import type { InspectorSectionProps } from './registry';

/**
 * Approved access points (watch-the-air): the inventory an access point with
 * a wireless watch keeps of the radios its owner put up. Read-only. Students
 * compare a scan against it. See src/sim/wids.ts.
 */
export function ApprovedAps({ session, dev }: InspectorSectionProps) {
  void session.simRev.value;
  const w = dev.wids;
  if (!w) return null;
  return (
    <section class="approved-aps">
      <h4>
        Approved access points <span class="muted">every radio the shelter put up</span>
      </h4>
      <table class="table">
        <thead>
          <tr>
            <th>Network</th>
            <th>Channel</th>
            <th>Where it hangs</th>
          </tr>
        </thead>
        <tbody>
          {w.approved.map((a) => (
            <tr key={a.bssid}>
              <td>
                {a.ssid}
                <div class="mono tiny muted">{a.bssid}</div>
              </td>
              <td class="small">{a.channel}</td>
              <td class="small">{a.where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
