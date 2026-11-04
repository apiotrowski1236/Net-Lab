import { describe, expect, it } from 'vitest';
import { LABS } from '..';
import { LabSession } from '../../runtime/session';
import type { LabProgress } from '../../store/progress';
import { buildReport } from '../../store/report';
import { isLesson, textCorrect, wrongFeedback, type AnswerLookup, type TextQuestion } from '../types';
import { countOf, fromDrawing, ipsBefore, protocolNames } from './answers';
import { wiresharkLab as lab } from './index';
import { PIC, SPLIT_NUM, wsWindow } from './pictures';
import { wiresharkSolution as sol } from './solution';

function q(step: string, id: string): TextQuestion {
  const found = lab.steps.find((s) => s.id === step)?.questions?.find((x) => x.id === id);
  if (!found || found.kind !== 'text') throw new Error(`no text question ${step}/${id}`);
  return found;
}

/** The answer key's answers, with some replaced. */
const lookup =
  (over: Record<string, string> = {}): AnswerLookup =>
  (step, id) =>
    over[`${step}/${id}`] ?? sol[step]?.text?.[id] ?? '';

const ok = (step: string, id: string, value: string, over?: Record<string, string>) => textCorrect(q(step, id), value, lookup(over));
const says = (step: string, id: string, value: string, over?: Record<string, string>) => wrongFeedback(q(step, id), value, lookup(over));

/** A Copy > Summary as Text row: tabs between the columns. */
const row = (...cells: (string | number)[]) => cells.join('\t');
const ME = sol.you.text!['my-ip'];
const ROUTER = sol.ping.text!.gateway;

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x && typeof x === 'object' && !(x instanceof RegExp)) for (const v of Object.values(x)) strings(v, out);
  return out;
}

