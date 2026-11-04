import { asciiClean, asciiMax, type AsciiState } from '../../demos/ascii';
import { toBits } from '../../demos/binary';
import type { AsciiSpec } from '../../demos/types';
import type { DemoViewProps } from './parts';

/** Type a word and see each character's ASCII code, in decimal and as a byte. */
export function AsciiView({ spec, state: s, send }: DemoViewProps<AsciiSpec, AsciiState>) {
  return (
    <div class="ascii">
      <label class="ascii-input">
        <span class="demo-label">Word</span>
        <input
          type="text"
          value={s.text}
          maxLength={asciiMax(spec)}
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => {
            const el = e.target as HTMLInputElement;
            const clean = asciiClean(spec, el.value);
            if (clean !== el.value) el.value = clean;
            send({ text: clean });
          }}
        />
      </label>
      {s.text ? (
        <table class="table ascii-table">
          <thead>
            <tr>
              <th>Character</th>
              <th>Code</th>
              <th>Byte</th>
            </tr>
          </thead>
          <tbody>
            {[...s.text].map((c, i) => (
              <tr key={i}>
                <td>
                  <code>{c === ' ' ? 'space' : c}</code>
                </td>
                <td>{c.charCodeAt(0)}</td>
                <td>
                  <code>{toBits(c.charCodeAt(0))}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted small">Type something to see its bytes.</p>
      )}
    </div>
  );
}
