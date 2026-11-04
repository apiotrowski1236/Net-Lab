import { describe, expect, it } from 'vitest';
import { matchFilter, parseFilter, protocolsOf } from './displayFilter';
import type { Frame, IpPacket } from './types';

const LAPTOP = '192.168.1.10';
const MAC = '02:00:00:00:00:21';
const ROUTER_MAC = '02:00:00:00:00:01';

let id = 1;
const eth = (body: Partial<Frame>, src = MAC, dst = ROUTER_MAC): Frame => ({ id: id++, src, dst, origin: 'laptop', ...body });
const ipf = (pkt: Partial<IpPacket> & Pick<IpPacket, 'app'>): Frame =>
  eth({ ip: { src: LAPTOP, dst: '192.0.2.53', ttl: 64, proto: 'udp', ...pkt } as IpPacket });

const arpReq = eth({ arp: { op: 'request', senderIp: LAPTOP, senderMac: MAC, targetIp: '192.168.1.1' } }, MAC, 'ff:ff:ff:ff:ff:ff');
const dnsQ = ipf({ srcPort: 61001, dstPort: 53, app: { kind: 'dns-query', name: 'school.example', qid: 1 } });
const dnsA = ipf({ src: '192.0.2.53', dst: LAPTOP, srcPort: 53, dstPort: 61001, app: { kind: 'dns-answer', name: 'school.example', ip: '192.0.2.80', qid: 1 } });
const get = ipf({ dst: '192.0.2.80', proto: 'tcp', srcPort: 61002, dstPort: 80, app: { kind: 'http-req', method: 'GET', host: 'school.example', path: '/homework', reqId: 1 } });
const tls = ipf({ dst: '198.51.100.20', proto: 'tcp', srcPort: 61003, dstPort: 443, encrypted: true, app: { kind: 'http-req', method: 'GET', host: 'video.example', path: '/', reqId: 2 } });
const ping = ipf({ dst: '192.168.1.1', proto: 'icmp', app: { kind: 'ping', seq: 1, reply: false } });
const dhcp = eth({ dhcp: { op: 'discover', xid: 1, client: '02:00:00:00:00:22', name: 'Phone' } }, '02:00:00:00:00:22', 'ff:ff:ff:ff:ff:ff');
const ALL = [arpReq, dnsQ, dnsA, get, tls, ping, dhcp];

/** Which of ALL the filter shows, by name. */
function shows(text: string): string[] {
  const p = parseFilter(text);
  if (!p.ok) throw new Error(p.msg);
  const names = ['arp', 'dnsQ', 'dnsA', 'get', 'tls', 'ping', 'dhcp'];
  return ALL.flatMap((f, i) => (matchFilter(p.node, f) ? [names[i]] : []));
}

const msg = (text: string) => {
  const p = parseFilter(text);
  return p.ok ? 'ok' : p.msg;
};

