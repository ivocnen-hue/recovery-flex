import type { Finding } from "../contracts/types";

export function findingSkuDisplay(finding: Finding) {
  const skus = [finding.sku, ...(finding.items ?? []).map((item) => item.sku)].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(skus)].join(" · ") || "—";
}

export function findingProductDisplay(finding: Finding) {
  const products = (finding.items ?? [])
    .map((item) => item.product_name)
    .filter((value): value is string => Boolean(value));
  return [...new Set(products)].join(" · ") || null;
}

export function findingDimensionsDisplay(finding: Finding) {
  const data = finding.technical_data;
  if (!data) return { dimensions: "Não identificado", weight: null, volume: null };
  const parsed = [data.length_cm, data.width_cm, data.height_cm];
  const dimensions = parsed.every((value) => value != null)
    ? `${parsed.map((value) => Number(value).toLocaleString("pt-BR")).join(" × ")} cm`
    : data.dimensions_raw || "Não identificado";
  const weight = data.weight_g == null
    ? null
    : data.weight_g >= 1000
      ? `${(data.weight_g / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`
      : `${data.weight_g.toLocaleString("pt-BR")} g`;
  const volume = data.volume_cm3 == null
    ? null
    : `${data.volume_cm3.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm³`;
  return { dimensions, weight, volume };
}
