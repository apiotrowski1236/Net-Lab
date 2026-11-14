import { findLab, STUBS } from './labs';
import type { LabDef, LabStub } from './labs/types';

/**
 * The courses NetLab serves. Each has its own home page (#/<id>) listing its
 * labs. A student picks their course ("class") when they first sign in; it is
 * saved with their profile and #/ opens that course's home page.
 *
 * Lab ids are unique across all courses (saved work is keyed by student id and
 * lab id), and every lab in src/labs/index.ts belongs to exactly one course.
 * src/curricula.test.ts checks both.
 */
export interface Curriculum {
  id: CurriculumId;
  /** Full course name: the home page's top bar, the class picker, reports. */
  title: string;
  /** Short name for tight spots. */
  short: string;
  /** The home page's heading and the paragraph under it. */
  heading: string;
  intro: string;
  /** What this course calls one activity, for "All labs" or "Lesson guide". */
  noun: 'lab' | 'lesson';
  /** Ids of this course's labs (from src/labs/index.ts), in home page order. */
  labs: string[];
  /** Planned labs, shown on the home page as "coming soon". */
  stubs: LabStub[];
  /** Small print at the bottom of the home page. */
  footnote?: string;
}

export type CurriculumId = 'intro' | 'csp' | 'csa' | 'cyber';

const LESSON_INTRO =
  'Interactive lessons where you try each idea yourself and check your thinking along the way. Your work is saved on this computer as you go, even offline.';

/** Every course, in level order. The class picker and the class menu list them in this order. */
export const CURRICULA: Curriculum[] = [
  {
    id: 'intro',
    title: 'Intro to Computer Science',
    short: 'Intro CS',
    heading: 'Hands-on lessons',
    intro: LESSON_INTRO,
    noun: 'lesson',
    labs: ['p5-draw', 'p5-move', 'p5-game', 'js-arrays', 'js-loops', 'js-dom'],
    stubs: [],
  },
  {
    id: 'csp',
    title: 'AP Computer Science Principles',
    short: 'AP CSP',
    heading: 'Hands-on lessons',
    intro: LESSON_INTRO,
    noun: 'lesson',
    labs: ['binary-numbers', 'compression'],
    stubs: [],
  },
  {
    id: 'csa',
    title: 'AP Computer Science A',
    short: 'AP CSA',
    heading: 'Hands-on lessons',
    intro: LESSON_INTRO,
    noun: 'lesson',
    labs: ['java-classes'],
    stubs: [],
  },
  {
    id: 'cyber',
    title: 'AP Cybersecurity',
    short: 'AP Cyber',
    heading: 'Unit 3: Securing Networks',
    intro:
      'Hands-on labs where you watch packets move, then play attacker and defender on a simulated network. Only one lab touches a real network: in Wireshark for Real, you capture your own computer\'s traffic, with your teacher\'s permission. Everything you do is saved on this computer as you go, even offline.',
    noun: 'lab',
    labs: [
      'home-network',
      'packet-capture',
      'wireshark',
      'build-network',
      'net-tools',
      'on-path',
      'mac-flood',
      'dns-spoof',
      'smurf',
      'route-hijack',
      'net-audit',
      'wireless',
      'segmentation',
      'firewall',
      'firewall-types',
      'logs',
      'detect-methods',
      'capture-analysis',
      'watch-the-air',
      'device-analysis',
      // Answer sheets for CYBER.ORG Range labs (LabDef.worksheet). The home page lists them in their own group.
      'hijacked-ssh-1',
    ],
    stubs: STUBS,
    footnote: "Simulated networks only, except the Wireshark lab's capture of your own computer. The attacks you practice here are illegal against real networks you don't own or have written permission to test.",
  },
];

/**
 * Everyone who signed in before NetLab had more than one course takes AP
 * Cybersecurity, so a saved name with no course means this one.
 */
export const LEGACY_CURRICULUM: CurriculumId = 'cyber';

export function findCurriculum(id: string | undefined): Curriculum | undefined {
  return CURRICULA.find((c) => c.id === id);
}

/** The course a lab belongs to. */
export function curriculumOfLab(labId: string): Curriculum {
  return CURRICULA.find((c) => c.labs.includes(labId)) ?? findCurriculum(LEGACY_CURRICULUM)!;
}

/** A course's playable labs, in home page order. */
export function labsOf(c: Curriculum): LabDef[] {
  return c.labs.map((id) => findLab(id)).filter((l): l is LabDef => !!l);
}

/** The student's saved course. A student who has a name but no course is an AP Cybersecurity student. */
export function classOf(p: { name: string; curriculum?: string }): Curriculum | undefined {
  return findCurriculum(p.curriculum) ?? (p.name.trim() ? findCurriculum(LEGACY_CURRICULUM) : undefined);
}
