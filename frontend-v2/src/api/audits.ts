import {
  AuditDraftSchema,
  AuditListSchema,
  AuditResponseSchema,
  AuditSourceSchema,
} from "../contracts/schemas";
import type { AuditInput } from "../contracts/types";
import { request } from "./client";
export const auditsApi = {
  list: () => request("/api/v1/audits", AuditListSchema),
  get: (id: string) =>
    request("/api/v1/audits/" + encodeURIComponent(id), AuditResponseSchema),
  run: async (input: AuditInput) => {
    const draft = await request("/api/v1/audits/drafts", AuditDraftSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seller: input.seller,
        marketplace: input.marketplace,
        operation: input.operation,
        carrier: input.carrier,
        period_start: input.periodStart,
        period_end: input.periodEnd,
      }),
    });
    for (const file of input.files) {
      const form = new FormData();
      form.set("marketplace", input.marketplace);
      form.set("operation", input.operation);
      form.set("carrier", input.carrier);
      form.set("file", file, file.name);
      await request(
        "/api/v1/audits/" + encodeURIComponent(draft.audit_id) + "/sources",
        AuditSourceSchema,
        { method: "POST", body: form, timeout: 180_000 },
      );
    }
    return request(
      "/api/v1/audits/" + encodeURIComponent(draft.audit_id) + "/run",
      AuditResponseSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        timeout: 300_000,
      },
    );
  },
};
