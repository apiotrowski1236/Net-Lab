import type { Sim } from '../sim/sim';
import type { Frame, SimEvent } from '../sim/types';

/** Things the student does in the interface (not in the network). Goals can listen for these too. */
export type UiEvent =
  | { type: 'ui:inspect'; device: string }
  | { type: 'ui:open-frame'; device: string; frame: Frame }
  | { type: 'ui:enter-step'; step: string };

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
  /** Send forged ARP replies from `device` to one of `victims`. The student types the IP to claim. */
  | { kind: 'arp-spoof'; device: string; victims: string[] }
  | { kind: 'forwarding'; device: string }
  /** Announce prefixes from `device`. With `target`, feedback says whether a prefix would capture that address. */
  | { kind: 'bgp-announce'; device: string; target?: { ip: string; label: string } }
  | { kind: 'bgp-validate'; devices: string[] }
  /** Lock ARP entries on `device`. The student types the IP and the correct MAC. */
  | { kind: 'static-arp'; device: string }
  /** Plug cables between devices and unplug them. */
  | { kind: 'cable' }
  /** Send a ping from any computer or router. The student types the address. */
  | { kind: 'ping' }
  /**
   * Type IP addresses into the inspector. `fixed` pins a device to one
   * address; typing another shows `why`.
   */
  | { kind: 'ip-config'; fixed?: { device: string; cidr: string; why: string }[] }
  /** Set computers' default gateway in the inspector. */
  | { kind: 'gateway' }
  /** Add and remove routers' static routes in the inspector. */
  | { kind: 'static-route' };

/** Tools that change device settings in the inspector instead of having their own card. */
export const SETTING_TOOLS = ['ip-config', 'gateway', 'static-route'] as const;

/** A button in the lesson that makes something happen on the network ("Alice signs in"). */
export interface ActionDef {
  id: string;
  label: string;
  run: (sim: Sim) => void;
}

export interface StepDef {
  id: string;
  title: string;
  /** Markdown. Write [[deviceId]] to make a clickable device chip. */
  body: string;
  /** Puts the network in the state this step needs. Runs once, the first time a student arrives. Make it idempotent. */
  setup?: (sim: Sim) => void;
  actions?: ActionDef[];
  /** Tools unlock cumulatively: once a step shows a tool, later steps keep it. */
  tools?: ToolSpec[];
  goals?: GoalDef[];
  questions?: QuestionDef[];
  /** Devices to spotlight on the map. */
  focus?: string[];
  /** Open a dock tab when the step starts. */
  open?: 'capture' | 'tools' | { inspect: string };
  /** The final "review and submit" step. */
  kind?: 'submit';
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
  build: () => Sim;
  steps: StepDef[];
  /** Device whose packet capture appears in the Capture tab. */
  captureDevice?: string;
  /** Annotate MAC addresses with the owning device's name in the inspector. */
  labelMacs?: boolean;
  /**
   * For labs where students build the network: show port names where cables
   * meet routers and switches, and each device's current IP addresses under it.
   */
  map?: { ports?: boolean; addresses?: boolean };
  /** Show computers' routing tables (their own network and the default gateway) in the inspector. */
  hostRoutes?: boolean;
}

export interface LabStub {
  id: string;
  title: string;
  tagline: string;
  unit: number;
  codehs: string[];
  comingSoon: true;
}

export const goalKey = (step: string, goal: string) => `${step}/${goal}`;
export const answerKey = (step: string, q: string) => `${step}/${q}`;

export const defaultPoints = (q: QuestionDef): number =>
  q.points ?? (q.kind === 'choice' ? 1 : q.expect ? 1 : 2);
