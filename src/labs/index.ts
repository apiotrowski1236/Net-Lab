import { onPathLab } from './on-path';
import { routeHijackLab } from './route-hijack';
import type { LabDef, LabStub } from './types';

/** Every playable lab, in the order they appear on the home page. */
export const LABS: LabDef[] = [onPathLab, routeHijackLab];

/** Planned labs, shown on the home page as "coming soon". */
export const STUBS: LabStub[] = [
  {
    id: 'dns-spoof',
    title: 'Wrong Directions',
    tagline: 'Forge a DNS answer and send a whole café to the wrong site.',
    unit: 3,
    codehs: ['3.3 Misdirected and Overwhelmed'],
    comingSoon: true,
  },
  {
    id: 'segmentation',
    title: 'Walls Inside the Network',
    tagline: 'Split a flat network into zones and watch an intruder hit a wall.',
    unit: 3,
    codehs: ['3.8 Network Segmentation'],
    comingSoon: true,
  },
  {
    id: 'firewall',
    title: 'Firewall Rulebook',
    tagline: 'Write allow and deny rules, then test them against live traffic.',
    unit: 3,
    codehs: ['3.10 The Rules of the Firewall', '3.12 Writing the Rulebooks'],
    comingSoon: true,
  },
  {
    id: 'logs',
    title: 'Log Detective',
    tagline: 'Read router and server logs to find the attack hiding in normal traffic.',
    unit: 3,
    codehs: ['3.18 The Story in the Logs'],
    comingSoon: true,
  },
];

export function findLab(id: string): LabDef | undefined {
  return LABS.find((l) => l.id === id);
}
