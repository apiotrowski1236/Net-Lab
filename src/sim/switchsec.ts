import type { Mac } from './addr';
import { burstMacs, burstSize } from './burst';
import type { Sim } from './sim';
import type { Device, DropReason, Frame } from './types';

/**
 * Switch security (built for `mac-flood`; reused by `smurf`, `net-audit`,
 * `segmentation`, and `logs`): a size limit on the MAC table, port security,
 * and shutting ports down.
 *
 * Everything here is opt-in. A switch behaves exactly as before until a lab
 * calls `sim.configureSwitch(id, { tableSize })`, which gives it a
 * `Device.switchSec`. From then on the switch:
 *
 *  - holds at most `tableSize` MAC table entries. When the table is full, the
 *    oldest entry is pushed out to make room for each new address. (Real
 *    switches stop learning and let old entries expire after a few minutes.
 *    The result is the same: real devices drop out of the table, and frames
 *    for them get flooded out every port.)
 *  - counts the frames that come in each port (a burst counts as its full size).
 *  - logs like a real switch: links going up and down, a full table, port
 *    security violations. Log sources: 'link', 'mac-table', 'port-security'.
 *  - applies each port's settings: shut down (by an admin, or by port
 *    security), and port security (most MACs allowed, an allowed list for MAC
 *    filtering, what to do on a violation).
 *
 * Sim methods: configureSwitch, setPortSecurity, setPortShutdown. Read state
 * with `portUp`, `macTableUse`, and `macsOnPort`.
 */

export interface PortSecurityConfig {
  /** Most MAC addresses that may use this port. The first ones seen are accepted. */
  maxMacs: number;
  /**
   * What happens when another MAC shows up:
   *  - 'shutdown': the port turns off (err-disabled) until an admin turns it back on.
   *  - 'restrict': the port drops that MAC's frames, counts them, and logs it.
   */
  violation: 'shutdown' | 'restrict';
  /** MAC filtering: only these MACs may use the port. Missing or empty: any MACs, up to maxMacs. */
  allowed?: Mac[];
  /** Keep learned MACs when the cable is unplugged (Cisco's "sticky" addresses). Otherwise they're forgotten. */
  sticky?: boolean;
}

export interface PortSecurity extends PortSecurityConfig {
  /** MACs this port has accepted so far (up to maxMacs). */
  learned: Mac[];
  /** Frames dropped as violations since port security was turned on. */
  violations: number;
}

export interface SwitchPort {
  /** Why the port is off: an admin shut it down, or port security did (err-disabled). Missing: on. */
  shutdown?: 'admin' | 'violation';
  security?: PortSecurity;
  /** Frames that came in this port. A burst counts as its full size. */
  framesIn: number;
  /** The port's VLAN (segmentation, see vlan.ts). Missing: VLAN 1. */
  vlan?: number;
}

/** A switch's security state. `Device.switchSec`. */
export interface SwitchSec {
  /** Most entries the MAC table holds. Missing: no limit. */
  tableSize?: number;
  /** Per port, by interface id ("p7"). Created as needed. */
  ports: Record<string, SwitchPort>;
}

/** "p7" reads as "port 7" in log lines. */
export function portLabel(ifaceId: string): string {
  const m = /^p(\d+)$/.exec(ifaceId);
  return m ? `port ${m[1]}` : ifaceId;
}

/** A port's state, created on first use. Only for switches with `switchSec`. */
export function portState(dev: Device, port: string): SwitchPort {
  const sec = dev.switchSec!;
  return (sec.ports[port] ??= { framesIn: 0 });
}

/** The port can carry frames: it isn't shut down. True for every port of a switch without `switchSec`. */
export function portUp(dev: Device, port: string): boolean {
  return !dev.switchSec?.ports[port]?.shutdown;
}

/** How full the MAC table is. */
export function macTableUse(dev: Device): { used: number; size?: number } {
  return { used: Object.keys(dev.macTable).length, size: dev.switchSec?.tableSize };
}

/** The MAC addresses the switch has learned on one port. */
export function macsOnPort(dev: Device, port: string): Mac[] {
  return Object.entries(dev.macTable)
    .filter(([, p]) => p === port)
    .map(([mac]) => mac);
}

/** Forget every MAC learned on a port (its link went down, or it was shut). */
function flushPort(dev: Device, port: string): void {
  for (const [mac, p] of Object.entries(dev.macTable)) if (p === port) delete dev.macTable[mac];
}

/** Does port security let `mac` use this port? Accepts (and remembers) new MACs up to the limit. */
function admit(ps: PortSecurity, mac: Mac): boolean {
  if (ps.allowed?.length) return ps.allowed.includes(mac);
  if (ps.learned.includes(mac)) return true;
  if (ps.learned.length < ps.maxMacs) {
    ps.learned.push(mac);
    return true;
  }
  return false;
}

