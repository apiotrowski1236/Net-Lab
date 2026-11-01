import { useState } from 'preact/hooks';
import { findingName, latestReport, RISK_LABEL, RISK_LEVELS, type AuditReport, type Finding, type RiskLevel } from '../../sim/audit';
import { portLabel } from '../../sim/services';
import type { LabSession } from '../../runtime/session';
import { Icon } from '../icons';
import { clockTime } from '../LogsView';
import type { ToolCardProps } from './registry';

export const SEVERITY_TONE: Record<RiskLevel, string> = { high: 'bad', moderate: 'warn', low: 'muted' };

/** A severity or rating as a colored pill. */
export function RiskPill({ level, prefix = '' }: { level: RiskLevel; prefix?: string }) {
  return <span class={`pill risk-pill ${SEVERITY_TONE[level]}`}>{prefix + RISK_LABEL[level]}</span>;
}

/**
 * Vulnerability scanner (net-audit): Run scan probes the auditor's network
 * and the edge router from the internet, then shows the newest report.
 * Each finding opens to its evidence and suggested fix. See src/sim/audit.ts.
 */
export function ScannerTool({ session, spec, onSelect }: ToolCardProps<'scanner'>) {
  void session.simRev.value;
  const sim = session.sim;
  const d = sim.devices[spec.device];
  const audit = d.audit;
  if (!audit) return null;
  const report = latestReport(audit);
  const prev = audit.reports[audit.reports.length - 2];
  const running = !!audit.running;
  return (
    <div class="tool-card audit-card">
      <div class="tool-title">
        <Icon name="target" /> Vulnerability scanner ({d.label})
      </div>
      <p class="tool-desc">
        Probe every device on <span class="mono">{audit.scope}</span>, check each one's settings against a list of known weaknesses, and write a report.
        {audit.outside && ' One probe tests the edge router from the internet.'}
      </p>
      <div class="tool-row">
        <button class="btn primary" onClick={() => session.dispatch({ type: 'audit-scan', device: spec.device })} disabled={running}>
          <Icon name="target" size={14} /> {running ? 'Scanning…' : report ? 'Run scan again' : 'Run scan'}
        </button>
        {running && <span class="muted small">Probes are crossing the map.</span>}
      </div>
      {report && <Report key={report.id} session={session} device={spec.device} report={report} prev={prev} onSelect={onSelect} />}
    </div>
  );
}

function Report({ session, device, report, prev, onSelect }: { session: LabSession; device: string; report: AuditReport; prev?: AuditReport; onSelect: (id: string) => void }) {
  const sim = session.sim;
  const [open, setOpen] = useState<string | null>(null);
  const fixed = (prev?.findings ?? []).filter((f) => !report.findings.some((g) => g.id === f.id));
  const counts = RISK_LEVELS.slice()
    .reverse()
    .map((l) => [l, report.findings.filter((f) => f.severity === l).length] as const)
    .filter(([, n]) => n > 0);
  const toggle = (f: Finding) => {
    const next = open === f.id ? null : f.id;
    setOpen(next);
    if (next) session.ui({ type: 'ui:open-finding', device, finding: f.id });
  };
  return (
    <div class="audit-report" aria-live="polite">
      <div class="audit-report-head">
        <strong>Report {report.id}</strong>
        <span class="muted small">finished {clockTime(report.doneAt, session.lab.clock).slice(0, 8)}</span>
        <span class="audit-counts">
          {counts.length === 0 && <span class="pill good">No findings</span>}
          {counts.map(([l, n]) => (
            <span key={l} class={`pill ${SEVERITY_TONE[l]}`}>
              {n} {l}
            </span>
          ))}
        </span>
      </div>
      {fixed.length > 0 && (
        <ul class="audit-fixed">
          {fixed.map((f) => (
            <li key={f.id}>
              <Icon name="check" size={14} /> Fixed since report {prev!.id}: {findingName(f.id)}
            </li>
          ))}
        </ul>
      )}
      {report.findings.length > 0 && <p class="small muted audit-hint">Click a finding to see the evidence and the suggested fix.</p>}
      <ul class="audit-findings">
        {report.findings.map((f) => {
          const dev = sim.devices[f.device];
          const isOpen = open === f.id;
          return (
            <li key={f.id} class={`audit-finding ${isOpen ? 'open' : ''}`}>
              <button class="audit-finding-row" aria-expanded={isOpen} onClick={() => toggle(f)}>
                <RiskPill level={f.severity} />
                <span class="audit-finding-name">{findingName(f.id)}</span>
                <span class="muted small">{dev?.label ?? f.device}</span>
                <span class="audit-caret" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>
              {isOpen && (
                <div class="audit-finding-body">
                  <p>{f.title}</p>
                  <dl>
                    <dt>Evidence</dt>
                    <dd>{f.evidence}</dd>
                    <dt>Suggested fix</dt>
                    <dd>{f.fix}</dd>
                  </dl>
                  {dev && (
                    <button class="btn tiny ghost" onClick={() => onSelect(dev.id)}>
                      <Icon name="sliders" size={12} /> Open {dev.label}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <details class="audit-map">
        <summary>
          What answered on <span class="mono">{report.scope}</span>: {report.hosts.length} device{report.hosts.length === 1 ? '' : 's'}
        </summary>
        <table class="table scan-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Open ports</th>
            </tr>
          </thead>
          <tbody>
            {report.hosts.map((h) => (
              <tr key={h.ip}>
                <td class="mono">
                  {h.ip}
                  <span class="muted"> {h.device ? sim.devices[h.device]?.label : ''}</span>
                </td>
                <td>{h.open.length ? h.open.map((p) => portLabel(p)).join(', ') : <span class="muted">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted small scan-note">This list is the map an attacker would build first: every device, and what each one runs.</p>
      </details>
    </div>
  );
}
