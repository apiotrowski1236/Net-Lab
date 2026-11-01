import type { LabSolution } from '../solution';
import { isAttendance, MAC, PORT } from './scenario';

/** Answer key for "Flood the Switch". Choice answers come from the lab itself. */
export const macFloodSolution: LabSolution = {
  office: { moves: [{ inspect: 'sw' }, { inspect: 'mallory' }] },
  jack: {
    moves: [{ press: 'plug-in' }, { tool: { type: 'sniff', device: 'mallory', on: true } }, { press: 'ortiz-sends' }],
  },
  flood: { moves: [{ tool: { type: 'mac-flood', device: 'mallory', bursts: 3 } }] },
  overheard: {
    moves: [{ press: 'ortiz-sends' }, { openFrame: 'mallory', match: isAttendance }],
    text: { who: 'Jordan Lee' },
  },
  detect: {
    moves: [{ openLog: 'sw', where: (e) => e.source === 'mac-table' }, { inspect: 'sw' }],
    text: { port: 'Port 7' },
  },
  portsec: {
    moves: [
      { tool: { type: 'port-security', device: 'sw', port: PORT.jack, config: { maxMacs: 1, violation: 'shutdown' } } },
      { press: 'flood-again' },
      { press: 'ortiz-sends' },
    ],
  },
  filter: {
    moves: [
      { inspect: 'printer' },
      { tool: { type: 'port-security', device: 'sw', port: PORT.printer, config: { maxMacs: 1, violation: 'restrict', allowed: [MAC.printer] } } },
      { tool: { type: 'set-mac', device: 'mallory', mac: MAC.printer } },
      { press: 'take-cable' },
      { press: 'mallory-pings' },
    ],
  },
  close: {
    moves: [
      { openLog: 'sw', where: (e) => e.fields?.port === PORT.printer && e.fields?.state === 'down' },
      { tool: { type: 'port-shutdown', device: 'sw', port: 'p6', shut: true } },
      { tool: { type: 'port-shutdown', device: 'sw', port: 'p7', shut: true } },
      { tool: { type: 'port-shutdown', device: 'sw', port: 'p8', shut: true } },
    ],
  },
  policy: {},
  reflect: {
    text: {
      first:
        'I would turn on port security first. It limits each port to one MAC address, so a flood from the lobby jack shuts the port before the made-up MACs push the records server out of the table. That keeps attendance private. It does not stop someone who unplugs the printer and copies its MAC, so I would also shut unused ports and read the switch log.',
    },
  },
};
