import { AuditListSchema, AuditResponseSchema } from "../contracts/schemas";
import type { AuditInput } from "../contracts/types";
import { request } from "./client";
export const auditsApi = {
  list: () => request("/api/v1/audits", AuditListSchema),
  get: (id: string) =>
    request("/api/v1/audits/" + encodeURIComponent(id), AuditResponseSchema),
  run: async (input: AuditInput) => {
    const form = new FormData();
    form.set("seller", input.seller);
    form.set("marketplace", input.marketplace);
    form.set("operation", input.operation);
    form.set("carrier", input.carrier);
    form.set("periodStart", input.periodStart);
    form.set("periodEnd", input.periodEnd);
    input.files.forEach(file => form.append("files", file, file.name));
    return request("/api/v1/audits", AuditResponseSchema, {
      method: "POST",
      body: form,
      timeout: 300_000,
    });
  },
};
