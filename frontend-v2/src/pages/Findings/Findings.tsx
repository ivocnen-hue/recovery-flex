import { BookOpenCheck, CalendarRange, ChevronRight, FileSpreadsheet, FilterX, FolderSearch, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { auditsApi } from "../../api/audits";
import { FindingDrawer } from "../../components/findings/FindingDrawer";
import { RulesDrawer } from "../../components/findings/RulesDrawer";
import { SortableHeader } from "../../components/findings/SortableHeader";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { Finding } from "../../contracts/types";
import { useAuditRules, useAudits, useFindings } from "../../hooks/useRecoveryData";
import { filterAndSortFindings, toggleFindingSort, type DossierFilters, type SortField } from "../../lib/auditFindings";
import { formatCurrency } from "../../lib/currency";
import { formatDate, formatPeriod } from "../../lib/dates";
import { findingDimensionsDisplay, findingProductDisplay, findingSkuDisplay } from "../../lib/findings";

const initialFilters: DossierFilters = { query: "", tracking: "", sku: "", marketplace: "ALL", status: "ALL", rule: "ALL", sort: "recovery_desc" };
const emptyFindings: Finding[] = [];

export function Findings() {
  const audits = useAudits();
  const [auditId, setAuditId] = useState("");
  const findings = useFindings(auditId, Boolean(auditId));
  const auditRules = useAuditRules(auditId, Boolean(auditId));
  const [selected, setSelected] = useState<Finding | null>(null);
  const [filters, setFilters] = useState<DossierFilters>(initialFilters);
  const [exporting, setExporting] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [page, setPage] = useState(0);
  const items = findings.data?.items ?? emptyFindings;
  const filtered = useMemo(() => filterAndSortFindings(items, filters), [items, filters]);
  const audit = audits.data?.items.find((item) => item.audit_id === auditId);

  if (audits.isLoading) return <LoadingState />;
  if (audits.error) return <ErrorState error={audits.error} />;

  const marketplaces = [...new Set(items.map((item) => item.marketplace ?? "Não informado"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const rules = [...new Set(items.map((item) => item.rule_id ?? "Sem regra"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const totals = filtered.reduce((sum, item) => ({
    charged: sum.charged + (item.charged_amount ?? 0),
    expected: sum.expected + (item.expected_amount ?? 0),
    recoverable: sum.recoverable + (item.recoverable_amount ?? 0),
  }), { charged: 0, expected: 0, recoverable: 0 });
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const updateFilter = <K extends keyof DossierFilters>(key: K, value: DossierFilters[K]) => {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const chooseAudit = (value: string) => {
    setAuditId(value);
    setPage(0);
    setFilters(initialFilters);
    setSelected(null);
    setShowRules(false);
  };
  const sortBy = (field: SortField) => updateFilter("sort", toggleFindingSort(filters.sort, field));
  const downloadExcel = async () => {
    if (!auditId) return;
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

  return <div className="page dossier dossier-hub">
    <section className="page-intro dossier-title"><div><span className="eyebrow">Central de análise</span><h2>Dossiê</h2><p>Escolha uma auditoria para consultar, filtrar e exportar seus resultados.</p></div></section>

    <section className="panel audit-picker">
      <div className="audit-picker-icon"><FolderSearch /></div>
      <label><span>Auditoria</span><select aria-label="Escolher auditoria" value={auditId} onChange={(event) => chooseAudit(event.target.value)}><option value="">Selecione uma auditoria...</option>{[...(audits.data?.items ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((item) => <option key={item.audit_id} value={item.audit_id}>{item.seller} · {item.operation ?? "Operação não informada"} · {formatPeriod(item.period)} · {item.audit_id.slice(0, 8)}</option>)}</select></label>
      {audit && <div className="audit-picker-meta"><b>{audit.seller}</b><span>{formatDate(audit.created_at)}</span></div>}
      <button className="button primary" disabled={!auditId || exporting} onClick={downloadExcel}><FileSpreadsheet /> {exporting ? "Gerando..." : "Exportar Excel"}</button>
    </section>

    {audit && <section className="audit-scope-strip">
      <div className="audit-period"><CalendarRange /><span>Período auditado</span><b>{formatPeriod(audit.period)}</b></div>
      <div><span>Seller / operação</span><b>{audit.seller} · {audit.operation ?? "Não informada"}</b></div>
      <div><span>Canais auditados</span><b>{(audit.channels?.length ? audit.channels : [audit.marketplace]).join(" · ")}</b></div>
      <div><span>Auditoria</span><b>{audit.audit_id.slice(0, 8)}</b></div>
    </section>}

    {!auditId ? <section className="panel dossier-placeholder"><FolderSearch /><h3>Selecione a auditoria acima</h3><p>Os valores, canais e casos exibidos pertencerão exclusivamente à auditoria escolhida.</p></section>
      : findings.isLoading ? <LoadingState /> : findings.error ? <ErrorState error={findings.error} /> : <>
        <section className="metrics dossier-financials">
          <div className="metric"><div>Valor total cobrado</div><strong>{formatCurrency(totals.charged)}</strong><small>Soma dos casos no filtro atual</small></div>
          <div className="metric"><div>Valor total devido</div><strong>{formatCurrency(totals.expected)}</strong><small>Valor esperado pelas regras</small></div>
          <div className="metric featured"><div>Valor recuperável</div><strong>{formatCurrency(totals.recoverable)}</strong><small>Diferença passível de recuperação</small></div>
        </section>

        <section className="panel dossier-results">
          <header className="results-header"><div><SlidersHorizontal /><div><h3>Resultados da auditoria</h3><p>{audit?.seller} · {formatPeriod(audit?.period ?? "")}</p></div></div><div className="results-actions"><button className="button subtle" onClick={() => setShowRules(true)}><BookOpenCheck /> Ver regras <span>{auditRules.data?.items.length ?? 0}</span></button><div className="result-summary"><b>{filtered.length.toLocaleString("pt-BR")}</b><span>casos filtrados</span><b>{formatCurrency(totals.recoverable)}</b><span>recuperável</span></div></div></header>
          <div className="dossier-filterbar dossier-hub-filters">
            <label className="filter-field filter-search"><span>Busca geral</span><div><Search /><input aria-label="Busca geral" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="ID, pedido, regra, canal..." /></div></label>
            <label className="filter-field"><span>Rastreio ou pedido</span><input aria-label="Rastreio ou pedido" value={filters.tracking} onChange={(event) => updateFilter("tracking", event.target.value)} placeholder="Número de rastreio" /></label>
            <label className="filter-field"><span>SKU ou produto</span><input aria-label="SKU ou produto" value={filters.sku} onChange={(event) => updateFilter("sku", event.target.value)} placeholder="SKU ou nome" /></label>
            <label className="filter-field"><span>Canal</span><select aria-label="Canal" value={filters.marketplace} onChange={(event) => updateFilter("marketplace", event.target.value)}><option value="ALL">Todos</option>{marketplaces.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="filter-field"><span>Status</span><select aria-label="Status" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="ALL">Todos</option><option value="OVERCHARGED">Recuperável</option><option value="OK">Correto</option><option value="PENDING">Pendente</option><option value="REVIEW_REQUIRED">Revisão</option></select></label>
            <label className="filter-field"><span>Regra</span><select aria-label="Regra" value={filters.rule} onChange={(event) => updateFilter("rule", event.target.value)}><option value="ALL">Todas</option>{rules.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="filter-field"><span>Ordenar</span><select aria-label="Ordenar resultados" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value as DossierFilters["sort"])}><option value="recovery_desc">Maior recuperação</option><option value="recovery_asc">Menor recuperação</option><option value="charged_desc">Maior cobrança</option><option value="expected_desc">Maior valor devido</option><option value="tracking_asc">Rastreio / pedido</option><option value="marketplace_asc">Canal</option><option value="status_asc">Status</option><option value="sku_asc">SKU</option><option value="rule_asc">Regra</option></select></label>
            <button className="button filter-reset" onClick={() => { setFilters(initialFilters); setPage(0); }}><FilterX /> Limpar</button>
          </div>
          <div className="filter-insights"><span><SlidersHorizontal /> {filtered.length.toLocaleString("pt-BR")} de {items.length.toLocaleString("pt-BR")} casos</span><span>{marketplaces.length} canal(is) identificado(s)</span><span>Auditoria {auditId.slice(0, 8)}</span></div>
          {visible.length ? <div className="table-wrap"><table className="dossier-table dossier-hub-table"><thead><tr><SortableHeader label="Status" field="status" sort={filters.sort} onSort={sortBy} /><SortableHeader label="Rastreio / pedido" field="tracking" sort={filters.sort} onSort={sortBy} /><SortableHeader label="Canal" field="marketplace" sort={filters.sort} onSort={sortBy} /><SortableHeader label="SKU / produto" field="sku" sort={filters.sort} onSort={sortBy} /><th>Dimensões / peso</th><SortableHeader label="Cobrado" field="charged" sort={filters.sort} onSort={sortBy} number /><SortableHeader label="Devido" field="expected" sort={filters.sort} onSort={sortBy} number /><SortableHeader label="Recuperável" field="recovery" sort={filters.sort} onSort={sortBy} number /><SortableHeader label="Regra aplicada" field="rule" sort={filters.sort} onSort={sortBy} /><th /></tr></thead><tbody>{visible.map((item) => {
            const technical = findingDimensionsDisplay(item);
            return <tr key={item.finding_id} className="clickable-row" onClick={() => setSelected(item)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setSelected(item)}><td><StatusBadge status={item.status} /></td><td><b>{item.tracking_number ?? item.shipment_id ?? "—"}</b><small>{item.order_id ?? item.shipment_id ?? "Sem pedido"}</small></td><td><span className="marketplace-pill">{item.marketplace ?? "Não informado"}</span><small>{item.carrier ?? "Transportadora não informada"}</small></td><td className="sku-cell"><b>{findingSkuDisplay(item)}</b><small>{findingProductDisplay(item) ?? (item.quantity != null ? `${item.quantity} unidade(s)` : "Produto não conciliado")}</small></td><td className="technical-cell"><b>{technical.dimensions}</b><small>{technical.weight ?? "Peso não identificado"}</small><small>Cubagem: {technical.volume ?? "não identificada"}</small></td><td className="number">{formatCurrency(item.charged_amount)}</td><td className="number">{formatCurrency(item.expected_amount)}</td><td className="number recover">{formatCurrency(item.recoverable_amount)}</td><td className="rule-cell"><b>{item.rule_id ?? "Sem regra"}</b><small>{item.rule_version ? `Versão ${item.rule_version}` : "Versão não informada"}</small></td><td><ChevronRight /></td></tr>;
          })}</tbody></table></div> : <EmptyState message="Nenhum caso encontrado com estes filtros." />}
          <footer className="table-footer dossier-pagination"><span>Exibindo {visible.length.toLocaleString("pt-BR")} nesta página</span><div><button className="button" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Anterior</button><span>Página {safePage + 1} de {pageCount}</span><button className="button" disabled={safePage + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Próxima</button></div></footer>
        </section>
      </>}
    <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
    <RulesDrawer findings={items} rules={auditRules.data?.items ?? []} loading={auditRules.isLoading} open={showRules} onClose={() => setShowRules(false)} />
  </div>;
}
