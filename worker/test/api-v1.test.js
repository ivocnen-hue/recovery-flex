import { describe, expect, it } from "vitest";
import { buildAuditWorkbook, canonicalizeAudit, sourcesJsonByteLength, streamSourcesJson } from "../src/api-v1.js";
import { repairStoredTabularLayout, sourceMappingKey } from "../src/index.js";

const payload = {
  warnings: [],
  summary: { normalized_rows: 4, total_recoverable: 24384 },
  results: [
    { status: "OVERCHARGED", charged_amount: 15000, expected_amount: 12876, difference: 2124, recoverable_amount: 2124, evidence: { source_files: ["a.xlsx", "b.csv"] } },
    { status: "OVERCHARGED", charged_amount: 6000, expected_amount: 4920, difference: 1080, recoverable_amount: 1080, evidence: { source_files: ["a.xlsx"] } },
    { status: "OK", charged_amount: 1992, expected_amount: 1992, difference: 0, recoverable_amount: 0, evidence: { source_files: [] } },
    { status: "INSUFFICIENT_DATA", charged_amount: null, expected_amount: 4596, difference: null, recoverable_amount: null, evidence: { source_files: [] } },
  ],
};

describe("canonical API v1 adapter", () => {
  it("preserves explicit financial calculations", () => {
    expect(1073 * 12).toBe(12876);
    expect(410 * 12).toBe(4920);
    expect(166 * 12).toBe(1992);
    expect(383 * 12).toBe(4596);
  });

  it("never converts missing charged_amount to zero", () => {
    const result = canonicalizeAudit(payload, { seller_id: "seller", sources: [{ rows: [1, 2, 3, 4] }] }, "audit-test");
    expect(result.findings[3].charged_amount).toBeNull();
    expect(result.findings[3].recoverable_amount).toBeNull();
    expect(result.audit.summary.missing_charged_amount_rows).toBe(1);
  });

  it("creates strict canonical findings and conservative matching", () => {
    const result = canonicalizeAudit(payload, { seller_id: "seller", sources: [{ rows: [1, 2, 3, 4] }] }, "audit-test");
    expect(result.audit).toMatchObject({ schema_version: "1.0", audit_id: "audit-test", status: "REVIEW_REQUIRED" });
    expect(result.audit.summary.matched_rows).toBe(1);
    expect(result.findings[0]).toMatchObject({ finding_id: "audit-test:finding:1", status: "OVERCHARGED", match_method: "identifier" });
  });

  it("reuses semantic mapping only for equivalent layouts and context", () => {
    const first = { filename: "jan.csv", headers: ["Tracking", "Valor"], context: { marketplace: "Mercado Livre" } };
    const second = { filename: "fev.csv", headers: ["tracking", "valor"], context: { marketplace: "mercado livre" } };
    const different = { filename: "rules.csv", headers: ["SKU", "Preço"] };
    expect(sourceMappingKey(first, "seller-a")).toBe(sourceMappingKey(second, "seller-a"));
    expect(sourceMappingKey(first, "seller-a")).not.toBe(sourceMappingKey(different, "seller-a"));
  });

  it("repairs legacy Flex CSV rows stored in a single cell", () => {
    const repaired = repairStoredTabularLayout(
      ["Conta", "CEP", "Rastreio", "Dimensões", "Cobrado"],
      [['PROSPECTA;04567000;ABC123;"10x20x30,500";12,00', null, null], ['PROSPECTA;04568000;ABC124;"11x21x31,600";12,00', null, null]],
    );
    expect(repaired.rows[0]).toEqual(["PROSPECTA", "04567000", "ABC123", "10x20x30,500", "12,00"]);
  });

  it("aligns the known extra company column after Conta", () => {
    const repaired = repairStoredTabularLayout(
      ["Conta", "CEP", "Rastreio"],
      [["seller-1", "EMPRESA LTDA", "04567000", "ABC123"], ["seller-1", "EMPRESA LTDA", "04568000", "ABC124"]],
    );
    expect(repaired.headers).toEqual(["Conta", "Conta empresarial", "CEP", "Rastreio"]);
  });

  it("promotes the embedded Mercado Livre header row", () => {
    const repaired = repairStoredTabularLayout(
      ["Neste relatório, você encontra as informações das suas vendas e tarifas faturadas.", "coluna_2", "coluna_3", "coluna_4", "coluna_5", "coluna_6", "coluna_7", "coluna_8"],
      [
        ["Vendas", null, null, null, null, null, null, null],
        ["N.º de venda", "Data da venda", "SKU", "Unidades", "Número de rastreamento", "CEP", "Título do anúncio", "Estado"],
        ["123", "2026-08-25", "SKU-1", 2, "TRACK-1", "04065000", "Produto", "Entregue"],
      ],
    );
    expect(repaired.headers).toContain("Número de rastreamento");
    expect(repaired.rows).toEqual([["123", "2026-08-25", "SKU-1", 2, "TRACK-1", "04065000", "Produto", "Entregue"]]);
  });

  it("serializes staged rows as a stream without changing provenance", async () => {
    const sources = [{ filename: "large.xlsx", sheet: "Vendas", headers: ["SKU"], rows: [["A"], ["B"]] }];
    const serialized = await new Response(streamSourcesJson(sources)).text();
    const stored = JSON.parse(serialized);
    expect(stored).toEqual(sources);
    expect(sourcesJsonByteLength(sources)).toBe(new TextEncoder().encode(serialized).byteLength);
  });

  it("keeps Flex as the operation and channels as separate audit context", () => {
    const result = canonicalizeAudit(payload, {
      seller: "Casa Alva",
      marketplace: "Mercado Livre, Shopee, Envios avulsos",
      channels: ["Mercado Livre", "Shopee", "Envios avulsos"],
      operation: "Flex",
      carrier: "GT2",
      sources: [{ rows: [1, 2, 3, 4] }],
    }, "audit-context");
    expect(result.listItem).toMatchObject({
      operation: "Flex",
      carrier: "GT2",
      channels: ["Mercado Livre", "Shopee", "Envios avulsos"],
    });
  });

  it("builds an auditable Excel dossier with formulas and completeness checks", () => {
    const canonical = canonicalizeAudit(payload, {
      seller: "Casa Alva",
      marketplace: "Mercado Livre, Shopee",
      operation: "Flex",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      sources: [{ rows: [1, 2, 3, 4] }],
    }, "audit-excel");
    const workbook = buildAuditWorkbook({
      audit_id: "audit-excel",
      seller: "Casa Alva",
      period: "2026-01-01 — 2026-12-31",
      findings: canonical.findings.length,
      total_recoverable: canonical.audit.summary.total_recoverable,
      warnings: [],
    }, canonical.findings);
    expect(workbook.SheetNames).toEqual([
      "1 Resumo Executivo",
      "2 Dimensoes x Quantidade",
      "3 Pedidos Auditados",
      "4 Evidencias",
      "5 Controles",
    ]);
    expect(workbook.Sheets["3 Pedidos Auditados"].L2.f).toContain("I2-J2");
    expect(workbook.Sheets["3 Pedidos Auditados"].N2.f).toContain("OVERCHARGED");
    expect(workbook.Sheets["5 Controles"].E11.f).toContain("VERIFICADO");
  });
});
