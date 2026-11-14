import { Icon } from '../icons';
import { Toggle } from './parts';
import type { ToolCardProps } from './registry';

// device-analysis: two defenses for a server's SSH sign-in. fail2ban watches
// auth.log and bans an address after repeated failures; turning off password
// sign-in leaves only keys, so guessing passwords gets an attacker nowhere.

export function SshGuardTool({ session, spec }: ToolCardProps<'ssh-guard'>) {
  void session.simRev.value;
  const dev = session.sim.devices[spec.device];
  const lx = dev?.linux;
  if (!dev || !lx) return null;
  const f = lx.f2b;
  const min = (ms: number) => `${Math.round(ms / 60_000)} minutes`;
  const set = (setting: 'fail2ban' | 'passwords', on: boolean) => session.dispatch({ type: 'linux', device: dev.id, setting, on });
  return (
    <div class="tool-card defend sshg-card">
      <div class="tool-title">
        <Icon name="shield" /> Sign-in defenses on {dev.label}
      </div>
      {spec.controls.includes('fail2ban') && (
        <div class="sshg-item">
          <Toggle on={f.on} label="fail2ban" onChange={(v) => set('fail2ban', v)} />
          <p class="tool-desc">
            Reads auth.log as it is written. After {f.maxretry} failed sign-ins from one address within {min(f.findtime)}, it adds a ufw rule at the top that blocks that address for{' '}
            {min(f.bantime)}.
          </p>
          {f.on && (
            <ul class="tool-list">
              <li>
                <span>Banned now</span>
                <span class="small mono">{f.banned.length ? f.banned.join(', ') : 'nobody yet'}</span>
              </li>
            </ul>
          )}
        </div>
      )}
      {spec.controls.includes('passwords') && (
        <div class="sshg-item">
          <Toggle on={lx.sshd.passwords} label="Allow password sign-in" onChange={(v) => set('passwords', v)} />
          <p class="tool-desc">
            {lx.sshd.passwords ? (
              <>
                Turning this off writes <code>PasswordAuthentication no</code> in sshd's settings. Then only accounts with a key can sign in.
              </>
            ) : (
              <>
                Off: sshd's settings say <code>PasswordAuthentication no</code>. Only accounts with a key can sign in.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
