import { buildNetworkLab } from './build-network';
import { dnsSpoofLab } from './dns-spoof';
import { onPathLab } from './on-path';
import { routeHijackLab } from './route-hijack';
import type { LabDef, LabStub } from './types';

/** Every playable lab, in the order they appear on the home page. */
export const LABS: LabDef[] = [buildNetworkLab, onPathLab, routeHijackLab, dnsSpoofLab];

/**
 * Planned labs, shown on the home page as "coming soon", in the order of the
 * CED's Unit 3 topics. Each has a plan in src/labs/<id>/PLAN.md; see
 * docs/unit3/COVERAGE.md for what each covers.
 */
export const STUBS: LabStub[] = [
  {
    id: 'mac-flood',
    title: 'Flood the Switch',
    tagline: "Overflow a switch's memory so it repeats everyone's traffic to you, then lock its ports.",
    unit: 3,
    codehs: [],
    comingSoon: true,
  },
  {
    id: 'smurf',
    title: 'Echo Storm',
    tagline: "Turn a network's own echoes into a flood that knocks a ticket site offline.",
    unit: 3,
    codehs: ['3.3 Misdirected and Overwhelmed'],
    comingSoon: true,
  },
  {
    id: 'net-audit',
    title: 'The Network Audit',
    tagline: 'Scan a small office for weaknesses, rate each risk, and write the policies that fix them.',
    unit: 3,
    codehs: [],
    comingSoon: true,
  },
  {
    id: 'wireless',
    title: 'Signals Past the Walls',
    tagline: "Secure an emergency shelter's Wi-Fi against snoopers in the parking lot, evil twins, and jammers.",
    unit: 3,
    codehs: ['3.7 Locking Down the Airwaves'],
    comingSoon: true,
  },
  {
    id: 'segmentation',
    title: 'Walls Inside the Network',
    tagline: "Split a submarine's flat network into zones and watch malware hit a wall.",
    unit: 3,
    codehs: ['3.8 Network Segmentation'],
    comingSoon: true,
  },
  {
    id: 'firewall',
    title: 'Firewall Rulebook',
    tagline: 'Place two firewalls in a hospital network and write the rules that let patients in and keep attackers out.',
    unit: 3,
    codehs: ['3.10 The Rules of the Firewall', '3.12 Writing the Rulebooks'],
    comingSoon: true,
  },
  {
    id: 'logs',
    title: 'Log Detective',
    tagline: 'Tune detection tools and read the logs to find attacks hiding in normal traffic.',
    unit: 3,
    codehs: ['3.18 The Story in the Logs'],
    comingSoon: true,
  },
];

export function findLab(id: string): LabDef | undefined {
  return LABS.find((l) => l.id === id);
}
