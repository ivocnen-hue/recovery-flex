import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { FindingDrawer } from "../../components/findings/FindingDrawer";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { ErrorState, LoadingState } from "../../components/ui/States";
import { useAudit, useFindings } from "../../hooks/useRecoveryData";
import { formatCurrency } from "../../lib/currency";
import { useState } from "react";
import type { Finding } from "../../contracts/types";
import { auditsApi } from "../../api/audits";

export function AuditDetail() {
  const { auditId = "" } = useParams();
  const audit = useAudit(auditId);
  const findings = useFindings(auditId);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  if (audit.isLoading || findings.isLoading) return <LoadingState />;
  if (audit.error || findings.error) return <ErrorState error={audit.error || findings.error} />;
  const data = audit.data!;
  const context = data.context;
  const items = findings.data!.items;
  const recoverable = items.filter(item => item.status === "OVERCHARGED");
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(recoverable.length / pageSize));
  const visible = recoverable.slice(page * pageSize, (page + 1) * pageSize);
  const download = () => {
    const blob = new Blob([JSON.stringify({ audit: data, findings: items }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dossie-${auditId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const downloadExcel = async () => {
    setExporting(true);
    try {
      const blob = await auditsApi.downloadDossier(auditId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dossie-recovery-${auditId}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };
  return <div className="page dossier">
    <section className="page-intro dossier-heading">
      <div>
        <Link className="back-link" to="/audits"><ArrowLeft /> Auditorias</Link>
        <h2>Dossiê da auditoria</h2>
        <p>{auditId}</p>
      </div>
      <div className="dossier-actions">
        <button className="button" onClick={() => window.print()}><Printer /> Imprimir / salvar PDF</button>
        <button className="button primary" onClick={downloadExcel} disabled={exporting}><Download /> {exporting ? "Gerando Excel..." : "Baixar dossiê Excel"}</button>
        <button className="button" onClick={download}><Download /> JSON técnico</button>
      </div>
    </section>
    <section className="panel dossier-context">
      <header><div><FileText /><div><h3>Contexto</h3><p>Identificação e escopo da operação auditada</p></div></div><StatusBadge status={data.status} /></header>
      <dl className="context-grid">
        <div><dt>Seller</dt><dd>{context?.seller ?? "—"}</dd></div>
        <div><dt>Operação</dt><dd>{context?.operation ?? "—"}</dd></div>
        <div><dt>Transportadora</dt><dd>{context?.carrier ?? "—"}</dd></div>
        <div><dt>Período</dt><dd>{context?.period ?? "—"}</dd></div>
        <div className="wide"><dt>Origens</dt><dd className="channel-list">{(context?.channels ?? []).map(channel => <span key={channel}>{channel}</span>)}</dd></div>
      </dl>
    </section>
    <section className="metrics dossier-metrics">
      <div className="metric"><div>Linhas processadas</div><strong>{data.summary.source_rows.toLocaleString("pt-BR")}</strong></div>
      <div className="metric"><div>Casos recuperáveis</div><strong>{data.summary.overcharged_rows.toLocaleString("pt-BR")}</strong></div>
      <div className="metric featured"><div>Recuperação potencial</div><strong>{formatCurrency(data.summary.total_recoverable)}</strong></div>
    </section>
    <section className="panel">
      <header><div><div><h3>Casos recuperáveis</h3><p>Clique em um caso para consultar sua cadeia de evidências.</p></div></div></header>
      <div className="table-wrap"><table><thead><tr><th>Tracking / pedido</th><th>Origem</th><th>Regra</th><th className="number">Cobrado</th><th className="number">Esperado</th><th className="number">Recuperável</th></tr></thead>
      <tbody>{visible.map(item => <tr key={item.finding_id} className="clickable-row" onClick={() => setSelected(item)}><td><b>{item.tracking_number ?? "—"}</b><small>{item.order_id ?? "—"}</small></td><td>{item.marketplace ?? "—"}</td><td>{item.rule_id ?? "—"}</td><td className="number">{formatCurrency(item.charged_amount)}</td><td className="number">{formatCurrency(item.expected_amount)}</td><td className="number recover">{formatCurrency(item.recoverable_amount)}</td></tr>)}</tbody></table></div>
      <footer className="table-footer dossier-pagination"><span>{recoverable.length.toLocaleString("pt-BR")} recuperáveis · {items.length.toLocaleString("pt-BR")} findings no total</span><div><button className="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page + 1} de {pageCount}</span><button className="button" disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>Próxima</button></div></footer>
    </section>
    {!!data.warnings.length && <section className="panel dossier-warnings"><header><div><div><h3>Pontos para revisão</h3><p>Alertas produzidos pelo backend.</p></div></div></header><ul>{data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></section>}
    <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
  </div>;
}
