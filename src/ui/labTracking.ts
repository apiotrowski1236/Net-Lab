import { useEffect } from 'preact/hooks';
import type { LabSession } from '../runtime/session';
import { beacon, enqueue, hasEndpoint } from '../store/outbox';
import { config, profile } from '../store/profile';
import { buildReport } from '../store/report';
import { flushSaves } from '../store/storage';

/**
 * Active-time tracking for the report: counts 15s slices while the tab is
 * visible and the student did something in the last two minutes.
 */
export function useActiveTime(session: LabSession): void {
  useEffect(() => {
    let lastInput = Date.now();
    const mark = () => (lastInput = Date.now());
    const evs = ['pointerdown', 'keydown', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInput < 120_000) {
        session.progress.activeMs += 15_000;
      }
    }, 15_000);
    return () => {
      clearInterval(id);
      evs.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [session]);
}

/** Automatic in-progress copies to the teacher (if a submit endpoint is configured), and a last one when the page closes. */
export function useTeacherSync(session: LabSession): void {
  useEffect(() => {
    const lab = session.lab;
    const current = () => buildReport(lab, session.progress, profile.value, session.progress.submittedAt ? 'submitted' : 'in-progress');
    let lastSent = 0;
    const minutes = config.value.autoSyncMinutes;
    const id =
      minutes > 0
        ? setInterval(() => {
            if (!hasEndpoint() || !profile.value.name.trim()) return;
            if (session.progress.updatedAt <= lastSent) return;
            lastSent = Date.now();
            enqueue(current());
          }, minutes * 60_000)
        : undefined;
    const onHide = () => {
      flushSaves();
      if (hasEndpoint() && profile.value.name.trim() && session.progress.updatedAt > lastSent) {
        lastSent = Date.now();
        beacon(current());
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      if (id) clearInterval(id);
      window.removeEventListener('pagehide', onHide);
    };
  }, [session]);
}
