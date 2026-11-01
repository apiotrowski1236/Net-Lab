import { useEffect, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import { overridePasswordMatches } from '../store/override';
import { flushSaves } from '../store/storage';
import { Icon } from './icons';

/**
 * Teacher override: unlocks Continue on a step that's stuck. The report and
 * the Google Sheet flag the step, and wrong passwords are counted there too.
 */
export function OverrideDialog({ session, onClose }: { session: LabSession; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const step = session.step;
  const number = session.progress.step + 1;

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!password.trim()) return;
    const r = session.tryOverride(password, note, overridePasswordMatches);
    flushSaves();
    setPassword('');
    if (r === 'ok') return onClose();
    const wait = Math.ceil(session.overrideWait() / 1000);
    setErr(
      r === 'wait' || wait > 0
        ? `Too many wrong passwords. Try again in ${wait} seconds.`
        : 'That password is not right. Wrong passwords are counted on the report.',
    );
    ref.current?.focus();
  };

  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form class="modal" onSubmit={submit} aria-labelledby="override-title">
        <h2 id="override-title">
          <Icon name="unlock" /> Teacher override
        </h2>
        <p class="muted">
          For teachers only. This unlocks <strong>Continue</strong> on step {number}, {step.title}, when something in the lab is broken.
        </p>
        <div class="callout warn small">
          The step's unfinished goals stay unchecked and earn no points. The report and the teacher's spreadsheet mark this step as skipped by a
          teacher. Wrong passwords show on the report too.
        </div>
        <label class="field">
          <span>Teacher password</span>
          <input ref={ref} type="password" autoComplete="off" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>What went wrong? (optional, shows on the report)</span>
          <input value={note} maxLength={200} placeholder="For example: the page never loaded" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        </label>
        {err && (
          <div class="error small" role="alert">
            {err}
          </div>
        )}
        <div class="row gap">
          <button class="btn primary" type="submit" disabled={!password.trim()}>
            Unlock this step
          </button>
          <button class="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
