import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AuditTable } from "../../components/audits/AuditTable";
import { ErrorState, LoadingState } from "../../components/ui/States";
import { useAudits } from "../../hooks/useRecoveryData";
export function Audits() {
  const query = useAudits();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const items = useMemo(
    () =>
      query.data?.items
        .filter(
          (a) =>
            (status === "ALL" || a.status === status) &&
            [a.audit_id, a.seller, a.marketplace]
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at)) ?? [],
    [query.data, search, status],
  );
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} />;
  return (
    <div className="page">
      <section className="page-intro">
        <div>
          <h2>Auditorias</h2>
          <p>Histórico centralizado das execuções e resultados.</p>
        </div>
      </section>
      <section className="panel">
        <div className="toolbar">
          <label className="search">
            <Search />
            <input
              aria-label="Buscar auditorias"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar seller, canal ou ID..."
            />
          </label>
          <select
            aria-label="Filtrar por status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="ALL">Todos os status</option>
            <option value="COMPLETED">Concluídas</option>
            <option value="REVIEW_REQUIRED">Revisão</option>
            <option value="FAILED">Falhas</option>
          </select>
        </div>
        <AuditTable items={items} />
        <footer className="table-footer">
          <span>{items.length} auditorias exibidas</span>
          <span>Paginação será controlada pelo backend</span>
        </footer>
      </section>
    </div>
  );
}
