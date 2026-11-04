import { useMemo } from 'preact/hooks';
import type { DemoInput } from '../../demos/types';
import { renderMarkdown } from '../markdown';

/** What every demo view gets: its spec, its current state, and a way to send the student's inputs to the session. */
export interface DemoViewProps<Spec, State> {
  spec: Spec;
  state: State;
  send: (input: DemoInput) => void;
}

export type DemoView<Spec, State> = (props: DemoViewProps<Spec, State>) => preact.JSX.Element | null;

const NO_LABELS: Record<string, string> = {};

export function Md({ src, class: cls = '' }: { src: string; class?: string }) {
  const html = useMemo(() => renderMarkdown(src, NO_LABELS), [src]);
  return <div class={`prose ${cls}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A light bulb, lit or not. Decorative: the button around it says on or off. */
export function Bulb({ on, size = 34 }: { on: boolean; size?: number }) {
  return (
    <svg class={`bulb ${on ? 'on' : ''}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {on && <circle cx={16} cy={13} r={15} class="bulb-glow" />}
      <path class="bulb-glass" d="M16 3 a9.5 9.5 0 0 0 -5.6 17.2 c1 .8 1.6 1.8 1.6 3 V24 h8 v-.8 c0 -1.2 .6 -2.2 1.6 -3 A9.5 9.5 0 0 0 16 3 Z" />
      <path class="bulb-base" d="M12 26 h8 M12.8 29 h6.4" />
    </svg>
  );
}

/** "1 switch", "2 switches". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Spoken name for a place: "the 16s place", "the 1s place". */
export const placeName = (v: number) => `the ${v}s place`;
