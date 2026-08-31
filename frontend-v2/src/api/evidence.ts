import { EvidenceResponseSchema } from "../contracts/schemas";
import { request } from "./client";
export const evidenceApi = {
  get: (auditId: string) =>
    request(
      "/api/v1/audits/" + encodeURIComponent(auditId) + "/evidence",
      EvidenceResponseSchema,
    ),
};
