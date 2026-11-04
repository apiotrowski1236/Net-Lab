import type { AsciiSpec, DemoModel } from './types';

export interface AsciiState {
  text: string;
}

export const asciiMax = (spec: AsciiSpec) => spec.maxLength ?? 10;

/** Keep printable ASCII only (space to ~), up to the limit. */
export function asciiClean(spec: AsciiSpec, raw: string): string {
  return [...raw]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)
    .slice(0, asciiMax(spec))
    .join('');
}

export const asciiModel: DemoModel<AsciiSpec, AsciiState> = {
  init: (spec) => ({ text: asciiClean(spec, spec.start ?? 'Hi') }),
  apply(spec, s, input) {
    if (!('text' in input)) return s;
    const text = asciiClean(spec, input.text);
    return text === s.text ? s : { text };
  },
  facts: (_spec, s) => ({ length: s.text.length }),
};
