import { useMemo } from 'preact/hooks';
import { shuffledOptions } from '../labs/shuffle';
import type { LabDef, ToolSpec } from '../labs/types';
import { Icon } from './icons';
import { renderMarkdown } from './markdown';

const TOOL_NAME: Record<ToolSpec['kind'], string> = {
  sniffer: 'Packet capture',
  'arp-spoof': 'ARP spoofer',
  forwarding: 'IP forwarding',
  'bgp-announce': 'Route announcer',
  'bgp-validate': 'Route origin validation',
  'static-arp': 'Lock ARP entries',
  cable: 'Cables',
  ping: 'Ping',
  'ip-config': 'IP addresses (in the inspector)',
  gateway: 'Default gateway (in the inspector)',
  'static-route': 'Static routes (in the inspector)',
  logs: 'Logs (its own tab)',
  'dns-forge': 'DNS forger',
  'resolver-defense': 'Resolver defenses',
  'mac-flood': 'MAC flooder',
  'mac-change': 'MAC changer',
  'port-security': 'Port security (in the inspector)',
  'wifi-config': 'Wi-Fi settings (in the inspector)',
  'wifi-scan': 'Wi-Fi scanner',
  'wifi-crack': 'Wi-Fi cracker',
  triangulate: 'Signal triangulation',
  'port-scan': 'Port scanner',
  'firewall-place': 'Place firewalls',
  'firewall-rules': 'Firewall rules (in the inspector)',
  'echo-tool': 'Echo tool',
  'directed-broadcast': 'Directed-broadcast setting (in the inspector)',
};

function Md({ src, labels }: { src: string; labels: Record<string, string> }) {
  const html = useMemo(() => renderMarkdown(src, labels), [src, labels]);
  return <div class="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Every step of a lab on one page, in order: the reading, the buttons, the
 * goals, and the questions (no answers). Students keep it open in a second tab
 * for reference. Teachers print it.
 */
export function Guide({ lab }: { lab: LabDef }) {
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of Object.values(lab.build().devices)) out[d.id] = d.label;
    return out;
  }, [lab]);
  const steps = lab.steps.filter((s) => s.kind !== 'submit');

  return (
    <div class="guide">
      <div class="guide-bar no-print">
        <a class="btn ghost small" href={`#/lab/${lab.id}`}>
          <Icon name="chevronLeft" size={14} /> Open the lab
        </a>
        <button class="btn small" onClick={() => window.print()}>
          <Icon name="print" size={14} /> Print
        </button>
      </div>

      <header class="guide-head">
        <div class="eyebrow">Lab guide · Unit {lab.unit}</div>
        <h1>{lab.title}</h1>
        <p class="guide-tagline">{lab.tagline}</p>
        <div class="guide-meta">
          About {lab.minutes} minutes · {steps.length} steps{lab.codehs.length > 0 && ` · CodeHS ${lab.codehs.join(', ')}`}
        </div>
        {lab.objectives.length > 0 && (
          <>
            <h2>By the end, you can</h2>
            <ul>
              {lab.objectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </>
        )}
        <nav class="guide-toc no-print" aria-label="Steps">
          <ol>
            {steps.map((s) => (
              <li key={s.id}>
                <a href={`#/guide/${lab.id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`g-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }))}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      {steps.map((s, i) => (
        <section key={s.id} id={`g-${s.id}`} class="guide-step">
          <h2>
            <span class="guide-num">{i + 1}</span> {s.title}
          </h2>
          <Md src={s.body} labels={labels} />

          {!!(s.actions?.length || s.tools?.length) && (
            <div class="guide-extras">
              {s.actions?.length ? (
                <div>
                  <b>Buttons in this step:</b> {s.actions.map((a) => a.label).join(', ')}
                </div>
              ) : null}
              {s.tools?.length ? (
                <div>
                  <b>New in the Toolkit:</b> {[...new Set(s.tools.map((t) => TOOL_NAME[t.kind]))].join(', ')}
                </div>
              ) : null}
            </div>
          )}

          {s.goals && s.goals.length > 0 && (
            <div class="guide-goals">
              <h3>Goals</h3>
              <ul>
                {s.goals.map((g) => (
                  <li key={g.id}>
                    <span class="guide-box" aria-hidden="true" />
                    <div>
                      <Md src={g.label} labels={labels} />
                      {g.hint && (
                        <div class="guide-hint">
                          <b>Hint:</b> <Md src={g.hint} labels={labels} />
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {s.questions?.map((q) => (
            <div key={q.id} class="guide-q">
              <Md src={q.prompt} labels={labels} />
              {q.kind === 'choice' ? (
                <>
                  {q.multi && <div class="muted small">Choose all that apply.</div>}
                  <ul class="guide-options">
                    {shuffledOptions(lab.id, s.id, q).map((o) => (
                      <li key={o.id}>
                        <span class={`guide-box ${q.multi ? '' : 'round'}`} aria-hidden="true" /> {o.text}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div class="guide-lines" style={{ height: `${(q.lines ?? (q.expect ? 1 : 4)) * 1.9}em` }} aria-hidden="true" />
              )}
            </div>
          ))}
        </section>
      ))}

      <footer class="guide-foot">NetLab · {lab.title} · Answers are entered and checked in the lab itself.</footer>
    </div>
  );
}
