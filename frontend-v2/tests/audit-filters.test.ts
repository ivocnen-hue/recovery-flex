import { describe, expect, it } from "vitest";
import { demoFindings } from "../src/mocks/demoData";
import { filterAndSortFindings, toggleFindingSort, type DossierFilters } from "../src/lib/auditFindings";
import { formatDate, formatPeriod } from "../src/lib/dates";
import { findingDimensionsDisplay } from "../src/lib/findings";
import { formatRuleCondition } from "../src/lib/rules";

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

  it("ordena diretamente por qualquer coluna", () => {
    const byChannel = filterAndSortFindings(demoFindings, { ...filters, sort: "marketplace_asc" });
    expect(byChannel[0].marketplace?.localeCompare(byChannel.at(-1)?.marketplace ?? "", "pt-BR")).toBeLessThanOrEqual(0);
    expect(toggleFindingSort("status_asc", "status")).toBe("status_desc");
    expect(toggleFindingSort("recovery_desc", "tracking")).toBe("tracking_asc");
  });

  it("exibe datas brasileiras sem alterar o contrato ISO", () => {
    expect(formatPeriod("2025-01-01 — 2026-09-01")).toBe("01-01-2025 — 01-09-2026");
    expect(formatDate("2026-09-01T14:54:00-03:00")).toMatch(/^01-09-2026 14:54$/);
  });

  it("formata dimensões e peso sem presumir dados ausentes", () => {
    expect(findingDimensionsDisplay(demoFindings[0])).toEqual({ dimensions: "Não identificado", weight: null, volume: null });
    expect(findingDimensionsDisplay({ ...demoFindings[0], technical_data: {
      dimensions_raw: null,
      height_cm: 30,
      width_cm: 20,
      length_cm: 80,
      weight_g: 1500,
      volume_cm3: 48000,
    } })).toEqual({ dimensions: "80 × 20 × 30 cm", weight: "1,5 kg", volume: "48.000 cm³" });
  });

  it("traduz as condições estruturadas da regra sem recalcular valores", () => {
    expect(formatRuleCondition({ field: "quantity", op: "lte", value: 3 })).toBe("Quantidade de unidades menor ou igual a 3");
    expect(formatRuleCondition({ field: "weight_g", op: "lt", value: 2000 })).toBe("Peso menor que 2 kg");
    expect(formatRuleCondition({ field: "max_dimension_cm", op: "lte", value: 80 })).toBe("Maior dimensão menor ou igual a 80 cm");
  });
});
