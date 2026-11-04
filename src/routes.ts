import { classOf, curriculumOfLab, findCurriculum, type Curriculum } from './curricula';
import { findLab } from './labs';
import type { LabDef } from './labs/types';

/**
 * Hash routes. The site is static (GitHub Pages, base './') with a precaching
 * service worker, so there is no server to answer /csp/lab/x: everything after
 * the # stays in the browser.
 *
 *   #/                       the student's course home page (no course yet: the sign-in dialog)
 *   #/<course>               a course's home page: #/intro, #/csp, #/csa, #/cyber
 *   #/<course>/lab/<id>      a lab
 *   #/<course>/guide/<id>    a lab's guide (every step on one page)
 *   #/teacher                teacher tools, for every course
 *   #/lab/<id>, #/guide/<id> old addresses: redirect to the lab's course
 */

export type Page = { kind: 'home'; cur?: Curriculum } | { kind: 'lab' | 'guide'; lab: LabDef; cur: Curriculum } | { kind: 'teacher' };

export const homeHref = (id: string) => `#/${id}`;
export const labHref = (labId: string) => `#/${curriculumOfLab(labId).id}/lab/${labId}`;
export const guideHref = (labId: string) => `#/${curriculumOfLab(labId).id}/guide/${labId}`;

/** A lab or its guide, at its current or old address. */
const LAB_ROUTE = /^#\/(?:([\w-]+)\/)?(lab|guide)\/([\w-]+)/;
const HOME_ROUTE = /^#\/([\w-]+)\/?$/;

/** True for an address that opens a lab (not its guide), old or new. */
export const isLabRoute = (hash: string) => LAB_ROUTE.exec(hash)?.[2] === 'lab';

export function parseRoute(hash: string, student: { name: string; curriculum?: string }): Page {
  if (hash.startsWith('#/teacher')) return { kind: 'teacher' };
  const m = LAB_ROUTE.exec(hash);
  if (m && (!m[1] || findCurriculum(m[1]))) {
    const lab = findLab(m[3]);
    // A lab listed under the wrong course still opens; its address is corrected.
    if (lab) return { kind: m[2] as 'lab' | 'guide', lab, cur: curriculumOfLab(lab.id) };
    if (m[1]) return { kind: 'home', cur: findCurriculum(m[1]) };
  }
  const home = HOME_ROUTE.exec(hash);
  const cur = home ? findCurriculum(home[1]) : undefined;
  return { kind: 'home', cur: cur ?? classOf(student) };
}

/** The address for a page, so old and misspelled addresses settle on one form. */
export function pageHref(page: Page, hash: string): string {
  if (page.kind === 'teacher') return hash;
  if (page.kind === 'home') return page.cur ? homeHref(page.cur.id) : '#/';
  return page.kind === 'lab' ? labHref(page.lab.id) : guideHref(page.lab.id);
}
