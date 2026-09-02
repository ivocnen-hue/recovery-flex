import {
  AuditDraftSchema,
  AuditListSchema,
  AuditResponseSchema,
  AuditSourceSchema,
} from "../contracts/schemas";
import type { AuditInput } from "../contracts/types";
import { BASE_URL, request } from "./client";
export const auditsApi = {
  list: () => request("/api/v1/audits", AuditListSchema),
  get: (id: string) =>
    request("/api/v1/audits/" + encodeURIComponent(id), AuditResponseSchema),
  downloadDossier: async (id: string) => {
    const response = await fetch(
      BASE_URL + "/api/v1/audits/" + encodeURIComponent(id) + "/dossier.xlsx",
      { credentials: "omit" },
    );
    if (!response.ok) throw new Error("Não foi possível gerar o dossiê em Excel.");
    return response.blob();
  },
  run: async (input: AuditInput) => {
    const channels = input.channels?.length
      ? input.channels
      : input.marketplace
        ? [input.marketplace]
        : [];
    const draft = await request("/api/v1/audits/drafts", AuditDraftSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seller: input.seller,
        marketplace: channels.join(", "),
        channels,
        operation: input.operation,
        carrier: input.carrier,
        period_start: input.periodStart,
        period_end: input.periodEnd,
      }),
    });
    for (const file of input.files) {
      const form = new FormData();
      form.set("marketplace", channels.join(", "));
      form.set("operation", input.operation);
      form.set("carrier", input.carrier);
      form.set("rule_clarifications", JSON.stringify(input.ruleClarifications || {}));
      form.set("file", file, file.name);
      await request(
        "/api/v1/audits/" + encodeURIComponent(draft.audit_id) + "/sources",
        AuditSourceSchema,
        { method: "POST", body: form, timeout: 300_000 },
      );
    }
    try {
      return await request(
        "/api/v1/audits/" + encodeURIComponent(draft.audit_id) + "/run",
        AuditResponseSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          timeout: 300_000,
        },
      );
    } catch (error) {
      try {
        const recovered = await request(
          "/api/v1/audits/" + encodeURIComponent(draft.audit_id),
          AuditResponseSchema,
        );
        if (["COMPLETED", "REVIEW_REQUIRED"].includes(recovered.status)) return recovered;
      } catch {
        // Preserve the original execution error when no completed audit can be recovered.
      }
      throw error;
    }
  },
};
