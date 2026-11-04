import type { Sim } from '../sim/sim';
import type { Device, Frame, LogEntry, SimEvent } from '../sim/types';
import type { FwMode } from '../sim/firewall';
import type { ZoneLevel } from '../sim/zones';
import type { DemoFacts, DemoSpec } from '../demos/types';

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
  | { type: 'ui:demo'; step: string; demo: string; facts: DemoFacts };

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
}

export interface ChoiceQuestion {
  id: string;
  kind: 'choice';
  prompt: string;
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
  placeholder?: string;
  lines?: number;
  /** Auto-checked short answer. Without it, the answer is teacher-graded. */
  expect?: RegExp;
  /** Shown after a wrong auto-checked answer. */
  expectHint?: string;
  /**
   * Feedback for particular wrong answers, checked in order after an
   * auto-checked answer is marked wrong: the first `match` wins over
   * `expectHint`. For answers that show a known mistake (bits read backward).
   */
  wrong?: { match: RegExp; text: string }[];
  explain?: string;
  /** Soft target shown under the box. */
  minWords?: number;
  points?: number;
}

export type QuestionDef = (ChoiceQuestion | TextQuestion) & {
  /** Hide until the step's goals are done: for questions about what the student is about to see. */
  afterGoals?: boolean;
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
  /** Unlock the Logs tab, showing these devices' logs. Not a Toolkit card. */
  | { kind: 'logs'; devices: string[] }
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
  /** Scan the air from one of these devices to see nearby networks (wireless lab). */
  | { kind: 'wifi-scan'; devices: string[] }
  /** Try to break into a network the attacker can hear (wireless lab). */
  | { kind: 'wifi-crack'; attacker: string }
  /** Locate a hidden access point by taking signal readings from set spots (wireless lab). */
  | { kind: 'triangulate'; scanner: string; spots: { x: number; y: number; label: string }[] }
  /** Port scanner on `device`: ping sweep plus port scan of an address or network the student types, then connect to what's open. */
  | { kind: 'port-scan'; device: string }
  /**
   * Put standalone firewalls into cables. The outside port faces `internet`.
   * `feedback` explains each placement (`between` is the two devices the cable joined).
   */
  | { kind: 'firewall-place'; devices: string[]; internet: string; feedback?: PlacementFeedback[] }
  /**
   * Edit these firewalls' rules in the inspector (the card lists them). `modes`
   * are the firewall types the student may switch between; without it, no switching.
   */
  | { kind: 'firewall-rules'; devices: string[]; modes?: FwMode[] }
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
  /** Echo tool (smurf): ping from `device`, with an optional forged source address. Its own Toolkit card. */
  | { kind: 'echo-tool'; device: string }
  /** Turn `device`'s directed-broadcast forwarding on or off, in the inspector (smurf). Not a Toolkit card. */
  | { kind: 'directed-broadcast'; device: string };

export type IdsControl = 'signatures' | 'anomaly' | 'prevention';

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
export const CAPTURE_TOOLS = ['capture'] as const;

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
  /** The "review and submit" step. Last, unless extra-credit steps follow it. */
  kind?: 'submit';
  /**
   * Extra credit: an optional step after the submit step. It never counts as
   * unfinished. Its goals and questions are flagged `extra` in the report and
   * score into `score.extra`, not `auto`, so skipping it costs nothing. The
   * lesson asks the student to hand in again once they've done it.
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
   * Make the Capture tab look more like Wireshark, for a lab that gets students
   * ready for it (packet-capture): Wireshark's name under each packet layer,
   * and no "Hide ARP" shortcut, since students filter instead.
   */
  wireshark?: boolean;
  /** Annotate MAC addresses with the owning device's name in the inspector. */
  labelMacs?: boolean;
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
  };
  /** Wall-clock time at the start of the lab ("09:00" by default). Log lines are stamped from it. */
  clock?: string;
  /** Show computers' routing tables (their own network and the default gateway) in the inspector. */
  hostRoutes?: boolean;
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

/** What a text question says after a wrong check: the first `wrong` pattern that matches, else `expectHint`. */
export function wrongFeedback(q: TextQuestion, value: string): string {
  const v = value.trim();
  return q.wrong?.find((w) => w.match.test(v))?.text ?? q.expectHint ?? 'Not quite. Change your answer and check again.';
}

export const goalKey = (step: string, goal: string) => `${step}/${goal}`;
export const answerKey = (step: string, q: string) => `${step}/${q}`;

export const defaultPoints = (q: QuestionDef): number =>
  q.points ?? (q.kind === 'choice' ? 1 : q.expect ? 1 : 2);
