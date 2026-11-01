import { Icon } from '../icons';
import type { ToolCardProps } from './registry';
import { Toggle } from './parts';

/**
 * Resolver defenses (defend card): flush the poisoned record, and turn on
 * unpredictable query IDs and source ports so a forged burst can't match.
 */
export function ResolverDefense({ session, spec }: ToolCardProps<'resolver-defense'>) {
  const sim = session.sim;
  const dev = sim.devices[spec.device];
  const r = dev.resolver;
  const names = r ? Object.keys(r.cache) : [];

  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="shield" /> Resolver defenses ({dev.label})
      </div>
      <p class="tool-desc">A poisoned record sits in the cache until it expires or you remove it. Unpredictable query IDs stop the next forgery.</p>
      <div class="tool-row">
        <span>
          Unpredictable query IDs and source ports
          {r?.hardened && <span class="pill good tiny">on</span>}
        </span>
        <Toggle
          on={!!r?.hardened}
          label={r?.hardened ? 'On' : 'Off'}
          onChange={(on) => session.dispatch({ type: 'resolver-harden', device: spec.device, on })}
        />
      </div>
      <button class="btn" onClick={() => session.dispatch({ type: 'dns-flush', device: spec.device })}>
        <Icon name="reset" /> Flush the cache
      </button>
      <div class="small muted">
        {names.length ? `Cached now: ${names.join(', ')}` : 'Cache is empty.'}
      </div>
    </div>
  );
}
