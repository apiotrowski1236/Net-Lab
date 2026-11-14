import type { Sim } from '../sim/sim';
import type { Device, Frame, LogEntry, SimEvent } from '../sim/types';
import type { FwMode } from '../sim/firewall';
import type { ZoneLevel } from '../sim/zones';
import type { DemoFacts, DemoSpec } from '../demos/types';
import type { TermCommand } from '../sim/terminal';
import type { BenchMethod } from '../sim/bench';
import type { CapStatsView, CaptureFileDef } from '../sim/capfile';

/** Things the student does in the interface (not in the network). Goals can listen for these too. */
export type UiEvent =
  | { type: 'ui:inspect'; device: string }
  | { type: 'ui:open-frame'; device: string; frame: Frame }
  /** The student clicked a line in the Logs tab. */
  | { type: 'ui:open-log'; device: string; entry: LogEntry }
  | { type: 'ui:enter-step'; step: string }
  /** The student opened a finding in the vulnerability scanner's report (net-audit). */
  | { type: 'ui:open-finding'; device: string; finding: string }
  /** The student applied a display filter in the Capture tab (packet-capture). Only valid filters; '' clears it. See src/sim/displayFilter.ts. */
  | { type: 'ui:filter'; device: string; filter: string }
  /** The student changed a demo on a lesson's stage (lessons with no network). `facts` is the demo's report after the change. */
  | { type: 'ui:demo'; step: string; demo: string; facts: DemoFacts }
  // Capture files (capture-analysis; see src/sim/capfile.ts). `file` is the CaptureFileDef id.
  /** The student opened a capture file in the Capture tab. */
  | { type: 'ui:open-capfile'; file: string }
  /** The student applied a display filter to a capture file. Only valid filters; '' clears it. */
  | { type: 'ui:capfile-filter'; file: string; filter: string }
  /** The student clicked packet `no` in a capture file. */
  | { type: 'ui:open-packet'; file: string; no: number; frame: Frame }
  /** The student opened one of a capture file's Statistics views. */
  | { type: 'ui:capfile-stats'; file: string; view: CapStatsView }
  /** The student followed TCP stream `stream` in a capture file. */
  | { type: 'ui:follow-stream'; file: string; stream: number };

export type AnyEvent = SimEvent | UiEvent;

export interface CheckCtx {
  sim: Sim;
  /** The event that triggered this check (undefined when checked on step entry). */
  ev?: AnyEvent;
  /** Simulated time when the student first entered this step. */
  since: number;
}

/** An automatically checked task, e.g. "Capture Alice's password". */
export interface GoalDef {
  id: string;
  label: string;
  hint?: string;
  points?: number;
  check: (c: CheckCtx) => boolean;
}

export interface ChoiceOption {
  id: string;
  text: string;
  correct?: boolean;
  /** Shown when the student picks this option. */
  feedback?: string;
  /** Keep at the end when options are shuffled (for "Both" or "None of these"). */
  last?: boolean;
  /** Select-all questions: a nudge shown when this right answer is the one left out. */
  missed?: string;
}

export interface ChoiceQuestion {
  id: string;
  kind: 'choice';
  prompt: string;
  /**
   * The number printed beside the question on a paper handout ("A5"). The
   * question card shows it, and the report uses it in place of the running
   * Q number, so a teacher grades against the handout. Every question in a
   * worksheet (LabDef.worksheet) has one.
   */
  label?: string;
  options: ChoiceOption[];
  /** Select-all-that-apply. */
  multi?: boolean;
  /** Shown once the student gets it right. */
  explain?: string;
  points?: number;
}

