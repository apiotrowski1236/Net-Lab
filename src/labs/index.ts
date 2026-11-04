import { homeNetworkLab } from './home-network';
import { packetCaptureLab } from './packet-capture';
import { buildNetworkLab } from './build-network';
import { dnsSpoofLab } from './dns-spoof';
import { macFloodLab } from './mac-flood';
import { firewallLab } from './firewall';
import { onPathLab } from './on-path';
import { smurfLab } from './smurf';
import { routeHijackLab } from './route-hijack';
import { segmentationLab } from './segmentation';
import { netAuditLab } from './net-audit';
import { wirelessLab } from './wireless';
import { logsLab } from './logs';
import { binaryNumbersLab } from './binary-numbers';
import type { LabDef, LabStub } from './types';

/** Every playable lab, in the order they appear on the home page. */
export const LABS: LabDef[] = [homeNetworkLab, packetCaptureLab, buildNetworkLab, onPathLab, macFloodLab, dnsSpoofLab, smurfLab, routeHijackLab, netAuditLab, wirelessLab, segmentationLab, firewallLab, logsLab, binaryNumbersLab];

/**
 * Planned labs, shown on the home page as "coming soon", in the order of the
 * CED's Unit 3 topics. Each has a plan in src/labs/<id>/PLAN.md; see
 * docs/unit3/COVERAGE.md for what each covers.
 */
export const STUBS: LabStub[] = [];

export function findLab(id: string): LabDef | undefined {
  return LABS.find((l) => l.id === id);
}
