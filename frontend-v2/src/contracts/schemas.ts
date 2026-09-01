import { z } from "zod";
export const SchemaVersion = z.literal("1.0");
export const WorkerHealthSchema = z
  .object({
    ok: z.literal(true),
    service: z.literal("Recovery Audit Engine"),
    version: z.string(),
    features: z.array(z.string()),
    endpoints: z.array(z.string()),
  })
  .strict();
export const AuditStatusSchema = z.enum([
  "DRAFT",
  "UPLOADING",
  "PROCESSING",
  "REVIEW_REQUIRED",
  "COMPLETED",
  "FAILED",
]);
export const AuditSummarySchema = z
  .object({
    source_rows: z.number().int().nonnegative(),
    normalized_rows: z.number().int().nonnegative(),
    matched_rows: z.number().int().nonnegative(),
    pending_rows: z.number().int().nonnegative(),
    overcharged_rows: z.number().int().nonnegative(),
    ok_rows: z.number().int().nonnegative(),
    missing_charged_amount_rows: z.number().int().nonnegative(),
    total_recoverable: z.number().nonnegative(),
  })
  .strict();
export const EvidenceSchema = z
  .object({
    evidence_id: z.string(),
    source_file: z.string(),
    sheet: z.string().nullable(),
    row: z.number().int().nullable(),
    original_column: z.string().nullable(),
    original_value: z.unknown(),
    normalized_value: z.unknown(),
    canonical_field: z.string().nullable(),
    match_method: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    rule: z.string().nullable(),
    conflicts: z.array(z.string()).default([]),
  })
  .strict();
export const FindingSchema = z
  .object({
    finding_id: z.string(),
    status: z.enum(["OVERCHARGED", "OK", "PENDING", "REVIEW_REQUIRED"]),
    tracking_number: z.string().nullable(),
    order_id: z.string().nullable(),
    shipment_id: z.string().nullable(),
    pack_id: z.string().nullable(),
    sku: z.string().nullable(),
    quantity: z.number().nullable(),
    charged_amount: z.number().nullable(),
    expected_amount: z.number().nullable(),
    difference: z.number().nullable(),
    recoverable_amount: z.number().nullable(),
    rule_id: z.string().nullable(),
    rule_version: z.string().nullable(),
    marketplace: z.string().nullable().default(null),
    carrier: z.string().nullable().default(null),
    match_method: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    evidence: z.array(EvidenceSchema),
  })
  .strict();
export const AuditResponseSchema = z
  .object({
    ok: z.literal(true),
    schema_version: SchemaVersion,
    audit_id: z.string(),
    status: AuditStatusSchema,
    summary: AuditSummarySchema,
    warnings: z.array(z.string()),
    errors: z.array(z.string()),
  })
  .strict();
export const AuditDraftSchema = z
  .object({
    ok: z.literal(true),
    schema_version: SchemaVersion,
    audit_id: z.string(),
    status: z.literal("UPLOADING"),
  })
  .strict();
export const AuditSourceSchema = z
  .object({
    ok: z.literal(true),
    schema_version: SchemaVersion,
    audit_id: z.string(),
    source_id: z.string(),
    filename: z.string(),
    source_rows: z.number().int().nonnegative(),
    sheets: z.number().int().positive(),
  })
  .strict();
export const AuditListItemSchema = z
  .object({
    audit_id: z.string(),
    seller: z.string(),
    marketplace: z.string(),
    period: z.string(),
    status: AuditStatusSchema,
    source_rows: z.number().int().nonnegative(),
    findings: z.number().int().nonnegative(),
    total_recoverable: z.number().nullable(),
    created_at: z.string(),
  })
  .strict();
export const AuditListSchema = z
  .object({
    ok: z.literal(true),
    schema_version: SchemaVersion,
    items: z.array(AuditListItemSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();
export const FindingsResponseSchema = z
  .object({
    ok: z.literal(true),
    schema_version: SchemaVersion,
    audit_id: z.string(),
    items: z.array(FindingSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();
export const EvidenceResponseSchema = z
  .object({
    ok: z.literal(true),
    schema_version: SchemaVersion,
    finding_id: z.string(),
    items: z.array(EvidenceSchema),
  })
  .strict();
export const ApiErrorSchema = z
  .object({
    ok: z.literal(false),
    schema_version: z.string().optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      request_id: z.string().optional(),
    }),
  })
  .passthrough();
