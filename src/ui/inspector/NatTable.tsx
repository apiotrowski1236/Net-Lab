import type { Sim } from '../../sim/sim';
import type { NatEntry } from '../../sim/nat';
import { recentlyChanged } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

function end(ip: string, port: number, proto: NatEntry['proto']): string {
  return proto === 'icmp' ? `${ip} (ping ${port})` : `${ip} port ${port}`;
}

function who(sim: Sim, ip: string): string {
  return sim.deviceByIp(ip)?.label ?? ip;
}

/**
 * Address sharing (NAT) (home-network): a NAT router's public address and its
 * table, newest line first, plus any port-forwarding rules. See src/sim/nat.ts.
 * Shown on any router with `Device.nat`, so another lab gets it for free.
 */
export function NatTable({ session, sim, dev }: InspectorSectionProps) {
  void session.simRev.value;
  const nat = dev.nat;
  if (dev.kind !== 'router' || !nat) return null;
  const outside = dev.ifaces.find((i) => i.id === nat.outside);
  const rows = [...nat.table].reverse();
  return (
    <section class="nat-table">
      <h4>
        Address sharing (NAT) <span class="muted">one public address for every device behind this router</span>
      </h4>
      <p class="small">
        Public address: <span class="mono">{outside?.ip ?? 'none yet'}</span>
        <span class="muted"> on the {nat.outside} port</span>
      </p>
      {rows.length === 0 ? (
        <p class="muted small">Empty. No packet has gone out to the internet yet.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Inside address</th>
              <th>Shared as</th>
              <th>Talking to</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const key = `${e.proto}/${e.public}/${e.remote.ip}/${e.remote.port}`;
              const flash = recentlyChanged(sim, (x) => x.type === 'nat' && x.device === dev.id && x.entry.proto === e.proto && x.entry.public === e.public && x.entry.remote.ip === e.remote.ip);
              return (
                <tr key={key} class={flash ? 'flash' : ''}>
                  <td>
                    {who(sim, e.inside.ip)}
                    {e.forwarded && <span class="pill tiny warn">forwarded</span>}
                  </td>
                  <td class="mono">{end(e.inside.ip, e.inside.port, e.proto)}</td>
                  <td class="mono">{end(outside?.ip ?? '?', e.public, e.proto)}</td>
                  <td>
                    {who(sim, e.remote.ip)}
                    <span class="mono muted"> {e.proto === 'icmp' ? e.remote.ip : `${e.remote.ip}:${e.remote.port}`}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {nat.forwards.length > 0 && (
        <>
          <p class="small">Port forwarding: ports opened on purpose, so packets that nobody asked for still get in.</p>
          <table class="table">
            <thead>
              <tr>
                <th>Public port</th>
                <th>Goes to</th>
              </tr>
            </thead>
            <tbody>
              {nat.forwards.map((f) => (
                <tr key={`${f.proto}/${f.port}`}>
                  <td class="mono">
                    {f.port} <span class="muted">{f.proto.toUpperCase()}</span>
                  </td>
                  <td>
                    {who(sim, f.to.ip)} <span class="mono muted">{`${f.to.ip}:${f.to.port}`}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export const natTableSection = { id: 'nat-table', slot: 'settings' as const, Section: NatTable };
