import { describe, expect, it } from 'vitest';
import type { ToolSpec } from '../labs/types';
import type { Device } from '../sim/types';
import { jumpFor } from './jump';

const dev = (id: string, kind: Device['kind'] = 'host') => ({ id, kind }) as Device;

describe('jumpFor', () => {
  it('goes to the Inspector section for a settings tool on the device', () => {
    const j = jumpFor([{ kind: 'wifi-config', device: 'wifi', basic: true }], dev('wifi', 'switch'), true, 1);
    expect(j).toMatchObject({ tab: 'inspect', device: 'wifi', selectors: ['[data-tools~="wifi-config"]'] });
  });

  it('keeps the step order, so the first tool listed is the one scrolled to', () => {
    const tools: ToolSpec[] = [
      { kind: 'hardening', device: 'router' },
      { kind: 'firewall-rules', devices: ['router'] },
      { kind: 'scanner', device: 'auditor' },
    ];
    expect(jumpFor(tools, dev('router', 'router'), true, 1)?.selectors).toEqual(['[data-tools~="hardening"]', '[data-tools~="firewall-rules"]']);
  });

  it('opens Toolkit cards from a lesson chip, but not from a card button', () => {
    const tools: ToolSpec[] = [
      { kind: 'sniffer', device: 'mallory' },
      { kind: 'forwarding', device: 'mallory' },
    ];
    expect(jumpFor(tools, dev('mallory'), true, 1)).toMatchObject({
      tab: 'tools',
      selectors: ['[data-tool-key="sniffer@mallory"]', '[data-tool-key="forwarding@mallory"]'],
    });
    expect(jumpFor(tools, dev('mallory'), false, 1)).toBeNull();
  });

  it('matches device-less settings tools by device kind', () => {
    const tools: ToolSpec[] = [{ kind: 'gateway' }, { kind: 'static-route' }];
    expect(jumpFor(tools, dev('alice'), true, 1)?.selectors).toEqual(['[data-tools~="gateway"]']);
    expect(jumpFor(tools, dev('r1', 'router'), true, 1)?.selectors).toEqual(['[data-tools~="static-route"]']);
    expect(jumpFor(tools, dev('sw', 'switch'), true, 1)).toBeNull();
  });

  it("opens the Capture tab's toolbar for the capture device (packet-capture)", () => {
    const tools: ToolSpec[] = [{ kind: 'capture', device: 'laptop', filter: true }, { kind: 'ping' }];
    expect(jumpFor(tools, dev('laptop'), true, 1)).toMatchObject({ tab: 'capture', device: 'laptop', selectors: ['[data-capture-tools]'] });
    expect(jumpFor(tools, dev('laptop'), false, 1)).toBeNull();
    expect(jumpFor(tools, dev('phone'), true, 1)).toBeNull();
  });

  it('leaves other devices and the Logs tab alone', () => {
    const tools: ToolSpec[] = [
      { kind: 'sniffer', device: 'mallory' },
      { kind: 'logs', devices: ['alice'] },
    ];
    expect(jumpFor(tools, dev('alice'), true, 1)).toBeNull();
  });
});
