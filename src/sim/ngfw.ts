import { appName, identifyApp } from './services';
import type { IpPacket } from './types';

/**
 * Next-generation firewall features (firewall-types lab). The firewall engine
 * (firewall.ts) calls these; they hold no state of their own.
 *
 * APPLICATION RULES
 *   A rule can name an application (`FwRule.app`). A next-generation firewall
 *   identifies the application inside each new conversation (`identifyApp`)
 *   whatever port it uses, so "DENY out remote-control" catches the program
 *   on 443, on 8443, or on any other port. An application id is one of
 *   `identifyApp`'s names ('ssh', 'smb', 'remote-control', ...) or a group
 *   from APP_GROUPS ('web' is HTTP and HTTPS). Stateless and stateful
 *   firewalls can't see applications: they skip a rule that names one.
 *
 * INTRUSION PREVENTION
 *   With `FirewallState.ips` on, a next-generation firewall also reads what a
 *   request carries (a web request's path and body, a service request's
 *   data) and compares it with IPS_SIGNATURES, patterns of known attacks. A
 *   match is denied even when a rule allowed the port: verdict `by: 'ips'`
 *   with `signature`, and an 'alert' line in the firewall's log. (In the
 *   simulation the firewall reads HTTPS too. A real one has to decrypt it
 *   first, for example with the web server's own certificate key.)
 *
 * API
 *   APP_GROUPS, APP_CHOICES        application ids a rule can name, for the editor
 *   ruleAppName(app)               "Web browsing", "Remote-control tool"
 *   appMatches(ruleApp, pkt)       does the packet carry that application?
 *   IPS_SIGNATURES, signatureOf(pkt), signatureName(id)
 *   Sim: fwSetIps (sim.ts, section "ngfw")
 */

/** Rule applications that stand for several identified ones. */
export const APP_GROUPS: Record<string, { name: string; apps: string[] }> = {
  web: { name: 'Web browsing', apps: ['http', 'https'] },
};

/** Applications the rule editor offers, in order. 'any' is the default. */
export const APP_CHOICES: string[] = ['web', 'ssh', 'smb', 'rdp', 'remote-control'];

/** A rule application's name for students. */
export function ruleAppName(app: string): string {
  if (app === 'smb') return 'File sharing (SMB)';
  if (app === 'rdp') return 'Remote desktop (RDP)';
  return APP_GROUPS[app]?.name ?? appName(app);
}

/** Does this packet carry the application a rule names? ('any' or no app always matches.) */
export function appMatches(ruleApp: string | undefined, pkt: IpPacket): boolean {
  if (!ruleApp || ruleApp === 'any') return true;
  const found = identifyApp(pkt);
  if (!found) return false;
  return (APP_GROUPS[ruleApp]?.apps ?? [ruleApp]).includes(found);
}

export interface IpsSignature {
  id: string;
  name: string;
  /** One line for students: what the pattern looks for. */
  text: string;
  test: RegExp;
}

/** Patterns of known attacks the intrusion prevention feature looks for inside requests. */
export const IPS_SIGNATURES: IpsSignature[] = [
  {
    id: 'sql-injection',
    name: 'SQL injection',
    text: "Database commands hidden in a web request, like ' OR '1'='1",
    test: /'\s*or\s*'?\d+'?\s*=\s*'?\d+|union\s+select|;\s*drop\s+table/i,
  },
  {
    id: 'path-traversal',
    name: 'Path traversal',
    text: 'A request that climbs out of the web folder with ../ to read other files',
    test: /\.\.\/|\.\.%2f/i,
  },
  {
    id: 'command-injection',
    name: 'Command injection',
    text: 'Commands for the server’s operating system tucked into a request, like ; cat /etc/passwd',
    test: /;\s*(cat|rm|wget|curl|nc)\s/i,
  },
];

/** What a request carries that intrusion prevention reads: a web request's path and body, or a service request's data. */
export function payloadOf(pkt: IpPacket): string | undefined {
  const a = pkt.app;
  if (a.kind === 'http-req') return a.body ? `${a.path} ${a.body}` : a.path;
  if (a.kind === 'svc' && !a.reply) return a.text;
  return undefined;
}

/** The first known attack pattern inside this packet, if any. */
export function signatureOf(pkt: IpPacket): IpsSignature | undefined {
  const text = payloadOf(pkt);
  if (!text) return undefined;
  return IPS_SIGNATURES.find((s) => s.test.test(text));
}

export function signatureName(id: string | undefined): string {
  return IPS_SIGNATURES.find((s) => s.id === id)?.name ?? id ?? 'a known attack';
}
