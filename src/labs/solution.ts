import type { SimAction } from '../runtime/actions';
import {
  checkAddress,
  checkCable,
  checkEcho,
  checkForge,
  checkGateway,
  checkPing,
  checkPrefix,
  checkRoute,
  checkSpoofClaim,
  checkStaticArp,
  checkWifiPassphrase,
  checkWifiSsid,
  checkWifiTurnOn,
  type Checked,
} from '../runtime/toolInput';
import { checkNewMac, checkPortSecurity } from '../runtime/switchInput';
import type { LabSession } from '../runtime/session';
import { checkRule, checkScanTarget, ruleDraft } from '../runtime/firewallInput';
import { checkCommand } from '../runtime/termInput';
import type { Frame, LogEntry } from '../sim/types';
import { parseFilter } from '../sim/displayFilter';
import { isEncrypted, isPlainLogin, isTelnetLogin } from './helpers';
import { RISK_LEVELS } from '../sim/audit';
import { HARDEN_SETTINGS } from '../sim/hardening';
import type { DemoInput } from '../demos/types';
import { loadCaptureFile, type CapStatsView } from '../sim/capfile';
import type { ChoiceQuestion, ToolSpec } from './types';

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
  | { openFrame: string; match: 'login' | 'encrypted' | 'telnet' | ((f: Frame) => boolean) }
  /** Click a finding in the vulnerability scanner's newest report on `openFinding` (the auditor). */
  | { openFinding: string; id: string }
  /** Click the newest line in `openLog`'s log that matches `where`, in the Logs tab. */
  | { openLog: string; where: (e: LogEntry) => boolean }
  /** Cite the newest line in `citeLog`'s log that matches `where`, in the Logs tab (watch-the-air). */
  | { citeLog: string; where: (e: LogEntry) => boolean }
  /** Type a display filter into `filter`'s Capture tab and apply it (packet-capture). It must be valid. */
  | { filter: string; text: string }
  /** Use demo `demo` on the step's stage (lessons with no network): one tap, flip, or choice. */
  | { demo: string; input: DemoInput }
  /**
   * Open capture file `capfile` in the Capture tab (capture-analysis), then
   * optionally do one thing in it: apply a display filter, open a Statistics
   * view, follow TCP stream `follow`, or click packet `packet` (its No.).
   */
  | { capfile: string; filter?: string; stats?: CapStatsView; follow?: number; packet?: number };

export interface StepSolution {
  /** What to do, in order. The network runs until it is quiet after each move. */
  moves?: Move[];
  /** Answers for text questions. For teacher-graded questions these are sample answers. */
  text?: Record<string, string>;
}

export type LabSolution = Record<string, StepSolution>;

const MATCH: Record<'login' | 'encrypted' | 'telnet', (f: Frame) => boolean> = { login: isPlainLogin, encrypted: isEncrypted, telnet: isTelnetLogin };

