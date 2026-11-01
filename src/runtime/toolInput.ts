import { isIp, isPrefix, networkOf, normalizePrefix, prefixContains, prefixLen, sameSubnet, type Ip, type Mac } from '../sim/addr';
import type { Sim } from '../sim/sim';
import type { Device, Iface } from '../sim/types';

// Checks for what students type into the Toolkit. Each returns either the
// cleaned-up value or a short message that says what's wrong and where to look.

export type Checked<T> = ({ ok: true } & T) | { ok: false; msg: string; suggest?: string };

const IP_FORMAT = 'Type an IP address: four numbers from 0 to 255 with dots between them.';
const MAC_FORMAT = 'Type a MAC address: six pairs of letters and digits (0 to 9, a to f) with colons between them.';

/** Accepts "0A-11-CE-00-00-10", "0a11.ce00.0010", and similar. Returns lowercase with colons. */
export function normalizeMac(raw: string): Mac | null {
  const hex = raw.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12 || !/^[0-9a-f:\-.\s]+$/i.test(raw.trim())) return null;
  return hex.match(/../g)!.join(':');
}

/** The local network an interface sits on, for example "192.168.1.0/24". */
function lanOf(i: Iface): string | undefined {
  return i.ip && i.prefix !== undefined ? networkOf(i.ip, i.prefix) : undefined;
}

/** Which device and interface on the same local network as `me` use `ip`. */
function ownerOnLan(sim: Sim, me: Iface, ip: Ip): { dev: Device; iface: Iface } | undefined {
  for (const dev of Object.values(sim.devices)) {
    for (const iface of dev.ifaces) {
      if (iface.ip === ip && me.prefix !== undefined && sameSubnet(ip, me.ip!, me.prefix)) return { dev, iface };
    }
  }
  return undefined;
}

function lanIface(dev: Device): Iface {
  return dev.ifaces.find((i) => i.ip) ?? dev.ifaces[0];
}

/** ARP spoofer: the address the attacker claims to own. */
export function checkSpoofClaim(sim: Sim, attackerId: string, victimId: string, raw: string): Checked<{ ip: Ip }> {
  const ip = raw.trim();
  if (!ip) return { ok: false, msg: 'Type the IP address you want to claim.' };
  if (!isIp(ip)) return { ok: false, msg: IP_FORMAT };
  const att = sim.dev(attackerId);
  const me = lanIface(att);
  const victim = sim.dev(victimId);
  if (me.prefix === undefined || !sameSubnet(ip, me.ip!, me.prefix)) {
    return { ok: false, msg: `ARP works only inside one local network. ${ip} is not on this network (${lanOf(me)}).` };
  }
  if (ip === me.ip) return { ok: false, msg: `${ip} is already ${att.label}'s own address. Type the address of the device you want to pretend to be.` };
  if (victim.ifaces.some((i) => i.ip === ip)) {
    return { ok: false, msg: `${ip} is ${victim.label}'s own address. Claim an address that ${victim.label} sends traffic to.` };
  }
  if (!ownerOnLan(sim, me, ip)) return { ok: false, msg: `No device on this network uses ${ip}. Open the map and find the address you want to pretend to be.` };
  return { ok: true, ip };
}

/** Route announcer: a CIDR prefix. Suggests the network address when host bits are set. */
export function checkPrefix(sim: Sim, deviceId: string, raw: string): Checked<{ prefix: string }> {
  const p = raw.trim().replace(/\s+/g, '');
  if (!p) return { ok: false, msg: 'Type a prefix to announce, like 10.20.0.0/16.' };
  if (isIp(p)) return { ok: false, msg: `Add a prefix length after a slash. For example, ${p}/24 means every address that starts with the first three numbers.` };
  if (!isPrefix(p)) return { ok: false, msg: 'Type a prefix: an IP address, a slash, and a length from 8 to 32. For example, 10.20.0.0/16.' };
  if (prefixLen(p) < 8) return { ok: false, msg: 'That prefix covers more addresses than any one network owns. Use a length of /8 or longer.' };
  const norm = normalizePrefix(p);
  if (norm !== p) {
    return {
      ok: false,
      msg: `A prefix starts at the first address of its block. Did you mean ${norm}?`,
      suggest: norm,
    };
  }
  if (sim.dev(deviceId).bgp?.origins.includes(norm)) return { ok: false, msg: `${sim.dev(deviceId).label} already announces ${norm}.` };
  return { ok: true, prefix: norm };
}

/** Whether a prefix the student typed contains the address they're after. */
export function covers(prefix: string, ip: Ip): boolean {
  return prefixContains(prefix, ip);
}

/** Static ARP: the IP address and the correct MAC for it. */
export function checkStaticArp(sim: Sim, deviceId: string, rawIp: string, rawMac: string): Checked<{ ip: Ip; mac: Mac }> {
  const ip = rawIp.trim();
  const dev = sim.dev(deviceId);
  const me = lanIface(dev);
  if (!ip) return { ok: false, msg: 'Type the IP address to lock.' };
  if (!isIp(ip)) return { ok: false, msg: IP_FORMAT };
  if (me.prefix === undefined || !sameSubnet(ip, me.ip!, me.prefix)) {
    return { ok: false, msg: `ARP entries are only for this local network (${lanOf(me)}). ${ip} is not on it.` };
  }
  if (ip === me.ip) return { ok: false, msg: `${ip} is ${dev.label}'s own address. Lock the address of a device ${dev.label} talks to.` };
  const owner = ownerOnLan(sim, me, ip);
  if (!owner) return { ok: false, msg: `No device on this network uses ${ip}.` };
  if (!rawMac.trim()) return { ok: false, msg: `Type ${owner.dev.label}'s MAC address.` };
  const mac = normalizeMac(rawMac);
  if (!mac) return { ok: false, msg: MAC_FORMAT };
  if (mac === owner.iface.mac) {
    const cur = dev.arp[ip];
    if (cur?.via === 'static' && cur.mac === mac) return { ok: false, msg: `${ip} is already locked to ${mac}.` };
    return { ok: true, ip, mac };
  }
  const holder = Object.values(sim.devices).find((d) => d.ifaces.some((i) => i.mac === mac));
  if (!holder) return { ok: false, msg: `No device on this network has the MAC address ${mac}. Open ${owner.dev.label} on the map and copy its MAC address carefully.` };
  if (holder.id === owner.dev.id) {
    return { ok: false, msg: `That MAC belongs to another port on ${owner.dev.label}. Use the MAC address on the port with IP address ${ip}.` };
  }
  if (holder.attacker) {
    return {
      ok: false,
      msg: `${mac} is ${holder.label}'s MAC, the one from the forged ARP replies. Locking it in would keep ${dev.label} poisoned for good. Open ${owner.dev.label} on the map to find its real MAC.`,
    };
  }
  return { ok: false, msg: `${mac} belongs to ${holder.label}, not ${owner.dev.label}. Open ${owner.dev.label} on the map to find its MAC address.` };
}