/**
 * Learn source MACs on a port, keeping to the table's size: when it's full,
 * the oldest entry goes. One event per frame (several MACs from a burst get
 * one 'mac-learn' event with a count). Logs when the table overflows.
 */
function learn(sim: Sim, dev: Device, port: string, macs: Mac[], burst: boolean): void {
  const table = dev.macTable;
  const size = dev.switchSec?.tableSize;
  let used = size ? Object.keys(table).length : 0;
  const evicted: Mac[] = [];
  const fresh: Mac[] = [];
  for (const mac of macs) {
    const cur = table[mac];
    if (cur === port) continue;
    if (cur === undefined && size && used >= size) {
      // Object keys keep insertion order: the first one is the oldest entry.
      for (const oldest in table) {
        delete table[oldest];
        evicted.push(oldest);
        used--;
        break;
      }
    }
    if (cur === undefined) used++;
    table[mac] = port;
    fresh.push(mac);
    if (!burst) sim.emit({ t: sim.t, type: 'mac-learn', device: dev.id, mac, iface: port });
  }
  if (burst && fresh.length) sim.emit({ t: sim.t, type: 'mac-learn', device: dev.id, mac: fresh[0], iface: port, count: fresh.length });
  if (!evicted.length || !size) return;
  sim.emit({ t: sim.t, type: 'mac-overflow', device: dev.id, iface: port, learned: fresh.length, evicted });
  const n = fresh.length;
  sim.log(dev.id, {
    source: 'mac-table',
    level: 'warn',
    msg: `%SW_MATM-4-TABLE_FULL: MAC address table full (${size}/${size}). Removed ${evicted.length} oldest ${evicted.length === 1 ? 'entry' : 'entries'} to learn ${n} new ${n === 1 ? 'address' : 'addresses'} on ${portLabel(port)}`,
    fields: { port, count: n, evicted: evicted.length, size },
  });
}

/** Port security turns a port off (err-disabled), like a real switch. */
function errDisable(sim: Sim, dev: Device, port: string, mac: Mac): void {
  const p = portState(dev, port);
  p.shutdown = 'violation';
  if (p.security) p.security.violations++;
  flushPort(dev, port);
  const where = portLabel(port);
  sim.log(dev.id, {
    source: 'port-security',
    level: 'warn',
    msg: `%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${mac} on ${where}`,
    fields: { port, mac, action: 'shutdown' },
  });
  sim.log(dev.id, {
    source: 'port-security',
    level: 'warn',
    msg: `%PM-4-ERR_DISABLE: psecure-violation error detected on ${where}, putting ${where} in err-disable state`,
    fields: { port, action: 'shutdown' },
  });
  sim.emit({ t: sim.t, type: 'port-security', device: dev.id, iface: port, mac, action: 'shutdown', count: 1 });
}

/**
 * A switch takes in a frame on `port`: the port's state, port security, and
 * learning the source MACs (within the table's size). Returns why the frame
 * is dropped, or null to forward it. In 'restrict' mode a burst loses the
 * copies port security refused (its count shrinks).
 *
 * Switches without `switchSec` only learn, exactly as before.
 */
export function switchIngress(sim: Sim, dev: Device, port: string, frame: Frame): DropReason | null {
  const sec = dev.switchSec;
  const isBurst = !!frame.burst && frame.burst.vary === 'src-mac';
  const macs = isBurst ? burstMacs(frame) : [frame.src];
  if (!sec) {
    learn(sim, dev, port, macs, isBurst);
    return null;
  }
  const p = portState(dev, port);
  if (p.shutdown) return 'port-shutdown';
  p.framesIn += burstSize(frame);
  const ps = p.security;
  if (!ps) {
    learn(sim, dev, port, macs, isBurst);
    return null;
  }
  const ok: Mac[] = [];
  const refused: Mac[] = [];
  for (const mac of macs) {
    if (admit(ps, mac)) ok.push(mac);
    else if (ps.violation === 'shutdown') {
      // Whatever this frame taught the switch goes with the port.
      errDisable(sim, dev, port, mac);
      return 'port-security';
    } else refused.push(mac);
  }
  learn(sim, dev, port, ok, isBurst);
  if (!refused.length) return null;
  ps.violations += refused.length;
  const n = refused.length;
  sim.log(dev.id, {
    source: 'port-security',
    level: 'warn',
    msg: `%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${refused[0]} on ${portLabel(port)}${n > 1 ? ` (and ${n - 1} more)` : ''}. Dropped ${n} ${n === 1 ? 'frame' : 'frames'}`,
    fields: { port, mac: refused[0], action: 'restrict', count: n },
  });
  sim.emit({ t: sim.t, type: 'port-security', device: dev.id, iface: port, mac: refused[0], action: 'restrict', count: n });
  if (!ok.length) return 'port-security';
  if (frame.burst) {
    if (ok.length === 1) {
      delete frame.burst;
      frame.src = ok[0];
    } else frame.burst.count = ok.length;
  }
  return null;
}

