import { intToIp, ipToInt, isIp, isPrefix, maskBits, networkOf, normalizePrefix, prefixContains, prefixLen, sameSubnet, type Ip, type Mac } from '../sim/addr';
import type { Sim } from '../sim/sim';
import type { Device, Iface } from '../sim/types';
import { passphraseStrength, STRONG_PASSPHRASE_LEN } from '../sim/wifi';

// Checks for what students type into the Toolkit. Each returns either the
// cleaned-up value or a short message that says what's wrong and where to look.

/** A failed check can name the input at fault (`field`), so the form outlines only that one. */
export type Checked<T> = ({ ok: true } & T) | { ok: false; msg: string; suggest?: string; field?: string };

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

// ---------------------------------------------------------------------------
// Building a network: cables, addresses, gateways, routes, and ping
// ---------------------------------------------------------------------------

/** "p1" reads as "port 1". Other port names stay as they are. */
export function portName(ifaceId: string): string {
  const m = /^p(\d+)$/.exec(ifaceId);
  return m ? `port ${m[1]}` : ifaceId;
}

/** Every computer or router port reachable from this port without passing through a router (the same local network). */
export function segmentIfaces(sim: Sim, deviceId: string, ifaceId: string): { dev: Device; iface: Iface }[] {
  const out: { dev: Device; iface: Iface }[] = [];
  const seen = new Set<string>();
  const visit = (devId: string, portId: string) => {
    const peer = sim.peer(devId, portId);
    if (!peer) return;
    const next = sim.dev(peer.device);
    if (next.kind === 'switch' || next.kind === 'hub') {
      if (seen.has(next.id)) return;
      seen.add(next.id);
      for (const p of next.ifaces) if (p.id !== peer.iface && p.linkId) visit(next.id, p.id);
      return;
    }
    const iface = next.ifaces.find((i) => i.id === peer.iface);
    if (iface) out.push({ dev: next, iface });
  };
  visit(deviceId, ifaceId);
  return out;
}

function ownerOf(sim: Sim, ip: Ip): { dev: Device; iface: Iface } | undefined {
  for (const dev of Object.values(sim.devices)) {
    const iface = dev.ifaces.find((i) => i.ip === ip);
    if (iface) return { dev, iface };
  }
  return undefined;
}

const CIDR_FORMAT = 'Type an IP address and a prefix length, like 192.168.10.11/24: four numbers from 0 to 255 with dots between them, a slash, and the length.';

/** Cable tool: two devices, each with a port (or the first free one). */
export function checkCable(sim: Sim, a: string, aPort: string | undefined, b: string, bPort: string | undefined): Checked<object> {
  if (!a || !b) return { ok: false, msg: 'Choose a device for each end of the cable.' };
  if (a === b) return { ok: false, msg: 'A cable connects two different devices.' };
  const A = sim.dev(a);
  const B = sim.dev(b);
  if (sim.linkBetween(a, b)) return { ok: false, msg: `${A.label} and ${B.label} are already connected.` };
  for (const [dev, port] of [
    [A, aPort],
    [B, bPort],
  ] as const) {
    if (port) {
      const iface = dev.ifaces.find((i) => i.id === port);
      if (!iface) return { ok: false, msg: `${dev.label} has no ${portName(port)}.` };
      if (iface.linkId) return { ok: false, msg: `${dev.label} ${portName(port)} already has a cable. Unplug it first, or pick another port.` };
    } else if (!sim.freePort(dev.id)) {
      return { ok: false, msg: `${dev.label} has no free port. Unplug one of its cables first.` };
    }
  }
  return { ok: true };
}

/**
 * IP settings: an address with its prefix length. An empty box removes the
 * address. `note` is a heads-up that doesn't block saving.
 */
