import { useEffect, useRef, useState } from 'preact/hooks';
import { findLab, LABS } from '../labs';
import { applyBackup, readBackup, type ReadResult } from '../store/backup';
import { labHref } from '../routes';
import { profile } from '../store/profile';
import { peekProgress, type LabProgress } from '../store/progress';
import { Icon } from './icons';
import { when } from './Submit';

type Found = Extract<ReadResult, { ok: true }>;
type State = null | { error: string } | { found: Found; existing?: LabProgress };

const isoOf = (ms: number) => new Date(ms).toISOString();

/**
 * "Open saved work": restore a lab from a report the student downloaded.
 * See store/backup.ts for what is checked and what the teacher sees.
 */
export function OpenSavedWork() {
  const [state, setState] = useState<State>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => setState(null);

  const pick = async (e: Event) => {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = ''; // so choosing the same file again still fires
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch {
      return setState({ error: 'NetLab couldn’t read that file. Try downloading the report again.' });
    }
    const r = readBackup(text, profile.value, LABS.map((l) => l.id));
    if (!r.ok) return setState({ error: r.message });
    setState({ found: r, existing: peekProgress(profile.value.id, r.data.progress.labId) });
  };

  const restore = (found: Found) => {
    const p = applyBackup(found, profile.value);
    setState(null);
    location.hash = labHref(p.labId);
  };

  return (
    <>
      <div class="restore-row">
        <button class="btn small" onClick={() => input.current?.click()}>
          <Icon name="upload" size={14} /> Open saved work
        </button>
        <span class="muted small">Work missing? Open a NetLab report you downloaded to pick up where you left off.</span>
        <input ref={input} type="file" accept=".html,.htm,text/html" class="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={pick} />
      </div>
      {state && <RestoreDialog state={state} onClose={close} onRestore={restore} />}
    </>
  );
}

function RestoreDialog({ state, onClose, onRestore }: { state: NonNullable<State>; onClose: () => void; onRestore: (f: Found) => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setTimeout(() => ok.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if ('error' in state)
    return (
      <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div class="modal" role="alertdialog" aria-labelledby="restore-title">
          <h2 id="restore-title">
            <Icon name="warn" /> Can’t open this file
          </h2>
          <div class="callout warn" role="alert">
            {state.error}
          </div>
          <div class="row gap">
            <button ref={ok} class="btn" onClick={onClose}>
              OK
            </button>
          </div>
        </div>
      </div>
    );

  const { found, existing } = state;
  const p = found.data.progress;
  const lab = findLab(p.labId)!;
  const goalsTotal = lab.steps.reduce((n, s) => n + (s.goals?.length ?? 0), 0);
  const answers = Object.values(p.answers).filter((a) => a.value.trim()).length;
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-labelledby="restore-title">
        <h2 id="restore-title">
          <Icon name="upload" /> Open saved work?
        </h2>
        <p>
          <strong>{lab.title}</strong>, saved {when(isoOf(found.data.savedAt))}.
        </p>
        <ul class="restore-facts">
          <li>
            Step {Math.min(p.maxStep + 1, lab.steps.length)} of {lab.steps.length} reached
          </li>
          <li>
            {Object.keys(p.goals).length} of {goalsTotal} goals done
          </li>
          <li>
            {answers} {answers === 1 ? 'answer' : 'answers'}
          </li>
          {p.submittedAt && <li>Submitted {when(isoOf(p.submittedAt))}</li>}
        </ul>
        {existing && (
          <div class="callout warn small">
            This replaces your current progress on this lab (step {existing.step + 1} of {lab.steps.length}, last saved {when(isoOf(existing.updatedAt))}).
            {existing.updatedAt > p.updatedAt && <strong> Your current progress is newer than this file.</strong>}
          </div>
        )}
        <p class="muted small">Your teacher’s copy of this lab will show that it was restored from a file.</p>
        <div class="row gap">
          <button ref={ok} class="btn primary" onClick={() => onRestore(found)}>
            Open it
          </button>
          <button class="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
