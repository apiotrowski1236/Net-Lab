import { signal } from '@preact/signals';
import { findLab } from './labs';
import { Home } from './ui/Home';
import { LabPlayer } from './ui/LabPlayer';
import { ProfileDialog } from './ui/ProfileDialog';
import { Guide } from './ui/Guide';
import { TeacherPage } from './ui/TeacherPage';

const route = signal(location.hash || '#/');
window.addEventListener('hashchange', () => (route.value = location.hash || '#/'));

const LAST_KEY = 'netlab:v1:last-route';

export function App() {
  const r = route.value;
  try {
    localStorage.setItem(LAST_KEY, r);
  } catch {
    /* ignore */
  }
  let page;
  const lab = /^#\/lab\/([\w-]+)/.exec(r);
  const guide = /^#\/guide\/([\w-]+)/.exec(r);
  if (lab) {
    const def = findLab(lab[1]);
    page = def ? <LabPlayer key={def.id} lab={def} /> : <Home />;
  } else if (guide) {
    const def = findLab(guide[1]);
    // The guide is reading material: no name needed, so it prints cleanly for a teacher.
    if (def) return <Guide lab={def} />;
    page = <Home />;
  } else if (r.startsWith('#/teacher')) return <TeacherPage />;
  else page = <Home />;
  return (
    <>
      {page}
      <ProfileDialog />
    </>
  );
}

/** Reopen the lab the student was last in (e.g. after the laptop lid was closed). */
export function restoreLastRoute(): void {
  if (location.hash && location.hash !== '#/') return;
  try {
    const last = localStorage.getItem(LAST_KEY);
    if (last && last.startsWith('#/lab/')) {
      location.hash = last;
      route.value = last;
    }
  } catch {
    /* ignore */
  }
}