export function checkAddress(
  sim: Sim,
  deviceId: string,
  ifaceId: string,
  raw: string,
  fixed?: { device: string; cidr: string; why: string }[],
): Checked<{ cidr: string | null; note?: string }> {
  const dev = sim.dev(deviceId);
  const iface = dev.ifaces.find((i) => i.id === ifaceId);
  if (!iface) return { ok: false, msg: `${dev.label} has no ${portName(ifaceId)}.` };
  const where = dev.ifaces.length > 1 ? `${dev.label} ${portName(ifaceId)}` : dev.label;
  const text = raw.trim().replace(/\s+/g, '');
  if (!text) {
    if (iface.ip) return { ok: true, cidr: null };
    return { ok: false, msg: 'Type an IP address and a prefix length, like 192.168.10.11/24.' };
  }
  if (isIp(text)) {
    return { ok: false, msg: `Add the prefix length after a slash. ${text}/24 means the first three numbers are the network part.`, suggest: `${text}/24` };
  }
  if (!isPrefix(text)) return { ok: false, msg: CIDR_FORMAT };
  const [ip, l] = text.split('/');
  const len = Number(l);
  if (len < 8 || len > 30) return { ok: false, msg: 'Use a prefix length from /8 to /30, like /24.' };
  const pin = fixed?.find((f) => f.device === deviceId);
  if (pin && text !== pin.cidr) return { ok: false, msg: pin.why, suggest: pin.cidr };
  if (iface.ip === ip && iface.prefix === len) return { ok: false, msg: `${where} already has ${text}.` };
  const net = networkOf(ip, len);
  const first = net.split('/')[0];
  if (ip === first) {
    return { ok: false, msg: `${ip} is the address of the network itself (${net}). No device can use it. Pick a number after it.` };
  }
  const broadcast = intToIp((ipToInt(first) | (~maskBits(len) >>> 0)) >>> 0);
  if (ip === broadcast) {
    return { ok: false, msg: `${ip} is the broadcast address for ${net}. A message sent there goes to every device on the network, so no one device can use it.` };
  }
  const taken = ownerOf(sim, ip);
  if (taken && !(taken.dev.id === deviceId && taken.iface.id === ifaceId)) {
    return {
      ok: false,
      msg:
        taken.dev.id === deviceId
          ? `${dev.label} already uses ${ip} on ${portName(taken.iface.id)}. To move it, clear ${portName(taken.iface.id)}'s box and press Save first.`
          : `${taken.dev.label} already uses ${ip}. Every device on a network needs its own address.`,
    };
  }
  const twin = dev.ifaces.find((i) => i.id !== ifaceId && i.ip && i.prefix !== undefined && sameSubnet(i.ip, ip, Math.min(i.prefix, len)));
  if (twin) {
    return {
      ok: false,
      msg: `${dev.label} ${portName(twin.id)} is already on ${networkOf(twin.ip!, twin.prefix!)}. Each port of a router connects to a different network.`,
    };
  }
  const off = segmentIfaces(sim, deviceId, ifaceId).find((n) => n.iface.ip && n.iface.prefix !== undefined && networkOf(n.iface.ip, n.iface.prefix) !== net);
  // An address on a port with no cable saves fine, but nothing can reach it: say so now, not after a failed ping.
  const cabled = dev.ifaces.find((i) => i.id !== ifaceId && i.linkId && !i.ip);
  const peer = cabled && sim.peer(deviceId, cabled.id);
  const unplugged = iface.linkId
    ? undefined
    : `Heads up: ${dev.ifaces.length > 1 ? portName(ifaceId) : dev.label} has no cable, so nothing can reach this address yet.${
        peer ? ` The cable to ${sim.devices[peer.device]?.label ?? peer.device} is in ${portName(cabled!.id)}.` : ''
      }`;
  const note = off
    ? `Heads up: ${off.dev.label} shares this local network but uses ${networkOf(off.iface.ip!, off.iface.prefix!)}, and this address is on ${net}. Devices on one local network need the same network part, or they can't talk directly.`
    : unplugged;
  return { ok: true, cidr: `${ip}/${len}`, note };
}

