import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { FindingSort, SortField } from "../../lib/auditFindings";

export function SortableHeader({ label, field, sort, onSort, number = false }: {
  label: string;
  field: SortField;
  sort: FindingSort;
  onSort: (field: SortField) => void;
  number?: boolean;
}) {
  const active = sort.startsWith(`${field}_`);
  const descending = sort === `${field}_desc`;
  return <th className={`${number ? "number " : ""}sortable-column`} aria-sort={active ? (descending ? "descending" : "ascending") : "none"}>
    <button type="button" onClick={() => onSort(field)} title={`Ordenar por ${label}`}>
      <span>{label}</span>{active ? (descending ? <ArrowDown /> : <ArrowUp />) : <ArrowUpDown />}
    </button>
  </th>;
}
