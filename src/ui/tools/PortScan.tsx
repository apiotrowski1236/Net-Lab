import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { checkScanTarget } from '../../runtime/firewallInput';
import { portInfo, scanDone, scanFindings, type Scan } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import { connResultText, connTitle } from '../firewallText';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';
import { ToolMsg, type Msg } from './parts';

/**
 * Port scanner: a ping sweep and a port scan of an address or a network,
 * then a Connect button for each open port it found.
 */
export function PortScanTool({ session, spec }: ToolCardProps<'port-scan'>) {
  // Shows live network state: re-render whenever the network changes.
  void session.simRev.value;
  const sim = session.sim;
  const d = sim.devices[spec.device];
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const since = session.since;
  const scans = (d.scans ?? []).filter((s) => s.t >= since);
  const conns = (d.conns ?? []).filter((c) => c.t >= since).slice(-3).reverse();
  const busy = scans.some((s) => !s.doneAt);
  const run = (raw = target) => {
    const r = checkScanTarget(sim, spec.device, raw);
    if (!r.ok) {
      setMsg({ tone: 'bad', text: r.msg, suggest: r.suggest, onSuggest: r.suggest ? () => (setTarget(r.suggest!), run(r.suggest!)) : undefined });
      return;
    }
    setMsg(null);
    setTarget(r.target);
    session.dispatch({ type: 'scan', device: spec.device, target: r.target });
  };
  const connect = (ip: string, port: number) => session.dispatch({ type: 'connect', device: spec.device, to: ip, port });
  return (
    <div class="tool-card attack">
      <div class="tool-title">
        <Icon name="target" /> Port scanner ({d.label})
      </div>
      <p class="tool-desc">
        Ping every address in a network to find computers. Then knock on common ports at each one to see which services answer.
      </p>
      <div class="sentence">
        Scan
        <input
          class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
          value={target}
          placeholder="10.0.1.0/24"
          autoComplete="off"
          spellcheck={false}
          size={16}
          aria-label="Address or network to scan"
          aria-invalid={msg?.tone === 'bad'}
          onInput={(e) => {
            setTarget((e.target as HTMLInputElement).value);
            setMsg(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <button class="btn" onClick={() => run()} disabled={busy}>
          {busy ? 'Scanning…' : 'Scan'}
        </button>
      </div>
      <ToolMsg msg={msg} />
      {[...scans].reverse().map((s, i) => (
        <ScanResult key={s.id} sim={sim} scan={s} open={i === 0} onConnect={connect} />
      ))}
      {conns.length > 0 && (
        <ul class="ping-log conn-log" aria-live="polite">
          {conns.map((c) => {
            const tone = c.status === 'pending' ? 'wait' : c.status === 'open' ? 'good' : 'bad';
            return (
              <li key={c.id} class={tone}>
                <Icon name={tone === 'good' ? 'check' : tone === 'bad' ? 'x' : 'ping'} size={14} />
                <span>
                  {connTitle(sim, spec.device, c)}: {connResultText(sim, c)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ScanResult({ sim, scan, open, onConnect }: { sim: Sim; scan: Scan; open: boolean; onConnect: (ip: string, port: number) => void }) {
  const found = scanFindings(scan);
  const done = !!scan.doneAt || scanDone(scan);
  const total = scan.hosts.length * (scan.ports.length + 1);
  const answered = scan.hosts.reduce((n, h) => n + (h.ping !== 'pending' ? 1 : 0) + scan.ports.filter((p) => h.ports[p] !== 'pending').length, 0);
  const many = scan.size === 1 ? '1 address' : `${scan.size} addresses`;
  // The dock is short on a laptop. When a scan finishes, bring its results up
  // (not when the Toolkit opens on an old scan).
  const ref = useRef<HTMLDetailsElement>(null);
  const wasDone = useRef(done);
  useLayoutEffect(() => {
    if (done && !wasDone.current && open) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    wasDone.current = done;
  }, [done, open]);
  return (
    <details ref={ref} class="scan-result" open={open}>
      <summary>
        <span class="mono">{scan.target}</span>{' '}
        {done ? (
          <span class="muted">
            {many} scanned, {found.length} answered
          </span>
        ) : (
          <span class="muted">scanning… {total ? Math.round((100 * answered) / total) : 100}%</span>
        )}
      </summary>
      {found.length > 0 && (
        <table class="table scan-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Open ports</th>
            </tr>
          </thead>
          <tbody>
            {found.map((h) => (
              <tr key={h.ip}>
                <td>
                  <span class="mono">{h.ip}</span>
                  <div class="muted small">{sim.deviceByIp(h.ip)?.label}</div>
                  <div class="small scan-ping">{h.ping ? 'answered ping' : <span class="muted">no ping reply</span>}</div>
                </td>
                <td>
                  {h.open.length === 0 && <span class="muted">none</span>}
                  <span class="port-list">
                    {h.open.map((p) => (
                      <span key={p} class="port-chip">
                        <span class="mono">{p}</span> {portInfo(p)?.name ?? ''}
                        <button class="btn tiny" onClick={() => onConnect(h.ip, p)} title={`Connect to ${h.ip} port ${p}`}>
                          Connect
                        </button>
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {done && (
        <p class="muted small scan-note">
          {found.length === 0 ? 'Nothing answered at all.' : 'Every other address: no answer.'} No answer can mean nobody is there, or a firewall
          dropped the probes.
        </p>
      )}
    </details>
  );
}
