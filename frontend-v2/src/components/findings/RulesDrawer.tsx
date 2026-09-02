import { BookOpenCheck, Download, FileText, X } from "lucide-react";
import { useState } from "react";
import { rulesApi } from "../../api/rules";
import type { AuditRule, Finding } from "../../contracts/types";
import { formatCurrency } from "../../lib/currency";
import { formatRuleCondition } from "../../lib/rules";

export function RulesDrawer({ findings, rules, loading, open, onClose }: {
  findings: Finding[];
  rules: AuditRule[];
  loading: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  if (!open) return null;
  const reviewCount = findings.filter((finding) => !finding.rule_id).length;

  const download = async (rule: AuditRule) => {
    setDownloading(rule.source_id);
    setDownloadError(null);
    try {
      const blob = await rulesApi.downloadDocument(rule.download_url);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = rule.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Não foi possível baixar o PDF.");
    } finally {
      setDownloading(null);
    }
  };

  return <>
    <button className="drawer-scrim" onClick={onClose} aria-label="Fechar regras" />
    <aside className="drawer rules-drawer" role="dialog" aria-modal="true" aria-label="Regras da auditoria">
      <header><div><small>REGRAS DA AUDITORIA</small><h2>Critérios aplicados</h2></div><button className="icon" onClick={onClose} aria-label="Fechar"><X /></button></header>
      <div className="drawer-content">
        <div className="rules-notice"><BookOpenCheck /><div><b>Regras interpretadas do PDF pelo Worker</b><span>As condições abaixo vêm do contrato estruturado armazenado pelo backend. O frontend apenas apresenta os critérios.</span></div></div>
        {reviewCount > 0 && <div className="rules-review-note"><b>{reviewCount.toLocaleString("pt-BR")} casos em revisão</b><span>O PDF foi reconhecido, mas estes casos não receberam uma regra aplicável. Nenhum valor devido foi presumido.</span></div>}
        {downloadError && <p className="rules-error">{downloadError}</p>}
        {loading ? <div className="rules-loading">Carregando regras interpretadas...</div> : <div className="rules-catalog">{rules.map((item) => {
          const caseCount = findings.filter((finding) => finding.rule_id === item.rule.id).length;
          const fixedAmount = item.rule.calculation.type === "fixed" ? item.rule.calculation.amount : undefined;
          return <section key={`${item.source_id}-${item.rule.id}`} className="rule-card explicit-rule">
            <header><div><span>Regra usada</span><h3>{item.rule.id}</h3></div><b>{caseCount.toLocaleString("pt-BR")} casos</b></header>
            <div className="rule-body">
              <div className="rule-criteria"><span>Condições exigidas</span>{item.rule.conditions.map((condition, index) => <div key={`${condition.field}-${index}`}><i>{index + 1}</i><b>{formatRuleCondition(condition)}</b></div>)}</div>
              <div className="rule-result"><span>Cálculo aplicado</span><strong>{fixedAmount == null ? item.rule.calculation.type || "Não informado" : formatCurrency(fixedAmount)}</strong><small>{fixedAmount == null ? "Conforme definição estruturada" : "Valor devido quando todas as condições são atendidas"}</small></div>
            </div>
            <dl><div><dt>Versão</dt><dd>{item.version || "Não informada"}</dd></div><div><dt>Documento original</dt><dd><span><FileText /> {item.filename}</span></dd></div></dl>
            <footer><button className="button primary rule-download" onClick={() => download(item)} disabled={downloading === item.source_id}><Download /> {downloading === item.source_id ? "Baixando PDF..." : "Baixar PDF original"}</button></footer>
          </section>;
        })}{!rules.length && <div className="rules-empty">Nenhuma regra estruturada foi encontrada para esta auditoria.</div>}</div>}
      </div>
    </aside>
  </>;
}
