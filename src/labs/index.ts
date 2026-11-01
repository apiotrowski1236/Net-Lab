import { buildNetworkLab } from './build-network';
import { dnsSpoofLab } from './dns-spoof';
import { macFloodLab } from './mac-flood';
import { firewallLab } from './firewall';
import { onPathLab } from './on-path';
import { smurfLab } from './smurf';
import { routeHijackLab } from './route-hijack';
import { wirelessLab } from './wireless';
import type { LabDef, LabStub } from './types';

/** Every playable lab, in the order they appear on the home page. */
export const LABS: LabDef[] = [buildNetworkLab, onPathLab, macFloodLab, dnsSpoofLab, smurfLab, routeHijackLab, wirelessLab, firewallLab];

/**
 * Planned labs, shown on the home page as "coming soon", in the order of the
 * CED's Unit 3 topics. Each has a plan in src/labs/<id>/PLAN.md; see
 * docs/unit3/COVERAGE.md for what each covers.
 */
export const STUBS: LabStub[] = [
  {
    id: 'net-audit',
    title: 'The Network Audit',
    tagline: 'Scan a small office for weaknesses, rate each risk, and write the policies that fix them.',
    unit: 3,
    codehs: [],
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
