import { useState } from 'preact/hooks';
import { answerKey, goalKey } from '../labs/types';
import type { LabSession } from '../runtime/session';
import { hasEndpoint } from '../store/outbox';
import { profile } from '../store/profile';
import { Icon } from './icons';
import { handIn, handInWhere, reportFileName } from './Submit';

/** The last time the student reached a goal or changed an answer in an optional extra challenge step (0 if never). */
export function lastExtraWork(session: LabSession): number {
  const p = session.progress;
  let t = 0;
  for (const s of session.lab.steps) {
    if (!s.extra) continue;
    for (const g of s.goals ?? []) t = Math.max(t, p.goals[goalKey(s.id, g.id)] ?? 0);
    for (const q of s.questions ?? []) t = Math.max(t, p.answers[answerKey(s.id, q.id)]?.updatedAt ?? 0);
  }
  return t;
}

/** The hand-in button for optional extra challenge steps, and what happened after it was pressed. */
function HandInAgain({ session, label }: { session: LabSession; label: string }) {
  const [done, setDone] = useState(false);
  const who = profile.value;
  const endpoint = hasEndpoint();
  return (
    <div class="extra-hand-in">
      <button
        class="btn small primary"
        disabled={!who.name.trim()}
        title={who.name.trim() ? '' : 'Add your name (top right) first'}
        onClick={(e) => {
          const box = e.currentTarget.closest<HTMLElement>('.extra-challenge');
          handIn(session);
          setDone(true);
          // Handing in can replace this button. Keep keyboard focus in the same box.
          requestAnimationFrame(() => {
            if (document.activeElement && document.activeElement !== document.body) return;
            const target = box?.isConnected ? box : [...document.querySelectorAll<HTMLElement>('.extra-challenge')].pop();
            (target?.querySelector<HTMLElement>('button') ?? target)?.focus();
          });
        }}
      >
        <Icon name={endpoint ? 'send' : 'download'} size={14} /> {label}
      </button>
      {done && (
        <p class="extra-status" role="status">
          {endpoint ? (
            'Sent to your teacher with your challenge work.'
          ) : (
            <>
              Your report downloaded as <strong>{reportFileName(who.name, session.lab.title)}</strong>. Now {handInWhere()}, the same way as before.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Top of every optional extra challenge step: it earns no points, and hand in (again) so the teacher sees it. */
export function ExtraChallengeBanner({ session }: { session: LabSession }) {
  void session.rev.value;
  const p = session.progress;
  const extras = session.lab.steps.filter((s) => s.extra);
  const k = extras.indexOf(session.lab.steps[p.step]) + 1;
  const endpoint = hasEndpoint();
  const fresh = lastExtraWork(session) > (p.submittedAt ?? 0);
  // The box at the bottom of the last step takes over, with the same button.
  const below = fresh && k === extras.length && session.stepComplete(p.step);
  const where = extras.length > 1 ? `, step ${k} of ${extras.length}` : '';
  const noPoints = extras.length > 1 ? 'These steps earn no points.' : 'This step earns no points.';

  let text: string;
  let label: string;
  if (!p.submittedAt) {
    text = `${noPoints} You haven't handed in your work yet. If class is almost over, hand it in now. You can come back here after.`;
    label = endpoint ? 'Submit my work now' : 'Download my report now';
  } else if (below) {
    text = 'You finished the challenge. Scroll to the bottom of this step to hand in your updated report.';
    label = '';
  } else if (fresh) {
    text = `You've worked on the challenge since your last report. ${endpoint ? 'If class is almost over, hand in your report again now.' : `If class is almost over, download it again now, then ${handInWhere()}.`}`;
    label = endpoint ? 'Submit again with my challenge work' : 'Download my updated report';
  } else {
    text = `${noPoints} ${
      endpoint
        ? 'You already handed in your report. If you change any of your work, here or on an earlier step, hand it in again.'
        : `You already downloaded your report. Make sure you ${handInWhere()}. If you change any of your work, here or on an earlier step, download it again and hand in the new file.`
    }`;
    label = endpoint ? 'Submit again' : 'Download my report again';
  }
  return (
    <div class="callout info extra-challenge" tabIndex={-1}>
      <p>
        <Icon name="trophy" size={14} /> <strong>Optional extra challenge{where}.</strong> {text}
      </p>
      {label && <HandInAgain key={`${p.step}:${label}`} session={session} label={label} />}
    </div>
  );
}

/** Bottom of the last optional extra challenge step, once it's done: hand in the updated report. */
export function ExtraChallengeDone({ session }: { session: LabSession }) {
  void session.rev.value;
  const p = session.progress;
  if (lastExtraWork(session) <= (p.submittedAt ?? 0)) {
    return (
      <div class="callout good extra-challenge" tabIndex={-1}>
        <Icon name="check" size={14} /> <strong>You finished the extra challenge.</strong> Your latest report includes it. If you change anything after this, hand in again.
        {!hasEndpoint() && ` Make sure you ${handInWhere()}.`}
      </div>
    );
  }
  return (
    <div class="callout good extra-challenge" tabIndex={-1}>
      <p>
        <Icon name="trophy" size={14} /> <strong>You finished the extra challenge.</strong> Hand in your updated report so your teacher sees it.
      </p>
      <HandInAgain session={session} label={hasEndpoint() ? 'Submit again with my challenge work' : 'Download my updated report'} />
    </div>
  );
}
