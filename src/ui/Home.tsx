import { LABS, STUBS } from '../labs';
import { makeBackup } from '../store/backup';
import { synced } from '../store/outbox';
import { config, profile } from '../store/profile';
import { peekProgress } from '../store/progress';
import { buildReport } from '../store/report';
import { Icon } from './icons';
import { OpenSavedWork } from './Restore';
import { downloadReport } from './Submit';
import { SaveStatus, StudentChip, ThemeToggle } from './TopBar';

export function Home() {
  const who = profile.value;
  return (
    <div class="home">
      <header class="topbar">
        <a class="brand" href="#/">
          <img src="./icon.svg" alt="" width={28} height={28} />
          <span>NetLab</span>
        </a>
        <div class="topbar-title">
          <div class="tb-lab">{config.value.courseTitle}</div>
        </div>
        <SaveStatus />
        <ThemeToggle />
        <StudentChip />
      </header>
      <main class="home-main">
        <section class="hero">
          <h1>Unit 3: Securing Networks</h1>
          <p>
            Hands-on labs where you watch packets move, then play attacker and defender on a simulated network. Nothing here
            touches a real network. Everything you do is saved on this computer as you go, even offline.
          </p>
          <OpenSavedWork />
        </section>
        <div class="lab-grid">
          {LABS.map((lab) => {
            const p = peekProgress(who.id, lab.id);
            const sent = synced.value[`${who.id}:${lab.id}`];
            const status = p?.submittedAt
              ? { text: 'Submitted', tone: 'good' }
              : p
                ? { text: `In progress · step ${p.step + 1} of ${lab.steps.length}`, tone: 'info' }
                : { text: 'Not started', tone: 'muted' };
            const pct = p ? Math.round(((p.maxStep + (p.submittedAt ? 1 : 0)) / lab.steps.length) * 100) : 0;
            return (
              <div class="lab-card open" key={lab.id}>
                <div class="lab-card-top">
                  <span class={`pill ${status.tone}`}>{status.text}</span>
                  <span class="muted small">~{lab.minutes} min</span>
                </div>
                <h2>
                  {/* Stretched over the whole card, so the card is one big link. */}
                  <a class="lab-card-link" href={`#/lab/${lab.id}`}>
                    {lab.title}
                  </a>
                </h2>
                <p>{lab.tagline}</p>
                <div class="chips">
                  {lab.codehs.map((c) => (
                    <span class="tag">CodeHS {c}</span>
                  ))}
                </div>
                <div class="lab-card-progress">
                  <div style={{ width: `${pct}%` }} />
                </div>
                {sent && (
                  <div class="muted small lab-card-sent">
                    <Icon name="check" size={12} /> Teacher copy saved
                  </div>
                )}
                <div class="lab-card-foot">
                  <span class="btn primary small">
                    {p ? 'Continue' : 'Start'} <Icon name="chevronRight" size={14} />
                  </span>
                  <span class="lab-card-links">
                    {p && (
                      <button
                        class="btn ghost small"
                        title="Download your work so far. If it ever goes missing, open the file with Open saved work."
                        onClick={() => downloadReport(lab, buildReport(lab, p, who, p.submittedAt ? 'submitted' : 'in-progress'), makeBackup(p, who))}
                      >
                        <Icon name="download" size={14} /> Save backup
                      </button>
                    )}
                    <a class="btn ghost small lab-card-guide" href={`#/guide/${lab.id}`} target="_blank" rel="noopener" title="Every step on one page, for notes or printing">
                      <Icon name="book" size={14} /> Lab guide
                    </a>
                  </span>
                </div>
              </div>
            );
          })}
          {STUBS.map((s) => (
            <div class="lab-card soon" key={s.id}>
              <div class="lab-card-top">
                <span class="pill muted">Coming soon</span>
              </div>
              <h2>{s.title}</h2>
              <p>{s.tagline}</p>
              <div class="chips">
                {s.codehs.map((c) => (
                  <span class="tag">CodeHS {c}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p class="footnote muted small">
          Simulated networks only. The attacks you practice here are illegal against real networks you don't own or have
          written permission to test.
        </p>
      </main>
    </div>
  );
}
