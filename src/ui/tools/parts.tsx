import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Sim } from '../../sim/sim';
import { Icon } from '../icons';

/**
 * Small pieces every tool card and inspector section shares. Use these
 * instead of new widgets so all tools look and behave the same.
 */

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button class={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span class="toggle-track">
        <span class="toggle-knob" />
      </span>
      <span>{label}</span>
    </button>
  );
}

export type Msg = { tone: 'bad' | 'good' | 'info'; text: string; suggest?: string; onSuggest?: () => void; field?: string } | null;

/** A one-line message under a tool input: what went wrong, or what just happened. */
export function ToolMsg({ msg }: { msg: Msg }) {
  const ref = useRef<HTMLDivElement>(null);
  // The dock is short on a small laptop screen. Make sure the student sees the message.
  useLayoutEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [msg?.text]);
  if (!msg) return null;
  return (
    <div ref={ref} class={`tool-msg ${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={msg.tone === 'bad' ? 'warn' : msg.tone === 'good' ? 'check' : 'info'} size={14} />
      <span>
        {msg.text}
        {msg.suggest && msg.onSuggest && (
          <button class="btn tiny" onClick={msg.onSuggest}>
            Use {msg.suggest}
          </button>
        )}
      </span>
    </div>
  );
}

const kept = new WeakMap<object, Map<string, string>>();

/**
 * Text typed into a tool card that survives a trip to another tab. The Toolkit
 * unmounts its cards when the student opens the Inspect tab to copy something,
 * and plain useState would lose the half-typed text. `owner` is the lab session,
 * so another session (a reset, another student) starts empty.
 */
export function useKept(owner: object, key: string): [string, (v: string) => void] {
  let store = kept.get(owner);
  if (!store) kept.set(owner, (store = new Map()));
  const box = store;
  const [value, setValue] = useState(box.get(key) ?? '');
  return [
    value,
    (v: string) => {
      box.set(key, v);
      setValue(v);
    },
  ];
}

/** A text box with a Save button, for one setting. Shows the current value until the student types. */
export function useDraft(current: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return { value: draft ?? current, edited: draft !== null, set: setDraft, clear: () => setDraft(null) };
}

/** Something matching `pred` happened in the last `ms` of simulated time (for flashing a changed row). */
export function recentlyChanged(sim: Sim, pred: (e: Sim['events'][number]) => boolean, ms = 4000): boolean {
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i];
    if (sim.t - e.t > ms) return false;
    if (pred(e)) return true;
  }
  return false;
}
