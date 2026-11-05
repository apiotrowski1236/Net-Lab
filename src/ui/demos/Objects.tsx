import type { ObjectsState } from '../../demos/objects';
import type { ObjectsSpec } from '../../demos/types';
import type { DemoViewProps } from './parts';

/** One class and the objects made from it. Each object keeps its own data. */
export function ObjectsView({ spec, state: s, send }: DemoViewProps<ObjectsSpec, ObjectsState>) {
  const next = spec.make[s.health.length];
  return (
    <div class="objects">
      <div class="objects-top">
        <div class="objects-class">
          <div class="objects-kicker">Class (the blueprint)</div>
          <h4>{spec.cls}</h4>
          <dl>
            <dt>Attributes</dt>
            <dd>name, health</dd>
            <dt>Behaviors</dt>
            <dd>takeDamage</dd>
          </dl>
          <button class="btn primary small" disabled={!next} onClick={() => send({ make: true })}>
            new {spec.cls}
          </button>
        </div>
        <div class="objects-made" aria-live="polite">
          {s.health.length === 0 && <p class="objects-none">No objects yet. A class alone is only a plan.</p>}
          {s.health.map((h, i) => {
            const o = spec.make[i];
            return (
              <div class="objects-card" key={o.name}>
                <div class="objects-kicker">Object</div>
                <h4>{o.name}</h4>
                <dl>
                  <dt>name</dt>
                  <dd>
                    <code>"{o.label}"</code>
                  </dd>
                  <dt>health</dt>
                  <dd>
                    <code>{h}</code>
                  </dd>
                </dl>
                <button class="btn small" disabled={h <= 0} onClick={() => send({ hit: i })}>
                  takeDamage({spec.hit})
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {s.log.length > 0 && (
        <div class="objects-log">
          <div class="demo-label">The same thing in code</div>
          <pre>{s.log.join('\n')}</pre>
        </div>
      )}
    </div>
  );
}
