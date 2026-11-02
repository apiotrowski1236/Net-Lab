import { TAB_TOOLS, toolKey, type ToolSpec } from '../labs/types';
import type { Device } from '../sim/types';
import { INSPECTOR_SECTIONS } from './inspector/registry';

/**
 * Where a click on a device chip in the lesson lands. If the step hands out a
 * tool for that device, the student goes straight to it: the tool's section
 * in the Inspect tab, or its card in the Toolkit.
 */
export interface Jump {
  tab: 'inspect' | 'tools';
  device: string;
  /** One selector per tool, in the step's order: scroll to the first that's on screen, highlight them all. */
  selectors: string[];
  /** Changes on every click, so clicking the same chip again jumps again. */
  n: number;
}

/** Tools changed in the Inspector's built-in sections, and the devices they apply to. */
const BUILT_IN: Partial<Record<ToolSpec['kind'], (d: Device) => boolean>> = {
  'ip-config': (d) => d.kind === 'host' || d.kind === 'router',
  gateway: (d) => d.kind === 'host',
  'static-route': (d) => d.kind === 'router',
};

const INSPECTOR_TOOLS = new Set<string>([...Object.keys(BUILT_IN), ...INSPECTOR_SECTIONS.flatMap((s) => s.tools ?? [])]);

function toolDevices(t: ToolSpec): string[] {
  return 'device' in t ? [t.device] : 'devices' in t ? t.devices : 'attacker' in t ? [t.attacker] : 'scanner' in t ? [t.scanner] : [];
}

function usedOn(t: ToolSpec, dev: Device): boolean {
  const builtIn = BUILT_IN[t.kind];
  if (builtIn) return builtIn(dev);
  return toolDevices(t).includes(dev.id);
}

/**
 * The step's tools for `dev`. Inspector tools win, since the student is opening
 * the device. `toolkit: false` (a card's own "Open" button) never leaves the Inspector.
 */
export function jumpFor(tools: ToolSpec[], dev: Device, toolkit: boolean, n: number): Jump | null {
  const mine = tools.filter((t) => !(TAB_TOOLS as readonly string[]).includes(t.kind) && usedOn(t, dev));
  const inspect = [...new Set(mine.filter((t) => INSPECTOR_TOOLS.has(t.kind)).map((t) => t.kind))];
  if (inspect.length) return { tab: 'inspect', device: dev.id, selectors: inspect.map((k) => `[data-tools~="${k}"]`), n };
  const cards = mine.filter((t) => !INSPECTOR_TOOLS.has(t.kind));
  if (toolkit && cards.length) return { tab: 'tools', device: dev.id, selectors: cards.map((t) => `[data-tool-key="${toolKey(t)}"]`), n };
  return null;
}