export interface TextQuestion {
  id: string;
  kind: 'text';
  prompt: string;
  /** The handout's number for the question ("A5"). See ChoiceQuestion.label. */
  label?: string;
  placeholder?: string;
  /** How tall the answer box starts, in lines. On an answer sheet it grows as the student types. */
  lines?: number;
  /**
   * A one-line answer: a name, an address, a password. An answer sheet draws a
   * single-line box for it, narrower than a written answer's box. Without it,
   * an answer sheet question is a written answer with a box `lines` tall.
   */
  short?: boolean;
  /** Auto-checked short answer. Without it, the answer is teacher-graded. */
  expect?: RegExp;
  /** Shown after a wrong auto-checked answer. */
  expectHint?: string;
  /**
   * Feedback for particular wrong answers, checked in order after an
   * auto-checked answer is marked wrong: the first `match` wins over
   * `expectHint`. For answers that show a known mistake (bits read backward).
   * `format`: the value is right but written the wrong way (a number in
   * words, missing 0s in front). The student still fixes it, but the report
   * doesn't count that check as a try.
   */
  wrong?: { match: RegExp; text: string; format?: boolean }[];
  /**
   * A second check, run only once `expect` passes: for an answer that has to
   * agree with the student's other answers (wireshark: the DNS reply went to
   * the address they gave in step 3). `answer(step, question)` reads another
   * answer's current text ('' if there is none). Return what to tell the
   * student to mark the answer wrong, or undefined to accept it.
   */
  verify?: (value: string, answer: AnswerLookup) => string | undefined;
  explain?: string;
  /** Soft target shown under the box. */
  minWords?: number;
  points?: number;
}

export type QuestionDef = (ChoiceQuestion | TextQuestion) & {
  /**
   * Hide until the step's goals are done: for questions about what the student
   * is about to see. A list of goal ids waits for those goals only.
   */
  afterGoals?: boolean | string[];
};

/**
 * Tools the lesson hands to the student. Students type addresses into the
 * tools themselves; the tool checks what they typed and explains mistakes.
 */