/** Default gateway: the router address a computer sends other networks' traffic to. Empty removes it. */
export function checkGateway(sim: Sim, deviceId: string, raw: string): Checked<{ ip: Ip | null }> {
  const dev = sim.dev(deviceId);
  const name = dev.label;
  const ip = raw.trim();
  if (!ip) {
    if (dev.gateway) return { ok: true, ip: null };
    return { ok: false, msg: `Type the IP address of the router ${name} should send other networks' traffic to.` };
  }
  if (ip.includes('/')) {
    const bare = ip.split('/')[0];
    return { ok: false, msg: "A gateway is one address, with no slash. Type just the router's IP address.", suggest: isIp(bare) ? bare : undefined };
  }
  if (!isIp(ip)) return { ok: false, msg: IP_FORMAT };
  const me = dev.ifaces.find((i) => i.ip && i.prefix !== undefined);
  if (!me) return { ok: false, msg: `Give ${name} an IP address first. The gateway has to be on ${name}'s own network.` };
  const net = networkOf(me.ip!, me.prefix!);
  if (ip === me.ip) return { ok: false, msg: `${ip} is ${name}'s own address. The gateway is the router that leads off this network.` };
  const owner = ownerOf(sim, ip);
  if (!sameSubnet(ip, me.ip!, me.prefix!)) {
    // No router on the computer's network, but the typed address is a router's: the computer's own address is what's off.
    const routerHere = Object.values(sim.devices).some(
      (d) => d.kind === 'router' && d.ifaces.some((i) => i.ip && sameSubnet(i.ip, me.ip!, me.prefix!)),
    );
    if (owner?.dev.kind === 'router' && !routerHere) {
      return {
        ok: false,
        msg: `${ip} is ${owner.dev.label}'s address, on ${networkOf(ip, owner.iface.prefix ?? me.prefix!)}. But ${name}'s own address, ${me.ip}/${me.prefix}, puts ${name} on ${net}, where no router has an address. Check ${name}'s IP address first.`,
      };
    }
    return { ok: false, msg: `The gateway has to be on ${name}'s own network, ${net}. ${ip} is not on it. Use the router's address on ${name}'s network.` };
  }
  if (!owner) {
    const routerHere = Object.values(sim.devices).some((d) => d.kind === 'router' && d.ifaces.some((i) => i.ip && sameSubnet(i.ip, me.ip!, me.prefix!)));
    if (!routerHere) {
      return { ok: false, msg: `No router has an address on ${net}, ${name}'s network, so no gateway there can work. Check ${name}'s IP address first. If it's right, give the router a port on ${net}.` };
    }
    return { ok: false, msg: `No device on ${net} uses ${ip}. Click the router on the map to find its address on this network.` };
  }
  if (owner.dev.kind !== 'router') {
    return { ok: false, msg: `${ip} is ${owner.dev.label}, a computer, not a router. It won't pass ${name}'s packets on to other networks.` };
  }
  if (dev.gateway === ip) return { ok: false, msg: `${name}'s gateway is already ${ip}.` };
  return { ok: true, ip };
}

/** Static route: a destination network and the neighbor router (next hop) to hand its packets to. */
export function checkRoute(sim: Sim, deviceId: string, rawPrefix: string, rawVia: string): Checked<{ prefix: string; via: Ip; replaces?: Ip }> {
  const dev = sim.dev(deviceId);
  const name = dev.label;
  const p = rawPrefix.trim().replace(/\s+/g, '');
  if (!p) return { ok: false, field: 'prefix', msg: 'Type the destination network, like 203.0.113.0/24.' };
  if (isIp(p)) {
    const net = networkOf(p, 24);
    return { ok: false, field: 'prefix', msg: `Add the prefix length after a slash. A route covers a whole network, like ${net}.`, suggest: net };
  }
  if (!isPrefix(p)) return { ok: false, field: 'prefix', msg: 'Type a network: an address, a slash, and a prefix length. For example, 203.0.113.0/24.' };
  const len = prefixLen(p);
  if (len > 0 && len < 8) return { ok: false, field: 'prefix', msg: 'Use a prefix length of /8 or longer. (0.0.0.0/0 means "everything else.")' };
  const prefix = normalizePrefix(p);
  if (prefix !== p) return { ok: false, field: 'prefix', msg: `A network starts at its first address. Did you mean ${prefix}?`, suggest: prefix };
  const own = dev.ifaces.find((i) => i.ip && i.prefix !== undefined && networkOf(i.ip, i.prefix) === prefix);
  if (own) return { ok: false, field: 'prefix', msg: `${name} is plugged into ${prefix} already (${portName(own.id)}). A router knows its own networks without a route.` };
  const via = rawVia.trim();
  if (!via) return { ok: false, field: 'via', msg: 'Type the next hop: the address of the neighbor router that should get these packets.' };
  if (!isIp(via)) {
    const bare = via.split('/')[0];
    if (via.includes('/')) return { ok: false, field: 'via', msg: 'The next hop is one address, with no slash.', suggest: isIp(bare) ? bare : undefined };
    return { ok: false, field: 'via', msg: IP_FORMAT };
  }
  if (dev.ifaces.some((i) => i.ip === via)) {
    return { ok: false, field: 'via', msg: `${via} is ${name}'s own address. The next hop is the neighbor router at the other end of a cable.` };
  }
  if (!sim.connectedIface(dev, via)) {
    // The right router, but its address on the far side: point to the network the two share.
    const far = ownerOf(sim, via);
    const near = far?.dev.kind === 'router' ? far.dev.ifaces.find((i) => i.ip && sim.connectedIface(dev, i.ip)) : undefined;
    if (far && near) {
      return {
        ok: false,
        field: 'via',
        msg: `${via} is ${far.dev.label}'s address on its far side, ${networkOf(via, far.iface.prefix ?? 24)}. ${name} can't reach that directly. Use ${far.dev.label}'s address on the network ${name} shares with it, ${networkOf(near.ip!, near.prefix!)}.`,
      };
    }
    const nets = dev.ifaces.filter((i) => i.ip && i.prefix !== undefined).map((i) => networkOf(i.ip!, i.prefix!));
    return {
      ok: false,
      field: 'via',
      msg: nets.length
        ? `The next hop has to be a neighbor, on a network ${name} is plugged into (${nets.join(', ')}). ${via} is not. Which router is next on the way?`
        : `${name} has no IP addresses yet, so it has no neighbors to hand packets to.`,
    };
  }
  const owner = ownerOf(sim, via);
  if (!owner) return { ok: false, field: 'via', msg: `No device uses ${via}. Click the next router on the map to find its address.` };
  if (owner.dev.kind !== 'router') return { ok: false, field: 'via', msg: `${via} is ${owner.dev.label}, a computer, not a router. It won't pass packets along.` };
  const cur = dev.routes.find((r) => r.source === 'static' && r.prefix === prefix);
  if (cur?.via === via) return { ok: false, msg: `${name} already sends ${prefix} to ${via}.` };
  return { ok: true, prefix, via, replaces: cur?.via };
}

