import { ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { FindingDrawer } from "../../components/findings/FindingDrawer";
import { StatusBadge } from "../../components/ui/StatusBadge";
import {
  ErrorState,
  LoadingState,
  EmptyState,
} from "../../components/ui/States";
import type { Finding } from "../../contracts/types";
import { useFindings } from "../../hooks/useRecoveryData";
import { formatConfidence } from "../../lib/confidence";
import { formatCurrency } from "../../lib/currency";
export function Findings() {
  const query = useFindings();
  const [selected, setSelected] = useState<Finding | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [confidence, setConfidence] = useState("ALL");
  const items = useMemo(
    () =>
      query.data?.items.filter(
        (f) =>
          (status === "ALL" || f.status === status) &&
          (confidence === "ALL" || (f.confidence ?? 0) >= Number(confidence)) &&
          [
            f.tracking_number,
            f.order_id,
            f.shipment_id,
            f.sku,
            f.carrier,
            f.marketplace,
            f.rule_id,
          ]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
      ) ?? [],
    [query.data, search, status, confidence],
  );
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} />;
  return (
    <div className="page">
      <section className="page-intro">
        <div>
          <h2>Findings / Casos</h2>
          <p>
            Valores e decisões exibidos exatamente como recebidos do Worker.
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="toolbar findings-toolbar">
          <label className="search">
            <Search />
            <input
              aria-label="Buscar findings"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tracking, pedido, SKU, regra..."
            />
          </label>
          <div className="filters">
            <SlidersHorizontal />
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="ALL">Todos os status</option>
              <option value="OVERCHARGED">Recuperáveis</option>
              <option value="PENDING">Pendentes</option>
              <option value="REVIEW_REQUIRED">Revisão</option>
              <option value="OK">Corretos</option>
            </select>
            <select
              aria-label="Confiança"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
            >
              <option value="ALL">Toda confiança</option>
              <option value=".9">≥ 90%</option>
              <option value=".7">≥ 70%</option>
            </select>
          </div>
        </div>
        {items.length ? (
          <div className="table-wrap">
            <table className="findings-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Tracking / pedido</th>
                  <th>Shipment</th>
                  <th>SKU</th>
                  <th className="number">Qtd.</th>
                  <th className="number">Cobrado</th>
                  <th className="number">Esperado</th>
                  <th className="number">Diferença</th>
                  <th className="number">Recuperável</th>
                  <th>Confiança</th>
                  <th>Regra</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr
                    key={f.finding_id}
                    onClick={() => setSelected(f)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(f)}
                  >
                    <td>
                      <StatusBadge status={f.status} />
                    </td>
                    <td>
                      <b>{f.tracking_number ?? "—"}</b>
                      <small>{f.order_id ?? "—"}</small>
                    </td>
                    <td>{f.shipment_id ?? "—"}</td>
                    <td>
                      <b>{f.sku ?? "—"}</b>
                      <small>
                        {f.marketplace ?? "—"} · {f.carrier ?? "—"}
                      </small>
                    </td>
                    <td className="number">{f.quantity ?? "—"}</td>
                    <td className="number">
                      {formatCurrency(f.charged_amount)}
                    </td>
                    <td className="number">
                      {formatCurrency(f.expected_amount)}
                    </td>
                    <td className="number">{formatCurrency(f.difference)}</td>
                    <td className="number recover">
                      {formatCurrency(f.recoverable_amount)}
                    </td>
                    <td>{formatConfidence(f.confidence)}</td>
                    <td>
                      {f.rule_id ?? "—"} <small>{f.rule_version ?? ""}</small>
                    </td>
                    <td>
                      <ChevronRight />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState />
        )}
        <footer className="table-footer">
          <span>{items.length} casos exibidos</span>
          <span>Ordenação e cursor preparados para backend</span>
        </footer>
      </section>
      <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
