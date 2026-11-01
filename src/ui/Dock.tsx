import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import type { Sim } from '../sim/sim';
import type { Captured, Device, Route } from '../sim/types';
import type { ToolSpec } from '../labs/types';
import { PROTO_COLOR, endpoints, fmtTime, infoOf, layersOf, nameForMac, protoOf } from './describe';
import { Icon } from './icons';
import { checkPrefix, checkSpoofClaim, checkStaticArp, covers } from '../runtime/toolInput';

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

const KIND_TEXT: Record<Device['kind'], string> = {
  host: 'Computer',
  router: 'Router',
  switch: 'Switch',
  hub: 'Hub',
};

function recentlyChanged(sim: Sim, pred: (e: Sim['events'][number]) => boolean, ms = 4000): boolean {
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i];
    if (sim.t - e.t > ms) return false;
    if (pred(e)) return true;
  }
  return false;
}

function nextHopText(sim: Sim, r: Route): string {
  if (r.source === 'bgp' && !r.via) return 'Nowhere: we claim it ourselves';
  if (!r.via) return 'Deliver directly (on this network)';
  const owner = sim.deviceByIp(r.via);
  return owner ? `${owner.label} (${r.via})` : r.via;
}

export function Inspector({ session, deviceId }: { session: LabSession; deviceId: string | null }) {
  // During a replay, show the replayed network so students can watch tables change.
  const sim = session.view;
  const replaying = !!session.replay.value;
  const dev = deviceId ? sim.devices[deviceId] : undefined;
  if (!dev) {
    return (
      <div class="dock-empty">
        <Icon name="target" size={28} />
        <p>Click any device on the map to look inside it.</p>
      </div>
    );
  }
  const labelMacs = session.lab.labelMacs ?? true;
  const macNote = (mac: string) => {
    if (!labelMacs) return null;
    const n = nameForMac(sim, mac);
    return n ? <span class="muted"> {n}</span> : null;
  };
  const arpRows = Object.entries(dev.arp);
  const macCount: Record<string, number> = {};
  for (const [, e] of arpRows) macCount[e.mac] = (macCount[e.mac] ?? 0) + 1;
  const dupes = arpRows.filter(([, e]) => macCount[e.mac] > 1);

  return (
    <div class="inspector">
      <div class="insp-head">
        <div>
          <div class="insp-title">{dev.label}</div>
          <div class="insp-sub">
            {KIND_TEXT[dev.kind]}
            {dev.bgp ? ` · Autonomous System ${dev.bgp.asn}` : ''}
            {dev.attacker ? ' · attacker' : ''}
          </div>
        </div>
        {dev.sniffing && <span class="pill bad">capturing</span>}
        {dev.forwarding && dev.kind === 'host' && <span class="pill bad">forwarding</span>}
        {dev.bgp?.validate && <span class="pill good">validating routes</span>}
      </div>
      {replaying && <div class="callout info small">You're looking at the replay. Choose Back to live (above the map) to see the network as it is now.</div>}
      {dev.notes?.map((n) => (
        <p class="insp-note">{n}</p>
      ))}

      <section>
        <h4>Addresses</h4>
        <table class="table">
          <thead>
            <tr>
              <th>Port</th>
              <th>MAC address</th>
              <th>IP address</th>
            </tr>
          </thead>
          <tbody>
            {dev.ifaces.map((i) => (
              <tr key={i.id}>
                <td>{i.id}</td>
                <td class="mono">{i.mac}</td>
                <td class="mono">{i.ip ? `${i.ip}/${i.prefix}` : <span class="muted">none (works below IP)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(dev.kind === 'host' || (dev.kind === 'router' && !dev.bgp)) && (
        <section>
          <h4>
            ARP table <span class="muted">which MAC address goes with each IP on this network</span>
          </h4>
          {arpRows.length === 0 ? (
            <p class="muted small">Empty. This device hasn't needed to talk to anyone nearby yet.</p>
          ) : (
            <table class="table">
              <thead>
                <tr>
                  <th>IP address</th>
                  <th>MAC address</th>
                </tr>
              </thead>
              <tbody>
                {arpRows.map(([ip, e]) => {
                  const flash = recentlyChanged(sim, (ev) => ev.type === 'arp-update' && ev.device === dev.id && ev.ip === ip);
                  const dup = macCount[e.mac] > 1;
                  return (
                    <tr key={ip} class={`${flash ? 'flash' : ''} ${dup ? 'dup' : ''}`}>
                      <td class="mono">{ip}</td>
                      <td class="mono">
                        {e.mac}
                        {macNote(e.mac)}
                        {e.via === 'static' && (
                          <span class="pill good tiny" title="Locked: fake ARP replies are ignored">
                            locked
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {dupes.length > 0 && (
            <div class="callout warn small">
              <Icon name="warn" /> Two different IP addresses point to the <strong>same</strong> MAC address. One device is
              claiming to be two.
            </div>
          )}
        </section>
      )}

      {dev.kind === 'switch' && (
        <section>
          <h4>
            MAC address table <span class="muted">which port leads to each MAC</span>
          </h4>
          <table class="table">
            <thead>
              <tr>
                <th>MAC address</th>
                <th>Port</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(dev.macTable).map(([mac, port]) => {
                const peer = sim.peer(dev.id, port);
                return (
                  <tr key={mac}>
                    <td class="mono">
                      {mac}
                      {macNote(mac)}
                    </td>
                    <td>
                      {port}
                      {peer && <span class="muted"> to {sim.devices[peer.device].label}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {dev.kind === 'hub' && (
        <p class="insp-note">
          A hub (or open Wi-Fi) has no table. Every frame goes out to <strong>every</strong> device. Each device is trusted
          to ignore frames that aren't addressed to it.
        </p>
      )}

      {(dev.kind === 'router' || dev.forwarding) && (
        <section>
          <h4>
            Routing table <span class="muted">where to send packets for each destination</span>
          </h4>
          <table class="table">
            <thead>
              <tr>
                <th>Destination</th>
                <th>Send to</th>
                {dev.bgp && <th>AS path</th>}
              </tr>
            </thead>
            <tbody>
              {[...dev.routes]
                .sort((a, b) => Number(b.prefix.split('/')[1]) - Number(a.prefix.split('/')[1]))
                .filter((r) => !(dev.bgp && r.source === 'connected' && r.prefix.endsWith('/30')))
                .map((r) => {
                  const flash = recentlyChanged(sim, (ev) => ev.type === 'route-change' && ev.device === dev.id && ev.prefix === r.prefix);
                  const evil = !!r.asPath?.length && sim.rov(r.prefix, r.asPath[r.asPath.length - 1]) === 'invalid';
                  return (
                    <tr key={r.prefix + r.source} class={`${flash ? 'flash' : ''} ${evil ? 'dup' : ''}`}>
                      <td class="mono">{r.prefix === '0.0.0.0/0' ? 'everything else' : r.prefix}</td>
                      <td>{nextHopText(sim, r)}</td>
                      {dev.bgp && <td class="mono">{r.asPath?.length ? r.asPath.join(' → ') : r.source === 'connected' ? 'connected' : '(ours)'}</td>}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      )}

      {dev.browser && !dev.web && (
        <section>
          <h4>Browser</h4>
          <p class="small">
            <span class="mono">{dev.browser.url}</span>: {dev.browser.status}
            {dev.browser.from && (
              <>
                {' '}
                (page came from <span class="mono">{dev.browser.from}</span>)
              </>
            )}
          </p>
        </section>
      )}

      {dev.web && (
        <section>
          <h4>Web server</h4>
          <p class="small">
            Serves <strong>{dev.web.name}</strong> {dev.web.fake ? '(an impostor)' : 'and holds its HTTPS certificate'}.
          </p>
        </section>
      )}

      {dev.stolen.length > 0 && (
        <section>
          <h4>Stolen passwords</h4>
          <table class="table">
            <tbody>
              {dev.stolen.map((s) => (
                <tr key={s.t}>
                  <td class="mono">{s.user}</td>
                  <td class="mono">{s.pass}</td>
                  <td class="muted">from {s.victimIp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Packet capture (a friendly Wireshark)
// ---------------------------------------------------------------------------

export function CaptureView({ session, deviceId }: { session: LabSession; deviceId: string }) {
  const sim = session.sim;
  const dev = sim.devices[deviceId];
  const [selected, setSelected] = useState<number | null>(null);
  const [hideArp, setHideArp] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const rows: Captured[] = (dev?.capture ?? []).filter((c) => !(hideArp && (c.frame.arp || c.frame.bgp)));

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  if (!dev) return null;
  const sel = rows.find((r) => r.no === selected) ?? dev.capture.find((r) => r.no === selected);

  return (
    <div class="capture">
      <div class="capture-bar">
        <span>
          <strong>{dev.label}'s packet capture</strong>{' '}
          <span class="muted">
            {dev.capture.length} packet{dev.capture.length === 1 ? '' : 's'}
            {dev.sniffing ? '' : ' · capture is off'}
          </span>
        </span>
        <label class="check">
          <input type="checkbox" checked={hideArp} onChange={(e) => setHideArp((e.target as HTMLInputElement).checked)} /> Hide
          ARP and route chatter
        </label>
      </div>
      {dev.capture.length === 0 ? (
        <div class="dock-empty">
          <Icon name="eye" size={28} />
          <p>{dev.sniffing ? 'Listening… nothing captured yet.' : `${dev.label}'s capture is off. Turn it on in the Toolkit tab.`}</p>
        </div>
      ) : (
        <div class="capture-split">
          <div
            class="capture-list"
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
            }}
          >
            <table class="table capture-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Protocol</th>
                  <th>Info</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const proto = protoOf(c.frame);
                  const { src, dst } = endpoints(c.frame);
                  return (
                    <tr
                      key={c.no}
                      class={`${selected === c.no ? 'selected' : ''} ${c.frame.forged ? 'forged' : ''}`}
                      onClick={() => {
                        setSelected(c.no);
                        session.ui({ type: 'ui:open-frame', device: deviceId, frame: c.frame });
                      }}
                    >
                      <td>{c.no}</td>
                      <td class="mono">{fmtTime(c.t)}</td>
                      <td class="mono">{src}</td>
                      <td class="mono">{dst}</td>
                      <td>
                        <span class="proto" style={{ background: PROTO_COLOR[proto] }}>
                          {proto}
                        </span>
                      </td>
                      <td class="mono info">{infoOf(c.frame)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div class="capture-detail">
            {sel ? (
              layersOf(sim, sel.frame).map((l) => (
                <div class={`layer ${l.locked ? 'locked' : ''}`} style={{ borderLeftColor: l.color }}>
                  <div class="layer-title" style={{ color: l.color }}>
                    {l.locked && <Icon name="lock" size={14} />} {l.title}
                  </div>
                  <table>
                    <tbody>
                      {l.rows.map(([k, v, note]) => (
                        <tr>
                          <td class="k">{k}</td>
                          <td class={`v mono ${l.locked ? 'gib' : ''}`}>
                            {v} {note && <span class="muted">{note}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {l.note && <div class="layer-note">{l.note}</div>}
                </div>
              ))
            ) : (
              <div class="dock-empty small">
                <p>Click a packet to open it up.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolkit
// ---------------------------------------------------------------------------

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button class={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span class="toggle-track">
        <span class="toggle-knob" />
      </span>
      <span>{label}</span>
    </button>
  );
}

/** A one-line message under a tool input: what went wrong, or what just happened. */
function ToolMsg({ msg }: { msg: { tone: 'bad' | 'good' | 'info'; text: string; suggest?: string; onSuggest?: () => void } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // The dock is short on a small laptop screen. Make sure the student sees the message.
  useLayoutEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [msg?.text]);
  if (!msg) return null;
  return (
    <div ref={ref} class={`tool-msg ${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={msg.tone === 'bad' ? 'warn' : msg.tone === 'good' ? 'check' : 'info'} size={14} />
      <span>
        {msg.text}
        {msg.suggest && msg.onSuggest && (
          <button class="btn tiny" onClick={msg.onSuggest}>
            Use {msg.suggest}
          </button>
        )}
      </span>
    </div>
  );
}

type Msg = Parameters<typeof ToolMsg>[0]['msg'];

function ArpSpoofTool({ session, spec }: { session: LabSession; spec: Extract<ToolSpec, { kind: 'arp-spoof' }> }) {
  const sim = session.sim;
  const [victim, setVictim] = useState(spec.victims[0]);
  const [claim, setClaim] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const me = sim.devices[spec.device];
  const sent = sim.events.filter((e) => e.type === 'config' && e.what === 'arp-spoof' && e.device === spec.device).slice(-4);
  const send = () => {
    const r = checkSpoofClaim(sim, spec.device, victim, claim);
    if (!r.ok) return setMsg({ tone: 'bad', text: r.msg });
    session.dispatch({ type: 'arp-spoof', device: spec.device, victim, claimIp: r.ip });
    setMsg({ tone: 'good', text: `Sent. ${sim.devices[victim].label} now hears that ${r.ip} is at ${me.ifaces[0].mac}.` });
  };
  return (
    <div class="tool-card attack">
      <div class="tool-title">
        <Icon name="bolt" /> ARP spoofer
      </div>
      <p class="tool-desc">Send a fake ARP reply. Nobody asked, but most devices believe it anyway.</p>
      <div class="sentence">
        Tell
        <select value={victim} onChange={(e) => setVictim((e.target as HTMLSelectElement).value)} aria-label="Device to fool">
          {spec.victims.map((v) => (
            <option value={v}>{sim.devices[v].label}</option>
          ))}
        </select>
        that
        <input
          class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
          value={claim}
          placeholder="IP address"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          size={14}
          aria-label="IP address to claim"
          aria-invalid={msg?.tone === 'bad'}
          onInput={(e) => {
            setClaim((e.target as HTMLInputElement).value);
            setMsg(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        is at <span class="mono chip-static">{me.ifaces[0].mac}</span>
      </div>
      <ToolMsg msg={msg} />
      <button class="btn danger" onClick={send}>
        <Icon name="send" /> Send fake ARP reply
      </button>
      {sent.length > 0 && (
        <ul class="tool-log">
          {sent.map((e) => (
            <li>{e.type === 'config' ? e.detail : ''}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnnounceTool({ session, spec }: { session: LabSession; spec: Extract<ToolSpec, { kind: 'bgp-announce' }> }) {
  const sim = session.sim;
  const dev = sim.devices[spec.device];
  const [prefix, setPrefix] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const own = dev.bgp?.origins ?? [];
  const announce = (raw: string) => {
    const r = checkPrefix(sim, spec.device, raw);
    if (!r.ok) {
      return setMsg({
        tone: 'bad',
        text: r.msg,
        suggest: r.suggest,
        onSuggest: r.suggest ? () => (setPrefix(r.suggest!), announce(r.suggest!)) : undefined,
      });
    }
    session.dispatch({ type: 'announce', device: spec.device, prefix: r.prefix });
    setPrefix('');
    const t = spec.target;
    if (!t) return setMsg({ tone: 'good', text: `Announced ${r.prefix}. Watch the ROUTE packets spread.` });
    setMsg(
      covers(r.prefix, t.ip)
        ? { tone: 'good', text: `Announced ${r.prefix}. It includes ${t.label} (${t.ip}). Watch the ROUTE packets spread.` }
        : { tone: 'info', text: `Announced ${r.prefix}. It does not include ${t.label} (${t.ip}), so traffic to ${t.label} won't change. You can withdraw it below.` },
    );
  };
  return (
    <div class="tool-card attack">
      <div class="tool-title">
        <Icon name="send" /> Route announcer ({dev.label})
      </div>
      <p class="tool-desc">Tell your neighbors "I can reach these addresses." Nothing checks whether that's true.</p>
      <div class="sentence">
        Announce
        <input
          class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
          value={prefix}
          placeholder="prefix, like 10.0.0.0/8"
          autoComplete="off"
          spellcheck={false}
          size={20}
          aria-label="Prefix to announce"
          aria-invalid={msg?.tone === 'bad'}
          onInput={(e) => {
            setPrefix((e.target as HTMLInputElement).value);
            setMsg(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && announce(prefix)}
        />
        <button class="btn danger" onClick={() => announce(prefix)}>
          Announce
        </button>
      </div>
      <ToolMsg msg={msg} />
      <div class="small muted">Currently announcing:</div>
      <ul class="tool-list">
        {own.map((p) => (
          <li>
            <span class="mono">{p}</span>
            <button
              class="btn tiny ghost"
              onClick={() => {
                session.dispatch({ type: 'withdraw', device: spec.device, prefix: p });
                setMsg({ tone: 'info', text: `Withdrew ${p}.` });
              }}
            >
              Withdraw
            </button>
          </li>
        ))}
        {own.length === 0 && <li class="muted">nothing</li>}
      </ul>
    </div>
  );
}

function StaticArpTool({ session, spec }: { session: LabSession; spec: Extract<ToolSpec, { kind: 'static-arp' }> }) {
  const sim = session.sim;
  const d = sim.devices[spec.device];
  const [ip, setIp] = useState('');
  const [mac, setMac] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const locked = Object.entries(d.arp).filter(([, e]) => e.via === 'static');
  const lock = () => {
    const r = checkStaticArp(sim, spec.device, ip, mac);
    if (!r.ok) return setMsg({ tone: 'bad', text: r.msg });
    session.dispatch({ type: 'static-arp', device: spec.device, ip: r.ip, mac: r.mac });
    setIp('');
    setMac('');
    setMsg({ tone: 'good', text: `Locked. ${d.label} will send traffic for ${r.ip} only to ${r.mac}.` });
  };
  const edit = (set: (v: string) => void) => (e: Event) => {
    set((e.target as HTMLInputElement).value);
    setMsg(null);
  };
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="lock" /> Lock ARP entries ({d.label})
      </div>
      <p class="tool-desc">Type the correct MAC address in by hand. A locked entry ignores ARP replies, real or fake.</p>
      <div class="sentence">
        Lock
        <input
          class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
          value={ip}
          placeholder="IP address"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          size={14}
          aria-label="IP address to lock"
          onInput={edit(setIp)}
          onKeyDown={(e) => e.key === 'Enter' && lock()}
        />
        to
        <input
          class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
          value={mac}
          placeholder="MAC address"
          autoComplete="off"
          spellcheck={false}
          size={19}
          aria-label="MAC address"
          onInput={edit(setMac)}
          onKeyDown={(e) => e.key === 'Enter' && lock()}
        />
      </div>
      <ToolMsg msg={msg} />
      <button class="btn" onClick={lock}>
        <Icon name="lock" /> Lock it
      </button>
      {locked.length > 0 && (
        <>
          <div class="small muted">Locked on {d.label}:</div>
          <ul class="tool-list">
            {locked.map(([lip, e]) => (
              <li>
                <span class="mono">
                  {lip} = {e.mac}
                </span>
                <span class="badge">
                  <Icon name="lock" size={12} /> locked
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function Toolkit({ session, tools }: { session: LabSession; tools: ToolSpec[] }) {
  const sim = session.sim;
  if (!tools.length) {
    return (
      <div class="dock-empty">
        <Icon name="bolt" size={28} />
        <p>No tools yet. The lesson will hand you tools as you need them.</p>
      </div>
    );
  }
  return (
    <div class="toolkit">
      {tools.map((t) => {
        switch (t.kind) {
          case 'sniffer': {
            const d = sim.devices[t.device];
            return (
              <div class="tool-card attack">
                <div class="tool-title">
                  <Icon name="eye" /> Packet capture ({d.label})
                </div>
                <p class="tool-desc">Copy every frame that reaches {d.label}'s network card, even frames addressed to someone else.</p>
                <Toggle on={d.sniffing} label={d.sniffing ? 'Capturing' : 'Off'} onChange={(on) => session.dispatch({ type: 'sniff', device: t.device, on })} />
              </div>
            );
          }
          case 'forwarding': {
            const d = sim.devices[t.device];
            return (
              <div class="tool-card attack">
                <div class="tool-title">
                  <Icon name="arrows" /> IP forwarding ({d.label})
                </div>
                <p class="tool-desc">Pass along packets meant for someone else instead of dropping them, so the victim never notices.</p>
                <Toggle on={d.forwarding} label={d.forwarding ? 'Forwarding' : 'Off'} onChange={(on) => session.dispatch({ type: 'forward', device: t.device, on })} />
              </div>
            );
          }
          case 'arp-spoof':
            return <ArpSpoofTool session={session} spec={t} />;
          case 'bgp-announce':
            return <AnnounceTool session={session} spec={t} />;
          case 'bgp-validate':
            return (
              <div class="tool-card defend">
                <div class="tool-title">
                  <Icon name="shield" /> Route origin validation (RPKI)
                </div>
                <p class="tool-desc">Check every announcement against the public registry of who owns which addresses. Reject liars.</p>
                {t.devices.map((id) => {
                  const d = sim.devices[id];
                  return (
                    <div class="tool-row">
                      <span>{d.label}</span>
                      <Toggle on={!!d.bgp?.validate} label={d.bgp?.validate ? 'Validating' : 'Off'} onChange={(on) => session.dispatch({ type: 'validate', device: id, on })} />
                    </div>
                  );
                })}
              </div>
            );
          case 'static-arp':
            return <StaticArpTool session={session} spec={t} />;
        }
      })}
    </div>
  );
}
