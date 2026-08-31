import { ArrowUpRight } from "lucide-react";
import type { AuditListItem } from "../../contracts/types";
import { formatCurrency } from "../../lib/currency";
import { formatDate } from "../../lib/dates";
import { StatusBadge } from "../ui/StatusBadge";
import { EmptyState } from "../ui/States";
export function AuditTable({ items }: { items: AuditListItem[] }) {
  if (!items.length)
    return <EmptyState message="Nenhuma auditoria encontrada." />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Auditoria</th>
            <th>Seller / canal</th>
            <th>Período</th>
            <th>Status</th>
            <th className="number">Linhas</th>
            <th className="number">Findings</th>
            <th className="number">Recovery</th>
            <th>Data</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.audit_id}>
              <td>
                <b>{a.audit_id}</b>
              </td>
              <td>
                <b>{a.seller}</b>
                <small>{a.marketplace}</small>
              </td>
              <td>{a.period}</td>
              <td>
                <StatusBadge status={a.status} />
              </td>
              <td className="number">
                {a.source_rows.toLocaleString("pt-BR")}
              </td>
              <td className="number">{a.findings.toLocaleString("pt-BR")}</td>
              <td className="number recover">
                {formatCurrency(a.total_recoverable)}
              </td>
              <td>{formatDate(a.created_at)}</td>
              <td>
                <button
                  className="icon small"
                  aria-label={"Abrir " + a.audit_id}
                >
                  <ArrowUpRight />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
