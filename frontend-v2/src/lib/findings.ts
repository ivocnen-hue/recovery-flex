import type { Finding } from "../contracts/types";

export function findingSkuDisplay(finding: Finding) {
  const skus = [finding.sku, ...(finding.items ?? []).map((item) => item.sku)].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(skus)].join(" · ") || "—";
}
