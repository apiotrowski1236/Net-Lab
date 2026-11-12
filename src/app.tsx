import { signal } from '@preact/signals';
import { isWorksheet } from './labs/types';
import { isLabRoute, pageHref, parseRoute } from './routes';
import { profile } from './store/profile';
import { Guide } from './ui/Guide';
import { Home } from './ui/Home';
import { LabPlayer } from './ui/LabPlayer';
import { ProfileDialog } from './ui/ProfileDialog';
import { TeacherPage } from './ui/TeacherPage';
import { WorksheetPlayer } from './ui/Worksheet';

const route = signal(location.hash || '#/');

const LAST_KEY = 'netlab:v1:last-route';

/** Show a route, correcting old addresses (#/lab/<id>) in place so Back doesn't bounce. */
function setRoute(hash: string): void {
  const h = hash || '#/';
  const target = pageHref(parseRoute(h, profile.value), h);
  if (target !== location.hash) history.replaceState(history.state, '', location.href.split('#')[0] + target);
  route.value = target;
  try {
    localStorage.setItem(LAST_KEY, target);
  } catch {
    /* ignore */
  }
}
window.addEventListener('hashchange', () => setRoute(location.hash));

export function App() {
  const page = parseRoute(route.value, profile.value);
  document.title =
    page.kind === 'lab' || page.kind === 'guide' ? `${page.lab.title} · NetLab` : page.kind === 'home' && page.cur ? `NetLab · ${page.cur.title}` : 'NetLab';
  if (page.kind === 'teacher') return <TeacherPage />;
  // The guide is reading material: no name needed, so it prints cleanly for a teacher.
  if (page.kind === 'guide') return <Guide lab={page.lab} />;
  return (
    <>
      {page.kind === 'lab' ? (
        isWorksheet(page.lab) ? (
          <WorksheetPlayer key={page.lab.id} lab={page.lab} />
        ) : (
          <LabPlayer key={page.lab.id} lab={page.lab} />
        )
      ) : (
        <Home cur={page.cur} />
      )}
      <ProfileDialog suggest={page.cur?.id} onHome={page.kind === 'home'} />
    </>
  );
}

/** Reopen the lab the student was last in (e.g. after the laptop lid was closed). Call once, before the first render. */
export function restoreLastRoute(): void {
  let h = location.hash;
  if (!h || h === '#/') {
    try {
      const last = localStorage.getItem(LAST_KEY);
      if (last && isLabRoute(last)) h = last;
    } catch {
      /* ignore */
    }
  }
  setRoute(h);
}
