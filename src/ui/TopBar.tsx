import { useEffect, useState } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import { hasEndpoint, outbox, synced } from '../store/outbox';
import { online, profile } from '../store/profile';
import { saveState } from '../store/storage';
import { Icon } from './icons';
import { openProfile } from './ProfileDialog';
import { theme, toggleTheme } from './theme';

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Saved" / "Offline" / "Sent to teacher" indicator. Students should never have to wonder whether work is safe. */
export function SaveStatus({ syncKey }: { syncKey?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  const s = saveState.value;
  const isOnline = online.value;
  const sent = syncKey ? synced.value[syncKey] : undefined;
  const queued = syncKey ? outbox.value.some((i) => i.key === syncKey) : false;
  return (
    <div class="save-status" aria-live="polite">
      {s.status === 'error' ? (
        <span class="ss bad" title={s.error}>
          <Icon name="warn" /> Can't save! Download your report.
        </span>
      ) : (
        <span class="ss ok" title="Everything you do is saved on this computer instantly.">
          <Icon name={s.status === 'pending' ? 'save' : 'check'} /> {s.status === 'pending' ? 'Saving…' : s.at ? `Saved ${ago(s.at)}` : 'Saved'}
        </span>
      )}
      {!isOnline && (
        <span class="ss warn" title="No internet. Keep working. Everything is saved on this computer.">
          <Icon name="cloudOff" /> Offline (still saving)
        </span>
      )}
      {isOnline && hasEndpoint() && syncKey && (
        <span class="ss muted" title="Copies of your work sent to your teacher">
          <Icon name="cloud" /> {queued ? 'Sending…' : sent ? `Teacher copy ${ago(sent.sentAt)}` : 'Not sent yet'}
        </span>
      )}
    </div>
  );
}

export function StudentChip() {
  const p = profile.value;
  return (
    <button class="student-chip" onClick={openProfile} title="Change your name or class period">
      <Icon name="user" /> {p.name ? `${p.name}${p.period ? ` · ${p.period}` : ''}` : 'Add your name'}
    </button>
  );
}

/** Switches between the dark and light themes. Shows the theme you'd switch to. */
export function ThemeToggle() {
  const next = theme.value === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;
  return (
    <button class="btn icon theme-toggle" onClick={toggleTheme} title={label} aria-label={label}>
      <Icon name={next === 'light' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

export function TopBar({ session }: { session: LabSession }) {
  void session.rev.value;
  const p = session.progress;
  const total = session.lab.steps.length;
  const done = Array.from({ length: total }, (_, i) => i).filter((i) => i < p.maxStep || (i === p.maxStep && session.stepComplete(i))).length;
  return (
    <header class="topbar">
      <a class="brand" href="#/" title="All labs">
        <img src="./icon.svg" alt="" width={28} height={28} />
        <span>NetLab</span>
      </a>
      <div class="topbar-title">
        <div class="tb-lab">{session.lab.title}</div>
        <div class="tb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div class="tb-fill" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </div>
      <SaveStatus syncKey={`${profile.value.id}:${session.lab.id}`} />
      <ThemeToggle />
      <StudentChip />
    </header>
  );
}
