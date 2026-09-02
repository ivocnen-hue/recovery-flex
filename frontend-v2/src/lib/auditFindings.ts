import type { Finding } from "../contracts/types";
import { findingSkuDisplay } from "./findings";

export type DossierFilters = {
  query: string;
  tracking: string;
  sku: string;
  marketplace: string;
  status: string;
  rule: string;
  sort: "recovery_desc" | "recovery_asc" | "tracking_asc" | "sku_asc";
};

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

  return filtered.sort((a, b) => {
    if (filters.sort === "recovery_asc") return (a.recoverable_amount ?? 0) - (b.recoverable_amount ?? 0);
    if (filters.sort === "tracking_asc") return searchable(a.tracking_number ?? a.order_id).localeCompare(searchable(b.tracking_number ?? b.order_id));
    if (filters.sort === "sku_asc") return findingSkuDisplay(a).localeCompare(findingSkuDisplay(b), "pt-BR");
    return (b.recoverable_amount ?? 0) - (a.recoverable_amount ?? 0);
  });
}
