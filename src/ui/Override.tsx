import { useEffect, useRef, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import { flushSaves } from '../store/storage';
import { Icon } from './icons';

/**
 * Override: rapid clicks on an unfinished step's Continue button offer to skip
 * the step. The report and the Google Sheet show the step as not completed,
 * with the student's reason, and the teacher decides if the skip was approved.
 *
 * Clicking outside doesn't close this, and the reason is required, so the last
 * few rapid clicks can't dismiss or confirm the dialog they opened.
 */
export function OverrideDialog({ session, onClose }: { session: LabSession; onClose: () => void }) {
  const [note, setNote] = useState('');
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
    if (!note.trim()) return;
    session.skipStep(note);
    flushSaves();
    onClose();
  };

  return (
    <div class="modal-back">
      <form class="modal" onSubmit={submit} aria-labelledby="override-title">
        <h2 id="override-title">
          <Icon name="unlock" /> Override and skip this step?
        </h2>
        <p class="muted">
          Stuck on step {number}, {step.title}? You can override it and move on to the next step.
        </p>
        <div class="callout warn small">
          You will not get credit for a step you skip this way without permission from your teacher. Your report will show this step as not completed, with
          your reason.
        </div>
        <label class="field">
          <span>Why are you skipping this step? (required)</span>
          <input ref={ref} value={note} maxLength={200} placeholder="For example: the page never loaded" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        </label>
        <div class="row gap">
          <button class="btn primary" type="submit" disabled={!note.trim()}>
            Override and skip
          </button>
          <button class="btn ghost" type="button" onClick={onClose}>
            Keep working
          </button>
        </div>
      </form>
    </div>
  );
}
