import type { Mac } from '../sim/addr';
import type { Sim } from '../sim/sim';
import type { PortSecurityConfig } from '../sim/switchsec';
import { normalizeMac, type Checked } from './toolInput';

/**
 * Input checks for the switch-security tools (mac-flood): changing a MAC and
 * port security settings. The tool cards and the answer key both use these,
 * so the answer key can only type what a student could.
 */

const MAC_FORMAT = 'Type a MAC address: six pairs of letters and digits (0 to 9, a to f) with colons between them.';

/** A MAC a network card can use: unicast, not all zeros. */
function cardMac(raw: string, field: string): Checked<{ mac: Mac }> {
  const mac = normalizeMac(raw);
  if (!mac) return { ok: false, msg: MAC_FORMAT, field };
  if (mac === '00:00:00:00:00:00') return { ok: false, msg: 'All zeros is not a real MAC address.', field };
  if (parseInt(mac.slice(0, 2), 16) & 1) {
    return {
      ok: false,
      msg: `${mac} is a group (broadcast or multicast) address. A network card's own MAC has an even first pair, like 0a or 3c.`,
      field,
    };
  }
  return { ok: true, mac };
}

/** MAC changer: the new MAC for a device's network card. */
export function checkNewMac(sim: Sim, deviceId: string, raw: string): Checked<{ mac: Mac }> {
  const r = cardMac(raw, 'mac');
  if (!r.ok) return r;
  const dev = sim.dev(deviceId);
  if (dev.ifaces[0]?.mac === r.mac) return { ok: false, msg: `${dev.label} already uses ${r.mac}.`, field: 'mac' };
  return r;
}

/** Port security form: most MACs, what to do on a violation, and an optional allowed list (any separators). */
export function checkPortSecurity(
  sim: Sim,
  switchId: string,
  port: string,
  rawMax: string,
  violation: PortSecurityConfig['violation'],
  rawAllowed: string,
): Checked<{ config: PortSecurityConfig }> {
  const dev = sim.dev(switchId);
  if (dev.kind !== 'switch' || !dev.switchSec) return { ok: false, msg: `${dev.label} has no port security.` };
  if (!dev.ifaces.some((i) => i.id === port)) return { ok: false, msg: `${dev.label} has no port ${port}.` };
  const max = Number(rawMax.trim());
  if (!/^\d+$/.test(rawMax.trim()) || max < 1 || max > 64) {
    return { ok: false, msg: 'Most MACs must be a whole number from 1 to 64.', field: 'max' };
  }
  const allowed: Mac[] = [];
  for (const part of rawAllowed.split(/[\s,;]+/).filter(Boolean)) {
    const r = cardMac(part, 'allowed');
    if (!r.ok) return { ...r, msg: `"${part}": ${r.msg}` };
    if (!allowed.includes(r.mac)) allowed.push(r.mac);
  }
  if (allowed.length > max) {
    return { ok: false, msg: `You listed ${allowed.length} allowed MACs but set most MACs to ${max}. Raise most MACs or list fewer.`, field: 'max' };
  }
  return { ok: true, config: { maxMacs: max, violation, ...(allowed.length ? { allowed } : {}) } };
}
