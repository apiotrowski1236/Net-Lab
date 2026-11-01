import type { Sim } from './sim';
import { portState } from './switchsec';
import type { Device } from './types';

/**
 * VLANs on switch ports (built for `segmentation`).
 *
 * A VLAN is a group of switch ports that act like a switch of their own. A
 * frame that comes in a port in VLAN v leaves only through other ports in
 * VLAN v: broadcasts, frames flooded to an unknown MAC, and frames to a known
 * MAC alike. If the MAC table points at a port in another VLAN, the switch
 * treats the MAC as unknown and floods inside v (where that device can't hear it).
 *
 * The VLAN is part of a switch port's state, beside the port's shutdown and
 * port security settings: `SwitchPort.vlan` in switchsec.ts. Missing means
 * VLAN 1, where every port starts. So a switch needs `sim.configureSwitch`
 * before its ports can change VLAN. Shut ports still drop everything,
 * whatever their VLAN.
 *
 * Sim method: setVlan. Read state with `vlanOf` and `sameVlan`.
 */

export const DEFAULT_VLAN = 1;

/** A switch port's VLAN. 1 for every port of a device without switch security, and for hubs. */
export function vlanOf(dev: Device, port: string): number {
  return dev.switchSec?.ports[port]?.vlan ?? DEFAULT_VLAN;
}

/** Can a frame that came in `inPort` leave through `outPort`? Always true off switches and on switches with no VLANs set. */
export function sameVlan(dev: Device, inPort: string, outPort: string): boolean {
  if (dev.kind !== 'switch') return true;
  return vlanOf(dev, inPort) === vlanOf(dev, outPort);
}

/** Every VLAN number in use on a switch, ascending (1 included when any port is still in it). */
export function vlansInUse(dev: Device): number[] {
  return [...new Set(dev.ifaces.map((i) => vlanOf(dev, i.id)))].sort((a, b) => a - b);
}

/** Put a switch port in a VLAN. See Sim.setVlan. */
export function applyVlan(sim: Sim, dev: Device, port: string, vlan: number): void {
  if (dev.kind !== 'switch') throw new Error(`${dev.id} is not a switch`);
  if (!dev.switchSec) throw new Error(`${dev.id} has no switch security. Call sim.configureSwitch first.`);
  if (!dev.ifaces.some((i) => i.id === port)) throw new Error(`${dev.id} has no port ${port}`);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) throw new Error(`VLAN ${vlan} is not a number from 1 to 4094`);
  const p = portState(dev, port);
  if ((p.vlan ?? DEFAULT_VLAN) === vlan) return;
  if (vlan === DEFAULT_VLAN) delete p.vlan;
  else p.vlan = vlan;
  // What the switch learned on this port belonged to the old VLAN.
  for (const [mac, at] of Object.entries(dev.macTable)) if (at === port) delete dev.macTable[mac];
  sim.emit({ t: sim.t, type: 'config', device: dev.id, what: 'vlan', detail: `${port}=${vlan}` });
}
