import type { SimAction } from '../runtime/actions';
import { checkAddress, checkCable, checkForge, checkGateway, checkPing, checkPrefix, checkRoute, checkSpoofClaim, checkStaticArp, checkWifiPassphrase, type Checked } from '../runtime/toolInput';
import { checkNewMac, checkPortSecurity } from '../runtime/switchInput';
import type { LabSession } from '../runtime/session';
import { checkRule, checkScanTarget, ruleDraft } from '../runtime/firewallInput';
import type { Frame, LogEntry } from '../sim/types';
import { isEncrypted, isPlainLogin } from './helpers';
import type { ChoiceQuestion } from './types';

/**
 * Answer keys. Each lab has a solution that the walkthrough test plays from
 * the first step to the last, so a broken step fails the build. The app never
 * imports these files, so they are not shipped to students.
 */

export type Move =
  /** Click a device on the map. */
  | { inspect: string }
  /** Press a button in the lesson. */
  | { press: string }
  /** Use a control in the Toolkit. */
  | { tool: SimAction }
  /** Click the first captured frame that matches in the Capture tab. */
  | { openFrame: string; match: 'login' | 'encrypted' | ((f: Frame) => boolean) }
  /** Click the newest line in `openLog`'s log that matches `where`, in the Logs tab. */
  | { openLog: string; where: (e: LogEntry) => boolean };

export interface StepSolution {
  /** What to do, in order. The network runs until it is quiet after each move. */
  moves?: Move[];
  /** Answers for text questions. For teacher-graded questions these are sample answers. */
  text?: Record<string, string>;
}

export type LabSolution = Record<string, StepSolution>;

const MATCH: Record<'login' | 'encrypted', (f: Frame) => boolean> = { login: isPlainLogin, encrypted: isEncrypted };

export function playMove(s: LabSession, m: Move): void {
  if ('inspect' in m) s.ui({ type: 'ui:inspect', device: m.inspect });
  else if ('press' in m) s.runStepAction(m.press);
  else if ('tool' in m) {
    assertTypable(s, m.tool);
    s.dispatch(m.tool);
  }
  else if ('openLog' in m) {
    const hit = [...s.sim.dev(m.openLog).logs].reverse().find(m.where);
    if (!hit) throw new Error(`No matching log line on ${m.openLog}`);
    s.ui({ type: 'ui:open-log', device: m.openLog, entry: hit });
  } else {
    const pred = typeof m.match === 'function' ? m.match : MATCH[m.match];
    const hit = s.sim.dev(m.openFrame).capture.find((c) => pred(c.frame));
    if (!hit) throw new Error(`No ${typeof m.match === 'function' ? 'matching' : m.match} frame captured on ${m.openFrame}`);
    s.ui({ type: 'ui:open-frame', device: m.openFrame, frame: hit.frame });
  }
  s.sim.runUntilIdle();
}

/** The answer key's tool inputs must pass the same checks a student's typing does. */
function assertTypable(s: LabSession, a: SimAction): void {
  const sim = s.sim;
  let r: Checked<object>;
  switch (a.type) {
    case 'arp-spoof':
      r = checkSpoofClaim(sim, a.device, a.victim, a.claimIp);
      break;
    case 'static-arp':
      r = checkStaticArp(sim, a.device, a.ip, a.mac);
      break;
    case 'announce':
      r = checkPrefix(sim, a.device, a.prefix);
      break;
    case 'cable':
      r = checkCable(sim, a.a, a.aPort, a.b, a.bPort);
      break;
    case 'set-ip': {
      const fixed = s.tools.flatMap((t) => (t.kind === 'ip-config' ? (t.fixed ?? []) : []));
      r = checkAddress(sim, a.device, a.iface, a.cidr ?? '', fixed);
      break;
    }
    case 'gateway':
      r = checkGateway(sim, a.device, a.ip ?? '');
      break;
    case 'add-route':
      r = checkRoute(sim, a.device, a.prefix, a.via);
      break;
    case 'ping':
      r = checkPing(sim, a.device, a.ip);
      break;
    case 'dns-forge':
      r = checkForge(sim, a.device, a.resolver, a.name, a.ip);
      break;
    case 'set-mac':
      r = a.mac === null ? { ok: true } : checkNewMac(sim, a.device, a.mac);
      break;
    case 'port-security': {
      const c = a.config;
      r = c ? checkPortSecurity(sim, a.device, a.port, String(c.maxMacs), c.violation, (c.allowed ?? []).join(' ')) : { ok: true };
      break;
    }
    case 'wifi-security':
      r = a.passphrase !== undefined ? checkWifiPassphrase(sim, a.device, a.passphrase) : { ok: true };
      break;
    case 'wifi-passphrase':
      r = checkWifiPassphrase(sim, a.device, a.passphrase);
      break;
    case 'fw-add-rule':
      r = checkRule(sim, a.device, ruleDraft(a.rule));
      break;
    case 'fw-edit-rule':
      r = checkRule(sim, a.device, ruleDraft(a.rule), a.id);
      break;
    case 'scan':
      r = checkScanTarget(sim, a.device, a.target);
      break;
    default:
      r = { ok: true };
  }
  if (!r.ok) throw new Error(`Tool input rejected for ${JSON.stringify(a)}: ${r.msg}`);
}

export const correctChoice = (q: ChoiceQuestion) =>
  q.options
    .filter((o) => o.correct)
    .map((o) => o.id)
    .join(',');

/** Play one step: moves first, then every question. */
export function playStep(s: LabSession, sol: StepSolution | undefined): void {
  for (const m of sol?.moves ?? []) playMove(s, m);
  for (const q of s.step.questions ?? []) {
    if (q.kind === 'choice') {
      s.setDraft(s.step.id, q, correctChoice(q));
      s.check(s.step.id, q);
    } else {
      const v = sol?.text?.[q.id];
      if (v === undefined) throw new Error(`Solution has no answer for ${s.step.id}/${q.id}`);
      s.setDraft(s.step.id, q, v);
      if (q.expect) s.check(s.step.id, q);
    }
  }
}
