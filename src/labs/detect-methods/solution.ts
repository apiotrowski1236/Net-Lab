import type { LabSolution } from '../solution';
import { BENCH, DISPATCH, DISPATCH_BASE, LEAK, LOCKDOWN, OCT, PLANT, PLANT_CLEAN, PLANT_INFECTED, RENAMED, STREAM, STREAM_BASE } from './scenario';

const D = BENCH;

/** Answer key for "Pick Your Detector". Choice answers come from the lab itself. */
export const detectMethodsSolution: LabSolution = {
  clients: { moves: [{ inspect: 'sc-net' }, { inspect: 'rb-net' }, { inspect: 'cd-net' }, { inspect: BENCH }] },
  signatures: { moves: [{ tool: { type: 'bench-run', device: D, client: STREAM } }] },
  update: {
    moves: [{ tool: { type: 'bench-db', device: D, version: OCT } }, { tool: { type: 'bench-run', device: D, client: STREAM } }],
  },
  baseline: {
    moves: [{ tool: { type: 'bench-baseline', device: D, client: PLANT, day: PLANT_CLEAN } }, { tool: { type: 'bench-run', device: D, client: PLANT } }],
  },
  'bad-baseline': {
    moves: [
      { tool: { type: 'bench-baseline', device: D, client: PLANT, day: PLANT_INFECTED } },
      { tool: { type: 'bench-run', device: D, client: PLANT } },
    ],
  },
  'anomaly-stream': {
    moves: [
      { tool: { type: 'bench-set', device: D, client: STREAM, method: 'anomaly' } },
      { tool: { type: 'bench-baseline', device: D, client: STREAM, day: STREAM_BASE } },
      { tool: { type: 'bench-run', device: D, client: STREAM } },
    ],
  },
  fatigue: {
    moves: [
      // The ±25% run from the last step is still the newest: its copied-shows alert was closed unread.
      { openLog: D, where: (e) => e.fields?.attack === LEAK && e.fields?.queue === 'closed' },
      { tool: { type: 'bench-set', device: D, client: STREAM, tolerance: 100 } },
      { tool: { type: 'bench-run', device: D, client: STREAM } },
      { tool: { type: 'bench-set', device: D, client: STREAM, tolerance: 200 } },
      { tool: { type: 'bench-run', device: D, client: STREAM } },
    ],
  },
  hybrid: {
    moves: [
      { tool: { type: 'bench-run', device: D, client: DISPATCH } },
      { tool: { type: 'bench-set', device: D, client: DISPATCH, method: 'anomaly' } },
      { tool: { type: 'bench-baseline', device: D, client: DISPATCH, day: DISPATCH_BASE } },
      { tool: { type: 'bench-run', device: D, client: DISPATCH } },
      { tool: { type: 'bench-set', device: D, client: DISPATCH, method: 'hybrid' } },
      { tool: { type: 'bench-run', device: D, client: DISPATCH } },
    ],
  },
  bypass: {
    moves: [
      { press: 'rename' },
      { tool: { type: 'bench-set', device: D, client: DISPATCH, method: 'signature' } },
      { tool: { type: 'bench-run', device: D, client: DISPATCH } },
      { tool: { type: 'bench-set', device: D, client: DISPATCH, method: 'hybrid' } },
      { tool: { type: 'bench-run', device: D, client: DISPATCH } },
      { openLog: D, where: (e) => e.fields?.attack === LOCKDOWN && e.fields?.day === RENAMED },
    ],
    text: { when: '10:42' },
  },
  recommend: {
    moves: [
      { tool: { type: 'bench-plan', device: D, client: STREAM, method: 'signature' } },
      { tool: { type: 'bench-plan', device: D, client: PLANT, method: 'anomaly' } },
      { tool: { type: 'bench-plan', device: D, client: DISPATCH, method: 'hybrid' } },
    ],
    text: {
      writeup:
        'StreamCo should use signature detection. On its busy network signatures caught the two known attacks in 6 seconds with 0 false alarms for $2,000 a month, while anomaly raised 40 false alarms and took almost 8 minutes. Riverbend should use anomaly detection with the clean Sep 14 baseline, because its traffic is steady and it caught the new attack in 21 seconds with 0 false alarms for $800. County 911 should use hybrid: it caught both attacks, LockDown in 1 second, for $2,400.',
    },
  },
};
