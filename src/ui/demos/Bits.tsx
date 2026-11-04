import { fromBits, hexDigit, placeValues, toBits } from '../../demos/binary';
import type { BitsState } from '../../demos/bits';
import type { BitsSpec, WireView } from '../../demos/types';
import { Icon } from '../icons';
import { Bulb, placeName, type DemoViewProps } from './parts';

/** Dots on a binary card, in a near-square grid: 16 is 4 x 4, 8 is 4 x 2. */
function Dots({ n }: { n: number }) {
  const cols = 2 ** Math.ceil(Math.log2(n) / 2);
  return (
    <span class="bcard-dots" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} class="bdot" />
      ))}
    </span>
  );
}

/** The numbers to make, each checked off once the cards have shown it. */
function Targets({ targets, found, now }: { targets: number[]; found: number[]; now: number }) {
  return (
    <div class="bc-targets" role="list" aria-label="Numbers to make">
      <span class="bc-targets-label" aria-hidden="true">
        Make
      </span>
      {targets.map((t) => {
        const done = found.includes(t);
        return (
          <span key={t} role="listitem" class={`bc-target ${done ? 'done' : ''} ${t === now ? 'now' : ''}`} aria-label={`${t}: ${done ? 'made' : 'not made yet'}`}>
            {done && <Icon name="check" size={13} />}
            {t}
          </span>
        );
      })}
    </div>
  );
}

