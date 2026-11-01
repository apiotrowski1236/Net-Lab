import type { ComponentType } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import type { Sim } from '../sim/sim';
import type { Captured, Device, Route } from '../sim/types';
import { SETTING_TOOLS, type ToolSpec } from '../labs/types';
import { PROTO_COLOR, endpoints, fmtTime, infoOf, layersOf, nameForMac, pingFailText, protoOf } from './describe';
import { Icon } from './icons';
import { INSPECTOR_SECTIONS, type InspectorSectionProps } from './inspector/registry';
import { TOOL_CARDS, type ToolCardProps } from './tools/registry';
import { recentlyChanged, Toggle, ToolMsg, useDraft, type Msg } from './tools/parts';
import {
  checkAddress,
  checkCable,
  checkGateway,
  checkPing,
  checkPrefix,
  checkRoute,
  checkSpoofClaim,
  checkStaticArp,
  covers,
  portName,
} from '../runtime/toolInput';

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

const KIND_TEXT: Record<Device['kind'], string> = {
  host: 'Computer',
  router: 'Router',
  switch: 'Switch',
  hub: 'Hub',
  firewall: 'Firewall',
};

function nextHopText(sim: Sim, dev: Device, r: Route, ports: boolean): string {
  if (r.source === 'bgp' && !r.via) return 'Nowhere: we claim it ourselves';
  if (!r.via) return ports && dev.ifaces.length > 1 ? `Deliver directly (on this network, out ${portName(r.iface)})` : 'Deliver directly (on this network)';
  const owner = sim.deviceByIp(r.via);
  const who = owner ? `${owner.label} (${r.via})` : r.via;
  if (r.source === 'static' && !sim.connectedIface(dev, r.via)) return `${who}: not on any of ${dev.label}'s networks, so it can't be reached`;
  return who;
}

/** A static route whose next hop isn't on any of the device's networks goes nowhere. */
const brokenRoute = (sim: Sim, dev: Device, r: Route) => r.source === 'static' && !!r.via && !sim.connectedIface(dev, r.via);

type Fixed = Extract<ToolSpec, { kind: 'ip-config' }>['fixed'];

