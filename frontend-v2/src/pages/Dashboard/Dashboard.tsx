import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  FileSearch,
  Files,
  Link2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { AuditTable } from "../../components/audits/AuditTable";
import { ErrorState, LoadingState } from "../../components/ui/States";
import {
  useAudits,
  useAuditSummary,
  useFindings,
} from "../../hooks/useRecoveryData";
import { formatCurrency } from "../../lib/currency";
import { findingSkuDisplay } from "../../lib/findings";
export function Dashboard() {
  const audit = useAuditSummary(),
    audits = useAudits(),
    findings = useFindings();
  if (audit.isLoading || audits.isLoading) return <LoadingState />;
  if (audit.error || audits.error)
    return <ErrorState error={audit.error || audits.error} />;
  const s = audit.data!.summary;
  const top =
    findings.data?.items
      .filter((f) => f.status === "OVERCHARGED")
      .slice(0, 3) ?? [];
  return (
    <div className="page">
      <section className="page-intro">
        <div>
          <h2>Visão geral da recuperação</h2>
          <p>Acompanhe auditorias e evidências financeiras em um só lugar.</p>
        </div>
        <span className="live">
          <i /> Dados de demonstração isolados
        </span>
      </section>
      <div className="metrics">
        <article className="metric featured">
          <div>
            <span>Recovery identificado</span>
            <CircleDollarSign />
          </div>
          <strong>{formatCurrency(s.total_recoverable)}</strong>
          <small>valor retornado pelo backend</small>
        </article>
        <article className="metric">
          <div>
            <span>Auditorias concluídas</span>
            <CheckCircle2 />
          </div>
          <strong>
            {audits.data!.items.filter((a) => a.status === "COMPLETED").length}
          </strong>
          <small>no período selecionado</small>
        </article>
        <article className="metric">
          <div>
            <span>Findings</span>
            <FileSearch />
          </div>
          <strong>{s.overcharged_rows.toLocaleString("pt-BR")}</strong>
          <small>casos recuperáveis</small>
        </article>
        <article className="metric">
          <div>
            <span>Pendências</span>
            <AlertCircle />
          </div>
          <strong>{s.pending_rows.toLocaleString("pt-BR")}</strong>
          <small>revisão necessária</small>
        </article>
        <article className="metric">
          <div>
            <span>Linhas processadas</span>
            <Files />
          </div>
          <strong>{s.source_rows.toLocaleString("pt-BR")}</strong>
          <small>
            {s.normalized_rows.toLocaleString("pt-BR")} normalizadas
          </small>
        </article>
        <article className="metric">
          <div>
            <span>Taxa de matching</span>
            <Link2 />
          </div>
          <strong>
            {new Intl.NumberFormat("pt-BR", {
              style: "percent",
              maximumFractionDigits: 1,
            }).format(s.matched_rows / s.source_rows)}
          </strong>
          <small>{s.matched_rows.toLocaleString("pt-BR")} conciliadas</small>
        </article>
      </div>
      <section className="panel">
        <header>
          <div>
            <h3>Auditorias recentes</h3>
            <p>Últimas execuções disponíveis</p>
          </div>
          <Link to="/audits">
            Ver todas <ArrowRight />
          </Link>
        </header>
        <AuditTable items={audits.data!.items.slice(0, 4)} />
      </section>
      <div className="split-panels">
        <section className="panel">
          <header>
            <div>
              <h3>Maiores findings</h3>
              <p>Prioridade por valor recuperável</p>
            </div>
          </header>
          <div className="rank-list">
            {top.map((f, i) => (
              <div key={f.finding_id}>
                <span>{i + 1}</span>
                <div>
                  <b>{findingSkuDisplay(f)}</b>
                  <small>{f.tracking_number}</small>
                </div>
                <strong>{formatCurrency(f.recoverable_amount)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <header>
            <div>
              <h3>Pendências críticas</h3>
              <p>Casos que exigem revisão</p>
            </div>
          </header>
          <div className="pending-card">
            <AlertCircle />
            <div>
              <b>{s.pending_rows.toLocaleString("pt-BR")} linhas pendentes</b>
              <p>
                Inclui valores ausentes e conciliações que não atingiram
                confiança suficiente.
              </p>
              <Link to="/findings">
                Revisar casos <ArrowRight />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
