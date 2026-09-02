import type { Finding } from "../contracts/types";
import { findingSkuDisplay } from "./findings";

export type DossierFilters = {
  query: string;
  tracking: string;
  sku: string;
  marketplace: string;
  status: string;
  rule: string;
  sort: FindingSort;
};

export type SortField = "status" | "tracking" | "marketplace" | "sku" | "charged" | "expected" | "recovery" | "rule";
export type FindingSort = `${SortField}_${"asc" | "desc"}`;

export const toggleFindingSort = (current: FindingSort, field: SortField): FindingSort =>
  current === `${field}_asc` ? `${field}_desc` : `${field}_asc`;

const searchable = (value: unknown) => String(value ?? "").toLocaleLowerCase("pt-BR");

export function filterAndSortFindings(items: Finding[], filters: DossierFilters) {
  const query = searchable(filters.query).trim();
  const tracking = searchable(filters.tracking).trim();
  const sku = searchable(filters.sku).trim();
  const filtered = items.filter((item) => {
    const skuText = searchable(findingSkuDisplay(item));
    const identifierText = searchable([item.tracking_number, item.order_id, item.shipment_id, item.pack_id].join(" "));
    const globalText = searchable([identifierText, skuText, item.marketplace, item.carrier, item.rule_id, item.rule_version, item.finding_id].join(" "));
    return (!query || globalText.includes(query))
      && (!tracking || identifierText.includes(tracking))
      && (!sku || skuText.includes(sku))
      && (filters.marketplace === "ALL" || (item.marketplace ?? "Não informado") === filters.marketplace)
      && (filters.status === "ALL" || item.status === filters.status)
      && (filters.rule === "ALL" || (item.rule_id ?? "Sem regra") === filters.rule);
  });

  const [field, direction] = filters.sort.split("_") as [SortField, "asc" | "desc"];
  const factor = direction === "asc" ? 1 : -1;
  const value = (item: Finding): string | number => {
    if (field === "status") return searchable(item.status);
    if (field === "tracking") return searchable(item.tracking_number ?? item.order_id ?? item.shipment_id);
    if (field === "marketplace") return searchable(item.marketplace);
    if (field === "sku") return searchable(findingSkuDisplay(item));
    if (field === "charged") return item.charged_amount ?? Number.NEGATIVE_INFINITY;
    if (field === "expected") return item.expected_amount ?? Number.NEGATIVE_INFINITY;
    if (field === "rule") return searchable(item.rule_id);
    return item.recoverable_amount ?? Number.NEGATIVE_INFINITY;
  };
  return filtered.sort((a, b) => {
    const left = value(a);
    const right = value(b);
    return factor * (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "pt-BR"));
  });
}
