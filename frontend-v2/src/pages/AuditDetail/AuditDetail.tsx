import { ArrowLeft, FileJson, FileSpreadsheet, FileText, FilterX, PackageSearch, Printer, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { auditsApi } from "../../api/audits";
import { FindingDrawer } from "../../components/findings/FindingDrawer";
import { SortableHeader } from "../../components/findings/SortableHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import type { Finding } from "../../contracts/types";
import { useAudit, useFindings } from "../../hooks/useRecoveryData";
import { filterAndSortFindings, toggleFindingSort, type DossierFilters, type SortField } from "../../lib/auditFindings";
import { formatCurrency } from "../../lib/currency";
import { formatPeriod } from "../../lib/dates";
import { findingDimensionsDisplay, findingSkuDisplay } from "../../lib/findings";

const initialFilters: DossierFilters = { query: "", tracking: "", sku: "", marketplace: "ALL", status: "OVERCHARGED", rule: "ALL", sort: "recovery_desc" };
const emptyFindings: Finding[] = [];

export function AuditDetail() {
  const { auditId = "" } = useParams();
  const audit = useAudit(auditId);
  const findings = useFindings(auditId);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState<DossierFilters>(initialFilters);
  const items = findings.data?.items ?? emptyFindings;
  const filtered = useMemo(() => filterAndSortFindings(items, filters), [items, filters]);
  if (audit.isLoading || findings.isLoading) return <LoadingState />;
  if (audit.error || findings.error) return <ErrorState error={audit.error || findings.error} />;

  const data = audit.data!;
  const context = data.context;
  const marketplaces = [...new Set(items.map(item => item.marketplace ?? "Não informado"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const rules = [...new Set(items.map(item => item.rule_id ?? "Sem regra"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const filteredRecovery = filtered.reduce((total, item) => total + (item.recoverable_amount ?? 0), 0);
  const identifiedSkus = filtered.filter(item => findingSkuDisplay(item) !== "—").length;
  const updateFilter = <K extends keyof DossierFilters>(key: K, value: DossierFilters[K]) => {
    setPage(0);
    setFilters(current => ({ ...current, [key]: value }));
  };
  const resetFilters = () => { setPage(0); setFilters(initialFilters); };
  const sortBy = (field: SortField) => updateFilter("sort", toggleFindingSort(filters.sort, field));
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
    } finally { setExporting(false); }
  };

  return <div className="page dossier">
    <section className="dossier-hero">
      <div>
        <Link className="back-link" to="/audits"><ArrowLeft /> Auditorias</Link>
        <span className="eyebrow">Dossiê de conciliação</span>
        <h2>{context?.seller ?? "Auditoria"}</h2>
        <p>Resultados financeiros, rastreabilidade e evidências em uma única visão.</p>
        <div className="audit-reference"><FileText /> {auditId}</div>
      </div>
      <div className="dossier-actions">
        <button className="button subtle" onClick={() => window.print()}><Printer /> Imprimir</button>
        <button className="button primary" onClick={downloadExcel} disabled={exporting}><FileSpreadsheet /> {exporting ? "Gerando Excel..." : "Baixar Excel"}</button>
        <button className="button subtle" onClick={download}><FileJson /> JSON</button>
      </div>
    </section>

    <section className="panel dossier-context">
      <header><div><FileText /><div><h3>Escopo auditado</h3><p>Operação, período e fontes conciliadas</p></div></div><StatusBadge status={data.status} /></header>
      <dl className="context-grid">
        <div><dt>Seller</dt><dd>{context?.seller ?? "—"}</dd></div><div><dt>Operação</dt><dd>{context?.operation ?? "—"}</dd></div><div><dt>Transportadora</dt><dd>{context?.carrier ?? "—"}</dd></div><div><dt>Período</dt><dd>{formatPeriod(context?.period ?? "—")}</dd></div>
        <div className="wide"><dt>Marketplaces e origens</dt><dd className="channel-list">{(context?.channels ?? []).map(channel => <span key={channel}>{channel}</span>)}</dd></div>
      </dl>
    </section>

    <section className="metrics dossier-metrics">
      <div className="metric"><div>Linhas processadas</div><strong>{data.summary.source_rows.toLocaleString("pt-BR")}</strong><small>Registros recebidos pelo backend</small></div>
      <div className="metric"><div>Casos recuperáveis</div><strong>{data.summary.overcharged_rows.toLocaleString("pt-BR")}</strong><small>Ocorrências acima do valor esperado</small></div>
      <div className="metric featured"><div>Recuperação potencial</div><strong>{formatCurrency(data.summary.total_recoverable)}</strong><small>Total calculado pelas regras aplicáveis</small></div>
    </section>

    <section className="panel dossier-results">
      <header className="results-header">
        <div><PackageSearch /><div><h3>Explorar resultados</h3><p>Pesquise e combine filtros sem alterar os cálculos da auditoria.</p></div></div>
        <div className="result-summary"><b>{filtered.length.toLocaleString("pt-BR")}</b><span>resultados</span><b>{formatCurrency(filteredRecovery)}</b><span>no filtro</span></div>
      </header>

      <div className="dossier-filterbar">
        <label className="filter-field filter-search"><span>Busca geral</span><div><Search /><input aria-label="Busca geral" value={filters.query} onChange={event => updateFilter("query", event.target.value)} placeholder="ID, pedido, regra, transportadora..." /></div></label>
        <label className="filter-field"><span>Rastreio ou pedido</span><input aria-label="Rastreio ou pedido" value={filters.tracking} onChange={event => updateFilter("tracking", event.target.value)} placeholder="Ex.: 47852609543" /></label>
        <label className="filter-field"><span>SKU ou produto</span><input aria-label="SKU ou produto" value={filters.sku} onChange={event => updateFilter("sku", event.target.value)} placeholder="Ex.: PAINEL-70" /></label>
        <label className="filter-field"><span>Marketplace</span><select aria-label="Marketplace" value={filters.marketplace} onChange={event => updateFilter("marketplace", event.target.value)}><option value="ALL">Todos</option>{marketplaces.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-field"><span>Status</span><select aria-label="Status do finding" value={filters.status} onChange={event => updateFilter("status", event.target.value)}><option value="ALL">Todos</option><option value="OVERCHARGED">Recuperável</option><option value="OK">Correto</option><option value="PENDING">Pendente</option><option value="REVIEW_REQUIRED">Revisão</option></select></label>
        <label className="filter-field"><span>Regra</span><select aria-label="Regra" value={filters.rule} onChange={event => updateFilter("rule", event.target.value)}><option value="ALL">Todas</option>{rules.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-field"><span>Ordenar</span><select aria-label="Ordenar resultados" value={filters.sort} onChange={event => updateFilter("sort", event.target.value as DossierFilters["sort"])}><option value="recovery_desc">Maior recuperação</option><option value="recovery_asc">Menor recuperação</option><option value="charged_desc">Maior cobrança</option><option value="expected_desc">Maior valor devido</option><option value="tracking_asc">Rastreio / pedido</option><option value="marketplace_asc">Marketplace</option><option value="status_asc">Status</option><option value="sku_asc">SKU</option><option value="rule_asc">Regra</option></select></label>
        <button className="button filter-reset" onClick={resetFilters}><FilterX /> Limpar</button>
      </div>

      <div className="filter-insights"><span><SlidersHorizontal /> {filtered.length.toLocaleString("pt-BR")} de {items.length.toLocaleString("pt-BR")} findings</span><span>{identifiedSkus.toLocaleString("pt-BR")} com SKU identificado</span><span>{marketplaces.length} origem(ns) detectada(s)</span></div>

      {visible.length ? <div className="table-wrap"><table className="dossier-table"><thead><tr><SortableHeader label="Status" field="status" sort={filters.sort} onSort={sortBy} /><SortableHeader label="Rastreio / pedido" field="tracking" sort={filters.sort} onSort={sortBy} /><SortableHeader label="Marketplace" field="marketplace" sort={filters.sort} onSort={sortBy} /><SortableHeader label="SKU(s)" field="sku" sort={filters.sort} onSort={sortBy} /><th>Dimensões / peso / cubagem</th><SortableHeader label="Regra" field="rule" sort={filters.sort} onSort={sortBy} /><SortableHeader label="Cobrado" field="charged" sort={filters.sort} onSort={sortBy} number /><SortableHeader label="Esperado" field="expected" sort={filters.sort} onSort={sortBy} number /><SortableHeader label="Recuperável" field="recovery" sort={filters.sort} onSort={sortBy} number /><th></th></tr></thead>
      <tbody>{visible.map(item => { const technical = findingDimensionsDisplay(item); return <tr key={item.finding_id} className="clickable-row" onClick={() => setSelected(item)} tabIndex={0} onKeyDown={event => event.key === "Enter" && setSelected(item)}><td><StatusBadge status={item.status} /></td><td><b>{item.tracking_number ?? item.shipment_id ?? "—"}</b><small>{item.order_id ?? item.pack_id ?? "Sem pedido"}</small></td><td><span className="marketplace-pill">{item.marketplace ?? "Não informado"}</span><small>{item.carrier ?? "—"}</small></td><td className="sku-cell"><b>{findingSkuDisplay(item)}</b><small>{item.quantity != null ? `${item.quantity} unidade(s)` : "Quantidade não informada"}</small></td><td className="technical-cell"><b>{technical.dimensions}</b><small>{technical.weight ?? "Peso não identificado"}</small><small>Cubagem: {technical.volume ?? "não identificada"}</small></td><td><b>{item.rule_id ?? "Sem regra"}</b><small>{item.match_method ?? "Sem conciliação"}</small></td><td className="number">{formatCurrency(item.charged_amount)}</td><td className="number">{formatCurrency(item.expected_amount)}</td><td className="number recover">{formatCurrency(item.recoverable_amount)}</td><td><span className="row-open">Abrir</span></td></tr>; })}</tbody></table></div> : <EmptyState />}
      <footer className="table-footer dossier-pagination"><span>Exibindo {visible.length.toLocaleString("pt-BR")} nesta página</span><div><button className="button" disabled={safePage === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>Anterior</button><span>Página {safePage + 1} de {pageCount}</span><button className="button" disabled={safePage + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>Próxima</button></div></footer>
    </section>

    {!!data.warnings.length && <details className="panel dossier-warnings"><summary>Pontos técnicos para revisão <span>{data.warnings.length}</span></summary><ul>{data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
  </div>;
}
