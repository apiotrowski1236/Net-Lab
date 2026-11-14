import { guideHref, labHref } from '../routes';
import { useMemo } from 'preact/hooks';
import { shuffledOptions } from '../labs/shuffle';
import { isLesson, isWorksheet, type LabDef, type StepDef, type ToolSpec } from '../labs/types';
import { Icon } from './icons';
import { renderMarkdown, type MdActions } from './markdown';
import { DEMO_NAME } from './demos/registry';

const TOOL_NAME: Record<ToolSpec['kind'], string> = {
  sniffer: 'Packet capture',
  capture: 'Packet capture: Start, Stop, and filters (in the Capture tab)',
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
  // segmentation
  vlan: 'VLANs (in the inspector)',
  'zone-plan': 'Zone plan',
  'zone-policy': 'Zone policy (in the inspector)',
  // net-audit
  scanner: 'Vulnerability scanner',
  'risk-register': 'Risk register',
  hardening: 'Security settings (in the inspector)',
  // logs
  ids: 'Detection (in the inspector)',
  siem: 'SIEM incidents (in the inspector)',
  'ai-threshold': 'AI threshold (in the inspector)',
  bench: 'Detection bench',
  'analyst-queue': 'Analyst queue',
  'bench-plan': 'Detection plan',
  // smurf
  'echo-tool': 'Echo tool',
  // net-tools
  terminal: 'Terminal',
  'directed-broadcast': 'Directed-broadcast setting (in the inspector)',
};

function Md({ src, labels, actions }: { src: string; labels: Record<string, string>; actions?: MdActions }) {
  const html = useMemo(() => renderMarkdown(src, labels, actions), [src, labels, actions]);
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
    for (const d of Object.values(lab.build?.().devices ?? {})) out[d.id] = d.label;
    return out;
  }, [lab]);
  const steps = lab.steps.filter((s) => s.kind !== 'submit');
  // An answer sheet's sections are lettered in their titles ("A. Examine the Recon File"), and its questions numbered like the handout.
  const sheet = isWorksheet(lab);

  return (
    <div class="guide">
      <div class="guide-bar no-print">
        <a class="btn ghost small" href={labHref(lab.id)}>
          <Icon name="chevronLeft" size={14} /> {sheet ? 'Open the answer sheet' : isLesson(lab) ? 'Open the lesson' : 'Open the lab'}
        </a>
        <button class="btn small" onClick={() => window.print()}>
          <Icon name="print" size={14} /> Print
        </button>
      </div>

      <header class="guide-head">
        <div class="eyebrow">
          {sheet ? 'Answer sheet' : isLesson(lab) ? 'Lesson guide' : 'Lab guide'}
          {lab.unit !== 0 && ` · Unit ${lab.unit}`}
        </div>
        <h1>{lab.title}</h1>
        <p class="guide-tagline">{lab.tagline}</p>
        <div class="guide-meta">
          About {lab.minutes} minutes · {steps.length} {sheet ? 'sections' : 'steps'}
          {lab.worksheet && ` · Done on ${lab.worksheet.where}`}
          {lab.codehs.length > 0 && ` · CodeHS ${lab.codehs.join(', ')}`}
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
                <a href={guideHref(lab.id)} onClick={(e) => (e.preventDefault(), document.getElementById(`g-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }))}>
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
            {!sheet && <span class="guide-num">{i + 1}</span>} {s.title}
          </h2>
          <Md src={s.body} labels={labels} actions={{ labels: Object.fromEntries((s.actions ?? []).map((a) => [a.id, a.label])), live: false }} />

          {!!(s.actions?.length || stepTools(s).length || s.demos?.length) && (
            <div class="guide-extras">
              {s.demos?.length ? (
                <div>
                  <b>On screen in this step:</b> {s.demos.map((d) => d.title || DEMO_NAME[d.kind]).join(', ')}
                </div>
              ) : null}
              {s.actions?.length ? (
                <div>
                  <b>Buttons in this step:</b> {s.actions.map((a) => a.label).join(', ')}
                </div>
              ) : null}
              {stepTools(s).length ? (
                <div>
                  <b>Tools in this step:</b> {stepTools(s).join(', ')}
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
            <div key={q.id} class={`guide-q ${q.label ? 'numbered' : ''}`}>
              {q.label && <b class="guide-qnum">{q.label}.</b>}
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
                <div class="guide-lines" style={{ height: `${(q.short ? 1 : (q.lines ?? (q.expect ? 1 : 4))) * 1.9}em` }} aria-hidden="true" />
              )}
            </div>
          ))}
        </section>
      ))}

      <footer class="guide-foot">
        NetLab · {lab.title} · {sheet ? 'Students type their answers into the answer sheet on NetLab.' : 'Answers are entered and checked in the lab itself.'}
      </footer>
    </div>
  );
}

/** The tools a step offers, by name (each kind once). */
function stepTools(s: StepDef): string[] {
  return [...new Set((s.tools ?? []).map((t) => TOOL_NAME[t.kind]))];
}
