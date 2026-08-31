import { AuditListSchema, AuditResponseSchema } from "../contracts/schemas";
import type { AuditInput } from "../contracts/types";
import { notImplemented, request } from "./client";
export const auditsApi = {
  list: () => request("/api/v1/audits", AuditListSchema),
  get: (id: string) =>
    request("/api/v1/audits/" + encodeURIComponent(id), AuditResponseSchema),
  run: async (input: AuditInput) => {
    void input;
    return notImplemented("/api/v1/audits → sources → run");
  },
};
