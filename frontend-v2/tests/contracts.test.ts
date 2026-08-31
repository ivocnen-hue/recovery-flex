import { describe, expect, it } from "vitest";
import audit from "./fixtures/audit-valid.json";
import finding from "./fixtures/finding-valid.json";
import {
  AuditResponseSchema,
  EvidenceSchema,
  FindingSchema,
  WorkerHealthSchema,
} from "../src/contracts/schemas";
describe("contrato Worker → frontend", () => {
  it("aceita o health check versionado do Worker", () =>
    expect(
      WorkerHealthSchema.parse({
        ok: true,
        service: "Recovery Audit Engine",
        version: "0.5.1",
        features: ["deterministic audit"],
        endpoints: ["/api/v1/health"],
      }).version,
    ).toBe("0.5.1"));
  it("aceita auditoria canônica 1.0", () =>
    expect(AuditResponseSchema.parse(audit).summary.total_recoverable).toBe(
      12876,
    ));
  it("rejeita versão incompatível", () =>
    expect(() =>
      AuditResponseSchema.parse({ ...audit, schema_version: "2.0" }),
    ).toThrow());
  it("rejeita campo obrigatório ausente", () => {
    const invalid = { ...audit } as Partial<typeof audit>;
    delete invalid.audit_id;
    expect(() => AuditResponseSchema.parse(invalid)).toThrow();
  });
  it("rejeita campo inesperado", () =>
    expect(() => AuditResponseSchema.parse({ ...audit, total: 1 })).toThrow());
  it("aceita finding canônico sem derivar valores", () =>
    expect(FindingSchema.parse(finding)).toMatchObject({
      charged_amount: 24,
      expected_amount: 12,
      difference: 12,
      recoverable_amount: 12,
    }));
  it("preserva charged_amount ausente como null", () =>
    expect(
      FindingSchema.parse({ ...finding, charged_amount: null }).charged_amount,
    ).toBeNull());
  it("aceita evidência canônica", () =>
    expect(
      EvidenceSchema.parse({
        evidence_id: "e1",
        source_file: "a.xlsx",
        sheet: "Envios",
        row: 2,
        original_column: "Valor",
        original_value: "R$24",
        normalized_value: 24,
        canonical_field: "charged_amount",
        match_method: "tracking",
        confidence: 0.9,
        rule: "v3",
        conflicts: [],
      }),
    ).toBeTruthy());
});
