import type { LabSolution } from '../solution';
import { BSSID, MAC, ROGUE_PORT, SPOTS } from './scenario';

const measure = SPOTS.map((s) => ({ tool: { type: 'wifi-measure' as const, device: 'desk', bssid: BSSID.twin, x: s.x, y: s.y } }));

/** Answer key for "Watch the Air". Choice answers come from the lab itself. */
export const watchTheAirSolution: LabSolution = {
  tour: { moves: [{ inspect: 'wap' }] },

  sweep: {
    moves: [
      { tool: { type: 'wifi-scan', device: 'desk' } },
      { tool: { type: 'wids-mark', device: 'wap', bssid: BSSID.wap, mark: 'approved' } },
      { tool: { type: 'wids-mark', device: 'wap', bssid: BSSID.wap2, mark: 'approved' } },
      { tool: { type: 'wids-mark', device: 'wap', bssid: BSSID.rogue, mark: 'unknown' } },
      { citeLog: 'lansw', where: (e) => e.fields?.action === 'new-mac' && e.fields?.port === ROGUE_PORT },
      { inspect: 'lansw' },
      { tool: { type: 'port-shutdown', device: 'lansw', port: ROGUE_PORT, shut: true } },
    ],
  },

  lookalike: {
    moves: [
      { tool: { type: 'wifi-scan', device: 'desk' } },
      { tool: { type: 'wids-mark', device: 'wap', bssid: BSSID.twin, mark: 'unknown' } },
      { press: 'copy-name' },
    ],
  },

  find: {
    moves: [...measure, { press: 'unplug' }, { press: 'save-profile' }],
  },

  evidence: {
    moves: [
      { citeLog: 'wap', where: (e) => e.fields?.action === 'heard' && e.fields?.bssid === BSSID.twin },
      { citeLog: 'wap', where: (e) => e.fields?.action === 'left' && e.fields?.mac === MAC.visitor },
      { citeLog: 'wap', where: (e) => e.fields?.action === 'stray' && e.fields?.mac === MAC.visitor },
    ],
  },

  jam: {
    moves: [{ inspect: 'lansw' }, { tool: { type: 'wifi-scan', device: 'desk' } }, { openLog: 'wap', where: (e) => e.fields?.action === 'noise' }],
  },

  crowd: {
    moves: [{ press: 'movie-night' }, { tool: { type: 'wifi-scan', device: 'desk' } }, { openLog: 'wap', where: (e) => e.fields?.action === 'noise' }],
  },

  alarms: {
    moves: [
      { tool: { type: 'wids-rule', device: 'wap', rule: 'unknown-ap', on: true } },
      { tool: { type: 'wids-rule', device: 'wap', rule: 'lookalike', on: true } },
      { tool: { type: 'wids-rule', device: 'wap', rule: 'noise', on: true } },
      { tool: { type: 'wids-rule', device: 'wap', rule: 'new-mac', on: true } },
      { tool: { type: 'wids-replay', device: 'wap' } },
      { tool: { type: 'wids-threshold', device: 'wap', level: 40 } },
      { tool: { type: 'wids-replay', device: 'wap' } },
      { openLog: 'wap', where: (e) => e.source === 'wids' && e.level === 'alert' },
    ],
  },

  recommend: {
    text: {
      impact:
        "The weekly sweep and reading the alerts take a staff member about fifteen minutes a day. The alarms will still raise false alarms, mostly new volunteer laptops on the switch, and each one takes a few minutes to check. The tools run on the access point and switch the shelter already has, so the cost is staff time, not money. Families keep their privacy because the alarms watch radios and ports, not the websites people visit or what they send.",
    },
  },
};
