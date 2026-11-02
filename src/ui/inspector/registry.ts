import type { ComponentType } from 'preact';
import type { ToolSpec } from '../../labs/types';
import type { LabSession } from '../../runtime/session';
import type { Sim } from '../../sim/sim';
import type { Device } from '../../sim/types';
import { DnsCache } from './DnsCache';
import { DnsZone } from './DnsZone';
import { SwitchPorts } from './SwitchPorts';
import { wifiSettingsSection } from './WifiSettings';
import { FirewallRulesSection } from './FirewallRules';
import { ServicesSection } from './Services';
import { MalwareSection } from './Malware';
import { VlansSection } from './Vlans';
import { ZonePolicySection } from './ZonePolicy';
import { HardeningSection } from './Hardening';
import { Detection } from './Detection';
import { SiemConsole } from './SiemConsole';
import { routerPanelSection } from './TrafficMeter';
import { dhcpLeasesSection } from './DhcpLeases';
import { natTableSection } from './NatTable';
import { wifiSetupSection } from './WifiSetup';

export interface InspectorSectionProps {
  session: LabSession;
  /** The network on screen: the live one, or the copy a replay is playing. Read from this, not session.sim. */
  sim: Sim;
  dev: Device;
  /** A replay is showing. Show state, but no editing. */
  replaying: boolean;
  /** The student has this tool, and isn't watching a replay. */
  has: (k: ToolSpec['kind']) => boolean;
}

export interface InspectorSection {
  id: string;
  /** 'settings': with the device's own settings, after its ports, routes, and gateway. 'end': at the bottom. */
  slot: 'settings' | 'end';
  /** Return null for devices the section doesn't apply to. */
  Section: ComponentType<InspectorSectionProps>;
  /** Tools the student uses in this section. A lesson chip for the tool's device scrolls here. */
  tools?: ToolSpec['kind'][];
}

/**
 * Inspector sections added since the first three labs (firewall rules, port
 * security, Wi-Fi settings, ...). Write each in src/ui/inspector/<Name>.tsx
 * with an <section><h4>...</h4>...</section> like the built-in ones, and list it here.
 */
export const INSPECTOR_SECTIONS: InspectorSection[] = [
  { id: 'dns-cache', slot: 'settings', Section: DnsCache },
  { id: 'dns-zone', slot: 'end', Section: DnsZone },
  // segmentation (before mac-flood's ports table, so a switch shows its VLANs first)
  { id: 'vlans', slot: 'settings', Section: VlansSection, tools: ['vlan'] },
  // mac-flood
  { id: 'switch-ports', slot: 'settings', Section: SwitchPorts, tools: ['port-security'] },
  // wireless
  { ...wifiSettingsSection, tools: ['wifi-config'] },
  // firewall
  { id: 'services', slot: 'settings', Section: ServicesSection },
  // segmentation (the zone policy before the rules it writes)
  { id: 'malware', slot: 'settings', Section: MalwareSection },
  { id: 'zone-policy', slot: 'settings', Section: ZonePolicySection, tools: ['zone-policy'] },
  { id: 'firewall-rules', slot: 'settings', Section: FirewallRulesSection, tools: ['firewall-rules'] },
  // net-audit
  { id: 'hardening', slot: 'settings', Section: HardeningSection, tools: ['hardening'] },
  // logs
  { id: 'ids-detection', slot: 'settings', Section: Detection, tools: ['ids'] },
  { id: 'siem-console', slot: 'settings', Section: SiemConsole, tools: ['siem', 'ai-threshold'] },
  // smurf
  { ...routerPanelSection, tools: ['directed-broadcast'] },
  // home-network
  { ...wifiSetupSection, tools: ['wifi-config'] },
  dhcpLeasesSection,
  natTableSection,
];
