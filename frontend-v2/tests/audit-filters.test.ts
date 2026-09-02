import { describe, expect, it } from "vitest";
import { demoFindings } from "../src/mocks/demoData";
import { filterAndSortFindings, type DossierFilters } from "../src/lib/auditFindings";
import { findingDimensionsDisplay } from "../src/lib/findings";

const filters: DossierFilters = {
  query: "",
  tracking: "",
  sku: "",
  marketplace: "ALL",
  status: "ALL",
  rule: "ALL",
  sort: "recovery_desc",
};

describe("filtros do dossiê", () => {
  it("pesquisa por rastreio, pedido e SKU", () => {
    expect(filterAndSortFindings(demoFindings, { ...filters, tracking: "MEL245987310" })).toHaveLength(1);
    expect(filterAndSortFindings(demoFindings, { ...filters, tracking: "2000008893831" })).toHaveLength(1);
    expect(filterAndSortFindings(demoFindings, { ...filters, sku: "PAINEL-60X30" })[0]?.finding_id).toBe("F-1072");
  });

  it("combina marketplace, status e regra", () => {
    const result = filterAndSortFindings(demoFindings, {
      ...filters,
      marketplace: "Mercado Livre",
      status: "OVERCHARGED",
      rule: "FLEX-SP-01",
    });
    expect(result).toHaveLength(2);
  });

  it("ordena pelo maior valor recuperável", () => {
    const result = filterAndSortFindings(demoFindings, filters);
    expect(result[0].recoverable_amount).toBeGreaterThanOrEqual(result[1].recoverable_amount ?? 0);
  });

  it("formata dimensões e peso sem presumir dados ausentes", () => {
    expect(findingDimensionsDisplay(demoFindings[0])).toEqual({ dimensions: "Não identificado", weight: null });
    expect(findingDimensionsDisplay({ ...demoFindings[0], technical_data: {
      dimensions_raw: null,
      height_cm: 30,
      width_cm: 20,
      length_cm: 80,
      weight_g: 1500,
      volume_cm3: 48000,
    } })).toEqual({ dimensions: "80 × 20 × 30 cm", weight: "1,5 kg" });
  });
});
