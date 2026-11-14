import { homeNetworkLab } from './home-network';
import { packetCaptureLab } from './packet-capture';
import { wiresharkLab } from './wireshark';
import { buildNetworkLab } from './build-network';
import { netToolsLab } from './net-tools';
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
import { detectMethodsLab } from './detect-methods';
import { watchTheAirLab } from './watch-the-air';
import { captureAnalysisLab } from './capture-analysis';
import { binaryNumbersLab } from './binary-numbers';
import { compressionLab } from './compression';
import { javaClassesLab } from './java-classes';
import { jsArraysLab } from './js-arrays';
import { jsLoopsLab } from './js-loops';
import { jsDomLab } from './js-dom';
import { p5DrawLab } from './p5-draw';
import { p5MoveLab } from './p5-move';
import { p5GameLab } from './p5-game';
import { hijackedSsh1Lab } from './hijacked-ssh-1';
import type { LabDef, LabStub } from './types';

/** Every playable lab, in the order they appear on the home page. */
export const LABS: LabDef[] = [homeNetworkLab, packetCaptureLab, wiresharkLab, buildNetworkLab, netToolsLab, onPathLab, macFloodLab, dnsSpoofLab, smurfLab, routeHijackLab, netAuditLab, wirelessLab, segmentationLab, firewallLab, logsLab, detectMethodsLab, captureAnalysisLab, watchTheAirLab, binaryNumbersLab, compressionLab, javaClassesLab, jsArraysLab, jsLoopsLab, jsDomLab, p5DrawLab, p5MoveLab, p5GameLab, hijackedSsh1Lab];

/**
 * Planned labs, shown on the home page as "coming soon", in the order of the
 * CED's Unit 3 topics. Each has a plan in src/labs/<id>/PLAN.md; see
 * docs/unit3/COVERAGE.md for what each covers.
 */
export const STUBS: LabStub[] = [];

export function findLab(id: string): LabDef | undefined {
  return LABS.find((l) => l.id === id);
}
