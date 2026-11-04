import { labsOf, type Curriculum } from '../curricula';
import { guideHref, homeHref, labHref } from '../routes';
import { makeBackup } from '../store/backup';
import { synced } from '../store/outbox';
import { profile } from '../store/profile';
import { peekProgress } from '../store/progress';
import { buildReport } from '../store/report';
import { Icon } from './icons';
import { OpenSavedWork } from './Restore';
import { downloadReport } from './Submit';
import { SaveStatus, StudentChip, ThemeToggle } from './TopBar';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A course's home page: its labs, or a friendly note while it has none. No course yet: just the top bar, under the sign-in dialog. */
export function Home({ cur }: { cur?: Curriculum }) {
  const who = profile.value;
  const labs = cur ? labsOf(cur) : [];
  const stubs = cur?.stubs ?? [];
  return (
    <div class="home">
      <header class="topbar">
        <a class="brand" href={cur ? homeHref(cur.id) : '#/'}>
          <img src="./icon.svg" alt="" width={28} height={28} />
          <span>NetLab</span>
        </a>
        <div class="topbar-title">
          <div class="tb-lab">{cur?.title}</div>
        </div>
        <SaveStatus />
        <ThemeToggle />
        <StudentChip />
      </header>
      {cur && (
        <main class="home-main">
          <section class="hero">
            <h1>{cur.heading}</h1>
            <p>{cur.intro}</p>
            {labs.length > 0 && <OpenSavedWork />}
          </section>
          {labs.length + stubs.length === 0 ? (
            <div class="home-empty">
              <div class="home-empty-icon" aria-hidden="true">
                <Icon name="book" size={26} />
              </div>
              <h2>{cap(cur.noun)}s are on the way</h2>
              <p>
                Nothing to do here yet. When your teacher adds the first {cur.title} {cur.noun}, it shows up on this page.
              </p>
              <p class="muted small">In a different class? Switch classes in the menu under your name, at the top right.</p>
            </div>
          ) : (
            <div class="lab-grid">
              {labs.map((lab) => {
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
                      <a class="lab-card-link" href={labHref(lab.id)}>
                        {lab.title}
                      </a>
                    </h2>
                    <p>{lab.tagline}</p>
                    <div class="chips">
                      {(lab.codehs ?? []).map((c) => (
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
                        <a
                          class="btn ghost small lab-card-guide"
                          href={guideHref(lab.id)}
                          target="_blank"
                          rel="noopener"
                          title="Every step on one page, for notes or printing"
                        >
                          <Icon name="book" size={14} /> {cap(cur.noun)} guide
                        </a>
                      </span>
                    </div>
                  </div>
                );
              })}
              {stubs.map((s) => (
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
          )}
          {cur.footnote && <p class="footnote muted small">{cur.footnote}</p>}
        </main>
      )}
    </div>
  );
}
