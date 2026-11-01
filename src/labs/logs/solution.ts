import type { LabSolution } from '../solution';
import { INCIDENT } from '.';
import { BROADCAST, C2, SCANNER } from './scenario';

/** Answer key for "Log Detective". Choice answers come from the lab itself. */
export const logsSolution: LabSolution = {
  shift: {
    moves: [
      { openLog: 'fw', where: (e) => e.source === 'firewall' },
      { openLog: 'sw', where: () => true },
      { openLog: 'files', where: () => true },
      { openLog: 'nids', where: (e) => e.source === 'ids' },
    ],
  },
  haystack: { moves: [{ openLog: 'files', where: (e) => e.source === 'auth' && e.fields?.action === 'fail' }] },
  signatures: { moves: [{ tool: { type: 'ids-signatures', device: 'nids', on: true } }, { press: 'replay-arp' }] },
  'something-new': { moves: [{ press: 'replay-exfil' }] },
  baseline: {
    moves: [
      { press: 'record-baseline' },
      { tool: { type: 'ids-anomaly', device: 'nids', on: true, tolerance: 'medium' } },
      { press: 'replay-exfil' },
      { press: 'run-backup' },
    ],
  },
  nips: { moves: [{ tool: { type: 'ids-prevention', device: 'nids', on: true } }, { press: 'replay-flood' }, { press: 'run-backup' }] },
  correlate: {
    moves: [
      { openLog: 'siem', where: (e) => e.fields?.incident === INCIDENT },
      { tool: { type: 'siem-triage', device: 'siem', incident: INCIDENT, verdict: 'real', action: 'escalate' } },
    ],
  },
  threshold: { moves: [{ press: 'score-morning' }, { tool: { type: 'ai-threshold', device: 'siem', value: 0.75 } }] },
  'ioc-hunt': {
    moves: [
      { openLog: 'fw', where: (e) => e.fields?.dst === C2 },
      { openLog: 'fw', where: (e) => e.fields?.src === SCANNER && e.fields?.action === 'deny' && e.fields?.proto === 'tcp' },
      { openLog: 'fw', where: (e) => e.fields?.proto === 'icmp' && e.fields?.dst === BROADCAST },
      { openLog: 'fw', where: (e) => e.fields?.app === 'ssh' && e.fields?.dport === 443 },
    ],
  },
  reflect: {
    text: {
      writeup:
        'The 3 a.m. upload was a real attack. The firewall logged ALLOW out TCP 10.10.20.22:52110 -> 45.77.12.9:8443 bytes=94371840, which is Raj’s PC sending 90 MB to an address the network never uses, at an hour when nobody was in the building. I would recommend hybrid detection for the utility. It is critical infrastructure, so it needs signatures to catch known attacks fast and anomaly detection to catch new ones like this upload. The trade-off is cost: hybrid runs two systems and produces more alerts, including false ones like the monthly backup, so the team has to tune it and spend time on triage.',
    },
  },
};
