import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { classOf, CURRICULA, curriculumOfLab } from '../curricula';
import { isWorksheet } from '../labs/types';
import { homeHref } from '../routes';
import type { LabSession } from '../runtime/session';
import { hasEndpoint, outbox, synced } from '../store/outbox';
import { config, online, profile, updateProfile } from '../store/profile';
import { questionsAnswered } from '../store/progress';
import { saveState } from '../store/storage';
import { Icon } from './icons';
import { openProfile, switchStudent } from './ProfileDialog';
import { theme, toggleTheme } from './theme';
import { debug, debugAvailable, toggleDebug } from './debug';

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

/**
 * The student's name, top right. Opens a menu: switch class, change name, or
 * sign in as a different student. Keyboard: Enter, Space, or Down opens it;
 * Up/Down/Home/End move; Escape closes it and returns to the name.
 */
export function StudentChip() {
  const p = profile.value;
  const periods = config.value.periods.length > 0;
  const mine = classOf(p);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const items = () => Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) chip.current?.focus();
  };

  // A layout effect, so focus is in the menu by the time it shows.
  useLayoutEffect(() => {
    if (!open) return;
    // Start on the student's class, like a select.
    (items().find((el) => el.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);

  if (!p.name.trim()) {
    return (
      <button class="student-chip" onClick={openProfile} title="Add your name">
        <Icon name="user" /> Add your name
      </button>
    );
  }

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' && e.target === chip.current) (e.preventDefault(), setOpen(true));
      return;
    }
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const to = (n: number) => (e.preventDefault(), list[(n + list.length) % list.length]?.focus());
    if (e.key === 'Escape') (e.preventDefault(), close());
    else if (e.key === 'ArrowDown') to(i + 1);
    else if (e.key === 'ArrowUp') to(i < 0 ? list.length - 1 : i - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(list.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };
  const choose = (id: string) => {
    if (id !== mine?.id) updateProfile({ curriculum: id });
    close();
    location.hash = homeHref(id);
  };

  return (
    <div class="student-menu" ref={wrap} onKeyDown={onKey}>
      <button
        ref={chip}
        class="student-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'student-menu-list' : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="user" /> <span class="student-chip-name">{`${p.name}${periods && p.period ? ` · ${p.period}` : ''}`}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div class="menu" role="menu" id="student-menu-list" aria-label={`${p.name}: class and name`}>
          <div class="menu-label" role="presentation">
            Your class
          </div>
          {CURRICULA.map((c) => (
            <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === mine?.id} tabIndex={-1} class="menu-item" onClick={() => choose(c.id)}>
              <span class="menu-check" aria-hidden="true">
                {c.id === mine?.id && <Icon name="check" size={14} />}
              </span>
              {c.title}
            </button>
          ))}
          <div class="menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            class="menu-item"
            onClick={() => {
              close(false);
              openProfile();
            }}
          >
            <span class="menu-check" aria-hidden="true">
              <Icon name="edit" size={14} />
            </span>
            Change name
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            class="menu-item"
            onClick={() => {
              close();
              switchStudent();
            }}
          >
            <span class="menu-check" aria-hidden="true">
              <Icon name="users" size={14} />
            </span>
            I'm a different student
          </button>
        </div>
      )}
    </div>
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

/** Turns debug mode on and off. Only the dev server shows it. */
export function DebugToggle() {
  if (!debugAvailable) return null;
  const on = debug.value;
  return (
    <button class={`btn small debug-toggle ${on ? 'on' : ''}`} onClick={toggleDebug} aria-pressed={on} title={on ? 'Debug mode is on: every step is unlocked. Click to turn it off.' : 'Debug mode: unlock every step and skip steps'}>
      <Icon name="unlock" size={14} /> Debug{on ? ' on' : ''}
    </button>
  );
}

export function TopBar({ session }: { session: LabSession }) {
  void session.rev.value;
  const p = session.progress;
  // An answer sheet has no steps to work through: its bar fills as questions get answers.
  const { done, total } = isWorksheet(session.lab)
    ? questionsAnswered(session.lab, p)
    : {
        done: session.lab.steps.filter((_, i) => i < p.maxStep || (i === p.maxStep && session.stepComplete(i))).length,
        total: session.lab.steps.length,
      };
  const cur = curriculumOfLab(session.lab.id);
  return (
    <header class="topbar">
      <a class="brand" href={homeHref(cur.id)} title={`All ${cur.title} ${cur.noun}s`}>
        <img src="./icon.svg" alt="" width={28} height={28} />
        <span>NetLab</span>
      </a>
      <div class="topbar-title">
        <div class="tb-lab">{session.lab.title}</div>
        <div class="tb-progress" role="progressbar" aria-label={isWorksheet(session.lab) ? 'Questions answered' : 'Steps done'} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div class="tb-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      </div>
      <SaveStatus syncKey={`${profile.value.id}:${session.lab.id}`} />
      <DebugToggle />
      <ThemeToggle />
      <StudentChip />
    </header>
  );
}
