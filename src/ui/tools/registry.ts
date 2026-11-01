import type { ComponentType } from 'preact';
import type { ToolSpec } from '../../labs/types';
import type { LabSession } from '../../runtime/session';
import { DnsForge } from './DnsForge';
import { ResolverDefense } from './ResolverDefense';
import { MacChanger } from './MacChanger';
import { MacFlooder } from './MacFlooder';
import { PortSecurityCard } from './PortSecurityCard';
import { WifiScanner } from './WifiScanner';
import { WifiCracker } from './WifiCracker';
import { Triangulate } from './Triangulate';
import { FirewallPlaceTool } from './FirewallPlace';
import { FirewallRulesTool } from './FirewallRules';
import { PortScanTool } from './PortScan';
import { ScannerTool } from './Scanner';
import { RiskRegisterTool } from './RiskRegister';
import { HardeningCard } from './HardeningCard';

export type ToolCardProps<K extends ToolSpec['kind'] = ToolSpec['kind']> = {
  session: LabSession;
  spec: Extract<ToolSpec, { kind: K }>;
  /** Select a device and show it in the Inspect tab. */
  onSelect: (id: string) => void;
};

/**
 * Toolkit cards for tools added since the first three labs. To add a tool:
 * add its ToolSpec kind (labs/types.ts), write the card in
 * src/ui/tools/<Name>.tsx using the pieces in ./parts, and list it here.
 * The Toolkit draws a card for every unlocked tool of a listed kind.
 */
export const TOOL_CARDS: { [K in ToolSpec['kind']]?: ComponentType<ToolCardProps<K>> } = {
  'dns-forge': DnsForge,
  'resolver-defense': ResolverDefense,
  // mac-flood
  'mac-flood': MacFlooder,
  'mac-change': MacChanger,
  'port-security': PortSecurityCard,
  // wireless
  'wifi-scan': WifiScanner,
  'wifi-crack': WifiCracker,
  triangulate: Triangulate,
  // firewall
  'port-scan': PortScanTool,
  'firewall-place': FirewallPlaceTool,
  'firewall-rules': FirewallRulesTool,
  // net-audit
  scanner: ScannerTool,
  'risk-register': RiskRegisterTool,
  hardening: HardeningCard,
};