/** Every target made so far, with the bits that made it and the cards that add up to it. */
function FoundLog({ found, places }: { found: number[]; places: number }) {
  const pv = placeValues(places);
  return (
    <div class="bc-log">
      <div class="bc-log-title">Numbers you made</div>
      {found.length === 0 ? (
        <p class="muted small bc-log-empty">Each number you make shows up here with its bits.</p>
      ) : (
        <ol class="bc-log-list" aria-live="polite">
          {found.map((v) => {
            const bits = toBits(v, places);
            return (
              <li key={v} class="bc-log-row">
                <Icon name="check" size={14} />
                <strong class="bc-log-num">{v}</strong>
                <span class="bc-log-eq">=</span>
                <span class="bc-log-bits" aria-label={`bits ${[...bits].join(' ')}`}>
                  {[...bits].map((c, i) => (
                    <span key={i} class={`bc-log-bit ${c === '1' ? 'one' : ''}`}>
                      {c}
                    </span>
                  ))}
                </span>
                <span class="bc-log-sum muted">{pv.filter((_, i) => bits[i] === '1').join(' + ')}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Cards({ spec, state: s, send }: DemoViewProps<BitsSpec, BitsState>) {
  const pv = placeValues(spec.places);
  const found = s.found ?? [];
  return (
    <>
      {spec.targets && <Targets targets={spec.targets} found={found} now={fromBits(s.bits)} />}
      <div class="bcards" style={{ '--n': spec.places }}>
        {pv.map((v, i) => {
          const up = s.bits[i] === '1';
          return (
            <button key={v} class={`bcard ${up ? 'up' : 'down'}`} aria-pressed={up} aria-label={`${v} card, ${up ? 'face up' : 'face down'}`} onClick={() => send({ flip: i })}>
              <span class="bcard-inner">
                <span class="bcard-face bcard-front">
                  <Dots n={v} />
                  <span class="bcard-num">{v}</span>
                </span>
                <span class="bcard-face bcard-back" />
              </span>
              <span class="bcard-bit" aria-hidden="true">
                {up ? 1 : 0}
              </span>
            </button>
          );
        })}
      </div>
      <div class="bits-readout" aria-live="polite">
        <span>
          Bits <code class="bits-code">{s.bits}</code>
        </span>
        {spec.total && (
          <span>
            Dots showing <strong class="bits-total">{fromBits(s.bits)}</strong>
          </span>
        )}
      </div>
      {spec.targets && <FoundLog found={found} places={spec.places} />}
    </>
  );
}

/** The place-value board: place values on top, a bit to tap under each. */
function Board({ spec, state: s, send }: DemoViewProps<BitsSpec, BitsState>) {
  const pv = placeValues(spec.places);
  return (
    <>
      <div class="pv-grid" style={{ '--n': spec.places }}>
        {pv.map((v) => (
          <div key={`h${v}`} class="pv-head">
            {v}
          </div>
        ))}
        {pv.map((v, i) => (
          <button key={`b${v}`} class={`pv-bit ${s.bits[i] === '1' ? 'one' : ''}`} aria-pressed={s.bits[i] === '1'} aria-label={`${placeName(v)}: ${s.bits[i]}`} onClick={() => send({ flip: i })}>
            {s.bits[i]}
          </button>
        ))}
      </div>
      <div class="bits-readout">
        {spec.total ? (
          <span aria-live="polite">
            <code class="bits-code">{s.bits}</code> = <strong class="bits-total">{fromBits(s.bits)}</strong>
          </span>
        ) : (
          <span class="muted small">Tap a box to switch it between 0 and 1. Add up the place values yourself.</span>
        )}
        <button class="btn ghost small" disabled={!s.bits.includes('1')} onClick={() => send({ clear: true })}>
          Clear
        </button>
      </div>
    </>
  );
}

const VIEW_LABEL: Record<WireView, string> = { voltage: 'Voltage', light: 'Lights', bits: 'Bits' };
const VIEW_NOTE: Record<WireView, string> = {
  voltage: 'This is what the chip really holds: a high or a low voltage on each wire.',
  light: 'The same eight wires, drawn as lights that are on or off.',
  bits: 'The abstraction: we call a high voltage 1 and a low voltage 0.',
};

/** One byte seen three ways: voltages, lights, or bits. Tap a wire to flip it. */
function Wires({ spec, state: s, send }: DemoViewProps<BitsSpec, BitsState>) {
  return (
    <>
      <div class="demo-row">
        <span class="demo-label" id={`${spec.id}-view`}>
          View as
        </span>
        <div class="seg" role="group" aria-labelledby={`${spec.id}-view`}>
          {(Object.keys(VIEW_LABEL) as WireView[]).map((v) => (
            <button key={v} class={s.view === v ? 'on' : ''} aria-pressed={s.view === v} onClick={() => send({ view: v })}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>
      <div class={`wires view-${s.view}`} style={{ '--n': spec.places }}>
        {[...s.bits].map((c, i) => {
          const hi = c === '1';
          const name = s.view === 'voltage' ? (hi ? 'high voltage' : 'low voltage') : s.view === 'light' ? (hi ? 'on' : 'off') : c;
          return (
            <button key={i} class={`wire ${hi ? 'hi' : 'lo'}`} aria-label={`Wire ${i + 1}: ${name}`} onClick={() => send({ flip: i })}>
              {s.view === 'voltage' && (
                <>
                  <span class="volt-track" aria-hidden="true">
                    <span class="volt-fill" />
                  </span>
                  <span class="wire-label">{hi ? 'High' : 'Low'}</span>
                </>
              )}
              {s.view === 'light' && (
                <>
                  <Bulb on={hi} size={36} />
                  <span class="wire-label">{hi ? 'On' : 'Off'}</span>
                </>
              )}
              {s.view === 'bits' && <span class="wire-bit">{c}</span>}
            </button>
          );
        })}
      </div>
      <p class="wires-note" aria-live="polite">
        {VIEW_NOTE[s.view]}
      </p>
    </>
  );
}

/** A byte in two groups of four bits, each group one hex digit. */
function Hex({ spec, state: s, send }: DemoViewProps<BitsSpec, BitsState>) {
  const groups = Array.from({ length: Math.ceil(spec.places / 4) }, (_, g) => s.bits.slice(g * 4, g * 4 + 4));
  const pv = placeValues(4);
  return (
    <>
      <div class="hex-groups">
        {groups.map((bits, g) => (
          <div key={g} class="hex-group">
            <div class="pv-grid" style={{ '--n': 4 }}>
              {pv.map((v) => (
                <div key={`h${v}`} class="pv-head">
                  {v}
                </div>
              ))}
              {[...bits].map((c, i) => (
                <button key={`b${i}`} class={`pv-bit ${c === '1' ? 'one' : ''}`} aria-pressed={c === '1'} aria-label={`Group ${g + 1}, ${placeName(pv[i])}: ${c}`} onClick={() => send({ flip: g * 4 + i })}>
                  {c}
                </button>
              ))}
            </div>
            <div class="hex-digit" aria-label={`Hex digit ${hexDigit(fromBits(bits))}`}>
              {hexDigit(fromBits(bits))}
            </div>
          </div>
        ))}
      </div>
      <div class="bits-readout" aria-live="polite">
        <span>
          Binary <code class="bits-code">{groups.join(' ')}</code> = hex <strong>{groups.map((b) => hexDigit(fromBits(b))).join('')}</strong> = decimal{' '}
          <strong>{fromBits(s.bits)}</strong>
        </span>
      </div>
      <div class="hex-table" aria-label="Hex digits">
        {Array.from({ length: 16 }, (_, n) => (
          <span key={n} class="hex-cell">
            <b>{hexDigit(n)}</b>
            <code>{n.toString(2).padStart(4, '0')}</code>
          </span>
        ))}
      </div>
    </>
  );
}

export function BitsView(props: DemoViewProps<BitsSpec, BitsState>) {
  switch (props.spec.style) {
    case 'cards':
      return <Cards {...props} />;
    case 'board':
      return <Board {...props} />;
    case 'wires':
      return <Wires {...props} />;
    case 'hex':
      return <Hex {...props} />;
  }
}
