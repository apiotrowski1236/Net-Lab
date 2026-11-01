import { useState } from 'preact/hooks';
import type { ToolSpec } from '../../labs/types';
import { checkRule, ruleDraft, type RuleDraft } from '../../runtime/firewallInput';
import { MODE_NAME, portText, protoText, type FwMode, type FwRule } from '../../sim/firewall';
import { appName } from '../../sim/services';
import type { Sim } from '../../sim/sim';
import type { Device } from '../../sim/types';
import { Icon } from '../icons';
import { recentlyChanged, ToolMsg, type Msg } from '../tools/parts';
import type { InspectorSectionProps } from './registry';

/** What the student may do to this firewall, from the 'firewall-rules' tools they have. */
function powers(tools: ToolSpec[], devId: string): { edit: boolean; modes: FwMode[] } {
  let edit = false;
  const modes = new Set<FwMode>();
  for (const t of tools) {
    if (t.kind !== 'firewall-rules' || !t.devices.includes(devId)) continue;
    edit = true;
    for (const m of t.modes ?? []) modes.add(m);
  }
  return { edit, modes: (['stateless', 'stateful', 'ngfw'] as FwMode[]).filter((m) => modes.has(m)) };
}

const MODE_BLURB: Record<FwMode, string> = {
  stateless: 'Checks every packet against the rules by itself, replies too. It remembers nothing.',
  stateful: 'Checks the first packet of each conversation against the rules, and remembers the conversations it allowed. Replies to those get through. Anything else that looks like a reply is denied.',
  ngfw: 'Stateful, plus deep packet inspection: it looks inside each new conversation to see which program is talking, and blocks a program that doesn’t match its port.',
};

function sourceText(r: FwRule): string {
  return r.sport !== undefined && r.sport !== 'any' ? `${r.src}, from port ${portText(r.sport, r.proto)}` : r.src;
}

/** Where the outside port leads, in words. */
function outsideText(sim: Sim, dev: Device): string {
  const fw = dev.firewall!;
  const peer = sim.peer(dev.id, fw.outside);
  const to = peer ? sim.devices[peer.device]?.label : undefined;
  return to ? `Its outside port (${fw.outside}) leads to ${to}.` : `Its outside port is ${fw.outside}.`;
}

/**
 * The firewall's rulebook: rules in order with the implicit deny last, the
 * firewall type, and the connection table. With the 'firewall-rules' tool the
 * student adds, changes, deletes, and reorders rules here.
 */
