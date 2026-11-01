import type { ComponentType } from 'preact';
import type { ToolSpec } from '../../labs/types';
import type { LabSession } from '../../runtime/session';
import type { Sim } from '../../sim/sim';
import type { Device } from '../../sim/types';

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
}

/**
 * Inspector sections added since the first three labs (firewall rules, port
 * security, Wi-Fi settings, ...). Write each in src/ui/inspector/<Name>.tsx
 * with an <section><h4>...</h4>...</section> like the built-in ones, and list it here.
 */
export const INSPECTOR_SECTIONS: InspectorSection[] = [];
