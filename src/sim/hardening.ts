import type { Service } from './services';
import type { Device } from './types';

/**
 * Device hardening (built for `net-audit`): the management settings a router
 * or switch security policy covers.
 *
 *  - **Remote login services.** Telnet (TCP 23) sends everything, passwords
 *    included, as readable text. SSH (TCP 22) does the same job inside
 *    encryption. Each is a real entry in `Device.services`, so a port scan
 *    finds it and a connection to it gets an answer. `Sim.setHardening` adds
 *    or removes it. (Routers answer services too: see `listening`.)
 *  - **Where logins go.** A local account lives on the device itself; many
 *    ship with a factory password printed in the manual. A policy bans local
 *    accounts and sends every login to one approved **authentication server**
 *    (`authServer: true`), where accounts are added, removed, and audited in
 *    one place. The simulation models the setting, not the server.
 *  - **Names for ports** (switches): a label for a port with no cable, like the
 *    lobby wall jack, so findings and the inspector can say where it is.
 *
 * Give a device a `Device.hardening` to opt in. Sim method: `setHardening`.
 * Action: `harden`. Inspector section: `hardening` (src/ui/inspector/Hardening.tsx),
 * unlocked for a device by the `hardening` tool.
 */

export interface LocalAccount {
  user: string;
  pass: string;
  /** Still the password the device shipped with. */
  factory: boolean;
}

export interface Hardening {
  /** Logins go through the approved authentication server, and local accounts are removed. */
  authServer: boolean;
  /** The local admin account, used while `authServer` is off. */
  account?: LocalAccount;
  /** Labels for ports, by interface id: { p7: 'lobby wall jack' }. */
  portNames?: Record<string, string>;
}

/** Settings the `harden` action changes. */
export type HardenSetting = 'telnet' | 'ssh' | 'auth-server';

export const HARDEN_SETTINGS: HardenSetting[] = ['telnet', 'ssh', 'auth-server'];

/** The remote login services, as they appear in `Device.services`. */
export const MANAGEMENT_SERVICES: Record<'telnet' | 'ssh', Service> = {
  telnet: { port: 23, proto: 'tcp', app: 'telnet', banner: 'User Access Verification. Username:' },
  ssh: { port: 22, proto: 'tcp', app: 'ssh', banner: 'SSH-2.0-RouterSSH_2.4' },
};

/** Is this login service answering on the device? */
export function serviceOn(dev: Device, which: 'telnet' | 'ssh'): boolean {
  const s = MANAGEMENT_SERVICES[which];
  return !!dev.services?.some((x) => x.proto === s.proto && x.port === s.port);
}

/** A local account is still usable with its factory password. */
export function factoryLogin(dev: Device): LocalAccount | undefined {
  const h = dev.hardening;
  return h && !h.authServer && h.account?.factory ? h.account : undefined;
}

/** "port 7 (lobby wall jack)", or "port 7". */
export function namedPort(dev: Device, port: string): string {
  const m = /^p(\d+)$/.exec(port);
  const base = m ? `port ${m[1]}` : port;
  const name = dev.hardening?.portNames?.[port];
  return name ? `${base} (${name})` : base;
}

/** The login text a client sends: what a sniffer reads from a plain Telnet session. */
export function loginText(user: string, pass: string): string {
  return `login: ${user}  password: ${pass}`;
}