export function FirewallRulesSection({ session, sim, dev, replaying }: InspectorSectionProps) {
  const fw = dev.firewall;
  const [form, setForm] = useState<{ draft: RuleDraft; editing?: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  if (!fw) return null;
  const { edit: canEdit, modes } = powers(session.tools, dev.id);
  const edit = canEdit && !replaying;
  const notPlaced = dev.kind === 'firewall' && !dev.ifaces.some((i) => i.linkId);
  const hit = (pred: (r: { ruleId?: string; by: string }) => boolean) =>
    recentlyChanged(sim, (e) => e.type === 'firewall' && e.device === dev.id && pred(e.verdict), 2500);
  const rules = fw.rules;
  const move = (r: FwRule, to: number) => session.dispatch({ type: 'fw-move-rule', device: dev.id, id: r.id, to });
  const save = () => {
    if (!form) return;
    const r = checkRule(session.sim, dev.id, form.draft, form.editing);
    if (!r.ok) {
      const field = r.field as keyof RuleDraft | undefined;
      setMsg({
        tone: 'bad',
        text: r.msg,
        field: r.field,
        suggest: r.suggest,
        onSuggest: r.suggest && field ? () => (setForm({ ...form, draft: { ...form.draft, [field]: r.suggest! } }), setMsg(null)) : undefined,
      });
      return;
    }
    if (form.editing) session.dispatch({ type: 'fw-edit-rule', device: dev.id, id: form.editing, rule: r.rule });
    else session.dispatch({ type: 'fw-add-rule', device: dev.id, rule: r.rule });
    setMsg({ tone: 'good', text: form.editing ? 'Rule changed.' : `Added as rule ${rules.length + 1}, right above the implicit deny. Use the arrows to move it.` });
    setForm(null);
  };
  return (
    <section class="fw-section">
      <h4>
        Firewall rules <span class="muted">checked from the top: the first rule that matches decides</span>
      </h4>
      {notPlaced && (
        <div class="callout warn small">
          <Icon name="warn" size={14} /> Not placed yet. It isn't in any cable, so it checks nothing.
        </div>
      )}
      <p class="small fw-dir-note">
        {outsideText(sim, dev)} Packets that arrive there are going <strong>in</strong>. Packets from the other side are going <strong>out</strong>.
      </p>
      <div class="fw-mode">
        <span class="small">Type:</span>
        {edit && modes.length > 1 ? (
          <div class="seg" role="group" aria-label={`${dev.label} firewall type`}>
            {modes.map((m) => (
              <button key={m} class={fw.mode === m ? 'on' : ''} aria-pressed={fw.mode === m} onClick={() => fw.mode !== m && session.dispatch({ type: 'fw-mode', device: dev.id, mode: m })}>
                {MODE_NAME[m]}
              </button>
            ))}
          </div>
        ) : (
          <span class="pill info">{MODE_NAME[fw.mode]}</span>
        )}
        <span class="muted small">{MODE_BLURB[fw.mode]}</span>
      </div>
      <div class="fw-table-wrap">
        <table class="table fw-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Direction</th>
              <th>Protocol</th>
              <th>Source</th>
              <th>Destination</th>
              <th>Port</th>
              <th>Action</th>
              {edit && <th />}
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={r.id} class={`${hit((v) => v.ruleId === r.id) ? 'flash' : ''} ${form?.editing === r.id ? 'editing' : ''}`}>
                <td class="mono">{i + 1}</td>
                <td>{r.dir}</td>
                <td>{protoText(r.proto)}</td>
                <td class="mono">{sourceText(r)}</td>
                <td class="mono">{r.dst}</td>
                <td class="mono">{r.proto === 'icmp' ? '' : portText(r.dport, r.proto)}</td>
                <td>
                  <span class={`pill tiny ${r.action === 'allow' ? 'good' : 'bad'}`}>{r.action.toUpperCase()}</span>
                  {r.note && <div class="muted small fw-note">{r.note}</div>}
                </td>
                {edit && (
                  <td class="row-action fw-actions">
                    <button class="btn tiny ghost" disabled={i === 0} onClick={() => move(r, i - 1)} aria-label={`Move rule ${i + 1} up`} title="Move up">
                      ↑
                    </button>
                    <button class="btn tiny ghost" disabled={i === rules.length - 1} onClick={() => move(r, i + 1)} aria-label={`Move rule ${i + 1} down`} title="Move down">
                      ↓
                    </button>
                    <button class="btn tiny ghost" onClick={() => (setForm({ draft: ruleDraft(r), editing: r.id }), setMsg(null))}>
                      Edit
                    </button>
                    <button class="btn tiny ghost" onClick={() => (session.dispatch({ type: 'fw-delete-rule', device: dev.id, id: r.id }), setMsg(null), form?.editing === r.id && setForm(null))}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            <tr class={`fw-implicit ${hit((v) => v.by === 'implicit') ? 'flash' : ''}`}>
              <td class="mono">*</td>
              <td>both</td>
              <td>any</td>
              <td class="mono">any</td>
              <td class="mono">any</td>
              <td class="mono">any</td>
              <td>
                <span class="pill tiny bad">DENY</span>
                <div class="muted small fw-note">Implicit deny: anything no rule above allowed</div>
              </td>
              {edit && <td />}
            </tr>
          </tbody>
        </table>
      </div>
      {edit && !form && (
        <button class="btn small fw-add" onClick={() => (setForm({ draft: ruleDraft() }), setMsg(null))}>
          Add a rule
        </button>
      )}
      {edit && form && (
        <RuleForm
          title={form.editing ? `Change rule ${rules.findIndex((r) => r.id === form.editing) + 1}` : 'New rule'}
          draft={form.draft}
          bad={msg?.tone === 'bad' ? msg.field : undefined}
          onChange={(draft) => (setForm({ ...form, draft }), msg?.tone === 'bad' && setMsg(null))}
          onSave={save}
          onCancel={() => (setForm(null), setMsg(null))}
          saveLabel={form.editing ? 'Save' : 'Add rule'}
        />
      )}
      <ToolMsg msg={msg} />
      {fw.mode !== 'stateless' && <ConnTable sim={sim} dev={dev} />}
    </section>
  );
}

function RuleForm(props: {
  title: string;
  draft: RuleDraft;
  bad?: string;
  onChange: (d: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const { title, draft: d, bad, onChange, onSave, onCancel, saveLabel } = props;
  const set = (k: keyof RuleDraft) => (e: Event) => onChange({ ...d, [k]: (e.target as HTMLInputElement | HTMLSelectElement).value });
  const text = (k: 'src' | 'dst' | 'dport' | 'sport', label: string, placeholder: string, size: number) => (
    <input
      class={`mono ${bad === k ? 'invalid' : ''}`}
      value={d[k]}
      placeholder={placeholder}
      autoComplete="off"
      spellcheck={false}
      size={size}
      aria-label={label}
      aria-invalid={bad === k}
      onInput={set(k)}
      onKeyDown={(e) => e.key === 'Enter' && onSave()}
    />
  );
  const icmp = d.proto === 'icmp';
  return (
    <div class="fw-form">
      <div class="fw-form-title">{title}</div>
      <div class="sentence">
        <select value={d.action} onChange={set('action')} aria-label="Action" class={bad === 'action' ? 'invalid' : ''}>
          <option value="allow">ALLOW</option>
          <option value="deny">DENY</option>
        </select>
        <select value={d.dir} onChange={set('dir')} aria-label="Direction" class={bad === 'dir' ? 'invalid' : ''}>
          <option value="in">in</option>
          <option value="out">out</option>
        </select>
        <select value={d.proto} onChange={set('proto')} aria-label="Protocol" class={bad === 'proto' ? 'invalid' : ''}>
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
          <option value="icmp">ICMP (ping)</option>
          <option value="any">any protocol</option>
        </select>
      </div>
      <div class="sentence">
        from {text('src', 'Source address', 'any', 15)}
        {!icmp && <>port {text('sport', 'Source port', 'any', 5)}</>}
      </div>
      <div class="sentence">
        to {text('dst', 'Destination address', '10.0.1.10', 15)}
        {!icmp && <>port {text('dport', 'Destination port', '443', 5)}</>}
      </div>
      <div class="row gap-sm">
        <button class="btn" onClick={onSave}>
          {saveLabel}
        </button>
        <button class="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ConnTable({ sim, dev }: { sim: Sim; dev: Device }) {
  const fw = dev.firewall!;
  const ngfw = fw.mode === 'ngfw';
  const rows = [...fw.conns].reverse().slice(0, 8);
  const who = (ip: string) => sim.deviceByIp(ip)?.label;
  return (
    <div class="fw-conns">
      <h4>
        Connection table <span class="muted">conversations it allowed; replies to these get through</span>
      </h4>
      {rows.length === 0 ? (
        <p class="muted small">Empty. A conversation shows up here when the rules allow its first packet.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Started by</th>
              <th>Talking to</th>
              <th>Protocol</th>
              {ngfw && <th>Program</th>}
              <th>Replies</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.key}>
                <td class="mono">
                  {c.src}
                  {c.sport !== undefined ? `:${c.sport}` : ''}
                  <span class="muted"> {who(c.src)}</span>
                </td>
                <td class="mono">
                  {c.dst}
                  {c.dport !== undefined ? `:${c.dport}` : ''}
                  <span class="muted"> {who(c.dst)}</span>
                </td>
                <td>{c.proto.toUpperCase()}</td>
                {ngfw && <td>{c.app ? appName(c.app) : ''}</td>}
                <td>{c.replies}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {fw.conns.length > rows.length && <p class="muted small">Showing the newest {rows.length} of {fw.conns.length}.</p>}
    </div>
  );
}