/** Hook: a cable was plugged into (or pulled from) a switch port. Logs it; a link going down forgets learned secure MACs. */
export function switchLinkChanged(sim: Sim, devId: string, port: string, up: boolean): void {
  const dev = sim.devices[devId];
  if (!dev?.switchSec) return;
  const p = portState(dev, port);
  if (!up && p.security && !p.security.sticky) p.security.learned = [];
  // A port that's shut down has no link either way.
  if (p.shutdown) return;
  const where = portLabel(port);
  sim.log(dev.id, {
    source: 'link',
    level: up ? 'notice' : 'warn',
    msg: `%LINK-3-UPDOWN: Interface ${where}, changed state to ${up ? 'up' : 'down'}`,
    fields: { port, state: up ? 'up' : 'down' },
  });
}

/** Turn a switch's security features on. See Sim.configureSwitch. */
export function configureSwitch(dev: Device, opts: { tableSize?: number }): void {
  if (dev.kind !== 'switch') throw new Error(`${dev.id} is not a switch`);
  dev.switchSec ??= { ports: {} };
  dev.switchSec.tableSize = opts.tableSize;
}

/**
 * Turn port security on (or off, with null). The port starts by accepting
 * the MACs it already knows, up to the limit (or those on the allowed list).
 */
export function applyPortSecurity(sim: Sim, dev: Device, port: string, cfg: PortSecurityConfig | null): void {
  if (!dev.switchSec) throw new Error(`${dev.id} has no switch security. Call sim.configureSwitch first.`);
  const p = portState(dev, port);
  if (!cfg) {
    delete p.security;
    sim.emit({ t: sim.t, type: 'config', device: dev.id, what: 'port-security', on: false, detail: port });
    return;
  }
  const allowed = cfg.allowed?.length ? [...cfg.allowed] : undefined;
  const known = macsOnPort(dev, port).filter((m) => !allowed || allowed.includes(m));
  const keep = p.security?.sticky && cfg.sticky ? p.security.learned : [];
  const learned = [...new Set([...keep, ...known])].slice(0, Math.max(0, cfg.maxMacs));
  p.security = { maxMacs: cfg.maxMacs, violation: cfg.violation, allowed, sticky: cfg.sticky || undefined, learned, violations: 0 };
  // MACs the port no longer accepts leave the table.
  for (const m of macsOnPort(dev, port)) if (!learned.includes(m) && !allowed?.includes(m)) delete dev.macTable[m];
  const what = allowed ? `only ${allowed.join(', ')}` : `at most ${cfg.maxMacs} MAC${cfg.maxMacs === 1 ? '' : 's'}`;
  sim.emit({ t: sim.t, type: 'config', device: dev.id, what: 'port-security', on: true, detail: `${port}: ${what}, ${cfg.violation}` });
}

/** Shut a port down (or turn it back on, which also clears an err-disabled port). */
export function applyPortShutdown(sim: Sim, dev: Device, port: string, shut: boolean): void {
  if (!dev.switchSec) throw new Error(`${dev.id} has no switch security. Call sim.configureSwitch first.`);
  const p = portState(dev, port);
  const where = portLabel(port);
  const cabled = !!dev.ifaces.find((i) => i.id === port)?.linkId;
  if (shut) {
    if (p.shutdown === 'admin') return;
    p.shutdown = 'admin';
    flushPort(dev, port);
    sim.log(dev.id, {
      source: 'link',
      level: 'notice',
      msg: `%LINK-5-CHANGED: Interface ${where}, changed state to administratively down`,
      fields: { port, state: 'admin-down' },
    });
  } else {
    if (!p.shutdown) return;
    delete p.shutdown;
    if (p.security && !p.security.sticky) p.security.learned = [];
    sim.log(dev.id, {
      source: 'link',
      level: 'notice',
      msg: `%LINK-3-UPDOWN: Interface ${where}, changed state to ${cabled ? 'up' : 'down'}`,
      fields: { port, state: cabled ? 'up' : 'down' },
    });
  }
  sim.emit({ t: sim.t, type: 'config', device: dev.id, what: 'port', on: !shut, detail: port });
}
