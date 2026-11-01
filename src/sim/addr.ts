// Tiny IPv4 helpers. Addresses are plain dotted-quad strings ("192.168.1.10"),
// prefixes are CIDR strings ("203.0.113.0/24").

export type Ip = string;
export type Mac = string;

export const BROADCAST_MAC: Mac = 'ff:ff:ff:ff:ff:ff';

export function isIp(s: string): boolean {
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function ipToInt(ip: Ip): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function intToIp(n: number): Ip {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function maskBits(len: number): number {
  return len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
}

export function parsePrefix(prefix: string): { net: number; len: number } {
  const [ip, l] = prefix.split('/');
  const len = l === undefined ? 32 : Number(l);
  return { net: (ipToInt(ip) & maskBits(len)) >>> 0, len };
}

export function isPrefix(s: string): boolean {
  const [ip, l] = s.split('/');
  return isIp(ip) && l !== undefined && /^\d{1,2}$/.test(l) && Number(l) <= 32;
}

export function prefixLen(prefix: string): number {
  return parsePrefix(prefix).len;
}

/** Normalize "203.0.113.77/24" to "203.0.113.0/24". */
export function normalizePrefix(prefix: string): string {
  const { net, len } = parsePrefix(prefix);
  return `${intToIp(net)}/${len}`;
}

export function prefixContains(prefix: string, ip: Ip): boolean {
  const { net, len } = parsePrefix(prefix);
  return ((ipToInt(ip) & maskBits(len)) >>> 0) === net;
}

/** True when `outer` contains every address in `inner` (outer is the same size or bigger). */
export function prefixCovers(outer: string, inner: string): boolean {
  const o = parsePrefix(outer);
  const i = parsePrefix(inner);
  return i.len >= o.len && ((i.net & maskBits(o.len)) >>> 0) === o.net;
}

export function networkOf(ip: Ip, len: number): string {
  return `${intToIp((ipToInt(ip) & maskBits(len)) >>> 0)}/${len}`;
}

export function sameSubnet(a: Ip, b: Ip, len: number): boolean {
  const m = maskBits(len);
  return ((ipToInt(a) & m) >>> 0) === ((ipToInt(b) & m) >>> 0);
}
