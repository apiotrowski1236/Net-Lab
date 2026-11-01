import { ttlLeft } from '../../sim/dns';
import { Icon } from '../icons';
import { recentlyChanged } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

/**
 * A recursive resolver's cache: the answers it is holding and how long each
 * one is good for. Read-only; the resolver fills it as it answers lookups.
 */
export function DnsCache({ sim, dev }: InspectorSectionProps) {
  const r = dev.resolver;
  if (!r) return null;
  const names = Object.keys(r.cache);
  return (
    <section>
      <h4>
        DNS cache <span class="muted">answers it is holding, and how long each is good for</span>
      </h4>
      {names.length === 0 ? (
        <p class="muted small">Empty. The resolver fills this in as people look up names. Each answer stays until its TTL runs out.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th>Answered by</th>
              <th>Expires in</th>
            </tr>
          </thead>
          <tbody>
            {names.map((name) => {
              const e = r.cache[name];
              const left = ttlLeft(e, sim.t);
              const flash = recentlyChanged(sim, (ev) => ev.type === 'dns-answer' && ev.device === dev.id && ev.name === name);
              return (
                <tr key={name} class={flash ? 'flash' : ''}>
                  <td class="mono">{name}</td>
                  <td class="mono">{e.ip}</td>
                  <td class="mono">{e.from}</td>
                  <td>{left > 0 ? `${Math.ceil(left / 1000)}s` : <span class="muted">expired</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p class="small muted">
        Query IDs: {r.hardened ? (
          <span class="pill good tiny">
            <Icon name="shield" size={12} /> unpredictable
          </span>
        ) : (
          <span class="pill warn tiny">predictable</span>
        )}
      </p>
    </section>
  );
}
