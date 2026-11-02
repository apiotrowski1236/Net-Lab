import { useState } from 'preact/hooks';
import type { LabSession } from '../../runtime/session';
import { checkWifiPassword, checkWifiSsid, checkWifiTurnOn } from '../../runtime/toolInput';
import { passphraseStrength, type WifiSecurity } from '../../sim/wifi';
import type { InspectorSection, InspectorSectionProps } from './registry';
import { Toggle, ToolMsg, useDraft, type Msg } from '../tools/parts';

/**
 * A home router's Wi-Fi setup page (home-network): the network's name, WPA2
 * or WPA3, a password, and on or off. Shows instead of the full Wi-Fi settings
 * (WifiSettings.tsx) when the lab's `wifi-config` tool for this access point
 * has `basic`. Editing needs that tool; otherwise it reads as a summary.
 */
export function basicWifi(session: LabSession, devId: string): boolean {
  return session.lab.steps.some((s) => s.tools?.some((t) => t.kind === 'wifi-config' && t.device === devId && t.basic));
}

const MODES: { id: WifiSecurity; label: string; note: string }[] = [
  { id: 'wpa2', label: 'WPA2', note: 'WPA2 checks the password and scrambles everything sent over the air.' },
  { id: 'wpa3', label: 'WPA3', note: 'WPA3 is newer and harder to break. It checks the password and scrambles everything sent over the air.' },
];

function WifiSetupSection({ session, sim, dev, replaying, has }: InspectorSectionProps) {
  const ap = dev.wifi;
  const name = useDraft(ap?.ssid ?? '');
  const pass = useDraft(ap?.passphrase ?? '');
  const [msg, setMsg] = useState<{ field: 'name' | 'pass' | 'power'; msg: Msg } | null>(null);
  if (!ap || !basicWifi(session, dev.id)) return null;
  const edit = has('wifi-config') && !replaying;
  const joined = Object.values(sim.devices).filter((d) => d.wifiClient?.joinedAp === dev.id);
  const say = (field: 'name' | 'pass' | 'power', m: Msg) => setMsg({ field, msg: m });

  const saveName = () => {
    const r = checkWifiSsid(sim, dev.id, name.value);
    if (!r.ok) return say('name', { tone: 'bad', text: r.msg });
    session.dispatch({ type: 'wifi-ssid', device: dev.id, ssid: r.ssid });
    say('name', { tone: 'good', text: joined.length ? 'Saved. Devices that knew the old name drop off until they join the new one.' : 'Saved.' });
    name.clear();
  };
  const savePass = () => {
    const r = checkWifiPassword(sim, dev.id, pass.value);
    if (!r.ok) return say('pass', { tone: 'bad', text: r.msg });
    session.dispatch({ type: 'wifi-passphrase', device: dev.id, passphrase: r.passphrase });
    say('pass', r.note ? { tone: 'info', text: r.note } : { tone: 'good', text: 'Saved.' });
    pass.clear();
  };
  const power = (on: boolean) => {
    if (on) {
      const r = checkWifiTurnOn(sim, dev.id);
      if (!r.ok) return say('power', { tone: 'bad', text: r.msg });
    }
    session.dispatch({ type: 'wifi-off', device: dev.id, off: !on });
    say('power', null);
  };
  const mode = MODES.find((m) => m.id === ap.security);
  const strength = passphraseStrength(ap.passphrase);
  const status = ap.off
    ? 'Nothing can join while the Wi-Fi is off.'
    : joined.length
      ? `Joined: ${joined.map((d) => d.label).join(', ')}.`
      : 'On. No devices have joined yet.';
  const head = (
    <h4>
      Wi-Fi setup <span class="muted">the home's wireless network</span>
    </h4>
  );

  // Without the tool, a short summary, so the sections below stay in view.
  if (!edit) {
    return (
      <section class="wifi-settings wifi-setup">
        {head}
        <table class="table kv">
          <tbody>
            <tr>
              <th>Network name (SSID)</th>
              <td class="mono">{ap.ssid}</td>
            </tr>
            <tr>
              <th>Security</th>
              <td>{mode?.label ?? ap.security.toUpperCase()}</td>
            </tr>
            <tr>
              <th>Password</th>
              <td>{ap.passphrase ? `Saved, ${ap.passphrase.length} characters` : 'None'}</td>
            </tr>
            <tr>
              <th>Wi-Fi</th>
              <td>
                <span class={`pill ${ap.off ? '' : 'good'}`}>{ap.off ? 'Off' : 'On'}</span> {ap.off ? '' : status}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section class="wifi-settings wifi-setup">
      {head}

      <div class="wifi-field">
        <label for={`ssid-${dev.id}`}>Network name (SSID)</label>
        <div class="tool-row">
          <input
            id={`ssid-${dev.id}`}
            value={name.value}
            maxLength={40}
            onInput={(e) => name.set((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && name.edited && saveName()}
          />
          <button class="btn tiny" disabled={!name.edited} onClick={saveName}>
            Save
          </button>
        </div>
        {msg?.field === 'name' && <ToolMsg msg={msg.msg} />}
      </div>

      <div class="wifi-field">
        <label>Security</label>
        <div class="seg">
          {MODES.map((m) => (
            <button
              key={m.id}
              class={`btn tiny ${ap.security === m.id ? 'on' : ''}`}
              onClick={() => ap.security !== m.id && session.dispatch({ type: 'wifi-security', device: dev.id, security: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode && <p class="small muted">{mode.note}</p>}
      </div>

      <div class="wifi-field">
        <label for={`pass-${dev.id}`}>Password</label>
        <div class="tool-row">
          <input
            id={`pass-${dev.id}`}
            class="mono"
            value={pass.value}
            placeholder="at least 8 characters"
            onInput={(e) => pass.set((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && pass.edited && savePass()}
          />
          <button class="btn tiny" disabled={!pass.edited} onClick={savePass}>
            Save
          </button>
        </div>
        <p class="small muted">{ap.passphrase ? `${ap.passphrase.length} characters${strength === 'weak' ? ', short' : ''}.` : 'No password saved yet.'}</p>
        {msg?.field === 'pass' && <ToolMsg msg={msg.msg} />}
      </div>

      <div class="wifi-field">
        <Toggle on={!ap.off} label={ap.off ? 'Wi-Fi off' : 'Wi-Fi on'} onChange={power} />
        {msg?.field === 'power' && <ToolMsg msg={msg.msg} />}
        <p class="small muted">{status}</p>
      </div>
    </section>
  );
}

/** While the step hands out Wi-Fi setup, it's near the top, ready to edit. */
function WifiSetupEditing(p: InspectorSectionProps) {
  return p.has('wifi-config') ? <WifiSetupSection {...p} /> : null;
}

/** In other steps it's a summary at the bottom, out of the way of the step's own work. */
function WifiSetupSummary(p: InspectorSectionProps) {
  return p.has('wifi-config') ? null : <WifiSetupSection {...p} />;
}

export const wifiSetupSection: InspectorSection = { id: 'wifi-setup', slot: 'settings', Section: WifiSetupEditing };
export const wifiSetupSummary: InspectorSection = { id: 'wifi-setup-summary', slot: 'end', Section: WifiSetupSummary };
