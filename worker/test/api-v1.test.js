import { describe, expect, it } from "vitest";
import { canonicalizeAudit } from "../src/api-v1.js";

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
});