export type ToolSpec =
  | { kind: 'sniffer'; device: string }
  /**
   * Wireshark-style capture on `device`, in the Capture tab's toolbar (not the
   * Toolkit): Start (a new, empty capture) and Stop. `filter` adds the display
   * filter bar (packet-capture).
   */
  | { kind: 'capture'; device: string; filter?: boolean }
  /** Send forged ARP replies from `device` to one of `victims`. The student types the IP to claim. */
  | { kind: 'arp-spoof'; device: string; victims: string[] }
  | { kind: 'forwarding'; device: string }
  /** Announce prefixes from `device`. With `target`, feedback says whether a prefix would capture that address. */
  | { kind: 'bgp-announce'; device: string; target?: { ip: string; label: string } }
  | { kind: 'bgp-validate'; devices: string[] }
  /** Lock ARP entries on `device`. The student types the IP and the correct MAC. */
  | { kind: 'static-arp'; device: string }
  /**
   * Plug cables between devices and unplug them. `refuse` turns away cables
   * the lesson doesn't want, with its own words (see CableRefusal).
   */
  | { kind: 'cable'; refuse?: CableRefusal[] }
  /** Send a ping from any computer or router. The student types the address. */
  | { kind: 'ping' }
  /**
   * Type IP addresses into the inspector. `fixed` pins a device to one
   * address; typing another shows `why`.
   */
  | { kind: 'ip-config'; fixed?: { device: string; iface?: string; cidr: string; why: string }[] }
  /** Set computers' default gateway in the inspector. */
  | { kind: 'gateway' }
  /** Add and remove routers' static routes in the inspector. */
  | { kind: 'static-route' }
  /**
   * Unlock the Logs tab, showing these devices' logs. Not a Toolkit card.
   * `cite` adds **Cite this line** to an opened line in this step, and an
   * evidence list (watch-the-air; goals use helpers.citedLog).
   */
  | { kind: 'logs'; devices: string[]; cite?: boolean }
  /** DNS forger: send forged answers from `device` to `resolver`. The student types the name and the address to plant. */
  | { kind: 'dns-forge'; device: string; resolver: string }
  /** Resolver defenses on `device`: flush the cache and turn on unpredictable query IDs. */
  | { kind: 'resolver-defense'; device: string }
  /** MAC flooding from `device`: bursts of frames from made-up MACs. */
  | { kind: 'mac-flood'; device: string }
  /** Change `device`'s MAC address (MAC spoofing), or put back the factory one. */
  | { kind: 'mac-change'; device: string }
  /** Port security and shutting ports on switch `device`, in the inspector. The card points there. */
  | { kind: 'port-security'; device: string }
  /**
   * Change an access point's Wi-Fi settings in the inspector (wireless lab).
   * `basic` shows a home router's setup page instead (home-network): the
   * network's name, a password, and on or off.
   */
  | { kind: 'wifi-config'; device: string; basic?: boolean }
  /**
   * Scan the air from one of these devices to see nearby networks (wireless lab).
   * `watch` (watch-the-air) names the access point whose approved list the
   * student checks: the scanner then flags nothing itself, shows each
   * network's channel and the noise, and lets the student mark each network
   * on or off that list.
   */
  | { kind: 'wifi-scan'; devices: string[]; watch?: string }
  /** The wireless watch's alarm rules and replay on access point `device` (watch-the-air). */
  | { kind: 'wids'; device: string }
  /** Try to break into a network the attacker can hear (wireless lab). */
  | { kind: 'wifi-crack'; attacker: string }
  /** Locate a hidden access point by taking signal readings from set spots (wireless lab). */
  | {
      kind: 'triangulate';
      scanner: string;
      spots: { x: number; y: number; label: string }[];
      /** Named places in the room. The result names the one nearest the answer ("behind the bleachers") as well as the device. */
      places?: { x: number; y: number; label: string }[];
    }
  /** Port scanner on `device`: ping sweep plus port scan of an address or network the student types, then connect to what's open. */
  | { kind: 'port-scan'; device: string }
  /**
   * A command line on one of `devices` (src/ui/tools/Terminal.tsx, net-tools).
   * `commands` are the ones this step allows. nmap also needs `nmap`: the one
   * computer it is installed on, and the networks the owner's written
   * permission covers (`owner` signed it). Anything else is refused.
   */
  | { kind: 'terminal'; devices: string[]; commands: TermCommand[]; nmap?: { from: string; scope: string[]; owner: string } }
  /**
   * Put standalone firewalls into cables. The outside port faces `internet`.
   * `feedback` explains each placement (`between` is the two devices the cable joined).
   */
  | { kind: 'firewall-place'; devices: string[]; internet: string; feedback?: PlacementFeedback[] }
  /**
   * Edit these firewalls' rules in the inspector (the card lists them). `modes`
   * are the firewall types the student may switch between; without it, no switching.
   * `ips` lets the student turn a next-generation firewall's intrusion prevention on and off (firewall-types).
   */
  | { kind: 'firewall-rules'; devices: string[]; modes?: FwMode[]; ips?: boolean }
  /** Put a switch's ports in VLANs, in its inspector (segmentation). `vlans` are the choices besides VLAN 1, with names. */
  | { kind: 'vlan'; device: string; vlans?: { id: number; name: string }[] }
  /** Plan zones: put each listed device in a zone and give each zone a security level (segmentation). */
  | {
      kind: 'zone-plan';
      devices: string[];
      /** The zones to choose from, in order. */
      zones: { id: string; label: string }[];
      /** Each device's zone on a good plan, and its job ("aims the torpedoes"), for the line after a change. */
      fit?: Record<string, { zone: string; job: string }>;
      /** A level that doesn't suit a zone: zone id -> level -> what to say after "Saved.". */
      levelNotes?: Record<string, Partial<Record<ZoneLevel, string>>>;
    }
  /** Set a firewall's zone policy, in its inspector (segmentation). */
  | { kind: 'zone-policy'; device: string }
  /** Vulnerability scanner on `device`: scan its network, then read the report (net-audit). */
  | { kind: 'scanner'; device: string }
  /** The risk register on `device`: rate each finding's likelihood and impact (net-audit). */
  | { kind: 'risk-register'; device: string }
  /**
   * Security settings for router or switch `device` in the inspector: logins,
   * Telnet and SSH, port policy (net-audit). `vpn` also unlocks its VPN
   * settings; re-list the tool with it in a later step to unlock them then.
   */
  | { kind: 'hardening'; device: string; vpn?: boolean }
  /** Detection controls for the IDS sensor `device`, in the inspector (logs lab). `controls` reveals them one group at a time. */
  | { kind: 'ids'; device: string; controls: IdsControl[] }
  /** The SIEM `device`'s incident list and triage, in the inspector and the Logs tab. */
  | { kind: 'siem'; device: string }
  /** The AI model's alert threshold on the SIEM `device`, with live counts, in the inspector. */
  | { kind: 'ai-threshold'; device: string }
  /**
   * The detection bench `device` (detect-methods): pick a client, a method,
   * and settings, run it, and read the scoreboard. Only `clients` and
   * `methods` are offered; `controls` reveals the database, baseline, and
   * tolerance controls. `queue` shows the analyst queue for the newest run in
   * place of the scoreboard: a tired analyst works through its alerts, and
   * each row opens its ALERT line.
   */
  | { kind: 'bench'; device: string; clients: string[]; methods: BenchMethod[]; controls: BenchControl[]; queue?: boolean }
  /** Recommend a method for each client on the bench `device`, within its budget. */
  | { kind: 'bench-plan'; device: string }
  /** Echo tool (smurf): ping from `device`, with an optional forged source address. Its own Toolkit card. */
  | { kind: 'echo-tool'; device: string }
  /** Turn `device`'s directed-broadcast forwarding on or off, in the inspector (smurf). Not a Toolkit card. */
  | { kind: 'directed-broadcast'; device: string }
  /**
   * Saved capture files to open in the Capture tab instead of a live capture
   * (capture-analysis). `files` are ids from LabDef.captureFiles, in the order
   * listed. `device` is the computer the files were captured on: its chips
   * jump to the Capture tab. `filter` adds the display filter bar, `stats` the Statistics
   * views (Endpoints, Conversations, I/O Graph), and `follow` Follow TCP
   * Stream. See src/sim/capfile.ts and src/ui/CaptureFile.tsx.
   */
  | { kind: 'capture-file'; device: string; files: string[]; filter?: boolean; stats?: boolean; follow?: boolean };