/** DNS forger: the name to poison and the address to plant in the resolver's cache. */
export function checkForge(sim: Sim, attackerId: string, resolverId: string, rawName: string, rawIp: string): Checked<{ name: string; ip: Ip }> {
  const name = rawName.trim().toLowerCase();
  const att = sim.dev(attackerId);
  const r = sim.dev(resolverId).resolver;
  const nsDev = r ? sim.deviceByIp(r.upstream) : undefined;
  const zone = nsDev?.dnsZone ?? {};
  if (!name) return { ok: false, field: 'name', msg: 'Type the name you want to poison, like grades.example.' };
  if (!/^[a-z0-9.-]+$/.test(name) || !name.includes('.')) return { ok: false, field: 'name', msg: 'Type a domain name, like grades.example.' };
  if (!(name in zone)) {
    return { ok: false, field: 'name', msg: `The name server has no record for ${name}, so the resolver never looks it up. Poison a name people open, like grades.example.` };
  }
  const ip = rawIp.trim();
  if (!ip) return { ok: false, field: 'ip', msg: 'Type the address you want the resolver to hand out instead.' };
  if (!isIp(ip)) return { ok: false, field: 'ip', msg: IP_FORMAT };
  if (ip === zone[name]) return { ok: false, field: 'ip', msg: `That is the real gradebook's address (${ip}). Planting it changes nothing. Use your own server's address.` };
  const owner = sim.deviceByIp(ip);
  if (owner && owner.id !== attackerId && !owner.attacker) {
    return { ok: false, field: 'ip', msg: `${ip} is ${owner.label}'s address, not your server's. Open ${att.label} on the map to find your lookalike server's address.` };
  }
  return { ok: true, name, ip };
}

/** Ping tool: the address to ping. */
export function checkPing(sim: Sim, deviceId: string, raw: string): Checked<{ ip: Ip }> {
  const ip = raw.trim();
  if (!ip) return { ok: false, msg: 'Type the IP address to ping.' };
  if (ip.includes('/')) {
    const bare = ip.split('/')[0];
    return { ok: false, msg: 'Ping one address, with no slash.', suggest: isIp(bare) ? bare : undefined };
  }
  if (!isIp(ip)) return { ok: false, msg: IP_FORMAT };
  const dev = sim.dev(deviceId);
  if (dev.ifaces.some((i) => i.ip === ip)) return { ok: false, msg: `${ip} is ${dev.label}'s own address. Ping another device.` };
  return { ok: true, ip };
}

// ---------------------------------------------------------------------------
// Wi-Fi (wireless lab)
// ---------------------------------------------------------------------------

/**
 * Wi-Fi passphrase: the shared key families type to join. Any non-blank key
 * saves; a short one gets a heads-up (not a block) so a student can see for
 * themselves that a short key falls to guessing. `note` doesn't stop saving.
 */
export function checkWifiPassphrase(_sim: Sim, _apId: string, raw: string): Checked<{ passphrase: string; note?: string }> {
  const pass = raw.trim();
  if (!pass) return { ok: false, msg: 'Type a passphrase for families to join with.' };
  if (/\s/.test(pass)) return { ok: false, msg: 'A Wi-Fi passphrase has no spaces. Join the words together or use dashes.' };
  if (pass.length < 8) return { ok: false, msg: 'Wi-Fi passphrases are at least 8 characters. Make it longer.' };
  const note =
    passphraseStrength(pass) === 'weak'
      ? `Heads up: ${pass.length} characters is short. An attacker who captures the handshake can guess it. ${STRONG_PASSPHRASE_LEN} or more holds up.`
      : undefined;
  return { ok: true, passphrase: pass, note };
}

