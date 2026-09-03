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

export function findingMeasurementComparison(finding: Finding) {
  const data = finding.technical_data;
  if (!data) return null;
  const formatDimensions = (length?: number | null, width?: number | null, height?: number | null) =>
    [length, width, height].every(value => value != null)
      ? `${[length, width, height].map(value => Number(value).toLocaleString("pt-BR")).join(" × ")} cm`
      : "Não identificado";
  const formatWeight = (value?: number | null) => value == null
    ? "Não identificado"
    : value >= 1000
      ? `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`
      : `${value.toLocaleString("pt-BR")} g`;
  const formatVolume = (value?: number | null) => value == null
    ? "Não identificada"
    : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm³`;
  return {
    sellerDimensions: formatDimensions(data.seller_length_cm, data.seller_width_cm, data.seller_height_cm),
    marketplaceDimensions: formatDimensions(data.marketplace_length_cm, data.marketplace_width_cm, data.marketplace_height_cm),
    sellerWeight: formatWeight(data.seller_weight_g),
    marketplaceWeight: formatWeight(data.marketplace_weight_g),
    sellerVolume: formatVolume(data.seller_volume_cm3),
    marketplaceVolume: formatVolume(data.marketplace_volume_cm3),
    matched: Boolean(data.seller_catalog_match),
    discrepancy: Boolean(data.marketplace_measurement_discrepancy),
    source: data.seller_catalog_source_file ?? null,
    reason: data.seller_catalog_reason ?? null,
  };
}
