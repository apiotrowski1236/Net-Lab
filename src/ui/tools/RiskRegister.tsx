import { entryRating, findingName, latestReport, RISK_LABEL, RISK_LEVELS, riskRating, seenFindings, type RiskLevel } from '../../sim/audit';
import { Icon } from '../icons';
import type { ToolCardProps } from './registry';
import { RiskPill } from './Scanner';

/**
 * Risk register (net-audit): one row per finding the scanner has reported.
 * The auditor sets each one's likelihood and impact; the register combines
 * them into a rating with the matrix in src/sim/audit.ts.
 */
export function RiskRegisterTool({ session, spec }: ToolCardProps<'risk-register'>) {
  void session.simRev.value;
  const d = session.sim.devices[spec.device];
  const audit = d.audit;
  if (!audit) return null;
  const rows = seenFindings(audit);
  const latest = latestReport(audit);
  const set = (finding: string, part: 'likelihood' | 'impact', v: string) =>
    session.dispatch({ type: 'rate-risk', device: spec.device, finding, [part]: v as RiskLevel });
  const rated = rows.filter((f) => entryRating(audit.register[f.id])).length;
  return (
    <div class="tool-card audit-card">
      <div class="tool-title">
        <Icon name="list" /> Risk register
      </div>
      <p class="tool-desc">
        Rate each finding. <strong>Likelihood</strong>: how likely is it to be used? <strong>Impact</strong>: how bad would it be? The register combines
        them into a rating.
      </p>
      {rows.length === 0 ? (
        <p class="muted small">Nothing to rate yet. Run the scanner first.</p>
      ) : (
        <>
          <p class="small muted">
            {rated} of {rows.length} rated
          </p>
          <div class="risk-table-wrap">
            <table class="table risk-table">
              <thead>
                <tr>
                  <th>Finding</th>
                  <th>Likelihood</th>
                  <th>Impact</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const e = audit.register[f.id] ?? {};
                  const rating = entryRating(e);
                  const fixed = latest && !latest.findings.some((g) => g.id === f.id);
                  return (
                    <tr key={f.id} class={fixed ? 'fixed' : ''}>
                      <td>
                        <div class="risk-name">{findingName(f.id)}</div>
                        <div class="small muted">
                          {session.sim.devices[f.device]?.label ?? f.device}, scanner says {RISK_LABEL[f.severity].toLowerCase()}
                          {fixed && <span class="pill good tiny">Fixed</span>}
                        </div>
                      </td>
                      <td>
                        <LevelSelect value={e.likelihood} label={`Likelihood: ${f.id}`} onChange={(v) => set(f.id, 'likelihood', v)} />
                      </td>
                      <td>
                        <LevelSelect value={e.impact} label={`Impact: ${f.id}`} onChange={(v) => set(f.id, 'impact', v)} />
                      </td>
                      <td>{rating ? <RiskPill level={rating} /> : <span class="muted small">not yet</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details class="risk-matrix">
            <summary>How the rating is worked out</summary>
            <table class="table">
              <thead>
                <tr>
                  <th>Likelihood ↓ Impact →</th>
                  {RISK_LEVELS.map((i) => (
                    <th key={i}>{RISK_LABEL[i]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RISK_LEVELS.map((l) => (
                  <tr key={l}>
                    <th>{RISK_LABEL[l]}</th>
                    {RISK_LEVELS.map((i) => (
                      <td key={i}>
                        <RiskPill level={riskRating(l, i)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}

function LevelSelect({ value, label, onChange }: { value?: RiskLevel; label: string; onChange: (v: string) => void }) {
  return (
    <select class={value ? '' : 'unset'} value={value ?? ''} aria-label={label} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {!value && (
        <option value="" disabled>
          Choose…
        </option>
      )}
      {RISK_LEVELS.map((l) => (
        <option key={l} value={l}>
          {RISK_LABEL[l]}
        </option>
      ))}
    </select>
  );
}
