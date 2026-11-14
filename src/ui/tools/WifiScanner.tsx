import { useState } from 'preact/hooks';
import { bars, SECURITY_LABEL, type ScanRow } from '../../sim/wifi';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/** Signal drawn as filled and empty bars, e.g. three of four. */
function Bars({ signal }: { signal: number }) {
  const n = bars(signal);
  return (
    <span class="wifi-bars" title={`signal ${signal}`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} class={`bar ${i <= n ? 'on' : ''}`} style={{ height: `${4 + i * 3}px` }} />
      ))}
    </span>
  );
}

/**
 * Wi-Fi scanner: pick a spot (a device), listen to the air, and read every
 * network in range. Duplicate names and networks you didn't set up are flagged,
 * so a rogue box or an evil twin stands out. See src/sim/wifi.ts.
 *
 * With `spec.watch` (watch-the-air) it flags nothing: it adds each network's
 * channel and the noise on each channel, and the student marks every network
 * as on or off the watching access point's approved list (src/sim/wids.ts).
 */
export function WifiScanner({ session, spec, onSelect }: ToolCardProps<'wifi-scan'>) {
  void session.simRev.value;
  const sim = session.sim;
  const [who, setWho] = useState(spec.devices[0]);
  const [rows, setRows] = useState<ScanRow[] | null>(null);

  const scan = (id: string) => {
    setWho(id);
    session.dispatch({ type: 'wifi-scan', device: id });
    const d = sim.dev(id);
    setRows(sim.wifiScanRows(d, d.wifiClient?.antennaBoost ?? 0));
  };

  const watch = spec.watch ? sim.devices[spec.watch]?.wids : undefined;
  // A name that more than one radio advertises is the evil-twin tell. In watch mode the student judges.
  const dupSsid = new Set(watch ? [] : rows?.filter((r, _i, a) => a.filter((x) => x.ssid === r.ssid).length > 1).map((r) => r.ssid));
  // The three channels that don't overlap, plus any other channel a network uses, so the list stays the same between scans.
  const channels = rows && watch ? [...new Set([1, 6, 11, ...rows.map((r) => r.channel)])].sort((a, b) => a - b) : [];

  return (
    <div class={`tool-card ${watch ? 'wifi-watch' : ''}`}>
      <div class="tool-title">
        <Icon name="target" /> Wi-Fi scanner
      </div>
      <p class="tool-desc">Listen for every network in range from one spot. Signal is stronger the closer you are to the radio.</p>
      {spec.devices.length > 1 && (
        <div class="seg">
          {spec.devices.map((id) => (
            <button key={id} class={`btn tiny ${who === id ? 'on' : ''}`} onClick={() => scan(id)}>
              {sim.dev(id).label}
            </button>
          ))}
        </div>
      )}
      <button class="btn" onClick={() => scan(who)}>
        Scan from {sim.dev(who).label}
      </button>
      {sim.jam.on && !watch && (
        <p class="tool-msg bad" role="alert">
          <Icon name="warn" size={14} /> Heavy noise on channel {sim.jam.channel}. The air is being jammed.
        </p>
      )}
      {rows && (
        <table class="table wifi-scan">
          <thead>
            <tr>
              <th>Network</th>
              <th>Security</th>
              {watch && <th>Channel</th>}
              <th>Signal</th>
              <th>{watch ? 'Approved list' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={watch ? 5 : 4} class="muted">
                  Nothing in range from here.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.bssid} class={!watch && (r.rogue || dupSsid.has(r.ssid)) ? 'flag' : ''}>
                <td>
                  <button class="linklike" onClick={() => onSelect(r.device)}>
                    {r.ssid || '(hidden)'}
                  </button>
                  <div class="mono tiny muted">{r.bssid}</div>
                </td>
                <td class="small">
                  {SECURITY_LABEL[r.security].replace(' (no encryption)', '')}
                  {r.wps ? ' · WPS' : ''}
                </td>
                {watch && <td class="small">{r.channel}</td>}
                <td>
                  <Bars signal={r.signal} />
                </td>
                {watch ? (
                  <td class="small">
                    <div class="seg wids-mark" role="group" aria-label={`Is ${r.ssid || 'this network'} on the approved list?`}>
                      {(['approved', 'unknown'] as const).map((m) => (
                        <button
                          key={m}
                          class={`btn tiny ${watch.marks[r.bssid] === m ? 'on' : ''}`}
                          aria-pressed={watch.marks[r.bssid] === m}
                          onClick={() => session.dispatch({ type: 'wids-mark', device: spec.watch!, bssid: r.bssid, mark: watch.marks[r.bssid] === m ? null : m })}
                        >
                          {m === 'approved' ? 'On the list' : 'Not on it'}
                        </button>
                      ))}
                    </div>
                  </td>
                ) : (
                  <td class="small">
                    {dupSsid.has(r.ssid) && <span class="pill bad">duplicate name</span>}
                    {r.rogue && !dupSsid.has(r.ssid) && <span class="pill warn">not yours</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows && watch && (
        <p class="small wifi-noise">
          Noise by channel, on a scale of 0 to 100 (quiet is about 5):{' '}
          {channels.map((c, i) => (
            <span key={c}>
              {i > 0 && ', '}
              channel {c}: <strong>{sim.channelNoise(c)}</strong>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
