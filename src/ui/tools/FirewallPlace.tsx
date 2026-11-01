import { useState } from 'preact/hooks';
import type { PlacementFeedback } from '../../labs/types';
import type { Sim } from '../../sim/sim';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';

/** Cables a firewall can go into: every cable that doesn't already touch a firewall. */
export function placeableCables(sim: Sim): [string, string][] {
  const out: [string, string][] = [];
  for (const l of Object.values(sim.links)) {
    const a = sim.devices[l.a.device];
    const b = sim.devices[l.b.device];
    if (!a || !b || a.kind === 'firewall' || b.kind === 'firewall') continue;
    out.push([a.id, b.id]);
  }
  const name = ([a, b]: [string, string]) => `${sim.devices[a].label} ${sim.devices[b].label}`;
  return out.sort((x, y) => name(x).localeCompare(name(y)));
}

/** Which end of the cable a-b is closer to `internet` (counting cables, not crossing this one). */
export function outsideEnd(sim: Sim, a: string, b: string, internet: string): string {
  const dist = new Map<string, number>([[internet, 0]]);
  const queue = [internet];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const l of Object.values(sim.links)) {
      const ends = [l.a.device, l.b.device];
      if (!ends.includes(cur)) continue;
      if (ends.includes(a) && ends.includes(b)) continue;
      const next = l.a.device === cur ? l.b.device : l.a.device;
      if (dist.has(next)) continue;
      dist.set(next, dist.get(cur)! + 1);
      queue.push(next);
    }
  }
  return (dist.get(a) ?? Infinity) <= (dist.get(b) ?? Infinity) ? a : b;
}

export function placementFeedback(list: PlacementFeedback[] | undefined, fwId: string, a: string, b: string): PlacementFeedback | undefined {
  return list?.find((f) => (!f.device || f.device === fwId) && f.between.includes(a) && f.between.includes(b));
}

/** Put standalone firewalls into cables, and take them out again. */
export function FirewallPlaceTool({ session, spec, onSelect }: ToolCardProps<'firewall-place'>) {
  void session.simRev.value;
  const sim = session.sim;
  const cables = placeableCables(sim);
  const label = ([a, b]: [string, string]) => `${sim.devices[a].label} and ${sim.devices[b].label}`;
  return (
    <div class="tool-card defend">
      <div class="tool-title">
        <Icon name="shield" /> Place firewalls
      </div>
      <p class="tool-desc">
        Pick a cable for each firewall. It goes into the middle of that cable, so every packet on the cable has to pass its rules. Its{' '}
        <strong>outside</strong> port faces the internet.
      </p>
      {spec.devices.map((id) => (
        <PlaceRow key={id} session={session} fwId={id} cables={cables} label={label} feedback={spec.feedback} internet={spec.internet} onSelect={onSelect} />
      ))}
    </div>
  );
}

function PlaceRow(props: {
  session: ToolCardProps['session'];
  fwId: string;
  cables: [string, string][];
  label: (c: [string, string]) => string;
  feedback?: PlacementFeedback[];
  internet: string;
  onSelect: (id: string) => void;
}) {
  const { session, fwId, cables, label, feedback, internet, onSelect } = props;
  const sim = session.sim;
  const box = sim.devices[fwId];
  const placed = box.firewall?.placed;
  const [pick, setPick] = useState('');
  if (placed) {
    const fb = placementFeedback(feedback, fwId, placed.a.device, placed.b.device);
    return (
      <div class="place-row">
        <div class="tool-row">
          <span>
            <button class="link-btn" onClick={() => onSelect(fwId)}>
              <strong>{box.label}</strong>
            </button>{' '}
            sits between {sim.devices[placed.a.device].label} (outside) and {sim.devices[placed.b.device].label} (inside).
          </span>
          <button class="btn tiny ghost" onClick={() => session.dispatch({ type: 'fw-unplace', device: fwId })}>
            Take out
          </button>
        </div>
        {fb && (
          <div class={`callout small ${fb.good ? 'good' : 'warn'}`}>
            <Icon name={fb.good ? 'check' : 'warn'} size={14} /> {fb.text}
          </div>
        )}
      </div>
    );
  }
  const place = () => {
    const [a, b] = pick.split('~');
    if (!a || !b) return;
    session.dispatch({ type: 'fw-place', device: fwId, a, b, outside: outsideEnd(sim, a, b, internet) });
    setPick('');
  };
  return (
    <div class="place-row">
      <div class="sentence">
        Put <strong>{box.label}</strong> between
        <select value={pick} onChange={(e) => setPick((e.target as HTMLSelectElement).value)} aria-label={`Cable for ${box.label}`}>
          <option value="">choose a cable…</option>
          {cables.map((c) => (
            <option key={c.join('~')} value={c.join('~')}>
              {label(c)}
            </option>
          ))}
        </select>
        <button class="btn" disabled={!pick} onClick={place}>
          Place
        </button>
      </div>
    </div>
  );
}
