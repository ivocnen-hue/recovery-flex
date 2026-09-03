import { describe, expect, it } from "vitest";
import { applyProductCatalog, buildCatalog, canonicalRowFromSource, productCatalogSignal, reconcileSources } from "../src/index.js";

const charge = overrides => ({
  source_file: "flex.csv",
  source_sheet: null,
  source_row: 2,
  charged_amount: 18,
  tracking_number: null,
  order_id: null,
  shipment_id: null,
  pack_id: null,
  sku: null,
  quantity: 1,
  height_cm: 10,
  width_cm: 20,
  length_cm: 30,
  weight_g: 500,
  ...overrides
});

const sale = overrides => ({
  source_file: "marketplace.xlsx",
  source_sheet: "Pedidos",
  source_row: 2,
  charged_amount: null,
  tracking_number: null,
  order_id: null,
  shipment_id: null,
  pack_id: null,
  sku: "SKU-1",
  quantity: 1,
  height_cm: 10,
  width_cm: 20,
  length_cm: 30,
  weight_g: 500,
  ...overrides
});

describe("hierarchical reconciliation", () => {
  it("prefers an exact tracking identifier and retains every SKU item", () => {
    const result = reconcileSources([
      charge({ tracking_number: "ABC123" }),
      sale({ tracking_number: "ABC123", sku: "SKU-A" }),
      sale({ tracking_number: "ABC123", sku: "SKU-B", source_row: 3 })
    ]).reconciled_rows[0];

    expect(result.reconciliation_method).toBe("exact_identifier");
    expect(result.items.map(item => item.sku)).toEqual(["SKU-A", "SKU-B"]);
    expect(result.sku).toBeNull();
    expect(result.reconciliation_ambiguity).toBe(false);
  });

  it("matches rotated dimensions with measurement tolerance when composite evidence is unique", () => {
    const result = reconcileSources([
      charge({ height_cm: 30.5, width_cm: 9.8, length_cm: 20.4, postal_code: "04567-000", account_id: "Loja A" }),
      sale({ height_cm: 10, width_cm: 20, length_cm: 30, postal_code: "04567000", account_id: "Loja A" })
    ]).reconciled_rows[0];

    expect(result.reconciliation_method).toBe("composite_dimensions");
    expect(result.sku).toBe("SKU-1");
    expect(result.reconciliation_signals).toContain("dimensions");
  });

  it("does not assign a SKU when dimensional candidates are ambiguous", () => {
    const result = reconcileSources([
      charge({}),
      sale({ sku: "SKU-A" }),
      sale({ sku: "SKU-B", source_row: 3 })
    ]).reconciled_rows[0];

    expect(result.reconciliation_method).toBe("unmatched");
    expect(result.sku).toBeNull();
    expect(result.reconciliation_ambiguity).toBe(true);
  });

  it("does not force a dimensional match without weight or contextual evidence", () => {
    const result = reconcileSources([
      charge({ weight_g: null }),
      sale({ weight_g: null })
    ]).reconciled_rows[0];

    expect(result.reconciliation_method).toBe("unmatched");
    expect(result.sku).toBeNull();
  });
});

describe("seller ERP product catalog", () => {
  it("recognizes a seller product master and not a financial sales source", () => {
    const base = {
      source: { filename: "produtos_2026-09-02.xls", sheet: "Produtos", headers: ["SKU", "Altura", "Largura", "Comprimento", "Peso"] },
      mapper: { file_type: "Cadastro de produtos", mapping: {} },
    };
    expect(productCatalogSignal(base).is_catalog).toBe(true);
    expect(productCatalogSignal({
      ...base,
      source: { ...base.source, filename: "vendas.xlsx", headers: [...base.source.headers, "Valor cobrado"] },
    }).is_catalog).toBe(false);
  });

  it("maps the real Olist ERP headers and converts kilograms to grams", () => {
    const mapped = {
      source: {
        filename: "produtos_2026-09-02.xls",
        sheet: "Produtos",
        headers: ["Código (SKU)", "Descrição", "Peso bruto (Kg)", "Largura embalagem", "Altura embalagem", "Comprimento embalagem"],
      },
      mapper: { file_type: "Cadastro de produtos", mapping: {} },
    };
    const row = canonicalRowFromSource(["SKU-ERP", "Produto teste", "0,96", "45", "10", "37"], mapped, "seller");
    expect(row).toMatchObject({
      sku: "SKU-ERP", product_name: "Produto teste", weight_g: 960,
      width_cm: 45, height_cm: 10, length_cm: 37, volume_cm3: 16650,
    });
  });

  it("uses the ERP measurements while preserving the marketplace measurements", () => {
    const catalog = buildCatalog([{
      sku: "SKU-1", height_cm: 8, width_cm: 12, length_cm: 20, weight_g: 400,
      source_file: "produtos_erp.xls", source_sheet: "Produtos", source_row: 2,
    }]);
    const result = applyProductCatalog(sale({
      sku: "SKU-1", height_cm: 20, width_cm: 30, length_cm: 40, weight_g: 1200,
      items: [{ sku: "SKU-1" }],
    }), catalog);
    expect(result).toMatchObject({
      seller_catalog_match: true,
      height_cm: 8,
      width_cm: 12,
      length_cm: 20,
      weight_g: 400,
      seller_volume_cm3: 1920,
      marketplace_height_cm: 20,
      marketplace_width_cm: 30,
      marketplace_length_cm: 40,
      marketplace_weight_g: 1200,
      marketplace_volume_cm3: 24000,
      volume_difference_cm3: 22080,
      weight_difference_g: 800,
      marketplace_measurement_discrepancy: true,
      seller_catalog_source_file: "produtos_erp.xls",
    });
  });

  it("does not invent package dimensions for multiple SKUs", () => {
    const catalog = buildCatalog([
      { sku: "SKU-1", height_cm: 8, width_cm: 12, length_cm: 20, weight_g: 400 },
      { sku: "SKU-2", height_cm: 4, width_cm: 6, length_cm: 10, weight_g: 200 },
    ]);
    const result = applyProductCatalog(sale({
      sku: null,
      items: [{ sku: "SKU-1" }, { sku: "SKU-2" }],
    }), catalog);
    expect(result.seller_catalog_match).toBe(false);
    expect(result.seller_catalog_ambiguity).toBe(true);
    expect(result.seller_catalog_reason).toContain("múltiplos SKUs");
  });

  it("blocks an automatic match when ERP rows conflict for the same SKU", () => {
    const catalog = buildCatalog([
      { sku: "SKU-1", height_cm: 8, width_cm: 12, length_cm: 20, weight_g: 400, source_file: "erp-a.xls" },
      { sku: "SKU-1", height_cm: 18, width_cm: 12, length_cm: 20, weight_g: 400, source_file: "erp-b.xls" },
    ]);
    const result = applyProductCatalog(sale({ sku: "SKU-1", items: [{ sku: "SKU-1" }] }), catalog);
    expect(result.seller_catalog_match).toBe(false);
    expect(result.seller_catalog_ambiguity).toBe(true);
    expect(result.seller_catalog_conflicting_sources).toEqual(["erp-a.xls", "erp-b.xls"]);
  });
});
