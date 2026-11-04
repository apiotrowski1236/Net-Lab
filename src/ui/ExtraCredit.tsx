import { useState } from 'preact/hooks';
import { answerKey, goalKey } from '../labs/types';
import type { LabSession } from '../runtime/session';
import { hasEndpoint } from '../store/outbox';
import { profile } from '../store/profile';
import { Icon } from './icons';
import { handIn, handInWhere, reportFileName } from './Submit';

/** The last time the student reached a goal or changed an answer in an extra-credit step (0 if never). */
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

/** The hand-in button for extra-credit steps, and what happened after it was pressed. */
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
        onClick={() => {
          handIn(session);
          setDone(true);
        }}
      >
        <Icon name={endpoint ? 'send' : 'download'} size={14} /> {label}
      </button>
      {done && (
        <p class="extra-status" role="status">
          {endpoint ? (
            'Sent to your teacher with your extra credit.'
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

/** Top of every extra-credit step: it's optional, and hand in (again) to get credit. */
export function ExtraCreditBanner({ session }: { session: LabSession }) {
  void session.rev.value;
  const p = session.progress;
  const extras = session.lab.steps.filter((s) => s.extra);
  const k = extras.indexOf(session.lab.steps[p.step]) + 1;
  const endpoint = hasEndpoint();
  const fresh = lastExtraWork(session) > (p.submittedAt ?? 0);
  const where = extras.length > 1 ? `, step ${k} of ${extras.length}` : '';

  let text: string;
  let label: string;
  if (!p.submittedAt) {
    text = `${extras.length > 1 ? 'These steps are' : 'This step is'} optional. You haven't handed in your work yet. If class is almost over, hand it in now. You can come back here after.`;
    label = endpoint ? 'Submit my work now' : 'Download my report now';
  } else if (fresh) {
    text = "You've done extra credit since you last handed in. Hand in your report again so your teacher sees it.";
    label = endpoint ? 'Submit again with my extra credit' : 'Download my updated report';
  } else {
    text = `${extras.length > 1 ? 'These steps are' : 'This step is'} optional. When you finish, hand in your report again so it shows your extra credit.`;
    label = endpoint ? 'Submit again' : 'Download my report again';
  }
  return (
    <div class="callout info extra-credit">
      <p>
        <Icon name="trophy" size={14} /> <strong>Extra credit{where}.</strong> {text}
      </p>
      <HandInAgain key={`${p.step}:${label}`} session={session} label={label} />
    </div>
  );
}

/** Bottom of the last extra-credit step, once it's done: hand in the updated report. */
export function ExtraCreditDone({ session }: { session: LabSession }) {
  void session.rev.value;
  const p = session.progress;
  if (lastExtraWork(session) <= (p.submittedAt ?? 0)) {
    return (
      <div class="callout good extra-credit">
        <Icon name="check" size={14} /> <strong>You finished the extra credit.</strong> Your latest report includes it.
        {!hasEndpoint() && ` If you haven't yet, ${handInWhere()}.`}
      </div>
    );
  }
  return (
    <div class="callout good extra-credit">
      <p>
        <Icon name="trophy" size={14} /> <strong>You finished the extra credit.</strong> Hand in your updated report so your teacher sees it.
      </p>
      <HandInAgain session={session} label={hasEndpoint() ? 'Submit again with my extra credit' : 'Download my updated report'} />
    </div>
  );
}
