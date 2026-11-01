import { useState } from 'preact/hooks';
import { crack, SECURITY_LABEL, type CrackResult } from '../../sim/wifi';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/**
 * Wi-Fi cracker (the attacker's view): list the networks the attacker can hear
 * and try to recover each key. The time estimate is the lesson: WEP and WPS
 * fall fast, a short passphrase falls to guessing, WPA3 holds. See src/sim/wifi.ts.
 */
export function WifiCracker({ session, spec }: ToolCardProps<'wifi-crack'>) {
  void session.simRev.value;
  const sim = session.sim;
  const att = sim.dev(spec.attacker);
  const rows = sim.wifiScanRows(att, att.wifiClient?.antennaBoost ?? 0);
  const [tried, setTried] = useState<Set<string>>(new Set());

  const tryCrack = (apId: string, bssid: string) => {
    session.dispatch({ type: 'wifi-crack', device: spec.attacker, ap: apId });
    setTried((t) => new Set(t).add(bssid));
  };

  return (
    <div class="tool-card attack">
      <div class="tool-title">
        <Icon name="unlock" /> Wi-Fi cracker ({att.label})
      </div>
      <p class="tool-desc">Try to break into each network {att.label} can hear from the lot. How long it takes depends on the security.</p>
      {rows.length === 0 && <p class="small muted">No networks in range. {att.label} needs a stronger antenna or to get closer.</p>}
      {rows.map((r) => {
        // Recompute against the current settings each render, so trying again
        // after the defender changes the security shows the new result.
        const res: CrackResult | null = tried.has(r.bssid) ? crack(sim.dev(r.device).wifi!) : null;
        return (
          <div key={r.bssid} class="crack-row">
            <div>
              <strong>{r.ssid || '(hidden)'}</strong> <span class="small muted">{SECURITY_LABEL[r.security].replace(' (no encryption)', '')}</span>
              <div class="mono tiny muted">{r.bssid}</div>
            </div>
            <div class="crack-result">
              {res && (
                <p class={`tool-msg ${res.ok ? 'bad' : 'good'}`} role="status">
                  <Icon name={res.ok ? 'unlock' : 'lock'} size={14} /> {res.ok ? `Broken: ${res.estimate}.` : `Held: ${res.estimate}.`}
                </p>
              )}
              <button class="btn tiny" onClick={() => tryCrack(r.device, r.bssid)}>
                {res ? 'Try again' : 'Try to crack'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