export type IdsControl = 'signatures' | 'anomaly' | 'prevention';
export type BenchControl = 'db' | 'baseline' | 'tolerance';

/**
 * A cable the cable tool turns away (home-network). `between` names the two
 * devices, either order; '*' matches any device. `text` replaces the usual
 * message; `{a}` and `{b}` stand for the two devices' names, `{a}` being the
 * one matched by `between[0]`. The first match wins.
 */
export interface CableRefusal {
  between: [string, string];
  text: string;
}

/** What the firewall placement tool says about one choice of cable. */
export interface PlacementFeedback {
  /** Which firewall this is about (leave out: any of them). */
  device?: string;
  between: [string, string];
  good: boolean;
  text: string;
}

/** Tools that change device settings in the inspector instead of having their own card. */
export const SETTING_TOOLS = ['ip-config', 'gateway', 'static-route', 'wifi-config'] as const;

/** Tools that unlock a dock tab instead of a Toolkit card. Unlike other tools, a tab stays once a step opens it. */
export const TAB_TOOLS = ['logs'] as const;

/** Tools that live in the Capture tab's toolbar instead of the Toolkit. Like other tools, only the steps that list them offer them. */
export const CAPTURE_TOOLS = ['capture', 'capture-file'] as const;

/** Identifies a tool across steps: its kind and the device (or devices) it works on. */
export function toolKey(t: ToolSpec): string {
  const who = 'device' in t ? t.device : 'devices' in t ? t.devices.join(',') : 'attacker' in t ? t.attacker : 'scanner' in t ? t.scanner : '';
  return `${t.kind}@${who}`;
}

/** A button in the lesson that makes something happen on the network ("Alice signs in"). */
export interface ActionDef {
  id: string;
  label: string;
  run: (sim: Sim) => void;
  /**
   * The lines under the button after it runs, instead of the usual ones (ping
   * replies, browser pages, connections). `since` is when it was pressed.
   * Recomputed as the network changes, so it can say "on its way" then "done".
   */
  outcome?: (sim: Sim, since: number) => ActionLine[];
}

