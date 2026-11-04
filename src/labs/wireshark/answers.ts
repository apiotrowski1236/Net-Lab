import type { AnswerLookup, TextQuestion } from '../types';
import { PIC } from './pictures';

/**
 * Answer checks for "Wireshark for Real". Students copy values out of their
 * own Wireshark, so no answer is known ahead of time. Each check does two
 * things instead:
 *  - `expect` matches Wireshark's own format (an Info line such as
 *    "Standard query response 0x0d11 A wikipedia.org A 198.35.26.224"), so
 *    the answer has to come from a real capture. The formats were checked
 *    against TShark 4.4.
 *  - `verify` checks the answer against the student's other answers: a DNS
 *    reply has to go to the address they gave in step 3, a [SYN, ACK] has to
 *    go back to their [SYN]'s port, and so on.
 * Both turn away values from the drawings (documentation addresses and the
 * drawings' own MACs and names).
 */

type Verify = NonNullable<TextQuestion['verify']>;

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
export const IPV4 = `${OCTET}(?:\\.${OCTET}){3}`;
const ipRe = () => new RegExp(`(?<![\\d.])${IPV4}(?![\\d.])`, 'g');

/** An answer with an IPv4 address in it, alone or inside a pasted line. */
export const IP_ANY = new RegExp(`(?<![\\d.])${IPV4}(?![\\d.])`);

/** Every IPv4 address in `text`, in order. */
export const ipsIn = (text: string): string[] => text.match(ipRe()) ?? [];

/** The first IPv4 address in `text`, or ''. */
export const firstIp = (text: string): string => ipsIn(text)[0] ?? '';

/**
 * The addresses before `marker` in a pasted packet summary: Source, then
 * Destination. Copy > Summary as Text gives No., Time, Source, Destination,
 * Protocol, Length, then Info, so these come before the Info's first word.
 * Empty when the student pasted the Info alone.
 */
export function ipsBefore(text: string, marker: RegExp): string[] {
  const at = text.search(marker);
  return at < 0 ? [] : ipsIn(text.slice(0, at));
}

