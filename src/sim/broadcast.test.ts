import { describe, expect, it } from 'vitest';
import { broadcastAddr, directedBroadcastIface } from './broadcast';
import { buildEchoStorm } from '../labs/smurf/scenario';

describe('broadcastAddr', () => {
  it('is the last address in the network', () => {
    expect(broadcastAddr('198.51.100.0', 24)).toBe('198.51.100.255');
    expect(broadcastAddr('198.51.100.1', 24)).toBe('198.51.100.255');
    expect(broadcastAddr('10.0.0.0', 8)).toBe('10.255.255.255');
    expect(broadcastAddr('192.168.1.0', 30)).toBe('192.168.1.3');
    expect(broadcastAddr('203.0.113.66', 32)).toBe('203.0.113.66');
  });
});

describe('directedBroadcastIface', () => {
  const campus = buildEchoStorm().dev('campus');

  it("finds the LAN interface when the address is that LAN's broadcast", () => {
    expect(directedBroadcastIface(campus, '198.51.100.255')?.id).toBe('lan');
  });

  it('ignores an interface with no host count (the /30 WAN link)', () => {
    expect(directedBroadcastIface(campus, '100.64.0.7')).toBeUndefined();
  });

  it('is undefined for an ordinary host address or another network', () => {
    expect(directedBroadcastIface(campus, '198.51.100.11')).toBeUndefined();
    expect(directedBroadcastIface(campus, '192.0.2.255')).toBeUndefined();
  });
});
