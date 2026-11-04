import { describe, expect, it } from 'vitest';
import { classOf, CURRICULA, curriculumOfLab, labsOf } from './curricula';
import { LABS } from './labs';
import { isLabRoute, pageHref, parseRoute } from './routes';
import { migrateProfile, type Profile } from './store/profile';

const student = (curriculum?: string, name = 'Riley') => ({ name, curriculum });
const href = (hash: string, who = student('csp')) => pageHref(parseRoute(hash, who), hash);

describe('curricula', () => {
  it('lists the courses in level order', () => {
    expect(CURRICULA.map((c) => c.id)).toEqual(['intro', 'csp', 'csa', 'cyber']);
    expect(CURRICULA.map((c) => c.short)).toEqual(['Intro CS', 'AP CSP', 'AP CSA', 'AP Cyber']);
  });

  it('puts every lab in exactly one course, and every course lab exists', () => {
    for (const lab of LABS) expect(CURRICULA.filter((c) => c.labs.includes(lab.id)).map((c) => c.id)).toHaveLength(1);
    for (const c of CURRICULA) expect(labsOf(c).map((l) => l.id)).toEqual(c.labs);
  });

  it('keeps lab ids unique, so saved work (student id + lab id) never collides', () => {
    const ids = CURRICULA.flatMap((c) => [...c.labs, ...c.stubs.map((s) => s.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds a lab’s course', () => {
    expect(curriculumOfLab('on-path').id).toBe('cyber');
    expect(curriculumOfLab('logs').id).toBe('cyber');
  });

  it('treats a student with a name but no class as AP Cybersecurity, and a new student as no class yet', () => {
    expect(classOf(student(undefined))?.id).toBe('cyber');
    expect(classOf(student('csa'))?.id).toBe('csa');
    expect(classOf(student('nonsense'))?.id).toBe('cyber');
    expect(classOf(student(undefined, ''))).toBeUndefined();
  });
});

describe('routes', () => {
  it('sends #/ to the student’s class, or leaves it for the sign-in dialog', () => {
    expect(href('#/')).toBe('#/csp');
    expect(href('')).toBe('#/csp');
    expect(href('#/', student(undefined))).toBe('#/cyber');
    expect(href('#/', student(undefined, ''))).toBe('#/');
  });

  it('opens each course home page, whatever the student’s class', () => {
    for (const c of CURRICULA) {
      expect(href(`#/${c.id}`)).toBe(`#/${c.id}`);
      expect(parseRoute(`#/${c.id}`, student(undefined, ''))).toEqual({ kind: 'home', cur: c });
    }
    expect(href('#/cyber/')).toBe('#/cyber');
  });

  it('redirects old lab and guide addresses to the lab’s course', () => {
    expect(href('#/lab/on-path')).toBe('#/cyber/lab/on-path');
    expect(href('#/guide/on-path')).toBe('#/cyber/guide/on-path');
    expect(parseRoute('#/lab/on-path', student('csp'))).toMatchObject({ kind: 'lab', lab: { id: 'on-path' }, cur: { id: 'cyber' } });
  });

  it('corrects a lab listed under the wrong course, and sends unknown labs home', () => {
    expect(href('#/csp/lab/on-path')).toBe('#/cyber/lab/on-path');
    expect(href('#/cyber/guide/route-hijack')).toBe('#/cyber/guide/route-hijack');
    expect(href('#/csa/lab/no-such-lab')).toBe('#/csa');
    expect(href('#/lab/no-such-lab')).toBe('#/csp');
    expect(href('#/nowhere')).toBe('#/csp');
  });

  it('leaves the teacher page alone', () => {
    expect(href('#/teacher')).toBe('#/teacher');
  });

  it('knows which saved routes reopen a lab', () => {
    expect(isLabRoute('#/lab/on-path')).toBe(true);
    expect(isLabRoute('#/cyber/lab/on-path')).toBe(true);
    expect(isLabRoute('#/cyber/guide/on-path')).toBe(false);
    expect(isLabRoute('#/csp')).toBe(false);
  });
});

describe('profile migration', () => {
  const base: Profile = { id: 'x', name: 'Riley Seeded', period: '', createdAt: 0 };
  it('gives a student who signed in before courses existed AP Cybersecurity', () => {
    expect(migrateProfile(base).curriculum).toBe('cyber');
  });
  it('leaves a chosen class and a not-yet-signed-in student alone', () => {
    const csp = { ...base, curriculum: 'csp' };
    expect(migrateProfile(csp)).toBe(csp);
    const fresh = { ...base, name: '' };
    expect(migrateProfile(fresh)).toBe(fresh);
  });
});
