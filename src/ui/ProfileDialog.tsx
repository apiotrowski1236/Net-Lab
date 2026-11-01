import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { config, profile, updateProfile } from '../store/profile';
import { saveNow } from '../store/storage';

const open = signal(false);
export const openProfile = () => (open.value = true);

export function ProfileDialog() {
  const p = profile.value;
  const mustAsk = !p.name.trim();
  const show = open.value || mustAsk;
  const [name, setName] = useState(p.name);
  const [period, setPeriod] = useState(p.period);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (show) {
      setName(profile.value.name);
      setPeriod(profile.value.period);
      setTimeout(() => ref.current?.focus(), 30);
    }
  }, [show]);
  if (!show) return null;
  const periods = config.value.periods;
  const save = (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    updateProfile({ name: name.trim(), period: period.trim() });
    open.value = false;
  };
  return (
    <div class="modal-back">
      <form class="modal" onSubmit={save}>
        <h2>{mustAsk ? 'Welcome to NetLab' : 'Your name'}</h2>
        <p class="muted">Your teacher sees this on your lab report. Your work is saved on this computer as you go.</p>
        <label class="field">
          <span>First and last name</span>
          <input ref={ref} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autocomplete="name" required />
        </label>
        <label class="field">
          <span>Class period</span>
          {periods.length ? (
            <select value={period} onChange={(e) => setPeriod((e.target as HTMLSelectElement).value)}>
              <option value="">Choose…</option>
              {periods.map((x) => (
                <option value={x}>{x}</option>
              ))}
            </select>
          ) : (
            <input value={period} onInput={(e) => setPeriod((e.target as HTMLInputElement).value)} placeholder="e.g. Period 3" />
          )}
        </label>
        <div class="row between">
          {!mustAsk ? (
            <button
              type="button"
              class="btn ghost small"
              onClick={() => {
                if (!confirm('Start fresh as a different student on this computer? The current student’s work stays saved here, but you will not see it.')) return;
                const bytes = new Uint8Array(8);
                crypto.getRandomValues(bytes);
                const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
                profile.value = { id, name: '', period: '', createdAt: Date.now() };
                saveNow('profile', profile.value);
                open.value = false;
                location.hash = '#/';
              }}
            >
              I'm a different student
            </button>
          ) : (
            <span />
          )}
          <div class="row gap-sm">
            {!mustAsk && (
              <button type="button" class="btn ghost" onClick={() => (open.value = false)}>
                Cancel
              </button>
            )}
            <button class="btn primary" disabled={!name.trim()}>
              {mustAsk ? 'Start' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