/** A MAC address: six pairs of hex digits joined by colons or dashes. */
export const MAC_RE = /\b[0-9a-f]{2}([:-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}\b/i;

/** The documentation ranges the drawings use. Real networks never hand them out. */
const DRAWING_NET = /(?<![\d.])(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}(?![\d.])/;
const DRAWING_VALUES = [PIC.mac, PIC.routerMac, PIC.txid, PIC.neverssl, PIC.site].map((v) => v.toLowerCase());

export const FROM_DRAWING = "That's from the drawing. Use the one from your own Wireshark.";
export const PORT_FROM_DRAWING = "That port is from the drawing. Copy a packet from your own capture.";

/** A value copied from one of the drawings instead of the student's own capture. */
export function fromDrawing(value: string): boolean {
  const v = value.toLowerCase().replace(/-/g, ':');
  return DRAWING_NET.test(v) || DRAWING_VALUES.some((d) => v.includes(d));
}

/** Run checks in order; the first message wins. */
export const all =
  (...checks: Verify[]): Verify =>
  (value, answer) => {
    for (const c of checks) {
      const msg = c(value, answer);
      if (msg) return msg;
    }
    return undefined;
  };

export const notDrawing: Verify = (value) => (fromDrawing(value) ? FROM_DRAWING : undefined);

/** A count, from "1482", "1,482", or a pasted status bar ("Packets: 1482 · Displayed: 37 (2.5%)"). */
export function countOf(value: string, field: 'Packets' | 'Displayed'): number | undefined {
  const named = new RegExp(`${field}:\\s*([\\d,]+)`, 'i').exec(value);
  const raw = named?.[1] ?? /\d[\d,]*/.exec(value)?.[0];
  return raw === undefined ? undefined : Number(raw.replace(/,/g, ''));
}

/** A number in the answer, or the right status bar field in it. */
export const COUNT = /\d/;

// ---------------------------------------------------------------------------
// The student's own addresses, from step 3 and step 8
// ---------------------------------------------------------------------------

export const myIp = (answer: AnswerLookup) => firstIp(answer('you', 'my-ip'));
export const gatewayIp = (answer: AnswerLookup) => firstIp(answer('ping', 'gateway'));

/** Addresses a computer shows but that aren't its address on the network. */
export function notAnAddress(ip: string): string | undefined {
  if (/^127\./.test(ip)) return "That's the loopback address, which every computer uses to talk to itself. Find the address for Wi-Fi.";
  if (/^169\.254\./.test(ip)) return "An address that starts with 169.254 means your computer didn't get an address from the network. Check that you're on the school Wi-Fi, then look again.";
  if (/^255\./.test(ip)) return "That's the subnet mask. Look one line up for the IPv4 address.";
  if (/^0\./.test(ip) || /\.255$/.test(ip)) return "That isn't one computer's address. Look for the line that says IPv4 Address (Windows) or IP address (Mac).";
  return undefined;
}

/**
 * The summary's Source and Destination have to match what the student said.
 * `from` and `to` are [address, what to call it]; either may be left out.
 */
export function summaryEnds(marker: RegExp, from?: (a: AnswerLookup) => [string, string], to?: (a: AnswerLookup) => [string, string]): Verify {
  return (value, answer) => {
    const [src, dst] = ipsBefore(value, marker);
    if (src && from) {
      const [want, who] = from(answer);
      if (want && src !== want) return `This packet's Source is ${src}, but ${who} is ${want}. Find one whose Source is ${want}.`;
    }
    if (dst && to) {
      const [want, who] = to(answer);
      if (want && dst !== want) return `This packet's Destination is ${dst}, but ${who} is ${want}. Find one whose Destination is ${want}.`;
    }
    return undefined;
  };
}

export const me = (a: AnswerLookup): [string, string] => [myIp(a), 'your address from step 3'];
export const router = (a: AnswerLookup): [string, string] => [gatewayIp(a), 'your router'];

// ---------------------------------------------------------------------------
// Protocol names (step 2)
// ---------------------------------------------------------------------------

/** Names Wireshark's Protocol column shows on a school laptop. A name not here still counts if it's written the way the column writes it. */
const PROTOCOLS = new Set(
  (
    'TCP UDP TLS TLSv1 TLSv1.1 TLSv1.2 TLSv1.3 SSL SSLv3 QUIC GQUIC DNS MDNS LLMNR NBNS NBDS ARP RARP ICMP ICMPv6 IGMP IGMPv2 IGMPv3 DHCP DHCPv6 BOOTP SSDP HTTP HTTP2 HTTP3 HTTP/JSON HTTP/XML OCSP NTP SNMP STP RSTP LLDP CDP EAPOL EAP IPv4 IPv6 IP ' +
    'BROWSER NetBIOS SMB SMB2 LDAP CLDAP KRB5 Kerberos RTP RTCP STUN DTLS DTLSv1.0 DTLSv1.2 Syslog WebSocket DB-LSP-DISC LSD WSD LLC DATA Data MQTT SSH SSHv2 Telnet FTP SMTP IMAP POP RIP OSPF VRRP HSRP ESP ISAKMP WireGuard OpenVPN RADIUS SRVLOC UPnP CoAP RTSP SIP NAT-PMP PCP CAPWAP ' +
    'LOOP ECHO XMPP MSNMS DCERPC EPM SRVSVC LANMAN BJNP WOL IPP TFTP IAX2 RTMP LPD ASAP NDMP DIAMETER'
  )
    .split(' ')
    .map((p) => p.toLowerCase()),
);

/** Words from the column headers, or from the lesson, that aren't protocols. */
const NOT_PROTOCOLS = new Set(['no', 'no.', 'time', 'source', 'destination', 'protocol', 'length', 'info', 'wi-fi', 'wifi', 'ethernet', 'and', 'or', 'the', 'a']);

/** The distinct protocol names in a list like "TCP, DNS, and TLSv1.3". */
export function protocolNames(value: string): { ok: string[]; bad: string[] } {
  const words = value
    .split(/[\s,;]+|\band\b/i)
    .map((w) => w.replace(/^[("'[]+|[)"'\].]+$/g, ''))
    .filter(Boolean);
  const ok = new Map<string, string>();
  const bad: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (NOT_PROTOCOLS.has(lower)) continue;
    // Known, or written the way the column writes names: capitals and digits, maybe "v1.3".
    if (PROTOCOLS.has(lower) || /^[A-Z][A-Z0-9-]{1,9}(?:v\d+(?:\.\d+)?)?$/.test(w)) ok.set(lower, w);
    else bad.push(w);
  }
  return { ok: [...ok.values()], bad };
}

export const threeProtocols: Verify = (value) => {
  const { ok, bad } = protocolNames(value);
  if (ok.length >= 3) return undefined;
  if (bad.length) {
    const w = bad[0];
    if (new RegExp(`^${IPV4}$`).test(w)) return `${w} is an address, from the Source or Destination column. Name what the Protocol column says.`;
    return `"${w}" isn't a name from the Protocol column. Copy the names the way that column writes them, like TCP.`;
  }
  return `That's ${ok.length} different name${ok.length === 1 ? '' : 's'}. Find three different ones in the Protocol column.`;
};

// ---------------------------------------------------------------------------
// TCP ports (step 6)
// ---------------------------------------------------------------------------

/** The arrow Wireshark writes between ports, or a typed stand-in. */
const ARROW = '\\s*(?:→|->|>|to)\\s*';
export const SYN_RE = new RegExp(`(\\d{1,5})${ARROW}80\\s*\\[SYN\\]`, 'i');
export const SYN_ACK_RE = new RegExp(`\\b80${ARROW}(\\d{1,5})\\s*\\[SYN,\\s*ACK\\]`, 'i');

export const synAckMatches: Verify = (value, answer) => {
  const client = SYN_RE.exec(answer('handshake', 'syn'))?.[1];
  const back = SYN_ACK_RE.exec(value)?.[1];
  if (!client || !back || client === back) return undefined;
  return `Your [SYN] went from port ${client}. The reply to it goes back to that port: find the row that says 80 → ${client} [SYN, ACK].`;
};

// ---------------------------------------------------------------------------
// DNS (step 4)
// ---------------------------------------------------------------------------

/** A response for wikipedia.org with at least one IPv4 answer (an A record). */
export const DNS_REPLY_RE = new RegExp(`Standard query response\\s+0x[0-9a-f]{4}\\s+A\\s+(?:www\\.)?wikipedia\\.org\\b.*?\\sA\\s+${IPV4}`, 'i');

/** The addresses in a response's A records ("A 198.35.26.224"). */
export const answerIps = (reply: string): string[] => [...reply.matchAll(new RegExp(`\\sA\\s+(${IPV4})(?![\\d.])`, 'gi'))].map((m) => m[1]);

export const addressInReply: Verify = (value, answer) => {
  const ips = answerIps(answer('dns', 'reply'));
  const ip = firstIp(value);
  if (!ips.length || ips.includes(ip)) return undefined;
  return `The response you pasted says wikipedia.org is at ${ips.join(' or ')}. Copy the address from the end of it.`;
};