export function playMove(s: LabSession, m: Move): void {
  if ('inspect' in m) s.ui({ type: 'ui:inspect', device: m.inspect });
  else if ('demo' in m) {
    if (!s.demoSpec(m.demo)) throw new Error(`Step "${s.step.id}" has no demo "${m.demo}". List it in this step's demos.`);
    s.demo(m.demo, m.input);
  } else if ('press' in m) s.runStepAction(m.press);
  else if ('tool' in m) {
    assertInReach(s, m.tool);
    assertTypable(s, m.tool);
    s.dispatch(m.tool);
  }
  else if ('capfile' in m) playCapfile(s, m);
  else if ('filter' in m) {
    if (!s.tools.some((t) => t.kind === 'capture' && t.device === m.filter && t.filter)) {
      throw new Error(`Step "${s.step.id}" offers no display filter on ${m.filter}. List { kind: 'capture', device: '${m.filter}', filter: true } in its tools.`);
    }
    const p = parseFilter(m.text);
    if (!p.ok) throw new Error(`The filter "${m.text}" is invalid: ${p.msg}`);
    s.ui({ type: 'ui:filter', device: m.filter, filter: m.text });
  } else if ('openFinding' in m) {
    const a = s.sim.dev(m.openFinding).audit;
    const hit = a?.reports[a.reports.length - 1]?.findings.find((f) => f.id === m.id);
    if (!hit) throw new Error(`No ${m.id} finding in ${m.openFinding}'s newest report`);
    s.ui({ type: 'ui:open-finding', device: m.openFinding, finding: m.id });
  } else if ('citeLog' in m) {
    const hit = [...s.sim.dev(m.citeLog).logs].reverse().find(m.where);
    if (!hit) throw new Error(`No matching log line on ${m.citeLog} to cite`);
    if (!(s.step.tools ?? []).some((t) => t.kind === 'logs' && t.cite && t.devices.includes(m.citeLog))) {
      throw new Error(`Step "${s.step.id}" offers no citing on ${m.citeLog}. List { kind: 'logs', devices: [...], cite: true } in its tools.`);
    }
    s.ui({ type: 'ui:open-log', device: m.citeLog, entry: hit });
    s.dispatch({ type: 'log-cite', device: m.citeLog, no: hit.no, on: true });
  } else if ('openLog' in m) {
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

function playCapfile(s: LabSession, m: Extract<Move, { capfile: string }>): void {
  const tool = s.tools.find((t): t is Extract<ToolSpec, { kind: 'capture-file' }> => t.kind === 'capture-file' && t.files.includes(m.capfile));
  if (!tool) throw new Error(`Step "${s.step.id}" offers no capture file "${m.capfile}". List it in a { kind: 'capture-file' } tool.`);
  const def = s.lab.captureFiles?.find((f) => f.id === m.capfile);
  if (!def) throw new Error(`Lab has no capture file "${m.capfile}" in captureFiles`);
  s.ui({ type: 'ui:open-capfile', file: m.capfile });
  if (m.filter !== undefined) {
    if (!tool.filter) throw new Error(`Step "${s.step.id}" offers no display filter on capture files. Set filter: true.`);
    const p = parseFilter(m.filter);
    if (!p.ok) throw new Error(`The filter "${m.filter}" is invalid: ${p.msg}`);
    s.ui({ type: 'ui:capfile-filter', file: m.capfile, filter: m.filter });
  }
  if (m.stats) {
    if (!tool.stats) throw new Error(`Step "${s.step.id}" offers no Statistics. Set stats: true.`);
    s.ui({ type: 'ui:capfile-stats', file: m.capfile, view: m.stats });
  }
  const file = loadCaptureFile(def);
  if (m.follow !== undefined) {
    if (!tool.follow) throw new Error(`Step "${s.step.id}" offers no Follow TCP Stream. Set follow: true.`);
    if (!file.frames.some((c) => c.frame.ip?.tcp?.stream === m.follow)) throw new Error(`${m.capfile} has no TCP stream ${m.follow}`);
    s.ui({ type: 'ui:follow-stream', file: m.capfile, stream: m.follow });
  }
  if (m.packet !== undefined) {
    const c = file.frames[m.packet - 1];
    if (!c) throw new Error(`${m.capfile} has no packet ${m.packet}`);
    s.ui({ type: 'ui:open-packet', file: m.capfile, no: c.no, frame: c.frame });
  }
}

/** Whether `t` works on device `d`: its device, one of its devices, or any device for a tool that names none. */
function on(t: ToolSpec, d: string): boolean {
  if ('device' in t) return t.device === d;
  if ('devices' in t) return t.devices.includes(d);
  if ('attacker' in t) return t.attacker === d;
  if ('scanner' in t) return t.scanner === d;
  return true;
}

/** Which tool lets a student take each action, the way the interface wires them. */
const TOOL_FOR: Partial<Record<SimAction['type'], (t: ToolSpec, a: SimAction) => boolean>> = {
  sniff: (t, a) => t.kind === 'sniffer' && on(t, dev(a)),
  capture: (t, a) => t.kind === 'capture' && on(t, dev(a)),
  forward: (t, a) => t.kind === 'forwarding' && on(t, dev(a)),
  'arp-spoof': (t, a) => t.kind === 'arp-spoof' && on(t, dev(a)),
  'static-arp': (t, a) => t.kind === 'static-arp' && on(t, dev(a)),
  announce: (t, a) => t.kind === 'bgp-announce' && on(t, dev(a)),
  withdraw: (t, a) => t.kind === 'bgp-announce' && on(t, dev(a)),
  validate: (t, a) => t.kind === 'bgp-validate' && on(t, dev(a)),
  ping: (t) => t.kind === 'ping',
  echo: (t, a) => t.kind === 'echo-tool' && on(t, dev(a)),
  'directed-broadcast': (t, a) => t.kind === 'directed-broadcast' && on(t, dev(a)),
  cable: (t) => t.kind === 'cable',
  unplug: (t) => t.kind === 'cable',
  'set-ip': (t) => t.kind === 'ip-config',
  gateway: (t) => t.kind === 'gateway',
  'add-route': (t) => t.kind === 'static-route',
  'remove-route': (t) => t.kind === 'static-route',
  'dns-forge': (t, a) => t.kind === 'dns-forge' && on(t, dev(a)),
  'resolver-harden': (t, a) => t.kind === 'resolver-defense' && on(t, dev(a)),
  'dns-flush': (t, a) => t.kind === 'resolver-defense' && on(t, dev(a)),
  'mac-flood': (t, a) => t.kind === 'mac-flood' && on(t, dev(a)),
  'set-mac': (t, a) => t.kind === 'mac-change' && on(t, dev(a)),
  // The switch's port settings, or the hardening section's "shut unused ports".
  'port-security': (t, a) => (t.kind === 'port-security' || t.kind === 'hardening') && on(t, dev(a)),
  'port-shutdown': (t, a) => (t.kind === 'port-security' || t.kind === 'hardening') && on(t, dev(a)),
  'wifi-security': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-passphrase': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-power': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-beacon': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-wps': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-auth': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-macfilter': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-off': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-ssid': (t, a) => t.kind === 'wifi-config' && on(t, dev(a)),
  'wifi-crack': (t, a) => t.kind === 'wifi-crack' && on(t, dev(a)),
  'wifi-scan': (t, a) => t.kind === 'wifi-scan' && on(t, dev(a)),
  'wifi-measure': (t, a) => t.kind === 'triangulate' && on(t, dev(a)),
  // watch-the-air: marks are made in the scanner's watch mode; rules and replays on the wireless watch card.
  'wids-mark': (t, a) => t.kind === 'wifi-scan' && t.watch === dev(a),
  'wids-rule': (t, a) => t.kind === 'wids' && on(t, dev(a)),
  'wids-threshold': (t, a) => t.kind === 'wids' && on(t, dev(a)),
  'wids-replay': (t, a) => t.kind === 'wids' && on(t, dev(a)),
  'log-cite': (t, a) => t.kind === 'logs' && !!t.cite && on(t, dev(a)),
  scan: (t, a) => t.kind === 'port-scan' && on(t, dev(a)),
  term: (t, a) => t.kind === 'terminal' && on(t, dev(a)),
  connect: (t, a) => t.kind === 'port-scan' && on(t, dev(a)),
  'fw-place': (t, a) => t.kind === 'firewall-place' && on(t, dev(a)),
  'fw-unplace': (t, a) => t.kind === 'firewall-place' && on(t, dev(a)),
  // The rule editor, or the hardening section's guard on the router itself.
  'fw-add-rule': (t, a) => (t.kind === 'firewall-rules' || t.kind === 'hardening') && on(t, dev(a)),
  'fw-delete-rule': (t, a) => (t.kind === 'firewall-rules' || t.kind === 'hardening') && on(t, dev(a)),
  'fw-edit-rule': (t, a) => t.kind === 'firewall-rules' && on(t, dev(a)),
  'fw-move-rule': (t, a) => t.kind === 'firewall-rules' && on(t, dev(a)),
  'fw-mode': (t, a) => t.kind === 'firewall-rules' && on(t, dev(a)),
  'fw-ips': (t, a) => t.kind === 'firewall-rules' && !!t.ips && on(t, dev(a)),
  'set-vlan': (t, a) => t.kind === 'vlan' && on(t, dev(a)),
  'set-zone': (t, a) => t.kind === 'zone-plan' && on(t, dev(a)),
  'set-zone-level': (t) => t.kind === 'zone-plan',
  'set-zone-policy': (t, a) => t.kind === 'zone-policy' && on(t, dev(a)),
  'audit-scan': (t, a) => t.kind === 'scanner' && on(t, dev(a)),
  'rate-risk': (t, a) => t.kind === 'risk-register' && on(t, dev(a)),
  harden: (t, a) => t.kind === 'hardening' && on(t, dev(a)),
  'vpn-config': (t, a) => t.kind === 'hardening' && on(t, dev(a)),
  'ids-signatures': (t, a) => t.kind === 'ids' && on(t, dev(a)) && t.controls.includes('signatures'),
  'ids-anomaly': (t, a) => t.kind === 'ids' && on(t, dev(a)) && t.controls.includes('anomaly'),
  'ids-prevention': (t, a) => t.kind === 'ids' && on(t, dev(a)) && t.controls.includes('prevention'),
  'siem-triage': (t, a) => t.kind === 'siem' && on(t, dev(a)),
  'ai-threshold': (t, a) => t.kind === 'ai-threshold' && on(t, dev(a)),
  // detect-methods: the bench card offers only the clients, methods, and controls the step lists.
  'bench-set': (t, a) =>
    a.type === 'bench-set' &&
    t.kind === 'bench' &&
    on(t, dev(a)) &&
    t.clients.includes(a.client) &&
    (a.method === undefined || t.methods.includes(a.method)) &&
    (a.tolerance === undefined || t.controls.includes('tolerance')),
  'bench-baseline': (t, a) => a.type === 'bench-baseline' && t.kind === 'bench' && on(t, dev(a)) && t.clients.includes(a.client) && t.controls.includes('baseline'),
  'bench-db': (t, a) => t.kind === 'bench' && on(t, dev(a)) && t.controls.includes('db'),
  'bench-run': (t, a) => a.type === 'bench-run' && t.kind === 'bench' && on(t, dev(a)) && t.clients.includes(a.client),
  'bench-plan': (t, a) => t.kind === 'bench-plan' && on(t, dev(a)),
  linux: (t, a) => t.kind === 'ssh-guard' && on(t, dev(a)) && a.type === 'linux' && t.controls.includes(a.setting),
};

const dev = (a: SimAction): string => ('device' in a ? a.device : '');

/** Why none of `tools` can take action `a`, or null if one can. */
export function missingTool(tools: ToolSpec[], a: SimAction): string | null {
  const ok = TOOL_FOR[a.type];
  if (!ok) return `No tool takes a "${a.type}" action. Use a step button ({ press }) instead.`;
  return tools.some((t) => ok(t, a)) ? null : `no tool for ${a.type}${dev(a) ? ` on ${dev(a)}` : ''}`;
}

/** A tool move needs a tool the current step offers: tools don't carry over from earlier steps. */
function assertInReach(s: LabSession, a: SimAction): void {
  const why = missingTool(s.tools, a);
  if (why) throw new Error(`Step "${s.step.id}" offers ${why}. List the tool in this step's tools.`);
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
    case 'cable': {
      const tool = s.tools.find((t) => t.kind === 'cable');
      r = checkCable(sim, a.a, a.aPort, a.b, a.bPort, tool?.kind === 'cable' ? tool.refuse : undefined);
      break;
    }
    case 'unplug': {
      const iface = sim.dev(a.device).ifaces.find((i) => i.id === a.iface);
      r = iface?.linkId && sim.links[iface.linkId]?.fixed ? { ok: false, msg: 'That cable is built in. The interface offers no Unplug for it.' } : { ok: true };
      break;
    }
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
    case 'echo':
      r = checkEcho(sim, a.device, a.target, a.source ?? '');
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
    case 'wifi-ssid':
      r = checkWifiSsid(sim, a.device, a.ssid);
      break;
    case 'wifi-off': {
      // The basic Wi-Fi setup (home-network) won't turn on a network without a password.
      const basic = s.tools.some((t) => t.kind === 'wifi-config' && t.device === a.device && t.basic);
      r = basic && !a.off ? checkWifiTurnOn(sim, a.device) : { ok: true };
      break;
    }
    case 'fw-add-rule':
      r = checkRule(sim, a.device, ruleDraft(a.rule));
      break;
    case 'fw-edit-rule':
      r = checkRule(sim, a.device, ruleDraft(a.rule), a.id);
      break;
    case 'scan':
      r = checkScanTarget(sim, a.device, a.target);
      break;
    case 'term': {
      const tool = s.tools.find((t) => t.kind === 'terminal' && t.devices.includes(a.device));
      r = tool?.kind === 'terminal' ? checkCommand(sim, tool, a.device, a.line) : { ok: false, msg: 'No terminal offered' };
      break;
    }
    // net-audit: chosen from dropdowns and toggles, so only check they name real things.
    case 'rate-risk':
      r =
        sim.dev(a.device).audit?.reports.some((x) => x.findings.some((f) => f.id === a.finding)) &&
        [a.likelihood, a.impact].every((l) => l === undefined || RISK_LEVELS.includes(l))
          ? { ok: true }
          : { ok: false, msg: `No finding ${a.finding} to rate` };
      break;
    case 'harden':
      r = sim.dev(a.device).hardening && HARDEN_SETTINGS.includes(a.setting) ? { ok: true } : { ok: false, msg: `${a.device} has no setting ${a.setting}` };
      break;
    case 'vpn-config':
      r = sim.dev(a.device).vpn?.server ? { ok: true } : { ok: false, msg: `${a.device} is not a VPN server` };
      break;
    // detect-methods: picked from buttons, so only check they name real things.
    case 'bench-baseline': {
      const c = sim.dev(a.device).bench?.config.clients.find((x) => x.id === a.client);
      r = c?.baselineDays.includes(a.day) ? { ok: true } : { ok: false, msg: `${a.client} has no baseline day ${a.day}` };
      break;
    }
    case 'bench-run': {
      // The Run button is greyed out until anomaly detection has a baseline.
      const set = sim.dev(a.device).bench?.settings[a.client];
      r = set && (set.method === 'signature' || set.baseline) ? { ok: true } : { ok: false, msg: `Record a baseline for ${a.client} first` };
      break;
    }
    case 'bench-db':
      r = sim.dev(a.device).bench?.config.versions.some((v) => v.id === a.version) ? { ok: true } : { ok: false, msg: `No database ${a.version}` };
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
