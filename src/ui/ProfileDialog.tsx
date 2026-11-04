import { signal } from '@preact/signals';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { classOf, CURRICULA } from '../curricula';
import { homeHref } from '../routes';
import { config, profile, updateProfile } from '../store/profile';
import { saveNow } from '../store/storage';

const open = signal(false);
export const openProfile = () => (open.value = true);

/** Start fresh as a new student on this computer. The old student's work stays saved under their id. */
export function switchStudent(): void {
  if (!confirm('Start fresh as a different student on this computer? The current student’s work stays saved here, but you will not see it.')) return;
  const last = classOf(profile.value);
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  profile.value = { id, name: '', period: '', createdAt: Date.now() };
  saveNow('profile', profile.value);
  open.value = false;
  // Most likely the same class (a shared classroom computer): it starts out picked, and the student can change it.
  location.hash = last ? homeHref(last.id) : '#/';
}

/**
 * Sign-in: name, class, and (if the teacher listed them) period. It can't be
 * closed until the student has a name. Later it only changes the name and
 * period; the class menu under the name (TopBar) switches classes.
 *
 * `suggest`: the course of the page behind the dialog, picked in advance for a
 * first-time student who followed a link to it. `onHome`: that page is a home
 * page, so choosing a different class goes to that class's home page.
 */
export function ProfileDialog({ suggest, onHome }: { suggest?: string; onHome?: boolean }) {
  const p = profile.value;
  const mustAsk = !p.name.trim();
  const askClass = mustAsk || !classOf(p);
  const show = open.value || mustAsk;
  const [name, setName] = useState(p.name);
  const [period, setPeriod] = useState(p.period);
  const [cls, setCls] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (show) {
      setName(profile.value.name);
      setPeriod(profile.value.period);
      setCls(classOf(profile.value)?.id ?? suggest ?? '');
      setTimeout(() => ref.current?.focus(), 30);
    }
  }, [show]);
  // A first-time student who opens a different course's link before signing in.
  useLayoutEffect(() => {
    if (show && askClass && suggest) setCls(suggest);
  }, [suggest]);
  if (!show) return null;
  const periods = config.value.periods;
  const ready = !!name.trim() && (!askClass || !!cls);
  const save = (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    const patch: Partial<typeof p> = { name: name.trim(), period: periods.length ? period.trim() : '' };
    if (askClass) patch.curriculum = cls;
    updateProfile(patch);
    open.value = false;
    if (askClass && onHome) location.hash = homeHref(cls);
  };
  const close = () => (open.value = false);
  return (
    <div class="modal-back">
      <form
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onSubmit={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !mustAsk) close();
        }}
      >
        <h2 id="profile-title">{mustAsk ? 'Welcome to NetLab' : 'Your name'}</h2>
        <p class="muted">Your teacher sees this on the work you hand in. Your work is saved on this computer as you go.</p>
        <label class="field">
          <span>First and last name</span>
          <input ref={ref} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autocomplete="name" required />
        </label>
        {askClass && (
          <fieldset class="class-pick">
            <legend>Your class</legend>
            {CURRICULA.map((c) => (
              <label key={c.id} class={`class-option ${cls === c.id ? 'on' : ''}`}>
                <input type="radio" name="curriculum" value={c.id} checked={cls === c.id} onChange={() => setCls(c.id)} />
                <span>{c.title}</span>
              </label>
            ))}
          </fieldset>
        )}
        {periods.length > 0 && (
          <label class="field">
            <span>Class period</span>
            <select value={period} onChange={(e) => setPeriod((e.target as HTMLSelectElement).value)}>
              <option value="">Choose…</option>
              {periods.map((x) => (
                <option value={x}>{x}</option>
              ))}
            </select>
          </label>
        )}
        <div class="row between">
          <span class="muted small">{askClass && !cls && name.trim() ? 'Choose your class to start.' : ''}</span>
          <div class="row gap-sm">
            {!mustAsk && (
              <button type="button" class="btn ghost" onClick={close}>
                Cancel
              </button>
            )}
            <button class="btn primary" disabled={!ready}>
              {mustAsk ? 'Start' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
