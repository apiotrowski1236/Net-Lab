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