/** One line of a button's result. */
export interface ActionLine {
  tone: 'good' | 'bad' | 'wait';
  text: string;
}

export interface StepDef {
  id: string;
  title: string;
  /** Markdown. Write [[deviceId]] to make a clickable device chip. */
  body: string;
  /** Puts the network in the state this step needs. Runs once, the first time a student arrives. Make it idempotent. */
  setup?: (sim: Sim) => void;
  actions?: ActionDef[];
  /**
   * The tools this step offers, and only this step. List every tool the step
   * needs, including ones an earlier step introduced; nothing carries over
   * except the Logs tab (TAB_TOOLS). Leave out tools the step isn't about.
   */
  tools?: ToolSpec[];
  goals?: GoalDef[];
  questions?: QuestionDef[];
  /**
   * Interactive demos the stage shows in this step, top to bottom, in a lesson
   * with no network (a LabDef without `build`). See src/demos/types.ts.
   */
  demos?: DemoSpec[];
  /** Devices to spotlight on the map. */
  focus?: string[];
  /** Open a dock tab when the step starts. */
  open?: 'capture' | 'tools' | 'logs' | { inspect: string };
  /** The "review and submit" step. Last, unless optional extra challenge steps follow it. */
  kind?: 'submit';
  /**
   * Optional extra challenge: a step after the submit step, titled
   * "Optional extra challenge: ...". It never counts as unfinished and earns no
   * points, because the school doesn't allow awarding extra credit. Its goals
   * and questions are flagged `extra` in the report with `points: 0`. The lesson
   * asks the student to hand in again so the teacher sees the work.
   */
  extra?: true;
}

export interface LabDef {
  id: string;
  /** Bump when steps change in a way that would break a saved network replay. */
  version: number;
  title: string;
  tagline: string;
  unit: number;
  /** CodeHS lessons this lab supports, e.g. "3.2 Traffic in the Wrong Hands". */
  codehs: string[];
  /** AP Cybersecurity CED learning objectives. */
  ced: string[];
  minutes: number;
  objectives: string[];
  /**
   * The simulated network. Leave it out for a lesson with no network: the
   * stage then shows each step's `demos` instead of the map and dock, and
   * everything else (steps, goals, questions, saving, report, guide) works
   * the same. Call `buildNetwork(lab)` (src/labs/network.ts), not this.
   */
  build?: () => Sim;
  steps: StepDef[];
  /** Device whose packet capture appears in the Capture tab. */
  captureDevice?: string;
  /**
   * Saved capture files a step can hand out with the 'capture-file' tool
   * (capture-analysis). Each is recorded from scripted traffic the first time
   * it's opened (src/sim/capfile.ts).
   */
  captureFiles?: CaptureFileDef[];
  /**
   * Make the Capture tab look more like Wireshark, for a lab that gets students
   * ready for it (packet-capture): Wireshark's name under each packet layer,
   * and no "Hide ARP" shortcut, since students filter instead.
   */
  wireshark?: boolean;
  /** Annotate MAC addresses with the owning device's name in the inspector. */
  labelMacs?: boolean;
  /**
   * false hides the inspector's addressing tables (Addresses or Ports, ARP
   * table, MAC address table) for labs where devices stand for whole
   * networks and those tables only distract (detect-methods). Default true.
   */
  deviceTables?: boolean;
  /**
   * For labs where students build the network: show port names where cables
   * meet routers and switches, and each device's current IP addresses under it.
   */
  map?: {
    ports?: boolean;
    /** True for every computer and router, or pick devices (home-network leaves out the internet provider). */
    addresses?: boolean | ((d: Device) => boolean);
    /** Shapes drawn behind the devices: a building's walls, a Wi-Fi signal's reach, a DMZ or VLAN. Recomputed as the network changes. */
    zones?: (sim: Sim) => MapZone[];
    /** Devices to leave off the map for now (a radio nobody has turned on yet). Recomputed as the network changes. */
    hide?: (sim: Sim) => string[];
  };
  /** Wall-clock time at the start of the lab ("09:00" by default). Log lines are stamped from it. */
  clock?: string;
  /** Show computers' routing tables (their own network and the default gateway) in the inspector. */
  hostRoutes?: boolean;
  /**
   * An answer sheet for a lab students do somewhere else, from a paper or PDF
   * handout (a CYBER.ORG Range lab). There is no map, no demos, and no
   * instructions: the whole page is the handout's questions, so students type
   * answers as they work and hand them in with the usual report. `title` is
   * the handout's name. Each step before the submit step is one of the
   * handout's sections (title "A. Examine the Recon File", body usually '')
   * and holds only questions, each with a `label` from the handout ("A5").
   * The last step is the usual `kind: 'submit'`. No `build`, goals, tools,
   * actions, demos, or setups. src/labs/hijacked-ssh-1 is the example.
   */
  worksheet?: WorksheetInfo;
}