describe('display filters', () => {
  it("names a frame's protocols the way Wireshark does", () => {
    expect(protocolsOf(arpReq)).toEqual(['eth', 'arp']);
    expect(protocolsOf(dnsQ)).toEqual(['eth', 'ip', 'udp', 'dns']);
    expect(protocolsOf(get)).toEqual(['eth', 'ip', 'tcp', 'http']);
    expect(protocolsOf(tls)).toEqual(['eth', 'ip', 'tcp', 'tls']);
    expect(protocolsOf(ping)).toEqual(['eth', 'ip', 'icmp']);
    expect(protocolsOf(dhcp)).toEqual(['eth', 'ip', 'udp', 'dhcp']);
  });

  it('filters by protocol', () => {
    expect(shows('')).toHaveLength(ALL.length);
    expect(shows('dns')).toEqual(['dnsQ', 'dnsA']);
    expect(shows('http')).toEqual(['get']);
    expect(shows('tls')).toEqual(['tls']);
    expect(shows('ssl')).toEqual(['tls']);
    expect(shows('icmp')).toEqual(['ping']);
    expect(shows('bootp')).toEqual(['dhcp']);
    expect(shows('udp')).toEqual(['dnsQ', 'dnsA', 'dhcp']);
  });

  it('combines tests with not, and, or, and parentheses', () => {
    expect(shows('!arp')).not.toContain('arp');
    expect(shows('not arp')).toHaveLength(ALL.length - 1);
    expect(shows('dns || http')).toEqual(['dnsQ', 'dnsA', 'get']);
    expect(shows('dns or http')).toEqual(['dnsQ', 'dnsA', 'get']);
    expect(shows('tcp && !tls')).toEqual(['get']);
    expect(shows('(dns || http) and ip.dst == 192.0.2.80')).toEqual(['get']);
  });

  it('filters by address and port', () => {
    expect(shows('ip.addr == 192.0.2.53')).toEqual(['dnsQ', 'dnsA']);
    expect(shows('ip.src == 192.0.2.53')).toEqual(['dnsA']);
    expect(shows('ip.dst eq 192.0.2.53')).toEqual(['dnsQ']);
    expect(shows('ip.addr == 192.0.2.0/24')).toEqual(['dnsQ', 'dnsA', 'get']);
    // DHCP carries IP addresses in a real capture.
    expect(shows('ip.dst == 255.255.255.255')).toEqual(['dhcp']);
    expect(shows('tcp.port == 443')).toEqual(['tls']);
    expect(shows('udp.port == 67')).toEqual(['dhcp']);
    expect(shows('tcp.port > 79 && tcp.port < 81')).toEqual(['get']);
    expect(shows('eth.dst == ff:ff:ff:ff:ff:ff')).toEqual(['arp', 'dhcp']);
  });

  it('a test on a field a packet lacks is false, so != skips ARP', () => {
    expect(shows('ip.addr != 192.0.2.53')).toEqual(['get', 'tls', 'ping', 'dhcp']);
    expect(shows('!(ip.addr == 192.0.2.53)')).toEqual(['arp', 'get', 'tls', 'ping', 'dhcp']);
  });

  it('matches names and requests', () => {
    expect(shows('dns.qry.name == "school.example"')).toEqual(['dnsQ', 'dnsA']);
    expect(shows('dns.qry.name contains "school"')).toEqual(['dnsQ', 'dnsA']);
    expect(shows('dns.a == 192.0.2.80')).toEqual(['dnsA']);
    expect(shows('http.request.method == GET')).toEqual(['get']);
    expect(shows('http.host == "video.example"')).toEqual([]);
  });

  it('explains mistakes in plain words', () => {
    expect(msg('ping')).toBe('Wireshark calls ping packets icmp. Try: icmp');
    expect(msg('https')).toBe('Wireshark calls encrypted web traffic tls. Try: tls');
    expect(msg('DNS')).toBe('Filters are lowercase. Try: dns');
    expect(msg('ip == 192.0.2.80')).toBe('Say which address: ip.addr (either end), ip.src (from), or ip.dst (to). Try: ip.addr == 192.0.2.80');
    expect(msg('ip.addr = 192.0.2.80')).toBe('Use two equals signs (==) to compare.');
    expect(msg('ip.addr ==')).toBe('Type a value after ==.');
    expect(msg('ip.addr == 192.0.2')).toBe('“192.0.2” isn\'t a full IP address. An IP address is four numbers with dots between, like 192.168.1.10.');
    expect(msg('ip.addr == chat.example')).toBe("ip.addr needs an IP address, like 192.0.2.80, not a name. A DNS answer tells you a name's address.");
    expect(msg('192.0.2.80')).toBe('Say what to compare the address with. Try: ip.addr == 192.0.2.80');
    expect(msg('school.example')).toBe('To find lookups of a name, try: dns.qry.name == "school.example"');
    expect(msg('tcp.port == https')).toBe('tcp.port needs a number, like 443.');
    expect(msg('dns http')).toBe('Join two tests with && (and) or || (or), like dns || http.');
    expect(msg('dns &')).toBe('Use && for "and", or || for "or".');
    expect(msg('dns ||')).toBe('Something is missing after ||.');
    expect(msg('(dns')).toBe('A “(” is missing its “)”.');
    expect(msg('dns)')).toBe('There\'s a “)” with no “(” before it.');
    expect(msg('weather')).toBe("“weather” isn't a protocol or field Wireshark knows. Try a protocol, like dns, or an address, like ip.addr == 192.168.1.10.");
    expect(msg('dns.qry.name == "school')).toBe('A quote mark is missing its partner.');
  });
});
