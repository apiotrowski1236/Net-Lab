import { buildNetworkLab } from './build-network';
import { dnsSpoofLab } from './dns-spoof';
import { macFloodLab } from './mac-flood';
import { firewallLab } from './firewall';
import { onPathLab } from './on-path';
import { routeHijackLab } from './route-hijack';
import { segmentationLab } from './segmentation';
import { netAuditLab } from './net-audit';
import { wirelessLab } from './wireless';
import { logsLab } from './logs';
import type { LabDef, LabStub } from './types';

/** Every playable lab, in the order they appear on the home page. */
export const LABS: LabDef[] = [buildNetworkLab, onPathLab, macFloodLab, dnsSpoofLab, routeHijackLab, netAuditLab, wirelessLab, segmentationLab, firewallLab, logsLab];

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
];

export function findLab(id: string): LabDef | undefined {
  return LABS.find((l) => l.id === id);
}
