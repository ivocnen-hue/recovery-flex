import { describe, expect, it } from "vitest";
import { reconcileSources } from "../src/index.js";

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