describe('wireshark: lesson shape', () => {
  it('is a lesson with no network, third in the AP Cybersecurity list', () => {
    expect(isLesson(lab)).toBe(true);
    expect(LABS.map((l) => l.id).indexOf('wireshark')).toBe(2);
  });

  it('gives every step except submit something to answer, and every drawing a card', () => {
    for (const s of lab.steps) {
      if (s.kind === 'submit') continue;
      expect(s.questions?.length, s.id).toBeGreaterThan(0);
      expect(s.demos?.length, s.id).toBeGreaterThan(0);
    }
  });

  it('puts ping and the User-Agent after submit, as extra credit', () => {
    const at = lab.steps.findIndex((s) => s.kind === 'submit');
    expect(lab.steps.slice(at + 1).map((s) => s.id)).toEqual(['ping', 'user-agent']);
    expect(lab.steps.slice(at + 1).every((s) => s.extra)).toBe(true);
  });

  it('uses the house style in student text', () => {
    for (const t of strings(lab.steps)) {
      expect(t, t).not.toMatch(/—/);
      expect(t, t).not.toMatch(/\b(simply|just|easy|easier|obviously)\b/i);
      expect(t, t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('keeps every drawing on one line, so markdown keeps it as one HTML block', () => {
    for (const s of lab.steps) for (const d of s.demos ?? []) if (d.kind === 'note') expect(d.md.split('\n\n')[0], `${s.id}/${d.id}`).not.toContain('\n');
  });

  it('checks every auto-checked answer in the key, so a real capture passes', () => {
    for (const s of lab.steps)
      for (const x of s.questions ?? []) if (x.kind === 'text' && x.expect) expect(ok(s.id, x.id, sol[s.id]!.text![x.id]), `${s.id}/${x.id}`).toBe(true);
  });
});

describe('wireshark: drawings', () => {
  it('use only documentation addresses, which the checks turn away', () => {
    for (const ip of [PIC.me, PIC.router, PIC.dns, PIC.siteIp, PIC.neversslIp, PIC.wikiIp]) expect(fromDrawing(ip), ip).toBe(true);
    expect(fromDrawing(PIC.mac.replace(/:/g, '-'))).toBe(true);
    expect(fromDrawing(ME)).toBe(false);
    expect(fromDrawing('198.35.26.224')).toBe(false);
  });

  it("turn away the drawings' own values", () => {
    expect(says('you', 'my-ip', PIC.me)).toBe("That's from the drawing. Use the one from your own Wireshark.");
    expect(says('you', 'my-mac', PIC.mac)).toBe("That's from the drawing. Use the one from your own Wireshark.");
    expect(says('http', 'host', PIC.neverssl)).toBe("That's from the drawing. Use the one from your own Wireshark.");
    expect(says('handshake', 'syn', `${PIC.port} → 80 [SYN] Seq=0`)).toBe('That port is from the drawing. Copy a packet from your own capture.');
    expect(says('first-capture', 'count', '1482')).toBe("That's from the drawing. Use the one from your own Wireshark.");
    expect(says('not-mine', 'others', String(SPLIT_NUM.others))).toBe("That's from the drawing. Use the one from your own Wireshark.");
    expect(says('dns', 'address', PIC.wikiIp)).toBe("That's from the drawing. Use the one from your own Wireshark.");
  });

  it('hide the Protocol and Info cells when fogged', () => {
    const html = wsWindow({ label: 'x', rows: [['tcp', 1, '0.0', 'a', 'b', 'TCP', 54, 'secret info']], fog: true, status: { packets: 1 }, hiHead: 'Protocol' });
    expect(html).not.toContain('secret info');
    expect(html).not.toContain('>TCP<');
    expect(html).toContain('<span class="ws-hi"><span class="ws-tag">Protocol</span>Protocol</span>');
  });
});

describe('wireshark: reading pasted text', () => {
  it('finds Source and Destination before the Info, and nothing when only the Info is pasted', () => {
    expect(ipsBefore(row(13, '0.018322', '10.40.0.10', ME, 'DNS', 89, 'Standard query response 0x0d11 A wikipedia.org A 198.35.26.224'), /Standard query/)).toEqual(['10.40.0.10', ME]);
    expect(ipsBefore('Standard query response 0x0d11 A wikipedia.org A 198.35.26.224', /Standard query/)).toEqual([]);
  });

  it('reads counts from a number or a pasted status bar', () => {
    expect(countOf('1482', 'Packets')).toBe(1482);
    expect(countOf('1,482', 'Packets')).toBe(1482);
    expect(countOf('Packets: 1482 · Displayed: 37 (2.5%)', 'Packets')).toBe(1482);
    expect(countOf('Packets: 1482 · Displayed: 37 (2.5%)', 'Displayed')).toBe(37);
    expect(countOf('none', 'Packets')).toBeUndefined();
  });

  it('knows protocol names the way the Protocol column writes them', () => {
    expect(protocolNames('TCP, DNS, TLSv1.3').ok).toEqual(['TCP', 'DNS', 'TLSv1.3']);
    expect(protocolNames('tcp and udp and mdns').ok).toEqual(['tcp', 'udp', 'mdns']);
    expect(protocolNames('SSDP LLMNR NBNS').ok).toHaveLength(3);
    // A name the list doesn't know still counts in the column's style.
    expect(protocolNames('TCP, UDP, XYZP')).toEqual({ ok: ['TCP', 'UDP', 'XYZP'], bad: [], known: 2 });
    expect(protocolNames('TCP, tcp, TCP').ok).toEqual(['TCP']);
  });
});

describe('wireshark: step 2, the first capture', () => {
  it('asks for a bigger count when the capture is nearly empty', () => {
    expect(ok('first-capture', 'count', 'Packets: 1203 · Displayed: 1203 (100.0%)')).toBe(true);
    expect(says('first-capture', 'count', '4')).toBe(
      "That's very few for 30 seconds on the school Wi-Fi. Check that you picked the interface with a moving line (Wi-Fi), then capture for another 30 seconds and read Packets: again.",
    );
  });

  it('wants three different protocol names', () => {
    expect(ok('first-capture', 'protocols', 'ARP, MDNS, SSDP')).toBe(true);
    expect(says('first-capture', 'protocols', 'TCP TCP TCP')).toBe("That's 1 different name. Find three different ones in the Protocol column.");
    expect(says('first-capture', 'protocols', 'TCP, 10.40.0.10, DNS')).toBe('10.40.0.10 is an address, from the Source or Destination column. Name what the Protocol column says.');
    expect(says('first-capture', 'protocols', 'TCP, internet, DNS')).toBe('"internet" isn\'t a name from the Protocol column. Copy the names the way that column writes them, like TCP.');
    expect(says('first-capture', 'protocols', 'TCP, ABC, XYZ')).toBe("Those don't look like names from the Protocol column. Copy three names the way your Wireshark writes them, like TCP.");
  });
});

describe('wireshark: step 3, your addresses', () => {
  it('takes the address alone or inside a pasted ipconfig line', () => {
    expect(ok('you', 'my-ip', '10.40.12.87')).toBe(true);
    expect(ok('you', 'my-ip', 'IPv4 Address. . . . . . . . . . . : 10.40.12.87')).toBe(true);
  });

  it('explains addresses that are not the computer on the network', () => {
    expect(says('you', 'my-ip', '127.0.0.1')).toBe("That's the loopback address, which every computer uses to talk to itself. Find the address for Wi-Fi.");
    expect(says('you', 'my-ip', '169.254.10.20')).toMatch(/^An address that starts with 169\.254/);
    expect(says('you', 'my-ip', '255.255.255.0')).toBe("That's the subnet mask. Look one line up for the IPv4 address.");
    expect(says('you', 'my-ip', 'fe80::1c2b:3aff:fe4d:5e6f')).toBe('That looks like an IPv6 address, with colons. Find the IPv4 address: four numbers with dots between them.');
  });

  it('takes a MAC with colons or dashes, and explains the short form and group addresses', () => {
    expect(ok('you', 'my-mac', '3c:22:fb:91:4e:07')).toBe(true);
    expect(ok('you', 'my-mac', '3C-22-FB-91-4E-07')).toBe(true);
    expect(says('you', 'my-mac', 'Apple_91:4e:07')).toBe("That's the short form, with the maker's name. Right-click Source, then choose Copy, then Value, to get all six pairs.");
    expect(says('you', 'my-mac', 'ff:ff:ff:ff:ff:ff')).toBe("That's the broadcast address, which means everyone. Use the Source of a packet your computer sent.");
    expect(says('you', 'my-mac', '01:00:5e:00:00:fb')).toMatch(/^That's a group \(multicast\) address/);
  });
});

describe('wireshark: step 4, DNS', () => {
  // From a TShark 4.4 capture of nslookup and curl.
  const real = 'Standard query response 0x0d11 A wikipedia.org A 198.35.26.224';
  const cname = 'Standard query response 0x9279 A www.wikipedia.org CNAME dyna.wikimedia.org A 198.35.26.224 OPT';

  it("takes TShark's response lines, alone or as a pasted row", () => {
    expect(ok('dns', 'reply', real)).toBe(true);
    expect(ok('dns', 'reply', cname)).toBe(true);
    expect(ok('dns', 'reply', row(3, '1.192153', '10.40.0.10', ME, 'DNS', 89, real))).toBe(true);
  });

  it('explains the query, No such name, and the IPv6 answer', () => {
    expect(says('dns', 'reply', 'Standard query 0x0d11 A wikipedia.org')).toBe("That's the query, your computer's question. Paste the response, the answer: its Info starts with Standard query response.");
    expect(says('dns', 'reply', 'Standard query response 0x0002 No such name A wikipedia.org.school.local SOA ns1.school.local')).toMatch(/^That response says No such name/);
    expect(says('dns', 'reply', 'Standard query response 0x71ad AAAA wikipedia.org AAAA 2620:0:863:ed1a::1')).toMatch(/^That response has an IPv6 address \(AAAA\)/);
  });

  it("checks that the response went to the student's own address", () => {
    expect(says('dns', 'reply', row(3, '1.192153', '10.40.0.10', '10.40.12.99', 'DNS', 89, real))).toBe(
      `This packet's Destination is 10.40.12.99, but your address from step 3 is ${ME}. Find one whose Destination is ${ME}.`,
    );
  });

  it('wants the address from the pasted response', () => {
    expect(ok('dns', 'address', '198.35.26.224')).toBe(true);
    expect(says('dns', 'address', '198.35.26.225')).toBe('The response you pasted says wikipedia.org is at 198.35.26.224. Copy the address from the end of it.');
    expect(says('dns', 'address', '10.40.0.10')).toBe(
      "That's the DNS server's own address: the Server line in nslookup, and the Source of the response. The answer for wikipedia.org is the address at the end of the response.",
    );
  });
});

describe('wireshark: steps 5 and 6, HTTP and the handshake', () => {
  it('takes a GET from the student, and explains the reply', () => {
    expect(ok('http', 'get', 'GET / HTTP/1.1')).toBe(true);
    expect(ok('http', 'get', row(31, '16.398574', ME, '34.223.124.45', 'HTTP', 150, 'GET /online HTTP/1.1 '))).toBe(true);
    expect(says('http', 'get', 'HTTP/1.1 301 Moved Permanently  (text/html)')).toBe("That's the server's answer. Paste the request: its Info starts with GET.");
    expect(says('http', 'get', row(31, '16.398574', '10.40.12.99', '34.223.124.45', 'HTTP', 150, 'GET /online HTTP/1.1'))).toBe(
      `This packet's Source is 10.40.12.99, but your address from step 3 is ${ME}. Find one whose Source is ${ME}.`,
    );
  });

  it('takes neverssl.com and its made-up names as the Host', () => {
    expect(ok('http', 'host', 'neverssl.com')).toBe(true);
    expect(ok('http', 'host', 'Host: sunnyfreshday.neverssl.com\\r\\n')).toBe(true);
    expect(says('http', 'host', 'www.wikipedia.org')).toBe("That's another site. Use a GET request to neverssl.com.");
  });

  it("takes TShark's SYN lines, with the arrow or a typed one", () => {
    expect(ok('handshake', 'syn', '54036 → 80 [SYN] Seq=0 Win=65480 Len=0 MSS=65480 SACK_PERM TSval=148457956 TSecr=0 WS=1024')).toBe(true);
    expect(ok('handshake', 'syn', '[TCP Retransmission] 54036 → 80 [SYN] Seq=0')).toBe(true);
    expect(ok('handshake', 'syn', '54036 -> 80 [SYN]')).toBe(true);
    expect(says('handshake', 'syn', '45366 → 443 [SYN] Seq=0')).toBe('That connection goes to port 443, which is HTTPS. Filter `tcp.port == 80` and find a [SYN] to port 80.');
  });

  it("checks that the [SYN, ACK] answers the student's own [SYN]", () => {
    expect(ok('handshake', 'syn-ack', '80 → 54036 [SYN, ACK] Seq=0 Ack=1 Win=65535 Len=0 MSS=61440 WS=128')).toBe(true);
    expect(says('handshake', 'syn-ack', '80 → 53120 [SYN, ACK] Seq=0 Ack=1')).toBe(
      'Your [SYN] went from port 54036. The reply to it goes back to that port: find the row that says 80 → 54036 [SYN, ACK].',
    );
    expect(says('handshake', 'syn-ack', '53120 → 80 [ACK] Seq=1 Ack=1')).toBe('That one is marked [ACK] only: the third packet. Find the one marked [SYN, ACK].');
  });
});

describe('wireshark: step 7 and the ping extra credit', () => {
  it('names a QUIC row, and says what to do when every row is QUIC', () => {
    expect(says('tls', 'hello', row(40, '0.512200', ME, '198.35.26.224', 'QUIC', 1292, 'Initial, DCID=8a3f2b1c0d9e7f61, PKN: 1, CRYPTO, PADDING'))).toBe(
      'That row is QUIC, not TLS. Pick a row whose Protocol says TLS. Only QUIC rows? Open the site in a private window, like Incognito in Chrome, and capture again.',
    );
  });

  it("takes TShark's Client Hello, and explains other sites and old versions", () => {
    expect(ok('tls', 'hello', 'Client Hello (SNI=www.wikipedia.org)')).toBe(true);
    expect(ok('tls', 'hello', 'Client Hello\nServer Name: www.wikipedia.org')).toBe(true);
    expect(says('tls', 'hello', 'Client Hello (SNI=www.google.com)')).toBe('That Client Hello is for another site. Find the one that says wikipedia.org.');
    expect(says('tls', 'hello', 'Client Hello')).toMatch(/^Your Wireshark doesn't show the name in Info/);
    expect(says('tls', 'hello', 'Server Hello, Change Cipher Spec, Application Data')).toBe("That's the server's answer. Paste the Client Hello your browser sent.");
  });

  it("turns away the student's own address as the gateway", () => {
    expect(says('ping', 'gateway', ME)).toBe("That's your own computer's address, from step 3. Find Default Gateway (Windows) or Router (Mac).");
  });

  // From a TShark 4.4 capture of ping -c 3.
  const reply = 'Echo (ping) reply    id=0x7448, seq=1/256, ttl=255 (request in 132)';
  const lost = 'Echo (ping) request  id=0x0001, seq=1/256, ttl=128 (no response found!)';

  it('takes a reply from the router, or a lost request when pings are blocked', () => {
    expect(ok('ping', 'reply', reply)).toBe(true);
    expect(ok('ping', 'reply', row(133, '16.619496', ROUTER, ME, 'ICMP', 98, reply))).toBe(true);
    expect(ok('ping', 'reply', row(5, '1.0', ME, ROUTER, 'ICMP', 74, lost))).toBe(true);
    expect(says('ping', 'reply', 'Echo (ping) request  id=0x7448, seq=1/256, ttl=64 (reply in 133)')).toMatch(/^That's a request, from your computer/);
  });

  it('checks that the reply came from the router the student named', () => {
    expect(says('ping', 'reply', row(133, '16.619496', '8.8.8.8', ME, 'ICMP', 98, reply))).toBe(
      `This packet's Source is 8.8.8.8, but your router is ${ROUTER}. Find one whose Source is ${ROUTER}.`,
    );
  });
});

describe('wireshark: step 8, the two filters', () => {
  it('wants the two Displayed counts to add up to Packets', () => {
    expect(ok('not-mine', 'others', '41')).toBe(true);
    expect(ok('not-mine', 'others', 'Packets: 412 · Displayed: 41 (10.0%)')).toBe(true);
    expect(says('not-mine', 'others', '40')).toBe(
      '371 + 40 = 411, but the whole capture has 412, so one of your three numbers is off. Check each one in the same capture: Packets for the first, and the number after Displayed after each filter. You can change any of the three.',
    );
  });

  it('tells the first two boxes to check again when the three disagree', () => {
    expect(says('not-mine', 'mine', '370')).toBe("370 + 41 isn't 412, so one of the three numbers is off. Check this one too.");
    expect(says('not-mine', 'total', '413')).toBe("371 + 41 isn't 413, so one of the three numbers is off. Check this one too.");
    expect(ok('not-mine', 'mine', '370', { 'not-mine/others': '' })).toBe(true);
  });

  it('catches Packets typed in place of Displayed', () => {
    expect(says('not-mine', 'mine', '500')).toBe("That's more than the 412 packets in the whole capture. Read the number after Displayed, not Packets.");
  });
});

describe('wireshark: report tries', () => {
  it('takes Correct! off every count when the three disagree, and blames the box that changed', () => {
    const now = Date.now();
    const p: LabProgress = { labId: lab.id, labVersion: lab.version, studentId: 'ws-sum', startedAt: now, updatedAt: now, activeMs: 0, step: 7, maxStep: 7, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] };
    const s = new LabSession(lab, p);
    const who = { id: 'x', name: 'Test Student', period: '', createdAt: 0 };
    const answer = (id: string, v: string) => {
      s.setDraft('not-mine', q('not-mine', id), v);
      return s.check('not-mine', q('not-mine', id));
    };
    const right = () => ['total', 'mine', 'others'].map((id) => s.answer('not-mine', id)?.correct);
    const tries = () => ['total', 'mine', 'others'].map((id) => buildReport(lab, s.progress, who, 'submitted').questions.find((x) => x.step === 'not-mine' && x.id === id)?.attempts);
    expect(answer('total', '1248')).toBe(true);
    expect(answer('mine', '1094')).toBe(true); // misread: really 1084
    expect(answer('others', '164')).toBe(false);
    expect(right()).toEqual([false, false, false]);
    expect(wrongFeedback(q('not-mine', 'mine'), '1094', s.answerText)).toBe("1094 + 164 isn't 1248, so one of the three numbers is off. Check this one too.");
    expect(answer('mine', '1084')).toBe(true);
    expect(right()).toEqual([true, true, true]);
    expect(tries()).toEqual([1, 2, 1]);
  });


  it("doesn't count checks after the first right answer", () => {
    const now = Date.now();
    const p: LabProgress = { labId: lab.id, labVersion: lab.version, studentId: 'ws-tries', startedAt: now, updatedAt: now, activeMs: 0, step: 0, maxStep: 0, stepStart: {}, goals: {}, answers: {}, actions: [], log: [] };
    const s = new LabSession(lab, p);
    const who = { id: 'x', name: 'Test Student', period: '', createdAt: 0 };
    const tries = () => buildReport(lab, s.progress, who, 'submitted').questions.find((x) => x.step === 'first-capture' && x.id === 'count')?.attempts;
    const answer = (v: string) => {
      s.setDraft('first-capture', q('first-capture', 'count'), v);
      return s.check('first-capture', q('first-capture', 'count'));
    };
    expect(answer('1482')).toBe(false);
    expect(answer('1203')).toBe(true);
    // Trying another number from the same capture, after being right, isn't a new try.
    expect(answer('1482')).toBe(false);
    expect(answer('1210')).toBe(true);
    expect(s.answer('first-capture', 'count')?.attempts).toBe(4);
    expect(tries()).toBe(2);
  });
});
