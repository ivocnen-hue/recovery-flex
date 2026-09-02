import { describe, expect, it } from "vitest";
import { demoFindings } from "../src/mocks/demoData";
import { filterAndSortFindings, type DossierFilters } from "../src/lib/auditFindings";

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
});