function AddressRow({
  session,
  sim,
  dev,
  iface,
  edit,
  cables,
  fixed,
}: {
  session: LabSession;
  sim: Sim;
  dev: Device;
  iface: Device['ifaces'][number];
  edit: boolean;
  cables: boolean;
  fixed: Fixed;
}) {
  // Shows live network state: re-render whenever the network changes.
  void session.simRev.value;
  const current = iface.ip ? `${iface.ip}/${iface.prefix}` : '';
  const draft = useDraft(current);
  const [msg, setMsg] = useState<Msg>(null);
  const l2 = dev.kind === 'switch' || dev.kind === 'hub';
  const where = dev.ifaces.length > 1 ? `${dev.label} ${portName(iface.id)}` : dev.label;
  const save = (raw: string) => {
    const r = checkAddress(session.sim, dev.id, iface.id, raw, fixed);
    if (!r.ok) {
      return setMsg({
        tone: 'bad',
        text: `Not saved. ${r.msg}`,
        suggest: r.suggest,
        onSuggest: r.suggest ? () => (draft.set(r.suggest!), save(r.suggest!)) : undefined,
      });
    }
    session.dispatch({ type: 'set-ip', device: dev.id, iface: iface.id, cidr: r.cidr });
    draft.clear();
    if (!r.cidr) setMsg({ tone: 'info', text: `Removed the address from ${where}.` });
    else if (r.note) setMsg({ tone: 'info', text: `Saved ${r.cidr}. ${r.note}` });
    else setMsg({ tone: 'good', text: `Saved. ${where} is now ${r.cidr}.` });
  };
  const peer = sim.peer(dev.id, iface.id);
  const peerDev = peer ? sim.devices[peer.device] : undefined;
  return (
    <>
      <tr>
        <td>{portName(iface.id)}</td>
        {!l2 && <td class="mono">{iface.mac}</td>}
        {!l2 && (
          <td class="mono">
            {edit ? (
              <span class="inline-edit">
                <input
                  class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
                  value={draft.value}
                  placeholder="none yet"
                  autoComplete="off"
                  spellcheck={false}
                  size={17}
                  aria-label={`IP address for ${where}`}
                  aria-invalid={msg?.tone === 'bad'}
                  onInput={(e) => {
                    draft.set((e.target as HTMLInputElement).value);
                    setMsg(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && save(draft.value)}
                />
                <button class={`btn tiny ${draft.edited ? 'primary' : ''}`} onClick={() => save(draft.value)}>
                  Save
                </button>
              </span>
            ) : iface.ip ? (
              `${iface.ip}/${iface.prefix}`
            ) : (
              <span class="muted">none</span>
            )}
          </td>
        )}
        {(cables || l2) && (
          <td>
            {peerDev ? (
              <>
                {peerDev.label}
                {peerDev.ifaces.length > 1 && <span class="muted">, {portName(peer!.iface)}</span>}
              </>
            ) : (
              <span class="muted">no cable</span>
            )}
          </td>
        )}
      </tr>
      {msg && (
        <tr class="msg-row">
          <td colSpan={l2 ? 2 : cables ? 4 : 3}>
            <ToolMsg msg={msg} />
          </td>
        </tr>
      )}
    </>
  );
}

function GatewayField({ session, dev, edit }: { session: LabSession; dev: Device; edit: boolean }) {
  // Shows live network state: re-render whenever the network changes.
  void session.simRev.value;
  const draft = useDraft(dev.gateway ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  const save = (raw: string) => {
    const r = checkGateway(session.sim, dev.id, raw);
    if (!r.ok) {
      const was = dev.gateway ? ` ${dev.label} still uses ${dev.gateway}.` : '';
      return setMsg({
        tone: 'bad',
        text: `Not saved.${was} ${r.msg}`,
        suggest: r.suggest,
        onSuggest: r.suggest ? () => (draft.set(r.suggest!), save(r.suggest!)) : undefined,
      });
    }
    session.dispatch({ type: 'gateway', device: dev.id, ip: r.ip });
    draft.clear();
    setMsg(r.ip ? { tone: 'good', text: `Saved. ${dev.label} now sends traffic for other networks to ${r.ip}.` } : { tone: 'info', text: `Removed ${dev.label}'s default gateway.` });
  };
  return (
    <section>
      <h4>
        Default gateway <span class="muted">the router {dev.label} sends anything that isn't on its own network</span>
      </h4>
      {edit ? (
        <>
          <div class="sentence">
            <input
              class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
              value={draft.value}
              placeholder="router's IP address"
              inputMode="decimal"
              autoComplete="off"
              spellcheck={false}
              size={16}
              aria-label={`Default gateway for ${dev.label}`}
              aria-invalid={msg?.tone === 'bad'}
              onInput={(e) => {
                draft.set((e.target as HTMLInputElement).value);
                setMsg(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && save(draft.value)}
            />
            <button class={`btn small ${draft.edited ? 'primary' : ''}`} onClick={() => save(draft.value)}>
              Save
            </button>
          </div>
          <ToolMsg msg={msg} />
        </>
      ) : (
        <p class="small mono">{dev.gateway ?? <span class="muted">none</span>}</p>
      )}
    </section>
  );
}

function RouteForm({ session, dev }: { session: LabSession; dev: Device }) {
  const [prefix, setPrefix] = useState('');
  const [via, setVia] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const add = (p = prefix, v = via): void => {
    const r = checkRoute(session.sim, dev.id, p, v);
    if (!r.ok) {
      return setMsg({
        tone: 'bad',
        text: r.msg,
        field: r.field,
        suggest: r.suggest,
        onSuggest: !r.suggest ? undefined : r.field === 'via' ? () => (setVia(r.suggest!), add(p, r.suggest!)) : () => (setPrefix(r.suggest!), add(r.suggest!, v)),
      });
    }
    session.dispatch({ type: 'add-route', device: dev.id, prefix: r.prefix, via: r.via });
    setPrefix('');
    setVia('');
    setMsg({
      tone: 'good',
      text: `Added. ${dev.label} now sends packets for ${r.prefix === '0.0.0.0/0' ? 'everything else' : r.prefix} to ${r.via}${r.replaces ? ` instead of ${r.replaces}` : ''}.`,
    });
  };
  const edit = (set: (v: string) => void) => (e: Event) => {
    set((e.target as HTMLInputElement).value);
    setMsg(null);
  };
  // Outline only the box at fault (both when the check doesn't say which).
  const bad = (field: string) => msg?.tone === 'bad' && (!msg.field || msg.field === field);
  const form = useRef<HTMLDivElement>(null);
  // In a step about adding routes, the form is the point: don't leave it below the fold.
  const open = session.step.open;
  const routeStep = !!session.step.tools?.some((t) => t.kind === 'static-route') || (typeof open === 'object' && open.inspect === dev.id);
  useLayoutEffect(() => {
    // Centered, so its message has room below it.
    if (routeStep) form.current?.scrollIntoView({ block: 'center' });
  }, [routeStep]);
  return (
    <div class="route-form" ref={form}>
      <div class="sentence">
        Send
        <input
          class={`mono ${bad('prefix') ? 'invalid' : ''}`}
          value={prefix}
          placeholder="network/prefix"
          autoComplete="off"
          spellcheck={false}
          size={18}
          aria-label="Destination network"
          onInput={edit(setPrefix)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        to next hop
        <input
          class={`mono ${bad('via') ? 'invalid' : ''}`}
          value={via}
          placeholder="router address"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          size={16}
          aria-label="Next hop"
          onInput={edit(setVia)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button class="btn small" onClick={() => add()}>
          Add route
        </button>
      </div>
      <ToolMsg msg={msg} />
    </div>
  );
}

export function Inspector({ session, deviceId }: { session: LabSession; deviceId: string | null }) {
  // Shows live network state: re-render whenever the network changes.
  void session.simRev.value;
  // During a replay, show the replayed network so students can watch tables change.
  const sim = session.view;
  const replaying = !!session.replay.value;
  const dev = deviceId ? sim.devices[deviceId] : undefined;
  const lab = session.lab;
  const tools = session.tools;
  const has = (k: ToolSpec['kind']) => !replaying && tools.some((t) => t.kind === k);
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
  const layer3 = dev.kind === 'host' || dev.kind === 'router';
  const cables = !!lab.map?.ports || tools.some((t) => t.kind === 'cable');
  const canIp = has('ip-config') && layer3;
  const canGateway = has('gateway') && dev.kind === 'host';
  const canRoute = has('static-route') && dev.kind === 'router';
  const fixed = tools.flatMap((t) => (t.kind === 'ip-config' ? (t.fixed ?? []) : []));
  const showRoutes = dev.kind === 'router' || dev.forwarding || (!!lab.hostRoutes && dev.kind === 'host');
  const unplugged = cables && layer3 && !dev.ifaces.some((i) => i.linkId);
  const extra: InspectorSectionProps = { session, sim, dev, replaying, has };
  const sections = (slot: 'settings' | 'end') =>
    INSPECTOR_SECTIONS.filter((x) => x.slot === slot).map(({ id, Section }) => <Section key={`${id}-${dev.id}`} {...extra} />);
  // A switch works below IP: its ports have no addresses to show, only where their cables go.
  const ports = (
    <section>
      <h4>{layer3 ? 'Addresses' : 'Ports'}</h4>
      <table class="table">
        <thead>
          <tr>
            <th>Port</th>
            {layer3 && <th>MAC address</th>}
            {layer3 && <th>IP address</th>}
            {(cables || !layer3) && <th>Cable goes to</th>}
          </tr>
        </thead>
        <tbody>
          {dev.ifaces.map((i) => (
            <AddressRow key={`${dev.id}/${i.id}`} session={session} sim={sim} dev={dev} iface={i} edit={canIp} cables={cables} fixed={fixed} />
          ))}
        </tbody>
      </table>
    </section>
  );

  // A router's routing table is what students come for: it goes right after its addresses.
  const routing = showRoutes && (
        <section>
          <h4>
            Routing table <span class="muted">where to send packets for each destination</span>
          </h4>
          {dev.routes.length === 0 && (
            <p class="muted small">
              Empty. {dev.label} has no IP addresses yet, so it isn't part of any network.
            </p>
          )}
          <table class="table" hidden={dev.routes.length === 0}>
            <thead>
              <tr>
                <th>Destination</th>
                <th>Send to</th>
                {dev.bgp && <th>AS path</th>}
                {canRoute && <th />}
              </tr>
            </thead>
            <tbody>
              {[...dev.routes]
                .sort((a, b) => Number(b.prefix.split('/')[1]) - Number(a.prefix.split('/')[1]))
                .filter((r) => !(dev.bgp && r.source === 'connected' && r.prefix.endsWith('/30')))
                .map((r) => {
                  const flash = recentlyChanged(sim, (ev) => ev.type === 'route-change' && ev.device === dev.id && ev.prefix === r.prefix);
                  const evil = (!!r.asPath?.length && sim.rov(r.prefix, r.asPath[r.asPath.length - 1]) === 'invalid') || brokenRoute(sim, dev, r);
                  return (
                    <tr key={r.prefix + r.source} class={`${flash ? 'flash' : ''} ${evil ? 'dup' : ''}`}>
                      <td class="mono">{r.prefix === '0.0.0.0/0' ? 'everything else' : r.prefix}</td>
                      <td>{nextHopText(sim, dev, r, !!lab.map?.ports)}</td>
                      {dev.bgp && <td class="mono">{r.asPath?.length ? r.asPath.join(' → ') : r.source === 'connected' ? 'connected' : '(ours)'}</td>}
                      {canRoute && (
                        <td class="row-action">
                          {r.source === 'static' && (
                            <button class="btn tiny ghost" onClick={() => session.dispatch({ type: 'remove-route', device: dev.id, prefix: r.prefix })}>
                              Remove
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {canRoute && <RouteForm key={dev.id} session={session} dev={dev} />}
        </section>
  );
  return (
    <div class="inspector">
      <div class="insp-head">
        <div>
          <div class="insp-title">{dev.label}</div>
          <div class="insp-sub">
            {dev.web && dev.kind === 'host' ? 'Server' : KIND_TEXT[dev.kind]}
            {dev.bgp ? ` · Autonomous System ${dev.bgp.asn}` : ''}
            {dev.attacker ? ' · attacker' : ''}
          </div>
        </div>
        {unplugged && <span class="pill warn">no cable</span>}
        {dev.sniffing && <span class="pill bad">capturing</span>}
        {dev.forwarding && dev.kind === 'host' && <span class="pill bad">forwarding</span>}
        {dev.bgp?.validate && <span class="pill good">validating routes</span>}
      </div>
      {replaying && <div class="callout info small">You're looking at the replay. Choose Back to live (above the map) to see the network as it is now.</div>}
      {dev.notes?.map((n) => (
        <p class="insp-note">{n}</p>
      ))}

      {layer3 && ports}

      {dev.kind === 'router' && routing}

      {dev.kind === 'host' && (canGateway || lab.hostRoutes) && <GatewayField key={dev.id} session={session} dev={dev} edit={canGateway} />}

      {sections('settings')}

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
          {Object.keys(dev.macTable).length === 0 && (
            <p class="muted small">Empty. The switch fills this in as data arrives: it notes each sender's MAC address and the port it came in on.</p>
          )}
          <table class="table" hidden={Object.keys(dev.macTable).length === 0}>
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
                      {portName(port)}
                      {peer && <span class="muted"> to {sim.devices[peer.device].label}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {!layer3 && ports}

      {dev.kind === 'hub' && (
        <p class="insp-note">
          A hub (or open Wi-Fi) has no table. Every frame goes out to <strong>every</strong> device. Each device is trusted
          to ignore frames that aren't addressed to it.
        </p>
      )}

      {dev.kind !== 'router' && routing}

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
            {dev.web.https ? (
              <>
                Serves <strong>{dev.web.name}</strong> {dev.web.fake ? '(an impostor)' : 'and holds its HTTPS certificate'}.
              </>
            ) : (
              <>
                Serves the page <strong>{dev.web.title}</strong> over plain HTTP.
              </>
            )}
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

      {sections('end')}
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

/** One end of a cable the student can pick: a computer, a router port, or a switch (its next free port). */
interface CableEnd {
  key: string;
  device: string;
  port?: string;
  label: string;
}

function cableEnds(sim: Sim): CableEnd[] {
  const out: CableEnd[] = [];
  for (const d of Object.values(sim.devices)) {
    if (d.kind === 'switch' || d.kind === 'hub') {
      const free = d.ifaces.filter((i) => !i.linkId).length;
      if (free) out.push({ key: d.id, device: d.id, label: `${d.label} (${free} free port${free === 1 ? '' : 's'})` });
    } else if (d.ifaces.length === 1) {
      if (!d.ifaces[0].linkId) out.push({ key: d.id, device: d.id, port: d.ifaces[0].id, label: d.label });
    } else {
      for (const i of d.ifaces) if (!i.linkId) out.push({ key: `${d.id}/${i.id}`, device: d.id, port: i.id, label: `${d.label}, ${portName(i.id)}` });
    }
  }
  return out;
}

function endName(sim: Sim, end: { device: string; iface: string }): string {
  const d = sim.devices[end.device];
  return d.ifaces.length > 1 ? `${d.label} ${portName(end.iface)}` : d.label;
}

function CableTool({ session }: { session: LabSession }) {
  // Shows live network state: re-render whenever the network changes.
  void session.simRev.value;
  const sim = session.sim;
  const ends = cableEnds(sim);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const ea = ends.find((e) => e.key === a);
  const eb = ends.find((e) => e.key === b);
  const connect = () => {
    if (!ea || !eb) return setMsg({ tone: 'bad', text: 'Choose a device for each end of the cable.' });
    const r = checkCable(sim, ea.device, ea.port, eb.device, eb.port);
    if (!r.ok) return setMsg({ tone: 'bad', text: r.msg });
    session.dispatch({ type: 'cable', a: ea.device, aPort: ea.port, b: eb.device, bPort: eb.port });
    setA('');
    setB('');
    const link = sim.linkBetween(ea.device, eb.device);
    setMsg({ tone: 'good', text: link ? `Plugged in: ${endName(sim, link.a)} to ${endName(sim, link.b)}.` : 'Plugged in.' });
  };
  const pick = (set: (v: string) => void) => (e: Event) => {
    set((e.target as HTMLSelectElement).value);
    setMsg(null);
  };
  const links = Object.values(sim.links);
  return (
    <div class="tool-card">
      <div class="tool-title">
        <Icon name="cable" /> Cables
      </div>
      <p class="tool-desc">Drag from one device to another on the map to plug in a cable, or pick both ends here. No cable, no signal: this is the physical layer.</p>
      <div class="sentence">
        Plug
        <select value={a} onChange={pick(setA)} aria-label="First end of the cable">
          <option value="">choose…</option>
          {ends.map((e) => (
            <option key={e.key} value={e.key}>
              {e.label}
            </option>
          ))}
        </select>
        into
        <select value={b} onChange={pick(setB)} aria-label="Second end of the cable">
          <option value="">choose…</option>
          {ends
            .filter((e) => e.device !== ea?.device)
            .map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
        </select>
        <button class="btn" onClick={connect}>
          Connect
        </button>
      </div>
      <ToolMsg msg={msg} />
      <div class="small muted">Cables plugged in:</div>
      <ul class="tool-list">
        {links.map((l) => (
          <li key={l.id}>
            <span>
              {endName(sim, l.a)} <span class="muted">to</span> {endName(sim, l.b)}
            </span>
            <button
              class="btn tiny ghost"
              onClick={() => {
                session.dispatch({ type: 'unplug', device: l.a.device, iface: l.a.iface });
                setMsg({ tone: 'info', text: `Unplugged ${endName(sim, l.a)} from ${endName(sim, l.b)}.` });
              }}
            >
              Unplug
            </button>
          </li>
        ))}
        {links.length === 0 && <li class="muted">none yet</li>}
      </ul>
    </div>
  );
}

function PingTool({ session }: { session: LabSession }) {
  // Shows live network state: re-render whenever the network changes.
  void session.simRev.value;
  const sim = session.sim;
  const sources = Object.values(sim.devices).filter((d) => d.kind === 'host' || d.kind === 'router');
  const [from, setFrom] = useState(sources[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const send = (raw = to) => {
    const r = checkPing(sim, from, raw);
    if (!r.ok) return setMsg({ tone: 'bad', text: r.msg, suggest: r.suggest, onSuggest: r.suggest ? () => (setTo(r.suggest!), send(r.suggest!)) : undefined });
    setMsg(null);
    session.dispatch({ type: 'ping', device: from, ip: r.ip });
  };
  // This step's pings only: an old failure would look like a problem that's already fixed.
  const since = session.since;
  const recent = sim.events
    .filter((e): e is Extract<typeof e, { type: 'ping-sent' }> => e.type === 'ping-sent' && e.t >= since)
    .slice(-4)
    .reverse();
  const log = useRef<HTMLUListElement>(null);
  // The dock is short on a small laptop screen: bring the newest result into view, and again when its answer comes in.
  const newest = recent[0] && sim.events.find((e) => (e.type === 'ping-reply' || e.type === 'ping-fail') && e.seq === recent[0].seq);
  useLayoutEffect(() => log.current?.scrollIntoView({ block: 'nearest' }), [recent[0]?.seq, newest?.type]);
  return (
    <div class="tool-card">
      <div class="tool-title">
        <Icon name="ping" /> Ping
      </div>
      <p class="tool-desc">Send a tiny "Are you there?" packet. A reply means every cable, address, and route works, both there and back.</p>
      <div class="sentence">
        From
        <select value={from} onChange={(e) => (setFrom((e.target as HTMLSelectElement).value), setMsg(null))} aria-label="Device to ping from">
          {sources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        ping
        <input
          class={`mono ${msg?.tone === 'bad' ? 'invalid' : ''}`}
          value={to}
          placeholder="IP address"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          size={14}
          aria-label="IP address to ping"
          aria-invalid={msg?.tone === 'bad'}
          onInput={(e) => {
            setTo((e.target as HTMLInputElement).value);
            setMsg(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button class="btn" onClick={() => send()}>
          Ping
        </button>
      </div>
      <ToolMsg msg={msg} />
      {recent.length > 0 && (
        <ul class="ping-log" aria-live="polite" ref={log}>
          {recent.map((p) => {
            const end = sim.events.find((e) => (e.type === 'ping-reply' || e.type === 'ping-fail') && e.seq === p.seq);
            const tone = !end ? 'wait' : end.type === 'ping-reply' ? 'good' : 'bad';
            const text = !end
              ? 'Waiting for a reply…'
              : end.type === 'ping-reply'
                ? `Reply from ${sim.deviceByIp(end.from)?.label ?? end.from}.`
                : end.type === 'ping-fail'
                  ? pingFailText(sim, end)
                  : '';
            return (
              <li key={p.seq} class={tone}>
                <Icon name={tone === 'good' ? 'check' : tone === 'bad' ? 'x' : 'ping'} size={14} />
                <span>
                  <span class="mono">
                    {sim.devices[p.device]?.label} → {p.to}
                  </span>{' '}
                  {text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SettingsCard({ session, kinds, onSelect }: { session: LabSession; kinds: Set<string>; onSelect: (id: string) => void }) {
  const devices = Object.values(session.sim.devices).filter((d) => d.kind === 'host' || d.kind === 'router');
  return (
    <div class="tool-card">
      <div class="tool-title">
        <Icon name="sliders" /> Device settings
      </div>
      <p class="tool-desc">Click a device on the map. Change its settings in the Inspect tab:</p>
      <ul class="settings-list small">
        {kinds.has('ip-config') && (
          <li>
            <strong>IP addresses</strong> in the Addresses table
          </li>
        )}
        {kinds.has('gateway') && (
          <li>
            <strong>Default gateway</strong> on computers
          </li>
        )}
        {kinds.has('static-route') && (
          <li>
            <strong>Static routes</strong> under a router's routing table
          </li>
        )}
      </ul>
      <div class="device-buttons">
        {devices.map((d) => (
          <button key={d.id} class="btn tiny" onClick={() => onSelect(d.id)}>
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toolkit({ session, tools, onSelect }: { session: LabSession; tools: ToolSpec[]; onSelect: (id: string) => void }) {
  const sim = session.sim;
  const settingKinds = new Set<string>(tools.filter((t) => (SETTING_TOOLS as readonly string[]).includes(t.kind)).map((t) => t.kind));
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
          case 'cable':
            return <CableTool session={session} />;
          case 'ping':
            return <PingTool session={session} />;
          default: {
            const Card = TOOL_CARDS[t.kind] as ComponentType<ToolCardProps> | undefined;
            return Card ? <Card session={session} spec={t} onSelect={onSelect} /> : null;
          }
        }
      })}
      {settingKinds.size > 0 && <SettingsCard session={session} kinds={settingKinds} onSelect={onSelect} />}
    </div>
  );
}