/** Where the students do a worksheet's lab (LabDef.worksheet). */
export interface WorksheetInfo {
  /** Where they do it, as it reads in a sentence: "the CYBER.ORG Range". */
  where: string;
  /** A link to it, opened in a new tab: "Open CYBER.ORG Range". The label also tags the home page card. */
  link?: { label: string; url: string };
}

/**
 * A labeled area on the map, in map coordinates (the 1000 x 600 canvas the
 * devices sit on). Drawn under cables and devices, so keep fills faint.
 */
export interface MapZone {
  id: string;
  shape: { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'circle'; cx: number; cy: number; r: number };
  /** Shown at the zone's top-left (rect) or top (circle). */
  label?: string;
  /** Put the label at the bottom-left instead (rect only), clear of tags that pop up above a device. */
  labelAt?: 'bottom';
  /** Colors the outline and fill: 'neutral' for a building, 'good' for a protected zone, 'bad' for hostile ground. */
  tone?: 'neutral' | 'info' | 'good' | 'warn' | 'bad';
  /** Dashed outline, e.g. for a radio signal's reach or a logical zone like a VLAN. */
  dashed?: boolean;
}

export interface LabStub {
  id: string;
  title: string;
  tagline: string;
  unit: number;
  codehs: string[];
  comingSoon: true;
}

/** A lesson with no network: its stage shows demos. */
export const isLesson = (lab: LabDef): boolean => !lab.build;

/** An answer sheet for a lab done somewhere else (LabDef.worksheet): one page of questions, no lesson. */
export const isWorksheet = (lab: LabDef): boolean => !!lab.worksheet;

/** Reads one of the student's other text answers ('' if there is none). */
export type AnswerLookup = (step: string, question: string) => string;

/** Whether a text answer passes `expect` and then `verify`. */
export function textCorrect(q: TextQuestion, value: string, answer: AnswerLookup): boolean {
  const v = value.trim();
  return !!q.expect?.test(v) && !q.verify?.(v, answer);
}

/**
 * What a text question says after a wrong check: `verify`'s message when only
 * it failed, else the first `wrong` pattern that matches, else `expectHint`.
 */
export function wrongFeedback(q: TextQuestion, value: string, answer?: AnswerLookup): string {
  const v = value.trim();
  const disagree = answer && q.expect?.test(v) ? q.verify?.(v, answer) : undefined;
  return disagree ?? wrongMatch(q, value)?.text ?? q.expectHint ?? 'Not quite. Change your answer and check again.';
}

/** The first `wrong` entry that matches a text answer. */
export function wrongMatch(q: TextQuestion, value: string): NonNullable<TextQuestion['wrong']>[number] | undefined {
  const v = value.trim();
  return q.wrong?.find((w) => w.match.test(v));
}

export const goalKey = (step: string, goal: string) => `${step}/${goal}`;
export const answerKey = (step: string, q: string) => `${step}/${q}`;

export const defaultPoints = (q: QuestionDef): number =>
  q.points ?? (q.kind === 'choice' ? 1 : q.expect ? 1 : 2);
