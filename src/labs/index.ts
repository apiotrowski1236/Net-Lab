import { buildNetworkLab } from './build-network';
import { dnsSpoofLab } from './dns-spoof';
import { macFloodLab } from './mac-flood';
import { firewallLab } from './firewall';
import { onPathLab } from './on-path';
import { routeHijackLab } from './route-hijack';
import { segmentationLab } from './segmentation';
import { wirelessLab } from './wireless';
import type { LabDef, LabStub } from './types';

/** Every playable lab, in the order they appear on the home page. */
export const LABS: LabDef[] = [buildNetworkLab, onPathLab, macFloodLab, dnsSpoofLab, routeHijackLab, wirelessLab, segmentationLab, firewallLab];

/**
 * Planned labs, shown on the home page as "coming soon", in the order of the
 * CED's Unit 3 topics. Each has a plan in src/labs/<id>/PLAN.md; see
 * docs/unit3/COVERAGE.md for what each covers.
 */
export const STUBS: LabStub[] = [
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
