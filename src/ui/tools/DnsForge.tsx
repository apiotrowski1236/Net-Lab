import { useState } from 'preact/hooks';
import { checkForge } from '../../runtime/toolInput';
import { forgedGuesses } from '../../sim/dns';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';
import { ToolMsg, type Msg } from './parts';

/**
 * The DNS forger (attack card). The student types the name to poison and the
 * address to plant. The tool floods the resolver with forged answers that
 * claim to come from the name server. See Sim.forgeDnsAnswer.
 */
export function DnsForge({ session, spec }: ToolCardProps<'dns-forge'>) {
  const sim = session.sim;
  const attacker = sim.devices[spec.device];
  const resolver = sim.devices[spec.resolver];
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const sent = sim.events.filter((e) => e.type === 'config' && e.what === 'dns-forge' && e.device === spec.device).slice(-4);
  const guesses = forgedGuesses().length;
  /** How a burst sent at `t` came out: the first answer the resolver accepted for the name after it. */
  const result = (t: number, detail: string, raced: boolean): string => {
    if (!raced) return 'the resolver had a fresh answer and asked nothing, so every guess was ignored';
    const ans = sim.events.find((e) => e.t >= t && e.type === 'dns-answer' && e.device === spec.resolver && detail.includes(` ${e.name} `));
    if (!ans || ans.type !== 'dns-answer') return 'waiting for the race';
    return detail.endsWith(` ${ans.ip}`) ? 'a guess matched: the cache is poisoned' : 'no guess matched: the real answer won';
  };

  const send = () => {
    const r = checkForge(sim, spec.device, spec.resolver, name, ip);
    if (!r.ok) return setMsg({ tone: 'bad', text: r.msg, field: r.field });
    session.dispatch({ type: 'dns-forge', device: spec.device, resolver: spec.resolver, name: r.name, ip: r.ip });
    setMsg({ tone: 'good', text: `Sent ${guesses} forged answers for ${r.name} to ${resolver.label}, one for each ticket number, all to its usual port. The list below shows whether one matched.` });
  };
  const edit = (set: (v: string) => void) => (e: Event) => {
    set((e.target as HTMLInputElement).value);
    setMsg(null);
  };
  const bad = (field: string) => (msg?.tone === 'bad' && msg.field === field ? 'invalid' : '');

  return (
    <div class="tool-card attack">
      <div class="tool-title">
        <Icon name="send" /> DNS forger ({attacker.label})
      </div>
      <p class="tool-desc">
        Pretend to be the name server. Get {resolver.label} to look up a name, then send it a burst of forged answers: one for each query ID it might use, at the port it uses.
      </p>
      <div class="sentence">
        Make
        <input
          class={bad('name')}
          value={name}
          placeholder="name"
          autoComplete="off"
          spellcheck={false}
          size={16}
          aria-label="Name to poison"
          onInput={edit(setName)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        point at
        <input
          class={`mono ${bad('ip')}`}
          value={ip}
          placeholder="IP address"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          size={14}
          aria-label="Address to plant"
          onInput={edit(setIp)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
      </div>
      <ToolMsg msg={msg} />
      <button class="btn danger" onClick={send}>
        <Icon name="send" /> Send forged answers
      </button>
      {sent.length > 0 && (
        <ul class="tool-log">
          {sent.map((e) => (
            <li>{e.type === 'config' ? `${e.detail}: ${result(e.t, e.detail ?? '', !!e.raced)}` : ''}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
