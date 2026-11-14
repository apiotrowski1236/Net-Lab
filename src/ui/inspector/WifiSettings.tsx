import { checkWifiPassphrase } from '../../runtime/toolInput';
import { passphraseStrength, SECURITY_LABEL, type WifiSecurity } from '../../sim/wifi';
import type { InspectorSection, InspectorSectionProps } from './registry';
import { Toggle, ToolMsg, useDraft, type Msg } from '../tools/parts';
import { useState } from 'preact/hooks';
import { basicWifi } from './WifiSetup';

const MODES: WifiSecurity[] = ['open', 'wep', 'wpa', 'wpa2', 'wpa3'];
const POWERS: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
const POWER_LABEL: Record<1 | 2 | 3 | 4, string> = { 1: 'Lowest', 2: 'Low', 3: 'High', 4: 'Highest' };

/**
 * The access point's Wi-Fi settings: security, passphrase, who may join,
 * signal strength, and beacons. Shows for any device with `dev.wifi`. Editing
 * needs the `wifi-config` tool. See src/sim/wifi.ts for the model.
 */
function WifiSettingsSection({ session, sim, dev, replaying, has }: InspectorSectionProps) {
  const ap = dev.wifi;
  const pass = useDraft(ap?.passphrase ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  // A home router's basic setup page shows instead (WifiSetup.tsx).
  if (!ap || basicWifi(session, dev.id)) return null;
  const edit = has('wifi-config') && !replaying;

  const savePass = () => {
    const r = checkWifiPassphrase(sim, dev.id, pass.value);
    if (!r.ok) {
      setMsg({ tone: 'bad', text: r.msg });
      return;
    }
    session.dispatch({ type: 'wifi-passphrase', device: dev.id, passphrase: r.passphrase });
    setMsg(r.note ? { tone: 'info', text: r.note } : { tone: 'good', text: 'Passphrase saved.' });
    pass.clear();
  };

  // Who the MAC filter should let in: the shelter's own wireless devices.
  const allow = Object.values(sim.devices)
    .filter((d) => d.wifiClient && !d.attacker && d.wifiClient.ssid === ap.ssid)
    .map((d) => d.ifaces[0].mac);

  const strength = passphraseStrength(ap.passphrase);
  const needsKey = ap.security !== 'open' && ap.auth === 'psk';

  return (
    <section class="wifi-settings">
      <h4>
        Wi-Fi settings <span class="muted">this access point's radio and security</span>
      </h4>
      <table class="table kv">
        <tbody>
          <tr>
            <th>Network name (SSID)</th>
            <td class="mono">{ap.ssid}</td>
          </tr>
          <tr>
            <th>Radio address (BSSID)</th>
            <td class="mono">{ap.bssid}</td>
          </tr>
          <tr>
            <th>Channel</th>
            <td>{ap.channel}</td>
          </tr>
        </tbody>
      </table>

      <div class="wifi-field">
        <label>Security</label>
        <div class="seg">
          {MODES.map((m) => (
            <button
              key={m}
              class={`btn tiny ${ap.security === m ? 'on' : ''}`}
              disabled={!edit}
              onClick={() => session.dispatch({ type: 'wifi-security', device: dev.id, security: m })}
            >
              {SECURITY_LABEL[m].replace(' (no encryption)', '')}
            </button>
          ))}
        </div>
        <p class="small muted">
          {ap.security === 'open'
            ? 'Open: no encryption. Anyone in range reads every family’s traffic.'
            : ap.security === 'wep'
              ? 'WEP is broken. It falls in under a minute.'
              : ap.security === 'wpa'
                ? 'The original WPA is broken too.'
                : ap.security === 'wpa2'
                  ? `WPA2 holds with a long passphrase${needsKey && strength !== 'strong' ? ' (yours is short)' : ''}.`
                  : ap.auth === 'eap'
                    ? 'WPA3 is the strongest. Each person signs in with their own login.'
                    : 'WPA3 is the strongest. It resists guessing even with a short passphrase.'}
        </p>
      </div>

      {needsKey && (
        <div class="wifi-field">
          <label>Passphrase</label>
          <div class="tool-row">
            <input
              class="mono"
              value={pass.value}
              disabled={!edit}
              onInput={(e) => pass.set((e.target as HTMLInputElement).value)}
              placeholder="the key families type to join"
            />
            <button class="btn tiny" disabled={!edit || !pass.edited} onClick={savePass}>
              Save
            </button>
          </div>
          <p class="small muted">
            {ap.passphrase ? `${ap.passphrase.length} characters, ${strength}.` : 'No passphrase set.'}
          </p>
          <ToolMsg msg={msg} />
        </div>
      )}

      <div class="wifi-field">
        <label>Who may join</label>
        <div class="seg">
          <button class={`btn tiny ${ap.auth === 'psk' ? 'on' : ''}`} disabled={!edit} onClick={() => session.dispatch({ type: 'wifi-auth', device: dev.id, auth: 'psk' })}>
            Shared passphrase
          </button>
          <button class={`btn tiny ${ap.auth === 'eap' ? 'on' : ''}`} disabled={!edit} onClick={() => session.dispatch({ type: 'wifi-auth', device: dev.id, auth: 'eap' })}>
            Per-user login (EAP)
          </button>
        </div>
        <p class="small muted">
          {ap.auth === 'eap'
            ? 'Each family signs in to an authentication server with its own login. A copied MAC address is not enough.'
            : 'Everyone shares one passphrase. Anyone who has it (or copies an allowed MAC) can join.'}
        </p>
      </div>

      <div class="wifi-field">
        <Toggle
          on={!!ap.macFilter?.on}
          label={ap.macFilter?.on ? `MAC filter on (${ap.macFilter.allow.length} devices allowed)` : 'MAC filter off'}
          onChange={(on) => edit && session.dispatch({ type: 'wifi-macfilter', device: dev.id, on, allow })}
        />
        <p class="small muted">Only listed devices may join. Helps, but an attacker can read an allowed address from the air and copy it.</p>
      </div>

      <div class="wifi-field">
        <Toggle on={ap.wps} label={ap.wps ? 'WPS on (a PIN button)' : 'WPS off'} onChange={(on) => edit && session.dispatch({ type: 'wifi-wps', device: dev.id, on })} />
        <p class="small muted">
          {ap.auth === 'eap'
            ? 'Wi-Fi Protected Setup hands a device the shared passphrase after a short PIN. Per-person logins have no shared passphrase, so WPS has nothing to offer here. Keep it off.'
            : 'Wi-Fi Protected Setup lets a device join with a short PIN. The PIN can be guessed, so it undoes a strong passphrase.'}
        </p>
      </div>

      <div class="wifi-field">
        <Toggle on={ap.beacon} label={ap.beacon ? 'Broadcasting the name' : 'Name hidden'} onChange={(on) => edit && session.dispatch({ type: 'wifi-beacon', device: dev.id, on })} />
        <p class="small muted">A beacon announces the SSID to anyone nearby. Hiding it stops casual scans only; a patient scanner still finds it.</p>
      </div>

      <div class="wifi-field">
        <label>Signal strength</label>
        <div class="seg">
          {POWERS.map((pw) => (
            <button key={pw} class={`btn tiny ${ap.power === pw ? 'on' : ''}`} disabled={!edit} onClick={() => session.dispatch({ type: 'wifi-power', device: dev.id, power: pw })}>
              {POWER_LABEL[pw]}
            </button>
          ))}
        </div>
        <p class="small muted">Higher reaches farther, even outside the walls. The dashed circle on the map is how far this signal carries.</p>
      </div>
    </section>
  );
}

export const wifiSettingsSection: InspectorSection = { id: 'wifi-settings', slot: 'settings', Section: WifiSettingsSection };
