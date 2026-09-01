import type { z } from "zod";
import type {
  AuditListItemSchema,
  AuditResponseSchema,
  AuditSummarySchema,
  EvidenceSchema,
  FindingSchema,
} from "./schemas";
export type AuditSummary = z.infer<typeof AuditSummarySchema>;
export type AuditResponse = z.infer<typeof AuditResponseSchema>;
export type AuditListItem = z.infer<typeof AuditListItemSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type AuditInput = {
  seller: string;
  channels?: string[];
  marketplace?: string;
  operation: string;
  carrier: string;
  periodStart: string;
  periodEnd: string;
  files: File[];
};
