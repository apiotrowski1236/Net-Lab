import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { checkEcho } from '../../runtime/toolInput';
import type { SimEvent } from '../../sim/types';
import { Icon } from '../icons';
import { ToolMsg, type Msg } from './parts';
import type { ToolCardProps } from './registry';

/**
 * The attacker's ping tool (smurf). Like Ping, but it can write a forged source
 * address, so the reply lands on whoever that address names — the trick behind
 * a smurf attack. Sends an `echo` action and reports where the replies went.
 */
export function EchoTool({ session, spec }: ToolCardProps<'echo-tool'>) {
  void session.simRev.value;
  const sim = session.sim;
  const dev = sim.devices[spec.device];
  const [target, setTarget] = useState('');
  const [source, setSource] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const send = () => {
    const r = checkEcho(sim, spec.device, target, source);
    if (!r.ok) {
      setMsg({ tone: 'bad', text: r.msg, field: r.field, suggest: r.suggest });
      return;
    }
    setMsg(null);
    session.dispatch({ type: 'echo', device: spec.device, target: r.target, source: r.source });
  };
  const since = session.since;
  const sent = sim.events
    .filter((e): e is Extract<SimEvent, { type: 'ping-sent' }> => e.type === 'ping-sent' && e.device === spec.device && e.t >= since)
    .slice(-4)
    .reverse();
  const log = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => log.current?.scrollIntoView({ block: 'nearest' }), [sent[0]?.seq, sim.events.length]);
  const invalid = (f: string) => (msg?.tone === 'bad' && msg.field === f ? 'invalid' : '');
  return (
    <div class="tool-card attack">
      <div class="tool-title">
        <Icon name="ping" /> Echo tool
      </div>
      <p class="tool-desc">
        Send a ping from {dev?.label ?? spec.device}. The reply goes to the address in the <strong>source</strong> field — leave it blank to use your own, or forge it to send the reply somewhere else.
      </p>
      <div class="sentence">
        ping
        <input
          class={`mono ${invalid('target')}`}
          value={target}
          placeholder="target IP"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          size={14}
          aria-label="Target IP address"
          onInput={(e) => (setTarget((e.target as HTMLInputElement).value), setMsg(null))}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
      </div>
      <div class="sentence">
        source
        <input
          class={`mono ${invalid('source')}`}
          value={source}
          placeholder="blank = my address"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          size={14}
          aria-label="Source IP address to forge"
          onInput={(e) => (setSource((e.target as HTMLInputElement).value), setMsg(null))}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button class="btn" onClick={send}>
          Send
        </button>
      </div>
      <ToolMsg msg={msg} />
      {sent.length > 0 && (
        <ul class="ping-log" aria-live="polite" ref={log}>
          {sent.map((p) => {
            const end = sim.events.find((e) => (e.type === 'ping-reply' || e.type === 'ping-fail') && e.seq === p.seq);
            const tone = !end ? 'wait' : end.type === 'ping-reply' ? (p.forged ? 'bad' : 'good') : 'bad';
            let text: string;
            if (!end) text = 'Waiting for a reply…';
            else if (end.type === 'ping-reply') {
              const n = end.count ?? 1;
              const replies = n === 1 ? '1 reply' : `${n} replies`;
              if (p.forged) {
                const landedOn = sim.devices[end.device];
                text = `${replies} went to ${landedOn?.label ?? end.device}${p.from ? ` (${p.from})` : ''}, not to you.`;
              } else {
                text = `${replies} came back.`;
              }
            } else text = 'No reply.';
            return (
              <li key={p.seq} class={tone}>
                <Icon name={tone === 'good' ? 'check' : tone === 'bad' ? 'x' : 'ping'} size={14} />
                <span>
                  <span class="mono">
                    {p.from && p.forged ? `${p.from} → ${p.to}` : `${dev?.label} → ${p.to}`}
                  </span>{' '}
                  {text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
